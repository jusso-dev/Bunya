import { validateGeneration } from "./shared/validate";
import { GraphDocument, GraphNode, ServiceType } from "@/lib/graph/schema";
import {
  GeneratorContext,
  buildGeneratorContext,
  incomingOf,
  outgoingOf,
  resolveVirtualNetwork,
} from "./shared/context";
import { GeneratedFile, GeneratorResult } from "./types";
import { expr, planBody, siteBody, toArm, type Refs } from "./shared/site-resource";
import { contentShareName, siteHosting } from "./shared/hosting";
import { ROLE_DEFINITION_IDS, defaultRoleNameFor } from "./shared/roles";
import { subnetDelegations } from "@/lib/graph/topology";
import { storagePublicNetwork } from "@/lib/catalogue/services";

type ArmResource = {
  type: string;
  apiVersion: string;
  name: string;
  location?: string;
  scope?: string;
  sku?: Record<string, unknown>;
  kind?: string;
  identity?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  tags?: Record<string, string>;
  dependsOn?: string[];
  resources?: ArmResource[];
};

function tags(ctx: GeneratorContext, node: GraphNode): Record<string, string> {
  const userTags = (node.properties.tags as Record<string, string> | undefined) ?? {};
  return {
    environment: ctx.document.metadata.environment,
    managed_by: "bunya",
    ...userTags,
  };
}

function resourceId(type: string, name: string): string {
  return `[resourceId('${type}', '${name}')]`;
}

function resourceName(ctx: GeneratorContext, id: string): string {
  return ctx.resourceNames.get(id) ?? id;
}

function dependsOn(ctx: GeneratorContext, node: GraphNode, ...refs: string[]): string[] | undefined {
  const auto = outgoingOf(ctx, node.id, "depends_on")
    .map((e) => ctx.nodesById.get(e.target))
    .filter((n): n is GraphNode => !!n)
    .map((n) => armResourceId(n, ctx));
  const list = [...auto, ...refs].filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function armResourceId(node: GraphNode, ctx: GeneratorContext): string {
  const map: Partial<Record<ServiceType, string>> = {
    resourceGroup: "",
    virtualNetwork: "Microsoft.Network/virtualNetworks",
    subnet: "Microsoft.Network/virtualNetworks/subnets",
    networkSecurityGroup: "Microsoft.Network/networkSecurityGroups",
    privateEndpoint: "Microsoft.Network/privateEndpoints",
    privateDnsZone: "Microsoft.Network/privateDnsZones",
    appServicePlan: "Microsoft.Web/serverfarms",
    appService: "Microsoft.Web/sites",
    functionApp: "Microsoft.Web/sites",
    staticWebApp: "Microsoft.Web/staticSites",
    aksCluster: "Microsoft.ContainerService/managedClusters",
    virtualMachineScaleSet: "Microsoft.Compute/virtualMachineScaleSets",
    storageAccount: "Microsoft.Storage/storageAccounts",
    sqlDatabase: "Microsoft.Sql/servers/databases",
    cosmosDb: "Microsoft.DocumentDB/databaseAccounts",
    keyVault: "Microsoft.KeyVault/vaults",
    applicationInsights: "Microsoft.Insights/components",
    logAnalytics: "Microsoft.OperationalInsights/workspaces",
    monitorAlert: "Microsoft.Insights/metricAlerts",
    actionGroup: "Microsoft.Insights/actionGroups",
    frontDoor: "Microsoft.Cdn/profiles",
    applicationGateway: "Microsoft.Network/applicationGateways",
    apiManagement: "Microsoft.ApiManagement/service",
    containerRegistry: "Microsoft.ContainerRegistry/registries",
    userAssignedIdentity: "Microsoft.ManagedIdentity/userAssignedIdentities",
    roleAssignment: "Microsoft.Authorization/roleAssignments",
  };
  const t = map[node.type];
  if (!t) return "";
  const resolved = resourceName(ctx, node.id);
  if (node.type === "subnet") {
    const parent = resolveVirtualNetwork(ctx, node);
    return `[resourceId('${t}', '${parent ? resourceName(ctx, parent.id) : "main-vnet"}', '${resolved}')]`;
  }
  if (node.type === "sqlDatabase") return `[resourceId('${t}', '${resolved}-srv', '${resolved}')]`;
  return `[resourceId('${t}', '${resolved}')]`;
}

function emitVirtualNetwork(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.Network/virtualNetworks",
    apiVersion: "2023-11-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    tags: tags(ctx, node),
    properties: {
      addressSpace: {
        addressPrefixes: [(node.properties.addressSpace as string) ?? "10.0.0.0/16"],
      },
      ...(Array.isArray(node.properties.dnsServers) && (node.properties.dnsServers as string[]).length > 0
        ? { dhcpOptions: { dnsServers: node.properties.dnsServers as string[] } }
        : {}),
    },
  };
}

