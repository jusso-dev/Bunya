// Stub importer for the NSG-coverage expansion bundle. Real fetching is wired
// via scripts/import-rules/run.ts which respects ETags and caches under raw/
// (gitignored). For offline builds this file re-exports the already-generated
// rule array unchanged.
import { EXPANSION_NSG_RULES } from "./generated";
import type { RuleEntry } from "@/lib/rules/schema";

export async function importExpansionNsg(): Promise<{ count: number; rules: RuleEntry[] }> {
  return { count: EXPANSION_NSG_RULES.length, rules: EXPANSION_NSG_RULES };
}
