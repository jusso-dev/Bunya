import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseImportText } from "./portable";
import { GraphDocumentSchema, type GraphDocument } from "./schema";
import { subnetVirtualNetwork } from "./topology";
import { OUTPUTS } from "@/lib/generators/registry";

const FIXTURES = join(__dirname, "..", "..", "e2e", "fixtures", "arm");

function load(name: string): { document: GraphDocument; warning: string } {
  const result = parseImportText(readFileSync(join(FIXTURES, name), "utf8"));
  if (!result.ok) throw new Error(result.reason);
  return { document: result.document, warning: result.warning ?? "" };
}

describe("real Azure quickstart templates", () => {
  for (const name of readdirSync(FIXTURES).filter((file) => file.endsWith(".json"))) {
    it(`imports ${name} into a valid, connected diagram`, () => {
      const { document, warning } = load(name);
      expect(() => GraphDocumentSchema.parse(document)).not.toThrow();
      expect(warning).not.toMatch(/replaced characters|Resources in \[|resource-\d/);
      expect(document.nodes.filter((node) => /^resource-\d+$/.test(node.resourceName))).toEqual([]);
      for (const subnet of document.nodes.filter((node) => node.type === "subnet")) {
        expect(subnetVirtualNetwork(document, subnet), subnet.resourceName).toBeDefined();
      }
      expect(document.edges.length).toBeGreaterThan(0);
      for (const output of OUTPUTS) {
        expect(() => output.generate(document, {}), output.id).not.toThrow();
      }
    });
  }

  it("draws the private AKS cluster's subnets, endpoints and DNS links", () => {
    const { document } = load("private-aks-cluster-with-public-dns-zone.json");
    const types = new Set(document.nodes.map((node) => node.type));
    for (const type of ["aksCluster", "virtualNetwork", "subnet", "privateEndpoint", "privateDnsZone", "containerRegistry", "keyVault"] as const) {
      expect(types, type).toContain(type);
    }
    const aks = document.nodes.find((node) => node.type === "aksCluster")!;
    expect(document.edges.some((edge) => edge.source === aks.id && document.nodes.find((n) => n.id === edge.target)?.type === "subnet")).toBe(true);
  });

  it("generates every output for the App Service Environment template", () => {
    const { document } = load("asev2-appservice-sql-vpngw.json");
    for (const output of OUTPUTS) {
      const result = output.generate(document, {});
      expect(result.ok ? "" : result.reason, output.id).toBe("");
    }
  });
});
