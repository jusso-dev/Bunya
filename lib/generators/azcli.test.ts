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

  it("deploys private full-stack resources atomically through ARM", () => {
    const result = generateAzCli({
      ...fullStackGraph,
      nodes: fullStackGraph.nodes.filter((node) => node.id !== "nsg"),
      edges: fullStackGraph.edges.filter((edge) => edge.source !== "nsg" && edge.target !== "nsg"),
    });
    if (!result.ok) throw new Error("expected ok");
    const script = result.files[0].content;
    expect(script).toContain("az deployment group create");
    expect(script).not.toContain("az functionapp create");
    const template = result.files.find((file) => file.path === "azuredeploy.json");
    expect(template).toBeDefined();
    const sites = JSON.parse(template!.content).resources.filter((resource: { type: string }) => resource.type === "Microsoft.Web/sites");
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) expect(site.properties.publicNetworkAccess).toBe("Disabled");
  });
});
