import { checkImportText, checkObjectDepth } from "../graph/limits";
import { EdgeKindSchema, SERVICE_TYPES, type GraphDocument, type GraphEdge, type GraphNode, type ServiceType } from "@/lib/graph/schema";
import { serviceTypeOfArm, tlsVersionFromArm } from "@/lib/catalogue/azure";
import { SeveritySchema, type Finding, type RuleEntry, type Severity } from "@/lib/rules/schema";

// Imported and typed rule text is capped so one rule cannot swamp the panel,
// findings or toasts.
export const RULE_NAME_MAX = 80;
export const RULE_TEXT_MAX = 500;
export const RULE_KEY_MAX = 128;

export const ORGANISATION_RULES_FORMAT = "bunya-organisation-rules" as const;
export const ORGANISATION_RULES_VERSION = 1 as const;
export const ORGANISATION_RULES_EXTENSION = ".bunya-rules.json";

export const PROPERTY_OPERATORS = ["equals", "not_equals", "present", "missing", "truthy", "falsy", "includes"] as const;
export type PropertyOperator = (typeof PROPERTY_OPERATORS)[number];

export type EdgeRequirement = {
  direction: "outgoing" | "incoming" | "either";
  kind?: GraphEdge["kind"];
  targetType?: ServiceType;
  mode: "must_exist" | "must_not_exist";
};

export type OrganisationRule = {
  id: string;
  name: string;
  description: string;
  severity: Severity;
  enabled: boolean;
  serviceTypes: ServiceType[];
  property?: {
    key: string;
    operator: PropertyOperator;
    value?: unknown;
  };
  edge?: EdgeRequirement;
  message: string;
  source?: {
    name?: string;
    policyName?: string;
  };
};

export type OrganisationRulesEnvelope = {
  format: typeof ORGANISATION_RULES_FORMAT;
  version: typeof ORGANISATION_RULES_VERSION;
  exportedAt: string;
  rules: OrganisationRule[];
};

type AzurePolicy = {
  name?: unknown;
  properties?: {
    displayName?: unknown;
    description?: unknown;
    policyRule?: unknown;
  };
};

// Azure Policy targets SQL settings at the server; Bunya models the server on its database node.
function policyServiceType(armType: string): ServiceType | null {
  return armType.toLowerCase() === "microsoft.sql/servers" ? "sqlDatabase" : serviceTypeOfArm(armType);
}

// Azure Policy alias leaf (lower case) -> Bunya property. Each leaf names the
// same setting on every resource type Bunya models.
const POLICY_LEAF_TO_PROPERTY: Record<string, string> = {
  publicnetworkaccess: "publicNetworkAccess",
  allowblobpublicaccess: "allowPublicAccess",
  minimumtlsversion: "minTlsVersion",
  enablepurgeprotection: "purgeProtection",
};

export function buildOrganisationRulesEnvelope(rules: OrganisationRule[]): OrganisationRulesEnvelope {
  return {
    format: ORGANISATION_RULES_FORMAT,
    version: ORGANISATION_RULES_VERSION,
    exportedAt: new Date().toISOString(),
    rules,
  };
}

export function organisationRulesToBlob(rules: OrganisationRule[]): Blob {
  return new Blob([JSON.stringify(buildOrganisationRulesEnvelope(rules), null, 2)], {
    type: "application/json",
  });
}

