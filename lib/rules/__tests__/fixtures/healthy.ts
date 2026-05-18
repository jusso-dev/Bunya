import type { GraphDocument, GraphEdge, ServiceType } from "@/lib/graph/schema";
import { getServiceDefinition } from "@/lib/catalogue/services";

const fixedDate = "2026-05-18T00:00:00.000Z";

function node(
  id: string,
  type: ServiceType,
  name: string,
  resourceName: string,
  x: number,
  y: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    type,
    name,
    resourceName,
    position: { x, y },
    properties: {
      ...getServiceDefinition(type).defaultProperties,
      ...overrides,
    },
  };
}

/**
 * Healthy graph based on firstCutGraph but expanded so it produces ZERO
 * error-severity findings from the rules engine. It adds a Log Analytics
 * workspace, an Application Insights component that depends on the workspace,
 * and sets explicit-known-good values for httpsOnly / minTlsVersion /
 * vnetIntegration on the App Service.
 */
export const healthyGraph: GraphDocument = {
  schemaVersion: 1,
  metadata: {
    name: "healthy-dev",
    description: "Healthy fixture used by rules-engine tests.",
    createdAt: fixedDate,
    updatedAt: fixedDate,
    region: "australiaeast",
    environment: "dev",
    resourceGroupName: "rg-healthy-dev",
  },
  nodes: [
    node("rg", "resourceGroup", "Main RG dev", "rg-healthy-dev", 0, 0, {
      tags: { owner: "platform", env: "dev" },
    }),
    node("plan", "appServicePlan", "Web Plan dev", "plan-healthy-dev", 200, 0),
    node("app", "appService", "API Web App dev", "app-healthy-dev", 400, 0, {
      httpsOnly: true,
      vnetIntegration: true,
    }),
    node("stg", "storageAccount", "Blob Storage dev", "healthydevstg", 600, 0, {
      minTlsVersion: "1.2",
      allowPublicAccess: false,
    }),
    node("kv", "keyVault", "Secrets Vault dev", "kv-healthy-dev", 800, 0, {
      purgeProtection: true,
    }),
    node("la", "logAnalytics", "Workspace dev", "log-healthy-dev", 1000, 0),
    node(
      "ai",
      "applicationInsights",
      "Telemetry dev",
      "appi-healthy-dev",
      1200,
      0,
    ),
  ],
  edges: [
    { id: "e1", source: "app", target: "plan", kind: "depends_on" },
    { id: "e2", source: "app", target: "stg", kind: "data" },
    { id: "e3", source: "app", target: "kv", kind: "identity" },
    { id: "e4", source: "ai", target: "la", kind: "depends_on" },
  ] satisfies GraphEdge[],
};
