import { GraphDocument, GraphNode } from "@/lib/graph/schema";
import { topologicalSort } from "@/lib/generators/shared/ordering";
import { azureResourceName } from "@/lib/generators/shared/naming";

export type Severity = "error" | "warning" | "info";

export type Finding = {
  ruleId: string;
  severity: Severity;
  message: string;
  explanation: string;
  nodeIds?: string[];
  edgeIds?: string[];
  autofixId?: string;
};

export type Autofix = (graph: GraphDocument) => GraphDocument;

export type Rule = {
  id: string;
  description: string;
  evaluate: (graph: GraphDocument) => Finding[];
  autofixes?: Record<string, Autofix>;
};

function hasEdge(
  graph: GraphDocument,
  predicate: (e: GraphDocument["edges"][number]) => boolean,
): boolean {
  return graph.edges.some(predicate);
}

const e8s1: Rule = {
  id: "E8-S1",
  description: "Storage Account with public access and no Private Endpoint.",
  evaluate(graph) {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== "storageAccount") continue;
      if (node.properties.allowPublicAccess !== true) continue;
      const hasPE = hasEdge(
        graph,
        (e) =>
          e.kind === "network" &&
          e.target === node.id &&
          graph.nodes.find((n) => n.id === e.source)?.type === "privateEndpoint",
      );
      if (!hasPE) {
        findings.push({
          ruleId: "E8-S1",
          severity: "warning",
          message: `${node.name} allows public access but has no Private Endpoint.`,
          explanation:
            "Essential Eight S1: disable public network access on storage holding sensitive data, or wrap with a Private Endpoint.",
          nodeIds: [node.id],
        });
      }
    }
    return findings;
  },
};

const e8s2: Rule = {
  id: "E8-S2",
  description: "SQL Database without a Private Endpoint when a VNet exists.",
  evaluate(graph) {
    const hasVnet = graph.nodes.some((n) => n.type === "virtualNetwork");
    if (!hasVnet) return [];
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== "sqlDatabase") continue;
      const hasPE = hasEdge(
        graph,
        (e) =>
          e.kind === "network" &&
          e.target === node.id &&
          graph.nodes.find((n) => n.id === e.source)?.type === "privateEndpoint",
      );
      if (!hasPE) {
        findings.push({
          ruleId: "E8-S2",
          severity: "warning",
          message: `${node.name} should be reached only via a Private Endpoint.`,
          explanation:
            "Reaching SQL across the public internet from your VNet defeats the purpose of having a VNet. Add a Private Endpoint.",
          nodeIds: [node.id],
        });
      }
    }
    return findings;
  },
};

const ism0974: Rule = {
  id: "ISM-0974",
  description: "App Service without HTTPS-only enforced.",
  evaluate(graph) {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== "appService" && node.type !== "functionApp") continue;
      if (node.properties.httpsOnly === false) {
        findings.push({
          ruleId: "ISM-0974",
          severity: "error",
          message: `${node.name} is reachable over plain HTTP.`,
          explanation:
            "ISM-0974: web services must enforce TLS. Toggle `httpsOnly` on this resource.",
          nodeIds: [node.id],
          autofixId: "enable-https",
        });
      }
    }
    return findings;
  },
  autofixes: {
    "enable-https": (graph) => ({
      ...graph,
      nodes: graph.nodes.map((n) =>
        (n.type === "appService" || n.type === "functionApp") && n.properties.httpsOnly === false
          ? { ...n, properties: { ...n.properties, httpsOnly: true } }
          : n,
      ),
    }),
  },
};

const ism1552: Rule = {
  id: "ISM-1552",
  description: "Storage Account with TLS below 1.2.",
  evaluate(graph) {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== "storageAccount") continue;
      const tls = node.properties.minTlsVersion;
      if (tls === "1.0" || tls === "1.1") {
        findings.push({
          ruleId: "ISM-1552",
          severity: "error",
          message: `${node.name} accepts TLS ${tls}.`,
          explanation:
            "ISM-1552: storage must require TLS 1.2 or higher. Raise `minTlsVersion`.",
          nodeIds: [node.id],
          autofixId: "force-tls-12",
        });
      }
    }
    return findings;
  },
  autofixes: {
    "force-tls-12": (graph) => ({
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.type === "storageAccount"
          ? { ...n, properties: { ...n.properties, minTlsVersion: "1.2" } }
          : n,
      ),
    }),
  },
};

