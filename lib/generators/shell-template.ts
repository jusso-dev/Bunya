import type { ServiceType } from "@/lib/graph/schema";
import { planFamily } from "@/lib/catalogue/app-service-plans";
import { isSite, siteIntegrationSubnet } from "@/lib/graph/topology";
import { generateArm } from "./arm";
import type { GeneratorContext } from "./shared/context";
import type { GeneratorResult } from "./types";

// Why a shell export should hand the whole diagram to the reviewed ARM
// template instead of running create commands, or null.
// `noPrivateCreate` lists services whose create command in that shell cannot
// turn public network access off: creating them public and restricting them
// in a later, independently fallible step would leave a window open.
function templateReason(ctx: GeneratorContext, noPrivateCreate: ReadonlySet<ServiceType>): string | null {
  if (ctx.document.nodes.some((node) => noPrivateCreate.has(node.type) && node.properties.publicNetworkAccess === false)) {
    return "Private networking is configured atomically by the included ARM template.";
  }
  const because = (reason: string) => `${reason}, so this script deploys the included ARM template in one step.`;
  for (const node of ctx.document.nodes) {
    // The CLIs create zones, links, zone groups and DNS servers in separate
    // steps the scripts do not emit; the ARM template wires them together.
    if (node.type === "privateDnsZone" && ctx.edges.some((edge) => edge.kind === "network" && (edge.source === node.id || edge.target === node.id))) {
      return because(`Private DNS Zone "${node.resourceName}" is linked to endpoints or VNets`);
    }
    if (node.type === "virtualNetwork" && (node.properties.dnsServers as string[]).length > 0) {
      return because(`Virtual Network "${node.resourceName}" uses custom DNS servers`);
    }
    // Flex, Elastic Premium and container apps take several separately
    // failing (some preview-only) CLI steps.
    if (node.type === "appServicePlan" && planFamily(node.properties.sku) !== "dedicated") {
      return because(`App Service Plan "${node.resourceName}" uses ${String(node.properties.sku)}`);
    }
    if (isSite(node) && node.properties.containerImage) return because(`"${node.resourceName}" runs a container image`);
    if (isSite(node) && siteIntegrationSubnet(ctx.document, node)) return because(`"${node.resourceName}" uses VNet integration`);
  }
  return null;
}

// A deploy script that runs the ARM template, when the diagram needs one.
export function templateDeployment(ctx: GeneratorContext, shell: "bash" | "powershell", noPrivateCreate: ReadonlySet<ServiceType>): GeneratorResult | null {
  const reason = templateReason(ctx, noPrivateCreate);
  if (!reason) return null;
  const document = ctx.source;
  if (document.nodes.filter((node) => node.type === "resourceGroup").length > 1) return { ok: false, reason: "Private shell deployments currently support one resource group. Export separate diagrams per group to preserve deployment scope." };
  const arm = generateArm(document);
  if (!arm.ok) return arm;
  const { hasSql, hasVmss: hasVm } = ctx;
  const group = document.nodes.find((node) => node.type === "resourceGroup")?.resourceName ?? document.metadata.resourceGroupName;
  const bash = [
    "#!/usr/bin/env bash", "set -euo pipefail",
    `# ${reason}`,
    'SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"',
    `az group create --name '${group}' --location '${document.metadata.region}' --only-show-errors >/dev/null`,
    ...(hasSql ? [': "${SQL_ADMIN_PASSWORD:?Set SQL_ADMIN_PASSWORD to a unique password}"'] : []),
    ...(hasVm ? [': "${VM_SSH_PUBLIC_KEY:?Set VM_SSH_PUBLIC_KEY to your public key}"'] : []),
    `az deployment group create --resource-group '${group}' --template-file "$SCRIPT_DIR/azuredeploy.json" --parameters "@$SCRIPT_DIR/azuredeploy.parameters.json"${hasSql ? ' --parameters sqlAdminPassword="$SQL_ADMIN_PASSWORD"' : ""}${hasVm ? ' --parameters vmSshPublicKey="$VM_SSH_PUBLIC_KEY"' : ""}`,
    "",
  ].join("\n");
  const parameters = [
    `[string]$ResourceGroupName = '${group}'`,
    ...(hasSql ? ["[Parameter(Mandatory)] [SecureString]$SqlAdminPassword"] : []),
    ...(hasVm ? ["[Parameter(Mandatory)] [string]$VmSshPublicKey"] : []),
  ];
  const powershell = [
    `# ${reason}`,
    "[CmdletBinding(SupportsShouldProcess)]", `param(${parameters.join(",\n    ")})`,
    "$ErrorActionPreference = 'Stop'",
    `New-AzResourceGroup -Name $ResourceGroupName -Location '${document.metadata.region}' -Force | Out-Null`,
    "New-AzResourceGroupDeployment -ResourceGroupName $ResourceGroupName -TemplateFile (Join-Path $PSScriptRoot 'azuredeploy.json') -TemplateParameterFile (Join-Path $PSScriptRoot 'azuredeploy.parameters.json')" + (hasSql ? " -sqlAdminPassword $SqlAdminPassword" : "") + (hasVm ? " -vmSshPublicKey $VmSshPublicKey" : ""),
    "",
  ].join("\n");
  return { ok: true, files: [
    { path: shell === "bash" ? "deploy.sh" : "Deploy-Infrastructure.ps1", language: shell, content: shell === "bash" ? bash : powershell },
    ...arm.files,
  ] };
}
