import { describe, expect, it } from "vitest";
import { emptyGraph, type GraphDocument, type ServiceType } from "../graph/schema";
import { getServiceDefinition } from "../catalogue/services";
import { generateTerraform } from "./terraform";
import { generateBicep } from "./bicep";
import { generateArm } from "./arm";
import { generateAzCli } from "./azcli";
import { generatePowerShell } from "./powershell";
import { generateMermaid } from "./mermaid";
import { generateReadme } from "./readme";
import { generateCostEstimate } from "./cost";
import type { GeneratorResult } from "./types";
import { expandImplicits } from "./shared/implicits";
import { fullStackGraph } from "./__fixtures__/fullStack";

const deployments = [generateTerraform, generateBicep, generateArm, generateAzCli, generatePowerShell];
const all = [...deployments, generateMermaid, generateReadme, generateCostEstimate];
function graph(type: ServiceType, properties = {}): GraphDocument {
  return { ...emptyGraph("security"), nodes: [{ id: "node", type, name: "Node", resourceName: "safe-name", position: { x: 0, y: 0 }, properties: { ...getServiceDefinition(type).defaultProperties, ...properties } }] };
}
function text(result: GeneratorResult): string {
  if (!result.ok) throw new Error(result.reason);
  return result.files.map((file) => file.content).join("\n");
}

describe("untrusted generator inputs", () => {
  for (const value of ['$(touch /tmp/bunya-pwned)', '`id`', 'line\nexit 1', "x'; evil; #", '${file("secret")}', '%{ if true }', '[listKeys()]', 'x#>exit 1']) {
    it(`rejects executable syntax ${JSON.stringify(value)}`, () => {
      for (const generate of all) {
        const doc = graph("resourceGroup"); doc.metadata.name = value;
        expect(generate(doc).ok).toBe(false);
        const tagged = graph("resourceGroup", { tags: { owner: value } });
        expect(generate(tagged).ok).toBe(false);
      }
    });
  }
  it("rejects raw numeric injection and invalid array/string values", () => {
    for (const generate of all) {
      expect(generate(graph("aksCluster", { nodeCount: '3; id' })).ok).toBe(false);
      expect(generate(graph("storageAccount", { containers: 42 })).ok).toBe(false);
      expect(generate(graph("appService", { runtime: 'node\n}' })).ok).toBe(false);
    }
  });
  it("rejects parent cycles before traversal", () => {
    const doc = graph("virtualNetwork"); doc.nodes[0].parentId = "node";
    for (const generate of all) expect(generate(doc).ok).toBe(false);
  });
  it("blocks NSG deployments instead of silently losing firewall controls", () => {
    for (const generate of deployments) {
      expect(generate(fullStackGraph)).toMatchObject({ ok: false, reason: expect.stringContaining("NSG rules and associations") });
    }
    expect(generateMermaid(fullStackGraph).ok).toBe(true);
  });
  it("requires supplied SQL secrets", () => {
    for (const generate of [generateTerraform, generateArm, generateBicep]) {
      const output = text(generate(graph("sqlDatabase")));
      expect(output).not.toContain("ReplaceMe");
    }
    const arm = generateArm(graph("sqlDatabase"));
    if (!arm.ok) throw new Error(arm.reason);
    const template = JSON.parse(arm.files[0].content);
    expect(template.parameters.sqlAdminPassword).toEqual({ type: "securestring" });
    expect(JSON.parse(arm.files[1].content).parameters).not.toHaveProperty("sqlAdminPassword");
  });
  it("preserves runtime in private shell companion templates", () => {
    for (const generate of [generateAzCli, generatePowerShell]) {
      const result = generate(graph("functionApp", { publicNetworkAccess: false, runtime: "python", runtimeVersion: "3.12" }));
      if (!result.ok) throw new Error(result.reason);
      const template = JSON.parse(result.files.find((file) => file.path === "azuredeploy.json")!.content);
      const app = template.resources.find((resource: { type: string }) => resource.type === "Microsoft.Web/sites");
      expect(app.properties.siteConfig.linuxFxVersion).toBe("PYTHON|3.12");
      expect(app.properties.siteConfig.appSettings).toContainEqual({ name: "FUNCTIONS_WORKER_RUNTIME", value: "python" });
      const doc = graph("functionApp", { publicNetworkAccess: false });
      const rg = graph("resourceGroup").nodes[0];
      doc.nodes.push({ ...rg, id: "rg1" }, { ...rg, id: "rg2", resourceName: "other-group" });
      expect(generate(doc)).toMatchObject({ ok: false, reason: expect.stringContaining("one resource group") });
    }
  });
  it("preserves private web endpoints across every deployment format", () => {
    for (const type of ["appService", "functionApp", "containerRegistry"] as const) {
      for (const generate of deployments) {
        const output = text(generate(graph(type, { publicNetworkAccess: false })));
        expect(output).toMatch(/public_network_access_enabled\s*=\s*false|publicNetworkAccess[^\n]*Disabled|--public-network-access Disabled|--public-network-enabled false/);
      }
    }
  });
  it("scopes inferred ARM roles to the selected resource", () => {
    const doc = graph("appService");
    const vault = graph("keyVault").nodes[0]; vault.id = "vault"; vault.resourceName = "vault-safe";
    doc.nodes.push(vault); doc.edges.push({ id: "identity", source: "node", target: "vault", kind: "identity" });
    const result = generateArm(doc); if (!result.ok) throw new Error(result.reason);
    const resources = JSON.parse(result.files[0].content).resources;
    const assignment = resources.find((resource: { type: string }) => resource.type === "Microsoft.Authorization/roleAssignments");
    expect(assignment.scope).toContain("Microsoft.KeyVault/vaults");
    const emittedVault = resources.find((resource: { type: string }) => resource.type === "Microsoft.KeyVault/vaults");
    expect(assignment.scope).toBe(`[resourceId('Microsoft.KeyVault/vaults', '${emittedVault.name}')]`);
  });
  it("allocates implicit IDs without overwriting supplied nodes", () => {
    const doc = graph("appService");
    const registry = graph("containerRegistry").nodes[0];
    registry.id = "auto-appServicePlan-plan-security-2"; registry.resourceName = "registry";
    doc.nodes.push(registry);
    const expanded = expandImplicits(doc).document;
    expect(new Set(expanded.nodes.map((node) => node.id)).size).toBe(expanded.nodes.length);
    expect(text(generateTerraform(doc))).toContain("azurerm_container_registry");
  });
  it("keeps Bicep resource names separate from parameter and helper symbols", () => {
    const doc = graph("resourceGroup");
    const app = graph("appService").nodes[0]; app.id = "app"; app.resourceName = "location";
    doc.nodes.push(app);
    const output = text(generateBicep(doc));
    expect(output).not.toMatch(/resource location /);
    expect(output).toMatch(/resource node_\d+_location_resource /);
  });
  it("creates implicit dependencies before consumers in sequential scripts", () => {
    const bash = text(generateAzCli(graph("functionApp")));
    expect(bash.indexOf("az group create")).toBeLessThan(bash.indexOf("az appservice plan create"));
    expect(bash.indexOf("az storage account create")).toBeLessThan(bash.indexOf("az functionapp create"));
    expect(bash.indexOf("az appservice plan create")).toBeLessThan(bash.indexOf("az functionapp create"));
  });
});
