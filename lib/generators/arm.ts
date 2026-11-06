import { GraphDocument, GraphNode, ServiceType } from "@/lib/graph/schema";
import {
  GeneratorContext,
  dnsLinkName,
  dnsZoneName,
  endpointZones,
  prepareGeneration,
  sqlServerName,
  subnetOf,
  subnetVnet,
  targetOfType,
  targets,
  zoneVnets,
} from "./shared/context";
import { GeneratedFile, GeneratorResult } from "./types";
import { expr, planBody, siteBody, toArm, type Refs } from "./shared/site-resource";
import { contentShareName, deploymentContainerName, siteHosting, type SiteHosting } from "./shared/hosting";
import { roleGrants, type RoleGrant } from "./shared/roles";
import { apiVersion } from "./shared/api-versions";
import { ARM_TYPES, tlsVersionToArm } from "@/lib/catalogue/azure";
import { privateEndpointTarget, subnetDelegations } from "@/lib/graph/topology";
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

// `resourceId(...)` for a resource type and its name segments, without the
// [ ] that turn it into a template expression.
function idExpr(type: string, ...names: string[]): string {
  return `resourceId('${type}', ${names.map((part) => `'${part}'`).join(", ")})`;
}

function resourceId(type: string, ...names: string[]): string {
  return `[${idExpr(type, ...names)}]`;
}

// `reference(...)` to a resource's runtime properties.
function referenceExpr(type: string, name: string): string {
  return `reference(resourceId('${type}', '${name}'), '${apiVersion(type)}')`;
}

function resourceName(ctx: GeneratorContext, id: string): string {
  return ctx.name(id);
}

function dependsOn(ctx: GeneratorContext, node: GraphNode): string[] {
  return targets(ctx, node.id, "depends_on").flatMap((target) => (target.type === "resourceGroup" ? [] : [armResourceId(target, ctx)]));
}

// Name segments of a node's resource ID.
function idNames(ctx: GeneratorContext, node: GraphNode): string[] {
  if (node.type === "subnet") return [resourceName(ctx, subnetVnet(ctx, node).id), resourceName(ctx, node.id)];
  if (node.type === "sqlDatabase") return [sqlServerName(ctx, node), resourceName(ctx, node.id)];
  if (node.type === "privateDnsZone") return [dnsZoneName(node)];
  return [resourceName(ctx, node.id)];
}

function armIdExpr(node: GraphNode, ctx: GeneratorContext): string {
  return idExpr(ARM_TYPES[node.type], ...idNames(ctx, node));
}

function armResourceId(node: GraphNode, ctx: GeneratorContext): string {
  return `[${armIdExpr(node, ctx)}]`;
}

function emitVirtualNetwork(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.Network/virtualNetworks",
    apiVersion: apiVersion("Microsoft.Network/virtualNetworks"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    tags: ctx.tags(node),
    properties: {
      addressSpace: {
        addressPrefixes: [String(node.properties.addressSpace), ...((node.properties.additionalAddressSpaces as string[]))],
      },
      ...(Array.isArray(node.properties.dnsServers) && (node.properties.dnsServers as string[]).length > 0
        ? { dhcpOptions: { dnsServers: node.properties.dnsServers as string[] } }
        : {}),
    },
  };
}

