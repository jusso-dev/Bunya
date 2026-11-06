import { describe, expect, it } from "vitest";
import { canConnect } from "./connections";
import { firstCutGraph } from "@/lib/graph/__fixtures__/firstCut";
import { fullStackGraph } from "@/lib/graph/__fixtures__/fullStack";

describe("canConnect", () => {
  it("rejects self-connections", () => {
    const result = canConnect(firstCutGraph, "app", "app");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/itself/);
  });

  it("rejects a connection where the target type is not allowed", () => {
    const result = canConnect(firstCutGraph, "kv", "app");
    expect(result.ok).toBe(false);
  });

  it("rejects a duplicate edge", () => {
    const result = canConnect(firstCutGraph, "app", "plan");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/already exists/);
  });

  it("rejects an allowed connection that would create a cycle", () => {
    const linked = { ...fullStackGraph, edges: [...fullStackGraph.edges, { id: "fn-app", source: "fn", target: "app", kind: "network" as const }] };
    const result = canConnect(linked, "app", "fn");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/cycle/);
  });

  it("allows a fresh App Service to Storage Account data edge", () => {
    const graphWithoutDataEdge = {
      ...firstCutGraph,
      edges: firstCutGraph.edges.filter((e) => !(e.source === "app" && e.target === "stg")),
    };
    const result = canConnect(graphWithoutDataEdge, "app", "stg");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("data");
  });

  it("allows Function App to Web App application links", () => {
    const result = canConnect(fullStackGraph, "fn", "app");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("network");
  });
});
