import { GraphDocument, GraphNode, ServiceType } from "@/lib/graph/schema";
import {
  GeneratorContext,
  autoComment,
  targets,
  dnsLinkName,
  dnsZoneName,
  endpointZones,
  prepareGeneration,
  resourceGroupOf,
  sqlServerName,
  subnetOf,
  subnetVnet,
  targetOfType,
  zoneVnets,
} from "./shared/context";
import { GeneratorResult, GeneratedFile } from "./types";
import { contentShareName, deploymentContainerName, siteHosting, type SiteHosting } from "./shared/hosting";
import { grantSuffix, portableGrants, writtenWithScope, type RoleGrant } from "./shared/roles";
import { quote } from "./shared/quote";
import { isSite, privateEndpointTarget, subnetDelegations } from "@/lib/graph/topology";
import { storagePublicNetwork } from "@/lib/catalogue/services";
import { DIAGNOSTIC_SOURCES, tlsVersionToArm } from "@/lib/catalogue/azure";
import { isServerlessPlan } from "@/lib/catalogue/app-service-plans";

const TF_TYPES: Partial<Record<ServiceType, string>> = {
  resourceGroup: "azurerm_resource_group",
  virtualNetwork: "azurerm_virtual_network",
  subnet: "azurerm_subnet",
  networkSecurityGroup: "azurerm_network_security_group",
  privateEndpoint: "azurerm_private_endpoint",
  privateDnsZone: "azurerm_private_dns_zone",
  appServicePlan: "azurerm_service_plan",
  appService: "azurerm_linux_web_app",
  staticWebApp: "azurerm_static_web_app",
  aksCluster: "azurerm_kubernetes_cluster",
  virtualMachineScaleSet: "azurerm_linux_virtual_machine_scale_set",
  storageAccount: "azurerm_storage_account",
  sqlDatabase: "azurerm_mssql_database",
  cosmosDb: "azurerm_cosmosdb_account",
  keyVault: "azurerm_key_vault",
  applicationInsights: "azurerm_application_insights",
  logAnalytics: "azurerm_log_analytics_workspace",
  monitorAlert: "azurerm_monitor_metric_alert",
  actionGroup: "azurerm_monitor_action_group",
  frontDoor: "azurerm_cdn_frontdoor_profile",
  applicationGateway: "azurerm_application_gateway",
  apiManagement: "azurerm_api_management",
  containerRegistry: "azurerm_container_registry",
  userAssignedIdentity: "azurerm_user_assigned_identity",
};

function tfType(ctx: GeneratorContext, node: GraphNode): string {
  if (node.type !== "functionApp") return TF_TYPES[node.type]!;
  return siteHosting(ctx, node).flex ? "azurerm_function_app_flex_consumption" : "azurerm_linux_function_app";
}

function ref(ctx: GeneratorContext, node: GraphNode): string {
  return `${tfType(ctx, node)}.${ctx.identifiers.get(node.id)}`;
}

function rgRef(ctx: GeneratorContext, node: GraphNode): string {
  return ref(ctx, resourceGroupOf(ctx, node));
}

function tagsBlock(ctx: GeneratorContext, node: GraphNode): string {
  const lines = Object.entries(ctx.tags(node))
    .map(([k, v]) => `    "${k}" = "${v}"`)
    .join("\n");
  return `  tags = {\n${lines}\n  }`;
}

