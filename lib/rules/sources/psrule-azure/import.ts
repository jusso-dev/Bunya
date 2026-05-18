// Stub importer for PSRule for Azure. Real fetching is wired via scripts/import-rules/run.ts
// which respects ETags and caches under raw/ (gitignored). For offline builds this file
// re-exports the already-generated rule array unchanged.
import { PSRULE_RULES } from "./generated";
import type { RuleEntry } from "@/lib/rules/schema";

export async function importPSRule(): Promise<{ count: number; rules: RuleEntry[] }> {
  return { count: PSRULE_RULES.length, rules: PSRULE_RULES };
}
