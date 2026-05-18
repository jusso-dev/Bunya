// Stub importer for the Essential Eight Maturity Model. Real fetching (and
// verification against the pinned ACSC release) is wired via
// scripts/import-rules/run.ts. For offline builds this file re-exports the
// already-generated rule array unchanged.
import { ESSENTIAL_EIGHT_RULES } from "./generated";
import type { RuleEntry } from "@/lib/rules/schema";

export async function importEssentialEight(): Promise<{
  count: number;
  rules: RuleEntry[];
}> {
  return { count: ESSENTIAL_EIGHT_RULES.length, rules: ESSENTIAL_EIGHT_RULES };
}