function emitResourceGroup(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_resource_group" "${ident}" {`,
    `  name     = "${ctx.name(node.id)}"`,
    `  location = "${ctx.document.metadata.region}"`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function dnsServersLine(node: GraphNode, prefix: string): string[] {
  const servers = Array.isArray(node.properties.dnsServers) ? (node.properties.dnsServers as string[]) : [];
  return servers.length > 0 ? [`${prefix}[${servers.map((server) => `"${server}"`).join(", ")}]`] : [];
}

function emitVirtualNetwork(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const address = String(node.properties.addressSpace);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_virtual_network" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  location            = ${rgRef(ctx, node)}.location`,
    `  address_space       = [${[address, ...((node.properties.additionalAddressSpaces as string[]))].map((space) => `"${space}"`).join(", ")}]`,
    ...dnsServersLine(node, "  dns_servers         = "),
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitSubnet(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const prefix = String(node.properties.addressPrefix);
  const policies = String(node.properties.privateEndpointNetworkPolicies);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_subnet" "${ident}" {`,
    `  name                              = "${ctx.name(node.id)}"`,
    `  resource_group_name               = ${rgRef(ctx, node)}.name`,
    `  virtual_network_name              = ${ref(ctx, subnetVnet(ctx, node))}.name`,
    `  address_prefixes                  = ["${prefix}"]`,
    `  private_endpoint_network_policies = "${policies}"`,
    ...subnetDelegations(ctx.document, node).flatMap((service) => [
      ``,
      `  delegation {`,
      `    name = "${service.split("/")[1]}"`,
      `    service_delegation {`,
      `      name    = "${service}"`,
      `      actions = ["Microsoft.Network/virtualNetworks/subnets/action"]`,
      `    }`,
      `  }`,
    ]),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitNsg(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_network_security_group" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  location            = ${rgRef(ctx, node)}.location`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitPrivateEndpoint(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const groupId = String(node.properties.groupId);
  const target = privateEndpointTarget(ctx.document, node);
  // A SQL endpoint connects to the logical server, not the database.
  const targetId = !target ? "null" : target.type === "sqlDatabase" ? `azurerm_mssql_server.${ctx.identifiers.get(target.id)}.id` : `${ref(ctx, target)}.id`;
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_private_endpoint" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  location            = ${rgRef(ctx, node)}.location`,
    `  subnet_id           = ${ref(ctx, subnetOf(ctx, node)!)}.id`,
    ``,
    `  private_service_connection {`,
    `    name                           = "${ctx.name(node.id)}-psc"`,
    `    private_connection_resource_id = ${targetId}`,
    `    is_manual_connection           = ${node.properties.manualApproval === true}`,
    `    subresource_names              = ["${groupId}"]`,
    `  }`,
    ...privateDnsZoneGroup(ctx, node),
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function privateDnsZoneGroup(ctx: GeneratorContext, node: GraphNode): string[] {
  const zones = endpointZones(ctx, node);
  if (zones.length === 0) return [];
  return [
    ``,
    `  private_dns_zone_group {`,
    `    name                 = "default"`,
    `    private_dns_zone_ids = [${zones.map((zone) => `azurerm_private_dns_zone.${ctx.identifiers.get(zone.id)}.id`).join(", ")}]`,
    `  }`,
  ];
}

function emitAppServicePlan(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = String(node.properties.sku);
  const os = String(node.properties.os);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_service_plan" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  location            = ${rgRef(ctx, node)}.location`,
    `  os_type             = "${os}"`,
    `  sku_name            = "${sku}"`,
    ...(isServerlessPlan(sku) ? [] : [`  worker_count        = ${Number(node.properties.capacity)}`]),
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function connectionSettings(ctx: GeneratorContext, node: GraphNode, hosting: SiteHosting, includeStorage: boolean): string[] {
  const settings: string[] = [];
  for (const t of targets(ctx, node.id, "data")) {
    if (t.type === "storageAccount" && includeStorage) {
      settings.push(`    AZURE_STORAGE_CONNECTION_STRING = azurerm_storage_account.${ctx.identifiers.get(t.id)}.primary_connection_string`);
    }
    if (t.type === "sqlDatabase") {
      settings.push(`    SQL_CONNECTION_STRING = "Server=tcp:\${azurerm_mssql_server.${ctx.identifiers.get(t.id)}.fully_qualified_domain_name},1433;Database=${ctx.name(t.id)};"`);
    }
    if (t.type === "cosmosDb") {
      settings.push(`    COSMOS_ENDPOINT = azurerm_cosmosdb_account.${ctx.identifiers.get(t.id)}.endpoint`);
    }
  }
  for (const t of targets(ctx, node.id, "identity")) {
    if (t.type === "keyVault") settings.push(`    KEY_VAULT_URI = azurerm_key_vault.${ctx.identifiers.get(t.id)}.vault_uri`);
  }
  if (hosting.appInsights && node.type === "appService") {
    settings.push(`    APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.${ctx.identifiers.get(hosting.appInsights.id)}.connection_string`);
  }
  return settings;
}

function identityBlock(ctx: GeneratorContext, hosting: SiteHosting): string[] {
  if (hosting.userIdentities.length === 0) return [`  identity {`, `    type = "SystemAssigned"`, `  }`];
  const ids = hosting.userIdentities.map((identity) => `azurerm_user_assigned_identity.${ctx.identifiers.get(identity.id)}.id`);
  return [`  identity {`, `    type         = "SystemAssigned, UserAssigned"`, `    identity_ids = [${ids.join(", ")}]`, `  }`];
}

function registryConfig(ctx: GeneratorContext, hosting: SiteHosting): string[] {
  if (!hosting.image || !hosting.pullIdentity) return [];
  const lines = [`    container_registry_use_managed_identity = true`];
  if (hosting.pullIdentity.kind === "user") {
    lines.push(`    container_registry_managed_identity_client_id = azurerm_user_assigned_identity.${ctx.identifiers.get(hosting.pullIdentity.node.id)}.client_id`);
  }
  return lines;
}

// A user-assigned pull identity is granted AcrPull before the app starts, so
// the first image pull succeeds.
// Private storage: the app waits for its storage Private Endpoints (whose
// DNS zone group is inline) so the host can reach storage on first start.
function siteDependsOn(ctx: GeneratorContext, hosting: SiteHosting): string[] {
  const deps: string[] = [];
  if (hosting.registry && hosting.pullIdentity?.kind === "user") {
    deps.push(`azurerm_role_assignment.${grantName(ctx, { principal: hosting.pullIdentity.node, scope: hosting.registry, role: "AcrPull" })}`);
  }
  for (const { pe } of hosting.storageEndpoints) deps.push(ref(ctx, pe));
  for (const { zone, vnet } of hosting.storageDnsLinks) {
    deps.push(`azurerm_private_dns_zone_virtual_network_link.${dnsLinkIdent(ctx, zone, vnet)}`);
  }
  return deps.length > 0 ? ["", `  depends_on = [${deps.join(", ")}]`] : [];
}

function subnetLine(ctx: GeneratorContext, hosting: SiteHosting): string[] {
  return hosting.subnet ? [`  virtual_network_subnet_id     = azurerm_subnet.${ctx.identifiers.get(hosting.subnet.id)}.id`] : [];
}

function emitAppService(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const hosting = siteHosting(ctx, node);
  const runtime = String(node.properties.runtime);
  const runtimeVersion = String(node.properties.runtimeVersion);
  const planRef = `${ref(ctx, hosting.plan)}.id`;
  const settings = connectionSettings(ctx, node, hosting, true);
  const stack = hosting.image
    ? [`      docker_image_name   = "${hosting.image.imageAndTag}"`, `      docker_registry_url = "${hosting.image.registryUrl}"`]
    : [`      ${runtime}_version = "${runtimeVersion}"`];
  const lines = [
    autoComment(ctx, node.id),
    `resource "azurerm_linux_web_app" "${ident}" {`,
    `  name                          = "${ctx.name(node.id)}"`,
    `  resource_group_name           = ${rgRef(ctx, node)}.name`,
    `  location                      = ${rgRef(ctx, node)}.location`,
    `  service_plan_id               = ${planRef}`,
    `  https_only                    = ${node.properties.httpsOnly !== false}`,
    `  public_network_access_enabled = ${node.properties.publicNetworkAccess !== false}`,
    ...subnetLine(ctx, hosting),
    ``,
    `  site_config {`,
    `    always_on           = ${node.properties.alwaysOn !== false}`,
    `    minimum_tls_version = "1.2"`,
    ...(hosting.subnet ? [`    vnet_route_all_enabled = true`] : []),
    ...registryConfig(ctx, hosting),
    `    application_stack {`,
    ...stack,
    `    }`,
    `  }`,
    ``,
    ...identityBlock(ctx, hosting),
  ];
  if (settings.length > 0) lines.push("", `  app_settings = {`, ...settings, `  }`);
  lines.push(...siteDependsOn(ctx, hosting), tagsBlock(ctx, node), `}`);
  return lines.filter(Boolean).join("\n");
}

function emitFunctionApp(node: GraphNode, ctx: GeneratorContext): string {
  const hosting = siteHosting(ctx, node);
  return hosting.family === "flex" ? emitFlexFunctionApp(node, ctx, hosting) : emitLinuxFunctionApp(node, ctx, hosting);
}

function emitLinuxFunctionApp(node: GraphNode, ctx: GeneratorContext, hosting: SiteHosting): string {
  const ident = ctx.identifiers.get(node.id);
  const runtime = String(node.properties.runtime);
  const runtimeVersion = String(node.properties.runtimeVersion);
  const planRef = `${ref(ctx, hosting.plan)}.id`;
  const storage = ref(ctx, hosting.storage!);
  const settings = connectionSettings(ctx, node, hosting, false);
  if (hosting.privateContentShare) {
    // Secured storage: the provider requires a pre-created share named in
    // WEBSITE_CONTENTSHARE when WEBSITE_CONTENTOVERVNET is set.
    settings.push(`    WEBSITE_CONTENTOVERVNET = "1"`, `    WEBSITE_CONTENTSHARE    = azurerm_storage_share.${ident}_content.name`);
  }
  const stack = hosting.image
    ? [
        `      docker {`,
        `        registry_url = "${hosting.image.registryUrl}"`,
        `        image_name   = "${hosting.image.repository}"`,
        `        image_tag    = "${hosting.image.tag}"`,
        `      }`,
      ]
    : runtime === "dotnet"
      ? [`      dotnet_version              = "${runtimeVersion}"`, `      use_dotnet_isolated_runtime = true`]
      : [`      ${runtime === "powershell" ? "powershell_core" : runtime}_version = "${runtimeVersion}"`];
  const lines = [
    autoComment(ctx, node.id),
    ...(hosting.privateContentShare
      ? [
          `resource "azurerm_storage_share" "${ident}_content" {`,
          `  name               = "${contentShareName(ctx, node)}"`,
          `  storage_account_id = ${storage}.id`,
          `  quota              = 100`,
          `}`,
          ``,
        ]
      : []),
    `resource "azurerm_linux_function_app" "${ident}" {`,
    `  name                          = "${ctx.name(node.id)}"`,
    `  resource_group_name           = ${rgRef(ctx, node)}.name`,
    `  location                      = ${rgRef(ctx, node)}.location`,
    `  service_plan_id               = ${planRef}`,
    `  storage_account_name          = ${storage}.name`,
    `  storage_account_access_key    = ${storage}.primary_access_key`,
    `  public_network_access_enabled = ${node.properties.publicNetworkAccess !== false}`,
    `  https_only                    = ${node.properties.httpsOnly !== false}`,
    ...subnetLine(ctx, hosting),
    ``,
    `  site_config {`,
    `    minimum_tls_version = "1.2"`,
    ...(hosting.family === "dedicated" ? [`    always_on           = true`] : []),
    ...(hosting.subnet ? [`    vnet_route_all_enabled = true`] : []),
    ...(hosting.appInsights ? [`    application_insights_connection_string = azurerm_application_insights.${ctx.identifiers.get(hosting.appInsights.id)}.connection_string`] : []),
    ...registryConfig(ctx, hosting),
    `    application_stack {`,
    ...stack,
    `    }`,
    `  }`,
    ``,
    ...identityBlock(ctx, hosting),
  ];
  if (settings.length > 0) lines.push("", `  app_settings = {`, ...settings, `  }`);
  lines.push(...siteDependsOn(ctx, hosting), tagsBlock(ctx, node), `}`);
  return lines.filter(Boolean).join("\n");
}

// Flex Consumption: azurerm_function_app_flex_consumption deploys packages
// from a blob container and takes runtime and scale settings directly.
function emitFlexFunctionApp(node: GraphNode, ctx: GeneratorContext, hosting: SiteHosting): string {
  const ident = ctx.identifiers.get(node.id);
  const planRef = `${ref(ctx, hosting.plan)}.id`;
  const storage = ref(ctx, hosting.storage!);
  const settings = connectionSettings(ctx, node, hosting, false);
  const lines = [
    autoComment(ctx, node.id),
    `resource "azurerm_storage_container" "${ident}_deployment" {`,
    `  name                  = "${deploymentContainerName(ctx, node)}"`,
    `  storage_account_id    = ${storage}.id`,
    `  container_access_type = "private"`,
    `}`,
    ``,
    `resource "azurerm_function_app_flex_consumption" "${ident}" {`,
    `  name                          = "${ctx.name(node.id)}"`,
    `  resource_group_name           = ${rgRef(ctx, node)}.name`,
    `  location                      = ${rgRef(ctx, node)}.location`,
    `  service_plan_id               = ${planRef}`,
    `  storage_container_type        = "blobContainer"`,
    `  storage_container_endpoint    = "\${${storage}.primary_blob_endpoint}\${azurerm_storage_container.${ident}_deployment.name}"`,
    `  storage_authentication_type   = "StorageAccountConnectionString"`,
    `  storage_access_key            = ${storage}.primary_access_key`,
    `  runtime_name                  = "${hosting.workerRuntime}"`,
    `  runtime_version               = "${hosting.flexVersion}"`,
    `  maximum_instance_count        = ${Number(node.properties.maximumInstanceCount)}`,
    `  instance_memory_in_mb         = ${Number(node.properties.instanceMemoryMB)}`,
    `  public_network_access_enabled = ${node.properties.publicNetworkAccess !== false}`,
    `  https_only                    = ${node.properties.httpsOnly !== false}`,
    ...subnetLine(ctx, hosting),
    ``,
    `  site_config {`,
    `    minimum_tls_version = "1.2"`,
    ...(hosting.appInsights ? [`    application_insights_connection_string = azurerm_application_insights.${ctx.identifiers.get(hosting.appInsights.id)}.connection_string`] : []),
    `  }`,
    ``,
    ...identityBlock(ctx, hosting),
  ];
  if (settings.length > 0) lines.push("", `  app_settings = {`, ...settings, `  }`);
  lines.push(...siteDependsOn(ctx, hosting), tagsBlock(ctx, node), `}`);
  return lines.filter(Boolean).join("\n");
}

function emitStaticWebApp(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = String(node.properties.sku);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_static_web_app" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  location            = ${rgRef(ctx, node)}.location`,
    `  sku_tier            = "${sku}"`,
    `  sku_size            = "${sku}"`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitAksCluster(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const subnet = subnetOf(ctx, node);
  const workspace = targetOfType(ctx, node.id, "diagnostic", "logAnalytics");
  const privateCluster = node.properties.privateCluster === true;
  const authorizedRanges = (node.properties.authorizedIpRanges as string[]);
  const networkPolicy = String(node.properties.networkPolicy);
  const lines = [
    autoComment(ctx, node.id),
    `resource "azurerm_kubernetes_cluster" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  location            = ${rgRef(ctx, node)}.location`,
    `  dns_prefix          = "${(node.properties.dnsPrefix as string) || ctx.name(node.id)}"`,
    `  private_cluster_enabled = ${privateCluster}`,
    `  role_based_access_control_enabled = true`,
  ];
  if ((node.properties.kubernetesVersion as string | undefined)?.trim()) {
    lines.push(`  kubernetes_version = "${node.properties.kubernetesVersion}"`);
  }
  if (authorizedRanges.length > 0 && !privateCluster) {
    lines.push(
      `  api_server_authorized_ip_ranges = [${authorizedRanges.map((r) => `"${r}"`).join(", ")}]`,
    );
  }
  lines.push(
    ``,
    `  default_node_pool {`,
    `    name       = "system"`,
    `    node_count = ${Number(node.properties.nodeCount)}`,
    `    vm_size    = "${String(node.properties.nodeVmSize)}"`,
    ...(subnet ? [`    vnet_subnet_id = ${ref(ctx, subnet)}.id`] : []),
    `  }`,
    ``,
    `  identity {`,
    `    type = "SystemAssigned"`,
    `  }`,
    ``,
    `  network_profile {`,
    `    network_plugin = "${String(node.properties.networkPlugin)}"`,
    `    load_balancer_sku = "standard"`,
    ...(networkPolicy === "none" ? [] : [`    network_policy = "${networkPolicy}"`]),
    `  }`,
  );
  if (workspace) {
    lines.push(
      ``,
      `  oms_agent {`,
      `    log_analytics_workspace_id = ${ref(ctx, workspace)}.id`,
      `  }`,
    );
  }
  lines.push(tagsBlock(ctx, node), `}`);
  return lines.filter(Boolean).join("\n");
}

function emitVmss(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_linux_virtual_machine_scale_set" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  location            = ${rgRef(ctx, node)}.location`,
    `  sku                 = "${String(node.properties.sku)}"`,
    `  instances           = ${Number(node.properties.capacity)}`,
    `  admin_username      = "${String(node.properties.adminUsername)}"`,
    `  upgrade_mode        = "${String(node.properties.upgradeMode)}"`,
    `  zones               = ["1", "2", "3"]`,
    ``,
    `  admin_ssh_key {`,
    `    username   = "${String(node.properties.adminUsername)}"`,
    `    public_key = var.vmss_ssh_public_key`,
    `  }`,
    ``,
    `  source_image_reference {`,
    `    publisher = "${String(node.properties.imagePublisher)}"`,
    `    offer     = "${String(node.properties.imageOffer)}"`,
    `    sku       = "${String(node.properties.imageSku)}"`,
    `    version   = "latest"`,
    `  }`,
    ``,
    `  os_disk {`,
    `    caching              = "ReadWrite"`,
    `    storage_account_type = "Premium_LRS"`,
    `  }`,
    ``,
    `  network_interface {`,
    `    name    = "nic"`,
    `    primary = true`,
    ``,
    `    ip_configuration {`,
    `      name      = "ipconfig1"`,
    `      primary   = true`,
    `      subnet_id = ${ref(ctx, subnetOf(ctx, node)!)}.id`,
    `    }`,
    `  }`,
    ``,
    `  automatic_instance_repair {`,
    `    enabled      = ${node.properties.automaticRepairs !== false}`,
    `    grace_period = "PT30M"`,
    `  }`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitStorageAccount(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = String(node.properties.sku);
  const kind = String(node.properties.kind);
  const allowPublic = node.properties.allowPublicAccess === true;
  const tls = String(node.properties.minTlsVersion);
  const tier = sku.startsWith("Premium") ? "Premium" : "Standard";
  const replication = sku.split("_")[1] ?? "LRS";
  const hns = node.properties.hierarchicalNamespace === true;
  const containers = (node.properties.containers as string[]);
  const lines = [
    autoComment(ctx, node.id),
    `resource "azurerm_storage_account" "${ident}" {`,
    `  name                            = "${ctx.name(node.id)}"`,
    `  resource_group_name             = ${rgRef(ctx, node)}.name`,
    `  location                        = ${rgRef(ctx, node)}.location`,
    `  account_tier                    = "${tier}"`,
    `  account_replication_type        = "${replication}"`,
    `  account_kind                    = "${kind}"`,
    `  min_tls_version                 = "${tlsVersionToArm(tls)}"`,
    `  allow_nested_items_to_be_public = ${allowPublic}`,
    `  public_network_access_enabled   = ${storagePublicNetwork(node.properties)}`,
    `  is_hns_enabled                  = ${hns}`,
    tagsBlock(ctx, node),
    `}`,
  ];
  for (const c of containers) {
    lines.push(
      ``,
      `resource "azurerm_storage_container" "${ident}_${c}" {`,
      `  name                  = "${c}"`,
      `  storage_account_id    = azurerm_storage_account.${ident}.id`,
      `  container_access_type = "private"`,
      `}`,
    );
  }
  return lines.filter(Boolean).join("\n");
}

function emitSqlDatabase(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = String(node.properties.sku);
  const collation = String(node.properties.collation);
  const admin = String(node.properties.adminLogin);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_mssql_server" "${ident}" {`,
    `  name                         = "${sqlServerName(ctx, node)}"`,
    `  resource_group_name          = ${rgRef(ctx, node)}.name`,
    `  location                     = ${rgRef(ctx, node)}.location`,
    `  version                      = "12.0"`,
    `  administrator_login          = "${admin}"`,
    `  administrator_login_password = var.sql_admin_password`,
    `  public_network_access_enabled = false`,
    `  minimum_tls_version          = "1.2"`,
    tagsBlock(ctx, node),
    `}`,
    ``,
    `resource "azurerm_mssql_database" "${ident}" {`,
    `  name        = "${ctx.name(node.id)}"`,
    `  server_id   = azurerm_mssql_server.${ident}.id`,
    `  sku_name    = "${sku}"`,
    `  collation   = "${collation}"`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitCosmosDb(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const consistency = String(node.properties.consistency);
  const freeTier = node.properties.freeTier === true;
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_cosmosdb_account" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  location            = ${rgRef(ctx, node)}.location`,
    `  offer_type          = "Standard"`,
    `  kind                = "GlobalDocumentDB"`,
    `  enable_free_tier    = ${freeTier}`,
    ``,
    `  consistency_policy {`,
    `    consistency_level = "${consistency}"`,
    `  }`,
    ``,
    `  geo_location {`,
    `    location          = ${rgRef(ctx, node)}.location`,
    `    failover_priority = 0`,
    `  }`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitKeyVault(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = String(node.properties.sku);
  const purgeProtection = node.properties.purgeProtection !== false;
  const retention = Number(node.properties.softDeleteRetentionDays);
  const rbac = node.properties.rbacAuthorization !== false;
  const publicNet = node.properties.publicNetworkAccess === true;
  const lines = [
    autoComment(ctx, node.id),
    `resource "azurerm_key_vault" "${ident}" {`,
    `  name                          = "${ctx.name(node.id)}"`,
    `  resource_group_name           = ${rgRef(ctx, node)}.name`,
    `  location                      = ${rgRef(ctx, node)}.location`,
    `  tenant_id                     = data.azurerm_client_config.current.tenant_id`,
    `  sku_name                      = "${sku}"`,
    `  purge_protection_enabled      = ${purgeProtection}`,
    `  soft_delete_retention_days    = ${retention}`,
    `  enable_rbac_authorization     = ${rbac}`,
    `  public_network_access_enabled = ${publicNet}`,
    tagsBlock(ctx, node),
    `}`,
  ];
  for (const grant of portableGrants(ctx).filter((candidate) => writtenWithScope(candidate) && candidate.scope.id === node.id)) lines.push(``, roleAssignment(ctx, grant));
  return lines.filter(Boolean).join("\n");
}

function emitAppInsights(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const workspace = targetOfType(ctx, node.id, "depends_on", "logAnalytics")!;
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_application_insights" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  location            = ${rgRef(ctx, node)}.location`,
    `  application_type    = "${String(node.properties.type)}"`,
    `  workspace_id        = ${ref(ctx, workspace)}.id`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitLogAnalytics(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = String(node.properties.sku);
  const retention = Number(node.properties.retentionDays);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_log_analytics_workspace" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  location            = ${rgRef(ctx, node)}.location`,
    `  sku                 = "${sku}"`,
    `  retention_in_days   = ${retention}`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitFrontDoor(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = String(node.properties.sku);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_cdn_frontdoor_profile" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  sku_name            = "${sku}"`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitApplicationGateway(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = String(node.properties.sku);
  const capacity = Number(node.properties.capacity);
  return [
    autoComment(ctx, node.id),
    `# Application Gateway requires further configuration (frontend IP, listeners, backend pools).`,
    `# Bunya emits the resource shell; configure pools to match your backends.`,
    `resource "azurerm_application_gateway" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  location            = ${rgRef(ctx, node)}.location`,
    ``,
    `  sku {`,
    `    name     = "${sku}"`,
    `    tier     = "${sku}"`,
    `    capacity = ${capacity}`,
    `  }`,
    `  # gateway_ip_configuration, frontend_port, frontend_ip_configuration etc. go here.`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitApiManagement(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = String(node.properties.sku);
  const email = String(node.properties.publisherEmail);
  const name = String(node.properties.publisherName);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_api_management" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  location            = ${rgRef(ctx, node)}.location`,
    `  publisher_name      = "${name}"`,
    `  publisher_email     = ${quote.hcl(email)}`,
    `  sku_name            = "${sku}_0"`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitContainerRegistry(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = String(node.properties.sku);
  const admin = node.properties.adminUserEnabled === true;
  const publicNet = node.properties.publicNetworkAccess !== false;
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_container_registry" "${ident}" {`,
    `  name                          = "${ctx.name(node.id)}"`,
    `  resource_group_name           = ${rgRef(ctx, node)}.name`,
    `  location                      = ${rgRef(ctx, node)}.location`,
    `  sku                           = "${sku}"`,
    `  admin_enabled                 = ${admin}`,
    `  public_network_access_enabled = ${publicNet}`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitUserAssignedIdentity(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_user_assigned_identity" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  location            = ${rgRef(ctx, node)}.location`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function dnsLinkIdent(ctx: GeneratorContext, zone: GraphNode, vnet: GraphNode): string {
  return `${ctx.identifiers.get(zone.id)}_${ctx.identifiers.get(vnet.id)}`;
}

function emitPrivateDnsZone(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_private_dns_zone" "${ident}" {`,
    `  name                = "${dnsZoneName(node)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    tagsBlock(ctx, node),
    `}`,
    ...zoneVnets(ctx, node).flatMap((vnet) => [
        ``,
        `resource "azurerm_private_dns_zone_virtual_network_link" "${dnsLinkIdent(ctx, node, vnet)}" {`,
        `  name                  = "${dnsLinkName(ctx, vnet)}"`,
        `  resource_group_name   = ${rgRef(ctx, node)}.name`,
        `  private_dns_zone_name = azurerm_private_dns_zone.${ident}.name`,
        `  virtual_network_id    = ${ref(ctx, vnet)}.id`,
        `  registration_enabled  = false`,
        `}`,
      ]),
  ].filter(Boolean).join("\n");
}

function emitActionGroup(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_monitor_action_group" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  short_name          = "${String(node.properties.shortName)}"`,
    ``,
    `  email_receiver {`,
    `    name                    = "ops"`,
    `    email_address           = ${quote.hcl(String(node.properties.email))}`,
    `    use_common_alert_schema = true`,
    `  }`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitMonitorAlert(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const actionGroup = targetOfType(ctx, node.id, "depends_on", "actionGroup");
  return [
    autoComment(ctx, node.id),
    `# Monitor Alert ${ctx.name(node.id)}: tune metric_name/threshold for the workload before production.`,
    `resource "azurerm_monitor_metric_alert" "${ident}" {`,
    `  name                = "${ctx.name(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx, node)}.name`,
    `  scopes              = [${rgRef(ctx, node)}.id]`,
    `  description         = "${String(node.properties.condition)}"`,
    `  enabled             = ${node.properties.enabled !== false}`,
    `  frequency           = "PT5M"`,
    `  window_size         = "PT5M"`,
    `  severity            = 2`,
    ``,
    `  criteria {`,
    `    metric_namespace = "Microsoft.Resources/subscriptions/resourceGroups"`,
    `    metric_name      = "AllMetrics"`,
    `    aggregation      = "Total"`,
    `    operator         = "GreaterThan"`,
    `    threshold        = 0`,
    `  }`,
    ...(actionGroup
      ? [
          ``,
          `  action {`,
          `    action_group_id = ${ref(ctx, actionGroup)}.id`,
          `  }`,
        ]
      : []),
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitRoleAssignmentNode(node: GraphNode, ctx: GeneratorContext): string {
  return [
    autoComment(ctx, node.id),
    `# Role Assignment ${ctx.name(node.id)} (${String(node.properties.roleDefinitionName)})`,
    `# Direct identity edges are expanded into azurerm_role_assignment blocks where principal and scope are resolvable.`,
  ].filter(Boolean).join("\n");
}

const EMITTERS: Record<ServiceType, (node: GraphNode, ctx: GeneratorContext) => string> = {
  resourceGroup: emitResourceGroup,
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
  apiManagement: emitApiManagement,
  containerRegistry: emitContainerRegistry,
  userAssignedIdentity: emitUserAssignedIdentity,
  roleAssignment: emitRoleAssignmentNode,
};

function emitDiagnostics(ctx: GeneratorContext): string {
  const blocks: string[] = [];
  for (const edge of ctx.edges) {
    const source = ctx.nodesById.get(edge.source)!;
    const target = ctx.nodesById.get(edge.target)!;
    if (edge.kind !== "diagnostic" || target.type !== "logAnalytics" || !DIAGNOSTIC_SOURCES.has(source.type)) continue;
    const sIdent = ctx.identifiers.get(source.id);
    const tIdent = ctx.identifiers.get(target.id);
    blocks.push(
      [
        `resource "azurerm_monitor_diagnostic_setting" "${sIdent}_to_${tIdent}" {`,
        `  name                       = "${sIdent}-to-${tIdent}"`,
        `  target_resource_id         = ${ref(ctx, source)}.id`,
        `  log_analytics_workspace_id = ${ref(ctx, target)}.id`,
        `  enabled_log {`,
        `    category_group = "allLogs"`,
        `  }`,
        `  metric {`,
        `    category = "AllMetrics"`,
        `  }`,
        `}`,
      ].join("\n"),
    );
  }
  return blocks.join("\n\n");
}

function grantName(ctx: GeneratorContext, { principal, scope, role }: Pick<RoleGrant, "principal" | "scope" | "role">): string {
  return `${ctx.identifiers.get(principal.id)}_${ctx.identifiers.get(scope.id)}_${grantSuffix({ scope, role })}`;
}

function roleAssignment(ctx: GeneratorContext, grant: RoleGrant): string {
  const principal = grant.principal.type === "userAssignedIdentity" ? `${ref(ctx, grant.principal)}.principal_id` : `${ref(ctx, grant.principal)}.identity[0].principal_id`;
  return [
    `resource "azurerm_role_assignment" "${grantName(ctx, grant)}" {`,
    `  scope                = ${ref(ctx, grant.scope)}.id`,
    `  role_definition_name = "${grant.role}"`,
    `  principal_id         = ${principal}`,
    `}`,
  ].join("\n");
}

function emitRoleGrants(ctx: GeneratorContext): string {
  return portableGrants(ctx)
    .filter((grant) => !writtenWithScope(grant))
    .map((grant) => roleAssignment(ctx, grant))
    .join("\n\n");
}

function renderVersionsFile(): GeneratedFile {
  return {
    path: "versions.tf",
    language: "hcl",
    content: [
      `terraform {`,
      `  required_version = ">= 1.6.0"`,
      `  required_providers {`,
      `    azurerm = {`,
      `      source  = "hashicorp/azurerm"`,
      `      version = "~> 4.35"`,
      `    }`,
      `  }`,
      `}`,
      ``,
      `provider "azurerm" {`,
      `  features {}`,
      `}`,
      ``,
      `data "azurerm_client_config" "current" {}`,
      ``,
    ].join("\n"),
  };
}

function renderVariablesFile(ctx: GeneratorContext): GeneratedFile {
  const { document } = ctx;
  const lines = [
    `variable "location" {`,
    `  type    = string`,
    `  default = "${document.metadata.region}"`,
    `}`,
    ``,
    `variable "environment" {`,
    `  type    = string`,
    `  default = "${document.metadata.environment}"`,
    `}`,
    ``,
  ];
  if (ctx.hasSql) {
    lines.push(
      `variable "sql_admin_password" {`,
      `  type      = string`,
      `  sensitive = true`,
      `}`,
      ``,
    );
  }
  if (ctx.hasVmss) {
    lines.push(
      `variable "vmss_ssh_public_key" {`,
      `  type      = string`,
      `  sensitive = true`,
      `}`,
      ``,
    );
  }
  return {
    path: "variables.tf",
    language: "hcl",
    content: lines.join("\n"),
  };
}

function renderOutputsFile(ctx: GeneratorContext): GeneratedFile {
  const lines: string[] = [];
  for (const node of ctx.document.nodes) {
    const ident = ctx.identifiers.get(node.id);
    if (isSite(node)) {
      lines.push(
        `output "${ident}_hostname" {`,
        `  value = ${ref(ctx, node)}.default_hostname`,
        `}`,
        ``,
      );
    }
    if (node.type === "storageAccount") {
      lines.push(
        `output "${ident}_id" {`,
        `  value = azurerm_storage_account.${ident}.id`,
        `}`,
        ``,
      );
    }
    if (node.type === "aksCluster") {
      lines.push(
        `output "${ident}_fqdn" {`,
        `  value = azurerm_kubernetes_cluster.${ident}.fqdn`,
        `}`,
        ``,
      );
    }
  }
  return {
    path: "outputs.tf",
    language: "hcl",
    content: lines.join("\n"),
  };
}

export function generateTerraform(document: GraphDocument): GeneratorResult {
  const prepared = prepareGeneration(document);
  if (!prepared.ok) return prepared;
  const { ctx } = prepared;
  document = ctx.source;
  const blocks: string[] = [
    `# Generated by Bunya. Do not edit by hand.`,
    `# Document: ${document.metadata.name} (${document.metadata.environment})`,
    ``,
  ];
  for (const node of ctx.order) blocks.push(EMITTERS[node.type](node, ctx), "");
  const diag = emitDiagnostics(ctx);
  if (diag) blocks.push(diag, "");
  const roles = emitRoleGrants(ctx);
  if (roles) blocks.push(roles, "");

  const files: GeneratedFile[] = [
    renderVersionsFile(),
    { path: "main.tf", language: "hcl", content: blocks.join("\n") },
    renderVariablesFile(ctx),
    renderOutputsFile(ctx),
  ];
  return { ok: true, files };
}
