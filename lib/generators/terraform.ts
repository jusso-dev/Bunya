import {
  GraphDocument,
  GraphNode,
  ServiceType,
} from "@/lib/graph/schema";
import { GeneratorContext, autoComment, buildGeneratorContext, findFirstOfType, incomingOf, outgoingOf } from "./shared/context";
import { GeneratorResult, GeneratedFile } from "./types";

function rgRef(ctx: GeneratorContext): string {
  if (!ctx.rgNode) return "azurerm_resource_group.main";
  return `azurerm_resource_group.${ctx.identifiers.get(ctx.rgNode.id)}`;
}

function ref(ctx: GeneratorContext, id: string, resource: string, attr: string): string {
  return `${resource}.${ctx.identifiers.get(id)}.${attr}`;
}

function tagsBlock(ctx: GeneratorContext, node: GraphNode): string {
  const baseTags: Record<string, string> = {
    environment: ctx.document.metadata.environment,
    managed_by: "bunya",
  };
  const userTags = (node.properties.tags as Record<string, string> | undefined) ?? {};
  const merged = { ...baseTags, ...userTags };
  const lines = Object.entries(merged)
    .map(([k, v]) => `    ${k} = "${v}"`)
    .join("\n");
  return `  tags = {\n${lines}\n  }`;
}

