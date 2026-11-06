import { describe, expect, it } from "vitest";
import { DEFAULT_CONTAINER_SIZE, type GraphNode, isContainerType } from "./schema";
import { parseArmTemplate } from "./arm-import";
import { generateTerraform } from "@/lib/generators/terraform";

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

  it("keeps the exported Linux runtime of web and function apps", () => {
    const result = parseArmTemplate(JSON.stringify({
      $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
      contentVersion: "1.0.0.0",
      resources: [
        { type: "Microsoft.Web/sites", apiVersion: "2023-12-01", name: "web-old", location: "australiaeast", kind: "app,linux", properties: { siteConfig: { linuxFxVersion: "NODE|18-lts" } } },
        { type: "Microsoft.Web/sites", apiVersion: "2023-12-01", name: "fn-py", location: "australiaeast", kind: "functionapp,linux", properties: { siteConfig: { linuxFxVersion: "Python|3.11" } } },
        { type: "Microsoft.Web/sites", apiVersion: "2023-12-01", name: "web-ruby", location: "australiaeast", kind: "app,linux", properties: { siteConfig: { linuxFxVersion: "RUBY|2.7" } } },
        { type: "Microsoft.Web/sites", apiVersion: "2023-12-01", name: "web-param", location: "australiaeast", kind: "app,linux", properties: { siteConfig: { linuxFxVersion: "[parameters('runtimeStack')]" } } },
        { type: "Microsoft.Web/sites", apiVersion: "2023-12-01", name: "fn-isolated", location: "australiaeast", kind: "functionapp,linux", properties: { siteConfig: { linuxFxVersion: "DOTNET-ISOLATED|8.0" } } },
      ],
      parameters: { runtimeStack: { type: "string", defaultValue: "NODE|20-lts" } },
    }));
    if (!result.ok) throw new Error(result.reason);
    const byName = Object.fromEntries(result.document.nodes.map((n) => [n.resourceName, n.properties]));
    expect(byName["web-old"]).toMatchObject({ runtime: "node", runtimeVersion: "18-lts" });
    expect(byName["fn-py"]).toMatchObject({ runtime: "python", runtimeVersion: "3.11" });
    expect(byName["web-ruby"]).toMatchObject({ runtime: "node", runtimeVersion: "22-lts" });
    expect(result.warning).toContain('runtime "RUBY|2.7" is not modelled');
    expect(byName["web-param"]).toMatchObject({ runtime: "node", runtimeVersion: "20-lts" });
    expect(byName["fn-isolated"]).toMatchObject({ runtime: "dotnet", runtimeVersion: "8.0" });
    expect(result.warning ?? "").not.toContain("fn-isolated");
  });

  it("imports an Azure portal export with parameterised plans, unsafe names and mapped settings", () => {
    const planId = (param: string) => `[resourceId('Microsoft.Web/serverfarms', parameters('${param}'))]`;
    const template = {
      parameters: {
        serverfarms_ASP_general_a897_name: { defaultValue: "ASP-general-a897", type: "String" },
        serverfarms_ASP_general_adba_name: { defaultValue: "ASP-general-adba", type: "String" },
        sites_dashboard_name: { defaultValue: "app-dashboard", type: "String" },
        sites_docs_name: { defaultValue: "app-docs", type: "String" },
        registries_acr_name: { defaultValue: "acrexample", type: "String" },
        servers_sql_name: { defaultValue: "sql-example", type: "String" },
        actiongroups_smart_detection_name: { defaultValue: "Application Insights Smart Detection", type: "String" },
      },
      resources: [
        {
          type: "Microsoft.ContainerRegistry/registries",
          name: "[parameters('registries_acr_name')]",
          location: "australiaeast",
          sku: { name: "Standard", tier: "Standard" },
          properties: { adminUserEnabled: true, publicNetworkAccess: "Disabled" },
        },
        {
          type: "microsoft.insights/actionGroups",
          name: "[parameters('actiongroups_smart_detection_name')]",
          location: "Global",
          properties: { groupShortName: "SmartDetect", emailReceivers: [] },
        },
        {
          type: "Microsoft.Web/serverfarms",
          name: "[parameters('serverfarms_ASP_general_a897_name')]",
          location: "Australia East",
          kind: "linux",
          sku: { name: "P0v3", tier: "Premium0V3", capacity: 1 },
          properties: { reserved: true },
        },
        {
          type: "Microsoft.Web/serverfarms",
          name: "[parameters('serverfarms_ASP_general_adba_name')]",
          location: "Australia East",
          kind: "linux",
          sku: { name: "B1", tier: "Basic", capacity: 1 },
          properties: { reserved: true },
        },
        {
          type: "Microsoft.Web/sites",
          name: "[parameters('sites_dashboard_name')]",
          location: "Australia East",
          kind: "app,linux,container",
          dependsOn: [planId("serverfarms_ASP_general_a897_name")],
          properties: {
            serverFarmId: planId("serverfarms_ASP_general_a897_name"),
            siteConfig: { linuxFxVersion: "[concat('DOCKER|acrexample.azurecr.io/', parameters('sites_dashboard_name'), ':latest')]" },
          },
        },
        {
          type: "Microsoft.Web/sites",
          name: "[parameters('sites_docs_name')]",
          location: "Australia East",
          kind: "app,linux",
          dependsOn: [planId("serverfarms_ASP_general_adba_name")],
          properties: {
            serverFarmId: planId("serverfarms_ASP_general_adba_name"),
            siteConfig: { linuxFxVersion: "NODE|20-lts" },
          },
        },
        {
          type: "Microsoft.Sql/servers",
          name: "[parameters('servers_sql_name')]",
          location: "australiaeast",
          properties: { administratorLogin: "sqladmin" },
        },
        {
          type: "Microsoft.Sql/servers/databases",
          name: "[concat(parameters('servers_sql_name'), '/orders_db')]",
          location: "australiaeast",
          sku: { name: "GP_S_Gen5", tier: "GeneralPurpose", family: "Gen5", capacity: 2 },
          properties: { collation: "Latin1_General_CI_AS", zoneRedundant: true },
        },
      ],
    };
    const result = parseArmTemplate(JSON.stringify(template));
    if (!result.ok) throw new Error(result.reason);
    const nodes = result.document.nodes;
    const byName = (name: string) => {
      const node = nodes.find((candidate) => candidate.resourceName === name);
      if (!node) throw new Error(`missing ${name}: ${nodes.map((n) => n.resourceName).join(", ")}`);
      return node;
    };

    expect(byName("app-dashboard").parentId).toBe(byName("ASP-general-a897").id);
    expect(byName("app-docs").parentId).toBe(byName("ASP-general-adba").id);
    expect(byName("acrexample").properties).toMatchObject({ sku: "Standard", adminUserEnabled: true, publicNetworkAccess: false });
    expect(byName("orders_db").properties).toMatchObject({ sku: "GP_S_Gen5_2", collation: "Latin1_General_CI_AS", zoneRedundant: true, adminLogin: "sqladmin" });
    expect(byName("Application-Insights-Smart-Detection").type).toBe("actionGroup");
    for (const node of nodes) expect(node.resourceName).toMatch(/^[A-Za-z0-9_.-]+$/);

    expect(byName("ASP-general-a897").properties).toMatchObject({ sku: "P0v3", os: "Linux", capacity: 1 });
    expect(byName("app-dashboard").properties.containerImage).toBe("acrexample.azurecr.io/app-dashboard:latest");
    expect(result.warning).not.toContain("unsupported sku");
    expect(result.warning).toContain('renamed "Application Insights Smart Detection" to "Application-Insights-Smart-Detection"');
    expect(result.warning).toContain("app-dashboard: pulls acrexample.azurecr.io/app-dashboard:latest with registry credentials");
    expect(result.warning).not.toContain("Container Registry acrexample: ARM configuration is not mapped");
    expect(result.warning).not.toContain("Azure SQL Database orders_db: ARM configuration is not mapped");
    expect(result.warning).toContain("Skipped resource types Bunya does not model: Microsoft.Sql/servers x1.");
    expect(result.warning).not.toContain("locations could not be represented");

    // The app pulls with registry credentials, so exports block until an
    // identity edge lets them grant AcrPull instead.
    const blocked = generateTerraform(result.document);
    expect(blocked.ok ? "ok" : blocked.reason).toContain('"app-dashboard" pulls its image from Container Registry "acrexample" without a managed identity');
    const withIdentity = {
      ...result.document,
      edges: [...result.document.edges, { id: "pull", source: byName("app-dashboard").id, target: byName("acrexample").id, kind: "identity" as const }],
    };
    const terraform = generateTerraform(withIdentity);
    if (!terraform.ok) throw new Error(terraform.reason);
    const main = terraform.files.find((file) => file.path === "main.tf")?.content ?? "";
    expect(main).toContain('docker_image_name   = "app-dashboard:latest"');
    expect(main).toContain("container_registry_use_managed_identity = true");
    expect(main).toContain('role_definition_name = "AcrPull"');
  });

  it("imports Flex Consumption, VNet integration, App Insights links and managed-identity registry pulls", () => {
    const template = {
      resources: [
        { type: "Microsoft.Network/virtualNetworks", name: "vnet-app", location: "Australia East", properties: { addressSpace: { addressPrefixes: ["10.1.0.0/16"] } } },
        { type: "Microsoft.Network/virtualNetworks/subnets", name: "vnet-app/snet-integration", properties: { addressPrefix: "10.1.1.0/24" } },
        { type: "Microsoft.OperationalInsights/workspaces", name: "log-app", location: "Australia East", properties: { sku: { name: "PerGB2018" } } },
        {
          type: "Microsoft.Insights/components",
          name: "appi-app",
          location: "Australia East",
          kind: "web",
          tags: { "hidden-link:/subscriptions/x/resourceGroups/rg/providers/Microsoft.Web/sites/fn-flex": "Resource" },
          properties: { Application_Type: "web", WorkspaceResourceId: "[resourceId('Microsoft.OperationalInsights/workspaces', 'log-app')]" },
        },
        { type: "Microsoft.ContainerRegistry/registries", name: "acrapp", location: "Australia East", sku: { name: "Basic" }, properties: {} },
        { type: "Microsoft.Storage/storageAccounts", name: "stflex", location: "Australia East", sku: { name: "Standard_LRS" }, kind: "StorageV2", properties: {} },
        { type: "Microsoft.Web/serverfarms", name: "plan-flex", location: "Australia East", kind: "functionapp", sku: { name: "FC1", tier: "FlexConsumption" }, properties: { reserved: true } },
        { type: "Microsoft.Web/serverfarms", name: "plan-web", location: "Australia East", kind: "linux", sku: { name: "p1v3", capacity: 2 }, properties: { reserved: true } },
        {
          type: "Microsoft.Web/sites",
          name: "fn-flex",
          location: "Australia East",
          kind: "functionapp,linux",
          properties: {
            serverFarmId: "[resourceId('Microsoft.Web/serverfarms', 'plan-flex')]",
            virtualNetworkSubnetId: "[resourceId('Microsoft.Network/virtualNetworks/subnets', 'vnet-app', 'snet-integration')]",
            functionAppConfig: {
              deployment: { storage: { type: "blobContainer", value: "https://stflex.blob.core.windows.net/app-package" } },
              runtime: { name: "python", version: "3.11" },
              scaleAndConcurrency: { instanceMemoryMB: 4096, maximumInstanceCount: 40 },
            },
          },
        },
        {
          type: "Microsoft.Web/sites",
          name: "web-container",
          location: "Australia East",
          kind: "app,linux,container",
          properties: {
            serverFarmId: "[resourceId('Microsoft.Web/serverfarms', 'plan-web')]",
            siteConfig: { linuxFxVersion: "DOCKER|acrapp.azurecr.io/api:1.4", acrUseManagedIdentityCreds: true },
          },
        },
      ],
    };
    const result = parseArmTemplate(JSON.stringify(template));
    if (!result.ok) throw new Error(result.reason);
    const byName = (name: string) => result.document.nodes.find((node) => node.resourceName === name)!;
    const edge = (source: string, target: string, kind: string) =>
      result.document.edges.some((e) => e.source === byName(source).id && e.target === byName(target).id && e.kind === kind);

    expect(byName("plan-flex").properties).toMatchObject({ sku: "FC1", os: "Linux", capacity: 0 });
    expect(byName("plan-web").properties).toMatchObject({ sku: "P1v3", capacity: 2 });
    expect(byName("fn-flex").properties).toMatchObject({
      runtime: "python",
      runtimeVersion: "3.11",
      instanceMemoryMB: 4096,
      maximumInstanceCount: 40,
      vnetIntegration: true,
      consumptionPlan: true,
    });
    expect(byName("web-container").properties.containerImage).toBe("acrapp.azurecr.io/api:1.4");
    expect(edge("fn-flex", "snet-integration", "network")).toBe(true);
    expect(edge("fn-flex", "appi-app", "diagnostic")).toBe(true);
    expect(edge("appi-app", "log-app", "depends_on")).toBe(true);
    expect(edge("web-container", "acrapp", "identity")).toBe(true);
    expect(edge("fn-flex", "stflex", "data")).toBe(true);
    expect(result.warning ?? "").not.toMatch(/unsupported sku|not modelled|container image/);
  });

  it("keeps Windows plans as Windows when the export sets reserved to false", () => {
    const result = parseArmTemplate(JSON.stringify({
      resources: [{ type: "Microsoft.Web/serverfarms", name: "plan-win", location: "australiaeast", kind: "app", sku: { name: "S1", capacity: 1 }, properties: { reserved: false } }],
    }));
    if (!result.ok) throw new Error(result.reason);
    expect(result.document.nodes.find((node) => node.resourceName === "plan-win")?.properties.os).toBe("Windows");
  });

  describe("council review regressions", () => {
    const appInsightsTemplate = (expression: string) => ({
      resources: [
        { type: "Microsoft.Insights/components", name: "appi", location: "australiaeast", kind: "web", properties: { Application_Type: "web" } },
        { type: "Microsoft.Insights/components", name: "appi-other", location: "australiaeast", kind: "web", properties: { Application_Type: "web" } },
        { type: "Microsoft.Web/serverfarms", name: "plan", location: "australiaeast", kind: "linux", sku: { name: "B1" }, properties: { reserved: true } },
        {
          type: "Microsoft.Web/sites",
          name: "web",
          location: "australiaeast",
          kind: "app,linux",
          properties: {
            serverFarmId: "[resourceId('Microsoft.Web/serverfarms', 'plan')]",
            siteConfig: { appSettings: [{ name: "APPLICATIONINSIGHTS_CONNECTION_STRING", value: expression }] },
          },
        },
      ],
    });

    it.each([
      "[reference(resourceId('Microsoft.Insights/components','appi'), '2020-02-02').ConnectionString]",
      "[reference(resourceId('Microsoft.Insights/components', 'appi'), '2020-02-02').ConnectionString]",
      "[reference(resourceId( 'Microsoft.Insights/components' ,  'appi' )).ConnectionString]",
    ])("links an app to App Insights from %s", (expression) => {
      const result = parseArmTemplate(JSON.stringify(appInsightsTemplate(expression)));
      if (!result.ok) throw new Error(result.reason);
      const id = (name: string) => result.document.nodes.find((node) => node.resourceName === name)!.id;
      const diagnostics = result.document.edges.filter((edge) => edge.kind === "diagnostic" && edge.source === id("web"));
      expect(diagnostics.map((edge) => edge.target)).toEqual([id("appi")]);
    });

    const registryTemplate = (identity: Record<string, unknown> | undefined, clientId: string) => ({
      resources: [
        { type: "Microsoft.ContainerRegistry/registries", name: "acrapp", location: "australiaeast", sku: { name: "Basic" }, properties: {} },
        { type: "Microsoft.ManagedIdentity/userAssignedIdentities", name: "id-pull", location: "australiaeast" },
        { type: "Microsoft.Web/serverfarms", name: "plan", location: "australiaeast", kind: "linux", sku: { name: "P1v3" }, properties: { reserved: true } },
        {
          type: "Microsoft.Web/sites",
          name: "web",
          location: "australiaeast",
          kind: "app,linux,container",
          ...(identity ? { identity } : {}),
          properties: {
            serverFarmId: "[resourceId('Microsoft.Web/serverfarms', 'plan')]",
            siteConfig: { linuxFxVersion: "DOCKER|acrapp.azurecr.io/api:1", acrUseManagedIdentityCreds: true, acrUserManagedIdentityID: clientId },
          },
        },
      ],
    });

    it("keeps a user-assigned pull identity referenced by client ID", () => {
      const result = parseArmTemplate(JSON.stringify(registryTemplate({
        type: "UserAssigned",
        userAssignedIdentities: { "[resourceId('Microsoft.ManagedIdentity/userAssignedIdentities', 'id-pull')]": {} },
      }, "6e2a1f4c-9a51-4d1f-8f6d-0f3b2c9d7e11")));
      if (!result.ok) throw new Error(result.reason);
      const id = (name: string) => result.document.nodes.find((node) => node.resourceName === name)!.id;
      const has = (source: string, target: string) => result.document.edges.some((e) => e.source === id(source) && e.target === id(target) && e.kind === "identity");
      expect(has("web", "id-pull")).toBe(true);
      expect(has("id-pull", "acrapp")).toBe(true);
      expect(has("web", "acrapp")).toBe(false);
      expect(result.warning).toContain("assumed it is id-pull, the only user-assigned identity on the app");
    });

    it("does not pin an external pull identity to an unrelated identity in the template", () => {
      const template = registryTemplate({
        type: "UserAssigned",
        userAssignedIdentities: { "/subscriptions/x/resourceGroups/shared/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-shared": {} },
      }, "6e2a1f4c-9a51-4d1f-8f6d-0f3b2c9d7e11");
      template.resources[1] = { type: "Microsoft.ManagedIdentity/userAssignedIdentities", name: "id-unrelated", location: "australiaeast" };
      const result = parseArmTemplate(JSON.stringify(template));
      if (!result.ok) throw new Error(result.reason);
      const id = (name: string) => result.document.nodes.find((node) => node.resourceName === name)!.id;
      const identityEdges = result.document.edges.filter((e) => e.kind === "identity");
      expect(identityEdges.some((e) => e.source === id("web") || e.target === id("acrapp"))).toBe(false);
      expect(result.warning).toContain("which is not in this template");
    });

    it("does not match an external identity whose name starts with a local identity's name", () => {
      const template = registryTemplate({
        type: "UserAssigned",
        userAssignedIdentities: { "/subscriptions/x/resourceGroups/shared/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-pull-external": {} },
      }, "6e2a1f4c-9a51-4d1f-8f6d-0f3b2c9d7e11");
      const result = parseArmTemplate(JSON.stringify(template));
      if (!result.ok) throw new Error(result.reason);
      const id = (name: string) => result.document.nodes.find((node) => node.resourceName === name)!.id;
      expect(result.document.edges.some((e) => e.kind === "identity" && (e.source === id("web") || e.target === id("acrapp")))).toBe(false);
      expect(result.warning).toContain("which is not in this template");
    });

    it("warns instead of granting AcrPull to the system identity when the pull identity is unknown", () => {
      const result = parseArmTemplate(JSON.stringify(registryTemplate(undefined, "6e2a1f4c-9a51-4d1f-8f6d-0f3b2c9d7e11")));
      if (!result.ok) throw new Error(result.reason);
      const id = (name: string) => result.document.nodes.find((node) => node.resourceName === name)!.id;
      expect(result.document.edges.some((e) => e.source === id("web") && e.target === id("acrapp") && e.kind === "identity")).toBe(false);
      expect(result.warning).toContain("user-assigned identity 6e2a1f4c-9a51-4d1f-8f6d-0f3b2c9d7e11, which is not in this template");
    });
  });

  it("round-trips VNet custom DNS servers through export and import", async () => {
    const { hostingGraph } = await import("@/lib/generators/__fixtures__/hosting");
    const { generateArm } = await import("@/lib/generators/arm");
    const custom = {
      ...hostingGraph,
      nodes: hostingGraph.nodes.map((node) => (node.id === "vnet" ? { ...node, properties: { ...node.properties, dnsServers: ["10.20.0.4", "10.20.0.5"] } } : node)),
    };
    const exported = generateArm(custom);
    if (!exported.ok) throw new Error(exported.reason);
    const imported = parseArmTemplate(exported.files[0].content);
    if (!imported.ok) throw new Error(imported.reason);
    expect(imported.document.nodes.find((node) => node.type === "virtualNetwork")?.properties.dnsServers).toEqual(["10.20.0.4", "10.20.0.5"]);
  });

  it("keeps globally unique names when re-importing an export", async () => {
    const { hostingGraph } = await import("@/lib/generators/__fixtures__/hosting");
    const { generateArm } = await import("@/lib/generators/arm");
    const names = (template: string) =>
      (JSON.parse(template).resources as { type: string; name: string }[])
        .filter((resource) => /storageAccounts$|vaults$/.test(resource.type))
        .map((resource) => resource.name)
        .sort();
    const first = generateArm(hostingGraph);
    if (!first.ok) throw new Error(first.reason);
    const imported = parseArmTemplate(first.files[0].content);
    if (!imported.ok) throw new Error(imported.reason);
    const second = generateArm(imported.document);
    if (!second.ok) throw new Error(second.reason);
    expect(names(second.files[0].content)).toEqual(names(first.files[0].content));
    expect(imported.warning).toContain("rename them in the inspector to deploy a separate copy");
  });
});
