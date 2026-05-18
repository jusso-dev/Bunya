import type { RuleEntry } from "../schema";
import { networkRules } from "./network";
import { identityRules } from "./identity";
import { implicitRules } from "./implicit";
import { observabilityRules } from "./observability";
import { sovereigntyRules } from "./sovereignty";
import { namingRules } from "./naming";
import { costRules } from "./cost";
import { complianceRules } from "./compliance";

export const GRAPH_RULES: RuleEntry[] = [
  ...networkRules,
  ...identityRules,
  ...implicitRules,
  ...observabilityRules,
  ...sovereigntyRules,
  ...namingRules,
  ...costRules,
  ...complianceRules,
];
