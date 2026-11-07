import { describe, expect, it } from "vitest";
import { parseArmTemplate } from "./arm-import";
import { parseImportText } from "./portable";
import { createEvaluator, UNRESOLVED } from "./arm-expressions";
import type { GraphDocument } from "./schema";

const SCHEMA = "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#";

function imported(template: unknown): { document: GraphDocument; warning: string } {
  const result = parseArmTemplate(JSON.stringify(template));
  if (!result.ok) throw new Error(result.reason);
  return { document: result.document, warning: result.warning ?? "" };
}

function node(document: GraphDocument, type: string, resourceName?: string) {
  return document.nodes.find((n) => n.type === type && (resourceName === undefined || n.resourceName === resourceName));
}

describe("ARM template expressions", () => {
  const evaluator = createEvaluator({
    parameters: {
      prefix: { type: "string", defaultValue: "Contoso" },
      location: { type: "string", defaultValue: "[resourceGroup().location]" },
      noDefault: { type: "string" },
    },
    variables: {
      vnetName: "[format('{0}-vnet', toLower(parameters('prefix')))]",
      subnets: [{ name: "web", prefix: "10.0.1.0/24" }],
      self: "[variables('self')]",
    },
  });

  it("evaluates template-only functions and leaves deployment functions unresolved", () => {
    expect(evaluator.evaluate("[variables('vnetName')]")).toBe("contoso-vnet");
    expect(evaluator.evaluate("[concat(parameters('prefix'), '-', 'app')]")).toBe("Contoso-app");
    expect(evaluator.evaluate("[variables('subnets')[0].prefix]")).toBe("10.0.1.0/24");
    expect(evaluator.evaluate("[if(equals(parameters('prefix'), 'Contoso'), 'yes', reference('x').id)]")).toBe("yes");
    expect(evaluator.evaluate("[resourceId('Microsoft.Network/virtualNetworks/subnets', variables('vnetName'), 'web')]"))
      .toBe("/providers/Microsoft.Network/virtualNetworks/contoso-vnet/subnets/web");
    expect(evaluator.evaluate("[parameters('location')]")).toBe(UNRESOLVED);
    expect(evaluator.evaluate("[parameters('noDefault')]")).toBe(UNRESOLVED);
    expect(evaluator.evaluate("[variables('self')]")).toBe(UNRESOLVED);
    expect(evaluator.evaluate("[[not an expression]")).toBe("[not an expression]");
  });
});