function emitSubnet(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const vnet = resolveVirtualNetwork(ctx, node);
  const vnetName = vnet ? resourceName(ctx, vnet.id) : "main-vnet";
  return {
    type: "Microsoft.Network/virtualNetworks/subnets",
    apiVersion: "2023-11-01",
    name: `${vnetName}/${resourceName(ctx, node.id)}`,
    properties: {
      addressPrefix: (node.properties.addressPrefix as string) ?? "10.0.1.0/24",
      privateEndpointNetworkPolicies:
        (node.properties.privateEndpointNetworkPolicies as string) ?? "Disabled",
      ...(subnetDelegations(ctx.document, node).length > 0
        ? { delegations: subnetDelegations(ctx.document, node).map((service) => ({ name: service.split("/")[1], properties: { serviceName: service } })) }
        : {}),
    },
    dependsOn: [resourceId("Microsoft.Network/virtualNetworks", vnetName)],
  };
}

function emitNsg(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.Network/networkSecurityGroups",
    apiVersion: "2023-11-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    tags: tags(ctx, node),
    properties: { securityRules: [] },
  };
}

function emitPrivateEndpoint(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const subnetEdge = outgoingOf(ctx, node.id, "network").find(
    (e) => ctx.nodesById.get(e.target)?.type === "subnet",
  );
  const targetEdge = outgoingOf(ctx, node.id, "network").find(
    (e) => ctx.nodesById.get(e.target)?.type !== "subnet",
  );
  const groupId = (node.properties.groupId as string) ?? "blob";
  const subnetId = subnetArmId(ctx, subnetEdge?.target);
  const targetId = targetEdge
    ? armResourceId(ctx.nodesById.get(targetEdge.target)!, ctx)
    : null;
  const dnsEdges = outgoingOf(ctx, node.id, "network").filter(
    (e) => ctx.nodesById.get(e.target)?.type === "privateDnsZone",
  );
  return {
    type: "Microsoft.Network/privateEndpoints",
    apiVersion: "2023-11-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    tags: tags(ctx, node),
    properties: {
      subnet: { id: subnetId },
      privateLinkServiceConnections: [
        {
          name: `${resourceName(ctx, node.id)}-psc`,
          properties: {
            privateLinkServiceId: targetId,
            groupIds: [groupId],
          },
        },
      ],
    },
    resources: dnsEdges.length > 0
      ? [
          {
            type: "privateDnsZoneGroups",
            apiVersion: "2023-11-01",
            name: "default",
            properties: {
              privateDnsZoneConfigs: dnsEdges.map((edge) => ({
                name: resourceName(ctx, edge.target),
                properties: {
                  privateDnsZoneId: resourceId(
                    "Microsoft.Network/privateDnsZones",
                    (ctx.nodesById.get(edge.target)?.properties.zoneName as string | undefined) ??
                      resourceName(ctx, edge.target),
                  ),
                },
              })),
            },
          },
        ]
      : undefined,
  };
}

function emitPrivateDnsZone(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const vnetEdges = outgoingOf(ctx, node.id, "network").filter(
    (e) => ctx.nodesById.get(e.target)?.type === "virtualNetwork",
  );
  return {
    type: "Microsoft.Network/privateDnsZones",
    apiVersion: "2020-06-01",
    name: (node.properties.zoneName as string) ?? resourceName(ctx, node.id),
    location: "global",
    tags: tags(ctx, node),
    resources: vnetEdges.map((edge) => ({
      type: "virtualNetworkLinks",
      apiVersion: "2020-06-01",
      name: `${resourceName(ctx, edge.target)}-link`,
      location: "global",
      properties: {
        registrationEnabled: false,
        virtualNetwork: {
          id: resourceId("Microsoft.Network/virtualNetworks", resourceName(ctx, edge.target)),
        },
      },
    })),
  };
}

