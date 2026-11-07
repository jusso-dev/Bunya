import { GraphDocument, GraphNode, ServiceType } from "@/lib/graph/schema";
import {
  GeneratorContext,
  autoComment,
  dnsLinkName,
  dnsZoneName,
  endpointZones,
  prepareGeneration,
  sqlServerName,
  subnetOf,
  subnetVnet,
  targetOfType,
  zoneVnets,
} from "./shared/context";
import { GeneratedFile, GeneratorResult } from "./types";
import { expr, planBody, siteBody, toBicep, type Refs, type SiteBody } from "./shared/site-resource";
import { grantSuffix, portableGrants, writtenWithScope, type RoleGrant } from "./shared/roles";
import { quote } from "./shared/quote";
import { apiVersion } from "./shared/api-versions";
import { contentShareName, deploymentContainerName } from "./shared/hosting";
import { privateEndpointTarget, subnetDelegations } from "@/lib/graph/topology";
import { storagePublicNetwork } from "@/lib/catalogue/services";
import { DIAGNOSTIC_SOURCES, tlsVersionToArm } from "@/lib/catalogue/azure";

function typed(armType: string): string {
  return `${armType}@${apiVersion(armType)}`;
}

function nodeRef(ctx: GeneratorContext, id: string): string {
  return `node_${ctx.document.nodes.findIndex((node) => node.id === id)}_${ctx.identifiers.get(id)}_resource`;
}

function tagsLiteral(ctx: GeneratorContext, node: GraphNode): string {
  const entries = Object.entries(ctx.tags(node))
    .map(([k, v]) => `    '${k}': '${v}'`)
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
  const addressSpace = String(node.properties.addressSpace);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.Network/virtualNetworks")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: location`,
    `  properties: {`,
    `    addressSpace: {`,
    `      addressPrefixes: [`,
    `        '${addressSpace}'`,
    ...((node.properties.additionalAddressSpaces as string[])).map((space) => `        '${space}'`),
    `      ]`,
    `    }`,
    ...(Array.isArray(node.properties.dnsServers) && (node.properties.dnsServers as string[]).length > 0
      ? [`    dhcpOptions: {`, `      dnsServers: [`, ...(node.properties.dnsServers as string[]).map((server) => `        '${server}'`), `      ]`, `    }`]
      : []),
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitSubnet(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const prefix = String(node.properties.addressPrefix);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.Network/virtualNetworks/subnets")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  parent: ${nodeRef(ctx, subnetVnet(ctx, node).id)}`,
    `  properties: {`,
    `    addressPrefix: '${prefix}'`,
    `    privateEndpointNetworkPolicies: '${String(node.properties.privateEndpointNetworkPolicies)}'`,
    ...delegationLines(ctx, node),
    `  }`,
    `}`,
  ].filter(Boolean).join("\n");
}

function delegationLines(ctx: GeneratorContext, node: GraphNode): string[] {
  const services = subnetDelegations(ctx.document, node);
  if (services.length === 0) return [];
  return [
    `    delegations: [`,
    ...services.flatMap((service) => [
      `      {`,
      `        name: '${service.split("/")[1]}'`,
      `        properties: {`,
      `          serviceName: '${service}'`,
      `        }`,
      `      }`,
    ]),
    `    ]`,
  ];
}

function emitNsg(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.Network/networkSecurityGroups")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: location`,
    `  properties: {`,
    `    securityRules: []`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function bicepZoneGroup(ctx: GeneratorContext, node: GraphNode): string[] {
  const zones = endpointZones(ctx, node);
  if (zones.length === 0) return [];
  return [
    ``,
    `resource ${zoneGroupRef(ctx, node)} '${typed("Microsoft.Network/privateEndpoints/privateDnsZoneGroups")}' = {`,
    `  parent: ${nodeRef(ctx, node.id)}`,
    `  name: 'default'`,
    `  properties: {`,
    `    privateDnsZoneConfigs: [`,
    ...zones.flatMap((zone) => [
      `      {`,
      `        name: '${dnsZoneName(zone).replace(/\./g, "-")}'`,
      `        properties: {`,
      `          privateDnsZoneId: ${nodeRef(ctx, zone.id)}.id`,
      `        }`,
      `      }`,
    ]),
    `    ]`,
    `  }`,
    `}`,
  ];
}

function emitPrivateEndpoint(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const subnetIdent = nodeRef(ctx, subnetOf(ctx, node)!.id);
  const target = privateEndpointTarget(ctx.document, node);
  // A SQL endpoint connects to the logical server, not the database.
  const targetId = !target ? "null" : target.type === "sqlDatabase" ? `${nodeRef(ctx, target.id)}Server.id` : `${nodeRef(ctx, target.id)}.id`;
  const groupId = String(node.properties.groupId);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.Network/privateEndpoints")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: location`,
    `  properties: {`,
    `    subnet: {`,
    `      id: ${subnetIdent}.id`,
    `    }`,
    `    privateLinkServiceConnections: [`,
    `      {`,
    `        name: '${ctx.name(node.id)}-psc'`,
    `        properties: {`,
    `          privateLinkServiceId: ${targetId}`,
    `          groupIds: [`,
    `            '${groupId}'`,
    `          ]`,
    `        }`,
    `      }`,
    `    ]`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
    ...bicepZoneGroup(ctx, node),
  ].filter(Boolean).join("\n");
}

