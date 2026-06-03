import type { GraphDocument } from "@/lib/graph/schema";
import { runOrganisationRules, type OrganisationRule } from "@/lib/rules/organisation";
import { runRules, applyAutofix as runtimeApplyAutofix } from "@/lib/rules/runtime";
import type { Finding as RuntimeFinding } from "@/lib/rules/schema";

export type Finding = RuntimeFinding;

export function runValidation(graph: GraphDocument, organisationRules: OrganisationRule[] = []): Finding[] {
  return [...runRules(graph), ...runOrganisationRules(graph, organisationRules)];
}

export function applyAutofix(graph: GraphDocument, finding: Finding): GraphDocument {
  return runtimeApplyAutofix(graph, finding);
}