describe("parseArmTemplate with real-world template shapes", () => {
  it("keeps resources whose name parameter defaults to an empty string", () => {
    const { document } = imported({
      $schema: SCHEMA,
      parameters: { factories_name: { type: "String", defaultValue: "" }, storage_name: { type: "String", defaultValue: "" } },
      resources: [
        { type: "Microsoft.Storage/storageAccounts", apiVersion: "2023-01-01", name: "[parameters('storage_name')]", sku: { name: "Standard_LRS" }, kind: "StorageV2" },
      ],
    });
    expect(node(document, "storageAccount")?.resourceName).toBe("storage-name");
  });

  it("reads settings written as variables and parameters instead of replacing them with defaults", () => {
    const { document, warning } = imported({
      $schema: SCHEMA,
      parameters: { storageSku: { type: "string", defaultValue: "Standard_GRS" } },
      variables: { space: "10.40.0.0/16", web: "10.40.7.0/24" },
      resources: [
        { type: "Microsoft.Storage/storageAccounts", apiVersion: "2023-01-01", name: "stdata", sku: { name: "[parameters('storageSku')]" }, kind: "StorageV2" },
        {
          type: "Microsoft.Network/virtualNetworks",
          apiVersion: "2023-11-01",
          name: "vnet-app",
          properties: { addressSpace: { addressPrefixes: ["[variables('space')]"] } },
          resources: [{ type: "subnets", apiVersion: "2023-11-01", name: "web", properties: { addressPrefix: "[variables('web')]" } }],
        },
      ],
    });
    expect(node(document, "storageAccount")?.properties.sku).toBe("Standard_GRS");
    expect(node(document, "virtualNetwork")?.properties.addressSpace).toBe("10.40.0.0/16");
    expect(node(document, "subnet")?.properties.addressPrefix).toBe("10.40.7.0/24");
    expect(warning).not.toMatch(/replaced characters/);
  });

  it("does not report deployment-time locations as foreign regions", () => {
    const { warning } = imported({
      $schema: SCHEMA,
      parameters: { location: { type: "string", defaultValue: "[resourceGroup().location]" } },
      resources: [{ type: "Microsoft.KeyVault/vaults", apiVersion: "2023-07-01", name: "kv-app", location: "[parameters('location')]", properties: { sku: { name: "standard", family: "A" }, tenantId: "[subscription().tenantId]" } }],
    });
    expect(warning).not.toMatch(/Resources in \[/);
  });

  it("imports subnets declared inline on a virtual network, once", () => {
    const vnet = {
      type: "Microsoft.Network/virtualNetworks",
      apiVersion: "2023-11-01",
      name: "vnet-app",
      properties: {
        addressSpace: { addressPrefixes: ["10.0.0.0/16"] },
        subnets: [
          { name: "web", properties: { addressPrefix: "10.0.1.0/24" } },
          { name: "data", properties: { addressPrefix: "10.0.2.0/24" } },
        ],
      },
    };
    const inline = imported({ $schema: SCHEMA, resources: [vnet] }).document;
    const subnets = inline.nodes.filter((n) => n.type === "subnet");
    expect(subnets.map((s) => s.resourceName).sort()).toEqual(["data", "web"]);
    expect(subnets.every((s) => s.parentId === node(inline, "virtualNetwork")?.id)).toBe(true);

    // Portal exports also list each subnet as its own resource.
    const both = imported({
      $schema: SCHEMA,
      resources: [vnet, { type: "Microsoft.Network/virtualNetworks/subnets", apiVersion: "2023-11-01", name: "vnet-app/web", properties: { addressPrefix: "10.0.1.0/24" } }],
    }).document;
    expect(both.nodes.filter((n) => n.type === "subnet")).toHaveLength(2);
  });

  it("keeps private DNS zones Bunya's Private Endpoint rules do not list", () => {
    const { document } = imported({
      $schema: SCHEMA,
      resources: [{ type: "Microsoft.Network/privateDnsZones", apiVersion: "2020-06-01", name: "privatelink.mongo.cosmos.azure.com", location: "global" }],
    });
    expect(node(document, "privateDnsZone")?.properties.zoneName).toBe("privatelink.mongo.cosmos.azure.com");
  });

  it("names resources built with format() and nested variables and keeps subnets in their VNet", () => {
    const { document } = imported({
      $schema: SCHEMA,
      parameters: { projectName: { type: "string", defaultValue: "lb" } },
      variables: { vnetName: "[format('{0}-vnet', parameters('projectName'))]", subnetName: "backend" },
      resources: [
        { type: "Microsoft.Network/virtualNetworks", apiVersion: "2023-11-01", name: "[variables('vnetName')]", properties: { addressSpace: { addressPrefixes: ["10.0.0.0/16"] } } },
        {
          type: "Microsoft.Network/virtualNetworks/subnets",
          apiVersion: "2023-11-01",
          name: "[format('{0}/{1}', variables('vnetName'), variables('subnetName'))]",
          dependsOn: ["[resourceId('Microsoft.Network/virtualNetworks', variables('vnetName'))]"],
          properties: { addressPrefix: "10.0.2.0/24" },
        },
        { type: "Microsoft.Storage/storageAccounts", apiVersion: "2023-01-01", name: "[toLower(concat('st', parameters('projectName'), 'DATA'))]", sku: { name: "Standard_LRS" }, kind: "StorageV2" },
      ],
    });
    expect(node(document, "virtualNetwork")?.resourceName).toBe("lb-vnet");
    expect(node(document, "subnet")?.resourceName).toBe("backend");
    expect(node(document, "subnet")?.parentId).toBe(node(document, "virtualNetwork")?.id);
    expect(node(document, "storageAccount")?.resourceName).toBe("stlbdata");
  });

  it("imports languageVersion 2.0 templates, whose resources are keyed by symbolic name", () => {
    const { document } = imported({
      $schema: SCHEMA,
      languageVersion: "2.0",
      resources: {
        logs: { type: "Microsoft.OperationalInsights/workspaces", apiVersion: "2022-10-01", name: "log-app" },
        existingVault: { existing: true, type: "Microsoft.KeyVault/vaults", apiVersion: "2023-07-01", name: "kv-shared" },
      },
    });
    expect(node(document, "logAnalytics")?.resourceName).toBe("log-app");
    expect(node(document, "keyVault")).toBeUndefined();
  });

  it("accepts comments and trailing commas, as Azure Resource Manager does", () => {
    const text = `{
      // exported by hand
      "$schema": "${SCHEMA}",
      "resources": [
        /* the only resource */
        { "type": "Microsoft.OperationalInsights/workspaces", "apiVersion": "2022-10-01", "name": "log-app", "properties": { "url": "https://example.com/a//b" }, },
      ],
    }`;
    const result = parseImportText(text);
    expect(result.ok && result.document.nodes.some((n) => n.resourceName === "log-app")).toBe(true);
  });

  it("gives subnets with deployment-time prefixes distinct ranges in their VNet", () => {
    const { document, warning } = imported({
      $schema: SCHEMA,
      parameters: { webPrefix: { type: "string" }, dataPrefix: { type: "string" } },
      resources: [{
        type: "Microsoft.Network/virtualNetworks",
        apiVersion: "2023-11-01",
        name: "vnet-app",
        properties: {
          addressSpace: { addressPrefixes: ["10.8.0.0/16"] },
          subnets: [
            { name: "web", properties: { addressPrefix: "[parameters('webPrefix')]" } },
            { name: "data", properties: { addressPrefix: "[parameters('dataPrefix')]" } },
          ],
        },
      }],
    });
    const prefixes = document.nodes.filter((n) => n.type === "subnet").map((n) => n.properties.addressPrefix);
    expect(new Set(prefixes).size).toBe(2);
    expect(prefixes.every((prefix) => String(prefix).startsWith("10.8."))).toBe(true);
    expect(warning).toMatch(/only known at deployment/);
  });
});
