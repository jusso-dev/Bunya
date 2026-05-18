import { graphRule } from "../builders";
import type { GraphNode, ServiceType } from "@/lib/graph/schema";
import type { RuleEntry } from "../schema";

const PROD_ISH_TYPES: ReadonlyArray<ServiceType> = [
  "appService",
  "functionApp",
  "sqlDatabase",
  "cosmosDb",
  "storageAccount",
  "keyVault",
  "frontDoor",
  "applicationGateway",
  "apiManagement",
  "containerRegistry",
];

function targetType(
  graph: { nodes: GraphNode[] },
  edgeTarget: string,
): ServiceType | undefined {
  return graph.nodes.find((n) => n.id === edgeTarget)?.type;
}

export const observabilityRules: RuleEntry[] = [
  graphRule({
    id: "BUNYA.OBS.001",
    source: {
      name: "Observability in the Azure Well-Architected Framework",
      url: "https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/observability",
      license: "CC-BY-4.0",
    },
    category: "observability",
    severity: "warning",
    message: "Graph has telemetry-producing resources but no Log Analytics Workspace.",
    longExplanation:
      "A central Log Analytics workspace is the recommended sink for platform metrics, resource logs and Sentinel detections in Azure. Without one, diagnostic settings have nowhere to flow and operators lose the unified KQL surface used during incident response. This rule fires when production-ish services are present but no logAnalytics node exists, or when a diagnostic edge points somewhere that is not a workspace.",
    tags: ["bunya", "observability", "log-analytics", "diagnostics"],
    predicate: (graph) => {
      const partials: Array<{ nodeIds?: string[]; edgeIds?: string[] }> = [];
      const workspaces = graph.nodes.filter((n) => n.type === "logAnalytics");
      const prodish = graph.nodes.filter((n) =>
        PROD_ISH_TYPES.includes(n.type as ServiceType),
      );
      if (workspaces.length === 0 && prodish.length > 0) {
        partials.push({ nodeIds: prodish.map((n) => n.id) });
      }
      for (const edge of graph.edges) {
        if (edge.kind !== "diagnostic") continue;
        const tt = targetType(graph, edge.target);
        if (tt && tt !== "logAnalytics" && tt !== "applicationInsights") {
          partials.push({ edgeIds: [edge.id] });
        }
      }
      return partials;
    },
  }),
  graphRule({
    id: "BUNYA.OBS.002",
    source: {
      name: "Monitor Azure App Service with Application Insights and Azure Monitor",
      url: "https://learn.microsoft.com/en-us/azure/azure-monitor/app/azure-web-apps",
      license: "CC-BY-4.0",
    },
    category: "observability",
    severity: "warning",
    message: "App Service / Function App is not sending diagnostics to Log Analytics or App Insights.",
    longExplanation:
      "App Services and Function Apps emit request, dependency and platform logs that are invaluable for triage. Routing them to Application Insights gives you APM, while a diagnostic setting to Log Analytics gives you long-term retention and cross-resource queries. Sites without either destination provide almost no observability beyond live tail.",
    tags: ["bunya", "observability", "app-service", "function-app"],
    predicate: (graph) => {
      const partials: Array<{ nodeIds?: string[] }> = [];
      for (const site of graph.nodes.filter(
        (n) => n.type === "appService" || n.type === "functionApp",
      )) {
        const hasSink = graph.edges.some((e) => {
          if (e.source !== site.id || e.kind !== "diagnostic") return false;
          const tt = targetType(graph, e.target);
          return tt === "logAnalytics" || tt === "applicationInsights";
        });
        if (!hasSink) partials.push({ nodeIds: [site.id] });
      }
      return partials;
    },
  }),
  graphRule({
    id: "BUNYA.OBS.003",
    source: {
      name: "Diagnostic settings in Azure Monitor",
      url: "https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/diagnostic-settings",
      license: "CC-BY-4.0",
    },
    category: "observability",
    severity: "info",
    message: "Data plane resource has no diagnostic edge to Log Analytics.",
    longExplanation:
      "Storage Accounts, Key Vaults and SQL Databases emit audit and access logs that are commonly required by ISM controls and forensic investigations. A diagnostic setting routing these resource logs to a Log Analytics workspace turns each resource into a queryable audit source. Bunya flags this as informational because not every workload needs the full firehose, but production workloads almost always do.",
    tags: ["bunya", "observability", "diagnostics", "audit"],
    predicate: (graph) => {
      const partials: Array<{ nodeIds?: string[] }> = [];
      for (const res of graph.nodes.filter(
        (n) =>
          n.type === "storageAccount" ||
          n.type === "keyVault" ||
          n.type === "sqlDatabase",
      )) {
        const hasDiag = graph.edges.some(
          (e) =>
            e.source === res.id &&
            e.kind === "diagnostic" &&
            targetType(graph, e.target) === "logAnalytics",
        );
        if (!hasDiag) partials.push({ nodeIds: [res.id] });
      }
      return partials;
    },
  }),
  graphRule({
    id: "BUNYA.OBS.004",
    source: {
      name: "Configure data retention and archive in Azure Monitor Logs",
      url: "https://learn.microsoft.com/en-us/azure/azure-monitor/logs/data-retention-configure",
      license: "CC-BY-4.0",
    },
    category: "observability",
    severity: "warning",
    message: "Log Analytics retention is below 30 days for a production environment.",
    longExplanation:
      "Azure Monitor's default interactive retention is 30 days and many compliance regimes (including the ASD ISM) expect longer for production workloads. Setting retentionDays below 30 in prod silently shortens your forensic window and may also disable archive tiers downstream. Increase retention or use the interactive plus archive split documented by Microsoft.",
    tags: ["bunya", "observability", "log-analytics", "retention", "prod"],
    predicate: (graph) => {
      const partials: Array<{ nodeIds?: string[] }> = [];
      if (graph.metadata.environment !== "prod") return partials;
      for (const ws of graph.nodes.filter((n) => n.type === "logAnalytics")) {
        const retention = ws.properties?.retentionDays;
        if (typeof retention === "number" && retention < 30) {
          partials.push({ nodeIds: [ws.id] });
        }
      }
      return partials;
    },
  }),
  graphRule({
    id: "BUNYA.OBS.005",
    source: {
      name: "Azure Front Door service guide (Well-Architected Framework)",
      url: "https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-front-door",
      license: "CC-BY-4.0",
    },
    category: "observability",
    severity: "info",
    message: "Edge load balancer has no diagnostic edge to Log Analytics.",
    longExplanation:
      "Front Door and Application Gateway sit at the ingress edge and produce access logs, WAF logs and health probe data that are the first stop for debugging traffic problems. Without a diagnostic setting to Log Analytics these logs are dropped after a short retention window. This is informational because some teams ship logs elsewhere, but a workspace target is the Azure-native default.",
    tags: ["bunya", "observability", "front-door", "application-gateway"],
    predicate: (graph) => {
      const partials: Array<{ nodeIds?: string[] }> = [];
      for (const edge of graph.nodes.filter(
        (n) => n.type === "frontDoor" || n.type === "applicationGateway",
      )) {
        const hasDiag = graph.edges.some(
          (e) =>
            e.source === edge.id &&
            e.kind === "diagnostic" &&
            targetType(graph, e.target) === "logAnalytics",
        );
        if (!hasDiag) partials.push({ nodeIds: [edge.id] });
      }
      return partials;
    },
  }),
];