const gen1: Rule = {
  id: "GEN-1",
  description: "Cycle detected in dependency graph.",
  evaluate(graph) {
    const result = topologicalSort(graph);
    if (result.ok) return [];
    return [
      {
        ruleId: "GEN-1",
        severity: "error",
        message: `Dependency cycle: ${result.cycle.join(" -> ")}.`,
        explanation:
          "Resources cannot depend on each other in a cycle. Break the loop or use a diagnostic edge.",
        nodeIds: result.cycle,
      },
    ];
  },
};

const gen2: Rule = {
  id: "GEN-2",
  description: "Orphan node.",
  evaluate(graph) {
    const findings: Finding[] = [];
    const exempt = new Set<GraphNode["type"]>([
      "resourceGroup",
      "logAnalytics",
      "userAssignedIdentity",
      "containerRegistry",
    ]);
    for (const node of graph.nodes) {
      if (exempt.has(node.type)) continue;
      const connected = graph.edges.some(
        (e) => e.source === node.id || e.target === node.id,
      );
      if (!connected) {
        findings.push({
          ruleId: "GEN-2",
          severity: "info",
          message: `${node.name} is orphaned.`,
          explanation:
            "This resource has no incoming or outgoing edges. Either connect it or remove it.",
          nodeIds: [node.id],
        });
      }
    }
    return findings;
  },
};

const gen3: Rule = {
  id: "GEN-3",
  description: "Key Vault referenced without a Managed Identity edge.",
  evaluate(graph) {
    const findings: Finding[] = [];
    for (const edge of graph.edges) {
      const target = graph.nodes.find((n) => n.id === edge.target);
      if (target?.type !== "keyVault") continue;
      if (edge.kind === "identity") continue;
      if (edge.kind === "network" || edge.kind === "diagnostic") continue;
      findings.push({
        ruleId: "GEN-3",
        severity: "warning",
        message: `Edge to ${target.name} should use identity kind for Key Vault access.`,
        explanation:
          "Key Vault access should be granted via Managed Identity + RBAC. Change this edge to `identity`.",
        edgeIds: [edge.id],
      });
    }
    return findings;
  },
};

const gen4: Rule = {
  id: "GEN-4",
  description: "Function App without a Storage Account edge.",
  evaluate(graph) {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (node.type !== "functionApp") continue;
      const hasStg = graph.edges.some(
        (e) =>
          e.source === node.id &&
          e.kind === "data" &&
          graph.nodes.find((n) => n.id === e.target)?.type === "storageAccount",
      );
      if (!hasStg) {
        findings.push({
          ruleId: "GEN-4",
          severity: "warning",
          message: `${node.name} has no Storage Account.`,
          explanation:
            "Function Apps need backing storage. Bunya will auto-generate one if you let it; explicit is better.",
          nodeIds: [node.id],
          autofixId: "add-storage",
        });
      }
    }
    return findings;
  },
  autofixes: {
    "add-storage": (graph) => {
      const fn = graph.nodes.find((n) => n.type === "functionApp");
      if (!fn) return graph;
      const existing = graph.nodes.find((n) => n.type === "storageAccount");
      const stgId = existing?.id ?? `stg-${Math.random().toString(36).slice(2, 8)}`;
      const newNodes = existing
        ? graph.nodes
        : [
            ...graph.nodes,
            {
              id: stgId,
              type: "storageAccount" as const,
              name: "Function Storage",
              resourceName: azureResourceName(
                "storageAccount",
                `${graph.metadata.name}fn`,
                graph.metadata.name,
              ),
              position: { x: fn.position.x + 200, y: fn.position.y + 120 },
              properties: {
                sku: "Standard_LRS",
                kind: "StorageV2",
                allowPublicAccess: false,
                minTlsVersion: "1.2",
                hierarchicalNamespace: false,
                containers: [],
              },
            },
          ];
      const newEdges = graph.edges.find(
        (e) =>
          e.source === fn.id &&
          e.kind === "data" &&
          newNodes.find((n) => n.id === e.target)?.type === "storageAccount",
      )
        ? graph.edges
        : [
            ...graph.edges,
            {
              id: `e-${fn.id}-${stgId}`,
              source: fn.id,
              target: stgId,
              kind: "data" as const,
            },
          ];
      return { ...graph, nodes: newNodes, edges: newEdges };
    },
  },
};

