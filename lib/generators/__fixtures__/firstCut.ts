import { GraphDocument } from "@/lib/graph/schema";
import { getServiceDefinition } from "@/lib/catalogue/services";

const fixedDate = "2026-05-18T00:00:00.000Z";

function fixedNode(
  id: string,
  type: Parameters<typeof getServiceDefinition>[0],
  name: string,
  resourceName: string,
  x: number,
  y: number,
) {
  return {
    id,
    type,
    name,
    resourceName,
    position: { x, y },
    properties: { ...getServiceDefinition(type).defaultProperties },
  };
}

export const firstCutGraph: GraphDocument = {
  schemaVersion: 1,
  metadata: {
    name: "first-cut",
    description: "First cut fixture exercising five service types.",
    createdAt: fixedDate,
    updatedAt: fixedDate,
    region: "australiaeast",
    environment: "dev",
    resourceGroupName: "rg-first-cut",
  },
  nodes: [
    fixedNode("rg", "resourceGroup", "Main RG", "rg-first-cut", 0, 0),
    fixedNode("plan", "appServicePlan", "Web Plan", "plan-first-cut", 200, 0),
    fixedNode("app", "appService", "API Web App", "app-first-cut", 400, 0),
    fixedNode("stg", "storageAccount", "Blob Storage", "first-cut-stg", 600, 0),
    fixedNode("kv", "keyVault", "Secrets Vault", "kv-first-cut", 800, 0),
  ],
  edges: [
    { id: "e1", source: "app", target: "plan", kind: "depends_on" },
    { id: "e2", source: "app", target: "stg", kind: "data" },
    { id: "e3", source: "app", target: "kv", kind: "identity" },
  ],
};
