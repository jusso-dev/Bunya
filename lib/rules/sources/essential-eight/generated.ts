import { graphRule, nodeRule, nodesOfType } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";

const E8_BASE = {
  name: "Essential Eight Maturity Model",
  license: "Commonwealth of Australia copyright; reproduced with attribution",
  url: "https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/essential-eight",
  version: "ML-2023",
} as const;

export const ESSENTIAL_EIGHT_RULES: RuleEntry[] = [
  // 1. Application Control — runtime allow-listing of executables.
  nodeRule({
    id: "E8.APP-CONTROL",
    source: { ...E8_BASE, ruleId: "E8-APP-CONTROL" },
    category: "compliance",
    severity: "info",
    serviceTypes: ["appService", "functionApp"],
    message:
      "[advisory] Essential Eight: Application Control — verify allow-listing on hosts that execute organisational code.",
    longExplanation:
      "Application Control is the first Essential Eight strategy and requires that only approved executables, scripts, installers and libraries are allowed to run on workstations and servers. The control operates on runtime hosts via tools such as AppLocker or WDAC and cannot be observed from a design-time IaC graph, so it is recorded as advisory. Confirm separately that the underlying compute used by these workloads enforces an application allow-list.",
    tags: ["essential-eight", "app-control", "acsc", "advisory"],
    predicate: () => false,
  }),

  // 2. Patch Applications — runtime version is pinned (not empty / not "latest").
  nodeRule({
    id: "E8.PATCH-APPS",
    source: { ...E8_BASE, ruleId: "E8-PATCH-APPS" },
    category: "compliance",
    severity: "warning",
    serviceTypes: ["appService", "functionApp"],
    message:
      "Pin runtimeVersion to a specific supported release — Essential Eight: Patch Applications.",
    longExplanation:
      "The Patch Applications strategy requires that vulnerabilities in applications and runtimes are remediated within defined timeframes. An empty or floating value such as `latest` defers the choice of runtime to the platform at deploy time, which makes it impossible to evidence which patch level is actually running. Pinning `runtimeVersion` to a specific supported release (for example `20-lts` for Node) gives the patching process something concrete to track.",
    tags: ["essential-eight", "patch-apps", "acsc", "patching"],
    predicate: (n) => {
      const v = (n.properties as { runtimeVersion?: string }).runtimeVersion;
      if (!v) return true;
      const trimmed = v.trim().toLowerCase();
      return trimmed === "" || trimmed === "latest";
    },
  }),

  // 3. Configure Microsoft Office Macro Settings — not in scope for cloud IaC.
  nodeRule({
    id: "E8.OFFICE-MACROS",
    source: { ...E8_BASE, ruleId: "E8-OFFICE-MACROS" },
    category: "compliance",
    severity: "info",
    serviceTypes: ["resourceGroup"],
    message:
      "[advisory] Essential Eight: Configure Microsoft Office Macro Settings — not in scope for cloud IaC.",
    longExplanation:
      "The Office Macro Settings strategy governs macros executed by Microsoft Office on user endpoints. It is administered through Entra ID, Intune and Office policy on managed devices and has no representation in an Azure resource graph, so it is recorded here as advisory at the resource group scope only to keep the eight strategies discoverable in the catalogue.",
    tags: ["essential-eight", "office-macros", "acsc", "advisory"],
    predicate: () => false,
  }),

  // 4. User Application Hardening — endpoint-side, not graph-observable.
  nodeRule({
    id: "E8.USER-APP-HARDENING",
    source: { ...E8_BASE, ruleId: "E8-USER-APP-HARDENING" },
    category: "compliance",
    severity: "info",
    serviceTypes: ["resourceGroup"],
    message:
      "[advisory] Essential Eight: User Application Hardening — confirm browser, Office and PDF hardening on managed endpoints.",
    longExplanation:
      "User Application Hardening requires that browsers, Office and other commonly-targeted applications are configured to reduce attack surface (for example by disabling Flash, ads and Java in browsers). The control applies to the user endpoint fleet and is delivered via Intune / Group Policy, so it is not observable from an Azure workload graph and is recorded as advisory.",
    tags: ["essential-eight", "user-app-hardening", "acsc", "advisory"],
    predicate: () => false,
  }),

  // 5. Restrict Administrative Privileges — Key Vault must use RBAC, not legacy access policies.
  nodeRule({
    id: "E8.RESTRICT-ADMIN",
    source: { ...E8_BASE, ruleId: "E8-RESTRICT-ADMIN" },
    category: "compliance",
    severity: "warning",
    serviceTypes: ["keyVault"],
    message:
      "Key Vault is using legacy access policies — Essential Eight: Restrict Administrative Privileges expects RBAC.",
    longExplanation:
      "Restrict Administrative Privileges requires that administrative access is granted only where needed and is regularly validated. Legacy Key Vault access policies grant broad permission sets that are not visible to Entra ID privileged access tooling, whereas RBAC authorisation surfaces vault access through standard role assignments and access reviews. Enable `rbacAuthorization` so admin grants flow through Entra RBAC.",
    tags: ["essential-eight", "restrict-admin", "acsc", "rbac", "key-vault"],
    predicate: (n) => {
      const rbac = (n.properties as { rbacAuthorization?: boolean }).rbacAuthorization;
      return rbac === false;
    },
  }),

  // 6. Patch Operating Systems — App Service Plan SKU not on a v3 generation.
  nodeRule({
    id: "E8.PATCH-OS",
    source: { ...E8_BASE, ruleId: "E8-PATCH-OS" },
    category: "compliance",
    severity: "warning",
    serviceTypes: ["appServicePlan"],
    message:
      "App Service Plan is on a pre-v3 SKU — Essential Eight: Patch Operating Systems prefers the current generation.",
    longExplanation:
      "Patch Operating Systems requires that the OS underlying workloads is kept on a current, vendor-supported release. For App Service the operating system generation tracks the plan SKU, and the older B1 / B2 / S1 SKUs run on the previous footprint. Moving to a `*v3` SKU (P1v3, P2v3) places the workload on the current generation, which is the version targeted by Microsoft's ongoing patch stream.",
    tags: ["essential-eight", "patch-os", "acsc", "app-service-plan"],
    predicate: (n) => {
      const sku = (n.properties as { sku?: string }).sku;
      if (!sku) return false;
      return !sku.toLowerCase().includes("v3");
    },
  }),

  // 7. Multi-factor Authentication — Entra-side, not graph-observable.
  nodeRule({
    id: "E8.MFA",
    source: { ...E8_BASE, ruleId: "E8-MFA" },
    category: "compliance",
    severity: "info",
    serviceTypes: ["resourceGroup"],
    message:
      "[advisory] Essential Eight: Multi-factor Authentication — enforce via Entra Conditional Access for all admin and user sign-ins.",
    longExplanation:
      "The Multi-factor Authentication strategy requires MFA for users of the organisation's systems, with stricter requirements at higher maturity levels (including phishing-resistant factors). MFA is enforced in Entra ID via Conditional Access policies and is not visible from the Azure resource graph, so this strategy is recorded as advisory.",
    tags: ["essential-eight", "mfa", "acsc", "advisory"],
    predicate: () => false,
  }),

  // 8. Regular Backups — flag LRS storage in prod environments.
  graphRule({
    id: "E8.BACKUPS",
    source: { ...E8_BASE, ruleId: "E8-BACKUPS" },
    category: "compliance",
    severity: "warning",
    message:
      "Production Storage Account uses Standard_LRS — single-region replication, no DR (Essential Eight: Regular Backups).",
    longExplanation:
      "Regular Backups requires that backups of important data are performed and retained, and that they remain recoverable after a destructive event. A `Standard_LRS` storage account keeps three copies in a single datacentre, which provides no protection against a region-level outage. In `prod` environments at least `Standard_ZRS` (zone-redundant) or `Standard_GRS` (geo-redundant) is appropriate so backups survive infrastructure loss.",
    tags: ["essential-eight", "backups", "acsc", "storage", "dr"],
    predicate: (graph) => {
      if (graph.metadata.environment !== "prod") return [];
      const storages = nodesOfType(graph, "storageAccount");
      const findings: Array<{ nodeIds?: string[]; message?: string }> = [];
      for (const s of storages) {
        const sku = (s.properties as { sku?: string }).sku;
        if (sku === "Standard_LRS") {
          findings.push({
            nodeIds: [s.id],
            message: `Storage Account '${s.name}' is Standard_LRS in a prod environment — use Standard_ZRS or Standard_GRS.`,
          });
        }
      }
      return findings;
    },
  }),
];
