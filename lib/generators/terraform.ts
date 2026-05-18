import {
  EdgeKind,
  GraphDocument,
  GraphEdge,
  GraphNode,
  ServiceType,
} from "@/lib/graph/schema";
import { topologicalSort } from "./shared/ordering";
import { azureResourceName, terraformIdentifier } from "./shared/naming";
import { GeneratorResult, GeneratedFile } from "./types";

type Context = {
  document: GraphDocument;
  nodesById: Map<string, GraphNode>;
  edges: GraphEdge[];
  rgNode: GraphNode | null;
  resourceNames: Map<string, string>;
  identifiers: Map<string, string>;
};

function buildContext(document: GraphDocument): Context {
  const nodesById = new Map(document.nodes.map((n) => [n.id, n]));
  const resourceNames = new Map<string, string>();
  const identifiers = new Map<string, string>();
  const seenIdents = new Set<string>();
  const seed = document.metadata.name;

  for (const node of document.nodes) {
    const name = azureResourceName(node.type, node.resourceName, seed);
    resourceNames.set(node.id, name);
    let ident = terraformIdentifier(node.resourceName);
    let suffix = 1;
    while (seenIdents.has(ident)) {
      ident = `${terraformIdentifier(node.resourceName)}_${suffix++}`;
    }
    seenIdents.add(ident);
    identifiers.set(node.id, ident);
  }

  return {
    document,
    nodesById,
    edges: document.edges,
    rgNode: document.nodes.find((n) => n.type === "resourceGroup") ?? null,
    resourceNames,
    identifiers,
  };
}

function rgReference(ctx: Context): string {
  if (!ctx.rgNode) return "azurerm_resource_group.main";
  const ident = ctx.identifiers.get(ctx.rgNode.id) ?? "main";
  return `azurerm_resource_group.${ident}`;
}

function incomingEdges(ctx: Context, targetId: string, kind: EdgeKind): GraphEdge[] {
  return ctx.edges.filter((e) => e.target === targetId && e.kind === kind);
}

function outgoingEdges(ctx: Context, sourceId: string, kind: EdgeKind): GraphEdge[] {
  return ctx.edges.filter((e) => e.source === sourceId && e.kind === kind);
}

function emitResourceGroup(node: GraphNode, ctx: Context): string {
  const ident = ctx.identifiers.get(node.id) ?? "main";
  const region = ctx.document.metadata.region;
  return [
    `resource "azurerm_resource_group" "${ident}" {`,
    `  name     = "${node.resourceName}"`,
    `  location = "${region}"`,
    `}`,
  ].join("\n");
}

function emitAppServicePlan(node: GraphNode, ctx: Context): string {
  const ident = ctx.identifiers.get(node.id) ?? "plan";
  const sku = (node.properties.sku as string | undefined) ?? "B1";
  const os = (node.properties.os as string | undefined) ?? "Linux";
  return [
    `resource "azurerm_service_plan" "${ident}" {`,
    `  name                = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name = ${rgReference(ctx)}.name`,
    `  location            = ${rgReference(ctx)}.location`,
    `  os_type             = "${os}"`,
    `  sku_name            = "${sku}"`,
    `}`,
  ].join("\n");
}

function emitAppService(node: GraphNode, ctx: Context): string {
  const ident = ctx.identifiers.get(node.id) ?? "app";
  const httpsOnly = node.properties.httpsOnly !== false;
  const alwaysOn = node.properties.alwaysOn !== false;
  const planEdge = outgoingEdges(ctx, node.id, "depends_on").find((e) => {
    const target = ctx.nodesById.get(e.target);
    return target?.type === "appServicePlan";
  });
  const planRef = planEdge
    ? `azurerm_service_plan.${ctx.identifiers.get(planEdge.target)}.id`
    : `azurerm_service_plan.main.id`;

  const dataEdges = outgoingEdges(ctx, node.id, "data");
  const identityEdges = outgoingEdges(ctx, node.id, "identity");
  const settings: string[] = [];
  for (const edge of dataEdges) {
    const target = ctx.nodesById.get(edge.target);
    if (target?.type === "storageAccount") {
      const tIdent = ctx.identifiers.get(target.id);
      settings.push(
        `    AZURE_STORAGE_CONNECTION_STRING = azurerm_storage_account.${tIdent}.primary_connection_string`,
      );
    }
  }
  for (const edge of identityEdges) {
    const target = ctx.nodesById.get(edge.target);
    if (target?.type === "keyVault") {
      const tIdent = ctx.identifiers.get(target.id);
      settings.push(`    KEY_VAULT_URI = azurerm_key_vault.${tIdent}.vault_uri`);
    }
  }

  const lines = [
    `resource "azurerm_linux_web_app" "${ident}" {`,
    `  name                = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name = ${rgReference(ctx)}.name`,
    `  location            = ${rgReference(ctx)}.location`,
    `  service_plan_id     = ${planRef}`,
    `  https_only          = ${httpsOnly}`,
    ``,
    `  site_config {`,
    `    always_on = ${alwaysOn}`,
    `    minimum_tls_version = "1.2"`,
    `  }`,
    ``,
    `  identity {`,
    `    type = "SystemAssigned"`,
    `  }`,
  ];
  if (settings.length > 0) {
    lines.push(``, `  app_settings = {`, ...settings, `  }`);
  }
  lines.push(`}`);
  return lines.join("\n");
}

