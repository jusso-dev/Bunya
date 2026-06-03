import { describe, expect, it } from "vitest";
import { firstCutGraph } from "@/lib/generators/__fixtures__/firstCut";
import {
  buildEnvelope,
  envelopeToBlob,
  parsePortable,
  parseImportText,
  suggestedFilename,
  PORTABLE_EXTENSION,
} from "./portable";

describe("portable export/import", () => {
  it("round-trips a document via the wrapped envelope", () => {
    const env = buildEnvelope(firstCutGraph);
    const blob = envelopeToBlob(env);
    expect(blob.type).toBe("application/x-bunya+json");
    const text = JSON.stringify(env);
    const result = parsePortable(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual(firstCutGraph);
  });

  it("imports a bare GraphDocument as a legacy import", () => {
    const result = parsePortable(JSON.stringify(firstCutGraph));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual(firstCutGraph);
  });

  it("rejects non-JSON content", () => {
    const result = parsePortable("not json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/JSON/);
  });

  it("rejects an envelope with an unknown version", () => {
    const text = JSON.stringify({ format: "bunya", version: 99, document: firstCutGraph });
    const result = parsePortable(text);
    expect(result.ok).toBe(false);
  });

  it("rejects a JSON object that is not a Bunya export", () => {
    const result = parsePortable(JSON.stringify({ hello: "world" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/Bunya export/);
  });

  it("derives a sensible filename slug from the document name", () => {
    expect(suggestedFilename(firstCutGraph)).toBe(`first-cut${PORTABLE_EXTENSION}`);
  });

  it("rejects a document that fails Zod migration", () => {
    const broken = JSON.stringify({
      format: "bunya",
      version: 1,
      document: { schemaVersion: 1, metadata: {}, nodes: [], edges: [] },
    });
    const result = parsePortable(broken);
    expect(result.ok).toBe(false);
  });

  it("accepts an ARM template through the generic import parser", () => {
    const result = parseImportText(
      JSON.stringify({
        resources: [
          {
            type: "Microsoft.ContainerService/managedClusters",
            apiVersion: "2024-07-01",
            name: "aks-imported",
            location: "australiaeast",
            properties: { dnsPrefix: "aks-imported" },
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.some((n) => n.type === "aksCluster")).toBe(true);
  });

  it("accepts fenced ARM JSON copied from markdown", () => {
    const result = parseImportText(`Here is a template:

\`\`\`json
{
  "resources": [
    {
      "type": "Microsoft.Web/serverfarms",
      "apiVersion": "2023-12-01",
      "name": "plan-imported",
      "location": "australiaeast",
      "kind": "linux",
      "sku": { "name": "B1", "capacity": 1 },
      "properties": { "reserved": true }
    }
  ]
}
\`\`\``);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.some((n) => n.type === "appServicePlan")).toBe(true);
  });
});
