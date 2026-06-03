import { describe, expect, it } from "vitest";
import { DEFAULT_CONTAINER_SIZE, type GraphNode, isContainerType } from "./schema";
import { parseArmTemplate } from "./arm-import";

function sizeOf(node: GraphNode): { width: number; height: number } {
  if (node.size) return node.size;
  if (isContainerType(node.type)) return DEFAULT_CONTAINER_SIZE[node.type];
  return { width: 220, height: 50 };
}

describe("parseArmTemplate", () => {
  it("imports AKS and VMSS resources with inferred subnet and workspace edges", () => {
    const template = {
      $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
      contentVersion: "1.0.0.0",
      resources: [
        {
          type: "Microsoft.Network/virtualNetworks",
          apiVersion: "2023-11-01",
          name: "vnet-app",
          location: "australiaeast",
          properties: {
            addressSpace: { addressPrefixes: ["10.42.0.0/16"] },
          },
          resources: [
            {
              type: "subnets",
              apiVersion: "2023-11-01",
              name: "snet-aks",
              properties: { addressPrefix: "10.42.1.0/24" },
            },
          ],
        },
        {
          type: "Microsoft.OperationalInsights/workspaces",
          apiVersion: "2023-09-01",
          name: "log-app",
          location: "australiaeast",
          properties: { retentionInDays: 60, sku: { name: "PerGB2018" } },
        },
        {
          type: "Microsoft.ContainerService/managedClusters",
          apiVersion: "2024-07-01",
          name: "aks-app",
          location: "australiaeast",
          identity: { type: "SystemAssigned" },
          properties: {
            dnsPrefix: "aks-app",
            apiServerAccessProfile: { enablePrivateCluster: true },
            agentPoolProfiles: [
              {
                name: "system",
                count: 3,
                vmSize: "Standard_D2s_v5",
                type: "VirtualMachineScaleSets",
                vnetSubnetID:
                  "[resourceId('Microsoft.Network/virtualNetworks/subnets', 'vnet-app', 'snet-aks')]",
              },
            ],
            addonProfiles: {
              omsagent: {
                enabled: true,
                config: {
                  logAnalyticsWorkspaceResourceID:
                    "[resourceId('Microsoft.OperationalInsights/workspaces', 'log-app')]",
                },
              },
            },
          },
        },
        {
          type: "Microsoft.Compute/virtualMachineScaleSets",
          apiVersion: "2024-07-01",
          name: "vmss-app",
          location: "australiaeast",
          sku: { name: "Standard_B2s", capacity: 2 },
          properties: {
            orchestrationMode: "Flexible",
            automaticRepairsPolicy: { enabled: true },
            virtualMachineProfile: {
              osProfile: { adminUsername: "azureuser" },
              storageProfile: {
                imageReference: {
                  publisher: "Canonical",
                  offer: "0001-com-ubuntu-server-jammy",
                  sku: "22_04-lts-gen2",
                },
              },
              networkProfile: {
                networkInterfaceConfigurations: [
                  {
                    properties: {
                      ipConfigurations: [
                        {
                          properties: {
                            subnet: {
                              id: "[resourceId('Microsoft.Network/virtualNetworks/subnets', 'vnet-app', 'snet-aks')]",
                            },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    };

    const result = parseArmTemplate(JSON.stringify(template));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes.map((n) => n.type)).toEqual(
      expect.arrayContaining([
        "resourceGroup",
        "virtualNetwork",
        "subnet",
        "logAnalytics",
        "aksCluster",
        "virtualMachineScaleSet",
      ]),
    );
    const aks = result.document.nodes.find((n) => n.type === "aksCluster");
    const vmss = result.document.nodes.find((n) => n.type === "virtualMachineScaleSet");
    const subnet = result.document.nodes.find((n) => n.type === "subnet");
    const log = result.document.nodes.find((n) => n.type === "logAnalytics");
    expect(aks?.properties.privateCluster).toBe(true);
    expect(vmss?.properties.capacity).toBe(2);
    expect(result.document.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: aks?.id, target: subnet?.id, kind: "network" }),
        expect.objectContaining({ source: aks?.id, target: log?.id, kind: "diagnostic" }),
        expect.objectContaining({ source: vmss?.id, target: subnet?.id, kind: "network" }),
      ]),
    );
  });

  it("keeps imported resources in the right containers and resolves exact subnet/function storage edges", () => {
    const template = {
      $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
      contentVersion: "1.0.0.0",
      resources: [
        {
          type: "Microsoft.Network/virtualNetworks",
          apiVersion: "2023-11-01",
          name: "vnet-platform-prod",
          location: "australiaeast",
          properties: {
            addressSpace: { addressPrefixes: ["10.20.0.0/16"] },
          },
          resources: [
            {
              type: "subnets",
              apiVersion: "2023-11-01",
              name: "snet-apps",
              properties: {
                addressPrefix: "10.20.1.0/24",
                privateEndpointNetworkPolicies: "Enabled",
              },
            },
            {
              type: "subnets",
              apiVersion: "2023-11-01",
              name: "snet-private-endpoints",
              properties: {
                addressPrefix: "10.20.10.0/24",
                privateEndpointNetworkPolicies: "Disabled",
              },
            },
          ],
        },
        {
          type: "Microsoft.Web/serverfarms",
          apiVersion: "2023-12-01",
          name: "plan-functions-prod",
          location: "australiaeast",
          kind: "linux",
          sku: { name: "P1v3", capacity: 1 },
          properties: {},
        },
        {
          type: "Microsoft.Storage/storageAccounts",
          apiVersion: "2023-05-01",
          name: "stfuncprod01",
          location: "australiaeast",
          sku: { name: "Standard_ZRS" },
          kind: "StorageV2",
          properties: {},
        },
        {
          type: "Microsoft.Storage/storageAccounts",
          apiVersion: "2023-05-01",
          name: "stappdata01",
          location: "australiaeast",
          sku: { name: "Standard_ZRS" },
          kind: "StorageV2",
          properties: {},
        },
        {
          type: "Microsoft.Web/sites",
          apiVersion: "2023-12-01",
          name: "fn-worker-platform-prod",
          location: "australiaeast",
          kind: "functionapp,linux",
          dependsOn: [
            "[resourceId('Microsoft.Web/serverfarms', 'plan-functions-prod')]",
            "[resourceId('Microsoft.Storage/storageAccounts', 'stfuncprod01')]",
          ],
          properties: {
            serverFarmId: "[resourceId('Microsoft.Web/serverfarms', 'plan-functions-prod')]",
            httpsOnly: true,
          },
          resources: [
            {
              type: "config",
              apiVersion: "2023-12-01",
              name: "appsettings",
              properties: {
                AzureWebJobsStorage:
                  "DefaultEndpointsProtocol=https;AccountName=stfuncprod01;EndpointSuffix=core.windows.net",
              },
            },
          ],
        },
        {
          type: "Microsoft.Network/privateEndpoints",
          apiVersion: "2023-11-01",
          name: "pe-storage-platform-prod",
          location: "australiaeast",
          properties: {
            subnet: {
              id: "[resourceId('Microsoft.Network/virtualNetworks/subnets', 'vnet-platform-prod', 'snet-private-endpoints')]",
            },
            privateLinkServiceConnections: [
              {
                name: "storage",
                properties: {
                  privateLinkServiceId:
                    "[resourceId('Microsoft.Storage/storageAccounts', 'stappdata01')]",
                  groupIds: ["blob"],
                },
              },
            ],
          },
        },
      ],
    };

    const result = parseArmTemplate(JSON.stringify(template));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const nodes = result.document.nodes;
    const rg = nodes.find((n) => n.type === "resourceGroup");
    const vnet = nodes.find((n) => n.type === "virtualNetwork");
    const privateSubnet = nodes.find((n) => n.resourceName === "snet-private-endpoints");
    const appSubnet = nodes.find((n) => n.resourceName === "snet-apps");
    const plan = nodes.find((n) => n.resourceName === "plan-functions-prod");
    const fn = nodes.find((n) => n.resourceName === "fn-worker-platform-prod");
    const fnStorage = nodes.find((n) => n.resourceName === "stfuncprod01");
    const dataStorage = nodes.find((n) => n.resourceName === "stappdata01");
    const pe = nodes.find((n) => n.resourceName === "pe-storage-platform-prod");

    expect(rg).toBeDefined();
    expect(vnet?.parentId).toBe(rg?.id);
    expect(privateSubnet?.parentId).toBe(vnet?.id);
    expect(appSubnet?.parentId).toBe(vnet?.id);
    expect(fn?.parentId).toBe(plan?.id);
    expect(privateSubnet?.properties.privateEndpointNetworkPolicies).toBe("Disabled");

    expect(result.document.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: pe?.id, target: privateSubnet?.id, kind: "network" }),
        expect.objectContaining({ source: pe?.id, target: dataStorage?.id, kind: "network" }),
        expect.objectContaining({ source: fn?.id, target: fnStorage?.id, kind: "data" }),
      ]),
    );
    expect(result.document.edges).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: pe?.id, target: appSubnet?.id, kind: "network" }),
      ]),
    );

    expect(rg?.size).toBeDefined();
    for (const child of nodes.filter((node) => node.parentId === rg?.id)) {
      const size = sizeOf(child);
      expect(child.position.x + size.width).toBeLessThanOrEqual(rg!.size!.width);
      expect(child.position.y + size.height).toBeLessThanOrEqual(rg!.size!.height);
    }
    for (const child of nodes.filter((node) => node.parentId === vnet?.id)) {
      const size = sizeOf(child);
      expect(child.position.x + size.width).toBeLessThanOrEqual(vnet!.size!.width);
      expect(child.position.y + size.height).toBeLessThanOrEqual(vnet!.size!.height);
    }
    for (const child of nodes.filter((node) => node.parentId === plan?.id)) {
      const size = sizeOf(child);
      expect(child.position.x + size.width).toBeLessThanOrEqual(plan!.size!.width);
      expect(child.position.y + size.height).toBeLessThanOrEqual(plan!.size!.height);
    }
  });

  it("imports Private DNS, role assignment, and monitor alert relationships", () => {
    const template = {
      $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
      contentVersion: "1.0.0.0",
      resources: [
        {
          type: "Microsoft.Network/virtualNetworks",
          apiVersion: "2023-11-01",
          name: "vnet-prod",
          location: "australiaeast",
          properties: { addressSpace: { addressPrefixes: ["10.30.0.0/16"] } },
          resources: [
            {
              type: "subnets",
              apiVersion: "2023-11-01",
              name: "snet-private-endpoints",
              properties: {
                addressPrefix: "10.30.1.0/24",
                privateEndpointNetworkPolicies: "Disabled",
              },
            },
          ],
        },
        {
          type: "Microsoft.Network/privateDnsZones",
          apiVersion: "2020-06-01",
          name: "privatelink.blob.core.windows.net",
          location: "global",
          resources: [
            {
              type: "virtualNetworkLinks",
              apiVersion: "2020-06-01",
              name: "vnet-prod-link",
              properties: {
                registrationEnabled: false,
                virtualNetwork: {
                  id: "[resourceId('Microsoft.Network/virtualNetworks', 'vnet-prod')]",
                },
              },
            },
          ],
        },
        {
          type: "Microsoft.Storage/storageAccounts",
          apiVersion: "2023-05-01",
          name: "stprod001",
          location: "australiaeast",
          sku: { name: "Standard_ZRS" },
          kind: "StorageV2",
          properties: { publicNetworkAccess: "Disabled" },
        },
        {
          type: "Microsoft.Network/privateEndpoints",
          apiVersion: "2023-11-01",
          name: "pe-storage-prod",
          location: "australiaeast",
          properties: {
            subnet: {
              id: "[resourceId('Microsoft.Network/virtualNetworks/subnets', 'vnet-prod', 'snet-private-endpoints')]",
            },
            privateLinkServiceConnections: [
              {
                name: "storage",
                properties: {
                  privateLinkServiceId:
                    "[resourceId('Microsoft.Storage/storageAccounts', 'stprod001')]",
                  groupIds: ["blob"],
                },
              },
            ],
          },
          resources: [
            {
              type: "privateDnsZoneGroups",
              apiVersion: "2023-11-01",
              name: "default",
              properties: {
                privateDnsZoneConfigs: [
                  {
                    name: "blob",
                    properties: {
                      privateDnsZoneId:
                        "[resourceId('Microsoft.Network/privateDnsZones', 'privatelink.blob.core.windows.net')]",
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          type: "Microsoft.ContainerRegistry/registries",
          apiVersion: "2023-11-01-preview",
          name: "acrprod001",
          location: "australiaeast",
          sku: { name: "Premium" },
          properties: {},
        },
        {
          type: "Microsoft.ContainerService/managedClusters",
          apiVersion: "2024-07-01",
          name: "aks-prod",
          location: "australiaeast",
          identity: { type: "SystemAssigned" },
          properties: {
            dnsPrefix: "aks-prod",
            agentPoolProfiles: [{ name: "system", count: 3, availabilityZones: ["1", "2", "3"] }],
          },
        },
        {
          type: "Microsoft.Authorization/roleAssignments",
          apiVersion: "2022-04-01",
          name: "11111111-1111-1111-1111-111111111111",
          scope: "[resourceId('Microsoft.ContainerRegistry/registries', 'acrprod001')]",
          dependsOn: ["[resourceId('Microsoft.ContainerService/managedClusters', 'aks-prod')]"],
          properties: {
            roleDefinitionId:
              "[subscriptionResourceId('Microsoft.Authorization/roleDefinitions','7f951dda-4ed3-4680-a7ca-43fe172d538d')]",
            principalType: "ServicePrincipal",
          },
        },
        {
          type: "Microsoft.Insights/actionGroups",
          apiVersion: "2023-01-01",
          name: "ag-ops",
          location: "global",
          properties: {
            groupShortName: "ops",
            emailReceivers: [{ name: "ops", emailAddress: "ops@example.com" }],
          },
        },
        {
          type: "Microsoft.Insights/metricAlerts",
          apiVersion: "2018-03-01",
          name: "alert-aks-prod",
          location: "global",
          properties: {
            enabled: true,
            scopes: ["[resourceId('Microsoft.ContainerService/managedClusters', 'aks-prod')]"],
            actions: {
              actionGroups: [
                {
                  actionGroupId: "[resourceId('Microsoft.Insights/actionGroups', 'ag-ops')]",
                },
              ],
            },
          },
        },
      ],
    };

    const result = parseArmTemplate(JSON.stringify(template));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const nodes = result.document.nodes;
    const pe = nodes.find((n) => n.resourceName === "pe-storage-prod");
    const dns = nodes.find((n) => n.type === "privateDnsZone");
    const vnet = nodes.find((n) => n.resourceName === "vnet-prod");
    const aks = nodes.find((n) => n.resourceName === "aks-prod");
    const acr = nodes.find((n) => n.resourceName === "acrprod001");
    const rbac = nodes.find((n) => n.type === "roleAssignment");
    const alert = nodes.find((n) => n.type === "monitorAlert");
    const actionGroup = nodes.find((n) => n.type === "actionGroup");

    expect(dns?.properties.zoneName).toBe("privatelink.blob.core.windows.net");
    expect(aks?.properties.availabilityZones).toEqual(["1", "2", "3"]);
    expect(rbac?.properties.roleDefinitionName).toBe("AcrPull");
    expect(result.document.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: pe?.id, target: dns?.id, kind: "network" }),
        expect.objectContaining({ source: dns?.id, target: vnet?.id, kind: "network" }),
        expect.objectContaining({ source: aks?.id, target: rbac?.id, kind: "identity" }),
        expect.objectContaining({ source: rbac?.id, target: acr?.id, kind: "identity" }),
        expect.objectContaining({ source: alert?.id, target: aks?.id, kind: "diagnostic" }),
        expect.objectContaining({ source: alert?.id, target: actionGroup?.id, kind: "depends_on" }),
      ]),
    );
  });
});
