import type { GraphDocument } from "@/lib/graph/schema";
import { Finding, RuleEntry, isGraphScope } from "./schema";
import { REGISTRY } from "./registry";
import { organisationRuleEntries, type OrganisationRule } from "./organisation";

function completeFinding(
  partial: ReturnType<RuleEntry["check"]>[number],
  entry: RuleEntry,
): Finding {
  return {
    ruleId: entry.rule.id,
    rule: entry.rule,
    severity: entry.rule.severity,
    source: entry.rule.source,
    message: partial.message ?? entry.rule.message,
    explanation: partial.explanation ?? entry.rule.longExplanation,
    nodeIds: partial.nodeIds,
    edgeIds: partial.edgeIds,
    autofixId: partial.autofixId,
  };
}

// Built-in rules plus the organisation's own.
export function validate(graph: GraphDocument, organisationRules: OrganisationRule[] = []): Finding[] {
  return runRules(graph, [...REGISTRY, ...organisationRuleEntries(organisationRules)]);
}

export function runRules(
  graph: GraphDocument,
  entries: RuleEntry[] = REGISTRY,
): Finding[] {
  const findings: Finding[] = [];
  for (const entry of entries) {
    if (isGraphScope(entry.rule)) {
      const partials = entry.check({ graph, node: null });
      for (const p of partials) findings.push(completeFinding(p, entry));
      continue;
    }
    for (const node of graph.nodes) {
      if (!entry.rule.appliesTo.includes(node.type)) continue;
      const partials = entry.check({ graph, node });
      for (const p of partials) findings.push(completeFinding(p, entry));
    }
  }
  return findings;
}

export function applyAutofix(
  graph: GraphDocument,
  finding: Finding,
  entries: RuleEntry[] = REGISTRY,
): GraphDocument {
  if (!finding.autofixId) return graph;
  const entry = entries.find((e) => e.rule.id === finding.ruleId);
  const fix = entry?.autofixes?.[finding.autofixId];
  if (!fix) return graph;
  return fix(graph, finding);
}

