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
 * Deliberately broken graph used by rules-engine tests. Violates many rules:
 *
 * - storageAccount with minTlsVersion "1.0" and allowPublicAccess true
 *   (BUNYA.COMP.002 / ISM.1552, BUNYA.NET.005)
 * - storageAccount with INVALID name "INVALID-NAME!" (BUNYA.NAM.001)
 * - appService with httpsOnly false (BUNYA.COMP.001 / ISM.0974)
 * - appService -> keyVault via "data" edge (BUNYA.IDN.001 / BUNYA.IDN.003)
 * - keyVault with purgeProtection false
 * - functionApp without a backing storageAccount edge (BUNYA.IMP.001)
 * - identity edge from non-compute source (storageAccount -> keyVault)
 * - orphan applicationInsights (no depends_on edge to logAnalytics)
 *   (BUNYA.IMP.005)
 */
export const brokenGraph: GraphDocument = {
  schemaVersion: 1,
  metadata: {
    name: "broken-dev",
    description: "Intentionally broken fixture used by rules-engine tests.",
    createdAt: fixedDate,
    updatedAt: fixedDate,
    region: "australiaeast",
    environment: "dev",
    resourceGroupName: "rg-broken-dev",
  },
  nodes: [
    node("rg", "resourceGroup", "Broken RG", "rg-broken-dev", 0, 0, {
      tags: { owner: "platform", env: "dev" },
    }),
    node("plan", "appServicePlan", "Broken Plan", "plan-broken-dev", 200, 0),
    node("app", "appService", "Broken Web App", "app-broken-dev", 400, 0, {
      httpsOnly: false,
    }),
    node(
      "fn",
      "functionApp",
      "Lonely Function",
      "fn-broken-dev",
      400,
      200,
      {
        httpsOnly: true,
      },
    ),
    // Intentional invalid storage account name — fires BUNYA.NAM.001.
    node("stg", "storageAccount", "Bad Storage", "INVALID-NAME!", 600, 0, {
      minTlsVersion: "1.0",
      allowPublicAccess: true,
    }),
    node("kv", "keyVault", "Open Vault", "kv-broken-dev", 800, 0, {
      purgeProtection: false,
    }),
    node(
      "ai",
      "applicationInsights",
      "Orphan Telemetry",
      "appi-broken-dev",
      1000,
      0,
    ),
  ],
  edges: [
    { id: "e1", source: "app", target: "plan", kind: "depends_on" },
    { id: "e2", source: "fn", target: "plan", kind: "depends_on" },
    // App -> Key Vault as "data" — wrong, should be identity.
    { id: "e3", source: "app", target: "kv", kind: "data" },
    // Identity edge from a non-compute source (storageAccount is not compute).
    { id: "e4", source: "stg", target: "kv", kind: "identity" },
  ] satisfies GraphEdge[],
};