function emitSubnet(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const vnetName = resourceName(ctx, subnetVnet(ctx, node).id);
  return {
    type: "Microsoft.Network/virtualNetworks/subnets",
    apiVersion: apiVersion("Microsoft.Network/virtualNetworks/subnets"),
    name: `${vnetName}/${resourceName(ctx, node.id)}`,
    properties: {
      addressPrefix: String(node.properties.addressPrefix),
      privateEndpointNetworkPolicies:
        String(node.properties.privateEndpointNetworkPolicies),
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
    apiVersion: apiVersion("Microsoft.Network/networkSecurityGroups"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    tags: ctx.tags(node),
    properties: { securityRules: [] },
  };
}

function emitPrivateEndpoint(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const target = privateEndpointTarget(ctx.document, node);
  const subnetId = armResourceId(subnetOf(ctx, node)!, ctx);
  const targetId = target ? armResourceId(target, ctx) : null;
  const zones = endpointZones(ctx, node);
  // ARM deploys in parallel: wait for the subnet and the target service.
  const dependencies = [subnetId, ...(targetId ? [targetId] : [])];
  return {
    type: "Microsoft.Network/privateEndpoints",
    apiVersion: apiVersion("Microsoft.Network/privateEndpoints"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    tags: ctx.tags(node),
    dependsOn: dependencies,
    properties: {
      subnet: { id: subnetId },
      privateLinkServiceConnections: [
        {
          name: `${resourceName(ctx, node.id)}-psc`,
          properties: {
            privateLinkServiceId: targetId,
            groupIds: [String(node.properties.groupId)],
          },
        },
      ],
    },
    resources: zones.length > 0
      ? [
          {
            type: "privateDnsZoneGroups",
            apiVersion: apiVersion("Microsoft.Network/privateEndpoints/privateDnsZoneGroups"),
            name: "default",
            dependsOn: [armResourceId(node, ctx), ...zones.map((zone) => armResourceId(zone, ctx))],
            properties: {
              privateDnsZoneConfigs: zones.map((zone) => ({
                name: resourceName(ctx, zone.id),
                properties: {
                  privateDnsZoneId: armResourceId(zone, ctx),
                },
              })),
            },
          },
        ]
      : undefined,
  };
}

function emitPrivateDnsZone(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.Network/privateDnsZones",
    apiVersion: apiVersion("Microsoft.Network/privateDnsZones"),
    name: dnsZoneName(node),
    location: "global",
    tags: ctx.tags(node),
    resources: zoneVnets(ctx, node).map((vnet) => ({
      type: "virtualNetworkLinks",
      apiVersion: apiVersion("Microsoft.Network/privateDnsZones/virtualNetworkLinks"),
      name: dnsLinkName(ctx, vnet),
      location: "global",
      dependsOn: [armResourceId(node, ctx), armResourceId(vnet, ctx)],
      properties: {
        registrationEnabled: false,
        virtualNetwork: {
          id: armResourceId(vnet, ctx),
        },
      },
    })),
  };
}

function armRefs(ctx: GeneratorContext): Refs {
  const storageType = "Microsoft.Storage/storageAccounts";
  return {
    id: (node) => expr(armIdExpr(node, ctx)),
    storageConnectionString: (storage) => {
      const st = resourceName(ctx, storage.id);
      return expr(`concat('DefaultEndpointsProtocol=https;AccountName=${st};EndpointSuffix=', environment().suffixes.storage, ';AccountKey=', listKeys(resourceId('${storageType}','${st}'),'${apiVersion(storageType)}').keys[0].value)`);
    },
    deploymentContainerUrl: (storage, site) => expr(`concat(${referenceExpr(storageType, resourceName(ctx, storage.id))}.primaryEndpoints.blob, '${deploymentContainerName(ctx, site)}')`),
    appInsightsConnectionString: (component) => expr(`${referenceExpr("Microsoft.Insights/components", resourceName(ctx, component.id))}.ConnectionString`),
    userIdentityClientId: (identity) => expr(`${referenceExpr("Microsoft.ManagedIdentity/userAssignedIdentities", resourceName(ctx, identity.id))}.clientId`),
  };
}

function emitAppServicePlan(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const body = planBody(node);
  return {
    type: "Microsoft.Web/serverfarms",
    apiVersion: apiVersion("Microsoft.Web/serverfarms"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    kind: body.kind,
    sku: toArm(body.sku) as Record<string, unknown>,
    properties: toArm(body.properties) as Record<string, unknown>,
    tags: ctx.tags(node),
  };
}

// Name segments of the blob container and file share Bunya adds to a
// Function App's storage account.
function deploymentContainerNames(ctx: GeneratorContext, site: GraphNode, hosting: SiteHosting): string[] {
  return [resourceName(ctx, hosting.storage!.id), "default", deploymentContainerName(ctx, site)];
}

function contentShareNames(ctx: GeneratorContext, site: GraphNode, hosting: SiteHosting): string[] {
  return [resourceName(ctx, hosting.storage!.id), "default", contentShareName(ctx, site)];
}

function emitSite(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const body = siteBody(ctx, node, armRefs(ctx));
  const { hosting } = body;
  return {
    type: "Microsoft.Web/sites",
    apiVersion: apiVersion("Microsoft.Web/sites"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    kind: body.kind,
    identity: toArm(body.identity) as Record<string, unknown>,
    properties: toArm(body.properties) as Record<string, unknown>,
    tags: ctx.tags(node),
    dependsOn: [...new Set([
      ...body.dependsOn.map((dep) => armResourceId(dep, ctx)),
      ...(hosting.flex ? [resourceId("Microsoft.Storage/storageAccounts/blobServices/containers", ...deploymentContainerNames(ctx, node, hosting))] : []),
      // A user-assigned pull identity can be granted AcrPull before the site
      // exists, so order the site after the grant; the first pull then succeeds.
      ...(hosting.registry && hosting.pullIdentity?.kind === "user"
        ? [grantId(ctx, { principal: hosting.pullIdentity.node, scope: hosting.registry, role: "AcrPull" })]
        : []),
      ...(hosting.privateContentShare ? [resourceId("Microsoft.Storage/storageAccounts/fileServices/shares", ...contentShareNames(ctx, node, hosting))] : []),
      // Private storage: the host starts as soon as the app exists, so wait
      // for the storage Private Endpoints, their DNS zone groups and links.
      ...hosting.storageEndpoints.flatMap(({ pe, hasDns }) => [
        armResourceId(pe, ctx),
        ...(hasDns ? [resourceId("Microsoft.Network/privateEndpoints/privateDnsZoneGroups", resourceName(ctx, pe.id), "default")] : []),
      ]),
      ...hosting.storageDnsLinks.map(({ zone, vnet }) => resourceId("Microsoft.Network/privateDnsZones/virtualNetworkLinks", dnsZoneName(zone), dnsLinkName(ctx, vnet))),
    ])],
  };
}

// File shares (secured Consumption and Elastic Premium content) and blob
// containers (Flex deployment packages) Function Apps need before they start.
function functionAppStorage(ctx: GeneratorContext): ArmResource[] {
  const apps = ctx.document.nodes.filter((node) => node.type === "functionApp").map((node) => ({ node, hosting: siteHosting(ctx, node) }));
  const containers = apps.filter(({ hosting }) => hosting.flex).map(({ node, hosting }) => {
    const names = deploymentContainerNames(ctx, node, hosting);
    return {
      type: "Microsoft.Storage/storageAccounts/blobServices/containers",
      apiVersion: apiVersion("Microsoft.Storage/storageAccounts/blobServices/containers"),
      name: names.join("/"),
      properties: { publicAccess: "None" },
      dependsOn: [armResourceId(hosting.storage!, ctx)],
    };
  });
  const shares = apps.filter(({ hosting }) => hosting.privateContentShare).map(({ node, hosting }) => {
    const names = contentShareNames(ctx, node, hosting);
    return {
      type: "Microsoft.Storage/storageAccounts/fileServices/shares",
      apiVersion: apiVersion("Microsoft.Storage/storageAccounts/fileServices/shares"),
      name: names.join("/"),
      properties: {},
      dependsOn: [armResourceId(hosting.storage!, ctx)],
    };
  });
  return [...containers, ...shares];
}

function emitStaticWebApp(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const sku = String(node.properties.sku);
  return {
    type: "Microsoft.Web/staticSites",
    apiVersion: apiVersion("Microsoft.Web/staticSites"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    sku: { name: sku, tier: sku },
    properties: {},
    tags: ctx.tags(node),
  };
}

function emitAksCluster(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const subnet = subnetOf(ctx, node);
  const workspace = targetOfType(ctx, node.id, "diagnostic", "logAnalytics");
  const authorizedRanges = (node.properties.authorizedIpRanges as string[]);
  const privateCluster = node.properties.privateCluster === true;
  const properties: Record<string, unknown> = {
    dnsPrefix: (node.properties.dnsPrefix as string) || resourceName(ctx, node.id),
    enableRBAC: true,
    agentPoolProfiles: [
      {
        name: "system",
        count: Number(node.properties.nodeCount),
        vmSize: String(node.properties.nodeVmSize),
        osType: "Linux",
        mode: "System",
        type: "VirtualMachineScaleSets",
        ...(subnet ? { vnetSubnetID: armResourceId(subnet, ctx) } : {}),
      },
    ],
    networkProfile: {
      networkPlugin: String(node.properties.networkPlugin),
      networkPolicy:
        (node.properties.networkPolicy as string) === "none"
          ? undefined
          : String(node.properties.networkPolicy),
      loadBalancerSku: "standard",
    },
    apiServerAccessProfile: {
      enablePrivateCluster: privateCluster,
      ...(authorizedRanges.length > 0 && !privateCluster
        ? { authorizedIPRanges: authorizedRanges }
        : {}),
    },
  };
  if (workspace) {
    properties.addonProfiles = {
      omsagent: {
        enabled: true,
        config: {
          logAnalyticsWorkspaceResourceID: armResourceId(workspace, ctx),
        },
      },
    };
  }
  return {
    type: "Microsoft.ContainerService/managedClusters",
    apiVersion: apiVersion("Microsoft.ContainerService/managedClusters"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    identity: { type: node.properties.managedIdentity === false ? "None" : "SystemAssigned" },
    properties,
    tags: ctx.tags(node),
  };
}

function emitVmss(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const sku = String(node.properties.sku);
  const capacity = Number(node.properties.capacity);
  return {
    type: "Microsoft.Compute/virtualMachineScaleSets",
    apiVersion: apiVersion("Microsoft.Compute/virtualMachineScaleSets"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    sku: { name: sku, tier: "Standard", capacity },
    identity: { type: "SystemAssigned" },
    properties: {
      orchestrationMode: String(node.properties.orchestrationMode),
      upgradePolicy: {
        mode: String(node.properties.upgradeMode),
      },
      automaticRepairsPolicy: {
        enabled: node.properties.automaticRepairs !== false,
        gracePeriod: "PT30M",
      },
      virtualMachineProfile: {
        storageProfile: {
          imageReference: {
            publisher: String(node.properties.imagePublisher),
            offer: String(node.properties.imageOffer),
            sku: String(node.properties.imageSku),
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
                      subnet: { id: armResourceId(subnetOf(ctx, node)!, ctx) },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
    tags: ctx.tags(node),
  };
}

function emitStorage(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const tls = String(node.properties.minTlsVersion);
  const allowPublic = node.properties.allowPublicAccess === true;
  return {
    type: "Microsoft.Storage/storageAccounts",
    apiVersion: apiVersion("Microsoft.Storage/storageAccounts"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    kind: String(node.properties.kind),
    sku: { name: String(node.properties.sku) },
    properties: {
      minimumTlsVersion: tlsVersionToArm(tls),
      allowBlobPublicAccess: allowPublic,
      publicNetworkAccess: storagePublicNetwork(node.properties) ? "Enabled" : "Disabled",
      supportsHttpsTrafficOnly: true,
    },
    tags: ctx.tags(node),
  };
}

function emitSqlDatabase(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const serverName = sqlServerName(ctx, node);
  return {
    type: "Microsoft.Sql/servers",
    apiVersion: apiVersion("Microsoft.Sql/servers"),
    name: serverName,
    location: "[parameters('location')]",
    properties: {
      administratorLogin: String(node.properties.adminLogin),
      administratorLoginPassword: "[parameters('sqlAdminPassword')]",
      minimalTlsVersion: "1.2",
      publicNetworkAccess: "Disabled",
    },
    tags: ctx.tags(node),
    resources: [
      {
        type: "databases",
        apiVersion: apiVersion("Microsoft.Sql/servers/databases"),
        name: resourceName(ctx, node.id),
        location: "[parameters('location')]",
        sku: { name: String(node.properties.sku) },
        dependsOn: [resourceId("Microsoft.Sql/servers", serverName)],
      },
    ],
  };
}

function emitCosmos(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.DocumentDB/databaseAccounts",
    apiVersion: apiVersion("Microsoft.DocumentDB/databaseAccounts"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    kind: "GlobalDocumentDB",
    properties: {
      databaseAccountOfferType: "Standard",
      enableFreeTier: node.properties.freeTier === true,
      consistencyPolicy: {
        defaultConsistencyLevel: String(node.properties.consistency),
      },
      locations: [{ locationName: "[parameters('location')]", failoverPriority: 0 }],
    },
    tags: ctx.tags(node),
  };
}

function emitKeyVault(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.KeyVault/vaults",
    apiVersion: apiVersion("Microsoft.KeyVault/vaults"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    properties: {
      sku: { family: "A", name: String(node.properties.sku) },
      tenantId: "[subscription().tenantId]",
      enablePurgeProtection: node.properties.purgeProtection !== false,
      softDeleteRetentionInDays: Number(node.properties.softDeleteRetentionDays),
      enableRbacAuthorization: node.properties.rbacAuthorization !== false,
      publicNetworkAccess:
        node.properties.publicNetworkAccess === true ? "Enabled" : "Disabled",
    },
    tags: ctx.tags(node),
  };
}

function emitAppInsights(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const workspace = targetOfType(ctx, node.id, "depends_on", "logAnalytics")!;
  return {
    type: "Microsoft.Insights/components",
    apiVersion: apiVersion("Microsoft.Insights/components"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    kind: "web",
    properties: {
      Application_Type: "web",
      WorkspaceResourceId: armResourceId(workspace, ctx),
    },
    tags: ctx.tags(node),
  };
}

function emitLogAnalytics(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.OperationalInsights/workspaces",
    apiVersion: apiVersion("Microsoft.OperationalInsights/workspaces"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    properties: {
      sku: { name: String(node.properties.sku) },
      retentionInDays: Number(node.properties.retentionDays),
    },
    tags: ctx.tags(node),
  };
}

function emitActionGroup(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.Insights/actionGroups",
    apiVersion: apiVersion("Microsoft.Insights/actionGroups"),
    name: resourceName(ctx, node.id),
    location: "global",
    properties: {
      groupShortName: String(node.properties.shortName),
      enabled: true,
      emailReceivers: [
        {
          name: "ops",
          emailAddress: String(node.properties.email),
          useCommonAlertSchema: true,
        },
      ],
    },
    tags: ctx.tags(node),
  };
}

function emitMonitorAlert(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const scopes = targets(ctx, node.id, "diagnostic").filter((target) => target.type !== "actionGroup");
  const actionGroups = targets(ctx, node.id, "depends_on").filter((target) => target.type === "actionGroup");
  return {
    type: "Microsoft.Insights/metricAlerts",
    apiVersion: apiVersion("Microsoft.Insights/metricAlerts"),
    name: resourceName(ctx, node.id),
    location: "global",
    properties: {
      description: String(node.properties.condition),
      severity: 2,
      enabled: node.properties.enabled !== false,
      scopes:
        scopes.length > 0 ? scopes.map((scope) => armResourceId(scope, ctx)) : ["[resourceGroup().id]"],
      evaluationFrequency: "PT5M",
      windowSize: "PT5M",
      criteria: {
        "odata.type": "Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria",
        allOf: [],
      },
      actions: actionGroups.map((group) => ({ actionGroupId: armResourceId(group, ctx) })),
    },
    tags: ctx.tags(node),
  };
}

function emitFrontDoor(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.Cdn/profiles",
    apiVersion: apiVersion("Microsoft.Cdn/profiles"),
    name: resourceName(ctx, node.id),
    location: "global",
    sku: { name: String(node.properties.sku) },
    tags: ctx.tags(node),
  };
}

function emitApplicationGateway(node: GraphNode, ctx: GeneratorContext): ArmResource {
  const sku = String(node.properties.sku);
  return {
    type: "Microsoft.Network/applicationGateways",
    apiVersion: apiVersion("Microsoft.Network/applicationGateways"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    properties: {
      sku: { name: sku, tier: sku, capacity: Number(node.properties.capacity) },
      gatewayIPConfigurations: [],
      frontendIPConfigurations: [],
      frontendPorts: [],
      backendAddressPools: [],
      backendHttpSettingsCollection: [],
      httpListeners: [],
      requestRoutingRules: [],
    },
    tags: ctx.tags(node),
  };
}

function emitApim(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.ApiManagement/service",
    apiVersion: apiVersion("Microsoft.ApiManagement/service"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    sku: { name: String(node.properties.sku), capacity: 0 },
    properties: {
      publisherName: String(node.properties.publisherName),
      publisherEmail: String(node.properties.publisherEmail),
    },
    tags: ctx.tags(node),
  };
}

function emitContainerRegistry(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.ContainerRegistry/registries",
    apiVersion: apiVersion("Microsoft.ContainerRegistry/registries"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    sku: { name: String(node.properties.sku) },
    properties: {
      adminUserEnabled: node.properties.adminUserEnabled === true,
      publicNetworkAccess: node.properties.publicNetworkAccess === false ? "Disabled" : "Enabled",
    },
    tags: ctx.tags(node),
  };
}

function emitUserAssignedIdentity(node: GraphNode, ctx: GeneratorContext): ArmResource {
  return {
    type: "Microsoft.ManagedIdentity/userAssignedIdentities",
    apiVersion: apiVersion("Microsoft.ManagedIdentity/userAssignedIdentities"),
    name: resourceName(ctx, node.id),
    location: "[parameters('location')]",
    properties: {},
    tags: ctx.tags(node),
  };
}

// Principal ID of a node's managed identity once it is deployed.
function principalIdExpression(principal: GraphNode, ctx: GeneratorContext): string {
  const type = ARM_TYPES[principal.type];
  const name = resourceName(ctx, principal.id);
  const reference = `reference(resourceId('${type}','${name}'), '${apiVersion(type)}'`;
  return principal.type === "userAssignedIdentity" ? `[${reference}).principalId]` : `[${reference}, 'Full').identity.principalId]`;
}

// guid() name of a role assignment, so a re-deployment updates it in place.
function grantName(ctx: GeneratorContext, { principal, scope, role }: Pick<RoleGrant, "principal" | "scope" | "role">): string {
  return `guid(${armIdExpr(scope, ctx)}, '${resourceName(ctx, principal.id)}', '${role}')`;
}

function grantId(ctx: GeneratorContext, grant: Pick<RoleGrant, "principal" | "scope" | "role">): string {
  return `[extensionResourceId(${armIdExpr(grant.scope, ctx)}, 'Microsoft.Authorization/roleAssignments', ${grantName(ctx, grant)})]`;
}

function emitRoleAssignments(ctx: GeneratorContext): ArmResource[] {
  return roleGrants(ctx).map((grant) => ({
    type: "Microsoft.Authorization/roleAssignments",
    apiVersion: apiVersion("Microsoft.Authorization/roleAssignments"),
    scope: armResourceId(grant.scope, ctx),
    name: `[${grantName(ctx, grant)}]`,
    properties: {
      roleDefinitionId: `[subscriptionResourceId('Microsoft.Authorization/roleDefinitions','${grant.roleId}')]`,
      principalId: principalIdExpression(grant.principal, ctx),
      principalType: "ServicePrincipal",
    },
    dependsOn: [armResourceId(grant.scope, ctx), armResourceId(grant.principal, ctx)],
  }));
}

// Diagnostic settings are extension resources on the source.
function emitDiagnosticSettings(ctx: GeneratorContext): ArmResource[] {
  return ctx.edges
    .filter((edge) => edge.kind === "diagnostic" && ctx.nodesById.get(edge.target)!.type === "logAnalytics")
    .map((edge) => {
      const source = ctx.nodesById.get(edge.source)!;
      const target = ctx.nodesById.get(edge.target)!;
      return {
        type: "Microsoft.Insights/diagnosticSettings",
        apiVersion: apiVersion("Microsoft.Insights/diagnosticSettings"),
        scope: armResourceId(source, ctx),
        name: `[concat('${source.resourceName}-to-${target.resourceName}')]`,
        properties: {
          workspaceId: armResourceId(target, ctx),
          logs: [{ categoryGroup: "allLogs", enabled: true }],
          metrics: [{ category: "AllMetrics", enabled: true }],
        },
        dependsOn: [armResourceId(source, ctx)],
      };
    });
}

const EMITTERS: Partial<Record<ServiceType, (node: GraphNode, ctx: GeneratorContext) => ArmResource>> = {
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
  const prepared = prepareGeneration(document);
  if (!prepared.ok) return prepared;
  const { ctx } = prepared;
  document = ctx.source;
  const resources: ArmResource[] = [];
  for (const node of ctx.order) {
    const emit = EMITTERS[node.type];
    if (!emit) continue;
    const resource = emit(node, ctx);
    const deps = dependsOn(ctx, node);
    if (deps.length > 0) resource.dependsOn = [...(resource.dependsOn ?? []), ...deps];
    resources.push(resource);
  }
  resources.push(...functionAppStorage(ctx), ...emitRoleAssignments(ctx), ...emitDiagnosticSettings(ctx));
  const templateParameters: Record<string, unknown> = {
    location: { type: "string", defaultValue: document.metadata.region },
  };
  if (ctx.hasSql) {
    templateParameters.sqlAdminPassword = { type: "securestring" };
  }
  if (ctx.hasVmss) {
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

  // Secure parameters are supplied at deployment time, never written here.
  const paramFileParams: Record<string, unknown> = {
    location: { value: document.metadata.region },
  };
  if (ctx.hasVmss) paramFileParams.vmAdminUsername = { value: "azureuser" };

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
