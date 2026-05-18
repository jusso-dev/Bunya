import type { GraphDocument } from "@/lib/graph/schema";
import { Finding, RuleEntry, isGraphScope } from "./schema";
import { armTypeOf } from "./mapping";
import { REGISTRY } from "./registry";

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
      const armType = armTypeOf(node.type);
      if (!entry.rule.appliesTo.includes(armType)) continue;
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

export function getRuleById(id: string, entries: RuleEntry[] = REGISTRY): Finding["rule"] | undefined {
  return entries.find((e) => e.rule.id === id)?.rule;
}