function armRefs(ctx: GeneratorContext): Refs {
  const storageName = (storage: GraphNode | null) => (storage ? resourceName(ctx, storage.id) : "mainstorage");
  return {
    id: (node) => expr("", armResourceId(node, ctx).slice(1, -1)),
    name: (node) => resourceName(ctx, node.id),
    storageConnectionString: (storage) => {
      const st = storageName(storage);
      return expr("", `concat('DefaultEndpointsProtocol=https;AccountName=${st};EndpointSuffix=', environment().suffixes.storage, ';AccountKey=', listKeys(resourceId('Microsoft.Storage/storageAccounts','${st}'),'2023-05-01').keys[0].value)`);
    },
    blobEndpoint: (storage) => expr("", `reference(resourceId('Microsoft.Storage/storageAccounts', '${storageName(storage)}'), '2023-05-01').primaryEndpoints.blob`),
    appInsightsConnectionString: (component) => expr("", `reference(resourceId('Microsoft.Insights/components', '${resourceName(ctx, component.id)}'), '2020-02-02').ConnectionString`),
    userIdentityClientId: (identity) => expr("", `reference(resourceId('Microsoft.ManagedIdentity/userAssignedIdentities', '${resourceName(ctx, identity.id)}'), '2023-01-31').clientId`),
  };
}

function emitAppServicePlan(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const body = planBody(node);
  return {
    type: "Microsoft.Web/serverfarms",
    apiVersion: "2024-04-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    kind: body.kind,
    sku: toArm(body.sku) as Record<string, unknown>,
    properties: toArm(body.properties) as Record<string, unknown>,
    tags: tags(ctx, node),
  };
}

function emitSite(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const body = siteBody(ctx, node, armRefs(ctx));
  const flex = node.type === "functionApp" && body.hosting.family === "flex";
  const storageName = body.hosting.storage ? resourceName(ctx, body.hosting.storage.id) : "mainstorage";
  const containerId = `[resourceId('Microsoft.Storage/storageAccounts/blobServices/containers', '${storageName}', 'default', '${body.hosting.deploymentContainer}')]`;
  if (flex) {
    const config = (body.properties.functionAppConfig as Record<string, Record<string, Record<string, unknown>>>).deployment.storage;
    config.value = expr("", `concat(reference(resourceId('Microsoft.Storage/storageAccounts', '${storageName}'), '2023-05-01').primaryEndpoints.blob, '${body.hosting.deploymentContainer}')`);
  }
  const resource: ArmResource = {
    type: "Microsoft.Web/sites",
    apiVersion: "2024-04-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    kind: body.kind,
    identity: toArm(body.identity) as Record<string, unknown>,
    properties: toArm(body.properties) as Record<string, unknown>,
    tags: tags(ctx, node),
    dependsOn: [...new Set([
      ...body.dependsOn.map((dep) => armResourceId(dep, ctx)),
      ...(flex ? [containerId] : []),
      ...(acrPullGrantId(ctx, body.hosting) ?? []),
      ...(contentShareId(ctx, node, body.hosting) ? [contentShareId(ctx, node, body.hosting)!] : []),
    ])],
  };
  return resource;
}

// A user-assigned pull identity can be granted AcrPull before the site
// exists, so order the site after the grant; the first pull then succeeds.
function acrPullGrantId(ctx: GeneratorContext, hosting: ReturnType<typeof siteHosting>): string[] | null {
  if (!hosting.registry || hosting.pullIdentity?.kind !== "user") return null;
  const identity = hosting.pullIdentity.node;
  const registryId = armResourceId(hosting.registry, ctx);
  const name = `guid(${registryId.slice(1, -1)}, '${resourceName(ctx, identity.id)}', 'AcrPull')`;
  return [`[extensionResourceId(${registryId.slice(1, -1)}, 'Microsoft.Authorization/roleAssignments', ${name})]`];
}

// Secured storage: the content share must exist before the app is created.
function contentShareId(ctx: GeneratorContext, node: GraphNode, hosting: ReturnType<typeof siteHosting>): string | null {
  if (!hosting.privateContentShare) return null;
  const storageName = hosting.storage ? resourceName(ctx, hosting.storage.id) : "mainstorage";
  return `[resourceId('Microsoft.Storage/storageAccounts/fileServices/shares', '${storageName}', 'default', '${contentShareName(ctx, node)}')]`;
}

function contentShares(ctx: GeneratorContext): ArmResource[] {
  return ctx.document.nodes
    .filter((node) => node.type === "functionApp")
    .map((node) => ({ node, hosting: siteHosting(ctx, node) }))
    .filter(({ hosting }) => hosting.privateContentShare)
    .map(({ node, hosting }) => {
      const storageName = hosting.storage ? resourceName(ctx, hosting.storage.id) : "mainstorage";
      return {
        type: "Microsoft.Storage/storageAccounts/fileServices/shares",
        apiVersion: "2023-05-01",
        name: `${storageName}/default/${contentShareName(ctx, node)}`,
        properties: {},
        dependsOn: [resourceId("Microsoft.Storage/storageAccounts", storageName)],
      };
    });
}

