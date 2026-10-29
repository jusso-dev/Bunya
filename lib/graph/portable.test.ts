import { describe, expect, it } from "vitest";
import { firstCutGraph } from "@/lib/generators/__fixtures__/firstCut";
import {
  buildEnvelope,
  envelopeToBlob,
  parsePortable,
  parseImportText,
  isPortableFile,
  suggestedFilename,
  PORTABLE_EXTENSION,
} from "./portable";

describe("portable export/import", () => {
  it("accepts JSON filenames regardless of case", () => {
    expect(isPortableFile(new File(["{}"], "resource-group.JSON"))).toBe(true);
  });

  it("imports supported fields while warning about unsupported Azure settings", () => {
    const result = parseImportText(JSON.stringify({ resources: [
      { type: "Microsoft.Web/serverfarms", name: "plan", location: "eastus", sku: { name: "P3v3", capacity: 2 } },
      { type: "Microsoft.Storage/storageAccounts", name: "storage", sku: { name: "Standard_RAGZRS" }, properties: { isHnsEnabled: true } },
      { type: "Microsoft.KeyVault/vaults", name: "vault", properties: { sku: { name: "premium" }, softDeleteRetentionInDays: 30 } },
      { name: "missing-type" },
    ] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.find((node) => node.resourceName === "plan")?.properties).toMatchObject({ sku: "B1", capacity: 2 });
    expect(result.document.nodes.find((node) => node.resourceName === "storage")?.properties).toMatchObject({ sku: "Standard_LRS", hierarchicalNamespace: true });
    expect(result.document.nodes.find((node) => node.resourceName === "vault")?.properties.softDeleteRetentionDays).toBe(30);
    expect(result.warning).toContain("unsupported sku");
    expect(result.warning).toContain("missing type or name");
    expect(result.warning).toContain("resource locations");
    expect(result.envelope.document).toEqual(result.document);
  });

  it("explains graph limits for oversized ARM imports", () => {
    const resources = Array.from({ length: 200 }, (_, index) => ({ type: "Microsoft.KeyVault/vaults", name: `vault-${index}` }));
    const result = parseImportText(JSON.stringify({ resources }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("up to 200 nodes");
  });
  it("imports Key Vault SKUs from Azure exports and warns when they cannot be resolved", () => {
    const result = parseImportText(JSON.stringify({
      parameters: { vaultSku: { type: "string", defaultValue: "Premium" }, missingSku: { type: "string" } },
      resources: [
        { type: "Microsoft.KeyVault/vaults", name: "capitalized", properties: { sku: { name: "Standard" } } },
        { type: "Microsoft.KeyVault/vaults", name: "parameterized", properties: { sku: { name: "[parameters('vaultSku')]" } } },
        { type: "Microsoft.KeyVault/vaults", name: "unresolved", properties: { sku: { name: "[parameters('missingSku')]" } } },
      ],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const vaults = result.document.nodes.filter((node) => node.type === "keyVault");
    expect(vaults.map((node) => node.properties.sku)).toEqual(["standard", "premium", "standard"]);
    expect(result.warning).toContain("Key Vault unresolved");
  });
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
