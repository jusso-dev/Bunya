import { GraphDocument, GraphNode, ServiceType } from "@/lib/graph/schema";
import { GeneratorContext, autoComment, buildGeneratorContext, incomingOf, outgoingOf } from "./shared/context";
import { GeneratedFile, GeneratorResult } from "./types";

function bicepIdent(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "_");
  if (/^[0-9]/.test(cleaned)) return `r_${cleaned}`;
  return cleaned.length > 0 ? cleaned : "resource";
}

function name(ctx: GeneratorContext, id: string): string {
  return ctx.resourceNames.get(id) ?? id;
}

function nodeRef(ctx: GeneratorContext, id: string): string {
  return bicepIdent(ctx.nodesById.get(id)?.resourceName ?? id);
}

function tagsLiteral(ctx: GeneratorContext, node: GraphNode): string {
  const userTags = (node.properties.tags as Record<string, string> | undefined) ?? {};
  const merged = {
    environment: ctx.document.metadata.environment,
    managed_by: "bunya",
    ...userTags,
  };
  const entries = Object.entries(merged)
    .map(([k, v]) => `    ${k}: '${v}'`)
    .join("\n");
  return `  tags: {\n${entries}\n  }`;
}

function emitResourceGroup(): string {
  return [
    `// Resource Group must be created at the subscription scope.`,
    `// Bunya emits per-resource-group templates; deploy with:`,
    `//   az deployment sub create --location <region> --template-file main.bicep`,
  ].join("\n");
}

