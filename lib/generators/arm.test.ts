import { describe, expect, it } from "vitest";
import { generateArm } from "./arm";
import { firstCutGraph } from "./__fixtures__/firstCut";
import { fullStackGraph } from "./__fixtures__/fullStack";

describe("generateArm", () => {
  it("emits both azuredeploy.json and parameters file", () => {
    const result = generateArm(firstCutGraph);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual(["azuredeploy.json", "azuredeploy.parameters.json"]);
  });

  it("snapshots first-cut ARM output", () => {
    const result = generateArm(firstCutGraph);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.find((f) => f.path === "azuredeploy.json")?.content).toMatchSnapshot();
  });

  it("includes every provider for the full-stack fixture", () => {
    const result = generateArm(fullStackGraph);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const main = result.files.find((f) => f.path === "azuredeploy.json")?.content ?? "";
    const parsed = JSON.parse(main) as { resources: { type: string }[] };
    const types = new Set(parsed.resources.map((r) => r.type));
    for (const expected of [
      "Microsoft.Network/virtualNetworks",
      "Microsoft.Network/virtualNetworks/subnets",
      "Microsoft.Network/networkSecurityGroups",
      "Microsoft.Network/privateEndpoints",
      "Microsoft.Web/serverfarms",
      "Microsoft.Web/sites",
      "Microsoft.Web/staticSites",
      "Microsoft.Storage/storageAccounts",
      "Microsoft.Sql/servers",
      "Microsoft.DocumentDB/databaseAccounts",
      "Microsoft.KeyVault/vaults",
      "Microsoft.Insights/components",
      "Microsoft.OperationalInsights/workspaces",
      "Microsoft.Cdn/profiles",
      "Microsoft.Network/applicationGateways",
      "Microsoft.ApiManagement/service",
      "Microsoft.ContainerRegistry/registries",
      "Microsoft.ManagedIdentity/userAssignedIdentities",
    ]) {
      expect(types.has(expected)).toBe(true);
    }
  });
});