// Flex Consumption deploys packages from this blob container.
function flexDeploymentContainers(ctx: GeneratorContext): ArmResource[] {
  return ctx.document.nodes
    .filter((node) => node.type === "functionApp")
    .map((node) => siteHosting(ctx, node))
    .filter((hosting) => hosting.family === "flex")
    .map((hosting) => {
      const storageName = hosting.storage ? resourceName(ctx, hosting.storage.id) : "mainstorage";
      return {
        type: "Microsoft.Storage/storageAccounts/blobServices/containers",
        apiVersion: "2023-05-01",
        name: `${storageName}/default/${hosting.deploymentContainer}`,
        properties: { publicAccess: "None" },
        dependsOn: [resourceId("Microsoft.Storage/storageAccounts", storageName)],
      };
    });
}

const emitAppService = emitSite;
const emitFunctionApp = emitSite;

function emitStaticWebApp(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const sku = (node.properties.sku as string) ?? "Standard";
  return {
    type: "Microsoft.Web/staticSites",
    apiVersion: "2023-12-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    sku: { name: sku, tier: sku },
    properties: {},
    tags: tags(ctx, node),
  };
}

function subnetArmId(ctx: GeneratorContext, subnetId?: string): string {
  if (!subnetId) {
    return "[resourceId('Microsoft.Network/virtualNetworks/subnets', 'main-vnet', 'main-subnet')]";
  }
  const subnetName = resourceName(ctx, subnetId);
  const subnet = ctx.nodesById.get(subnetId);
  const vnet = subnet ? resolveVirtualNetwork(ctx, subnet) : null;
  const vnetName = vnet ? resourceName(ctx, vnet.id) : "main-vnet";
  return `[resourceId('Microsoft.Network/virtualNetworks/subnets', '${vnetName}', '${subnetName}')]`;
}

function emitAksCluster(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const subnetEdge = outgoingOf(ctx, node.id, "network").find(
    (e) => ctx.nodesById.get(e.target)?.type === "subnet",
  );
  const workspaceEdge = outgoingOf(ctx, node.id, "diagnostic").find(
    (e) => ctx.nodesById.get(e.target)?.type === "logAnalytics",
  );
  const authorizedRanges = (node.properties.authorizedIpRanges as string[] | undefined) ?? [];
  const privateCluster = node.properties.privateCluster === true;
  const properties: Record<string, unknown> = {
    dnsPrefix: (node.properties.dnsPrefix as string) || resourceName(ctx, node.id),
    enableRBAC: true,
    agentPoolProfiles: [
      {
        name: "system",
        count: (node.properties.nodeCount as number) ?? 3,
        vmSize: (node.properties.nodeVmSize as string) ?? "Standard_D2s_v5",
        osType: "Linux",
        mode: "System",
        type: "VirtualMachineScaleSets",
        ...(subnetEdge ? { vnetSubnetID: subnetArmId(ctx, subnetEdge.target) } : {}),
      },
    ],
    networkProfile: {
      networkPlugin: (node.properties.networkPlugin as string) ?? "azure",
      networkPolicy:
        (node.properties.networkPolicy as string) === "none"
          ? undefined
          : ((node.properties.networkPolicy as string) ?? "azure"),
      loadBalancerSku: "standard",
    },
    apiServerAccessProfile: {
      enablePrivateCluster: privateCluster,
      ...(authorizedRanges.length > 0 && !privateCluster
        ? { authorizedIPRanges: authorizedRanges }
        : {}),
    },
  };
  if (workspaceEdge) {
    properties.addonProfiles = {
      omsagent: {
        enabled: true,
        config: {
          logAnalyticsWorkspaceResourceID: resourceId(
            "Microsoft.OperationalInsights/workspaces",
            resourceName(ctx, workspaceEdge.target),
          ),
        },
      },
    };
  }
  return {
    type: "Microsoft.ContainerService/managedClusters",
    apiVersion: "2024-07-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    identity: { type: node.properties.managedIdentity === false ? "None" : "SystemAssigned" },
    properties,
    tags: tags(ctx, node),
  };
}

