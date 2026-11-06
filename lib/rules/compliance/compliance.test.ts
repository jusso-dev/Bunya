import { describe, expect, it } from "vitest";
import { REGISTRY } from "@/lib/rules/registry";
import {
  COMPLIANCE_FRAMEWORKS,
  POLICY_ALIGNMENTS,
  POLICY_METADATA,
  alignmentLabel,
  ruleAlignments,
  withAlignmentTags,
} from "@/lib/rules/compliance";
import type { RuleEntry } from "@/lib/rules/schema";

describe("compliance alignment", () => {
  const ruleIds = new Set(REGISTRY.map((entry) => entry.rule.id));

  it("only references rules that exist", () => {
    for (const alignment of POLICY_ALIGNMENTS) {
      for (const ruleId of alignment.ruleIds) expect(ruleIds.has(ruleId), ruleId).toBe(true);
    }
  });

  it("maps each policy once", () => {
    const ids = POLICY_ALIGNMENTS.map((a) => a.policyDefinitionId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toBe(id.toLowerCase());
  });

  it("tags at least 30 rules with a pinned CIS Azure control", () => {
    const cis = COMPLIANCE_FRAMEWORKS.find((f) => f.id === "cis-azure");
    expect(cis?.version).toBe("3.0.0");
    const tagged = REGISTRY.filter((entry) => entry.rule.tags.some((tag) => tag.startsWith("cis-azure-v3.0.0:")));
    expect(tagged.length).toBeGreaterThanOrEqual(30);
  });

  it("derives tags from Azure Policy metadata, not hand-written control IDs", () => {
    const tls = REGISTRY.find((entry) => entry.rule.id === "PSRULE.STORAGE.MINTLS")!;
    expect(tls.rule.tags).toContain("cis-azure-v3.0.0:4.15");
    const [alignment] = ruleAlignments("PSRULE.STORAGE.MINTLS");
    expect(alignmentLabel(alignment)).toBe("CIS Azure 3.0.0 §4.15");
    expect(alignment.policyDisplayName).toBe(POLICY_METADATA["fe83a0eb-a853-422d-aac2-1bffd182c5d0"].displayName);
  });

  it("adds alignment tags without mutating the entry it was given", () => {
    const entry: RuleEntry = {
      rule: {
        id: "PSRULE.STORAGE.MINTLS",
        source: { name: "test", url: "https://example.test" },
        category: "data-protection",
        severity: "error",
        appliesTo: ["storageAccount"],
        message: "test",
        longExplanation: "test",
        tags: ["test"],
      },
      check: () => [],
    };
    const [tagged] = withAlignmentTags([entry]);
    expect(tagged.rule.tags).toContain("cis-azure-v3.0.0:4.15");
    expect(entry.rule.tags).toEqual(["test"]);
  });

  it("does not claim alignment for rules without an equivalent policy", () => {
    expect(ruleAlignments("BUNYA.NET.001")).toEqual([]);
  });

  it("ships control IDs only, never framework prose", () => {
    for (const metadata of Object.values(POLICY_METADATA)) {
      for (const ids of Object.values(metadata.controls)) {
        for (const id of ids) expect(id).toMatch(/^\d+(\.\d+)*$/);
      }
    }
  });
});
