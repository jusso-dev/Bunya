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
  "appServicePlan",
  "appService",
  "functionApp",
  "staticWebApp",
  "storageAccount",
  "sqlDatabase",
  "cosmosDb",
  "keyVault",
  "applicationInsights",
  "logAnalytics",
  "frontDoor",
  "applicationGateway",
  "apiManagement",
  "containerRegistry",
  "userAssignedIdentity",
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
  id: z.string().min(1),
  type: ServiceTypeSchema,
  position: z.object({ x: z.number(), y: z.number() }),
  name: z.string().min(1),
  resourceName: z.string().min(1),
  properties: z.record(z.string(), z.unknown()),
});

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  kind: EdgeKindSchema,
});

export const GraphMetadataSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  region: AzureRegionSchema,
  environment: z.enum(["dev", "test", "prod"]),
  resourceGroupName: z.string().min(1),
});

export const GraphDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  metadata: GraphMetadataSchema,
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
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
