/**
 * Validates the merged rules registry built by walking `lib/rules/sources/`.
 *
 * Assertions:
 *   1. Every rule has a non-empty `id`, parseable `source.url`, `message`,
 *      and `longExplanation`.
 *   2. Rule `id`s are unique.
 *   3. Every `appliesTo` entry is either the literal `"graph"` or a known
 *      ARM type from `lib/rules/mapping.ts` `allArmTypes()`.
 *   4. Every rule has at least one tag.
 *   5. The total registry count is >= 100.
 *
 * Exported `verify()` is consumed by `scripts/import-rules/run.ts`; the
 * file is also runnable directly (`pnpm rules:verify`) via tsx.
 */
import { fileURLToPath } from "node:url";
import { allArmTypes } from "@/lib/rules/mapping";
import type { Rule, RuleEntry } from "@/lib/rules/schema";
import { loadRegistry } from "./loadRegistry";

export type VerifyResult = {
  ok: boolean;
  errors: string[];
};

const MIN_REGISTRY_SIZE = 100;

function isParseableUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function verifyRules(rules: RuleEntry[]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const armTypes = new Set<string>(allArmTypes());

  for (const [index, entry] of rules.entries()) {
    const rule: Rule = entry.rule;
    const ctx = `rule[${index}] ${rule?.id ?? "<no-id>"}`;

    if (!rule || typeof rule !== "object") {
      errors.push(`${ctx}: entry.rule is missing or not an object`);
      continue;
    }

    if (!rule.id || rule.id.trim().length === 0) {
      errors.push(`${ctx}: id is empty`);
    } else {
      const prior = seen.get(rule.id);
      if (prior !== undefined) {
        errors.push(`${ctx}: duplicate id (also at index ${prior})`);
      } else {
        seen.set(rule.id, index);
      }
    }

    if (!rule.source || !rule.source.url) {
      errors.push(`${ctx}: source.url is missing`);
    } else if (!isParseableUrl(rule.source.url)) {
      errors.push(`${ctx}: source.url is not a parseable URL (${rule.source.url})`);
    }

    if (!rule.message || rule.message.trim().length === 0) {
      errors.push(`${ctx}: message is empty`);
    }
    if (!rule.longExplanation || rule.longExplanation.trim().length === 0) {
      errors.push(`${ctx}: longExplanation is empty`);
    }

    if (!Array.isArray(rule.appliesTo) || rule.appliesTo.length === 0) {
      errors.push(`${ctx}: appliesTo is empty`);
    } else {
      for (const target of rule.appliesTo) {
        if (target === "graph") continue;
        if (!armTypes.has(target)) {
          errors.push(`${ctx}: appliesTo entry "${target}" is not a known ARM type`);
        }
      }
    }

    if (!Array.isArray(rule.tags) || rule.tags.length === 0) {
      errors.push(`${ctx}: must have at least one tag`);
    }
  }

  if (rules.length < MIN_REGISTRY_SIZE) {
    errors.push(
      `registry has ${rules.length} rules, expected >= ${MIN_REGISTRY_SIZE}`,
    );
  }

  return errors;
}

export async function verify(rules?: RuleEntry[]): Promise<VerifyResult> {
  let allRules: RuleEntry[];
  if (rules) {
    allRules = rules;
  } else {
    const loaded = await loadRegistry({ tolerant: true });
    allRules = loaded.rules;
    if (loaded.errors.length > 0) {
      // Surface load errors as warnings — the count check below will fail
      // anyway if a critical source did not load.
      for (const { folder, error } of loaded.errors) {
        console.warn(`[verify] skipped source ${folder}: ${error}`);
      }
    }
  }

  const errors = verifyRules(allRules);
  return { ok: errors.length === 0, errors };
}

async function main(): Promise<void> {
  const result = await verify();
  if (!result.ok) {
    console.error(`[verify] FAILED with ${result.errors.length} error(s):`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log("[verify] OK");
}

const isMain = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("[verify] crashed:", err);
    process.exit(1);
  });
}