function emitVirtualNetwork(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const addressSpace = (node.properties.addressSpace as string) ?? "10.0.0.0/16";
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.Network/virtualNetworks@2023-11-01' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  properties: {`,
    `    addressSpace: {`,
    `      addressPrefixes: [`,
    `        '${addressSpace}'`,
    `      ]`,
    `    }`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitSubnet(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const prefix = (node.properties.addressPrefix as string) ?? "10.0.1.0/24";
  const vnetEdge = outgoingOf(ctx, node.id, "depends_on").find(
    (e) => ctx.nodesById.get(e.target)?.type === "virtualNetwork",
  );
  const vnetIdent = vnetEdge ? nodeRef(ctx, vnetEdge.target) : "mainVnet";
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  parent: ${vnetIdent}`,
    `  properties: {`,
    `    addressPrefix: '${prefix}'`,
    `    privateEndpointNetworkPolicies: '${(node.properties.privateEndpointNetworkPolicies as string) ?? "Disabled"}'`,
    `  }`,
    `}`,
  ].filter(Boolean).join("\n");
}

function emitNsg(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.Network/networkSecurityGroups@2023-11-01' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  properties: {`,
    `    securityRules: []`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitPrivateEndpoint(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const subnetEdge = outgoingOf(ctx, node.id, "network").find(
    (e) => ctx.nodesById.get(e.target)?.type === "subnet",
  );
  const subnetIdent = subnetEdge ? nodeRef(ctx, subnetEdge.target) : "mainSubnet";
  const targetEdge = outgoingOf(ctx, node.id, "network").find(
    (e) => ctx.nodesById.get(e.target)?.type !== "subnet",
  );
  const targetIdent = targetEdge ? nodeRef(ctx, targetEdge.target) : "targetService";
  const groupId = (node.properties.groupId as string) ?? "blob";
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.Network/privateEndpoints@2023-11-01' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  properties: {`,
    `    subnet: {`,
    `      id: ${subnetIdent}.id`,
    `    }`,
    `    privateLinkServiceConnections: [`,
    `      {`,
    `        name: '${name(ctx, node.id)}-psc'`,
    `        properties: {`,
    `          privateLinkServiceId: ${targetIdent}.id`,
    `          groupIds: [`,
    `            '${groupId}'`,
    `          ]`,
    `        }`,
    `      }`,
    `    ]`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitAppServicePlan(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const sku = (node.properties.sku as string) ?? "B1";
  const os = (node.properties.os as string) ?? "Linux";
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.Web/serverfarms@2023-12-01' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  sku: {`,
    `    name: '${sku}'`,
    `  }`,
    `  kind: '${os.toLowerCase()}'`,
    `  properties: {`,
    `    reserved: ${os === "Linux"}`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitAppService(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const planEdge = outgoingOf(ctx, node.id, "depends_on").find(
    (e) => ctx.nodesById.get(e.target)?.type === "appServicePlan",
  );
  const planIdent = planEdge ? nodeRef(ctx, planEdge.target) : "mainPlan";
  const httpsOnly = node.properties.httpsOnly !== false;
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.Web/sites@2023-12-01' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  kind: 'app,linux'`,
    `  identity: {`,
    `    type: 'SystemAssigned'`,
    `  }`,
    `  properties: {`,
    `    serverFarmId: ${planIdent}.id`,
    `    httpsOnly: ${httpsOnly}`,
    `    siteConfig: {`,
    `      minTlsVersion: '1.2'`,
    `      alwaysOn: ${node.properties.alwaysOn !== false}`,
    `      linuxFxVersion: 'NODE|20-lts'`,
    `    }`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitFunctionApp(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const planEdge = outgoingOf(ctx, node.id, "depends_on").find(
    (e) => ctx.nodesById.get(e.target)?.type === "appServicePlan",
  );
  const planIdent = planEdge ? nodeRef(ctx, planEdge.target) : "mainPlan";
  const storageEdge = outgoingOf(ctx, node.id, "data").find(
    (e) => ctx.nodesById.get(e.target)?.type === "storageAccount",
  );
  const stIdent = storageEdge ? nodeRef(ctx, storageEdge.target) : "mainStorage";
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.Web/sites@2023-12-01' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  kind: 'functionapp,linux'`,
    `  identity: {`,
    `    type: 'SystemAssigned'`,
    `  }`,
    `  properties: {`,
    `    serverFarmId: ${planIdent}.id`,
    `    httpsOnly: ${node.properties.httpsOnly !== false}`,
    `    siteConfig: {`,
    `      minTlsVersion: '1.2'`,
    `      appSettings: [`,
    `        {`,
    `          name: 'AzureWebJobsStorage'`,
    `          value: 'DefaultEndpointsProtocol=https;AccountName=\${${stIdent}.name};EndpointSuffix=\${environment().suffixes.storage};AccountKey=\${${stIdent}.listKeys().keys[0].value}'`,
    `        }`,
    `        {`,
    `          name: 'FUNCTIONS_EXTENSION_VERSION'`,
    `          value: '~4'`,
    `        }`,
    `      ]`,
    `    }`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitStaticWebApp(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const sku = (node.properties.sku as string) ?? "Standard";
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.Web/staticSites@2023-12-01' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  sku: {`,
    `    name: '${sku}'`,
    `    tier: '${sku}'`,
    `  }`,
    `  properties: {}`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitStorageAccount(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const sku = (node.properties.sku as string) ?? "Standard_LRS";
  const kind = (node.properties.kind as string) ?? "StorageV2";
  const allowPublic = node.properties.allowPublicAccess === true;
  const tls = (node.properties.minTlsVersion as string) ?? "1.2";
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.Storage/storageAccounts@2023-05-01' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  kind: '${kind}'`,
    `  sku: {`,
    `    name: '${sku}'`,
    `  }`,
    `  properties: {`,
    `    minimumTlsVersion: 'TLS1_${tls.split(".")[1]}'`,
    `    allowBlobPublicAccess: ${allowPublic}`,
    `    publicNetworkAccess: '${allowPublic ? "Enabled" : "Disabled"}'`,
    `    supportsHttpsTrafficOnly: true`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitSqlDatabase(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const sku = (node.properties.sku as string) ?? "S0";
  const admin = (node.properties.adminLogin as string) ?? "bunyaadmin";
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident}Server 'Microsoft.Sql/servers@2023-08-01-preview' = {`,
    `  name: '${name(ctx, node.id)}-srv'`,
    `  location: location`,
    `  properties: {`,
    `    administratorLogin: '${admin}'`,
    `    administratorLoginPassword: sqlAdminPassword`,
    `    minimalTlsVersion: '1.2'`,
    `    publicNetworkAccess: 'Disabled'`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
    ``,
    `resource ${ident} 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  parent: ${ident}Server`,
    `  location: location`,
    `  sku: {`,
    `    name: '${sku}'`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitCosmosDb(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const consistency = (node.properties.consistency as string) ?? "Session";
  const freeTier = node.properties.freeTier === true;
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  kind: 'GlobalDocumentDB'`,
    `  properties: {`,
    `    databaseAccountOfferType: 'Standard'`,
    `    enableFreeTier: ${freeTier}`,
    `    consistencyPolicy: {`,
    `      defaultConsistencyLevel: '${consistency}'`,
    `    }`,
    `    locations: [`,
    `      {`,
    `        locationName: location`,
    `        failoverPriority: 0`,
    `      }`,
    `    ]`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitKeyVault(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const sku = (node.properties.sku as string) ?? "standard";
  const purge = node.properties.purgeProtection !== false;
  const retention = (node.properties.softDeleteRetentionDays as number) ?? 7;
  const lines = [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.KeyVault/vaults@2023-07-01' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  properties: {`,
    `    sku: {`,
    `      family: 'A'`,
    `      name: '${sku}'`,
    `    }`,
    `    tenantId: tenant().tenantId`,
    `    enablePurgeProtection: ${purge}`,
    `    softDeleteRetentionInDays: ${retention}`,
    `    enableRbacAuthorization: ${node.properties.rbacAuthorization !== false}`,
    `    publicNetworkAccess: '${node.properties.publicNetworkAccess === true ? "Enabled" : "Disabled"}'`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ];
  for (const edge of incomingOf(ctx, node.id, "identity")) {
    const src = ctx.nodesById.get(edge.source);
    if (!src) continue;
    if (src.type !== "appService" && src.type !== "functionApp" && src.type !== "userAssignedIdentity") continue;
    const srcIdent = nodeRef(ctx, src.id);
    const principal =
      src.type === "userAssignedIdentity"
        ? `${srcIdent}.properties.principalId`
        : `${srcIdent}.identity.principalId`;
    lines.push(
      ``,
      `resource ${srcIdent}_${ident}_secrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {`,
      `  scope: ${ident}`,
      `  name: guid(${ident}.id, ${srcIdent}.id, 'Key Vault Secrets User')`,
      `  properties: {`,
      `    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')`,
      `    principalId: ${principal}`,
      `    principalType: '${src.type === "userAssignedIdentity" ? "ServicePrincipal" : "ServicePrincipal"}'`,
      `  }`,
      `}`,
    );
  }
  return lines.filter(Boolean).join("\n");
}

function emitAppInsights(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const workspaceEdge = outgoingOf(ctx, node.id, "depends_on").find(
    (e) => ctx.nodesById.get(e.target)?.type === "logAnalytics",
  );
  const workspaceRef = workspaceEdge ? `${nodeRef(ctx, workspaceEdge.target)}.id` : `null`;
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.Insights/components@2020-02-02' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  kind: 'web'`,
    `  properties: {`,
    `    Application_Type: 'web'`,
    `    WorkspaceResourceId: ${workspaceRef}`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitLogAnalytics(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  properties: {`,
    `    sku: {`,
    `      name: '${(node.properties.sku as string) ?? "PerGB2018"}'`,
    `    }`,
    `    retentionInDays: ${(node.properties.retentionDays as number) ?? 30}`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitFrontDoor(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const sku = (node.properties.sku as string) ?? "Standard_AzureFrontDoor";
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.Cdn/profiles@2024-02-01' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: 'global'`,
    `  sku: {`,
    `    name: '${sku}'`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitApplicationGateway(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const sku = (node.properties.sku as string) ?? "WAF_v2";
  return [
    autoComment(ctx, node.id, "//"),
    `// Application Gateway shell. Configure listeners and pools per your topology.`,
    `resource ${ident} 'Microsoft.Network/applicationGateways@2023-11-01' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  properties: {`,
    `    sku: {`,
    `      name: '${sku}'`,
    `      tier: '${sku}'`,
    `      capacity: ${(node.properties.capacity as number) ?? 2}`,
    `    }`,
    `    gatewayIPConfigurations: []`,
    `    frontendIPConfigurations: []`,
    `    frontendPorts: []`,
    `    backendAddressPools: []`,
    `    backendHttpSettingsCollection: []`,
    `    httpListeners: []`,
    `    requestRoutingRules: []`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitApim(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const sku = (node.properties.sku as string) ?? "Consumption";
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.ApiManagement/service@2023-09-01-preview' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  sku: {`,
    `    name: '${sku}'`,
    `    capacity: 0`,
    `  }`,
    `  properties: {`,
    `    publisherName: '${(node.properties.publisherName as string) ?? "Bunya"}'`,
    `    publisherEmail: '${(node.properties.publisherEmail as string) ?? "ops@example.com"}'`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitContainerRegistry(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const sku = (node.properties.sku as string) ?? "Basic";
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    `  sku: {`,
    `    name: '${sku}'`,
    `  }`,
    `  properties: {`,
    `    adminUserEnabled: ${node.properties.adminUserEnabled === true}`,
    `    publicNetworkAccess: '${node.properties.publicNetworkAccess === false ? "Disabled" : "Enabled"}'`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitUserAssignedIdentity(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {`,
    `  name: '${name(ctx, node.id)}'`,
    `  location: location`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

const EMITTERS: Record<ServiceType, (node: GraphNode, ctx: GeneratorContext) => string> = {
  resourceGroup: () => emitResourceGroup(),
  virtualNetwork: emitVirtualNetwork,
  subnet: emitSubnet,
  networkSecurityGroup: emitNsg,
  privateEndpoint: emitPrivateEndpoint,
  appServicePlan: emitAppServicePlan,
  appService: emitAppService,
  functionApp: emitFunctionApp,
  staticWebApp: emitStaticWebApp,
  storageAccount: emitStorageAccount,
  sqlDatabase: emitSqlDatabase,
  cosmosDb: emitCosmosDb,
  keyVault: emitKeyVault,
  applicationInsights: emitAppInsights,
  logAnalytics: emitLogAnalytics,
  frontDoor: emitFrontDoor,
  applicationGateway: emitApplicationGateway,
  apiManagement: emitApim,
  containerRegistry: emitContainerRegistry,
  userAssignedIdentity: emitUserAssignedIdentity,
};

function emitDiagnostics(ctx: GeneratorContext): string {
  const blocks: string[] = [];
  for (const edge of ctx.edges) {
    if (edge.kind !== "diagnostic") continue;
    const source = ctx.nodesById.get(edge.source);
    const target = ctx.nodesById.get(edge.target);
    if (!source || !target || target.type !== "logAnalytics") continue;
    const sIdent = nodeRef(ctx, source.id);
    const tIdent = nodeRef(ctx, target.id);
    blocks.push(
      [
        `resource ${sIdent}_to_${tIdent} 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {`,
        `  name: '${sIdent}-to-${tIdent}'`,
        `  scope: ${sIdent}`,
        `  properties: {`,
        `    workspaceId: ${tIdent}.id`,
        `    logs: [`,
        `      {`,
        `        categoryGroup: 'allLogs'`,
        `        enabled: true`,
        `      }`,
        `    ]`,
        `    metrics: [`,
        `      {`,
        `        category: 'AllMetrics'`,
        `        enabled: true`,
        `      }`,
        `    ]`,
        `  }`,
        `}`,
      ].join("\n"),
    );
  }
  return blocks.join("\n\n");
}

function renderParametersFile(document: GraphDocument): GeneratedFile {
  return {
    path: "main.parameters.json",
    language: "json",
    content: JSON.stringify(
      {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
        contentVersion: "1.0.0.0",
        parameters: {
          location: { value: document.metadata.region },
          environmentTag: { value: document.metadata.environment },
          sqlAdminPassword: { value: "ReplaceMe!" },
        },
      },
      null,
      2,
    ),
  };
}

export function generateBicep(document: GraphDocument): GeneratorResult {
  const ctx = buildGeneratorContext(document);
  if (!ctx.topo.ok) {
    return { ok: false, reason: "cycle detected", cycle: ctx.topo.cycle };
  }
  const lines: string[] = [
    `// Generated by Bunya. Do not edit by hand.`,
    `// Document: ${document.metadata.name} (${document.metadata.environment})`,
    ``,
    `targetScope = 'resourceGroup'`,
    ``,
    `@description('Azure region for all resources.')`,
    `param location string = '${document.metadata.region}'`,
    ``,
    `@description('Environment tag.')`,
    `@allowed([`,
    `  'dev'`,
    `  'test'`,
    `  'prod'`,
    `])`,
    `param environmentTag string = '${document.metadata.environment}'`,
    ``,
    `@secure()`,
    `param sqlAdminPassword string`,
    ``,
  ];
  for (const node of ctx.topo.order) {
    const emit = EMITTERS[node.type];
    if (!emit) continue;
    lines.push(emit(node, ctx), "");
  }
  const diag = emitDiagnostics(ctx);
  if (diag) lines.push(diag, "");

  const files: GeneratedFile[] = [
    {
      path: "main.bicep",
      language: "bicep",
      content: lines.join("\n"),
    },
    renderParametersFile(document),
  ];
  return { ok: true, files };
}
