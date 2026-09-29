import { describe, expect, it } from "vitest";
import { generatePowerShell } from "./powershell";
import { firstCutGraph } from "./__fixtures__/firstCut";
import { fullStackGraph } from "./__fixtures__/fullStack";

describe("generatePowerShell", () => {
  it("snapshots first-cut script", () => {
    const result = generatePowerShell(firstCutGraph);
    if (!result.ok) throw new Error("expected ok");
    expect(result.files[0].path).toBe("Deploy-Infrastructure.ps1");
    expect(result.files[0].content).toMatchSnapshot();
  });

  it("uses idiomatic PowerShell guards", () => {
    const result = generatePowerShell(firstCutGraph);
    if (!result.ok) throw new Error("expected ok");
    const content = result.files[0].content;
    expect(content).toContain("Set-StrictMode -Version Latest");
    expect(content).toContain("$ErrorActionPreference = 'Stop'");
    expect(content).toContain("SupportsShouldProcess");
    expect(content).not.toContain("Write-Host");
  });

  it("deploys private full-stack resources atomically through ARM", () => {
    const result = generatePowerShell({
      ...fullStackGraph,
      nodes: fullStackGraph.nodes.filter((node) => node.id !== "nsg"),
      edges: fullStackGraph.edges.filter((edge) => edge.source !== "nsg" && edge.target !== "nsg"),
    });
    if (!result.ok) throw new Error("expected ok");
    const content = result.files[0].content;
    expect(content).toContain("New-AzResourceGroupDeployment");
    expect(content).not.toContain("New-AzWebApp");
    const template = result.files.find((file) => file.path === "azuredeploy.json");
    expect(template).toBeDefined();
    const sites = JSON.parse(template!.content).resources.filter((resource: { type: string }) => resource.type === "Microsoft.Web/sites");
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) expect(site.properties.publicNetworkAccess).toBe("Disabled");
  });
});
