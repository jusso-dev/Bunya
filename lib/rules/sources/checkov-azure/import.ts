// Stub importer for Checkov (Azure). Real fetching is wired via
// scripts/import-rules/run.ts which respects ETags and caches under raw/
// (gitignored). For offline builds this file re-exports the already-generated
// rule array unchanged.
import { CHECKOV_RULES } from "./generated";
import type { RuleEntry } from "@/lib/rules/schema";

export async function importCheckov(): Promise<{ count: number; rules: RuleEntry[] }> {
  return { count: CHECKOV_RULES.length, rules: CHECKOV_RULES };
}
