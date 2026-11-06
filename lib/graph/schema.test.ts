import { describe, expect, it } from "vitest";
import { GraphDocumentSchema, emptyGraph } from "./schema";

describe("graph schemas", () => {
  it("validates an empty graph document", () => {
    const parsed = GraphDocumentSchema.safeParse(emptyGraph("demo"));
    expect(parsed.success).toBe(true);
  });

  it("rejects edges to missing nodes", () => {
    const doc = { ...emptyGraph("demo"), edges: [{ id: "e1", source: "a", target: "b", kind: "network" as const }] };
    expect(GraphDocumentSchema.safeParse(doc).success).toBe(false);
  });
});
