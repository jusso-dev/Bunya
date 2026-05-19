// Application Insights graph-level rules. These complement the per-node rules
// in lib/rules/sources/expansion-app-insights/generated.ts by reasoning across
// edges. Both rules cite Microsoft Learn as upstream authority.

import { graphRule } from "../builders";
import type { RuleEntry } from "../schema";

export const expansionAppInsightsRules: RuleEntry[] = [
  // 7. BUNYA.OBS.AI-WORKSPACE-WRONG-REGION — Cross-region workspace (advisory)
  graphRule({
    id: "BUNYA.OBS.AI-WORKSPACE-WRONG-REGION",
    source: {
      name: "Design a Log Analytics workspace architecture",
      license: "CC-BY-4.0",
      url: "https://learn.microsoft.com/en-us/azure/azure-monitor/logs/workspace-design",
    },
    category: "sovereignty",
    severity: "warning",
    message:
      "[advisory] Application Insights and its Log Analytics workspace may be in different regions (cross-region telemetry, sovereignty risk).",
    longExplanation:
      "When Application Insights is workspace-based, telemetry physically lands in the region of the backing Log Analytics workspace. Splitting the component and its workspace across regions introduces cross-region egress, latency, and — for Australian sovereign workloads — moves data outside the chosen jurisdiction. Bunya only stores a single region per document (no per-node region property), so this rule cannot be evaluated against the current model and is emitted as documentation only.",
    tags: ["bunya", "sovereignty", "app-insights", "log-analytics", "region"],
    appliesToServices: ["applicationInsights"],
    predicate: () => [],
  }),

  // 8. BUNYA.OBS.AI-NO-SOURCE — App Insights without an incoming compute source
  graphRule({
    id: "BUNYA.OBS.AI-NO-SOURCE",
    source: {
      name: "Monitor Azure App Service with Application Insights",
      license: "CC-BY-4.0",
      url: "https://learn.microsoft.com/en-us/azure/azure-monitor/app/azure-web-apps",
    },
    category: "observability",
    severity: "info",
    message:
      "Application Insights component has no incoming diagnostic edge from any compute resource.",
    longExplanation:
      "An Application Insights component with no compute source attached is dead telemetry plumbing: it costs nothing meaningful but it also receives nothing meaningful. App Services, Function Apps, and other workloads should declare a diagnostic edge targeting the component so APM data actually flows. This rule emits one finding per orphaned applicationInsights node and is informational rather than a hard error because some teams attach SDK-only clients that Bunya does not model as graph nodes.",
    tags: ["bunya", "observability", "app-insights", "orphan", "diagnostics"],
    appliesToServices: ["applicationInsights"],
    predicate: (graph) => {
      const partials: Array<{ nodeIds?: string[] }> = [];
      for (const ai of graph.nodes.filter((n) => n.type === "applicationInsights")) {
        const hasIncoming = graph.edges.some(
          (e) => e.target === ai.id && e.kind === "diagnostic",
        );
        if (!hasIncoming) partials.push({ nodeIds: [ai.id] });
      }
      return partials;
    },
  }),
];
