import { GraphDocument, GraphNode, ServiceType } from "@/lib/graph/schema";
import { GeneratorContext, buildGeneratorContext, outgoingOf } from "./shared/context";
import { GeneratedFile, GeneratorResult } from "./types";

function rgName(ctx: GeneratorContext): string {
  return ctx.rgNode ? ctx.resourceNames.get(ctx.rgNode.id)! : ctx.document.metadata.resourceGroupName;
}

function emit(node: GraphNode, ctx: GeneratorContext): string[] {
  const rg = rgName(ctx);
  const region = ctx.document.metadata.region;
  const name = ctx.resourceNames.get(node.id)!;
  const COMMON = `--only-show-errors --resource-group "${rg}"`;

  switch (node.type) {
    case "resourceGroup":
      return [
        `# Resource group ${name}`,
        `az group create --name "${name}" --location "${region}" --only-show-errors >/dev/null`,
      ];
    case "virtualNetwork":
      return [
        `# Virtual Network ${name}`,
        `az network vnet create ${COMMON} --name "${name}" --address-prefixes "${(node.properties.addressSpace as string) ?? "10.0.0.0/16"}" --location "${region}" >/dev/null`,
      ];
    case "subnet": {
      const vnetEdge = outgoingOf(ctx, node.id, "depends_on").find(
        (e) => ctx.nodesById.get(e.target)?.type === "virtualNetwork",
      );
      const vnetName = vnetEdge ? ctx.resourceNames.get(vnetEdge.target)! : "main-vnet";
      return [
        `# Subnet ${name}`,
        `az network vnet subnet create ${COMMON} --vnet-name "${vnetName}" --name "${name}" --address-prefixes "${(node.properties.addressPrefix as string) ?? "10.0.1.0/24"}" --private-endpoint-network-policies ${(node.properties.privateEndpointNetworkPolicies as string) ?? "Disabled"} >/dev/null`,
      ];
    }
    case "networkSecurityGroup":
      return [
        `# Network Security Group ${name}`,
        `az network nsg create ${COMMON} --name "${name}" --location "${region}" >/dev/null`,
      ];
    case "privateEndpoint": {
      const subnetEdge = outgoingOf(ctx, node.id, "network").find(
        (e) => ctx.nodesById.get(e.target)?.type === "subnet",
      );
      const subnetName = subnetEdge ? ctx.resourceNames.get(subnetEdge.target)! : "main-subnet";
      const vnetEdge = subnetEdge
        ? outgoingOf(ctx, subnetEdge.target, "depends_on").find(
            (e) => ctx.nodesById.get(e.target)?.type === "virtualNetwork",
          )
        : undefined;
      const vnetName = vnetEdge ? ctx.resourceNames.get(vnetEdge.target)! : "main-vnet";
      const targetEdge = outgoingOf(ctx, node.id, "network").find(
        (e) => ctx.nodesById.get(e.target)?.type !== "subnet",
      );
      const targetName = targetEdge ? ctx.resourceNames.get(targetEdge.target)! : "target";
      const targetType = targetEdge ? ctx.nodesById.get(targetEdge.target)!.type : "storageAccount";
      const map: Partial<Record<ServiceType, string>> = {
        storageAccount: "Microsoft.Storage/storageAccounts",
        keyVault: "Microsoft.KeyVault/vaults",
        sqlDatabase: "Microsoft.Sql/servers",
        cosmosDb: "Microsoft.DocumentDB/databaseAccounts",
        containerRegistry: "Microsoft.ContainerRegistry/registries",
      };
      const providerType = map[targetType] ?? "Microsoft.Storage/storageAccounts";
      return [
        `# Private Endpoint ${name}`,
        `target_id=$(az resource show ${COMMON} --name "${targetName}" --resource-type "${providerType}" --query id -o tsv)`,
        `az network private-endpoint create ${COMMON} --name "${name}" --vnet-name "${vnetName}" --subnet "${subnetName}" --private-connection-resource-id "$target_id" --group-id "${(node.properties.groupId as string) ?? "blob"}" --connection-name "${name}-psc" --location "${region}" >/dev/null`,
      ];
    }
    case "appServicePlan":
      return [
        `# App Service Plan ${name}`,
        `az appservice plan create ${COMMON} --name "${name}" --location "${region}" --sku "${(node.properties.sku as string) ?? "B1"}" ${(node.properties.os as string) === "Linux" ? "--is-linux" : ""} >/dev/null`,
      ];
    case "appService": {
      const planEdge = outgoingOf(ctx, node.id, "depends_on").find(
        (e) => ctx.nodesById.get(e.target)?.type === "appServicePlan",
      );
      const planName = planEdge ? ctx.resourceNames.get(planEdge.target)! : "main-plan";
      const runtime = (node.properties.runtime as string) ?? "node";
      const version = (node.properties.runtimeVersion as string) ?? "20-lts";
      return [
        `# App Service ${name}`,
        `az webapp create ${COMMON} --name "${name}" --plan "${planName}" --runtime "${runtime.toUpperCase()}|${version}" --https-only ${(node.properties.httpsOnly !== false).toString()} --assign-identity '[system]' >/dev/null`,
      ];
    }
    case "functionApp": {
      const planEdge = outgoingOf(ctx, node.id, "depends_on").find(
        (e) => ctx.nodesById.get(e.target)?.type === "appServicePlan",
      );
      const stEdge = outgoingOf(ctx, node.id, "data").find(
        (e) => ctx.nodesById.get(e.target)?.type === "storageAccount",
      );
      const planName = planEdge ? ctx.resourceNames.get(planEdge.target)! : "main-plan";
      const stName = stEdge ? ctx.resourceNames.get(stEdge.target)! : "mainstorage";
      const runtime = (node.properties.runtime as string) ?? "node";
      const version = (node.properties.runtimeVersion as string) ?? "20";
      return [
        `# Function App ${name}`,
        `az functionapp create ${COMMON} --name "${name}" --plan "${planName}" --storage-account "${stName}" --runtime "${runtime}" --runtime-version "${version}" --functions-version 4 --assign-identity '[system]' >/dev/null`,
      ];
    }
    case "staticWebApp":
      return [
        `# Static Web App ${name}`,
        `az staticwebapp create ${COMMON} --name "${name}" --location "${region}" --sku "${(node.properties.sku as string) ?? "Standard"}" >/dev/null`,
      ];
    case "storageAccount":
      return [
        `# Storage Account ${name}`,
        `az storage account create ${COMMON} --name "${name}" --location "${region}" --sku "${(node.properties.sku as string) ?? "Standard_LRS"}" --kind "${(node.properties.kind as string) ?? "StorageV2"}" --min-tls-version TLS1_${((node.properties.minTlsVersion as string) ?? "1.2").split(".")[1]} --allow-blob-public-access ${(node.properties.allowPublicAccess === true).toString()} --public-network-access ${node.properties.allowPublicAccess === true ? "Enabled" : "Disabled"} >/dev/null`,
      ];
    case "sqlDatabase":
      return [
        `# SQL Database ${name}`,
        `az sql server create ${COMMON} --name "${name}-srv" --location "${region}" --admin-user "${(node.properties.adminLogin as string) ?? "bunyaadmin"}" --admin-password "$SQL_ADMIN_PASSWORD" --minimal-tls-version 1.2 >/dev/null`,
        `az sql db create ${COMMON} --server "${name}-srv" --name "${name}" --service-objective "${(node.properties.sku as string) ?? "S0"}" >/dev/null`,
      ];
    case "cosmosDb":
      return [
        `# Cosmos DB ${name}`,
        `az cosmosdb create ${COMMON} --name "${name}" --locations regionName="${region}" failoverPriority=0 isZoneRedundant=false --default-consistency-level "${(node.properties.consistency as string) ?? "Session"}" --enable-free-tier ${(node.properties.freeTier === true).toString()} >/dev/null`,
      ];
    case "keyVault":
      return [
        `# Key Vault ${name}`,
        `az keyvault create ${COMMON} --name "${name}" --location "${region}" --sku "${(node.properties.sku as string) ?? "standard"}" --enable-rbac-authorization ${(node.properties.rbacAuthorization !== false).toString()} --enable-purge-protection ${(node.properties.purgeProtection !== false).toString()} --retention-days ${(node.properties.softDeleteRetentionDays as number) ?? 7} --public-network-access ${node.properties.publicNetworkAccess === true ? "Enabled" : "Disabled"} >/dev/null`,
      ];
    case "applicationInsights": {
      const wsEdge = outgoingOf(ctx, node.id, "depends_on").find(
        (e) => ctx.nodesById.get(e.target)?.type === "logAnalytics",
      );
      const wsName = wsEdge ? ctx.resourceNames.get(wsEdge.target)! : "main-workspace";
      return [
        `# Application Insights ${name}`,
        `az monitor app-insights component create ${COMMON} --app "${name}" --location "${region}" --kind web --workspace "${wsName}" >/dev/null`,
      ];
    }
    case "logAnalytics":
      return [
        `# Log Analytics Workspace ${name}`,
        `az monitor log-analytics workspace create ${COMMON} --workspace-name "${name}" --location "${region}" --sku "${(node.properties.sku as string) ?? "PerGB2018"}" --retention-time ${(node.properties.retentionDays as number) ?? 30} >/dev/null`,
      ];
    case "frontDoor":
      return [
        `# Front Door (Standard) ${name}`,
        `az afd profile create ${COMMON} --profile-name "${name}" --sku "${(node.properties.sku as string) ?? "Standard_AzureFrontDoor"}" >/dev/null`,
      ];
    case "applicationGateway":
      return [
        `# Application Gateway ${name}`,
        `# Requires existing subnet + public IP. Configure backends manually after create.`,
        `az network application-gateway create ${COMMON} --name "${name}" --location "${region}" --sku "${(node.properties.sku as string) ?? "WAF_v2"}" --capacity ${(node.properties.capacity as number) ?? 2} --priority 100 --vnet-name "main-vnet" --subnet "agw-subnet" >/dev/null || true`,
      ];
    case "apiManagement":
      return [
        `# API Management ${name}`,
        `az apim create ${COMMON} --name "${name}" --location "${region}" --publisher-name "${(node.properties.publisherName as string) ?? "Bunya"}" --publisher-email "${(node.properties.publisherEmail as string) ?? "ops@example.com"}" --sku-name "${(node.properties.sku as string) ?? "Consumption"}" >/dev/null`,
      ];
    case "containerRegistry":
      return [
        `# Container Registry ${name}`,
        `az acr create ${COMMON} --name "${name}" --location "${region}" --sku "${(node.properties.sku as string) ?? "Basic"}" --admin-enabled ${(node.properties.adminUserEnabled === true).toString()} >/dev/null`,
      ];
    case "userAssignedIdentity":
      return [
        `# User-assigned Managed Identity ${name}`,
        `az identity create ${COMMON} --name "${name}" --location "${region}" >/dev/null`,
      ];
  }
}

export function generateAzCli(document: GraphDocument): GeneratorResult {
  const ctx = buildGeneratorContext(document);
  if (!ctx.topo.ok) {
    return { ok: false, reason: "cycle detected", cycle: ctx.topo.cycle };
  }
  const lines: string[] = [
    `#!/usr/bin/env bash`,
    `# Generated by Bunya. Do not edit by hand.`,
    `# Document: ${document.metadata.name} (${document.metadata.environment})`,
    `set -euo pipefail`,
    ``,
    `: "\${SQL_ADMIN_PASSWORD:?Set SQL_ADMIN_PASSWORD before running this script}"`,
    ``,
    `echo "Checking Azure CLI login..."`,
    `az account show --only-show-errors >/dev/null || {`,
    `  echo "Run 'az login' first." >&2`,
    `  exit 1`,
    `}`,
    ``,
  ];

  for (const node of ctx.topo.order) {
    const block = emit(node, ctx);
    lines.push(...block, "");
  }

  return {
    ok: true,
    files: [{ path: "deploy.sh", language: "bash", content: lines.join("\n") }],
  };
}
