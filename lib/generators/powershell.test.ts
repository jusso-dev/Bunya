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

  it("invokes Az cmdlets for every resource in the full-stack fixture", () => {
    const result = generatePowerShell(fullStackGraph);
    if (!result.ok) throw new Error("expected ok");
    const content = result.files[0].content;
    for (const cmd of [
      "New-AzResourceGroup",
      "New-AzVirtualNetwork",
      "Add-AzVirtualNetworkSubnetConfig",
      "New-AzNetworkSecurityGroup",
      "New-AzAppServicePlan",
      "New-AzWebApp",
      "New-AzFunctionApp",
      "New-AzStaticWebApp",
      "New-AzStorageAccount",
      "New-AzSqlServer",
      "New-AzSqlDatabase",
      "New-AzCosmosDBAccount",
      "New-AzKeyVault",
      "New-AzApplicationInsights",
      "New-AzOperationalInsightsWorkspace",
      "New-AzFrontDoorCdnProfile",
      "New-AzApiManagement",
      "New-AzContainerRegistry",
      "New-AzUserAssignedIdentity",
    ]) {
      expect(content).toContain(cmd);
    }
  });
});