function emitStorageAccount(node: GraphNode, ctx: Context): string {
  const ident = ctx.identifiers.get(node.id) ?? "stg";
  const sku = (node.properties.sku as string | undefined) ?? "Standard_LRS";
  const kind = (node.properties.kind as string | undefined) ?? "StorageV2";
  const allowPublic = node.properties.allowPublicAccess === true;
  const tls = (node.properties.minTlsVersion as string | undefined) ?? "1.2";
  const tier = sku.startsWith("Premium") ? "Premium" : "Standard";
  const replication = sku.split("_")[1] ?? "LRS";
  return [
    `resource "azurerm_storage_account" "${ident}" {`,
    `  name                            = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name             = ${rgReference(ctx)}.name`,
    `  location                        = ${rgReference(ctx)}.location`,
    `  account_tier                    = "${tier}"`,
    `  account_replication_type        = "${replication}"`,
    `  account_kind                    = "${kind}"`,
    `  min_tls_version                 = "TLS1_${tls.split(".")[1]}"`,
    `  allow_nested_items_to_be_public = ${allowPublic}`,
    `  public_network_access_enabled   = ${allowPublic}`,
    `}`,
  ].join("\n");
}

function emitKeyVault(node: GraphNode, ctx: Context): string {
  const ident = ctx.identifiers.get(node.id) ?? "kv";
  const sku = (node.properties.sku as string | undefined) ?? "standard";
  const purgeProtection = node.properties.purgeProtection !== false;
  const retention = (node.properties.softDeleteRetentionDays as number | undefined) ?? 7;
  const rbac = node.properties.rbacAuthorization !== false;
  const accessPolicies: string[] = [];
  for (const edge of incomingEdges(ctx, node.id, "identity")) {
    const source = ctx.nodesById.get(edge.source);
    if (!source) continue;
    if (source.type === "appService") {
      const sIdent = ctx.identifiers.get(source.id);
      accessPolicies.push(
        `resource "azurerm_role_assignment" "${sIdent}_${ident}_secrets_user" {`,
        `  scope                = azurerm_key_vault.${ident}.id`,
        `  role_definition_name = "Key Vault Secrets User"`,
        `  principal_id         = azurerm_linux_web_app.${sIdent}.identity[0].principal_id`,
        `}`,
      );
    }
  }
  const lines = [
    `resource "azurerm_key_vault" "${ident}" {`,
    `  name                       = "${ctx.resourceNames.get(node.id)}"`,
    `  resource_group_name        = ${rgReference(ctx)}.name`,
    `  location                   = ${rgReference(ctx)}.location`,
    `  tenant_id                  = data.azurerm_client_config.current.tenant_id`,
    `  sku_name                   = "${sku}"`,
    `  purge_protection_enabled   = ${purgeProtection}`,
    `  soft_delete_retention_days = ${retention}`,
    `  enable_rbac_authorization  = ${rbac}`,
    `}`,
  ];
  if (accessPolicies.length > 0) {
    lines.push("", ...accessPolicies);
  }
  return lines.join("\n");
}

const EMITTERS: Partial<Record<ServiceType, (node: GraphNode, ctx: Context) => string>> = {
  resourceGroup: emitResourceGroup,
  appServicePlan: emitAppServicePlan,
  appService: emitAppService,
  storageAccount: emitStorageAccount,
  keyVault: emitKeyVault,
};

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
    ].join("\n"),
  };
}

function renderOutputsFile(ctx: Context): GeneratedFile {
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
  const topo = topologicalSort(document);
  if (!topo.ok) {
    return { ok: false, reason: "cycle detected", cycle: topo.cycle };
  }
  const ctx = buildContext(document);

  const blocks: string[] = [
    `# Generated by Bunya. Do not edit by hand.`,
    `# Document: ${document.metadata.name} (${document.metadata.environment})`,
    ``,
  ];
  for (const node of topo.order) {
    const emit = EMITTERS[node.type];
    if (!emit) continue;
    blocks.push(emit(node, ctx), "");
  }

  const files: GeneratedFile[] = [
    renderVersionsFile(),
    { path: "main.tf", language: "hcl", content: blocks.join("\n") },
    renderVariablesFile(document),
    renderOutputsFile(ctx),
  ];

  return { ok: true, files };
}
