import { GraphDocument, ServiceType } from "@/lib/graph/schema";
import { getServiceDefinition } from "./services";

const epoch = "2026-01-01T00:00:00.000Z";

function buildNode(
  id: string,
  type: ServiceType,
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

export type StarterTemplate = {
  id: string;
  label: string;
  description: string;
  document: GraphDocument;
};

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "static-with-api",
    label: "Static web app with API",
    description: "Static Web App + Function App on consumption + Storage + Application Insights.",
    document: {
      schemaVersion: 1,
      metadata: {
        name: "static-with-api",
        description: "Static SPA backed by serverless Functions.",
        createdAt: epoch,
        updatedAt: epoch,
        region: "australiaeast",
        environment: "dev",
        resourceGroupName: "rg-static-with-api",
      },
      nodes: [
        buildNode("rg", "resourceGroup", "Resource Group", "rg-static-with-api", 0, 0),
        buildNode("swa", "staticWebApp", "Portal", "swa-static", 200, 0),
        buildNode("fn", "functionApp", "API", "fn-static-api", 400, 0),
        buildNode("stg", "storageAccount", "API Storage", "staticapistg", 600, 100),
        buildNode("ai", "applicationInsights", "Telemetry", "ai-static", 600, -100),
        buildNode("la", "logAnalytics", "Workspace", "log-static", 800, -100),
      ],
      edges: [
        { id: "e1", source: "swa", target: "fn", kind: "depends_on" },
        { id: "e2", source: "fn", target: "stg", kind: "data" },
        { id: "e3", source: "fn", target: "ai", kind: "diagnostic" },
        { id: "e4", source: "ai", target: "la", kind: "depends_on" },
      ],
    },
  },
  {
    id: "three-tier",
    label: "Three-tier web app",
    description: "App Service + SQL Database + Storage behind Private Endpoints.",
    document: {
      schemaVersion: 1,
      metadata: {
        name: "three-tier",
        description: "Classic three-tier app on private networking.",
        createdAt: epoch,
        updatedAt: epoch,
        region: "australiaeast",
        environment: "prod",
        resourceGroupName: "rg-three-tier",
      },
      nodes: [
        buildNode("rg", "resourceGroup", "Resource Group", "rg-three-tier", 0, 0),
        buildNode("vnet", "virtualNetwork", "VNet", "vnet-three-tier", 200, 0),
        buildNode("snet-app", "subnet", "App Subnet", "snet-app", 400, -80),
        buildNode("snet-pe", "subnet", "PE Subnet", "snet-pe", 400, 80),
        buildNode("plan", "appServicePlan", "Plan", "plan-three-tier", 600, -200),
        buildNode("app", "appService", "Web", "app-three-tier", 800, -200),
        buildNode("kv", "keyVault", "Secrets", "kv-three-tier", 1000, -200),
        buildNode("stg", "storageAccount", "Assets", "threetierstg", 1000, 0),
        buildNode("sql", "sqlDatabase", "AppDB", "sqldb-three-tier", 1000, 200),
        buildNode("pe-stg", "privateEndpoint", "Stg PE", "pe-stg", 600, 0),
        buildNode("pe-sql", "privateEndpoint", "SQL PE", "pe-sql", 600, 200),
        buildNode("la", "logAnalytics", "Workspace", "log-three-tier", 1200, 200),
      ],
      edges: [
        { id: "snet-app-vnet", source: "snet-app", target: "vnet", kind: "depends_on" },
        { id: "snet-pe-vnet", source: "snet-pe", target: "vnet", kind: "depends_on" },
        { id: "app-plan", source: "app", target: "plan", kind: "depends_on" },
        { id: "app-snet", source: "app", target: "snet-app", kind: "network" },
        { id: "app-kv", source: "app", target: "kv", kind: "identity" },
        { id: "app-stg", source: "app", target: "stg", kind: "data" },
        { id: "app-sql", source: "app", target: "sql", kind: "data" },
        { id: "pe-stg-snet", source: "pe-stg", target: "snet-pe", kind: "network" },
        { id: "pe-stg-target", source: "pe-stg", target: "stg", kind: "network" },
        { id: "pe-sql-snet", source: "pe-sql", target: "snet-pe", kind: "network" },
        { id: "pe-sql-target", source: "pe-sql", target: "sql", kind: "network" },
        { id: "app-la", source: "app", target: "la", kind: "diagnostic" },
        { id: "stg-la", source: "stg", target: "la", kind: "diagnostic" },
        { id: "kv-la", source: "kv", target: "la", kind: "diagnostic" },
        { id: "sql-la", source: "sql", target: "la", kind: "diagnostic" },
      ],
    },
  },
  {
    id: "event-driven",
    label: "Event-driven Functions",
    description: "Function App + Storage + Cosmos DB + Application Insights pipeline.",
    document: {
      schemaVersion: 1,
      metadata: {
        name: "event-driven",
        description: "Event ingestion into Cosmos via Functions.",
        createdAt: epoch,
        updatedAt: epoch,
        region: "australiaeast",
        environment: "dev",
        resourceGroupName: "rg-event-driven",
      },
      nodes: [
        buildNode("rg", "resourceGroup", "Resource Group", "rg-event-driven", 0, 0),
        buildNode("plan", "appServicePlan", "Consumption", "plan-event-driven", 200, 0),
        buildNode("fn", "functionApp", "Ingest", "fn-event-driven", 400, 0),
        buildNode("stg", "storageAccount", "Function Storage", "eventdrivenstg", 600, 100),
        buildNode("cos", "cosmosDb", "Documents", "cos-event-driven", 600, -100),
        buildNode("ai", "applicationInsights", "Telemetry", "ai-event-driven", 800, -100),
        buildNode("la", "logAnalytics", "Workspace", "log-event-driven", 1000, -100),
        buildNode("kv", "keyVault", "Secrets", "kv-event-driven", 800, 100),
      ],
      edges: [
        { id: "fn-plan", source: "fn", target: "plan", kind: "depends_on" },
        { id: "fn-stg", source: "fn", target: "stg", kind: "data" },
        { id: "fn-cos", source: "fn", target: "cos", kind: "data" },
        { id: "fn-ai", source: "fn", target: "ai", kind: "diagnostic" },
        { id: "fn-kv", source: "fn", target: "kv", kind: "identity" },
        { id: "ai-la", source: "ai", target: "la", kind: "depends_on" },
      ],
    },
  },
];

export function getTemplateById(id: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.id === id);
}