function bicepRefs(ctx: GeneratorContext): Refs {
  return {
    id: (node) => expr(`${nodeRef(ctx, node.id)}.id`),
    storageConnectionString: (storage) => {
      const ident = nodeRef(ctx, storage.id);
      return expr(`'DefaultEndpointsProtocol=https;AccountName=\${${ident}.name};EndpointSuffix=\${environment().suffixes.storage};AccountKey=\${${ident}.listKeys().keys[0].value}'`);
    },
    deploymentContainerUrl: (storage, site) => expr(`'\${${nodeRef(ctx, storage.id)}.properties.primaryEndpoints.blob}${deploymentContainerName(ctx, site)}'`),
    appInsightsConnectionString: (component) => expr(`${nodeRef(ctx, component.id)}.properties.ConnectionString`),
    userIdentityClientId: (identity) => expr(`${nodeRef(ctx, identity.id)}.properties.clientId`),
  };
}

const contentShareRef = (ctx: GeneratorContext, site: GraphNode) => `${nodeRef(ctx, site.id)}_contentshare`;
const deploymentRef = (ctx: GeneratorContext, site: GraphNode) => `${nodeRef(ctx, site.id)}_deployment`;
const zoneGroupRef = (ctx: GeneratorContext, pe: GraphNode) => `${nodeRef(ctx, pe.id)}_dns`;
const dnsLinkRef = (ctx: GeneratorContext, zone: GraphNode, vnet: GraphNode) => `${nodeRef(ctx, zone.id)}_${ctx.identifiers.get(vnet.id)}_link`;
const grantRef = (ctx: GeneratorContext, { principal, scope, role }: Pick<RoleGrant, "principal" | "scope" | "role">) =>
  `${nodeRef(ctx, principal.id)}_${nodeRef(ctx, scope.id)}_${grantSuffix({ scope, role })}`;