export function normaliseOrganisationRule(input: unknown, index = 0): OrganisationRule | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const serviceTypes = Array.isArray(raw.serviceTypes)
    ? raw.serviceTypes.filter((v): v is ServiceType =>
        typeof v === "string" && (SERVICE_TYPES as readonly string[]).includes(v),
      )
    : [];
  const severity = SeveritySchema.catch("warning").parse(raw.severity);
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 64) : `ORG.CUSTOM.${index + 1}`;
  const propertyRaw = typeof raw.property === "object" && raw.property !== null
    ? (raw.property as Record<string, unknown>)
    : null;
  const edgeRaw = typeof raw.edge === "object" && raw.edge !== null
    ? (raw.edge as Record<string, unknown>)
    : null;
  const property = propertyRaw && typeof propertyRaw.key === "string" && isPropertyOperator(propertyRaw.operator)
    ? {
        key: propertyRaw.key.slice(0, RULE_KEY_MAX),
        operator: propertyRaw.operator,
        value: typeof propertyRaw.value === "string" ? propertyRaw.value.slice(0, RULE_TEXT_MAX) : propertyRaw.value,
      }
    : undefined;
  const edge = edgeRaw && isEdgeMode(edgeRaw.mode) && isEdgeDirection(edgeRaw.direction)
    ? {
        direction: edgeRaw.direction,
        mode: edgeRaw.mode,
        kind: isEdgeKind(edgeRaw.kind) ? edgeRaw.kind : undefined,
        targetType:
          typeof edgeRaw.targetType === "string" &&
          (SERVICE_TYPES as readonly string[]).includes(edgeRaw.targetType)
            ? (edgeRaw.targetType as ServiceType)
            : undefined,
      }
    : undefined;
  if (!property && !edge) return null;

  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, RULE_NAME_MAX) : id,
    description:
      typeof raw.description === "string" && raw.description.trim()
        ? raw.description.trim().slice(0, RULE_TEXT_MAX)
        : "Organisation-defined deployment rule.",
    severity,
    enabled: raw.enabled !== false,
    serviceTypes,
    property,
    edge,
    message:
      typeof raw.message === "string" && raw.message.trim()
        ? raw.message.trim().slice(0, RULE_TEXT_MAX)
        : "Resource violates an organisation deployment rule.",
    source:
      typeof raw.source === "object" && raw.source !== null
        ? {
            name: typeof (raw.source as Record<string, unknown>).name === "string"
              ? ((raw.source as Record<string, unknown>).name as string)
              : undefined,
            policyName: typeof (raw.source as Record<string, unknown>).policyName === "string"
              ? ((raw.source as Record<string, unknown>).policyName as string)
              : undefined,
          }
        : undefined,
  };
}

export function parseOrganisationRulesText(text: string): { ok: true; rules: OrganisationRule[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    checkImportText(text);
    parsed = JSON.parse(extractJson(text));
    checkObjectDepth(parsed);
  } catch (err) {
    return { ok: false, reason: `Rules file is not valid JSON: ${err instanceof Error ? err.message : String(err)}.` };
  }

  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const object = parsed as Record<string, unknown>;
    if (object.format === ORGANISATION_RULES_FORMAT) {
      if (object.version !== ORGANISATION_RULES_VERSION) {
        return { ok: false, reason: `Unsupported organisation rules version: ${String(object.version)}.` };
      }
      if (!Array.isArray(object.rules)) return { ok: false, reason: "Rules envelope is missing a rules array." };
      const rules = object.rules.map(normaliseOrganisationRule);
      if (rules.some((rule) => !rule)) return { ok: false, reason: "Rules file contains an invalid rule. No rules were imported." };
      return { ok: true, rules: rules as OrganisationRule[] };
    }
    const translated = translateAzurePolicy(parsed);
    if (translated.length > 0) return { ok: true, rules: translated };
  }

  if (Array.isArray(parsed)) {
    const rules = parsed.map(normaliseOrganisationRule).filter((r): r is OrganisationRule => !!r);
    if (rules.length === parsed.length && rules.length > 0) return { ok: true, rules };
    const policies = parsed.map(translateAzurePolicy);
    if (policies.length > 0 && policies.every((rules) => rules.length > 0)) return { ok: true, rules: policies.flat() };
  }

  return { ok: false, reason: "JSON did not contain valid Bunya rules or a supported Azure Policy. Only one known resource type AND one scalar violation with audit/deny effect is supported; compound, set and conditional policies are rejected." };
}

const ORGANISATION_SOURCE_URL = "https://github.com/jusso-dev/Bunya";

// Each enabled rule as a registry entry, so it runs through runRules with the built-ins.
export function organisationRuleEntries(rules: OrganisationRule[]): RuleEntry[] {
  return rules.filter((rule) => rule.enabled).map((rule) => ({
    rule: {
      id: rule.id,
      source: { name: rule.source?.name ?? "Organisation rule engine", url: ORGANISATION_SOURCE_URL },
      category: categoryForRule(rule),
      severity: rule.severity,
      appliesTo: rule.serviceTypes.length > 0 ? rule.serviceTypes : [...SERVICE_TYPES],
      message: rule.message,
      longExplanation: rule.description,
      tags: ["organisation", "custom"],
    },
    check: ({ graph, node }) => (node && ruleMatchesNode(graph, node, rule) ? [{ nodeIds: [node.id] }] : []),
  }));
}

