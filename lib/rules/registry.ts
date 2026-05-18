import type { RuleEntry } from "./schema";
import { GRAPH_RULES } from "./graph-rules";
import { PSRULE_RULES } from "./sources/psrule-azure/generated";
import { CHECKOV_RULES } from "./sources/checkov-azure/generated";
import { AZURE_POLICY_RULES } from "./sources/azure-policy-builtins/generated";
import { NAMING_RULES } from "./sources/azure-naming-tool/generated";
import { BICEP_TYPE_RULES } from "./sources/bicep-types/generated";
import { ISM_RULES } from "./sources/ism/generated";
import { ESSENTIAL_EIGHT_RULES } from "./sources/essential-eight/generated";
import { PRIVATE_LINK_RULES } from "./sources/private-link-faq/generated";
import { WELL_KNOWN_PATTERN_RULES } from "./sources/well-known-patterns/generated";

export const REGISTRY: RuleEntry[] = [
  ...GRAPH_RULES,
  ...PSRULE_RULES,
  ...CHECKOV_RULES,
  ...AZURE_POLICY_RULES,
  ...NAMING_RULES,
  ...BICEP_TYPE_RULES,
  ...ISM_RULES,
  ...ESSENTIAL_EIGHT_RULES,
  ...PRIVATE_LINK_RULES,
  ...WELL_KNOWN_PATTERN_RULES,
];

export function getRule(id: string): RuleEntry | undefined {
  return REGISTRY.find((entry) => entry.rule.id === id);
}

export const SOURCE_BUNDLES = {
  graphRules: GRAPH_RULES,
  psrule: PSRULE_RULES,
  checkov: CHECKOV_RULES,
  azurePolicy: AZURE_POLICY_RULES,
  naming: NAMING_RULES,
  bicepTypes: BICEP_TYPE_RULES,
  ism: ISM_RULES,
  essentialEight: ESSENTIAL_EIGHT_RULES,
  privateLink: PRIVATE_LINK_RULES,
  wellKnownPatterns: WELL_KNOWN_PATTERN_RULES,
} as const;