function emitResourceGroup(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_resource_group" "${ident}" {`,
    `  name     = "${ctx.resourceNames.get(node.id)}"`,
    `  location = "${ctx.document.metadata.region}"`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitVirtualNetwork(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const address = (node.properties.addressSpace as string) ?? "10.0.0.0/16";
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_virtual_network" "${ident}" {`,
    `  name                = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx)}.name`,
    `  location            = ${rgRef(ctx)}.location`,
    `  address_space       = ["${address}"]`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitSubnet(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const prefix = (node.properties.addressPrefix as string) ?? "10.0.1.0/24";
  const policies = (node.properties.privateEndpointNetworkPolicies as string) ?? "Disabled";
  const vnetEdge = outgoingOf(ctx, node.id, "depends_on").find((e) => {
    const t = ctx.nodesById.get(e.target);
    return t?.type === "virtualNetwork";
  });
  const vnetRef = vnetEdge
    ? `azurerm_virtual_network.${ctx.identifiers.get(vnetEdge.target)}.name`
    : `azurerm_virtual_network.main.name`;
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_subnet" "${ident}" {`,
    `  name                              = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name               = ${rgRef(ctx)}.name`,
    `  virtual_network_name              = ${vnetRef}`,
    `  address_prefixes                  = ["${prefix}"]`,
    `  private_endpoint_network_policies = "${policies}"`,
    `}`,
  ].filter(Boolean).join("\n");
}

function emitNsg(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_network_security_group" "${ident}" {`,
    `  name                = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx)}.name`,
    `  location            = ${rgRef(ctx)}.location`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitPrivateEndpoint(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const groupId = (node.properties.groupId as string) ?? "blob";
  const subnetEdge = outgoingOf(ctx, node.id, "network").find((e) => {
    const t = ctx.nodesById.get(e.target);
    return t?.type === "subnet";
  });
  const subnetId = subnetEdge
    ? `azurerm_subnet.${ctx.identifiers.get(subnetEdge.target)}.id`
    : `azurerm_subnet.main.id`;
  const targetEdge = outgoingOf(ctx, node.id, "network").find((e) => {
    const t = ctx.nodesById.get(e.target);
    return t && t.type !== "subnet";
  });
  const target = targetEdge ? ctx.nodesById.get(targetEdge.target) : undefined;
  let targetId = "null";
  if (target) {
    const map: Partial<Record<ServiceType, string>> = {
      storageAccount: "azurerm_storage_account",
      keyVault: "azurerm_key_vault",
      sqlDatabase: "azurerm_mssql_server",
      cosmosDb: "azurerm_cosmosdb_account",
      containerRegistry: "azurerm_container_registry",
      appService: "azurerm_linux_web_app",
      functionApp: "azurerm_linux_function_app",
    };
    const tfType = map[target.type];
    if (tfType) targetId = `${tfType}.${ctx.identifiers.get(target.id)}.id`;
  }
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_private_endpoint" "${ident}" {`,
    `  name                = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx)}.name`,
    `  location            = ${rgRef(ctx)}.location`,
    `  subnet_id           = ${subnetId}`,
    ``,
    `  private_service_connection {`,
    `    name                           = "${ctx.resourceNames.get(node.id)}-psc"`,
    `    private_connection_resource_id = ${targetId}`,
    `    is_manual_connection           = ${node.properties.manualApproval === true}`,
    `    subresource_names              = ["${groupId}"]`,
    `  }`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitAppServicePlan(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = (node.properties.sku as string) ?? "B1";
  const os = (node.properties.os as string) ?? "Linux";
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_service_plan" "${ident}" {`,
    `  name                = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx)}.name`,
    `  location            = ${rgRef(ctx)}.location`,
    `  os_type             = "${os}"`,
    `  sku_name            = "${sku}"`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitAppService(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const httpsOnly = node.properties.httpsOnly !== false;
  const alwaysOn = node.properties.alwaysOn !== false;
  const runtime = (node.properties.runtime as string) ?? "node";
  const runtimeVersion = (node.properties.runtimeVersion as string) ?? "20-lts";
  const publicNetworkAccess = node.properties.publicNetworkAccess !== false;
  const planEdge = outgoingOf(ctx, node.id, "depends_on").find(
    (e) => ctx.nodesById.get(e.target)?.type === "appServicePlan",
  );
  const planRef = planEdge
    ? `azurerm_service_plan.${ctx.identifiers.get(planEdge.target)}.id`
    : `azurerm_service_plan.main.id`;
  const settings: string[] = [];
  for (const edge of outgoingOf(ctx, node.id, "data")) {
    const t = ctx.nodesById.get(edge.target);
    if (t?.type === "storageAccount") {
      settings.push(
        `    AZURE_STORAGE_CONNECTION_STRING = azurerm_storage_account.${ctx.identifiers.get(t.id)}.primary_connection_string`,
      );
    }
    if (t?.type === "sqlDatabase") {
      settings.push(
        `    SQL_CONNECTION_STRING = "Server=tcp:\${azurerm_mssql_server.${ctx.identifiers.get(t.id)}.fully_qualified_domain_name},1433;Database=${ctx.resourceNames.get(t.id)};"`,
      );
    }
    if (t?.type === "cosmosDb") {
      settings.push(
        `    COSMOS_ENDPOINT = azurerm_cosmosdb_account.${ctx.identifiers.get(t.id)}.endpoint`,
      );
    }
  }
  for (const edge of outgoingOf(ctx, node.id, "identity")) {
    const t = ctx.nodesById.get(edge.target);
    if (t?.type === "keyVault") {
      settings.push(`    KEY_VAULT_URI = azurerm_key_vault.${ctx.identifiers.get(t.id)}.vault_uri`);
    }
  }
  const ai = findFirstOfType(ctx, "applicationInsights");
  if (ai && outgoingOf(ctx, node.id, "diagnostic").some((e) => e.target === ai.id)) {
    settings.push(
      `    APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.${ctx.identifiers.get(ai.id)}.connection_string`,
    );
  }
  const lines = [
    autoComment(ctx, node.id),
    `resource "azurerm_linux_web_app" "${ident}" {`,
    `  name                          = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name           = ${rgRef(ctx)}.name`,
    `  location                      = ${rgRef(ctx)}.location`,
    `  service_plan_id               = ${planRef}`,
    `  https_only                    = ${httpsOnly}`,
    `  public_network_access_enabled = ${publicNetworkAccess}`,
    ``,
    `  site_config {`,
    `    always_on           = ${alwaysOn}`,
    `    minimum_tls_version = "1.2"`,
    `    application_stack {`,
    `      ${runtime}_version = "${runtimeVersion}"`,
    `    }`,
    `  }`,
    ``,
    `  identity {`,
    `    type = "SystemAssigned"`,
    `  }`,
  ];
  if (settings.length > 0) {
    lines.push("", `  app_settings = {`, ...settings, `  }`);
  }
  lines.push(tagsBlock(ctx, node), `}`);
  return lines.filter(Boolean).join("\n");
}

function emitFunctionApp(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const httpsOnly = node.properties.httpsOnly !== false;
  const runtime = (node.properties.runtime as string) ?? "node";
  const runtimeVersion = (node.properties.runtimeVersion as string) ?? "20";
  const planEdge = outgoingOf(ctx, node.id, "depends_on").find(
    (e) => ctx.nodesById.get(e.target)?.type === "appServicePlan",
  );
  const planRef = planEdge
    ? `azurerm_service_plan.${ctx.identifiers.get(planEdge.target)}.id`
    : `azurerm_service_plan.main.id`;
  const storageEdge = outgoingOf(ctx, node.id, "data").find(
    (e) => ctx.nodesById.get(e.target)?.type === "storageAccount",
  );
  const storageName = storageEdge
    ? `azurerm_storage_account.${ctx.identifiers.get(storageEdge.target)}.name`
    : `azurerm_storage_account.main.name`;
  const storageKey = storageEdge
    ? `azurerm_storage_account.${ctx.identifiers.get(storageEdge.target)}.primary_access_key`
    : `azurerm_storage_account.main.primary_access_key`;
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_linux_function_app" "${ident}" {`,
    `  name                          = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name           = ${rgRef(ctx)}.name`,
    `  location                      = ${rgRef(ctx)}.location`,
    `  service_plan_id               = ${planRef}`,
    `  storage_account_name          = ${storageName}`,
    `  storage_account_access_key    = ${storageKey}`,
    `  https_only                    = ${httpsOnly}`,
    ``,
    `  site_config {`,
    `    minimum_tls_version = "1.2"`,
    `    application_stack {`,
    `      ${runtime}_version = "${runtimeVersion}"`,
    `    }`,
    `  }`,
    ``,
    `  identity {`,
    `    type = "SystemAssigned"`,
    `  }`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitStaticWebApp(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = (node.properties.sku as string) ?? "Standard";
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_static_web_app" "${ident}" {`,
    `  name                = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx)}.name`,
    `  location            = ${rgRef(ctx)}.location`,
    `  sku_tier            = "${sku}"`,
    `  sku_size            = "${sku}"`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitStorageAccount(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = (node.properties.sku as string) ?? "Standard_LRS";
  const kind = (node.properties.kind as string) ?? "StorageV2";
  const allowPublic = node.properties.allowPublicAccess === true;
  const tls = (node.properties.minTlsVersion as string) ?? "1.2";
  const tier = sku.startsWith("Premium") ? "Premium" : "Standard";
  const replication = sku.split("_")[1] ?? "LRS";
  const hns = node.properties.hierarchicalNamespace === true;
  const containers = (node.properties.containers as string[] | undefined) ?? [];
  const lines = [
    autoComment(ctx, node.id),
    `resource "azurerm_storage_account" "${ident}" {`,
    `  name                            = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name             = ${rgRef(ctx)}.name`,
    `  location                        = ${rgRef(ctx)}.location`,
    `  account_tier                    = "${tier}"`,
    `  account_replication_type        = "${replication}"`,
    `  account_kind                    = "${kind}"`,
    `  min_tls_version                 = "TLS1_${tls.split(".")[1]}"`,
    `  allow_nested_items_to_be_public = ${allowPublic}`,
    `  public_network_access_enabled   = ${allowPublic}`,
    `  is_hns_enabled                  = ${hns}`,
    tagsBlock(ctx, node),
    `}`,
  ];
  for (const c of containers) {
    lines.push(
      ``,
      `resource "azurerm_storage_container" "${ident}_${c}" {`,
      `  name                  = "${c}"`,
      `  storage_account_name  = azurerm_storage_account.${ident}.name`,
      `  container_access_type = "private"`,
      `}`,
    );
  }
  return lines.filter(Boolean).join("\n");
}

function emitSqlDatabase(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = (node.properties.sku as string) ?? "S0";
  const collation = (node.properties.collation as string) ?? "SQL_Latin1_General_CP1_CI_AS";
  const admin = (node.properties.adminLogin as string) ?? "bunyaadmin";
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_mssql_server" "${ident}" {`,
    `  name                         = "${ctx.resourceNames.get(node.id)}-srv"`,
    `  resource_group_name          = ${rgRef(ctx)}.name`,
    `  location                     = ${rgRef(ctx)}.location`,
    `  version                      = "12.0"`,
    `  administrator_login          = "${admin}"`,
    `  administrator_login_password = var.sql_admin_password`,
    `  minimum_tls_version          = "1.2"`,
    tagsBlock(ctx, node),
    `}`,
    ``,
    `resource "azurerm_mssql_database" "${ident}" {`,
    `  name        = "${ctx.resourceNames.get(node.id)}"`,
    `  server_id   = azurerm_mssql_server.${ident}.id`,
    `  sku_name    = "${sku}"`,
    `  collation   = "${collation}"`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitCosmosDb(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const consistency = (node.properties.consistency as string) ?? "Session";
  const freeTier = node.properties.freeTier === true;
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_cosmosdb_account" "${ident}" {`,
    `  name                = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx)}.name`,
    `  location            = ${rgRef(ctx)}.location`,
    `  offer_type          = "Standard"`,
    `  kind                = "GlobalDocumentDB"`,
    `  enable_free_tier    = ${freeTier}`,
    ``,
    `  consistency_policy {`,
    `    consistency_level = "${consistency}"`,
    `  }`,
    ``,
    `  geo_location {`,
    `    location          = ${rgRef(ctx)}.location`,
    `    failover_priority = 0`,
    `  }`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitKeyVault(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = (node.properties.sku as string) ?? "standard";
  const purgeProtection = node.properties.purgeProtection !== false;
  const retention = (node.properties.softDeleteRetentionDays as number) ?? 7;
  const rbac = node.properties.rbacAuthorization !== false;
  const publicNet = node.properties.publicNetworkAccess === true;
  const lines = [
    autoComment(ctx, node.id),
    `resource "azurerm_key_vault" "${ident}" {`,
    `  name                          = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name           = ${rgRef(ctx)}.name`,
    `  location                      = ${rgRef(ctx)}.location`,
    `  tenant_id                     = data.azurerm_client_config.current.tenant_id`,
    `  sku_name                      = "${sku}"`,
    `  purge_protection_enabled      = ${purgeProtection}`,
    `  soft_delete_retention_days    = ${retention}`,
    `  enable_rbac_authorization     = ${rbac}`,
    `  public_network_access_enabled = ${publicNet}`,
    tagsBlock(ctx, node),
    `}`,
  ];
  for (const edge of incomingOf(ctx, node.id, "identity")) {
    const src = ctx.nodesById.get(edge.source);
    if (!src) continue;
    const sIdent = ctx.identifiers.get(src.id);
    if (src.type === "appService") {
      lines.push(
        ``,
        `resource "azurerm_role_assignment" "${sIdent}_${ident}_secrets" {`,
        `  scope                = azurerm_key_vault.${ident}.id`,
        `  role_definition_name = "Key Vault Secrets User"`,
        `  principal_id         = azurerm_linux_web_app.${sIdent}.identity[0].principal_id`,
        `}`,
      );
    }
    if (src.type === "functionApp") {
      lines.push(
        ``,
        `resource "azurerm_role_assignment" "${sIdent}_${ident}_secrets" {`,
        `  scope                = azurerm_key_vault.${ident}.id`,
        `  role_definition_name = "Key Vault Secrets User"`,
        `  principal_id         = azurerm_linux_function_app.${sIdent}.identity[0].principal_id`,
        `}`,
      );
    }
    if (src.type === "userAssignedIdentity") {
      lines.push(
        ``,
        `resource "azurerm_role_assignment" "${sIdent}_${ident}_secrets" {`,
        `  scope                = azurerm_key_vault.${ident}.id`,
        `  role_definition_name = "Key Vault Secrets User"`,
        `  principal_id         = azurerm_user_assigned_identity.${sIdent}.principal_id`,
        `}`,
      );
    }
  }
  return lines.filter(Boolean).join("\n");
}

function emitAppInsights(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const workspaceEdge = outgoingOf(ctx, node.id, "depends_on").find(
    (e) => ctx.nodesById.get(e.target)?.type === "logAnalytics",
  );
  const workspaceRef = workspaceEdge
    ? `azurerm_log_analytics_workspace.${ctx.identifiers.get(workspaceEdge.target)}.id`
    : `null`;
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_application_insights" "${ident}" {`,
    `  name                = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx)}.name`,
    `  location            = ${rgRef(ctx)}.location`,
    `  application_type    = "${(node.properties.type as string) ?? "web"}"`,
    `  workspace_id        = ${workspaceRef}`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitLogAnalytics(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = (node.properties.sku as string) ?? "PerGB2018";
  const retention = (node.properties.retentionDays as number) ?? 30;
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_log_analytics_workspace" "${ident}" {`,
    `  name                = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx)}.name`,
    `  location            = ${rgRef(ctx)}.location`,
    `  sku                 = "${sku}"`,
    `  retention_in_days   = ${retention}`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitFrontDoor(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = (node.properties.sku as string) ?? "Standard_AzureFrontDoor";
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_cdn_frontdoor_profile" "${ident}" {`,
    `  name                = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx)}.name`,
    `  sku_name            = "${sku}"`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitApplicationGateway(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = (node.properties.sku as string) ?? "WAF_v2";
  const capacity = (node.properties.capacity as number) ?? 2;
  return [
    autoComment(ctx, node.id),
    `# Application Gateway requires further configuration (frontend IP, listeners, backend pools).`,
    `# Bunya emits the resource shell; configure pools to match your backends.`,
    `resource "azurerm_application_gateway" "${ident}" {`,
    `  name                = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx)}.name`,
    `  location            = ${rgRef(ctx)}.location`,
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
  const sku = (node.properties.sku as string) ?? "Consumption";
  const email = (node.properties.publisherEmail as string) ?? "ops@example.com";
  const name = (node.properties.publisherName as string) ?? "Bunya";
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_api_management" "${ident}" {`,
    `  name                = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx)}.name`,
    `  location            = ${rgRef(ctx)}.location`,
    `  publisher_name      = "${name}"`,
    `  publisher_email     = "${email}"`,
    `  sku_name            = "${sku}_0"`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

function emitContainerRegistry(node: GraphNode, ctx: GeneratorContext): string {
  const ident = ctx.identifiers.get(node.id);
  const sku = (node.properties.sku as string) ?? "Basic";
  const admin = node.properties.adminUserEnabled === true;
  const publicNet = node.properties.publicNetworkAccess !== false;
  return [
    autoComment(ctx, node.id),
    `resource "azurerm_container_registry" "${ident}" {`,
    `  name                          = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name           = ${rgRef(ctx)}.name`,
    `  location                      = ${rgRef(ctx)}.location`,
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
    `  name                = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name = ${rgRef(ctx)}.name`,
    `  location            = ${rgRef(ctx)}.location`,
    tagsBlock(ctx, node),
    `}`,
  ].filter(Boolean).join("\n");
}

const EMITTERS: Record<ServiceType, (node: GraphNode, ctx: GeneratorContext) => string> = {
  resourceGroup: emitResourceGroup,
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
  apiManagement: emitApiManagement,
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
    const sIdent = ctx.identifiers.get(source.id);
    const tIdent = ctx.identifiers.get(target.id);
    const tfResource: Partial<Record<ServiceType, string>> = {
      appService: "azurerm_linux_web_app",
      functionApp: "azurerm_linux_function_app",
      storageAccount: "azurerm_storage_account",
      keyVault: "azurerm_key_vault",
      sqlDatabase: "azurerm_mssql_database",
      cosmosDb: "azurerm_cosmosdb_account",
      containerRegistry: "azurerm_container_registry",
      applicationGateway: "azurerm_application_gateway",
      frontDoor: "azurerm_cdn_frontdoor_profile",
      apiManagement: "azurerm_api_management",
    };
    const tf = tfResource[source.type];
    if (!tf) continue;
    blocks.push(
      [
        `resource "azurerm_monitor_diagnostic_setting" "${sIdent}_to_${tIdent}" {`,
        `  name                       = "${sIdent}-to-${tIdent}"`,
        `  target_resource_id         = ${tf}.${sIdent}.id`,
        `  log_analytics_workspace_id = azurerm_log_analytics_workspace.${tIdent}.id`,
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
      `      version = "~> 4.0"`,
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

function renderVariablesFile(document: GraphDocument): GeneratedFile {
  return {
    path: "variables.tf",
    language: "hcl",
    content: [
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
      `variable "sql_admin_password" {`,
      `  type      = string`,
      `  sensitive = true`,
      `  default   = "ReplaceMeUsingTFVars!"`,
      `}`,
      ``,
    ].join("\n"),
  };
}

function renderOutputsFile(ctx: GeneratorContext): GeneratedFile {
  const lines: string[] = [];
  for (const node of ctx.document.nodes) {
    const ident = ctx.identifiers.get(node.id);
    if (!ident) continue;
    if (node.type === "appService") {
      lines.push(
        `output "${ident}_hostname" {`,
        `  value = azurerm_linux_web_app.${ident}.default_hostname`,
        `}`,
        ``,
      );
    }
    if (node.type === "functionApp") {
      lines.push(
        `output "${ident}_hostname" {`,
        `  value = azurerm_linux_function_app.${ident}.default_hostname`,
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
  }
  return {
    path: "outputs.tf",
    language: "hcl",
    content: lines.join("\n"),
  };
}

export function generateTerraform(document: GraphDocument): GeneratorResult {
  const ctx = buildGeneratorContext(document);
  if (!ctx.topo.ok) {
    return { ok: false, reason: "cycle detected", cycle: ctx.topo.cycle };
  }
  const blocks: string[] = [
    `# Generated by Bunya. Do not edit by hand.`,
    `# Document: ${document.metadata.name} (${document.metadata.environment})`,
    ``,
  ];
  for (const node of ctx.topo.order) {
    const emit = EMITTERS[node.type];
    if (!emit) continue;
    blocks.push(emit(node, ctx), "");
  }
  const diag = emitDiagnostics(ctx);
  if (diag) blocks.push(diag, "");

  const files: GeneratedFile[] = [
    renderVersionsFile(),
    { path: "main.tf", language: "hcl", content: blocks.join("\n") },
    renderVariablesFile(document),
    renderOutputsFile(ctx),
  ];
  return { ok: true, files };
}