export function translateAzurePolicy(policy: unknown): OrganisationRule[] {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return [];
  const raw = policy as AzurePolicy;
  const policyRule = raw.properties?.policyRule;
  if (typeof policyRule !== "object" || policyRule === null) return [];
  const ifBlock = (policyRule as Record<string, unknown>).if;
  if (typeof ifBlock !== "object" || ifBlock === null) return [];
  // Only one resource type AND one scalar violation can be represented exactly.
  // Reject unsupported Boolean trees instead of flattening their semantics.
  const condition = ifBlock as Record<string, unknown>;
  const leaves = Array.isArray(condition.allOf) ? condition.allOf : [condition];
  if (Object.keys(condition).some((key) => ["anyOf", "not"].includes(key))) return [];
  if (leaves.some((leaf) => !leaf || typeof leaf !== "object" || Array.isArray(leaf) || Object.keys(leaf).some((key) => ["allOf", "anyOf", "not", "in", "notIn"].includes(key)))) return [];
  const effect = (policyRule as { then?: { effect?: unknown } }).then?.effect;
  if (effect !== undefined && effect !== "audit" && effect !== "deny") return [];
  const atoms = flattenPolicyConditions(ifBlock);
  if (atoms.length !== leaves.length || atoms.filter((atom) => atom.field !== "type").length !== 1) return [];
  const typeAtoms = atoms.filter((atom) => atom.field === "type" && atom.operator === "equals");
  const serviceTypes = typeAtoms
    .map((atom) => (typeof atom.value === "string" ? policyServiceType(atom.value) : undefined))
    .filter((v): v is ServiceType => !!v);
  if (typeAtoms.length !== 1 || serviceTypes.length !== 1) return [];
  const candidates = atoms
    .filter((atom) => atom.field !== "type")
    .map((atom, index) => atomToRule(atom, serviceTypes, raw, index))
    .filter((v): v is OrganisationRule => !!v);
  return candidates;
}

export function makeRuleId(seed: string): string {
  const cleaned = seed
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 48);
  return `ORG.${cleaned || "CUSTOM"}`;
}

function ruleMatchesNode(graph: GraphDocument, node: GraphNode, rule: OrganisationRule): boolean {
  const propertyMatches = rule.property ? propertyConditionMatches(node.properties[rule.property.key], rule.property) : true;
  const edgeMatches = rule.edge ? edgeConditionMatches(graph, node, rule.edge) : true;
  return propertyMatches && edgeMatches;
}

function propertyConditionMatches(value: unknown, condition: NonNullable<OrganisationRule["property"]>): boolean {
  switch (condition.operator) {
    case "equals":
      return normaliseComparable(value, condition.value) === normaliseComparable(condition.value, value);
    case "not_equals":
      return normaliseComparable(value, condition.value) !== normaliseComparable(condition.value, value);
    case "present":
      return value !== undefined && value !== null && value !== "";
    case "missing":
      return value === undefined || value === null || value === "";
    case "truthy":
      return value === true || value === "true" || value === "Enabled";
    case "falsy":
      return value === false || value === "false" || value === "Disabled";
    case "includes":
      return Array.isArray(value)
        ? value.map((item) => normaliseComparable(item, condition.value)).includes(normaliseComparable(condition.value, value))
        : String(value ?? "").includes(String(condition.value ?? ""));
  }
}

function edgeConditionMatches(graph: GraphDocument, node: GraphNode, requirement: EdgeRequirement): boolean {
  const exists = graph.edges.some((edge) => {
    if (requirement.kind && edge.kind !== requirement.kind) return false;
    const source = graph.nodes.find((n) => n.id === edge.source);
    const target = graph.nodes.find((n) => n.id === edge.target);
    if (!source || !target) return false;
    const directionMatches =
      (requirement.direction === "outgoing" && edge.source === node.id) ||
      (requirement.direction === "incoming" && edge.target === node.id) ||
      (requirement.direction === "either" && (edge.source === node.id || edge.target === node.id));
    if (!directionMatches) return false;
    if (!requirement.targetType) return true;
    const other = edge.source === node.id ? target : source;
    return other.type === requirement.targetType;
  });
  return requirement.mode === "must_exist" ? !exists : exists;
}

