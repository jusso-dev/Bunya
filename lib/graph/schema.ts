import { z } from "zod";

export const AZURE_REGIONS = [
  "australiaeast",
  "australiasoutheast",
  "australiacentral",
  "australiacentral2",
] as const;

export const SERVICE_TYPES = [
  "resourceGroup",
  "virtualNetwork",
  "subnet",
  "networkSecurityGroup",
  "privateEndpoint",
  "privateDnsZone",
  "appServicePlan",
  "appService",
  "functionApp",
  "staticWebApp",
  "aksCluster",
  "virtualMachineScaleSet",
  "storageAccount",
  "sqlDatabase",
  "cosmosDb",
  "keyVault",
  "applicationInsights",
  "logAnalytics",
  "monitorAlert",
  "actionGroup",
  "frontDoor",
  "applicationGateway",
  "apiManagement",
  "containerRegistry",
  "userAssignedIdentity",
  "roleAssignment",
] as const;

export const EDGE_KINDS = [
  "network",
  "identity",
  "data",
  "depends_on",
  "diagnostic",
] as const;

export const AzureRegionSchema = z.enum(AZURE_REGIONS);
export const ServiceTypeSchema = z.enum(SERVICE_TYPES);
export const EdgeKindSchema = z.enum(EDGE_KINDS);

export const GraphNodeSchema = z.object({
  id: z.string().min(1).max(256),
  type: ServiceTypeSchema,
  position: z.object({ x: z.number(), y: z.number() }),
  name: z.string().min(1).max(256),
  resourceName: z.string().min(1).max(256),
  properties: z.record(z.string(), z.unknown()),
  parentId: z.string().nullable().optional(),
  size: z.object({ width: z.number(), height: z.number() }).optional(),
});

export const CONTAINER_SERVICE_TYPES = ["resourceGroup", "virtualNetwork", "appServicePlan"] as const;
export type ContainerServiceType = (typeof CONTAINER_SERVICE_TYPES)[number];

export function isContainerType(type: ServiceType): type is ContainerServiceType {
  return (CONTAINER_SERVICE_TYPES as readonly ServiceType[]).includes(type);
}

export const DEFAULT_CONTAINER_SIZE: Record<ContainerServiceType, { width: number; height: number }> = {
  resourceGroup: { width: 720, height: 480 },
  virtualNetwork: { width: 520, height: 360 },
  appServicePlan: { width: 460, height: 300 },
};

export const GraphEdgeSchema = z.object({
  id: z.string().min(1).max(256),
  source: z.string().min(1).max(256),
  target: z.string().min(1).max(256),
  kind: EdgeKindSchema,
});

export const GraphMetadataSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(10000).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  region: AzureRegionSchema,
  environment: z.enum(["dev", "test", "prod"]),
  resourceGroupName: z.string().min(1).max(256),
});

export const GraphDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  metadata: GraphMetadataSchema,
  nodes: z.array(GraphNodeSchema).max(200),
  edges: z.array(GraphEdgeSchema).max(1000),
}).superRefine((doc, ctx) => {
  const nodes = new Map(doc.nodes.map((node) => [node.id, node]));
  const problem = (message: string) => ctx.addIssue({ code: "custom", message });
  if (nodes.size !== doc.nodes.length) problem("Node IDs must be unique.");
  if (new Set(doc.edges.map((edge) => edge.id)).size !== doc.edges.length) problem("Edge IDs must be unique.");
  for (const node of doc.nodes) {
    const seen = new Set<string>([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (seen.has(parentId)) { problem("Container parent cycle detected."); break; }
      seen.add(parentId);
      const parent = nodes.get(parentId);
      if (!parent || !isContainerType(parent.type)) { problem("Parent must reference an existing container."); break; }
      parentId = parent.parentId;
    }
  }
  for (const edge of doc.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) problem("Edges must reference existing nodes.");
  }
});

export type AzureRegion = z.infer<typeof AzureRegionSchema>;
export type ServiceType = z.infer<typeof ServiceTypeSchema>;
export type EdgeKind = z.infer<typeof EdgeKindSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type GraphMetadata = z.infer<typeof GraphMetadataSchema>;
export type GraphDocument = z.infer<typeof GraphDocumentSchema>;

export function emptyGraph(name = "untitled"): GraphDocument {
  const now = new Date(0).toISOString();
  return {
    schemaVersion: 1,
    metadata: {
      name,
      createdAt: now,
      updatedAt: now,
      region: "australiaeast",
      environment: "dev",
      resourceGroupName: `rg-${name}`,
    },
    nodes: [],
    edges: [],
  };
}
