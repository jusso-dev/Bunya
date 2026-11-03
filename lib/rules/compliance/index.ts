import type { ServiceType } from "@/lib/graph/schema";
import type { RuleEntry } from "@/lib/rules/schema";
import { POLICY_ALIGNMENTS, type PolicyAlignment } from "./policy-alignments";
import { COMPLIANCE_FRAMEWORKS, POLICY_METADATA, POLICY_METADATA_SOURCE } from "./policy-metadata.generated";
import type { ComplianceFramework, PolicyMetadata } from "./types";

export { COMPLIANCE_FRAMEWORKS, POLICY_ALIGNMENTS, POLICY_METADATA, POLICY_METADATA_SOURCE };
export type { ComplianceFramework, PolicyAlignment, PolicyMetadata };

export const POLICY_DEFINITION_PREFIX = "/providers/Microsoft.Authorization/policyDefinitions/";

/**
 * A framework control a rule lines up with, traced through the Azure Policy
 * built-in that checks the same setting. Alignment is not compliance.
 */
export type RuleAlignment = {
  framework: ComplianceFramework;
  controlId: string;
  policyDefinitionId: string;
  policyDisplayName: string;
};

export type ResolvedPolicy = {
  alignment: PolicyAlignment;
  metadata: PolicyMetadata;
};

const FRAMEWORKS_BY_ID = new Map(COMPLIANCE_FRAMEWORKS.map((framework) => [framework.id, framework]));

/** Alignments whose policy exists upstream and is not deprecated. */
export function currentPolicies(): ResolvedPolicy[] {
  return POLICY_ALIGNMENTS.flatMap((alignment) => {
    const metadata = POLICY_METADATA[alignment.policyDefinitionId.toLowerCase()];
    return metadata && !metadata.deprecated ? [{ alignment, metadata }] : [];
  });
}

const ALIGNMENTS_BY_RULE: Map<string, RuleAlignment[]> = (() => {
  const map = new Map<string, RuleAlignment[]>();
  for (const { alignment, metadata } of currentPolicies()) {
    for (const [frameworkId, controlIds] of Object.entries(metadata.controls)) {
      const framework = FRAMEWORKS_BY_ID.get(frameworkId);
      if (!framework) continue;
      for (const controlId of controlIds) {
        for (const ruleId of alignment.ruleIds) {
          const list = map.get(ruleId) ?? [];
          if (!list.some((a) => a.framework.id === frameworkId && a.controlId === controlId)) {
            list.push({
              framework,
              controlId,
              policyDefinitionId: alignment.policyDefinitionId,
              policyDisplayName: metadata.displayName,
            });
          }
          map.set(ruleId, list);
        }
      }
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.controlId.localeCompare(b.controlId, "en", { numeric: true }));
  }
  return map;
})();

export function ruleAlignments(ruleId: string): RuleAlignment[] {
  return ALIGNMENTS_BY_RULE.get(ruleId) ?? [];
}

/** Tag form used on rules, e.g. `cis-azure-v3.0.0:4.15`. */
export function alignmentTag(alignment: RuleAlignment): string {
  return `${alignment.framework.id}-v${alignment.framework.version}:${alignment.controlId}`;
}

/** Human label, e.g. `CIS Azure 3.0.0 §4.15`. */
export function alignmentLabel(alignment: RuleAlignment): string {
  return `${alignment.framework.shortName} ${alignment.framework.version} §${alignment.controlId}`;
}

/** Adds framework alignment tags to rules without mutating the source bundles. */
export function withAlignmentTags(entries: RuleEntry[]): RuleEntry[] {
  return entries.map((entry) => {
    const alignments = ruleAlignments(entry.rule.id);
    if (alignments.length === 0) return entry;
    const tags = [...new Set([...entry.rule.tags, ...alignments.map(alignmentTag)])];
    return { ...entry, rule: { ...entry.rule, tags } };
  });
}

/** Policies relevant to a diagram that contains the given service types. */
export function policiesForServiceTypes(types: Iterable<ServiceType>): ResolvedPolicy[] {
  const present = new Set(types);
  return currentPolicies().filter(({ alignment }) => alignment.serviceTypes.some((t) => present.has(t)));
}
