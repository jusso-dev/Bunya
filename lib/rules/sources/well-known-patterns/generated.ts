// Generated from Microsoft Learn — Azure Architecture Center + Well-Architected
// Framework (revision 2026-04-01). Each entry encodes one reference pattern as
// a Bunya RuleEntry that fires when the graph claims a pattern but is missing a
// required complement. Do not hand-edit; rerun the importer.
import { graphRule, nodeRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";
import type { GraphDocument, GraphNode } from "@/lib/graph/schema";

const PATTERN_BASE = {
  name: "Microsoft Learn — Azure Architecture Center",
  license: "CC-BY-4.0",
  version: "2026-04-01",
} as const;

function getProp<T = unknown>(
  node: { properties: Record<string, unknown> },
  key: string,
): T | undefined {
  return node.properties[key] as T | undefined;
}

function nodesOfTypeLocal(graph: GraphDocument, type: GraphNode["type"]): GraphNode[] {
  return graph.nodes.filter((n) => n.type === type);
}

export const WELL_KNOWN_PATTERN_RULES: RuleEntry[] = [
  // 1. PATTERN.WEB-APP-MISSING-CDN — Prod App Service without Front Door / CDN.
  graphRule({
    id: "PATTERN.WEB-APP-MISSING-CDN",
    source: {
      ...PATTERN_BASE,
      url: "https://learn.microsoft.com/en-us/azure/architecture/web-apps/app-service/architectures/basic-web-app",
      ruleId: "basic-web-app#cdn-or-front-door",
    },
    category: "reliability",
    severity: "info",
    message:
      "Prod App Service has no Front Door or CDN in front of it.",
    longExplanation:
      "The Azure Architecture Center basic-web-app reference architecture places a global ingress (Azure Front Door or Azure CDN) in front of an App Service for TLS termination, edge caching and WAF. In production environments, designs without a global ingress are missing the recommended hot path: end users hit the regional App Service directly, which adds latency, removes WAF coverage and concentrates DDoS exposure on the origin.",
    tags: ["well-architected", "architecture-center", "web-app", "front-door"],
    predicate: (graph) => {
      if (graph.metadata.environment !== "prod") return [];
      const apps = nodesOfTypeLocal(graph, "appService");
      if (apps.length === 0) return [];
      const hasFrontDoor = nodesOfTypeLocal(graph, "frontDoor").length > 0;
      if (hasFrontDoor) return [];
      return [{ nodeIds: apps.map((a) => a.id) }];
    },
  }),

  // 2. PATTERN.HUB-SPOKE-MISSING-NSG — VNet present but no NSG anywhere.
  graphRule({
    id: "PATTERN.HUB-SPOKE-MISSING-NSG",
    source: {
      ...PATTERN_BASE,
      url: "https://learn.microsoft.com/en-us/azure/architecture/networking/architecture/hub-spoke",
      ruleId: "hub-spoke#nsg",
    },
    category: "network",
    severity: "warning",
    message:
      "Virtual Network is present but no Network Security Group is defined.",
    longExplanation:
      "Every variant of the hub-spoke reference architecture relies on Network Security Groups as the per-subnet stateful firewall and the primary control for east-west traffic. A graph that introduces a Virtual Network without defining a single NSG defaults to permissive platform rules and cannot satisfy the segmentation guidance from the docs. Add at least one NSG and associate it with the workload subnets.",
    tags: ["well-architected", "architecture-center", "hub-spoke", "nsg"],
    predicate: (graph) => {
      const vnets = nodesOfTypeLocal(graph, "virtualNetwork");
      if (vnets.length === 0) return [];
      const nsgs = nodesOfTypeLocal(graph, "networkSecurityGroup");
      if (nsgs.length > 0) return [];
      return [{ nodeIds: vnets.map((v) => v.id) }];
    },
  }),

  // 3. PATTERN.FUNCTION-WITHOUT-APP-INSIGHTS — Function App without App Insights edge.
  graphRule({
    id: "PATTERN.FUNCTION-WITHOUT-APP-INSIGHTS",
    source: {
      ...PATTERN_BASE,
      url: "https://learn.microsoft.com/en-us/azure/azure-functions/functions-monitoring",
      ruleId: "functions-monitoring#app-insights",
    },
    category: "reliability",
    severity: "warning",
    message:
      "Function App has no diagnostic edge to Application Insights.",
    longExplanation:
      "The Azure Functions monitoring guide treats Application Insights as the default telemetry sink for invocations, dependencies, exceptions and live metrics. A Function App without an Application Insights connection has no first-class way to surface cold-start latency, failed bindings or unhandled exceptions in production, which makes incidents difficult to diagnose. Wire the Function App to an Application Insights component.",
    tags: ["well-architected", "architecture-center", "functions", "observability"],
    predicate: (graph) => {
      const fns = nodesOfTypeLocal(graph, "functionApp");
      if (fns.length === 0) return [];
      const findings: Array<{ nodeIds?: string[] }> = [];
      for (const fn of fns) {
        const hasAi = graph.edges.some((e) => {
          if (e.source !== fn.id) return false;
          const tgt = graph.nodes.find((n) => n.id === e.target);
          return tgt?.type === "applicationInsights";
        });
        if (!hasAi) findings.push({ nodeIds: [fn.id] });
      }
      return findings;
    },
  }),

  // 4. PATTERN.STATIC-API-MISSING-FUNCTION — SWA without managed Function backend.
  graphRule({
    id: "PATTERN.STATIC-API-MISSING-FUNCTION",
    source: {
      ...PATTERN_BASE,
      url: "https://learn.microsoft.com/en-us/azure/static-web-apps/apis-overview",
      ruleId: "apis-overview#managed-functions",
    },
    category: "reliability",
    severity: "info",
    message:
      "Static Web App has no depends_on edge to a Function App backend.",
    longExplanation:
      "The Static Web Apps APIs overview documents the managed-Functions backend as the recommended way to add server logic to a SWA. A Static Web App without any Function App linked through a depends_on edge either has no server-side logic (which is fine for a pure marketing site) or is reaching out to an unmodelled API. Add a Function App and depends_on edge to make the API surface explicit in the design.",
    tags: ["well-architected", "architecture-center", "static-web-apps"],
    predicate: (graph) => {
      const swas = nodesOfTypeLocal(graph, "staticWebApp");
      if (swas.length === 0) return [];
      const findings: Array<{ nodeIds?: string[] }> = [];
      for (const swa of swas) {
        const hasFn = graph.edges.some((e) => {
          if (e.source !== swa.id || e.kind !== "depends_on") return false;
          const tgt = graph.nodes.find((n) => n.id === e.target);
          return tgt?.type === "functionApp";
        });
        if (!hasFn) findings.push({ nodeIds: [swa.id] });
      }
      return findings;
    },
  }),

  // 5. PATTERN.SQL-WITHOUT-PRIVATE-ENDPOINT — SQL + VNet but no PE on SQL.
  graphRule({
    id: "PATTERN.SQL-WITHOUT-PRIVATE-ENDPOINT",
    source: {
      ...PATTERN_BASE,
      url: "https://learn.microsoft.com/en-us/azure/azure-sql/database/private-endpoint-overview",
      ruleId: "private-endpoint-overview#sql",
    },
    category: "network",
    severity: "warning",
    message:
      "Azure SQL Database is present alongside a VNet but has no Private Endpoint.",
    longExplanation:
      "The Azure SQL Private Endpoint guide treats Private Link as the recommended path for any SQL workload that has a Virtual Network in scope. A graph that includes both Azure SQL and a VNet but no Private Endpoint targeting the SQL server leaves the database reachable through its public endpoint, contradicting the design intent implied by the VNet. Attach a Private Endpoint with a SQL or sqlServer groupId, or document why public access is required.",
    tags: ["well-architected", "architecture-center", "sql", "private-link"],
    predicate: (graph) => {
      const sqls = nodesOfTypeLocal(graph, "sqlDatabase");
      if (sqls.length === 0) return [];
      const hasVnet = nodesOfTypeLocal(graph, "virtualNetwork").length > 0;
      if (!hasVnet) return [];
      const findings: Array<{ nodeIds?: string[] }> = [];
      for (const sql of sqls) {
        const hasPe = graph.edges.some((e) => {
          if (e.target !== sql.id) return false;
          const src = graph.nodes.find((n) => n.id === e.source);
          return src?.type === "privateEndpoint";
        });
        if (!hasPe) findings.push({ nodeIds: [sql.id] });
      }
      return findings;
    },
  }),

  // 6. PATTERN.KEYVAULT-WITHOUT-LOGGING — KV without diagnostic edge to Log Analytics.
  graphRule({
    id: "PATTERN.KEYVAULT-WITHOUT-LOGGING",
    source: {
      ...PATTERN_BASE,
      url: "https://learn.microsoft.com/en-us/azure/key-vault/general/logging",
      ruleId: "logging#diagnostic-settings",
    },
    category: "reliability",
    severity: "warning",
    message:
      "Key Vault has no diagnostic edge to a Log Analytics workspace.",
    longExplanation:
      "The Key Vault logging guide states that AuditEvent logs (every secret, key and certificate access) are only retained when diagnostic settings forward them to a sink such as Log Analytics. A Key Vault without a diagnostic edge therefore loses the audit trail required for incident response and most compliance regimes. Add a diagnostic edge from the Key Vault to a Log Analytics workspace.",
    tags: ["well-architected", "architecture-center", "key-vault", "logging"],
    predicate: (graph) => {
      const kvs = nodesOfTypeLocal(graph, "keyVault");
      if (kvs.length === 0) return [];
      const findings: Array<{ nodeIds?: string[] }> = [];
      for (const kv of kvs) {
        const hasLa = graph.edges.some((e) => {
          if (e.source !== kv.id || e.kind !== "diagnostic") return false;
          const tgt = graph.nodes.find((n) => n.id === e.target);
          return tgt?.type === "logAnalytics";
        });
        if (!hasLa) findings.push({ nodeIds: [kv.id] });
      }
      return findings;
    },
  }),

  // 7. PATTERN.NO-MANAGED-IDENTITY — Compute -> data path with no identity edge anywhere.
  graphRule({
    id: "PATTERN.NO-MANAGED-IDENTITY",
    source: {
      ...PATTERN_BASE,
      url: "https://learn.microsoft.com/en-us/azure/active-directory/managed-identities-azure-resources/overview",
      ruleId: "managed-identities-overview#preferred-auth",
    },
    category: "reliability",
    severity: "info",
    message:
      "Compute resources access data services but the graph has no identity edge.",
    longExplanation:
      "The Managed Identities overview is explicit that managed identities are the preferred authentication path between Azure compute and Azure data services because they remove the need to handle secrets. A graph in which an App Service or Function App reaches Key Vault, Storage, SQL or Cosmos with no identity edge anywhere implies the design still relies on connection strings or shared keys. Add an identity edge (either compute -> service directly, or compute -> userAssignedIdentity -> service).",
    tags: ["well-architected", "architecture-center", "identity", "managed-identity"],
    predicate: (graph) => {
      const computeTypes = new Set<GraphNode["type"]>(["appService", "functionApp"]);
      const dataTargetTypes = new Set<GraphNode["type"]>([
        "keyVault",
        "storageAccount",
        "sqlDatabase",
        "cosmosDb",
        "containerRegistry",
      ]);
      const computeNodes = graph.nodes.filter((n) => computeTypes.has(n.type));
      if (computeNodes.length === 0) return [];
      const computeAccessesData = graph.edges.some((e) => {
        const s = graph.nodes.find((n) => n.id === e.source);
        const t = graph.nodes.find((n) => n.id === e.target);
        return (
          s !== undefined &&
          t !== undefined &&
          computeTypes.has(s.type) &&
          dataTargetTypes.has(t.type)
        );
      });
      if (!computeAccessesData) return [];
      const hasIdentityEdge = graph.edges.some((e) => e.kind === "identity");
      if (hasIdentityEdge) return [];
      return [{ nodeIds: computeNodes.map((c) => c.id) }];
    },
  }),

  // 8. PATTERN.WAF-MISSING — App Gateway present but SKU is not WAF_v2.
  nodeRule({
    id: "PATTERN.WAF-MISSING",
    source: {
      ...PATTERN_BASE,
      url: "https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/ag-overview",
      ruleId: "ag-overview#waf-sku",
    },
    category: "network",
    severity: "warning",
    serviceTypes: ["applicationGateway"],
    message:
      "Application Gateway SKU is Standard_v2; WAF_v2 is the recommended SKU for production ingress.",
    longExplanation:
      "The Web Application Firewall on Application Gateway overview makes the WAF_v2 SKU the recommended choice whenever an Application Gateway terminates internet-facing traffic, because Standard_v2 has no WAF engine and therefore no OWASP rule set or bot protection. A graph that picks Standard_v2 ships a regional L7 load balancer with no application-layer security controls in front of the workload. Switch the SKU to WAF_v2.",
    tags: ["well-architected", "architecture-center", "application-gateway", "waf"],
    predicate: (node) => {
      const sku = getProp<string>(node, "sku");
      return sku !== "WAF_v2";
    },
  }),

  // 9. PATTERN.AVAILABILITY-ZONE-MISSING — Premium SKUs in prod without zone redundancy.
  graphRule({
    id: "PATTERN.AVAILABILITY-ZONE-MISSING",
    source: {
      ...PATTERN_BASE,
      url: "https://learn.microsoft.com/en-us/azure/reliability/availability-zones-overview",
      ruleId: "availability-zones-overview#premium-zone-redundancy",
    },
    category: "reliability",
    severity: "info",
    message:
      "Premium SKUs in a prod design are not configured for zone redundancy.",
    longExplanation:
      "The Reliability availability zones overview lists App Service P*v3, Azure SQL General Purpose / Business Critical, and Cosmos DB among the services that should be deployed zone-redundant in production to survive a single-AZ failure. A graph in the prod environment that picks a premium-tier SKU but leaves zone-redundancy off pays for the higher tier without getting the AZ resilience the docs assume. Either enable zone redundancy or downgrade the SKU.",
    tags: ["well-architected", "architecture-center", "availability-zones"],
    predicate: (graph) => {
      if (graph.metadata.environment !== "prod") return [];
      const findings: Array<{ nodeIds?: string[] }> = [];
      // App Service Plan: P*v3 SKUs imply premium tier.
      for (const plan of nodesOfTypeLocal(graph, "appServicePlan")) {
        const sku = getProp<string>(plan, "sku") ?? "";
        const isPremium = /^P\d+v3$/.test(sku);
        const zoneRedundant = getProp<boolean>(plan, "zoneRedundant");
        if (isPremium && zoneRedundant !== true) findings.push({ nodeIds: [plan.id] });
      }
      // SQL Database: GP_* SKUs.
      for (const sql of nodesOfTypeLocal(graph, "sqlDatabase")) {
        const sku = getProp<string>(sql, "sku") ?? "";
        const isPremium = sku.startsWith("GP_");
        const zoneRedundant = getProp<boolean>(sql, "zoneRedundant");
        if (isPremium && zoneRedundant !== true) findings.push({ nodeIds: [sql.id] });
      }
      // Cosmos DB: any Cosmos in prod without explicit zone-redundant write region.
      for (const cos of nodesOfTypeLocal(graph, "cosmosDb")) {
        const zoneRedundant = getProp<boolean>(cos, "zoneRedundant");
        if (zoneRedundant !== true) findings.push({ nodeIds: [cos.id] });
      }
      return findings;
    },
  }),

  // 10. PATTERN.PROD-LRS — Standard_LRS storage in a prod environment.
  nodeRule({
    id: "PATTERN.PROD-LRS",
    source: {
      ...PATTERN_BASE,
      url: "https://learn.microsoft.com/en-us/azure/storage/common/storage-redundancy",
      ruleId: "storage-redundancy#prod-lrs",
    },
    category: "reliability",
    severity: "warning",
    serviceTypes: ["storageAccount"],
    message:
      "Storage Account uses Standard_LRS in a prod environment; pick ZRS, GRS or RA-GRS.",
    longExplanation:
      "The Storage redundancy guide describes Standard_LRS (locally-redundant storage) as the lowest-durability option, replicating only within one data centre, and recommends ZRS, GRS or RA-GRS for production workloads that need to survive a zonal or regional failure. A prod graph that ships Standard_LRS accepts data loss if the single data centre is impaired. Switch the SKU to Standard_ZRS, Standard_GRS or Standard_RAGRS depending on the regional vs. zonal failure budget.",
    tags: ["well-architected", "architecture-center", "storage", "redundancy"],
    predicate: (node, graph) => {
      if (graph.metadata.environment !== "prod") return false;
      const sku = getProp<string>(node, "sku");
      return sku === "Standard_LRS";
    },
  }),
];
