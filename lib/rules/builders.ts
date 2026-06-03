import type { GraphDocument, GraphEdge, GraphNode, ServiceType } from "@/lib/graph/schema";
import {
  Autofix,
  Check,
  Rule,
  RuleCategory,
  RuleEntry,
  RuleSource,
  Severity,
} from "./schema";
import { armTypeOf } from "./mapping";

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
    appliesTo: input.serviceTypes.map(armTypeOf),
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
  const appliesTo = input.appliesToServices
    ? ["graph", ...input.appliesToServices.map(armTypeOf)]
    : ["graph"];
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

export function hasEdge(
  graph: GraphDocument,
  predicate: (e: GraphEdge, source: GraphNode | undefined, target: GraphNode | undefined) => boolean,
): boolean {
  return graph.edges.some((e) => {
    const s = graph.nodes.find((n) => n.id === e.source);
    const t = graph.nodes.find((n) => n.id === e.target);
    return predicate(e, s, t);
  });
}

export function nodesOfType(graph: GraphDocument, type: ServiceType): GraphNode[] {
  return graph.nodes.filter((n) => n.type === type);
}

export function findNodeById(graph: GraphDocument, id: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}
