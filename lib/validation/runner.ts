import { GraphDocument } from "@/lib/graph/schema";
import { Finding, Rule, RULES } from "./rules";

export function runValidation(graph: GraphDocument, rules: Rule[] = RULES): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    try {
      findings.push(...rule.evaluate(graph));
    } catch (err) {
      findings.push({
        ruleId: rule.id,
        severity: "warning",
        message: `Rule ${rule.id} crashed: ${err instanceof Error ? err.message : String(err)}.`,
        explanation: "Bunya skipped this rule for the current graph; please report the failing fixture.",
      });
    }
  }
  return findings;
}

export function applyAutofix(
  graph: GraphDocument,
  finding: Finding,
  rules: Rule[] = RULES,
): GraphDocument {
  if (!finding.autofixId) return graph;
  const rule = rules.find((r) => r.id === finding.ruleId);
  const fix = rule?.autofixes?.[finding.autofixId];
  if (!fix) return graph;
  return fix(graph);
}
