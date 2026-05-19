import type { RuleEntry } from "../schema";
import { networkRules } from "./network";
import { identityRules } from "./identity";
import { implicitRules } from "./implicit";
import { observabilityRules } from "./observability";
import { sovereigntyRules } from "./sovereignty";
import { namingRules } from "./naming";
import { costRules } from "./cost";
import { complianceRules } from "./compliance";
import { expansionAppInsightsRules } from "./expansion-app-insights";
import { expansionAppServicePlanRules } from "./expansion-app-service-plan";
import { expansionNsgRules } from "./expansion-nsg";
import { expansionUaiRules } from "./expansion-uai";

export const GRAPH_RULES: RuleEntry[] = [
  ...networkRules,
  ...identityRules,
  ...implicitRules,
  ...observabilityRules,
  ...sovereigntyRules,
  ...namingRules,
  ...costRules,
  ...complianceRules,
  ...expansionAppInsightsRules,
  ...expansionAppServicePlanRules,
  ...expansionNsgRules,
  ...expansionUaiRules,
];
