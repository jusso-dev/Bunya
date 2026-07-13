import { describe, expect, it } from "vitest";
import { createDiagram, diagramViewUrl, exportDiagram } from "./bunya";

describe("Bunya MCP diagram core", () => {
  const input = {
    name: "portal-api",
    description: "A web app reads secrets and data from a private backend.",
    environment: "prod" as const,
    nodes: [
      { id: "plan", type: "appServicePlan" as const, name: "Production plan" },
      { id: "web", type: "appService" as const, name: "Portal" },
      { id: "storage", type: "storageAccount" as const, name: "Portal assets" },
      { id: "vault", type: "keyVault" as const, name: "Portal secrets" },
    ],
    connections: [
      { source: "web", target: "plan" },
      { source: "web", target: "storage" },
      { source: "web", target: "vault" },
    ],
  };

  it("creates a graph with defaults, inferred edges, and an implicit resource group", () => {
    const document = createDiagram(input);

    expect(document.nodes.map((node) => node.id)).toContain("resource-group");
    expect(document.nodes.find((node) => node.id === "web")?.properties).toMatchObject({
      runtime: "node",
      httpsOnly: true,
    });
    expect(document.edges.map((edge) => edge.kind)).toEqual(["depends_on", "data", "identity"]);
  });

  it("rejects topology that Bunya does not support", () => {
    expect(() => createDiagram({
      ...input,
      connections: [{ source: "storage", target: "web" }],
    })).toThrow("cannot connect");
  });

  it("exports Terraform, Bicep, and ARM from the created graph", () => {
    const document = createDiagram(input);
    const exports = exportDiagram(document, "all");

    expect(exports.find((result) => result.target === "terraform")?.files.map((file) => file.path))
      .toContain("main.tf");
    expect(exports.find((result) => result.target === "bicep")?.files.map((file) => file.path))
      .toContain("main.bicep");
    expect(exports.find((result) => result.target === "arm")?.files.map((file) => file.path))
      .toContain("azuredeploy.json");
  });

  it("makes a Bunya view URL carrying the graph fragment", async () => {
    const url = await diagramViewUrl(createDiagram(input), "https://bunya.example/");
    expect(url).toMatch(/^https:\/\/bunya\.example\/#bunya1:/);
  });
});
