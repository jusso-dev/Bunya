// Stub importer for the Azure Naming Tool. Real fetching is wired via
// scripts/import-rules/run.ts which respects ETags and caches under raw/
// (gitignored). For offline builds this file re-exports the already-generated
// rule array unchanged.
import { NAMING_RULES } from "./generated";
import type { RuleEntry } from "@/lib/rules/schema";

export async function importNaming(): Promise<{ count: number; rules: RuleEntry[] }> {
  return { count: NAMING_RULES.length, rules: NAMING_RULES };
}
