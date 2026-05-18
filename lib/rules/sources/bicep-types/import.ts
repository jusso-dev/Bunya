// Stub importer for Azure/bicep-types-az. Real fetching is wired via
// scripts/import-rules/run.ts which respects ETags and caches under raw/
// (gitignored). For offline builds this file re-exports the already-generated
// rule array unchanged.
import { BICEP_TYPE_RULES } from "./generated";
import type { RuleEntry } from "@/lib/rules/schema";

export async function importBicepTypes(): Promise<{ count: number; rules: RuleEntry[] }> {
  return { count: BICEP_TYPE_RULES.length, rules: BICEP_TYPE_RULES };
}
