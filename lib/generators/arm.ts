import { GraphDocument, GraphNode, ServiceType } from "@/lib/graph/schema";
import { GeneratorContext, buildGeneratorContext, incomingOf, outgoingOf } from "./shared/context";
import { GeneratedFile, GeneratorResult } from "./types";

type ArmResource = {
  type: string;
  apiVersion: string;
  name: string;
  location?: string;
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
    .map((n) => armResourceId(n));
  const list = [...auto, ...refs].filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function armResourceId(node: GraphNode): string {
  const map: Partial<Record<ServiceType, string>> = {
    resourceGroup: "",
    virtualNetwork: "Microsoft.Network/virtualNetworks",
    subnet: "Microsoft.Network/virtualNetworks/subnets",
    networkSecurityGroup: "Microsoft.Network/networkSecurityGroups",
    privateEndpoint: "Microsoft.Network/privateEndpoints",
    appServicePlan: "Microsoft.Web/serverfarms",
    appService: "Microsoft.Web/sites",
    functionApp: "Microsoft.Web/sites",
    staticWebApp: "Microsoft.Web/staticSites",
    storageAccount: "Microsoft.Storage/storageAccounts",
    sqlDatabase: "Microsoft.Sql/servers/databases",
    cosmosDb: "Microsoft.DocumentDB/databaseAccounts",
    keyVault: "Microsoft.KeyVault/vaults",
    applicationInsights: "Microsoft.Insights/components",
    logAnalytics: "Microsoft.OperationalInsights/workspaces",
    frontDoor: "Microsoft.Cdn/profiles",
    applicationGateway: "Microsoft.Network/applicationGateways",
    apiManagement: "Microsoft.ApiManagement/service",
    containerRegistry: "Microsoft.ContainerRegistry/registries",
    userAssignedIdentity: "Microsoft.ManagedIdentity/userAssignedIdentities",
  };
  const t = map[node.type];
  if (!t) return "";
  return `[resourceId('${t}', '${node.resourceName}')]`;
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
    },
  };
}