function emitVmss(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const subnetEdge = outgoingOf(ctx, node.id, "network").find(
    (e) => ctx.nodesById.get(e.target)?.type === "subnet",
  );
  const sku = (node.properties.sku as string) ?? "Standard_B2s";
  const capacity = (node.properties.capacity as number) ?? 2;
  return {
    type: "Microsoft.Compute/virtualMachineScaleSets",
    apiVersion: "2024-07-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    sku: { name: sku, tier: "Standard", capacity },
    identity: { type: "SystemAssigned" },
    properties: {
      orchestrationMode: (node.properties.orchestrationMode as string) ?? "Flexible",
      upgradePolicy: {
        mode: (node.properties.upgradeMode as string) ?? "Automatic",
      },
      automaticRepairsPolicy: {
        enabled: node.properties.automaticRepairs !== false,
        gracePeriod: "PT30M",
      },
      virtualMachineProfile: {
        storageProfile: {
          imageReference: {
            publisher: (node.properties.imagePublisher as string) ?? "Canonical",
            offer: (node.properties.imageOffer as string) ?? "0001-com-ubuntu-server-jammy",
            sku: (node.properties.imageSku as string) ?? "22_04-lts-gen2",
            version: "latest",
          },
          osDisk: {
            createOption: "FromImage",
            managedDisk: { storageAccountType: "Premium_LRS" },
          },
        },
        osProfile: {
          computerNamePrefix: resourceName(ctx, node.id).slice(0, 9),
          adminUsername: "[parameters('vmAdminUsername')]",
          linuxConfiguration: {
            disablePasswordAuthentication: true,
            ssh: {
              publicKeys: [
                {
                  path: "[format('/home/{0}/.ssh/authorized_keys', parameters('vmAdminUsername'))]",
                  keyData: "[parameters('vmSshPublicKey')]",
                },
              ],
            },
          },
        },
        networkProfile: {
          networkInterfaceConfigurations: [
            {
              name: "nic",
              properties: {
                primary: true,
                ipConfigurations: [
                  {
                    name: "ipconfig1",
                    properties: {
                      subnet: { id: subnetArmId(ctx, subnetEdge?.target) },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
    tags: tags(ctx, node),
  };
}

function emitStorage(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const tls = (node.properties.minTlsVersion as string) ?? "1.2";
  const allowPublic = node.properties.allowPublicAccess === true;
  return {
    type: "Microsoft.Storage/storageAccounts",
    apiVersion: "2023-05-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    kind: (node.properties.kind as string) ?? "StorageV2",
    sku: { name: (node.properties.sku as string) ?? "Standard_LRS" },
    properties: {
      minimumTlsVersion: `TLS1_${tls.split(".")[1]}`,
      allowBlobPublicAccess: allowPublic,
      publicNetworkAccess: storagePublicNetwork(node.properties) ? "Enabled" : "Disabled",
      supportsHttpsTrafficOnly: true,
    },
    tags: tags(ctx, node),
  };
}

function emitSqlDatabase(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const serverName = `${resourceName(ctx, node.id)}-srv`;
  return {
    type: "Microsoft.Sql/servers",
    apiVersion: "2023-08-01-preview",
    name: serverName,
    location: "[parameters('location')]",
    properties: {
      administratorLogin: (node.properties.adminLogin as string) ?? "bunyaadmin",
      administratorLoginPassword: "[parameters('sqlAdminPassword')]",
      minimalTlsVersion: "1.2",
      publicNetworkAccess: "Disabled",
    },
    tags: tags(ctx, node),
    resources: [
      {
        type: "databases",
        apiVersion: "2023-08-01-preview",
        name: resourceName(ctx, node.id),
        location: "[parameters('location')]",
        sku: { name: (node.properties.sku as string) ?? "S0" },
        dependsOn: [resourceId("Microsoft.Sql/servers", serverName)],
      },
    ],
  };
}

function emitCosmos(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.DocumentDB/databaseAccounts",
    apiVersion: "2024-05-15",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    kind: "GlobalDocumentDB",
    properties: {
      databaseAccountOfferType: "Standard",
      enableFreeTier: node.properties.freeTier === true,
      consistencyPolicy: {
        defaultConsistencyLevel: (node.properties.consistency as string) ?? "Session",
      },
      locations: [{ locationName: "[parameters('location')]", failoverPriority: 0 }],
    },
    tags: tags(ctx, node),
  };
}

function emitKeyVault(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.KeyVault/vaults",
    apiVersion: "2023-07-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    properties: {
      sku: { family: "A", name: (node.properties.sku as string) ?? "standard" },
      tenantId: "[subscription().tenantId]",
      enablePurgeProtection: node.properties.purgeProtection !== false,
      softDeleteRetentionInDays: (node.properties.softDeleteRetentionDays as number) ?? 7,
      enableRbacAuthorization: node.properties.rbacAuthorization !== false,
      publicNetworkAccess:
        node.properties.publicNetworkAccess === true ? "Enabled" : "Disabled",
    },
    tags: tags(ctx, node),
  };
}

function emitAppInsights(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const workspaceEdge = outgoingOf(ctx, node.id, "depends_on").find(
    (e) => ctx.nodesById.get(e.target)?.type === "logAnalytics",
  );
  return {
    type: "Microsoft.Insights/components",
    apiVersion: "2020-02-02",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    kind: "web",
    properties: {
      Application_Type: "web",
      WorkspaceResourceId: workspaceEdge
        ? resourceId(
            "Microsoft.OperationalInsights/workspaces",
            resourceName(ctx, workspaceEdge.target),
          )
        : null,
    },
    tags: tags(ctx, node),
  };
}

function emitLogAnalytics(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.OperationalInsights/workspaces",
    apiVersion: "2023-09-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    properties: {
      sku: { name: (node.properties.sku as string) ?? "PerGB2018" },
      retentionInDays: (node.properties.retentionDays as number) ?? 30,
    },
    tags: tags(ctx, node),
  };
}

function emitActionGroup(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.Insights/actionGroups",
    apiVersion: "2023-01-01",
    name: resourceName(ctx, node.id),
    location: "global",
    properties: {
      groupShortName: (node.properties.shortName as string) ?? "ops",
      enabled: true,
      emailReceivers: [
        {
          name: "ops",
          emailAddress: (node.properties.email as string) ?? "ops@example.com",
          useCommonAlertSchema: true,
        },
      ],
    },
    tags: tags(ctx, node),
  };
}

function emitMonitorAlert(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const scopeEdges = outgoingOf(ctx, node.id, "diagnostic").filter(
    (e) => ctx.nodesById.get(e.target)?.type !== "actionGroup",
  );
  const actionEdges = outgoingOf(ctx, node.id, "depends_on").filter(
    (e) => ctx.nodesById.get(e.target)?.type === "actionGroup",
  );
  return {
    type: "Microsoft.Insights/metricAlerts",
    apiVersion: "2018-03-01",
    name: resourceName(ctx, node.id),
    location: "global",
    properties: {
      description: (node.properties.condition as string) ?? "Platform metric threshold",
      severity: 2,
      enabled: node.properties.enabled !== false,
      scopes:
        scopeEdges.length > 0
          ? scopeEdges.map((edge) => armResourceId(ctx.nodesById.get(edge.target)!, ctx).slice(1, -1))
          : ["[resourceGroup().id]"],
      evaluationFrequency: "PT5M",
      windowSize: "PT5M",
      criteria: {
        "odata.type": "Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria",
        allOf: [],
      },
      actions: actionEdges.map((edge) => ({
        actionGroupId: resourceId("Microsoft.Insights/actionGroups", resourceName(ctx, edge.target)),
      })),
    },
    tags: tags(ctx, node),
  };
}

function emitFrontDoor(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.Cdn/profiles",
    apiVersion: "2024-02-01",
    name: resourceName(ctx, node.id),
    location: "global",
    sku: { name: (node.properties.sku as string) ?? "Standard_AzureFrontDoor" },
    tags: tags(ctx, node),
  };
}

function emitApplicationGateway(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const sku = (node.properties.sku as string) ?? "WAF_v2";
  return {
    type: "Microsoft.Network/applicationGateways",
    apiVersion: "2023-11-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    properties: {
      sku: { name: sku, tier: sku, capacity: (node.properties.capacity as number) ?? 2 },
      gatewayIPConfigurations: [],
      frontendIPConfigurations: [],
      frontendPorts: [],
      backendAddressPools: [],
      backendHttpSettingsCollection: [],
      httpListeners: [],
      requestRoutingRules: [],
    },
    tags: tags(ctx, node),
  };
}

function emitApim(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.ApiManagement/service",
    apiVersion: "2023-09-01-preview",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    sku: { name: (node.properties.sku as string) ?? "Consumption", capacity: 0 },
    properties: {
      publisherName: (node.properties.publisherName as string) ?? "Bunya",
      publisherEmail: (node.properties.publisherEmail as string) ?? "ops@example.com",
    },
    tags: tags(ctx, node),
  };
}

