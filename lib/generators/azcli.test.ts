import { describe, expect, it } from "vitest";
import { generateAzCli } from "./azcli";
import { firstCutGraph } from "./__fixtures__/firstCut";
import { fullStackGraph } from "./__fixtures__/fullStack";

describe("generateAzCli", () => {
  it("emits deploy.sh and snapshots first-cut output", () => {
    const result = generateAzCli(firstCutGraph);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files[0].path).toBe("deploy.sh");
    expect(result.files[0].content).toMatchSnapshot();
  });

  it("uses --only-show-errors throughout", () => {
    const result = generateAzCli(firstCutGraph);
    if (!result.ok) throw new Error("expected ok");
    expect(result.files[0].content).toContain("--only-show-errors");
  });

  it("invokes every required az command for the full-stack fixture", () => {
    const result = generateAzCli(fullStackGraph);
    if (!result.ok) throw new Error("expected ok");
    const script = result.files[0].content;
    for (const cmd of [
      "az group create",
      "az network vnet create",
      "az network vnet subnet create",
      "az network nsg create",
      "az network private-endpoint create",
      "az appservice plan create",
      "az webapp create",
      "az functionapp create",
      "az staticwebapp create",
      "az storage account create",
      "az sql server create",
      "az cosmosdb create",
      "az keyvault create",
      "az monitor app-insights component create",
      "az monitor log-analytics workspace create",
      "az afd profile create",
      "az network application-gateway create",
      "az apim create",
      "az acr create",
      "az identity create",
    ]) {
      expect(script).toContain(cmd);
    }
  });
});
