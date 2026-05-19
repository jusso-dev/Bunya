import { describe, expect, it } from "vitest";
import { estimateCost, formatMoney } from "./estimate";
import { firstCutGraph } from "@/lib/generators/__fixtures__/firstCut";
import { fullStackGraph } from "@/lib/generators/__fixtures__/fullStack";
import { noSqlGraph } from "@/lib/generators/__fixtures__/noSql";
import { STARTER_TEMPLATES } from "@/lib/catalogue/templates";

describe("estimateCost", () => {
  it("returns a non-negative total for the first-cut fixture", () => {
    const estimate = estimateCost(firstCutGraph, "AUD");
    expect(estimate.total).toBeGreaterThan(0);
    expect(estimate.symbol).toBe("A$");
    expect(estimate.lineItems).toHaveLength(firstCutGraph.nodes.length);
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
    expect(aud.total).toBeCloseTo(usd.total * 1.5, 1);
  });

  it("scales App Service Plan cost by capacity", () => {
    const base = estimateCost(firstCutGraph, "USD");
    const planLine = base.lineItems.find((l) => l.serviceType === "appServicePlan");
    expect(planLine).toBeDefined();

    const scaled = {
      ...firstCutGraph,
      nodes: firstCutGraph.nodes.map((n) =>
        n.type === "appServicePlan" ? { ...n, properties: { ...n.properties, capacity: 3 } } : n,
      ),
    };
    const after = estimateCost(scaled, "USD");
    const scaledLine = after.lineItems.find((l) => l.serviceType === "appServicePlan");
    expect(scaledLine?.monthly).toBeCloseTo((planLine?.monthly ?? 0) * 3, 1);
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

  it("emits a non-zero total for each starter template", () => {
    for (const template of STARTER_TEMPLATES) {
      const estimate = estimateCost(template.document);
      expect(estimate.total, `template ${template.id} should have a positive total`).toBeGreaterThan(0);
      expect(estimate.caveats.length).toBeGreaterThan(0);
    }
  });

  it("excludes SQL pricing from a graph with no SQL nodes", () => {
    const estimate = estimateCost(noSqlGraph);
    expect(estimate.lineItems.some((l) => l.serviceType === "sqlDatabase")).toBe(false);
  });

  it("snapshots line-item structure for the full-stack fixture", () => {
    const estimate = estimateCost(fullStackGraph, "AUD");
    const summary = {
      currency: estimate.currency,
      snapshotDate: estimate.snapshotDate,
      total: Number(estimate.total.toFixed(2)),
      bySku: estimate.lineItems
        .map((l) => ({ service: l.serviceLabel, sku: l.sku, monthly: Number(l.monthly.toFixed(2)) }))
        .sort((a, b) => a.service.localeCompare(b.service) || a.sku.localeCompare(b.sku)),
    };
    expect(summary).toMatchSnapshot();
  });

  it("formats currency correctly", () => {
    expect(formatMoney(123.456, "AUD")).toBe("A$123.46");
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });
});
