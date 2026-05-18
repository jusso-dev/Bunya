// Stub importer for the Azure Private Link FAQ. Real fetching is wired via
// scripts/import-rules/run.ts which respects ETags and caches under raw/
// (gitignored). For offline builds this file re-exports the already-generated
// rule array unchanged.
import { PRIVATE_LINK_RULES } from "./generated";
import type { RuleEntry } from "@/lib/rules/schema";

export async function importPrivateLinkFaq(): Promise<{ count: number; rules: RuleEntry[] }> {
  return { count: PRIVATE_LINK_RULES.length, rules: PRIVATE_LINK_RULES };
}
