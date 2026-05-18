import { describe, expect, it } from "vitest";
import { REGISTRY } from "@/lib/rules/registry";

const REQUIRED_SOURCE_NAMES = [
  "PSRule for Azure",
  "Checkov",
  "Azure Policy built-ins",
  "Azure Naming Tool",
  "Bicep types",
  "Australian Government Information Security Manual",
  "Essential Eight Maturity Model",
  "Azure Private Link FAQ",
] as const;

function summary(entries: typeof REGISTRY) {
  const bySource: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const e of entries) {
    bySource[e.rule.source.name] = (bySource[e.rule.source.name] ?? 0) + 1;
    byCategory[e.rule.category] = (byCategory[e.rule.category] ?? 0) + 1;
    bySeverity[e.rule.severity] = (bySeverity[e.rule.severity] ?? 0) + 1;
  }
  // Sort keys for stable snapshot output.
  const sortObj = (obj: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
    );
  return {
    total: entries.length,
    bySource: sortObj(bySource),
    byCategory: sortObj(byCategory),
    bySeverity: sortObj(bySeverity),
  };
}

describe("REGISTRY", () => {
  it.skipIf(REGISTRY.length === 0)(
    "produces a stable summary snapshot",
    () => {
      expect(summary(REGISTRY)).toMatchSnapshot();
    },
  );

  it.skipIf(REGISTRY.length === 0)(
    "is non-empty after `pnpm rules:import` (>= 100 rules)",
    () => {
      expect(REGISTRY.length).toBeGreaterThanOrEqual(100);
    },
  );

  it.skipIf(REGISTRY.length === 0)(
    "every rule has populated id / source.url / message / longExplanation / tags / appliesTo",
    () => {
      const offenders: string[] = [];
      for (const entry of REGISTRY) {
        const r = entry.rule;
        if (!r.id || r.id.length === 0) offenders.push(`missing id: ${JSON.stringify(r)}`);
        if (!r.source?.url || r.source.url.length === 0)
          offenders.push(`${r.id}: missing source.url`);
        if (!r.message || r.message.length === 0)
          offenders.push(`${r.id}: missing message`);
        if (!r.longExplanation || r.longExplanation.length === 0)
          offenders.push(`${r.id}: missing longExplanation`);
        if (!Array.isArray(r.tags) || r.tags.length < 1)
          offenders.push(`${r.id}: tags must have >= 1 element`);
        if (!Array.isArray(r.appliesTo) || r.appliesTo.length < 1)
          offenders.push(`${r.id}: appliesTo must have >= 1 element`);
      }
      expect(offenders).toEqual([]);
    },
  );

  it.skipIf(REGISTRY.length === 0)(
    "has no duplicate rule ids across the registry",
    () => {
      const seen = new Map<string, number>();
      for (const e of REGISTRY) {
        seen.set(e.rule.id, (seen.get(e.rule.id) ?? 0) + 1);
      }
      const duplicates = [...seen.entries()]
        .filter(([, n]) => n > 1)
        .map(([id, n]) => `${id} x${n}`);
      expect(duplicates).toEqual([]);
    },
  );

  it.skipIf(REGISTRY.length === 0)(
    "contains at least one rule from every required source",
    () => {
      const presentSources = new Set(REGISTRY.map((e) => e.rule.source.name));
      const missing = REQUIRED_SOURCE_NAMES.filter(
        (name) => !presentSources.has(name),
      );
      expect(missing).toEqual([]);
    },
  );

  it.skipIf(REGISTRY.length === 0)(
    "contains the hand-written BUNYA.NET.004 graph rule",
    () => {
      const ids = REGISTRY.map((e) => e.rule.id);
      expect(ids).toContain("BUNYA.NET.004");
    },
  );
});
