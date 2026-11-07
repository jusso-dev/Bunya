import { migrate } from "../lib/graph/migrate";
import { z } from "zod";
import { canConnect } from "../lib/catalogue/connections";
import { listServices } from "../lib/catalogue/services";
import {
  AzureRegionSchema,
  EdgeKindSchema,
  GraphDocumentSchema,
  ServiceTypeSchema,
  isContainerType,
  type GraphDocument,
} from "../lib/graph/schema";
import { serialiseToFragment, shareUrlFromFragment } from "../lib/graph/serialise";
import { OUTPUT_IDS, OUTPUTS, type OutputId } from "../lib/generators/registry";
import type { GeneratedFile } from "../lib/generators/types";
import { validate } from "../lib/rules/runtime";
import type { Finding } from "../lib/rules/schema";
import { gridPosition, newNode, slug } from "../lib/session/new-node";

export const DiagramNodeInputSchema = z.object({
  id: z.string().trim().min(1).max(80),
  type: ServiceTypeSchema,
  name: z.string().trim().min(1).max(120).optional(),
  resourceName: z.string().trim().min(1).max(120).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  parentId: z.string().trim().min(1).max(80).nullable().optional(),
});

export const DiagramConnectionInputSchema = z.object({
  source: z.string().trim().min(1).max(80),
  target: z.string().trim().min(1).max(80),
  kind: EdgeKindSchema.optional(),
});

export const CreateDiagramInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).optional(),
  region: AzureRegionSchema.optional(),
  environment: GraphDocumentSchema.shape.metadata.shape.environment.optional(),
  resourceGroupName: z.string().trim().min(1).max(120).optional(),
  nodes: z.array(DiagramNodeInputSchema).min(1).max(100),
  connections: z.array(DiagramConnectionInputSchema).max(250).default([]),
  includeResourceGroup: z.boolean().default(true),
});

export const ExportTargetSchema = z.enum([...OUTPUT_IDS, "all"]);

export const EXPORT_TARGET_DESCRIPTION = `Exports a Bunya graph as ${OUTPUTS.map((output) => output.label).join(", ")}, or "all" for every format. The returned files are ready for the MCP client to save.`;

export type ExportTarget = z.infer<typeof ExportTargetSchema>;
export type CreateDiagramInput = z.input<typeof CreateDiagramInputSchema>;

export type BunyaExport = {
  target: OutputId;
  files: GeneratedFile[];
};

// Every document an MCP client sends goes through the same migration the
// editor uses, so older Bunya files are accepted everywhere.
export function parseDocument(input: unknown): GraphDocument {
  return migrate(input);
}

/**
 * Builds a valid Bunya graph from the explicit plan an MCP client derives from
 * a user's natural-language architecture description.
 */
export function createDiagram(input: CreateDiagramInput): GraphDocument {
  const nodeIds = new Set<string>();
  for (const node of input.nodes) {
    if (nodeIds.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
    nodeIds.add(node.id);
  }

  const resourceGroupName = input.resourceGroupName ?? `rg-${slug(input.name)}`;
  const document: GraphDocument = {
    schemaVersion: 1,
    metadata: {
      name: input.name,
      description: input.description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      region: input.region ?? "australiaeast",
      environment: input.environment ?? "dev",
      resourceGroupName,
    },
    nodes: [],
    edges: [],
  };

  for (const [index, { id, ...plan }] of input.nodes.entries()) {
    try {
      document.nodes.push({ id, ...newNode(document, { ...plan, position: gridPosition(index) }) });
    } catch (error) {
      throw new Error(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const hasResourceGroup = input.nodes.some((node) => node.type === "resourceGroup");
  if ((input.includeResourceGroup ?? true) && !hasResourceGroup) {
    document.nodes.unshift({
      id: "resource-group",
      ...newNode(document, { type: "resourceGroup", name: "Resource Group", resourceName: resourceGroupName, position: { x: 0, y: 0 } }),
    });
  }
  const nodes = document.nodes;

  for (const node of nodes) {
    if (!node.parentId) continue;
    const parent = nodes.find((candidate) => candidate.id === node.parentId);
    if (!parent) throw new Error(`Node ${node.id} refers to missing parent ${node.parentId}.`);
    if (!isContainerType(parent.type)) {
      throw new Error(`Node ${node.id} parent ${node.parentId} is not a container.`);
    }
  }

  for (const [index, connection] of (input.connections ?? []).entries()) {
    const result = canConnect(document, connection.source, connection.target, connection.kind);
    if (!result.ok) {
      throw new Error(`Invalid connection ${connection.source} -> ${connection.target}: ${result.reason}`);
    }
    document.edges.push({
      id: `edge-${index + 1}`,
      source: connection.source,
      target: connection.target,
      kind: result.kind,
    });
  }

  return GraphDocumentSchema.parse(document);
}

export async function diagramViewUrl(document: GraphDocument, appUrl?: string): Promise<string> {
  const fragment = await serialiseToFragment(document);
  return shareUrlFromFragment(fragment, appUrl ?? process.env.BUNYA_APP_URL ?? "http://localhost:3000/");
}

export function validationSummary(document: GraphDocument): Finding[] {
  return validate(document);
}

export function exportDiagram(document: GraphDocument, target: ExportTarget): BunyaExport[] {
  const outputs = target === "all" ? OUTPUTS : OUTPUTS.filter((output) => output.id === target);
  return outputs.map((output) => {
    const result = output.generate(document, {});
    if (!result.ok) {
      throw new Error(`${output.id} generation failed: ${result.reason}${result.cycle ? ` (${result.cycle.join(" -> ")})` : ""}`);
    }
    return { target: output.id, files: result.files };
  });
}

export function describeServices() {
  return listServices().map((service) => ({
    type: service.type,
    label: service.label,
    category: service.category,
    description: service.description,
    defaultProperties: service.defaultProperties,
    allowedEdgeTargets: service.allowedEdgeTargets,
    allowedOutgoingKinds: service.allowedOutgoingKinds,
  }));
}
