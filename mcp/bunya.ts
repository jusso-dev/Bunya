import { z } from "zod";
import { canConnect } from "../lib/catalogue/connections";
import { getServiceDefinition, listServices } from "../lib/catalogue/services";
import {
  DEFAULT_CONTAINER_SIZE,
  EdgeKindSchema,
  GraphDocumentSchema,
  ServiceTypeSchema,
  type GraphDocument,
  type GraphNode,
  type ServiceType,
} from "../lib/graph/schema";
import { serialiseToFragment, shareUrlFromFragment } from "../lib/graph/serialise";
import { generateArm } from "../lib/generators/arm";
import { generateAzCli } from "../lib/generators/azcli";
import { generateBicep } from "../lib/generators/bicep";
import { generateMermaid } from "../lib/generators/mermaid";
import { generatePowerShell } from "../lib/generators/powershell";
import { generateReadme } from "../lib/generators/readme";
import { generateTerraform } from "../lib/generators/terraform";
import type { GeneratedFile, GeneratorResult } from "../lib/generators/types";
import { runValidation, type Finding } from "../lib/validation/runner";

const environmentSchema = z.enum(["dev", "test", "prod"]);
const regionSchema = z.enum([
  "australiaeast",
  "australiasoutheast",
  "australiacentral",
  "australiacentral2",
]);

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
  region: regionSchema.optional(),
  environment: environmentSchema.optional(),
  resourceGroupName: z.string().trim().min(1).max(120).optional(),
  nodes: z.array(DiagramNodeInputSchema).min(1).max(100),
  connections: z.array(DiagramConnectionInputSchema).max(250).default([]),
  includeResourceGroup: z.boolean().default(true),
});

export const ExportTargetSchema = z.enum([
  "terraform",
  "bicep",
  "arm",
  "azcli",
  "powershell",
  "mermaid",
  "readme",
  "all",
]);

export type ExportTarget = z.infer<typeof ExportTargetSchema>;
export type CreateDiagramInput = z.input<typeof CreateDiagramInputSchema>;

export type BunyaExport = {
  target: Exclude<ExportTarget, "all">;
  files: GeneratedFile[];
};

const RESOURCE_PREFIX: Record<ServiceType, string> = {
  resourceGroup: "rg",
  virtualNetwork: "vnet",
  subnet: "snet",
  networkSecurityGroup: "nsg",
  privateEndpoint: "pe",
  privateDnsZone: "dns",
  appServicePlan: "plan",
  appService: "app",
  functionApp: "func",
  staticWebApp: "swa",
  aksCluster: "aks",
  virtualMachineScaleSet: "vmss",
  storageAccount: "st",
  sqlDatabase: "sql",
  cosmosDb: "cosmos",
  keyVault: "kv",
  applicationInsights: "appi",
  logAnalytics: "log",
  monitorAlert: "alert",
  actionGroup: "ag",
  frontDoor: "fd",
  applicationGateway: "agw",
  apiManagement: "apim",
  containerRegistry: "acr",
  userAssignedIdentity: "id",
  roleAssignment: "rbac",
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workload";
}

function defaultResourceName(type: ServiceType, name: string): string {
  const definition = getServiceDefinition(type);
  const prefix = RESOURCE_PREFIX[type];
  const suffix = slug(name);
  if (definition.azureNamePattern === "lowercase-alphanum-global") {
    return `${prefix}${suffix.replace(/-/g, "")}`.slice(0, 24);
  }
  return `${prefix}-${suffix}`.slice(0, 120);
}

function defaultNodeName(type: ServiceType): string {
  return getServiceDefinition(type).label;
}

function defaultPosition(index: number): { x: number; y: number } {
  return { x: 180 + (index % 4) * 240, y: 80 + Math.floor(index / 4) * 170 };
}

function nodeFromInput(
  input: z.infer<typeof DiagramNodeInputSchema>,
  index: number,
): GraphNode {
  const name = input.name ?? defaultNodeName(input.type);
  const definition = getServiceDefinition(input.type);
  const properties = definition.propertiesSchema.safeParse({
    ...definition.defaultProperties,
    ...input.properties,
  });
  if (!properties.success) {
    throw new Error(`Invalid properties for ${input.id} (${definition.label}): ${properties.error.message}`);
  }

  const node: GraphNode = {
    id: input.id,
    type: input.type,
    name,
    resourceName: input.resourceName ?? defaultResourceName(input.type, name),
    position: defaultPosition(index),
    properties: properties.data as Record<string, unknown>,
    parentId: input.parentId,
  };
  if (input.type in DEFAULT_CONTAINER_SIZE) {
    node.size = DEFAULT_CONTAINER_SIZE[input.type as keyof typeof DEFAULT_CONTAINER_SIZE];
  }
  return node;
}

function resourceGroupNode(input: CreateDiagramInput): GraphNode {
  const name = "Resource Group";
  const definition = getServiceDefinition("resourceGroup");
  return {
    id: "resource-group",
    type: "resourceGroup",
    name,
    resourceName: input.resourceGroupName ?? `rg-${slug(input.name)}`,
    position: { x: 0, y: 0 },
    properties: definition.defaultProperties,
    size: DEFAULT_CONTAINER_SIZE.resourceGroup,
  };
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

  const hasResourceGroup = input.nodes.some((node) => node.type === "resourceGroup");
  const nodes = input.nodes.map(nodeFromInput);
  if ((input.includeResourceGroup ?? true) && !hasResourceGroup) nodes.unshift(resourceGroupNode(input));

  const document: GraphDocument = {
    schemaVersion: 1,
    metadata: {
      name: input.name,
      description: input.description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      region: input.region ?? "australiaeast",
      environment: input.environment ?? "dev",
      resourceGroupName: input.resourceGroupName ?? `rg-${slug(input.name)}`,
    },
    nodes,
    edges: [],
  };

  for (const node of nodes) {
    if (!node.parentId) continue;
    const parent = nodes.find((candidate) => candidate.id === node.parentId);
    if (!parent) throw new Error(`Node ${node.id} refers to missing parent ${node.parentId}.`);
    if (!(parent.type in DEFAULT_CONTAINER_SIZE)) {
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
  return runValidation(document);
}

const generators: Record<Exclude<ExportTarget, "all">, (document: GraphDocument) => GeneratorResult> = {
  terraform: generateTerraform,
  bicep: generateBicep,
  arm: generateArm,
  azcli: generateAzCli,
  powershell: generatePowerShell,
  mermaid: generateMermaid,
  readme: generateReadme,
};

export function exportDiagram(document: GraphDocument, target: ExportTarget): BunyaExport[] {
  const targets = target === "all" ? Object.keys(generators) as Exclude<ExportTarget, "all">[] : [target];
  return targets.map((currentTarget) => {
    const result = generators[currentTarget](document);
    if (!result.ok) {
      throw new Error(`${currentTarget} generation failed: ${result.reason}${result.cycle ? ` (${result.cycle.join(" -> ")})` : ""}`);
    }
    return { target: currentTarget, files: result.files };
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
