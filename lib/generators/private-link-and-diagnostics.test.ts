import { describe, expect, it } from "vitest";
import { getServiceDefinition } from "@/lib/catalogue/services";
import type { GraphDocument, GraphEdge, ServiceType } from "@/lib/graph/schema";
import { generateArm } from "./arm";
import { generateBicep } from "./bicep";
import { generateTerraform } from "./terraform";
import type { GeneratorResult } from "./types";

const at = "2026-11-07T00:00:00.000Z";

function node(id: string, type: ServiceType, resourceName: string, overrides: Record<string, unknown> = {}, parentId: string | null = "rg") {
  return { id, type, name: id, resourceName, position: { x: 0, y: 0 }, properties: { ...getServiceDefinition(type).defaultProperties, ...overrides }, parentId };
}

function graph(nodes: GraphDocument["nodes"], edges: GraphEdge[]): GraphDocument {
  return {
    schemaVersion: 1,
    metadata: { name: "t", createdAt: at, updatedAt: at, region: "australiaeast", environment: "dev", resourceGroupName: "rg-t" },
    nodes: [node("rg", "resourceGroup", "rg-t", {}, null), ...nodes],
    edges,
  };
}

function text(result: GeneratorResult, path: string): string {
  if (!result.ok) throw new Error(result.reason);
  return result.files.find((file) => file.path === path)!.content;
}

describe("SQL private endpoints", () => {
  const document = graph(
    [
      node("vnet", "virtualNetwork", "vnet-t"),
      node("snet", "subnet", "snet-pe", { addressPrefix: "10.0.1.0/24" }, "vnet"),
      node("sql", "sqlDatabase", "sqldb-t"),
      node("pe", "privateEndpoint", "pe-sql", { groupId: "sqlServer" }),
      node("zone", "privateDnsZone", "privatelink.database.windows.net", { zoneName: "privatelink.database.windows.net" }),
    ],
    [
      { id: "e1", source: "pe", target: "snet", kind: "network" },
      { id: "e2", source: "pe", target: "sql", kind: "network" },
      { id: "e3", source: "pe", target: "zone", kind: "network" },
      { id: "e4", source: "zone", target: "vnet", kind: "network" },
    ],
  );

  // Azure Private Link for Azure SQL Database connects to the logical server.
  it("connect to the logical server in every format", () => {
    const arm = JSON.parse(text(generateArm(document), "azuredeploy.json")).resources as { type: string; properties?: Record<string, unknown> }[];
    const pe = arm.find((resource) => resource.type === "Microsoft.Network/privateEndpoints")!;
    const target = (pe.properties!.privateLinkServiceConnections as { properties: { privateLinkServiceId: string } }[])[0].properties.privateLinkServiceId;
    expect(target).toMatch(/^\[resourceId\('Microsoft\.Sql\/servers', '[^']+'\)\]$/);

    expect(text(generateBicep(document), "main.bicep")).toMatch(/privateLinkServiceId: \w+Server\.id/);
    expect(text(generateTerraform(document), "main.tf")).toMatch(/private_connection_resource_id = azurerm_mssql_server\.\w+\.id/);
  });
});

describe("diagnostic settings", () => {
  const document = graph(
    [
      node("la", "logAnalytics", "log-t"),
      node("kv", "keyVault", "kv-t"),
      node("alert", "monitorAlert", "alert-t"),
    ],
    [
      { id: "e1", source: "kv", target: "la", kind: "diagnostic" },
      { id: "e2", source: "alert", target: "la", kind: "diagnostic" },
    ],
  );

  // An alert's diagnostic edge to a workspace sets its scope; alerts do not
  // accept diagnostic settings, so Azure would reject one.
  it("are written only for resources that support them, in every format", () => {
    const arm = JSON.parse(text(generateArm(document), "azuredeploy.json")).resources as { type: string; scope?: string }[];
    const settings = arm.filter((resource) => resource.type === "Microsoft.Insights/diagnosticSettings");
    expect(settings.map((resource) => resource.scope)).toEqual([expect.stringContaining("Microsoft.KeyVault/vaults")]);

    expect(text(generateBicep(document), "main.bicep").match(/Microsoft\.Insights\/diagnosticSettings@/g)).toHaveLength(1);
    expect(text(generateTerraform(document), "main.tf").match(/resource "azurerm_monitor_diagnostic_setting"/g)).toHaveLength(1);
  });
});
