import { describe, expect, it } from "vitest";
import { REGISTRY, RULE_BUNDLES, registryProblems } from "@/lib/rules/registry";
import type { RuleEntry } from "@/lib/rules/schema";

function entry(id: string, overrides: Partial<RuleEntry["rule"]> = {}): RuleEntry {
  return {
    rule: {
      id,
      source: { name: "test", url: "https://example.test" },
      category: "network",
      severity: "info",
      appliesTo: ["storageAccount"],
      message: "test",
      longExplanation: "test",
      tags: ["test"],
      ...overrides,
    },
    check: () => [],
  };
}

describe("REGISTRY", () => {
  it("passes the same checks as pnpm rules:verify", () => {
    expect(registryProblems()).toEqual([]);
  });

  it("is built from every bundle, and every bundle contributes rules", () => {
    expect(REGISTRY).toHaveLength(RULE_BUNDLES.reduce((sum, bundle) => sum + bundle.rules.length, 0));
    expect(RULE_BUNDLES.filter((bundle) => bundle.rules.length === 0).map((bundle) => bundle.slug)).toEqual([]);
    expect(new Set(RULE_BUNDLES.map((bundle) => bundle.slug)).size).toBe(RULE_BUNDLES.length);
  });
});

describe("registryProblems", () => {
  const filler = Array.from({ length: 100 }, (_, i) => entry(`TEST.${i}`));

  it("reports duplicate ids, schema violations and a short registry", () => {
    const unknownService = entry("TEST.BAD", { appliesTo: ["notAService" as "storageAccount"] });
    const problems = registryProblems([...filler, entry("TEST.0"), unknownService, entry("TEST.NO-TAGS", { tags: [] })]);
    expect(problems).toContain("TEST.0: duplicate id");
    expect(problems.some((p) => p.startsWith("TEST.BAD: appliesTo.0"))).toBe(true);
    expect(problems.some((p) => p.startsWith("TEST.NO-TAGS: tags"))).toBe(true);
    expect(registryProblems(filler.slice(0, 99))).toEqual(["registry has 99 rules, expected >= 100"]);
  });
});
