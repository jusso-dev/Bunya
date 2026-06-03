import { describe, expect, it } from "vitest";
import { canConnect } from "./connections";
import { firstCutGraph } from "@/lib/generators/__fixtures__/firstCut";
import { fullStackGraph } from "@/lib/generators/__fixtures__/fullStack";

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

  it("rejects a connection that would create a cycle", () => {
    const result = canConnect(firstCutGraph, "kv", "app");
    expect(result.ok).toBe(false);
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
