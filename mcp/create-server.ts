import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CreateDiagramInputSchema,
  ExportTargetSchema,
  createDiagram,
  describeServices,
  diagramViewUrl,
  exportDiagram,
  validationSummary,
} from "./bunya";
import { GraphDocumentSchema } from "../lib/graph/schema";

function jsonContent(value: unknown) {
  return [{ type: "text" as const, text: JSON.stringify(value, null, 2) }];
}

export function createBunyaMcpServer() {
  const server = new McpServer({ name: "bunya", version: "0.1.0" });

  server.registerResource(
    "architecture-authoring-guide",
    "bunya://architecture-authoring-guide",
    {
      title: "Bunya architecture authoring guide",
      description: "Instructions for turning an Azure architecture description into a Bunya diagram.",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [{
        uri: "bunya://architecture-authoring-guide",
        mimeType: "text/markdown",
        text: `# Bunya architecture authoring guide

When a user describes an Azure architecture, translate it into a small, explicit service plan and call \`bunya_create_diagram\`.

- Call \`bunya_list_services\` when you need to check supported services, defaults, or allowed connection directions.
- Give every planned resource a stable, short \`id\`; connections refer to those ids.
- Choose a connection \`kind\` only when it is clear. Otherwise omit it and Bunya infers the valid kind.
- Include the main topology, data flows, identity access, networking, and observability. Bunya adds a Resource Group unless one is planned explicitly.
- Call \`bunya_validate_diagram\` after creation. Explain warnings and errors before exporting production IaC.
- Call \`bunya_export_iac\` with \`terraform\`, \`bicep\`, or \`arm\` to return deployable source files. The create result includes a Bunya URL that displays the diagram.
`,
      }],
    }),
  );

  server.registerTool(
    "bunya_list_services",
    {
      title: "List Bunya Azure services",
      description: "Lists Azure services supported by Bunya, their default properties, and valid outgoing connections.",
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: jsonContent({ services: describeServices() }) }),
  );

  server.registerTool(
    "bunya_create_diagram",
    {
      title: "Create a Bunya architecture diagram",
      description: "Creates a validated Bunya diagram from the explicit service plan inferred from a user's architecture description. Returns the portable graph, Mermaid source, validation findings, and a URL that opens the diagram in Bunya.",
      inputSchema: CreateDiagramInputSchema.shape,
    },
    async (input) => {
      try {
        const document = createDiagram(input);
        const [viewUrl, mermaid] = await Promise.all([
          diagramViewUrl(document),
          Promise.resolve(exportDiagram(document, "mermaid")[0].files[0]?.content ?? ""),
        ]);
        return {
          content: jsonContent({
            document,
            viewUrl,
            mermaid,
            findings: validationSummary(document),
          }),
        };
      } catch (error) {
        return {
          content: jsonContent({ error: error instanceof Error ? error.message : String(error) }),
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "bunya_validate_diagram",
    {
      title: "Validate a Bunya diagram",
      description: "Runs Bunya's Azure architecture and compliance rules against a graph document.",
      inputSchema: { document: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async ({ document }) => {
      const parsed = GraphDocumentSchema.safeParse(document);
      if (!parsed.success) return { content: jsonContent({ error: parsed.error.message }), isError: true };
      const findings = validationSummary(parsed.data);
      return {
        content: jsonContent({
          valid: !findings.some((finding) => finding.severity === "error"),
          findings,
        }),
      };
    },
  );

  server.registerTool(
    "bunya_export_iac",
    {
      title: "Export Bunya infrastructure as code",
      description: "Exports a Bunya graph to Terraform, Bicep, ARM JSON, az CLI, PowerShell, Mermaid, README, or all formats. The returned files are ready for the MCP client to save.",
      inputSchema: { document: z.unknown(), target: ExportTargetSchema },
    },
    async ({ document, target }) => {
      const parsed = GraphDocumentSchema.safeParse(document);
      if (!parsed.success) return { content: jsonContent({ error: parsed.error.message }), isError: true };
      try {
        const exports = exportDiagram(parsed.data, target);
        return {
          content: jsonContent({ target, findings: validationSummary(parsed.data), exports }),
        };
      } catch (error) {
        return {
          content: jsonContent({ error: error instanceof Error ? error.message : String(error) }),
          isError: true,
        };
      }
    },
  );

  return server;
}