function emitSubnet(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const vnetEdge = outgoingOf(ctx, node.id, "depends_on").find(
    (e) => ctx.nodesById.get(e.target)?.type === "virtualNetwork",
  );
  const vnetName = vnetEdge ? resourceName(ctx, vnetEdge.target) : "main-vnet";
  return {
    type: "Microsoft.Network/virtualNetworks/subnets",
    apiVersion: "2023-11-01",
    name: `${vnetName}/${resourceName(ctx, node.id)}`,
    properties: {
      addressPrefix: (node.properties.addressPrefix as string) ?? "10.0.1.0/24",
      privateEndpointNetworkPolicies:
        (node.properties.privateEndpointNetworkPolicies as string) ?? "Disabled",
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
  const subnetId = subnetEdge
    ? `[resourceId('Microsoft.Network/virtualNetworks/subnets', 'main-vnet', '${resourceName(ctx, subnetEdge.target)}')]`
    : "[resourceId('Microsoft.Network/virtualNetworks/subnets', 'main-vnet', 'main-subnet')]";
  const targetId = targetEdge
    ? armResourceId(ctx.nodesById.get(targetEdge.target)!)
    : null;
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
  };
}

function emitAppServicePlan(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const os = (node.properties.os as string) ?? "Linux";
  return {
    type: "Microsoft.Web/serverfarms",
    apiVersion: "2023-12-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    kind: os.toLowerCase(),
    sku: { name: (node.properties.sku as string) ?? "B1" },
    properties: { reserved: os === "Linux" },
    tags: tags(ctx, node),
  };
}

function emitAppService(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const planEdge = outgoingOf(ctx, node.id, "depends_on").find(
    (e) => ctx.nodesById.get(e.target)?.type === "appServicePlan",
  );
  const planName = planEdge ? resourceName(ctx, planEdge.target) : "main-plan";
  return {
    type: "Microsoft.Web/sites",
    apiVersion: "2023-12-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    kind: "app,linux",
    identity: { type: "SystemAssigned" },
    properties: {
      serverFarmId: resourceId("Microsoft.Web/serverfarms", planName),
      httpsOnly: node.properties.httpsOnly !== false,
      siteConfig: {
        minTlsVersion: "1.2",
        alwaysOn: node.properties.alwaysOn !== false,
        linuxFxVersion: "NODE|20-lts",
      },
    },
    tags: tags(ctx, node),
    dependsOn: [resourceId("Microsoft.Web/serverfarms", planName)],
  };
}

function emitFunctionApp(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const planEdge = outgoingOf(ctx, node.id, "depends_on").find(
    (e) => ctx.nodesById.get(e.target)?.type === "appServicePlan",
  );
  const planName = planEdge ? resourceName(ctx, planEdge.target) : "main-plan";
  const stEdge = outgoingOf(ctx, node.id, "data").find(
    (e) => ctx.nodesById.get(e.target)?.type === "storageAccount",
  );
  const stName = stEdge ? resourceName(ctx, stEdge.target) : "mainstorage";
  return {
    type: "Microsoft.Web/sites",
    apiVersion: "2023-12-01",
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    kind: "functionapp,linux",
    identity: { type: "SystemAssigned" },
    properties: {
      serverFarmId: resourceId("Microsoft.Web/serverfarms", planName),
      httpsOnly: node.properties.httpsOnly !== false,
      siteConfig: {
        minTlsVersion: "1.2",
        appSettings: [
          {
            name: "AzureWebJobsStorage",
            value: `[concat('DefaultEndpointsProtocol=https;AccountName=${stName};EndpointSuffix=', environment().suffixes.storage, ';AccountKey=', listKeys(resourceId('Microsoft.Storage/storageAccounts','${stName}'),'2023-05-01').keys[0].value)]`,
          },
          { name: "FUNCTIONS_EXTENSION_VERSION", value: "~4" },
        ],
      },
    },
    tags: tags(ctx, node),
    dependsOn: [
      resourceId("Microsoft.Web/serverfarms", planName),
      resourceId("Microsoft.Storage/storageAccounts", stName),
    ],
  };
}

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
      publicNetworkAccess: allowPublic ? "Enabled" : "Disabled",
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

function emitRoleAssignments(ctx: GeneratorContext): ArmResource[] {
  const out: ArmResource[] = [];
  for (const node of ctx.document.nodes) {
    if (node.type !== "keyVault") continue;
    for (const edge of incomingOf(ctx, node.id, "identity")) {
      const src = ctx.nodesById.get(edge.source);
      if (!src) continue;
      out.push({
        type: "Microsoft.Authorization/roleAssignments",
        apiVersion: "2022-04-01",
        name: `[guid(resourceId('Microsoft.KeyVault/vaults','${node.resourceName}'), '${src.resourceName}', 'kv-secrets-user')]`,
        properties: {
          roleDefinitionId:
            "[subscriptionResourceId('Microsoft.Authorization/roleDefinitions','4633458b-17de-408a-b874-0445c86b69e6')]",
          principalId:
            src.type === "userAssignedIdentity"
              ? `[reference(resourceId('Microsoft.ManagedIdentity/userAssignedIdentities','${src.resourceName}'), '2023-01-31').principalId]`
              : `[reference(resourceId('Microsoft.Web/sites','${src.resourceName}'), '2023-12-01', 'Full').identity.principalId]`,
          principalType: "ServicePrincipal",
        },
        dependsOn: [
          resourceId("Microsoft.KeyVault/vaults", node.resourceName),
          armResourceId(src).slice(1, -1),
        ],
      });
    }
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
    const sId = armResourceId(source).slice(1, -1);
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
  appServicePlan: emitAppServicePlan,
  appService: emitAppService,
  functionApp: emitFunctionApp,
  staticWebApp: emitStaticWebApp,
  storageAccount: emitStorage,
  sqlDatabase: emitSqlDatabase,
  cosmosDb: emitCosmos,
  keyVault: emitKeyVault,
  applicationInsights: emitAppInsights,
  logAnalytics: emitLogAnalytics,
  frontDoor: emitFrontDoor,
  applicationGateway: emitApplicationGateway,
  apiManagement: emitApim,
  containerRegistry: emitContainerRegistry,
  userAssignedIdentity: emitUserAssignedIdentity,
};

export function generateArm(document: GraphDocument): GeneratorResult {
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
  resources.push(...emitRoleAssignments(ctx));
  resources.push(...emitDiagnosticSettings(ctx));

  const hasSql = ctx.document.nodes.some((n) => n.type === "sqlDatabase");
  const templateParameters: Record<string, unknown> = {
    location: { type: "string", defaultValue: document.metadata.region },
  };
  if (hasSql) {
    templateParameters.sqlAdminPassword = { type: "securestring", defaultValue: "ReplaceMe!" };
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
    paramFileParams.sqlAdminPassword = { value: "ReplaceMe!" };
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