function emitContainerRegistry(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.ContainerRegistry/registries",
    apiVersion: "2023-11-01-preview",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    sku: { name: (node.properties.sku as string) ?? "Basic" },
    properties: {
      adminUserEnabled: node.properties.adminUserEnabled === true,
      publicNetworkAccess: node.properties.publicNetworkAccess === false ? "Disabled" : "Enabled",
    },
    tags: tags(ctx, node),
  };
}

function emitUserAssignedIdentity(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.ManagedIdentity/userAssignedIdentities",
    apiVersion: "2023-01-31",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    properties: {},
    tags: tags(ctx, node),
  };
}

function principalIdExpression(source: GraphNode, ctx: GeneratorContext): string | undefined {
  const sourceName = resourceName(ctx, source.id);
  switch (source.type) {
    case "userAssignedIdentity":
      return `[reference(resourceId('Microsoft.ManagedIdentity/userAssignedIdentities','${sourceName}'), '2023-01-31').principalId]`;
    case "appService":
    case "functionApp":
      return `[reference(resourceId('Microsoft.Web/sites','${sourceName}'), '2024-04-01', 'Full').identity.principalId]`;
    case "aksCluster":
      return `[reference(resourceId('Microsoft.ContainerService/managedClusters','${sourceName}'), '2024-07-01', 'Full').identity.principalId]`;
    case "virtualMachineScaleSet":
      return `[reference(resourceId('Microsoft.Compute/virtualMachineScaleSets','${sourceName}'), '2024-07-01', 'Full').identity.principalId]`;
    default:
      return undefined;
  }
}