function emitAppServicePlan(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const body = planBody(node);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.Web/serverfarms")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: location`,
    `  kind: '${body.kind}'`,
    `  sku: ${toBicep(body.sku, 1)}`,
    `  properties: ${toBicep(body.properties, 1)}`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitSite(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const body = siteBody(ctx, node, bicepRefs(ctx));
  const storageIdent = body.hosting.storage ? nodeRef(ctx, body.hosting.storage.id) : "";
  const lines = [autoComment(ctx, node.id, "//")];
  if (body.hosting.privateContentShare) {
    // Secured storage: the content share must exist before the app.
    lines.push(
      `resource ${contentShareRef(ctx, node)} '${typed("Microsoft.Storage/storageAccounts/fileServices/shares")}' = {`,
      `  name: '\${${storageIdent}.name}/default/${contentShareName(ctx, node)}'`,
      `}`,
      ``,
    );
  }
  if (body.hosting.flex) {
    lines.push(
      `resource ${deploymentRef(ctx, node)} '${typed("Microsoft.Storage/storageAccounts/blobServices/containers")}' = {`,
      `  name: '\${${storageIdent}.name}/default/${deploymentContainerName(ctx, node)}'`,
      `  properties: {`,
      `    publicAccess: 'None'`,
      `  }`,
      `}`,
      ``,
    );
  }
  lines.push(
    `resource ${ident} '${typed("Microsoft.Web/sites")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: location`,
    `  kind: '${body.kind}'`,
    `  identity: ${toBicep(body.identity, 1)}`,
    `  properties: ${toBicep(body.properties, 1)}`,
    tagsLiteral(ctx, node),
    ...siteDependsOn(ctx, node, body.hosting),
    `}`,
  );
  return lines.filter(Boolean).join("\n");
}

// Bicep infers most ordering. A user-assigned pull identity needs its AcrPull
// grant before the site starts, so the first pull succeeds.
function siteDependsOn(ctx: GeneratorContext, node: GraphNode, hosting: SiteBody["hosting"]): string[] {
  const deps: string[] = [];
  if (hosting.flex) deps.push(deploymentRef(ctx, node));
  if (hosting.privateContentShare) deps.push(contentShareRef(ctx, node));
  for (const { pe, hasDns } of hosting.storageEndpoints) {
    deps.push(nodeRef(ctx, pe.id));
    if (hasDns) deps.push(zoneGroupRef(ctx, pe));
  }
  for (const { zone, vnet } of hosting.storageDnsLinks) deps.push(dnsLinkRef(ctx, zone, vnet));
  if (hosting.registry && hosting.pullIdentity?.kind === "user") {
    deps.push(grantRef(ctx, { principal: hosting.pullIdentity.node, scope: hosting.registry, role: "AcrPull" }));
  }
  return deps.length > 0 ? [`  dependsOn: [`, ...deps.map((dep) => `    ${dep}`), `  ]`] : [];
}

function emitStaticWebApp(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const sku = String(node.properties.sku);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.Web/staticSites")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
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

function emitAksCluster(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const subnet = subnetOf(ctx, node);
  const workspace = targetOfType(ctx, node.id, "diagnostic", "logAnalytics");
  const authorizedRanges = (node.properties.authorizedIpRanges as string[]);
  const privateCluster = node.properties.privateCluster === true;
  const networkPolicy = String(node.properties.networkPolicy);
  const lines = [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.ContainerService/managedClusters")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: location`,
    `  identity: {`,
    `    type: '${node.properties.managedIdentity === false ? "None" : "SystemAssigned"}'`,
    `  }`,
    `  properties: {`,
    `    dnsPrefix: '${(node.properties.dnsPrefix as string) || ctx.name(node.id)}'`,
    `    enableRBAC: true`,
    `    agentPoolProfiles: [`,
    `      {`,
    `        name: 'system'`,
    `        count: ${Number(node.properties.nodeCount)}`,
    `        vmSize: '${String(node.properties.nodeVmSize)}'`,
    `        osType: 'Linux'`,
    `        mode: 'System'`,
    `        type: 'VirtualMachineScaleSets'`,
    ...(subnet ? [`        vnetSubnetID: ${nodeRef(ctx, subnet.id)}.id`] : []),
    `      }`,
    `    ]`,
    `    networkProfile: {`,
    `      networkPlugin: '${String(node.properties.networkPlugin)}'`,
    ...(networkPolicy === "none" ? [] : [`      networkPolicy: '${networkPolicy}'`]),
    `      loadBalancerSku: 'standard'`,
    `    }`,
    `    apiServerAccessProfile: {`,
    `      enablePrivateCluster: ${privateCluster}`,
    ...(authorizedRanges.length > 0 && !privateCluster
      ? [
          `      authorizedIPRanges: [`,
          ...authorizedRanges.map((r) => `        '${r}'`),
          `      ]`,
        ]
      : []),
    `    }`,
    ...(workspace
      ? [
          `    addonProfiles: {`,
          `      omsagent: {`,
          `        enabled: true`,
          `        config: {`,
          `          logAnalyticsWorkspaceResourceID: ${nodeRef(ctx, workspace.id)}.id`,
          `        }`,
          `      }`,
          `    }`,
        ]
      : []),
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function emitVmss(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.Compute/virtualMachineScaleSets")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: location`,
    `  sku: {`,
    `    name: '${String(node.properties.sku)}'`,
    `    tier: 'Standard'`,
    `    capacity: ${Number(node.properties.capacity)}`,
    `  }`,
    `  identity: {`,
    `    type: 'SystemAssigned'`,
    `  }`,
    `  properties: {`,
    `    orchestrationMode: '${String(node.properties.orchestrationMode)}'`,
    `    upgradePolicy: {`,
    `      mode: '${String(node.properties.upgradeMode)}'`,
    `    }`,
    `    automaticRepairsPolicy: {`,
    `      enabled: ${node.properties.automaticRepairs !== false}`,
    `      gracePeriod: 'PT30M'`,
    `    }`,
    `    virtualMachineProfile: {`,
    `      storageProfile: {`,
    `        imageReference: {`,
    `          publisher: '${String(node.properties.imagePublisher)}'`,
    `          offer: '${String(node.properties.imageOffer)}'`,
    `          sku: '${String(node.properties.imageSku)}'`,
    `          version: 'latest'`,
    `        }`,
    `        osDisk: {`,
    `          createOption: 'FromImage'`,
    `          managedDisk: {`,
    `            storageAccountType: 'Premium_LRS'`,
    `          }`,
    `        }`,
    `      }`,
    `      osProfile: {`,
    `        computerNamePrefix: '${ctx.name(node.id).slice(0, 9)}'`,
    `        adminUsername: vmAdminUsername`,
    `        linuxConfiguration: {`,
    `          disablePasswordAuthentication: true`,
    `          ssh: {`,
    `            publicKeys: [`,
    `              {`,
    `                path: '/home/\${vmAdminUsername}/.ssh/authorized_keys'`,
    `                keyData: vmSshPublicKey`,
    `              }`,
    `            ]`,
    `          }`,
    `        }`,
    `      }`,
    `      networkProfile: {`,
    `        networkInterfaceConfigurations: [`,
    `          {`,
    `            name: 'nic'`,
    `            properties: {`,
    `              primary: true`,
    `              ipConfigurations: [`,
    `                {`,
    `                  name: 'ipconfig1'`,
    `                  properties: {`,
    `                    subnet: {`,
    `                      id: ${nodeRef(ctx, subnetOf(ctx, node)!.id)}.id`,
    `                    }`,
    `                  }`,
    `                }`,
    `              ]`,
    `            }`,
    `          }`,
    `        ]`,
    `      }`,
    `    }`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitStorageAccount(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const sku = String(node.properties.sku);
  const kind = String(node.properties.kind);
  const allowPublic = node.properties.allowPublicAccess === true;
  const tls = String(node.properties.minTlsVersion);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.Storage/storageAccounts")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: location`,
    `  kind: '${kind}'`,
    `  sku: {`,
    `    name: '${sku}'`,
    `  }`,
    `  properties: {`,
    `    minimumTlsVersion: '${tlsVersionToArm(tls)}'`,
    `    allowBlobPublicAccess: ${allowPublic}`,
    `    publicNetworkAccess: '${storagePublicNetwork(node.properties) ? "Enabled" : "Disabled"}'`,
    `    supportsHttpsTrafficOnly: true`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitSqlDatabase(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const sku = String(node.properties.sku);
  const admin = String(node.properties.adminLogin);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident}Server '${typed("Microsoft.Sql/servers")}' = {`,
    `  name: '${sqlServerName(ctx, node)}'`,
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
    `resource ${ident} '${typed("Microsoft.Sql/servers/databases")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
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
  const consistency = String(node.properties.consistency);
  const freeTier = node.properties.freeTier === true;
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.DocumentDB/databaseAccounts")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
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
  const sku = String(node.properties.sku);
  const purge = node.properties.purgeProtection !== false;
  const retention = Number(node.properties.softDeleteRetentionDays);
  const lines = [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.KeyVault/vaults")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
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
  for (const grant of portableGrants(ctx).filter((candidate) => writtenWithScope(candidate) && candidate.scope.id === node.id)) lines.push(``, roleAssignment(ctx, grant));
  return lines.filter(Boolean).join("\n");
}

function emitAppInsights(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const workspace = targetOfType(ctx, node.id, "depends_on", "logAnalytics")!;
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.Insights/components")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: location`,
    `  kind: 'web'`,
    `  properties: {`,
    `    Application_Type: 'web'`,
    `    WorkspaceResourceId: ${nodeRef(ctx, workspace.id)}.id`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitLogAnalytics(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.OperationalInsights/workspaces")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: location`,
    `  properties: {`,
    `    sku: {`,
    `      name: '${String(node.properties.sku)}'`,
    `    }`,
    `    retentionInDays: ${Number(node.properties.retentionDays)}`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitFrontDoor(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const sku = String(node.properties.sku);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.Cdn/profiles")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
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
  const sku = String(node.properties.sku);
  return [
    autoComment(ctx, node.id, "//"),
    `// Application Gateway shell. Configure listeners and pools per your topology.`,
    `resource ${ident} '${typed("Microsoft.Network/applicationGateways")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: location`,
    `  properties: {`,
    `    sku: {`,
    `      name: '${sku}'`,
    `      tier: '${sku}'`,
    `      capacity: ${Number(node.properties.capacity)}`,
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
  const sku = String(node.properties.sku);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.ApiManagement/service")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: location`,
    `  sku: {`,
    `    name: '${sku}'`,
    `    capacity: 0`,
    `  }`,
    `  properties: {`,
    `    publisherName: '${String(node.properties.publisherName)}'`,
    `    publisherEmail: ${quote.bicep(String(node.properties.publisherEmail))}`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitContainerRegistry(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const sku = String(node.properties.sku);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.ContainerRegistry/registries")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
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
    `resource ${ident} '${typed("Microsoft.ManagedIdentity/userAssignedIdentities")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: location`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitPrivateDnsZone(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.Network/privateDnsZones")}' = {`,
    `  name: '${dnsZoneName(node)}'`,
    `  location: 'global'`,
    tagsLiteral(ctx, node),
    `}`,
    ...zoneVnets(ctx, node).flatMap((vnet) => [
        ``,
        `resource ${dnsLinkRef(ctx, node, vnet)} '${typed("Microsoft.Network/privateDnsZones/virtualNetworkLinks")}' = {`,
        `  parent: ${ident}`,
        `  name: '${dnsLinkName(ctx, vnet)}'`,
        `  location: 'global'`,
        `  properties: {`,
        `    registrationEnabled: false`,
        `    virtualNetwork: {`,
        `      id: ${nodeRef(ctx, vnet.id)}.id`,
        `    }`,
        `  }`,
        `}`,
      ]),
  ].filter(Boolean).join("\n");
}

function emitActionGroup(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  return [
    autoComment(ctx, node.id, "//"),
    `resource ${ident} '${typed("Microsoft.Insights/actionGroups")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: 'global'`,
    `  properties: {`,
    `    groupShortName: '${String(node.properties.shortName)}'`,
    `    enabled: true`,
    `    emailReceivers: [`,
    `      {`,
    `        name: 'ops'`,
    `        emailAddress: ${quote.bicep(String(node.properties.email))}`,
    `        useCommonAlertSchema: true`,
    `      }`,
    `    ]`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitMonitorAlert(node: GraphNode, ctx: GeneratorContext): string {
  const ident = nodeRef(ctx, node.id);
  const actionGroup = targetOfType(ctx, node.id, "depends_on", "actionGroup");
  const actionIdent = actionGroup ? nodeRef(ctx, actionGroup.id) : undefined;
  return [
    autoComment(ctx, node.id, "//"),
    `// Monitor Alert ${ctx.name(node.id)}: add workload-specific metric/log criteria before production deployment.`,
    ...(actionIdent ? [`// Routes to action group: ${actionIdent}`] : []),
    `resource ${ident} '${typed("Microsoft.Insights/metricAlerts")}' = {`,
    `  name: '${ctx.name(node.id)}'`,
    `  location: 'global'`,
    `  properties: {`,
    `    description: '${String(node.properties.condition)}'`,
    `    severity: 2`,
    `    enabled: ${node.properties.enabled !== false}`,
    `    scopes: [resourceGroup().id]`,
    `    evaluationFrequency: 'PT5M'`,
    `    windowSize: 'PT5M'`,
    `    criteria: {`,
    `      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'`,
    `      allOf: []`,
    `    }`,
    `    actions: [${actionIdent ? `{ actionGroupId: ${actionIdent}.id }` : ""}]`,
    `  }`,
    tagsLiteral(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitRoleAssignmentNode(node: GraphNode, ctx: GeneratorContext): string {
  return [
    autoComment(ctx, node.id, "//"),
    `// Role Assignment ${ctx.name(node.id)} (${String(node.properties.roleDefinitionName)})`,
    `// Direct identity edges are expanded into deployable roleAssignments where the generator can resolve principalId and scope.`,
  ].filter(Boolean).join("\n");
}

const EMITTERS: Record<ServiceType, (node: GraphNode, ctx: GeneratorContext) => string> = {
  resourceGroup: () => emitResourceGroup(),
  virtualNetwork: emitVirtualNetwork,
  subnet: emitSubnet,
  networkSecurityGroup: emitNsg,
  privateEndpoint: emitPrivateEndpoint,
  privateDnsZone: emitPrivateDnsZone,
  appServicePlan: emitAppServicePlan,
  appService: emitSite,
  functionApp: emitSite,
  staticWebApp: emitStaticWebApp,
  aksCluster: emitAksCluster,
  virtualMachineScaleSet: emitVmss,
  storageAccount: emitStorageAccount,
  sqlDatabase: emitSqlDatabase,
  cosmosDb: emitCosmosDb,
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
  roleAssignment: emitRoleAssignmentNode,
};

function emitDiagnostics(ctx: GeneratorContext): string {
  const blocks: string[] = [];
  for (const edge of ctx.edges) {
    const target = ctx.nodesById.get(edge.target)!;
    if (edge.kind !== "diagnostic" || target.type !== "logAnalytics" || !DIAGNOSTIC_SOURCES.has(ctx.nodesById.get(edge.source)!.type)) continue;
    const sIdent = nodeRef(ctx, edge.source);
    const tIdent = nodeRef(ctx, target.id);
    blocks.push(
      [
        `resource ${sIdent}_to_${tIdent} '${typed("Microsoft.Insights/diagnosticSettings")}' = {`,
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

function roleAssignment(ctx: GeneratorContext, grant: RoleGrant): string {
  const pIdent = nodeRef(ctx, grant.principal.id);
  const sIdent = nodeRef(ctx, grant.scope.id);
  const principalId = grant.principal.type === "userAssignedIdentity" ? `${pIdent}.properties.principalId` : `${pIdent}.identity.principalId`;
  return [
    `resource ${grantRef(ctx, grant)} '${typed("Microsoft.Authorization/roleAssignments")}' = {`,
    `  scope: ${sIdent}`,
    `  name: guid(${sIdent}.id, ${pIdent}.id, '${grant.role}')`,
    `  properties: {`,
    `    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '${grant.roleId}')`,
    `    principalId: ${principalId}`,
    `    principalType: 'ServicePrincipal'`,
    `  }`,
    `}`,
  ].join("\n");
}

function emitRoleGrants(ctx: GeneratorContext): string {
  return portableGrants(ctx)
    .filter((grant) => !writtenWithScope(grant))
    .map((grant) => roleAssignment(ctx, grant))
    .join("\n\n");
}

// Secure parameters (sqlAdminPassword, vmSshPublicKey) are supplied at
// deployment time, never written to the file.
function renderParametersFile(ctx: GeneratorContext): GeneratedFile {
  const { document } = ctx;
  const parameters: Record<string, { value: unknown }> = {
    location: { value: document.metadata.region },
    environmentTag: { value: document.metadata.environment },
  };
  if (ctx.hasVmss) parameters.vmAdminUsername = { value: "azureuser" };
  return {
    path: "main.parameters.json",
    language: "json",
    content: JSON.stringify(
      {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
        contentVersion: "1.0.0.0",
        parameters,
      },
      null,
      2,
    ),
  };
}

export function generateBicep(document: GraphDocument): GeneratorResult {
  const prepared = prepareGeneration(document);
  if (!prepared.ok) return prepared;
  const { ctx } = prepared;
  document = ctx.source;
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
  ];
  if (ctx.hasSql) {
    lines.push(
      `@secure()`,
      `param sqlAdminPassword string`,
      ``,
    );
  }
  if (ctx.hasVmss) {
    lines.push(
      `@description('Linux admin username for VM scale sets.')`,
      `param vmAdminUsername string = 'azureuser'`,
      ``,
      `@secure()`,
      `@description('SSH public key for VM scale sets.')`,
      `param vmSshPublicKey string`,
      ``,
    );
  }
  for (const node of ctx.order) lines.push(EMITTERS[node.type](node, ctx), "");
  const diag = emitDiagnostics(ctx);
  if (diag) lines.push(diag, "");
  const roles = emitRoleGrants(ctx);
  if (roles) lines.push(roles, "");

  const files: GeneratedFile[] = [
    {
      path: "main.bicep",
      language: "bicep",
      content: lines.join("\n"),
    },
    renderParametersFile(ctx),
  ];
  return { ok: true, files };
}
