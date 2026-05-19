// Curated Application Insights rule expansion, re-encoded for Bunya.
// Upstream sources cited per-rule (Azure Policy built-ins, PSRule for Azure,
// Microsoft Cloud Security Benchmark). Each entry pins the canonical doc URL on
// `source.url` and, where applicable, the upstream `ruleId`. Advisory rules
// whose check cannot run against Bunya's property model are marked [advisory]
// and use `predicate: () => false` (node) or `predicate: () => []` (graph).

import { graphRule, nodeRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";

export const EXPANSION_APP_INSIGHTS_RULES: RuleEntry[] = [
  // 1. AZPOL.APPINSIGHTS.LOCAL-AUTH — Disable local authentication (advisory)
  nodeRule({
    id: "AZPOL.APPINSIGHTS.LOCAL-AUTH",
    source: {
      name: "Azure Policy built-ins",
      license: "MIT",
      version: "2026-04-01",
      url: "https://learn.microsoft.com/en-us/azure/governance/policy/samples/built-in-policies",
      ruleId:
        "Application Insights components should block non-Microsoft Entra ID based ingestion",
    },
    category: "compliance",
    severity: "warning",
    serviceTypes: ["applicationInsights"],
    message:
      "[advisory] Application Insights should block non-Microsoft Entra ID (local) ingestion.",
    longExplanation:
      "Application Insights components support local authentication via instrumentation keys, which bypasses Microsoft Entra ID controls and complicates revocation when keys leak. The Azure Policy built-in 'Application Insights components should block non-Microsoft Entra ID based ingestion' enforces DisableLocalAuth=true so ingestion is gated by Entra-issued tokens. Bunya does not model the DisableLocalAuth property today, so this rule is advisory only.",
    tags: ["bunya", "azure-policy", "app-insights", "identity", "compliance"],
    predicate: () => false,
  }),

  // 2. PSRULE.APPINSIGHTS.NAME — Resource name compliance
  nodeRule({
    id: "PSRULE.APPINSIGHTS.NAME",
    source: {
      name: "PSRule for Azure",
      license: "MIT",
      version: "v1.42.0",
      url: "https://azure.github.io/PSRule.Rules.Azure/en/rules/Azure.AppInsights.Name/",
      ruleId: "Azure.AppInsights.Name",
    },
    category: "naming",
    severity: "error",
    serviceTypes: ["applicationInsights"],
    message: "Application Insights name violates Azure naming rules.",
    longExplanation:
      "Resource names for Application Insights components must be 1-260 characters and contain only letters, digits, dots, parentheses, hyphens, and underscores. Names outside this constraint fail ARM validation at deployment time. PSRule's Azure.AppInsights.Name enforces the same constraint at lint time so failures surface in CI rather than in the deployment pipeline.",
    tags: ["bunya", "psrule", "naming", "app-insights"],
    predicate: (n) => !/^[a-zA-Z0-9._()-]{1,260}$/.test(n.resourceName),
  }),

  // 3. PSRULE.APPINSIGHTS.WORKSPACE-V2 — Must be workspace-based (graph rule)
  graphRule({
    id: "PSRULE.APPINSIGHTS.WORKSPACE-V2",
    source: {
      name: "PSRule for Azure",
      license: "MIT",
      version: "v1.42.0",
      url: "https://azure.github.io/PSRule.Rules.Azure/en/rules/Azure.AppInsights.Workspace/",
      ruleId: "Azure.AppInsights.Workspace",
    },
    category: "observability",
    severity: "warning",
    message:
      "Application Insights component is not workspace-based (no depends_on edge to a Log Analytics workspace).",
    longExplanation:
      "Classic Application Insights resources were retired in February 2024 and every new component must be workspace-based, backed by a Log Analytics workspace for storage, RBAC and retention. PSRule's Azure.AppInsights.Workspace fails any component that does not carry a WorkspaceResourceId. Bunya models the link as a depends_on edge from the applicationInsights node to a logAnalytics node; this rule fires when that edge is missing.",
    tags: ["bunya", "psrule", "observability", "app-insights", "workspace"],
    appliesToServices: ["applicationInsights"],
    predicate: (graph) => {
      const partials: Array<{ nodeIds?: string[] }> = [];
      for (const ai of graph.nodes.filter((n) => n.type === "applicationInsights")) {
        const hasWs = graph.edges.some(
          (e) =>
            e.source === ai.id &&
            e.kind === "depends_on" &&
            graph.nodes.find((n) => n.id === e.target)?.type === "logAnalytics",
        );
        if (!hasWs) partials.push({ nodeIds: [ai.id] });
      }
      return partials;
    },
  }),

  // 4. MCSB.APPINSIGHTS.LT-3 — Enable logging for cloud-native investigation
  graphRule({
    id: "MCSB.APPINSIGHTS.LT-3",
    source: {
      name: "Microsoft Cloud Security Benchmark v3",
      license: "CC-BY-4.0",
      url: "https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-logging-threat-detection#lt-3-enable-logging-for-security-investigation",
      ruleId: "LT-3",
    },
    category: "observability",
    severity: "info",
    message:
      "Application Insights has no diagnostic edge to a Log Analytics workspace (MCSB LT-3).",
    longExplanation:
      "Microsoft Cloud Security Benchmark control LT-3 requires that telemetry-producing services route their logs to a central workspace so analysts can correlate signals during a security investigation. For Application Insights this means a diagnostic setting that ships the component's own audit and platform logs to a Log Analytics workspace. Bunya treats the absence of such a diagnostic edge as informational because the workspace link (BUNYA.IMP.005 / PSRULE.APPINSIGHTS.WORKSPACE-V2) covers telemetry storage; LT-3 specifically wants the resource's own logs routed.",
    tags: ["bunya", "mcsb", "observability", "app-insights", "logging"],
    appliesToServices: ["applicationInsights"],
    predicate: (graph) => {
      const partials: Array<{ nodeIds?: string[] }> = [];
      for (const ai of graph.nodes.filter((n) => n.type === "applicationInsights")) {
        const hasDiag = graph.edges.some(
          (e) =>
            e.source === ai.id &&
            e.kind === "diagnostic" &&
            graph.nodes.find((n) => n.id === e.target)?.type === "logAnalytics",
        );
        if (!hasDiag) partials.push({ nodeIds: [ai.id] });
      }
      return partials;
    },
  }),

  // 5. BUNYA.OBS.AI-SAMPLING-PROD — Sampling below 100% in production
  nodeRule({
    id: "BUNYA.OBS.AI-SAMPLING-PROD",
    source: {
      name: "Sampling in Application Insights",
      license: "CC-BY-4.0",
      url: "https://learn.microsoft.com/en-us/azure/azure-monitor/app/sampling",
    },
    category: "observability",
    severity: "info",
    serviceTypes: ["applicationInsights"],
    message:
      "Application Insights sampling is below 100% in a production environment.",
    longExplanation:
      "Application Insights sampling reduces telemetry volume (and ingestion cost) by dropping a proportion of requests, dependencies and exceptions. In production this trades fidelity for spend: rare errors may be silently dropped, breaking the WAF Operational Excellence guidance to keep representative telemetry for incident triage. This rule fires when graph.metadata.environment === 'prod' and the component's sampling property is less than 100.",
    tags: ["bunya", "observability", "app-insights", "sampling", "prod"],
    predicate: (n, graph) => {
      if (graph.metadata.environment !== "prod") return false;
      const sampling = n.properties.sampling;
      return typeof sampling === "number" && sampling < 100;
    },
  }),

  // 6. BUNYA.COMP.AI-CMK — Customer-managed keys for App Insights (advisory)
  nodeRule({
    id: "BUNYA.COMP.AI-CMK",
    source: {
      name: "Customer-managed keys in Azure Monitor",
      license: "CC-BY-4.0",
      url: "https://learn.microsoft.com/en-us/azure/azure-monitor/logs/customer-managed-keys",
    },
    category: "compliance",
    severity: "info",
    serviceTypes: ["applicationInsights"],
    message:
      "[advisory] Application Insights stored telemetry should be encrypted with a customer-managed key.",
    longExplanation:
      "Azure Monitor supports customer-managed keys (CMK) so that the Log Analytics workspace backing an Application Insights component encrypts ingested telemetry with a key in your own Key Vault. CMK is a common control for ISM PROTECTED workloads and FSI compliance regimes. Bunya does not yet model the workspace-level CMK property, so this rule is advisory and never auto-flags; it documents the gap so reviewers see the expectation.",
    tags: ["bunya", "compliance", "app-insights", "encryption-at-rest", "cmk"],
    predicate: () => false,
  }),
];
