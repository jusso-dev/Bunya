import type { GraphDocument } from "../../graph/schema";
import { generateArm } from "../arm";
import type { GeneratorResult } from "../types";

// Some high-level create commands cannot disable public ingress atomically.
// Use the same reviewed ARM template instead of creating a public resource and
// attempting to restrict it in a later, independently fallible operation.
export function generatePrivateDeployment(document: GraphDocument, shell: "bash" | "powershell"): GeneratorResult {
  if (document.nodes.filter((node) => node.type === "resourceGroup").length > 1) return { ok: false, reason: "Private shell deployments currently support one resource group. Export separate diagrams per group to preserve deployment scope." };
  const arm = generateArm(document);
  if (!arm.ok) return arm;
  const hasSql = document.nodes.some((node) => node.type === "sqlDatabase");
  const hasVm = document.nodes.some((node) => node.type === "virtualMachineScaleSet");
  const group = document.nodes.find((node) => node.type === "resourceGroup")?.resourceName ?? document.metadata.resourceGroupName;
  const bash = [
    "#!/usr/bin/env bash", "set -euo pipefail",
    '# Private networking is configured atomically by the included ARM template.',
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
    "# Private networking is configured atomically by the included ARM template.",
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
