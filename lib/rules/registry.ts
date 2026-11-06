import { RuleSchema, type RuleBundle, type RuleEntry } from "./schema";
import { GRAPH_RULES } from "./graph-rules";
import { PSRULE_RULES, PSRULE_VERSION } from "./sources/psrule-azure/rules";
import { CHECKOV_RULES, CHECKOV_VERSION } from "./sources/checkov-azure/rules";
import { AZURE_POLICY_RULES } from "./sources/azure-policy-builtins/rules";
import { NAMING_RULES, NAMING_TOOL_VERSION } from "./sources/azure-naming-tool/rules";
import { BICEP_TYPE_RULES } from "./sources/bicep-types/rules";
import { ISM_RELEASE, ISM_RULES } from "./sources/ism/rules";
import { E8_RELEASE, ESSENTIAL_EIGHT_RULES } from "./sources/essential-eight/rules";
import { PRIVATE_LINK_FAQ_REVISION, PRIVATE_LINK_RULES } from "./sources/private-link-faq/rules";
import { PATTERNS_REVISION, WELL_KNOWN_PATTERN_RULES } from "./sources/well-known-patterns/rules";
import { EXPANSION_APP_INSIGHTS_RULES } from "./sources/expansion-app-insights/rules";
import { EXPANSION_APP_SERVICE_PLAN_RULES } from "./sources/expansion-app-service-plan/rules";
import { EXPANSION_NSG_RULES } from "./sources/expansion-nsg/rules";
import { EXPANSION_UAI_RULES } from "./sources/expansion-uai/rules";
import { withAlignmentTags } from "./compliance";

// Every rule bundle Bunya ships. REGISTRY, `pnpm rules:verify`,
// `pnpm rules:coverage` and `pnpm upstream:check` all read this list. Rules are
// hand-curated TypeScript; when `upstream:check` reports a newer upstream
// release, re-curate the bundle and bump its pin here.
export const RULE_BUNDLES: RuleBundle[] = [
  { slug: "graph-rules", label: "Bunya graph rules", rules: GRAPH_RULES },
  {
    slug: "psrule-azure",
    label: "PSRule for Azure",
    pin: { version: PSRULE_VERSION, reviewedAt: "2026-05-18", watch: { kind: "github-release", repo: "Azure/PSRule.Rules.Azure" } },
    rules: PSRULE_RULES,
  },
  {
    slug: "checkov-azure",
    label: "Checkov",
    pin: { version: CHECKOV_VERSION, reviewedAt: "2026-05-18", watch: { kind: "github-release", repo: "bridgecrewio/checkov" } },
    rules: CHECKOV_RULES,
  },
  {
    slug: "azure-policy-builtins",
    label: "Azure Policy built-ins",
    pin: { version: "2026-04-01", reviewedAt: "2026-05-18" },
    rules: AZURE_POLICY_RULES,
  },
  {
    slug: "azure-naming-tool",
    label: "Azure Naming Tool",
    pin: { version: NAMING_TOOL_VERSION, reviewedAt: "2026-05-18", watch: { kind: "github-release", repo: "mspnp/AzureNamingTool" } },
    rules: NAMING_RULES,
  },
  {
    slug: "bicep-types",
    label: "Bicep types",
    pin: { version: "main", reviewedAt: "2026-05-18" },
    rules: BICEP_TYPE_RULES,
  },
  {
    slug: "ism",
    label: "Australian ISM",
    pin: { version: ISM_RELEASE, reviewedAt: "2026-05-18", watch: { kind: "manual-review" } },
    rules: ISM_RULES,
  },
  {
    slug: "essential-eight",
    label: "Essential Eight Maturity Model",
    pin: { version: E8_RELEASE, reviewedAt: "2026-05-18", watch: { kind: "manual-review" } },
    rules: ESSENTIAL_EIGHT_RULES,
  },
  {
    slug: "private-link-faq",
    label: "Azure Private Link FAQ",
    pin: { version: PRIVATE_LINK_FAQ_REVISION, reviewedAt: "2026-05-18", watch: { kind: "manual-review" } },
    rules: PRIVATE_LINK_RULES,
  },
  {
    slug: "well-known-patterns",
    label: "Azure Architecture Center patterns",
    pin: { version: PATTERNS_REVISION, reviewedAt: "2026-05-18", watch: { kind: "manual-review" } },
    rules: WELL_KNOWN_PATTERN_RULES,
  },
  { slug: "expansion-app-insights", label: "Application Insights expansion", rules: EXPANSION_APP_INSIGHTS_RULES },
  { slug: "expansion-app-service-plan", label: "App Service Plan expansion", rules: EXPANSION_APP_SERVICE_PLAN_RULES },
  { slug: "expansion-nsg", label: "Network Security Group expansion", rules: EXPANSION_NSG_RULES },
  { slug: "expansion-uai", label: "User-Assigned Managed Identity expansion", rules: EXPANSION_UAI_RULES },
];

export const REGISTRY: RuleEntry[] = withAlignmentTags(RULE_BUNDLES.flatMap((bundle) => bundle.rules));

const MIN_REGISTRY_SIZE = 100;

/** Everything wrong with a rule set: schema violations, duplicate ids, too few rules. */
export function registryProblems(entries: RuleEntry[] = REGISTRY): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { rule } of entries) {
    const parsed = RuleSchema.safeParse(rule);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) problems.push(`${rule.id || "<no id>"}: ${issue.path.join(".")} ${issue.message}`);
    }
    if (seen.has(rule.id)) problems.push(`${rule.id}: duplicate id`);
    seen.add(rule.id);
  }
  if (entries.length < MIN_REGISTRY_SIZE) problems.push(`registry has ${entries.length} rules, expected >= ${MIN_REGISTRY_SIZE}`);
  return problems;
}
