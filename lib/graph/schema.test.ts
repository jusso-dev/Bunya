import { describe, expect, it } from "vitest";
import {
  GraphDocumentSchema,
  GraphEdgeSchema,
  GraphNodeSchema,
  emptyGraph,
} from "./schema";

describe("graph schemas", () => {
  it("validates an empty graph document", () => {
    const parsed = GraphDocumentSchema.safeParse(emptyGraph("demo"));
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown service type", () => {
    const result = GraphNodeSchema.safeParse({
      id: "n1",
      type: "notAService",
      position: { x: 0, y: 0 },
      name: "x",
      resourceName: "x",
      properties: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects an edge with an unknown kind", () => {
    const result = GraphEdgeSchema.safeParse({
      id: "e1",
      source: "a",
      target: "b",
      kind: "notAKind",
    });
    expect(result.success).toBe(false);
  });
});
