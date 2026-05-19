// Stub importer for the Application Insights rule expansion. Real fetching is
// wired via scripts/import-rules/run.ts which respects ETags and caches under
// raw/ (gitignored). For offline builds this file re-exports the already-
// generated rule array unchanged.
import { EXPANSION_APP_INSIGHTS_RULES } from "./generated";
import type { RuleEntry } from "@/lib/rules/schema";

export async function importExpansionAppInsights(): Promise<{
  count: number;
  rules: RuleEntry[];
}> {
  return {
    count: EXPANSION_APP_INSIGHTS_RULES.length,
    rules: EXPANSION_APP_INSIGHTS_RULES,
  };
}
