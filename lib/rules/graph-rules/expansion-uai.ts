// Graph-level User-Assigned Managed Identity rule expansion. Each entry is a
// cross-node `graphRule` that inspects identity edges between UAI nodes and
// other resources in the design. Upstream citations are pinned per-rule and
// every entry tags `bunya` + `uai` so the rules are discoverable in the UI.

import { graphRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";

const MS_LEARN = "Microsoft Learn";

// Resource types that do NOT honour managed identity authentication. Identity
// edges pointing at any of these are non-functional: deployment succeeds but
// no role assignment can be issued and the relationship silently no-ops.
const UNSUPPORTED_TARGETS = new Set<string>([
  "logAnalytics",
  "virtualNetwork",
  "subnet",
  "networkSecurityGroup",
  "resourceGroup",
  "applicationInsights",
]);

export const expansionUaiRules: RuleEntry[] = [
  // 1. BUNYA.IDN.UAI-UNSUPPORTED-TARGET — UAI -> unsupported resource type
  graphRule({
    id: "BUNYA.IDN.UAI-UNSUPPORTED-TARGET",
    source: {
      name: MS_LEARN,
      license: "CC-BY-4.0",
      version: "2026-05-19",
      url: "https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/services-id-authentication-support",
    },
    category: "identity",
    severity: "warning",
    message:
      "User-Assigned Managed Identity targets a resource type that does not honour managed identity authentication.",
    longExplanation:
      "Microsoft Entra publishes a fixed list of Azure services that accept managed identity tokens. Pointing a UAI at a network primitive (VNet, subnet, NSG), a logging endpoint (Log Analytics, Application Insights), or a resource-group scope produces no role assignment at deploy time and the relationship silently no-ops. Reattach the identity to a service that supports MI auth (Key Vault, Storage, SQL, Cosmos DB, ACR) or remove the edge entirely.",
    tags: ["bunya", "uai", "identity", "wiring", "managed-identity"],
    predicate: (graph) => {
      const partials: { nodeIds?: string[]; edgeIds?: string[] }[] = [];
      for (const edge of graph.edges) {
        if (edge.kind !== "identity") continue;
        const source = graph.nodes.find((n) => n.id === edge.source);
        const target = graph.nodes.find((n) => n.id === edge.target);
        if (!source || !target) continue;
        if (source.type !== "userAssignedIdentity") continue;
        if (UNSUPPORTED_TARGETS.has(target.type)) {
          partials.push({ edgeIds: [edge.id], nodeIds: [source.id, target.id] });
        }
      }
      return partials;
    },
  }),

  // 2. BUNYA.IDN.UAI-DUPLICATE-EDGE — Duplicate identity edges to same target
  graphRule({
    id: "BUNYA.IDN.UAI-DUPLICATE-EDGE",
    source: {
      name: MS_LEARN,
      license: "CC-BY-4.0",
      version: "2026-05-19",
      url: "https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments",
    },
    category: "identity",
    severity: "info",
    message:
      "User-Assigned Managed Identity has more than one identity edge to the same target.",
    longExplanation:
      "Azure RBAC treats role assignments as unique tuples of (principal, role, scope). Modelling more than one identity edge from a single UAI to the same target resource implies duplicate role assignments and produces noisy IaC, redundant audit entries, and confusing access reviews. Collapse the duplicates into a single edge (and, if multiple roles are required, model that through annotation rather than edge multiplicity).",
    tags: ["bunya", "uai", "identity", "rbac", "duplicate"],
    predicate: (graph) => {
      const partials: { nodeIds?: string[]; edgeIds?: string[] }[] = [];
      const groups = new Map<string, string[]>();
      for (const edge of graph.edges) {
        if (edge.kind !== "identity") continue;
        const source = graph.nodes.find((n) => n.id === edge.source);
        if (!source || source.type !== "userAssignedIdentity") continue;
        const key = `${edge.source}->${edge.target}`;
        const bucket = groups.get(key) ?? [];
        bucket.push(edge.id);
        groups.set(key, bucket);
      }
      for (const [key, edgeIds] of groups) {
        if (edgeIds.length <= 1) continue;
        const [sourceId, targetId] = key.split("->");
        partials.push({ edgeIds, nodeIds: [sourceId, targetId] });
      }
      return partials;
    },
  }),

  // 3. BUNYA.IDN.UAI-NO-COMPUTE-USING — UAI not attached by any compute resource
  graphRule({
    id: "BUNYA.IDN.UAI-NO-COMPUTE-USING",
    source: {
      name: MS_LEARN,
      license: "CC-BY-4.0",
      version: "2026-05-19",
      url: "https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/managed-identity-best-practice-recommendations",
    },
    category: "identity",
    severity: "info",
    message:
      "User-Assigned Managed Identity has no compute resource (App Service / Function App) attaching it.",
    longExplanation:
      "A user-assigned managed identity only delivers value when a compute resource attaches it so the workload can mint Entra ID tokens at runtime. Microsoft Entra documentation recommends deleting unused UAIs to keep the principal inventory clean and reduce the role-assignment review surface. This rule detects UAIs with zero incoming identity edges from `appService` or `functionApp` nodes; either attach the identity to compute or remove it from the design.",
    tags: ["bunya", "uai", "identity", "orphan", "best-practice"],
    predicate: (graph) => {
      const partials: { nodeIds?: string[] }[] = [];
      const uais = graph.nodes.filter((n) => n.type === "userAssignedIdentity");
      for (const uai of uais) {
        const hasComputeAttachment = graph.edges.some((edge) => {
          if (edge.kind !== "identity") return false;
          if (edge.target !== uai.id) return false;
          const source = graph.nodes.find((n) => n.id === edge.source);
          return source?.type === "appService" || source?.type === "functionApp";
        });
        if (!hasComputeAttachment) {
          partials.push({ nodeIds: [uai.id] });
        }
      }
      return partials;
    },
  }),
];