function emitRoleAssignmentNode(node: GraphNode, ctx: GeneratorContext): ArmResource | null {
  const principal = incomingOf(ctx, node.id, "identity")
    .map((edge) => ctx.nodesById.get(edge.source))
    .find((source): source is GraphNode => !!source);
  const scope = outgoingOf(ctx, node.id, "identity")
    .map((edge) => ctx.nodesById.get(edge.target))
    .find((target): target is GraphNode => !!target);
  if (!principal || !scope) return null;
  const roleName = (node.properties.roleDefinitionName as string) ?? defaultRoleNameFor(scope);
  const principalId = principalIdExpression(principal, ctx);
  if (!principalId) return null;
  return {
    type: "Microsoft.Authorization/roleAssignments",
    apiVersion: "2022-04-01",
    scope: armResourceId(scope, ctx),
    name: `[guid(${armResourceId(scope, ctx).slice(1, -1)}, '${resourceName(ctx, principal.id)}', '${roleName}')]`,
    properties: {
      roleDefinitionId:
        `[subscriptionResourceId('Microsoft.Authorization/roleDefinitions','${ROLE_DEFINITION_IDS[roleName] ?? ROLE_DEFINITION_IDS.Reader}')]`,
      principalId,
      principalType: "ServicePrincipal",
    },
    dependsOn: [armResourceId(scope, ctx), armResourceId(principal, ctx)],
  };
}

function emitRoleAssignments(ctx: GeneratorContext): ArmResource[] {
  const out: ArmResource[] = [];
  for (const edge of ctx.edges) {
    if (edge.kind !== "identity") continue;
    const source = ctx.nodesById.get(edge.source);
    const target = ctx.nodesById.get(edge.target);
    if (!source || !target) continue;
    if (source.type === "roleAssignment" || target.type === "roleAssignment") continue;
    // A site -> user-assigned identity edge attaches the identity; it grants nothing.
    if (target.type === "userAssignedIdentity") continue;
    const principalId = principalIdExpression(source, ctx);
    if (!principalId) continue;
    const roleName = defaultRoleNameFor(target);
    out.push({
      type: "Microsoft.Authorization/roleAssignments",
      apiVersion: "2022-04-01",
      scope: armResourceId(target, ctx),
      name: `[guid(${armResourceId(target, ctx).slice(1, -1)}, '${resourceName(ctx, source.id)}', '${roleName}')]`,
      properties: {
        roleDefinitionId:
          `[subscriptionResourceId('Microsoft.Authorization/roleDefinitions','${ROLE_DEFINITION_IDS[roleName] ?? ROLE_DEFINITION_IDS.Reader}')]`,
        principalId,
        principalType: "ServicePrincipal",
      },
      dependsOn: [armResourceId(target, ctx), armResourceId(source, ctx)],
    });
  }
  for (const node of ctx.document.nodes.filter((n) => n.type === "roleAssignment")) {
    const explicit = emitRoleAssignmentNode(node, ctx);
    if (explicit) out.push(explicit);
  }
  return out;
}

