import { GraphDocument, GraphNode, ServiceType } from "@/lib/graph/schema";
import { GeneratorContext, dnsZoneName, prepareGeneration, resourceGroupOf, sqlServerName, subnetOf, subnetVnet, targetOfType } from "./shared/context";
import { GeneratorResult } from "./types";
import { templateDeployment } from "./shell-template";
import { quote } from "./shared/quote";
import { ARM_TYPES, tlsVersionToArm } from "@/lib/catalogue/azure";
import { privateEndpointTarget, sitePlan } from "@/lib/graph/topology";
import { storagePublicNetwork } from "@/lib/catalogue/services";

// `az functionapp create` cannot turn public network access off.
const NO_PRIVATE_CREATE: ReadonlySet<ServiceType> = new Set(["functionApp"]);

function emit(node: GraphNode, ctx: GeneratorContext): string[] {
  const rg = ctx.name(resourceGroupOf(ctx, node).id);
  const region = ctx.document.metadata.region;
  const name = ctx.name(node.id);
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
        `az network vnet create ${COMMON} --name "${name}" --address-prefixes ${[String(node.properties.addressSpace), ...((node.properties.additionalAddressSpaces as string[]))].map((space) => `"${space}"`).join(" ")} --location "${region}" >/dev/null`,
      ];
    case "subnet": {
      const vnetName = ctx.name(subnetVnet(ctx, node).id);
      return [
        `# Subnet ${name}`,
        `az network vnet subnet create ${COMMON} --vnet-name "${vnetName}" --name "${name}" --address-prefixes "${String(node.properties.addressPrefix)}" --private-endpoint-network-policies ${String(node.properties.privateEndpointNetworkPolicies)} >/dev/null`,
      ];
    }
    case "networkSecurityGroup":
      return [
        `# Network Security Group ${name}`,
        `az network nsg create ${COMMON} --name "${name}" --location "${region}" >/dev/null`,
      ];
    case "privateEndpoint": {
      const subnet = subnetOf(ctx, node)!;
      const subnetName = ctx.name(subnet.id);
      const vnetName = ctx.name(subnetVnet(ctx, subnet).id);
      // A SQL endpoint connects to the logical server, not the database.
      const target = privateEndpointTarget(ctx.document, node);
      const targetName = !target ? "target" : target.type === "sqlDatabase" ? sqlServerName(ctx, target) : ctx.name(target.id);
      const providerType = !target ? ARM_TYPES.storageAccount : target.type === "sqlDatabase" ? "Microsoft.Sql/servers" : ARM_TYPES[target.type];
      return [
        `# Private Endpoint ${name}`,
        `target_id=$(az resource show ${COMMON} --name "${targetName}" --resource-type "${providerType}" --query id -o tsv)`,
        `az network private-endpoint create ${COMMON} --name "${name}" --vnet-name "${vnetName}" --subnet "${subnetName}" --private-connection-resource-id "$target_id" --group-id "${String(node.properties.groupId)}" --connection-name "${name}-psc" --location "${region}" >/dev/null`,
      ];
    }
    case "privateDnsZone":
      return [
        `# Private DNS Zone ${name}`,
        `az network private-dns zone create ${COMMON} --name "${dnsZoneName(node)}" >/dev/null`,
      ];
    case "appServicePlan":
      return [
        `# App Service Plan ${name}`,
        `az appservice plan create ${COMMON} --name "${name}" --location "${region}" --sku "${String(node.properties.sku)}" --number-of-workers ${Number(node.properties.capacity)}${(node.properties.os as string) === "Linux" ? " --is-linux" : ""} >/dev/null`,
      ];
    case "appService": {
      const planName = ctx.name(sitePlan(ctx.document, node)!.id);
      const runtime = String(node.properties.runtime);
      const version = String(node.properties.runtimeVersion);
      return [
        `# App Service ${name}`,
        `az webapp create ${COMMON} --name "${name}" --plan "${planName}" --runtime "${runtime.toUpperCase()}|${version}" --https-only ${(node.properties.httpsOnly !== false).toString()} --public-network-access ${node.properties.publicNetworkAccess === false ? "Disabled" : "Enabled"} --assign-identity '[system]' >/dev/null`,
      ];
    }
    case "functionApp": {
      const planName = ctx.name(sitePlan(ctx.document, node)!.id);
      const stName = ctx.name(targetOfType(ctx, node.id, "data", "storageAccount")!.id);
      const runtime = String(node.properties.runtime);
      const version = String(node.properties.runtimeVersion);
      return [
        `# Function App ${name}`,
        `az functionapp create ${COMMON} --name "${name}" --plan "${planName}" --storage-account "${stName}" --runtime "${runtime}" --runtime-version "${version}" --functions-version 4 --assign-identity '[system]' >/dev/null`,
      ];
    }
    case "staticWebApp":
      return [
        `# Static Web App ${name}`,
        `az staticwebapp create ${COMMON} --name "${name}" --location "${region}" --sku "${String(node.properties.sku)}" >/dev/null`,
      ];
    case "aksCluster": {
      const subnet = subnetOf(ctx, node);
      const subnetArg = subnet
        ? ` --vnet-subnet-id "$(az network vnet subnet show ${COMMON} --name "${ctx.name(subnet.id)}" --vnet-name "${ctx.name(subnetVnet(ctx, subnet).id)}" --query id -o tsv)"`
        : "";
      const privateArg = node.properties.privateCluster === true ? " --enable-private-cluster" : "";
      const policy = String(node.properties.networkPolicy);
      const policyArg = policy === "none" ? "" : ` --network-policy "${policy}"`;
      return [
        `# AKS ${name}`,
        `az aks create ${COMMON} --name "${name}" --location "${region}" --node-count ${Number(node.properties.nodeCount)} --node-vm-size "${String(node.properties.nodeVmSize)}" --network-plugin "${String(node.properties.networkPlugin)}"${policyArg} --enable-managed-identity${(node.properties.authorizedIpRanges as string[]).length ? ` --api-server-authorized-ip-ranges "${(node.properties.authorizedIpRanges as string[]).join(",")}"` : ""}${privateArg}${subnetArg} >/dev/null`,
      ];
    }
    case "virtualMachineScaleSet": {
      const subnetName = ctx.name(subnetOf(ctx, node)!.id);
      return [
        `# Virtual Machine Scale Set ${name}`,
        `: "\${VMSS_SSH_PUBLIC_KEY:?Set VMSS_SSH_PUBLIC_KEY before creating VM scale sets}"`,
        `az vmss create ${COMMON} --name "${name}" --location "${region}" --image "${String(node.properties.imagePublisher)}:${String(node.properties.imageOffer)}:${String(node.properties.imageSku)}:latest" --vm-sku "${String(node.properties.sku)}" --instance-count ${Number(node.properties.capacity)} --admin-username "${String(node.properties.adminUsername)}" --ssh-key-value "$VMSS_SSH_PUBLIC_KEY" --upgrade-policy-mode "${String(node.properties.upgradeMode)}" --subnet "${subnetName}" >/dev/null`,
      ];
    }
    case "storageAccount":
      return [
        `# Storage Account ${name}`,
        `az storage account create ${COMMON} --name "${name}" --location "${region}" --sku "${String(node.properties.sku)}" --kind "${String(node.properties.kind)}" --min-tls-version ${tlsVersionToArm(String(node.properties.minTlsVersion))} --allow-blob-public-access ${(node.properties.allowPublicAccess === true).toString()} --public-network-access ${storagePublicNetwork(node.properties) ? "Enabled" : "Disabled"} >/dev/null`,
      ];
    case "sqlDatabase":
      return [
        `# SQL Database ${name}`,
        `az sql server create ${COMMON} --name "${sqlServerName(ctx, node)}" --location "${region}" --admin-user "${String(node.properties.adminLogin)}" --admin-password "$SQL_ADMIN_PASSWORD" --minimal-tls-version 1.2 --enable-public-network false >/dev/null`,
        `az sql db create ${COMMON} --server "${sqlServerName(ctx, node)}" --name "${name}" --service-objective "${String(node.properties.sku)}" >/dev/null`,
      ];
    case "cosmosDb":
      return [
        `# Cosmos DB ${name}`,
        `az cosmosdb create ${COMMON} --name "${name}" --locations regionName="${region}" failoverPriority=0 isZoneRedundant=false --default-consistency-level "${String(node.properties.consistency)}" --enable-free-tier ${(node.properties.freeTier === true).toString()} >/dev/null`,
      ];
    case "keyVault":
      return [
        `# Key Vault ${name}`,
        `az keyvault create ${COMMON} --name "${name}" --location "${region}" --sku "${String(node.properties.sku)}" --enable-rbac-authorization ${(node.properties.rbacAuthorization !== false).toString()} --enable-purge-protection ${(node.properties.purgeProtection !== false).toString()} --retention-days ${Number(node.properties.softDeleteRetentionDays)} --public-network-access ${node.properties.publicNetworkAccess === true ? "Enabled" : "Disabled"} >/dev/null`,
      ];
    case "applicationInsights": {
      const wsName = ctx.name(targetOfType(ctx, node.id, "depends_on", "logAnalytics")!.id);
      return [
        `# Application Insights ${name}`,
        `az monitor app-insights component create ${COMMON} --app "${name}" --location "${region}" --kind web --workspace "${wsName}" >/dev/null`,
      ];
    }
    case "logAnalytics":
      return [
        `# Log Analytics Workspace ${name}`,
        `az monitor log-analytics workspace create ${COMMON} --workspace-name "${name}" --location "${region}" --sku "${String(node.properties.sku)}" --retention-time ${Number(node.properties.retentionDays)} >/dev/null`,
      ];
    case "monitorAlert":
      return [
        `# Monitor Alert ${name}`,
        `# Create metric/log alert criteria for '${name}' after confirming the workload-specific signal.`,
        `echo "Skipping alert rule ${name}: generated ARM/Bicep has the richer alert model." >/dev/null`,
      ];
    case "actionGroup":
      return [
        `# Action Group ${name}`,
        `az monitor action-group create ${COMMON} --name "${name}" --short-name "${String(node.properties.shortName)}" --action email ops ${quote.bash(String(node.properties.email))} >/dev/null`,
      ];
    case "frontDoor":
      return [
        `# Front Door (Standard) ${name}`,
        `az afd profile create ${COMMON} --profile-name "${name}" --sku "${String(node.properties.sku)}" >/dev/null`,
      ];
    case "applicationGateway":
      return [
        `# Application Gateway ${name}`,
        `# A gateway needs a dedicated subnet, a public IP, listeners and backend pools, which Bunya does not model.`,
        `echo "Skipping Application Gateway ${name}: create it with its frontend and backend configuration." >&2`,
      ];
    case "apiManagement":
      return [
        `# API Management ${name}`,
        `az apim create ${COMMON} --name "${name}" --location "${region}" --publisher-name "${String(node.properties.publisherName)}" --publisher-email ${quote.bash(String(node.properties.publisherEmail))} --sku-name "${String(node.properties.sku)}" >/dev/null`,
      ];
    case "containerRegistry":
      return [
        `# Container Registry ${name}`,
        `az acr create ${COMMON} --name "${name}" --location "${region}" --sku "${String(node.properties.sku)}" --admin-enabled ${(node.properties.adminUserEnabled === true).toString()} --public-network-enabled ${node.properties.publicNetworkAccess !== false} >/dev/null`,
      ];
    case "userAssignedIdentity":
      return [
        `# User-assigned Managed Identity ${name}`,
        `az identity create ${COMMON} --name "${name}" --location "${region}" >/dev/null`,
      ];
    case "roleAssignment":
      return [
        `# Role Assignment ${name}`,
        `# Role assignments require a principalId and scope. Generated ARM/Bicep can infer these from identity edges.`,
        `echo "Skipping role assignment ${name}: use generated ARM/Bicep for RBAC binding." >/dev/null`,
      ];
  }
}

export function generateAzCli(document: GraphDocument): GeneratorResult {
  const prepared = prepareGeneration(document);
  if (!prepared.ok) return prepared;
  const { ctx } = prepared;
  document = ctx.source;
  const template = templateDeployment(ctx, "bash", NO_PRIVATE_CREATE);
  if (template) return template;
  const lines: string[] = [
    `#!/usr/bin/env bash`,
    `# Generated by Bunya. Do not edit by hand.`,
    `# Document: ${document.metadata.name} (${document.metadata.environment})`,
    `set -euo pipefail`,
    ``,
  ];
  if (ctx.hasSql) {
    lines.push(
      `: "\${SQL_ADMIN_PASSWORD:?Set SQL_ADMIN_PASSWORD before running this script}"`,
      ``,
    );
  }
  lines.push(
    `echo "Checking Azure CLI login..."`,
    `az account show --only-show-errors >/dev/null || {`,
    `  echo "Run 'az login' first." >&2`,
    `  exit 1`,
    `}`,
    ``,
  );
  for (const node of ctx.order) lines.push(...emit(node, ctx), "");
  return {
    ok: true,
    files: [{ path: "deploy.sh", language: "bash", content: lines.join("\n") }],
  };
}
