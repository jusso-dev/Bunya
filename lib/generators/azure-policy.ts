import { validateGeneration } from "./shared/validate";
import { buildGeneratorContext } from "./shared/context";
import { GeneratedFile, GeneratorResult } from "./types";
import type { GraphDocument, ServiceType } from "@/lib/graph/schema";
import {
  COMPLIANCE_FRAMEWORKS,
  POLICY_DEFINITION_PREFIX,
  POLICY_METADATA_SOURCE,
  policiesForServiceTypes,
  type ResolvedPolicy,
} from "@/lib/rules/compliance";

// Exports the built-in Azure Policy definitions that check the same controls
// as Bunya's design-time rules, so the deployed resource groups keep being
// audited after `apply`. Bunya stays design-time only: it writes the files,
// the operator assigns them. Every effect is an audit effect; switching to
// Deny is a deliberate, reviewed change.
const AUDIT_EFFECTS = ["Audit", "AuditIfNotExists"];

type PolicyReference = {
  policyDefinitionReferenceId: string;
  policyDefinitionId: string;
  parameters: Record<string, { value: unknown }>;
};

type Included = { resolved: ResolvedPolicy; reference: PolicyReference; effect: string | null };
type Skipped = { resolved: ResolvedPolicy; reason: string };

function referenceIdFor(displayName: string, used: Set<string>): string {
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
  let id = base || "policy";
  for (let n = 2; used.has(id); n++) id = `${base.slice(0, 56)}-${n}`;
  used.add(id);
  return id;
}

function auditEffect(allowed: string[]): string | null {
  for (const preferred of AUDIT_EFFECTS) {
    const match = allowed.find((value) => value === preferred) ?? allowed.find((value) => value.toLowerCase() === preferred.toLowerCase());
    if (match) return match;
  }
  return null;
}

function graphLocations(document: GraphDocument): string[] {
  const regions = new Set<string>([document.metadata.region]);
  for (const node of document.nodes) {
    if (node.type === "resourceGroup" && typeof node.properties.region === "string") regions.add(node.properties.region);
  }
  return [...regions].sort();
}

function buildReference(
  resolved: ResolvedPolicy,
  locations: string[],
  used: Set<string>,
): { ok: true; included: Included } | { ok: false; reason: string } {
  const { alignment, metadata } = resolved;
  const parameters: Record<string, { value: unknown }> = {};
  let effect: string | null = null;
  if (metadata.effect) {
    effect = auditEffect(metadata.effect.allowedValues);
    if (!effect) return { ok: false, reason: "no audit effect is available" };
    parameters.effect = { value: effect };
  }
  for (const [name, param] of Object.entries(metadata.parameters)) {
    const configured = alignment.parameters?.[name];
    const value = configured === "$graphLocations" ? locations : configured;
    if (value === undefined) {
      if (param.defaultValue === undefined) return { ok: false, reason: `parameter \`${name}\` needs a workload-specific value` };
      continue;
    }
    if (param.allowedValues && !(Array.isArray(value) ? value : [value]).every((v) => param.allowedValues!.includes(v))) {
      return { ok: false, reason: `configured \`${name}\` is not an allowed value` };
    }
    parameters[name] = { value };
  }
  const id = alignment.policyDefinitionId.toLowerCase();
  return {
    ok: true,
    included: {
      resolved,
      effect,
      reference: {
        policyDefinitionReferenceId: referenceIdFor(metadata.displayName, used),
        policyDefinitionId: `${POLICY_DEFINITION_PREFIX}${id}`,
        parameters,
      },
    },
  };
}

function bicepString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function slug(value: string, max: number): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
}

function controlsCell(resolved: ResolvedPolicy): string {
  const cells = COMPLIANCE_FRAMEWORKS.flatMap((framework) => {
    const ids = resolved.metadata.controls[framework.id];
    return ids?.length ? [`${framework.shortName} ${framework.version}: ${ids.join(", ")}`] : [];
  });
  return cells.length > 0 ? cells.join("; ") : "—";
}

