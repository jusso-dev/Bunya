import type { GraphDocument } from "@/lib/graph/schema";
import { runRules, applyAutofix as runtimeApplyAutofix } from "@/lib/rules/runtime";
import type { Finding as RuntimeFinding } from "@/lib/rules/schema";

export type Finding = RuntimeFinding;

export function runValidation(graph: GraphDocument): Finding[] {
  return runRules(graph);
}

export function applyAutofix(graph: GraphDocument, finding: Finding): GraphDocument {
  return runtimeApplyAutofix(graph, finding);
}