const gen5: Rule = {
  id: "GEN-5",
  description: "Resources in multiple regions without explicit cross-region edge.",
  evaluate(graph) {
    const findings: Finding[] = [];
    const regionByNode = new Map<string, string>();
    for (const node of graph.nodes) {
      const region = (node.properties.region as string | undefined) ?? graph.metadata.region;
      regionByNode.set(node.id, region);
    }
    const uniqueRegions = new Set(regionByNode.values());
    if (uniqueRegions.size <= 1) return [];
    for (const edge of graph.edges) {
      const src = regionByNode.get(edge.source);
      const tgt = regionByNode.get(edge.target);
      if (src && tgt && src !== tgt && edge.kind !== "diagnostic") {
        findings.push({
          ruleId: "GEN-5",
          severity: "warning",
          message: `Edge crosses regions (${src} -> ${tgt}).`,
          explanation:
            "Cross-region edges should be marked as diagnostic or explicitly justified.",
          edgeIds: [edge.id],
        });
      }
    }
    return findings;
  },
};

function isCompliantName(type: GraphNode["type"], raw: string): boolean {
  switch (type) {
    case "storageAccount":
      return /^[a-z0-9]{3,24}$/.test(raw);
    case "keyVault":
      return /^[a-zA-Z0-9-]{3,24}$/.test(raw);
    case "containerRegistry":
      return /^[a-zA-Z0-9]{5,50}$/.test(raw);
    case "appService":
    case "functionApp":
    case "frontDoor":
    case "apiManagement":
      return /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(raw);
    default:
      return raw.length >= 1 && raw.length <= 80;
  }
}

const naming1: Rule = {
  id: "NAMING-1",
  description: "Resource name violates Azure naming rules.",
  evaluate(graph) {
    const findings: Finding[] = [];
    for (const node of graph.nodes) {
      if (!isCompliantName(node.type, node.resourceName)) {
        findings.push({
          ruleId: "NAMING-1",
          severity: "error",
          message: `${node.name} has resource name "${node.resourceName}" which violates Azure rules.`,
          explanation:
            "Each Azure resource type has length and character constraints. Update the resource name.",
          nodeIds: [node.id],
        });
      }
    }
    return findings;
  },
};

const cost1: Rule = {
  id: "COST-1",
  description: "Premium App Service Plan with no apps attached.",
  evaluate(graph) {
    const findings: Finding[] = [];
    for (const plan of graph.nodes) {
      if (plan.type !== "appServicePlan") continue;
      const sku = plan.properties.sku as string | undefined;
      if (!sku || (!sku.startsWith("P") && !sku.startsWith("S"))) continue;
      const attached = graph.edges.some(
        (e) =>
          e.target === plan.id &&
          e.kind === "depends_on" &&
          graph.nodes.find((n) => n.id === e.source)?.type !== undefined,
      );
      if (!attached) {
        findings.push({
          ruleId: "COST-1",
          severity: "info",
          message: `${plan.name} is provisioned with no compute attached.`,
          explanation:
            "A premium plan with no apps still bills hourly. Either attach a web/function app or downgrade the SKU.",
          nodeIds: [plan.id],
        });
      }
    }
    return findings;
  },
};

export const RULES: Rule[] = [
  e8s1,
  e8s2,
  ism0974,
  ism1552,
  gen1,
  gen2,
  gen3,
  gen4,
  gen5,
  naming1,
  cost1,
];
