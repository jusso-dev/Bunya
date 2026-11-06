import { z } from "zod";
import { ServiceTypeSchema, type GraphDocument, type GraphNode, type ServiceType } from "@/lib/graph/schema";

export const SeveritySchema = z.enum(["error", "warning", "info"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const RuleCategorySchema = z.enum([
  "naming",
  "network",
  "identity",
  "data-protection",
  "observability",
  "reliability",
  "cost",
  "compliance",
  "sovereignty",
]);
export type RuleCategory = z.infer<typeof RuleCategorySchema>;

export const RuleSourceSchema = z.object({
  name: z.string().min(1),
  url: z.url(),
  ruleId: z.string().optional(),
  version: z.string().optional(),
  license: z.string().optional(),
});
export type RuleSource = z.infer<typeof RuleSourceSchema>;

export const RuleSchema = z.object({
  id: z.string().min(1),
  source: RuleSourceSchema,
  category: RuleCategorySchema,
  severity: SeveritySchema,
  appliesTo: z.array(z.union([z.literal("graph"), ServiceTypeSchema])).min(1),
  message: z.string().min(1),
  longExplanation: z.string().min(1),
  tags: z.array(z.string()).min(1),
});
export type Rule = z.infer<typeof RuleSchema>;

export type CheckFinding = {
  message?: string;
  explanation?: string;
  nodeIds?: string[];
  edgeIds?: string[];
  autofixId?: string;
};

export type CheckContext = {
  graph: GraphDocument;
  node: GraphNode | null;
};

export type Check = (ctx: CheckContext) => CheckFinding[];

export type Autofix = (graph: GraphDocument, finding: Finding) => GraphDocument;

export type RuleEntry = {
  rule: Rule;
  check: Check;
  autofixes?: Record<string, Autofix>;
};

export type Finding = {
  ruleId: string;
  rule: Rule;
  severity: Severity;
  message: string;
  explanation: string;
  source: RuleSource;
  nodeIds?: string[];
  edgeIds?: string[];
  autofixId?: string;
};

export function isGraphScope(rule: Rule): boolean {
  return rule.appliesTo.includes("graph");
}

export type { GraphDocument, GraphNode, ServiceType };
