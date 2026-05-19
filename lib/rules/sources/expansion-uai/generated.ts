// Curated User-Assigned Managed Identity rule expansion, re-encoded for Bunya.
// Upstream sources cited per-rule (Microsoft Learn, Microsoft Cloud Security
// Benchmark v3, Azure Policy built-ins, Australian ISM). Each entry pins the
// canonical doc URL on `source.url` and, where applicable, the upstream
// `ruleId`. Advisory rules whose check cannot run against Bunya's property
// model (UAI only exposes `notes`) are marked [advisory] and use
// `predicate: () => false`.

import { nodeRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";

export const EXPANSION_UAI_RULES: RuleEntry[] = [
  // 1. BUNYA.NAM.UAI — Resource name must match the ARM charset/length pattern
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

  // 2. MCSB.UAI.PA-7 — Prefer managed identities over service principals (advisory)
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

  // 3. AZPOL.UAI.LOCATION-MATCH — UAI region should match the resource group (advisory)
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

  // 4. BUNYA.COMP.UAI-CMK — UAI used to wrap CMK needs Crypto Officer (advisory)
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

  // 5. ISM.0457.UAI — Privileged access logging covers managed identity activity (advisory)
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
];