function emitDiagnosticSettings(ctx: GeneratorContext): ArmResource[] {
  const out: ArmResource[] = [];
  for (const edge of ctx.edges) {
    if (edge.kind !== "diagnostic") continue;
    const source = ctx.nodesById.get(edge.source);
    const target = ctx.nodesById.get(edge.target);
    if (!source || !target || target.type !== "logAnalytics") continue;
    const sId = armResourceId(source, ctx).slice(1, -1);
    out.push({
      type: "Microsoft.Insights/diagnosticSettings",
      apiVersion: "2021-05-01-preview",
      name: `[concat('${source.resourceName}-to-${target.resourceName}')]`,
      properties: {
        workspaceId: resourceId(
          "Microsoft.OperationalInsights/workspaces",
          target.resourceName,
        ),
        logs: [{ categoryGroup: "allLogs", enabled: true }],
        metrics: [{ category: "AllMetrics", enabled: true }],
      },
      dependsOn: [sId],
    });
  }
  return out;
}

const EMITTERS: Partial<Record<ServiceType, (node: GraphNode, ctx: GeneratorContext) => ArmResource>> = {
  virtualNetwork: emitVirtualNetwork,
  subnet: emitSubnet,
  networkSecurityGroup: emitNsg,
  privateEndpoint: emitPrivateEndpoint,
  privateDnsZone: emitPrivateDnsZone,
  appServicePlan: emitAppServicePlan,
  appService: emitAppService,
  functionApp: emitFunctionApp,
  staticWebApp: emitStaticWebApp,
  aksCluster: emitAksCluster,
  virtualMachineScaleSet: emitVmss,
  storageAccount: emitStorage,
  sqlDatabase: emitSqlDatabase,
  cosmosDb: emitCosmos,
  keyVault: emitKeyVault,
  applicationInsights: emitAppInsights,
  logAnalytics: emitLogAnalytics,
  monitorAlert: emitMonitorAlert,
  actionGroup: emitActionGroup,
  frontDoor: emitFrontDoor,
  applicationGateway: emitApplicationGateway,
  apiManagement: emitApim,
  containerRegistry: emitContainerRegistry,
  userAssignedIdentity: emitUserAssignedIdentity,
};

export function generateArm(document: GraphDocument): GeneratorResult {
  const validated = validateGeneration(document);
  if (!validated.ok) return validated;
  document = validated.document;
  const ctx = buildGeneratorContext(document);
  if (!ctx.topo.ok) {
    return { ok: false, reason: "cycle detected", cycle: ctx.topo.cycle };
  }
  const resources: ArmResource[] = [];
  for (const node of ctx.topo.order) {
    const emit = EMITTERS[node.type];
    if (!emit) continue;
    const resource = emit(node, ctx);
    const deps = dependsOn(ctx, node);
    if (deps) resource.dependsOn = [...(resource.dependsOn ?? []), ...deps];
    resources.push(resource);
  }
  resources.push(...flexDeploymentContainers(ctx));
  resources.push(...contentShares(ctx));
  resources.push(...emitRoleAssignments(ctx));
  resources.push(...emitDiagnosticSettings(ctx));

  const hasSql = ctx.document.nodes.some((n) => n.type === "sqlDatabase");
  const hasVmss = ctx.document.nodes.some((n) => n.type === "virtualMachineScaleSet");
  const templateParameters: Record<string, unknown> = {
    location: { type: "string", defaultValue: document.metadata.region },
  };
  if (hasSql) {
    templateParameters.sqlAdminPassword = { type: "securestring" };
  }
  if (hasVmss) {
    templateParameters.vmAdminUsername = { type: "string", defaultValue: "azureuser" };
    templateParameters.vmSshPublicKey = { type: "securestring" };
  }

  const template = {
    $schema:
      "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    contentVersion: "1.0.0.0",
    metadata: {
      _generator: "bunya",
      document: document.metadata.name,
      environment: document.metadata.environment,
    },
    parameters: templateParameters,
    variables: {},
    resources,
    outputs: {},
  };

  const paramFileParams: Record<string, unknown> = {
    location: { value: document.metadata.region },
  };
  if (hasSql) {
    // Supply sqlAdminPassword securely at deployment time.
  }
  if (hasVmss) {
    paramFileParams.vmAdminUsername = { value: "azureuser" };
    // Supply vmSshPublicKey at deployment time.
  }

  const parameters = {
    $schema:
      "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    contentVersion: "1.0.0.0",
    parameters: paramFileParams,
  };

  const files: GeneratedFile[] = [
    {
      path: "azuredeploy.json",
      language: "json",
      content: JSON.stringify(template, null, 2),
    },
    {
      path: "azuredeploy.parameters.json",
      language: "json",
      content: JSON.stringify(parameters, null, 2),
    },
  ];
  return { ok: true, files };
}