export function generateAzurePolicy(document: GraphDocument): GeneratorResult {
  const validated = validateGeneration(document, false);
  if (!validated.ok) return validated;
  document = validated.document;
  const ctx = buildGeneratorContext(document);

  const present = new Set<ServiceType>(["resourceGroup", ...ctx.document.nodes.map((node) => node.type)]);
  const locations = graphLocations(ctx.document);
  const used = new Set<string>();
  const included: Included[] = [];
  const skipped: Skipped[] = [];
  const subscriptionScoped: ResolvedPolicy[] = [];
  for (const resolved of policiesForServiceTypes(present)) {
    if (resolved.alignment.scope === "subscription") {
      subscriptionScoped.push(resolved);
      continue;
    }
    const result = buildReference(resolved, locations, used);
    if (result.ok) included.push(result.included);
    else skipped.push({ resolved, reason: result.reason });
  }

  const resourceGroups = [
    ...new Set(
      ctx.document.nodes
        .filter((node) => node.type === "resourceGroup")
        .map((node) => ctx.resourceNames.get(node.id) ?? node.resourceName),
    ),
  ];
  if (resourceGroups.length === 0) resourceGroups.push(ctx.document.metadata.resourceGroupName);

  const docName = ctx.document.metadata.name;
  const initiativeName = slug(`bunya-${docName}`, 64) || "bunya-guardrails";
  const displayName = `Bunya design guardrails: ${docName}`.slice(0, 128);
  const description = `Audit-only Azure Policy built-ins matching the Bunya design-time rules for ${docName}.`.slice(0, 512);

  const definitions: GeneratedFile = {
    path: "initiative.definitions.json",
    language: "json",
    content: JSON.stringify(included.map((item) => item.reference), null, 2) + "\n",
  };

  const bicep: GeneratedFile = {
    path: "main.bicep",
    language: "bicep",
    content: [
      "// Generated by Bunya. Do not edit by hand.",
      "// Creates an audit-only Azure Policy initiative from the diagram's design-time rules",
      "// and assigns it to each resource group. Deploy after the infrastructure exists:",
      "//   az deployment sub create --location <region> --template-file main.bicep",
      "targetScope = 'subscription'",
      "",
      "@description('Resource groups the initiative is assigned to.')",
      `param resourceGroupNames array = [`,
      ...resourceGroups.map((name) => `  ${bicepString(name)}`),
      `]`,
      "",
      "@description('Name of the policy initiative (policy set definition).')",
      "@maxLength(64)",
      `param initiativeName string = ${bicepString(initiativeName)}`,
      "",
      "resource initiative 'Microsoft.Authorization/policySetDefinitions@2023-04-01' = {",
      "  name: initiativeName",
      "  properties: {",
      "    policyType: 'Custom'",
      `    displayName: ${bicepString(displayName)}`,
      `    description: ${bicepString(description)}`,
      "    metadata: {",
      "      category: 'Bunya'",
      "      generatedBy: 'Bunya'",
      "    }",
      "    policyDefinitions: loadJsonContent('initiative.definitions.json')",
      "  }",
      "}",
      "",
      "module assignments 'assignment.bicep' = [for rg in resourceGroupNames: {",
      "  name: 'bunya-policy-${uniqueString(rg)}'",
      "  scope: resourceGroup(rg)",
      "  params: {",
      "    assignmentName: initiativeName",
      `    displayName: ${bicepString(displayName)}`,
      "    initiativeId: initiative.id",
      "  }",
      "}]",
      "",
    ].join("\n"),
  };

  const assignment: GeneratedFile = {
    path: "assignment.bicep",
    language: "bicep",
    content: [
      "// Generated by Bunya. Do not edit by hand.",
      "targetScope = 'resourceGroup'",
      "",
      "@maxLength(64)",
      "param assignmentName string",
      "param displayName string",
      "param initiativeId string",
      "",
      "resource assignment 'Microsoft.Authorization/policyAssignments@2024-04-01' = {",
      "  name: assignmentName",
      "  properties: {",
      "    displayName: displayName",
      "    policyDefinitionId: initiativeId",
      "    enforcementMode: 'Default'",
      "  }",
      "}",
      "",
    ].join("\n"),
  };

  const script: GeneratedFile = {
    path: "deploy-policy.sh",
    language: "bash",
    content: [
      "#!/usr/bin/env bash",
      "# Generated by Bunya. Do not edit by hand.",
      "# Creates an audit-only Azure Policy initiative from the diagram's design-time rules",
      "# and assigns it to each resource group. Run after the infrastructure exists.",
      "set -euo pipefail",
      "",
      'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
      'az account show --only-show-errors >/dev/null || { echo "Run az login first." >&2; exit 1; }',
      'SUBSCRIPTION_ID="$(az account show --query id -o tsv)"',
      `INITIATIVE_NAME="${initiativeName}"`,
      "",
      'az policy set-definition create --only-show-errors \\',
      '  --name "$INITIATIVE_NAME" \\',
      `  --display-name "${displayName}" \\`,
      `  --description "${description}" \\`,
      "  --metadata category=Bunya generatedBy=Bunya \\",
      '  --definitions "${SCRIPT_DIR}/initiative.definitions.json" >/dev/null',
      "",
      `for rg in ${resourceGroups.map((name) => `"${name}"`).join(" ")}; do`,
      '  az policy assignment create --only-show-errors \\',
      '    --name "$INITIATIVE_NAME" \\',
      `    --display-name "${displayName}" \\`,
      '    --policy-set-definition "/subscriptions/${SUBSCRIPTION_ID}/providers/Microsoft.Authorization/policySetDefinitions/${INITIATIVE_NAME}" \\',
      '    --scope "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${rg}" >/dev/null',
      '  echo "Assigned ${INITIATIVE_NAME} to ${rg}"',
      "done",
      "",
    ].join("\n"),
  };

  const coveredRules = new Set(included.flatMap((item) => item.resolved.alignment.ruleIds));
  const readme: GeneratedFile = {
    path: "POLICY.md",
    language: "markdown",
    content: [
      `# Azure Policy guardrails: ${docName}`,
      "",
      "Generated by Bunya. These files turn the design-time rules that apply to this",
      "diagram into an Azure Policy initiative, so the deployed resources keep being",
      "audited after deployment. Bunya does not connect to Azure; you assign the initiative.",
      "",
      "- Every policy uses an audit effect. Review the compliance results before you",
      "  change any effect to `Deny`.",
      "- Assign the initiative after the resource groups exist:",
      "  `az deployment sub create --location <region> --template-file main.bicep`",
      "  or `./deploy-policy.sh`.",
      `- Allowed locations: ${locations.join(", ")}.`,
      `- ${included.length} built-in policies cover ${coveredRules.size} Bunya rules. Graph-shape`,
      "  rules (edges, topology, naming) have no built-in policy equivalent and stay design-time only.",
      "",
      "## Policies",
      "",
      "| Policy | Effect | Bunya rules | Framework alignment |",
      "| --- | --- | --- | --- |",
      ...included.map(
        ({ resolved, effect }) =>
          `| ${resolved.metadata.displayName} (\`${resolved.alignment.policyDefinitionId}\`, v${resolved.metadata.version}) | ${effect ?? "n/a"} | ${resolved.alignment.ruleIds.map((id) => `\`${id}\``).join(", ")} | ${controlsCell(resolved)} |`,
      ),
      "",
      ...(subscriptionScoped.length > 0
        ? [
            "## Subscription-level policies (not included)",
            "",
            "These built-ins only evaluate when assigned at subscription or management-group",
            "scope, which would also audit resources outside this diagram. Assign them",
            "through your landing zone if they are not already in place.",
            "",
            ...subscriptionScoped.map(
              (resolved) =>
                `- ${resolved.metadata.displayName} (\`${resolved.alignment.policyDefinitionId}\`): ${resolved.alignment.ruleIds.map((id) => `\`${id}\``).join(", ")}.`,
            ),
            "",
          ]
        : []),
      ...(skipped.length > 0
        ? [
            "## Not exported",
            "",
            ...skipped.map(({ resolved, reason }) => `- ${resolved.metadata.displayName}: ${reason}.`),
            "",
          ]
        : []),
      "## Framework alignment",
      "",
      "Control IDs come from Microsoft's regulatory-compliance initiatives in",
      `[Azure/azure-policy](${POLICY_METADATA_SOURCE.repository}) (commit \`${POLICY_METADATA_SOURCE.commit.slice(0, 12)}\`).`,
      "A policy listed against a control is *aligned with* that control. Passing these",
      "audits does not make the workload compliant with, or certified against, any framework.",
      "",
    ].join("\n"),
  };

  return { ok: true, files: [readme, definitions, bicep, assignment, script] };
}