function atomToRule(
  atom: PolicyAtom,
  serviceTypes: ServiceType[],
  policy: AzurePolicy,
  index: number,
): OrganisationRule | null {
  const key = POLICY_LEAF_TO_PROPERTY[atom.field.split("/").at(-1)?.toLowerCase() ?? ""];
  if (!key) return null;
  const operator = policyOperatorToRuleOperator(atom.operator, atom.value);
  if (!operator) return null;
  const displayName = typeof policy.properties?.displayName === "string" ? policy.properties.displayName : undefined;
  const name = displayName ?? (typeof policy.name === "string" ? policy.name : `Imported Azure Policy ${index + 1}`);
  return {
    id: makeRuleId(`${name}.${key}.${index + 1}`),
    name,
    description:
      typeof policy.properties?.description === "string"
        ? policy.properties.description
        : `Imported from Azure Policy condition on ${atom.field}.`,
    severity: "error",
    enabled: true,
    serviceTypes,
    property: { key, operator, value: normalisePolicyValue(atom.value) },
    message: `${name}: ${key} ${operator.replace("_", " ")} ${String(normalisePolicyValue(atom.value) ?? "")}`.trim(),
    source: { name: "Azure Policy import", policyName: name },
  };
}

type PolicyAtom = { field: string; operator: string; value?: unknown };

function flattenPolicyConditions(value: unknown): PolicyAtom[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const raw = value as Record<string, unknown>;
  if (typeof raw.field === "string") {
    for (const operator of ["equals", "notEquals", "exists", "contains", "in", "notIn"]) {
      if (operator in raw) return [{ field: raw.field, operator, value: raw[operator] }];
    }
  }
  return [...arrayConditions(raw.allOf), ...arrayConditions(raw.anyOf)].flatMap(flattenPolicyConditions);
}

function arrayConditions(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function policyOperatorToRuleOperator(operator: string, value: unknown): PropertyOperator | null {
  switch (operator) {
    case "equals":
      return "equals";
    case "notEquals":
      return "not_equals";
    case "exists":
      return value === "false" || value === false ? "missing" : "present";
    case "contains":
    case "in":
      return "includes";
    default:
      return null;
  }
}

function normalisePolicyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value[0];
  if (value === "true") return true;
  if (value === "false") return false;
  if (typeof value === "string" && /^TLS1_\d$/.test(value)) return tlsVersionFromArm(value);
  return value;
}

function normaliseScalar(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normaliseComparable(value: unknown, peer: unknown): string {
  const peerScalar = normaliseScalar(peer);
  if (peerScalar === "enabled" || peerScalar === "disabled") {
    if (value === true) return "enabled";
    if (value === false) return "disabled";
  }
  return normaliseScalar(value);
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json|policy)?\s*([\s\S]*?)\s*```$/i);
  if (fence?.[1]) return fence[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1).trim();
  return trimmed;
}

function categoryForRule(rule: OrganisationRule): Finding["rule"]["category"] {
  if (rule.edge?.kind === "identity") return "identity";
  if (rule.edge?.kind === "diagnostic") return "observability";
  if (rule.property?.key.toLowerCase().includes("public")) return "network";
  return "compliance";
}

function isPropertyOperator(value: unknown): value is PropertyOperator {
  return (PROPERTY_OPERATORS as readonly unknown[]).includes(value);
}

function isEdgeDirection(value: unknown): value is EdgeRequirement["direction"] {
  return value === "outgoing" || value === "incoming" || value === "either";
}

function isEdgeMode(value: unknown): value is EdgeRequirement["mode"] {
  return value === "must_exist" || value === "must_not_exist";
}

function isEdgeKind(value: unknown): value is GraphEdge["kind"] {
  return EdgeKindSchema.safeParse(value).success;
}
