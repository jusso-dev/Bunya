// Stub importer for the Australian Government Information Security Manual.
// Real fetching (and verification against the pinned ISM release) is wired via
// scripts/import-rules/run.ts. For offline builds this file re-exports the
// already-generated rule array unchanged.
import { ISM_RULES } from "./generated";
import type { RuleEntry } from "@/lib/rules/schema";

export async function importIsm(): Promise<{ count: number; rules: RuleEntry[] }> {
  return { count: ISM_RULES.length, rules: ISM_RULES };
}
