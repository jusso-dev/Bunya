import { getServiceDefinition } from "@/lib/catalogue/services";
import type { EdgeKind, ServiceType } from "@/lib/graph/schema";
import {
  makeRuleId,
  type EdgeRequirement,
  type OrganisationRule,
  type PropertyOperator,
} from "@/lib/rules/organisation";
import type { Severity } from "@/lib/rules/schema";

const PRESET_SOURCE = { name: "Bunya organisation preset" };

function propertyRule(input: { idSeed: string; name: string; serviceType: ServiceType; key: string; operator: PropertyOperator; value: unknown; message: string }): OrganisationRule {
  return {
    id: makeRuleId(input.idSeed),
    name: input.name,
    description: input.message,
    severity: "error",
    enabled: true,
    serviceTypes: [input.serviceType],
    property: { key: input.key, operator: input.operator, value: input.value },
    message: input.message,
    source: PRESET_SOURCE,
  };
}

function edgeRule(input: { idSeed: string; name: string; serviceType: ServiceType; direction: EdgeRequirement["direction"]; kind: EdgeKind; targetType: ServiceType; message: string }): OrganisationRule {
  return {
    id: makeRuleId(input.idSeed),
    name: input.name,
    description: input.message,
    severity: "warning",
    enabled: true,
    serviceTypes: [input.serviceType],
    edge: { direction: input.direction, kind: input.kind, targetType: input.targetType, mode: "must_exist" },
    message: input.message,
    source: PRESET_SOURCE,
  };
}

const label = (type: ServiceType) => getServiceDefinition(type).label;

export type OrganisationPreset = { id: string; label: string; source: string; rules: () => OrganisationRule[] };

export const ORGANISATION_PRESETS: OrganisationPreset[] = [
  {
    id: "no-public-ingress",
    label: "No Public",
    source: "No public ingress preset",
    rules: () => [
      ...(["appService", "functionApp", "keyVault", "containerRegistry"] as const).map((serviceType) => propertyRule({
        idSeed: `no-public-ingress-${serviceType}`,
        name: `No public ingress: ${label(serviceType)}`,
        serviceType,
        key: "publicNetworkAccess",
        operator: "equals",
        value: true,
        message: "Public network access must be disabled for organisation-managed workloads.",
      })),
      propertyRule({
        idSeed: "no-storage-blob-public-access",
        name: "No anonymous blob public access",
        serviceType: "storageAccount",
        key: "allowPublicAccess",
        operator: "equals",
        value: true,
        message: "Storage accounts must not allow anonymous blob public access.",
      }),
    ],
  },
  {
    id: "private-endpoint",
    label: "Private Path",
    source: "Private endpoint preset",
    rules: () => (["storageAccount", "sqlDatabase", "cosmosDb", "keyVault", "containerRegistry"] as const).map((serviceType) => edgeRule({
      idSeed: `private-endpoint-required-${serviceType}`,
      name: `Private endpoint required: ${label(serviceType)}`,
      serviceType,
      direction: "incoming",
      kind: "network",
      targetType: "privateEndpoint",
      message: "Private access must be modelled with a Private Endpoint network path.",
    })),
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    source: "Diagnostics preset",
    rules: () => (["appService", "functionApp", "aksCluster", "virtualMachineScaleSet"] as const).map((serviceType) => edgeRule({
      idSeed: `diagnostics-required-${serviceType}`,
      name: `Diagnostics required: ${label(serviceType)}`,
      serviceType,
      direction: "outgoing",
      kind: "diagnostic",
      targetType: "logAnalytics",
      message: "Production workloads must send diagnostics to Log Analytics.",
    })),
  },
];

// Incoming rules replace existing rules with the same id.
export function mergeRules(existing: OrganisationRule[], incoming: OrganisationRule[]): OrganisationRule[] {
  const merged = new Map<string, OrganisationRule>();
  for (const rule of [...existing, ...incoming]) merged.set(rule.id, rule);
  return [...merged.values()];
}

export function operatorNeedsValue(operator: PropertyOperator): boolean {
  return operator === "equals" || operator === "not_equals" || operator === "includes";
}

// Form text as the JSON value a property is compared with.
export function parseRuleValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const numeric = Number(trimmed);
  if (trimmed !== "" && Number.isFinite(numeric) && String(numeric) === trimmed) return numeric;
  return trimmed;
}

function uniqueRuleId(id: string, existing: OrganisationRule[]): string {
  const taken = new Set(existing.map((rule) => rule.id));
  let next = id;
  for (let suffix = 2; taken.has(next); suffix++) next = `${id}.${suffix}`;
  return next;
}

export type CustomRuleInput = {
  name: string;
  description: string;
  severity: Severity;
  serviceTypes: ServiceType[];
  check:
    | { mode: "property"; key: string; operator: PropertyOperator; value: string }
    | { mode: "edge"; direction: EdgeRequirement["direction"]; edgeMode: EdgeRequirement["mode"]; kind: EdgeKind | ""; targetType: ServiceType | "" };
};

export function customRule(input: CustomRuleInput, existing: OrganisationRule[]): { ok: true; rule: OrganisationRule } | { ok: false; reason: string } {
  const name = input.name.trim();
  if (!name) return { ok: false, reason: "Name the organisation rule first." };
  const description = input.description.trim();
  const { check } = input;
  if (check.mode === "property" && !check.key.trim()) return { ok: false, reason: "Property rules need a property key." };
  return {
    ok: true,
    rule: {
      id: uniqueRuleId(makeRuleId(name), existing),
      name,
      description: description || "Organisation-defined deployment rule.",
      severity: input.severity,
      enabled: true,
      serviceTypes: input.serviceTypes,
      message: description || (check.mode === "property"
        ? `${name}: ${check.key} ${check.operator.replace("_", " ")}`
        : `${name}: required relationship is missing or forbidden`),
      property: check.mode === "property"
        ? { key: check.key.trim(), operator: check.operator, value: operatorNeedsValue(check.operator) ? parseRuleValue(check.value) : undefined }
        : undefined,
      edge: check.mode === "edge"
        ? { direction: check.direction, mode: check.edgeMode, kind: check.kind || undefined, targetType: check.targetType || undefined }
        : undefined,
    },
  };
}
