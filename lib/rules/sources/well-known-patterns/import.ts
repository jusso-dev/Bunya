// Stub importer for the Azure Architecture Center + Well-Architected pattern
// set. Real fetching is wired via scripts/import-rules/run.ts which respects
// ETags and caches under raw/ (gitignored). For offline builds this file
// re-exports the already-generated rule array unchanged.
import { WELL_KNOWN_PATTERN_RULES } from "./generated";
import type { RuleEntry } from "@/lib/rules/schema";

export async function importWellKnownPatterns(): Promise<{ count: number; rules: RuleEntry[] }> {
  return { count: WELL_KNOWN_PATTERN_RULES.length, rules: WELL_KNOWN_PATTERN_RULES };
}
