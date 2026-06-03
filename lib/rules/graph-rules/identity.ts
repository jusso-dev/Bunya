import { graphRule } from "@/lib/rules/builders";
import type { Autofix, RuleEntry } from "@/lib/rules/schema";

const MS_LEARN = "Microsoft Learn";

export const identityRules: RuleEntry[] = [
  // BUNYA.IDN.001 — Edge to Key Vault must be an identity edge (or diagnostic)
  graphRule({
    id: "BUNYA.IDN.001",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide",
      license: "CC-BY-4.0",
    },
    category: "identity",
    severity: "warning",
    message:
      "Edge to Key Vault should be modelled as an identity (RBAC) relationship.",
    longExplanation:
      "Access to Key Vault is mediated by Azure RBAC role assignments on the caller's managed identity. Modelling a Key Vault dependency as a generic 'data' or 'depends_on' edge hides that requirement and makes downstream IaC generation and identity audits unreliable. Use an identity edge for runtime access, keeping diagnostic edges only for the Key Vault -> Log Analytics relationship.",
    tags: ["bunya", "key-vault", "rbac", "managed-identity"],
    predicate: (graph) => {
      const findings: Array<{ nodeIds?: string[]; edgeIds?: string[] }> = [];
      for (const e of graph.edges) {
        const tgt = graph.nodes.find((n) => n.id === e.target);
        if (!tgt || tgt.type !== "keyVault") continue;
        if (e.kind === "identity" || e.kind === "diagnostic") continue;
        findings.push({ edgeIds: [e.id], nodeIds: [e.source, e.target] });
      }
      return findings;
    },
  }),

  // BUNYA.IDN.002 — Orphan User-Assigned Managed Identity
  graphRule({
    id: "BUNYA.IDN.002",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/well-architected/cost/principles",
      license: "CC-BY-4.0",
    },
    category: "identity",
    severity: "info",
    message:
      "User-Assigned Managed Identity is not referenced by any compute resource.",
    longExplanation:
      "A user-assigned managed identity only delivers value when it is attached to compute (App Service, Function App, container) so that workloads can authenticate to downstream Azure services. An identity with no outgoing references is dead-weight in the IaC and clutters the RBAC surface area. Either attach it to a compute resource or delete it from the design.",
    tags: ["bunya", "managed-identity", "orphan", "cost"],
    predicate: (graph) => {
      const findings: Array<{ nodeIds?: string[] }> = [];
      const umis = graph.nodes.filter((n) => n.type === "userAssignedIdentity");
      for (const umi of umis) {
        const hasOutgoingIdentity = graph.edges.some(
          (e) => e.source === umi.id && e.kind === "identity",
        );
        if (!hasOutgoingIdentity) {
          findings.push({ nodeIds: [umi.id] });
        }
      }
      return findings;
    },
  }),

  // BUNYA.IDN.003 — App/Function -> Key Vault must be identity edge
  graphRule({
    id: "BUNYA.IDN.003",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references",
      license: "CC-BY-4.0",
    },
    category: "identity",
    severity: "error",
    message:
      "App Service / Function App connects to Key Vault via a data edge; should be identity.",
    longExplanation:
      "App Service Key Vault references resolve at runtime using the site's managed identity and an RBAC role assignment, not via a data plane connection string. Modelling the edge as 'data' produces incorrect IaC (missing role assignments) and misleads RBAC reviews. The relationship is an identity edge and should be flipped accordingly.",
    tags: ["bunya", "key-vault", "managed-identity", "app-service"],
    autofixes: {
      "flip-edge-to-identity": ((graph, finding) => {
        const edgeIds = new Set(finding.edgeIds ?? []);
        if (edgeIds.size === 0) return graph;
        return {
          ...graph,
          edges: graph.edges.map((e) =>
            edgeIds.has(e.id) ? { ...e, kind: "identity" as const } : e,
          ),
        };
      }) satisfies Autofix,
    },
    predicate: (graph) => {
      const findings: Array<{ nodeIds?: string[]; edgeIds?: string[]; autofixId?: string }> = [];
      for (const e of graph.edges) {
        if (e.kind !== "data") continue;
        const src = graph.nodes.find((n) => n.id === e.source);
        const tgt = graph.nodes.find((n) => n.id === e.target);
        if (!src || !tgt) continue;
        if (tgt.type !== "keyVault") continue;
        if (src.type !== "appService" && src.type !== "functionApp") continue;
        findings.push({
          edgeIds: [e.id],
          nodeIds: [src.id, tgt.id],
          autofixId: "flip-edge-to-identity",
        });
      }
      return findings;
    },
  }),

  // BUNYA.IDN.004 — UMI pointing at a service that does not honour MI
  graphRule({
    id: "BUNYA.IDN.004",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/services-id-authentication-support",
      license: "CC-BY-4.0",
    },
    category: "identity",
    severity: "warning",
    message:
      "User-Assigned Managed Identity targets a resource type that does not authenticate with managed identities.",
    longExplanation:
      "Only a defined list of Azure resource types accept Entra ID tokens issued to a managed identity (storage, Key Vault, SQL, Cosmos DB, ACR, and so on). Pointing a UMI at a network resource such as a VNet, subnet, NSG, or at a Log Analytics workspace produces a meaningless role assignment that will never be exercised at runtime. Reattach the identity to a service that actually supports MI auth.",
    tags: ["bunya", "managed-identity", "rbac", "compatibility"],
    predicate: (graph) => {
      const unsupported = new Set([
        "logAnalytics",
        "virtualNetwork",
        "subnet",
        "networkSecurityGroup",
      ]);
      const findings: Array<{ nodeIds?: string[]; edgeIds?: string[] }> = [];
      for (const e of graph.edges) {
        if (e.kind !== "identity") continue;
        const src = graph.nodes.find((n) => n.id === e.source);
        const tgt = graph.nodes.find((n) => n.id === e.target);
        if (!src || !tgt) continue;
        if (src.type !== "userAssignedIdentity") continue;
        if (!unsupported.has(tgt.type)) continue;
        findings.push({ edgeIds: [e.id], nodeIds: [src.id, tgt.id] });
      }
      return findings;
    },
  }),

  // BUNYA.IDN.005 — ACR pulled by compute without an MI edge
  graphRule({
    id: "BUNYA.IDN.005",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/container-registry/container-registry-authentication-managed-identity",
      license: "CC-BY-4.0",
    },
    category: "identity",
    severity: "warning",
    message:
      "Container Registry is consumed by App Service or Function App without a managed-identity edge.",
    longExplanation:
      "Compute that pulls images from a private Container Registry should authenticate using its managed identity with the AcrPull role. Falling back to the registry's admin user violates CKV_AZURE_137 and bakes a long-lived shared credential into the workload. Model the relationship as an identity edge so the generated IaC creates the AcrPull role assignment.",
    tags: ["bunya", "acr", "managed-identity", "ckv-azure-137"],
    predicate: (graph) => {
      const findings: Array<{ nodeIds?: string[]; edgeIds?: string[] }> = [];
      for (const e of graph.edges) {
        const src = graph.nodes.find((n) => n.id === e.source);
        const tgt = graph.nodes.find((n) => n.id === e.target);
        if (!src || !tgt) continue;
        if (tgt.type !== "containerRegistry") continue;
        if (src.type !== "appService" && src.type !== "functionApp") continue;
        if (e.kind === "identity") continue;
        findings.push({ edgeIds: [e.id], nodeIds: [src.id, tgt.id] });
      }
      return findings;
    },
  }),

  graphRule({
    id: "BUNYA.IDN.006",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments",
      license: "CC-BY-4.0",
    },
    category: "identity",
    severity: "info",
    message: "Identity edge should have an explicit Role Assignment node or generated RBAC binding.",
    longExplanation:
      "A managed identity relationship is not complete until Azure RBAC grants the principal a role at the target scope. Bunya's ARM generator expands direct identity edges into roleAssignments, but explicit Role Assignment nodes make the role name and target scope reviewable in the diagram. Add a Role Assignment node between the principal and target for production designs or confirm the generated binding is acceptable.",
    tags: ["bunya", "rbac", "role-assignment", "managed-identity"],
    predicate: (graph) => {
      const findings: Array<{ nodeIds?: string[]; edgeIds?: string[] }> = [];
      for (const edge of graph.edges) {
        if (edge.kind !== "identity") continue;
        const source = graph.nodes.find((n) => n.id === edge.source);
        const target = graph.nodes.find((n) => n.id === edge.target);
        if (!source || !target) continue;
        if (source.type === "roleAssignment" || target.type === "roleAssignment") continue;
        const assignment = graph.nodes.find((node) => {
          if (node.type !== "roleAssignment") return false;
          const hasPrincipal = graph.edges.some(
            (e) => e.kind === "identity" && e.source === source.id && e.target === node.id,
          );
          const hasScope = graph.edges.some(
            (e) => e.kind === "identity" && e.source === node.id && e.target === target.id,
          );
          return hasPrincipal && hasScope;
        });
        if (!assignment) findings.push({ edgeIds: [edge.id], nodeIds: [source.id, target.id] });
      }
      return findings;
    },
  }),
];
