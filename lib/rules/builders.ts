import type { GraphDocument, GraphNode, ServiceType } from "@/lib/graph/schema";
import {
  Autofix,
  Check,
  Rule,
  RuleCategory,
  RuleEntry,
  RuleSource,
  Severity,
} from "./schema";

export type NodeRuleInput = {
  id: string;
  source: RuleSource;
  category: RuleCategory;
  severity: Severity;
  serviceTypes: ServiceType[];
  message: string;
  longExplanation: string;
  tags: string[];
  predicate: (node: GraphNode, graph: GraphDocument) => boolean;
  autofixId?: string;
  autofixes?: Record<string, Autofix>;
};

export function nodeRule(input: NodeRuleInput): RuleEntry {
  const rule: Rule = {
    id: input.id,
    source: input.source,
    category: input.category,
    severity: input.severity,
    appliesTo: input.serviceTypes,
    message: input.message,
    longExplanation: input.longExplanation,
    tags: input.tags,
  };
  const check: Check = ({ node, graph }) => {
    if (!node) return [];
    if (!input.predicate(node, graph)) return [];
    return [{ nodeIds: [node.id], autofixId: input.autofixId }];
  };
  return { rule, check, autofixes: input.autofixes };
}

export type GraphRuleInput = {
  id: string;
  source: RuleSource;
  category: RuleCategory;
  severity: Severity;
  message: string;
  longExplanation: string;
  tags: string[];
  appliesToServices?: ServiceType[];
  predicate: (graph: GraphDocument) => Array<{
    nodeIds?: string[];
    edgeIds?: string[];
    message?: string;
    explanation?: string;
    autofixId?: string;
  }>;
  autofixes?: Record<string, Autofix>;
};

export function graphRule(input: GraphRuleInput): RuleEntry {
  const appliesTo: Rule["appliesTo"] = ["graph", ...(input.appliesToServices ?? [])];
  const rule: Rule = {
    id: input.id,
    source: input.source,
    category: input.category,
    severity: input.severity,
    appliesTo,
    message: input.message,
    longExplanation: input.longExplanation,
    tags: input.tags,
  };
  const check: Check = ({ graph, node }) => {
    if (node) return [];
    return input.predicate(graph);
  };
  return { rule, check, autofixes: input.autofixes };
}

export function nodesOfType(graph: GraphDocument, type: ServiceType): GraphNode[] {
  return graph.nodes.filter((n) => n.type === type);
}

export function getProp<T = unknown>(node: { properties: Record<string, unknown> }, key: string): T | undefined {
  return node.properties[key] as T | undefined;
}
