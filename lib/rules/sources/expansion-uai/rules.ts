// User-Assigned Managed Identity rules curated from Microsoft Learn, MCSB v3,
// Azure Policy built-ins and the Australian ISM.
// Rules prefixed [advisory] document controls Bunya's property model cannot
// evaluate; their predicates never fire.
import { graphRule, nodeRule } from "@/lib/rules/builders";
import { uaiUnsupportedTargetEdges } from "@/lib/rules/graph-rules/identity";
import type { RuleEntry } from "@/lib/rules/schema";

const MS_LEARN = "Microsoft Learn";

export const EXPANSION_UAI_RULES: RuleEntry[] = [
  nodeRule({
    id: "BUNYA.NAM.UAI",
    source: {
      name: "Microsoft Learn",
      license: "CC-BY-4.0",
      version: "2026-05-19",
      url: "https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules",
      ruleId: "Microsoft.ManagedIdentity/userAssignedIdentities",
    },
    category: "naming",
    severity: "error",
    serviceTypes: ["userAssignedIdentity"],
    message:
      "User-Assigned Managed Identity name must match ^[a-zA-Z0-9_-]{3,128}$.",
    longExplanation:
      "Azure Resource Manager constrains Microsoft.ManagedIdentity/userAssignedIdentities resource names to 3-128 characters and the charset [a-zA-Z0-9_-]. Names outside this regex fail ARM validation at deployment time and break role-assignment scoping based on the principal name. Catching this at lint time keeps the failure out of the deployment pipeline.",
    tags: ["bunya", "uai", "naming", "azure-resource-manager"],
    predicate: (n) => !/^[a-zA-Z0-9_-]{3,128}$/.test(n.resourceName),
  }),

  nodeRule({
    id: "MCSB.UAI.PA-7",
    source: {
      name: "Microsoft Cloud Security Benchmark v3",
      license: "CC-BY-4.0",
      version: "v3",
      url: "https://learn.microsoft.com/en-us/security/benchmark/azure/security-controls-v3-privileged-access#pa-7-follow-just-enough-administration-least-privilege-principle",
      ruleId: "PA-7",
    },
    category: "identity",
    severity: "info",
    serviceTypes: ["userAssignedIdentity"],
    message:
      "[advisory] Prefer User-Assigned Managed Identities over service principals with client secrets (MCSB PA-7).",
    longExplanation:
      "Microsoft Cloud Security Benchmark control PA-7 (just-enough-administration / least privilege) recommends Microsoft Entra managed identities in place of service principals that hold long-lived client secrets, because managed identities have no developer-visible credential to leak or rotate. Bunya cannot tell from the graph whether a workload still authenticates with a service principal alongside the UAI, so this rule is documentation-only.",
    tags: ["bunya", "uai", "mcsb", "identity", "privileged-access"],
    predicate: () => false,
  }),

  nodeRule({
    id: "AZPOL.UAI.LOCATION-MATCH",
    source: {
      name: "Azure Policy built-ins",
      license: "MIT",
      version: "2026-04-01",
      url: "https://learn.microsoft.com/en-us/azure/governance/policy/samples/built-in-policies",
      ruleId: "Allowed locations for resource groups",
    },
    category: "sovereignty",
    severity: "info",
    serviceTypes: ["userAssignedIdentity"],
    message:
      "[advisory] User-Assigned Managed Identity region should match its resource group region.",
    longExplanation:
      "Azure Policy built-in 'Allowed locations for resource groups' restricts where resources may be deployed for data-sovereignty and latency reasons. A UAI pinned to a region outside its resource group's allowed set violates the policy at deploy time and complicates failover planning. Bunya's userAssignedIdentity schema does not expose a region property today, so this rule is advisory and surfaces the expectation in documentation only.",
    tags: ["bunya", "uai", "azure-policy", "sovereignty", "region"],
    predicate: () => false,
  }),

  nodeRule({
    id: "BUNYA.COMP.UAI-CMK",
    source: {
      name: "Microsoft Learn",
      license: "CC-BY-4.0",
      version: "2026-05-19",
      url: "https://learn.microsoft.com/en-us/azure/storage/common/customer-managed-keys-overview",
    },
    category: "compliance",
    severity: "info",
    serviceTypes: ["userAssignedIdentity"],
    message:
      "[advisory] User-Assigned Managed Identity used to wrap a customer-managed key needs Key Vault Crypto Officer rights.",
    longExplanation:
      "When a storage account, SQL database, or other Azure service is configured with customer-managed keys, the UAI that wraps the data-encryption key requires the Key Vault Crypto Officer (or Crypto Service Encryption User) role on the wrapping key. A missing role assignment causes silent CMK rotation failures and breaks ISO 27001 / FSI compliance attestations. Bunya does not model role-assignment level data, so this control is advisory.",
    tags: ["bunya", "uai", "compliance", "cmk", "key-vault"],
    predicate: () => false,
  }),

  nodeRule({
    id: "ISM.0457.UAI",
    source: {
      name: "Australian ISM",
      license: "CC-BY-4.0",
      version: "2026-03",
      url: "https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/ism",
      ruleId: "ISM-0457",
    },
    category: "compliance",
    severity: "info",
    serviceTypes: ["userAssignedIdentity"],
    message:
      "[advisory] Privileged access events for User-Assigned Managed Identities must be logged (ISM-0457).",
    longExplanation:
      "Australian ISM control 0457 requires that the use of privileged access is logged centrally so that administrative actions can be reconstructed during an incident. Managed identity sign-ins, token issuance, and role-elevated calls fall under this control and should be routed to a tenant Log Analytics workspace or SIEM via Entra ID diagnostic settings. Bunya does not model tenant-level diagnostic configuration, so this rule is advisory and documents the expectation alongside the resource.",
    tags: ["bunya", "uai", "ism", "compliance", "logging"],
    predicate: () => false,
  }),

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
    predicate: uaiUnsupportedTargetEdges,
  }),

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
