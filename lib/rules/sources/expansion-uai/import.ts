// Stub importer for the User-Assigned Managed Identity rule expansion. Real
// fetching is wired via scripts/import-rules/run.ts which respects ETags and
// caches under raw/ (gitignored). For offline builds this file re-exports the
// already-generated rule array unchanged.
import { EXPANSION_UAI_RULES } from "./generated";
import type { RuleEntry } from "@/lib/rules/schema";

export async function importExpansionUai(): Promise<{
  count: number;
  rules: RuleEntry[];
}> {
  return {
    count: EXPANSION_UAI_RULES.length,
    rules: EXPANSION_UAI_RULES,
  };
}
