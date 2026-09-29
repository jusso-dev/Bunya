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

  it("covers all service resource types for the supported full-stack fixture", () => {
    const result = generateBicep({
      ...fullStackGraph,
      nodes: fullStackGraph.nodes.filter((node) => node.id !== "nsg"),
      edges: fullStackGraph.edges.filter((edge) => edge.source !== "nsg" && edge.target !== "nsg"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const main = result.files.find((f) => f.path === "main.bicep")?.content ?? "";
    for (const provider of [
      "Microsoft.Network/virtualNetworks",
      "Microsoft.Network/virtualNetworks/subnets",
      "Microsoft.Network/privateEndpoints",
      "Microsoft.Web/serverfarms",
      "Microsoft.Web/sites",
      "Microsoft.Web/staticSites",
      "Microsoft.ContainerService/managedClusters",
      "Microsoft.Compute/virtualMachineScaleSets",
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
