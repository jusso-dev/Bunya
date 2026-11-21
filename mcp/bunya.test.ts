import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDiagram, diagramViewUrl, exportDiagram, parseDocument } from "./bunya";
import { createBunyaMcpServer } from "./create-server";

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
    expect(exports.find((result) => result.target === "azurePolicy")?.files.map((file) => file.path))
      .toContain("initiative.definitions.json");
    // Clients may save every file into one folder, so paths must not collide.
    const paths = exports.flatMap((result) => result.files.map((file) => file.path));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("makes a Bunya view URL carrying the graph fragment", async () => {
    const url = await diagramViewUrl(createDiagram(input), "https://bunya.example/");
    expect(url).toMatch(/^https:\/\/bunya\.example\/#bunya1:/);
  });
});

describe("Bunya MCP document input", () => {
  it("migrates older documents before exporting, as validation does", () => {
    // Older imported storage accounts have no publicNetworkAccess; migration
    // keeps Azure's default (open), while the schema default would close it.
    const document = createDiagram({ name: "legacy", nodes: [{ id: "arm-node-st", type: "storageAccount" }] });
    const older = structuredClone(document);
    for (const node of older.nodes) delete node.properties.publicNetworkAccess;
    const main = exportDiagram(parseDocument(older), "bicep")[0].files.find((file) => file.path === "main.bicep")!;
    expect(main.content).toMatch(/publicNetworkAccess: 'Enabled'/);
  });

  it("rejects input that is not a Bunya document", () => {
    expect(() => parseDocument({ nodes: [] })).toThrow();
  });
});

describe("Bunya MCP tools through the SDK", () => {
  async function connect() {
    const server = createBunyaMcpServer();
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, close: async () => { await client.close(); await server.close(); } };
  }
  const payload = (result: Awaited<ReturnType<Client["callTool"]>>) => {
    const [first] = result.content as Array<{ type: string; text: string }>;
    return JSON.parse(first.text) as Record<string, unknown>;
  };

  it("creates, validates and exports a small diagram, validating tool input with Zod", async () => {
    const { client, close } = await connect();
    try {
      const tools = (await client.listTools()).tools.map((tool) => tool.name);
      expect(tools).toEqual(expect.arrayContaining(["bunya_create_diagram", "bunya_validate_diagram", "bunya_export_iac"]));

      const created = await client.callTool({
        name: "bunya_create_diagram",
        arguments: { name: "sdk-check", nodes: [{ id: "store", type: "storageAccount", name: "Assets" }] },
      });
      expect(created.isError).toBeFalsy();
      const { document } = payload(created) as { document: { nodes: Array<{ id: string }> } };
      expect(document.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["store", "resource-group"]));

      const validated = payload(await client.callTool({ name: "bunya_validate_diagram", arguments: { document } }));
      expect(Array.isArray(validated.findings)).toBe(true);

      const exported = payload(await client.callTool({ name: "bunya_export_iac", arguments: { document, target: "arm" } })) as { exports: Array<{ files: Array<{ path: string }> }> };
      expect(exported.exports[0].files.map((file) => file.path)).toContain("azuredeploy.json");

      // The SDK rejects an unknown export target before the handler runs.
      const rejected = await client.callTool({ name: "bunya_export_iac", arguments: { document, target: "not-a-format" } }).then(
        (result) => ({ failed: result.isError === true }),
        () => ({ failed: true }),
      );
      expect(rejected.failed).toBe(true);
    } finally {
      await close();
    }
  });

  it("reserves explicit and edge-linked subnet prefixes before allocating defaults", () => {
    const doc = createDiagram({
      name: "subnet-alloc",
      nodes: [
        { id: "snet-auto", type: "subnet", name: "Auto", parentId: "vnet" },
        { id: "snet-explicit", type: "subnet", name: "Explicit", parentId: "vnet", properties: { addressPrefix: "10.0.0.0/24" } },
        { id: "snet-linked", type: "subnet", name: "Linked", properties: { addressPrefix: "10.0.1.0/24" } },
        { id: "vnet", type: "virtualNetwork", name: "Main VNet", properties: { addressSpace: "10.0.0.0/16" } },
      ],
      connections: [{ source: "snet-linked", target: "vnet", kind: "depends_on" }],
    });
    const autoSubnet = doc.nodes.find((n) => n.id === "snet-auto");
    expect(autoSubnet?.properties.addressPrefix).toBe("10.0.2.0/24");
  });
});
