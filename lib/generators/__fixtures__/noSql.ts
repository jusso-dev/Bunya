import { GraphDocument, ServiceType } from "@/lib/graph/schema";
import { getServiceDefinition } from "@/lib/catalogue/services";

const fixedDate = "2026-05-19T00:00:00.000Z";

function fixedNode(
  id: string,
  type: ServiceType,
  name: string,
  resourceName: string,
  x: number,
  y: number,
  parentId?: string,
) {
  return {
    id,
    type,
    name,
    resourceName,
    position: { x, y },
    properties: { ...getServiceDefinition(type).defaultProperties },
    parentId: parentId ?? null,
  };
}

export const noSqlGraph: GraphDocument = {
  schemaVersion: 1,
  metadata: {
    name: "no-sql",
    description: "Graph deliberately without any SQL resources to verify conditional params.",
    createdAt: fixedDate,
    updatedAt: fixedDate,
    region: "australiaeast",
    environment: "dev",
    resourceGroupName: "rg-no-sql",
  },
  nodes: [
    fixedNode("rg", "resourceGroup", "Resource Group", "rg-no-sql", 0, 0),
    fixedNode("plan", "appServicePlan", "Plan", "plan-no-sql", 200, 0, "rg"),
    fixedNode("app", "appService", "Web", "app-no-sql", 400, 0, "rg"),
    fixedNode("stg", "storageAccount", "Storage", "nosqlstg", 600, 0, "rg"),
  ],
  edges: [
    { id: "app-plan", source: "app", target: "plan", kind: "depends_on" },
    { id: "app-stg", source: "app", target: "stg", kind: "data" },
  ],
};
