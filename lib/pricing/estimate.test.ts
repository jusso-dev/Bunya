import { describe, expect, it } from "vitest";
import { estimateCost, formatMoney } from "./estimate";
import { firstCutGraph } from "@/lib/graph/__fixtures__/firstCut";
import { fullStackGraph } from "@/lib/graph/__fixtures__/fullStack";
import { hostingGraph } from "@/lib/graph/__fixtures__/hosting";
import { STARTER_TEMPLATES } from "@/lib/catalogue/templates";
import { DEFAULT_FX_AUD_PER_USD } from "./data";
import type { GraphDocument } from "@/lib/graph/schema";

const withProperties = (document: GraphDocument, id: string, patch: Record<string, unknown>): GraphDocument => ({
  ...document,
  nodes: document.nodes.map((n) => (n.id === id ? { ...n, properties: { ...n.properties, ...patch } } : n)),
});

describe("estimateCost", () => {
  it("prices every node and totals the line items", () => {
    const estimate = estimateCost(firstCutGraph, "AUD");
    expect(estimate.lineItems.map((l) => l.nodeId)).toEqual(firstCutGraph.nodes.map((n) => n.id));
    expect(estimate.total).toBeCloseTo(estimate.lineItems.reduce((sum, l) => sum + l.monthly, 0), 6);
  });

  it("returns 0 cost for an empty graph", () => {
    const empty = { ...firstCutGraph, nodes: [], edges: [] };
    const estimate = estimateCost(empty);
    expect(estimate.total).toBe(0);
    expect(estimate.lineItems).toEqual([]);
  });

  it("uses AUD by default and switches to USD when asked", () => {
    const aud = estimateCost(firstCutGraph, "AUD");
    const usd = estimateCost(firstCutGraph, "USD");
    expect(aud.symbol).toBe("A$");
    expect(usd.symbol).toBe("$");
    expect(aud.total).toBeCloseTo(usd.total * DEFAULT_FX_AUD_PER_USD, 1);
  });

  it("scales App Service Plan cost by capacity", () => {
    const base = estimateCost(firstCutGraph, "USD");
    const planLine = base.lineItems.find((l) => l.serviceType === "appServicePlan");
    expect(planLine).toBeDefined();

    const after = estimateCost(withProperties(firstCutGraph, "plan", { capacity: 3 }), "USD");
    const scaledLine = after.lineItems.find((l) => l.serviceType === "appServicePlan");
    expect(scaledLine?.monthly).toBeCloseTo((planLine?.monthly ?? 0) * 3, 1);
    expect(scaledLine?.sku).toMatch(/ x 3$/);
  });

  it("scales AKS by node count and VMSS by capacity", () => {
    const base = estimateCost(fullStackGraph, "USD").lineItems;
    const scaled = estimateCost(withProperties(withProperties(fullStackGraph, "aks", { nodeCount: 6 }), "vmss", { capacity: 4 }), "USD").lineItems;
    const monthly = (items: typeof base, id: string) => items.find((l) => l.nodeId === id)!.monthly;
    expect(monthly(scaled, "aks")).toBeCloseTo(monthly(base, "aks") * 2, 6);
    expect(monthly(scaled, "vmss")).toBeCloseTo(monthly(base, "vmss") * 2, 6);
  });

  it("bills Function Apps by the plan they run on", () => {
    const sku = (id: string) => estimateCost(hostingGraph).lineItems.find((l) => l.nodeId === id)?.sku;
    expect(sku("fn-flex")).toBe("Flex Consumption");
    expect(sku("fn-y1")).toBe("Consumption");
    expect(sku("fn-ep")).toBe("(plan)");
  });

  it("treats Cosmos free tier as $0", () => {
    const cosmosNode = {
      id: "cos",
      type: "cosmosDb" as const,
      name: "Cosmos",
      resourceName: "cos-test",
      position: { x: 0, y: 0 },
      parentId: null,
      properties: { consistency: "Session", freeTier: true, multiRegionWrites: false, capabilities: [] },
    };
    const estimate = estimateCost({ ...firstCutGraph, nodes: [cosmosNode], edges: [] });
    expect(estimate.lineItems[0].sku).toBe("Free tier");
    expect(estimate.lineItems[0].monthly).toBe(0);
  });

  it("has a price for every service in the starter templates", () => {
    for (const template of STARTER_TEMPLATES) {
      expect(estimateCost(template.document).lineItems.filter((l) => l.unmodelled), template.id).toEqual([]);
    }
  });

  it("formats currency correctly", () => {
    expect(formatMoney(123.456, "AUD")).toBe("A$123.46");
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });

  it("honours an explicit AUD/USD rate", () => {
    const base = estimateCost(firstCutGraph, { currency: "USD" });
    const aud16 = estimateCost(firstCutGraph, { currency: "AUD", audPerUsd: 1.6 });
    expect(aud16.fxAudPerUsd).toBe(1.6);
    expect(aud16.total).toBeCloseTo(base.total * 1.6, 1);
  });

  it("does not apply the FX rate to USD output", () => {
    const usd1 = estimateCost(firstCutGraph, { currency: "USD", audPerUsd: 1.6 });
    const usd2 = estimateCost(firstCutGraph, { currency: "USD", audPerUsd: 2.0 });
    expect(usd1.total).toBeCloseTo(usd2.total, 5);
  });

  it("includes the FX rate in caveats for AUD", () => {
    const estimate = estimateCost(firstCutGraph, { currency: "AUD", audPerUsd: 1.65 });
    expect(estimate.caveats.join(" ")).toContain("1.6500 AUD/USD");
  });
});
