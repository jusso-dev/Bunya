import { describe, expect, it } from "vitest";
import { generateBicep } from "./bicep";
import { firstCutGraph } from "./__fixtures__/firstCut";
import { fullStackGraph } from "./__fixtures__/fullStack";

describe("generateBicep", () => {
  it("snapshots the first-cut fixture output", () => {
    const result = generateBicep(firstCutGraph);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => f.path)).toEqual(
      expect.arrayContaining(["main.bicep", "main.parameters.json"]),
    );
    expect(result.files.find((f) => f.path === "main.bicep")?.content).toMatchSnapshot();
  });

  it("covers all 20 service resource types for the full-stack fixture", () => {
    const result = generateBicep(fullStackGraph);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const main = result.files.find((f) => f.path === "main.bicep")?.content ?? "";
    for (const provider of [
      "Microsoft.Network/virtualNetworks",
      "Microsoft.Network/virtualNetworks/subnets",
      "Microsoft.Network/networkSecurityGroups",
      "Microsoft.Network/privateEndpoints",
      "Microsoft.Web/serverfarms",
      "Microsoft.Web/sites",
      "Microsoft.Web/staticSites",
      "Microsoft.Storage/storageAccounts",
      "Microsoft.Sql/servers",
      "Microsoft.Sql/servers/databases",
      "Microsoft.DocumentDB/databaseAccounts",
      "Microsoft.KeyVault/vaults",
      "Microsoft.Insights/components",
      "Microsoft.OperationalInsights/workspaces",
      "Microsoft.Cdn/profiles",
      "Microsoft.Network/applicationGateways",
      "Microsoft.ApiManagement/service",
      "Microsoft.ContainerRegistry/registries",
      "Microsoft.ManagedIdentity/userAssignedIdentities",
      "Microsoft.Insights/diagnosticSettings",
    ]) {
      expect(main).toContain(provider);
    }
  });
});
