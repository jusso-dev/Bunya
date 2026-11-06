import { getServiceDefinition } from "@/lib/catalogue/services";
import type { GraphDocument, GraphNode, ServiceType } from "@/lib/graph/schema";

function n(id: string, type: ServiceType, resourceName: string, parentId: string | null, properties: Record<string, unknown> = {}): GraphNode {
  return {
    id,
    type,
    name: getServiceDefinition(type).label,
    resourceName,
    parentId,
    position: { x: 0, y: 0 },
    properties: { ...getServiceDefinition(type).defaultProperties, ...properties },
  };
}

// One of each hosting shape the exporters must emit: Flex Consumption with
// VNet integration and App Insights, Linux Consumption, Elastic Premium with a
// container image pulled through a user-assigned identity, and a dedicated
// web app running a container pulled with its system identity.
export const hostingGraph: GraphDocument = {
  schemaVersion: 1,
  metadata: {
    name: "hosting",
    description: "Fixture covering every App Service hosting model.",
    createdAt: "2026-11-06T00:00:00.000Z",
    updatedAt: "2026-11-06T00:00:00.000Z",
    region: "australiaeast",
    environment: "dev",
    resourceGroupName: "rg-hosting",
  },
  nodes: [
    n("rg", "resourceGroup", "rg-hosting", null),
    n("vnet", "virtualNetwork", "vnet-hosting", "rg", { addressSpace: "10.20.0.0/16" }),
    n("snet-flex", "subnet", "snet-flex", "vnet", { addressPrefix: "10.20.1.0/24" }),
    n("snet-web", "subnet", "snet-web", "vnet", { addressPrefix: "10.20.2.0/24" }),
    n("la", "logAnalytics", "log-hosting", "rg"),
    n("ai", "applicationInsights", "appi-hosting", "rg"),
    n("stg", "storageAccount", "sthosting", "rg"),
    n("acr", "containerRegistry", "acrhosting", "rg"),
    n("umi", "userAssignedIdentity", "id-pull", "rg"),
    n("plan-flex", "appServicePlan", "plan-flex", "rg", { sku: "FC1", capacity: 0 }),
    n("fn-flex", "functionApp", "fn-flex", "plan-flex", { runtime: "python", runtimeVersion: "3.11", instanceMemoryMB: 4096, maximumInstanceCount: 40, vnetIntegration: true }),
    n("plan-y1", "appServicePlan", "plan-y1", "rg", { sku: "Y1", capacity: 0 }),
    n("fn-y1", "functionApp", "fn-y1", "plan-y1", { runtime: "node", runtimeVersion: "20" }),
    n("plan-ep", "appServicePlan", "plan-ep", "rg", { sku: "EP1" }),
    n("fn-ep", "functionApp", "fn-ep", "plan-ep", { containerImage: "acrhosting.azurecr.io/worker:2.0", consumptionPlan: false }),
    n("plan-web", "appServicePlan", "plan-web", "rg", { sku: "P0v3", capacity: 2 }),
    n("web", "appService", "app-hosting", "plan-web", { containerImage: "acrhosting.azurecr.io/api:1.4", vnetIntegration: true }),
  ],
  edges: [
    { id: "ai-la", source: "ai", target: "la", kind: "depends_on" },
    { id: "flex-snet", source: "fn-flex", target: "snet-flex", kind: "network" },
    { id: "flex-ai", source: "fn-flex", target: "ai", kind: "diagnostic" },
    { id: "flex-stg", source: "fn-flex", target: "stg", kind: "data" },
    { id: "y1-stg", source: "fn-y1", target: "stg", kind: "data" },
    { id: "ep-stg", source: "fn-ep", target: "stg", kind: "data" },
    { id: "ep-umi", source: "fn-ep", target: "umi", kind: "identity" },
    { id: "umi-acr", source: "umi", target: "acr", kind: "identity" },
    { id: "web-acr", source: "web", target: "acr", kind: "identity" },
    { id: "web-snet", source: "web", target: "snet-web", kind: "network" },
    { id: "web-ai", source: "web", target: "ai", kind: "diagnostic" },
  ],
};
