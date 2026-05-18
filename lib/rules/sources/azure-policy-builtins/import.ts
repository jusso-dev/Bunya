// Stub importer for Azure Policy built-in definitions. Real fetching is wired
// via scripts/import-rules/run.ts which respects ETags and caches under raw/
// (gitignored). For offline builds this file re-exports the already-generated
// rule array unchanged.
import { AZURE_POLICY_RULES } from "./generated";
import type { RuleEntry } from "@/lib/rules/schema";

export async function importAzurePolicyBuiltins(): Promise<{
  count: number;
  rules: RuleEntry[];
}> {
  return { count: AZURE_POLICY_RULES.length, rules: AZURE_POLICY_RULES };
}
