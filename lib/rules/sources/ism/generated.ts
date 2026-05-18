import { graphRule, nodeRule, nodesOfType } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";

const ISM_BASE = {
  name: "Australian Government Information Security Manual",
  license: "Commonwealth of Australia copyright; reproduced with attribution",
  url: "https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/ism",
  version: "ISM-March-2024",
} as const;

const DEFAULT_SQL_ADMINS = new Set(["sa", "admin", "sqladmin", "bunyaadmin"]);

export const ISM_RULES: RuleEntry[] = [
  // 1. ISM-0974 — Authentication occurs over an encrypted channel.
  nodeRule({
    id: "ISM.0974",
    source: { ...ISM_BASE, ruleId: "ISM-0974" },
    category: "compliance",
    severity: "error",
    serviceTypes: ["appService", "functionApp", "staticWebApp"],
    message: "Web service must enforce HTTPS-only (ISM-0974).",
    longExplanation:
      "Control ISM-0974 directs that authentication takes place over an authenticated and encrypted channel. For Azure App Service, Function App and Static Web App this maps directly to the `httpsOnly` toggle, which redirects plain HTTP traffic at the platform layer and prevents credentials being submitted over an unencrypted connection.",
    tags: ["ism", "ism-0974", "acsc", "encryption-in-transit"],
    predicate: (n) => {
      const props = n.properties as { httpsOnly?: boolean };
      if (n.type === "staticWebApp") return props.httpsOnly === false;
      return props.httpsOnly !== true;
    },
  }),

  // 2. ISM-1552 — Only TLS 1.2 or higher is used.
  nodeRule({
    id: "ISM.1552",
    source: { ...ISM_BASE, ruleId: "ISM-1552" },
    category: "compliance",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message: "Storage Account must require TLS 1.2 or higher (ISM-1552).",
    longExplanation:
      "Control ISM-1552 requires that only TLS 1.2 or later is used to protect communications. Azure Storage accounts will accept legacy TLS 1.0 and 1.1 clients unless `minTlsVersion` is explicitly pinned to `1.2`, so the platform default is not sufficient to meet this control.",
    tags: ["ism", "ism-1552", "acsc", "tls", "storage"],
    predicate: (n) => {
      const v = (n.properties as { minTlsVersion?: string }).minTlsVersion;
      return v !== "1.2";
    },
  }),

  // 3. ISM-1525 — Only ASD-approved cryptographic algorithms are used.
  nodeRule({
    id: "ISM.1525",
    source: { ...ISM_BASE, ruleId: "ISM-1525" },
    category: "compliance",
    severity: "info",
    serviceTypes: ["keyVault", "storageAccount", "sqlDatabase"],
    message:
      "[advisory] ISM-1525 requires use of ASD-approved cryptographic algorithms — verify key types and curves out-of-band.",
    longExplanation:
      "Control ISM-1525 restricts cryptographic algorithms to those approved by ASD (AACPs). Bunya cannot inspect the specific algorithm, key length or elliptic curve chosen for keys, secrets and certificates issued at deployment time, so this control is surfaced as advisory and must be confirmed by reviewing the Key Vault key generation policy and any customer-managed keys in use.",
    tags: ["ism", "ism-1525", "acsc", "cryptography", "advisory"],
    predicate: () => false,
  }),

  // 4. ISM-1480 — Multi-factor authentication for privileged users.
  nodeRule({
    id: "ISM.1480",
    source: { ...ISM_BASE, ruleId: "ISM-1480" },
    category: "compliance",
    severity: "info",
    serviceTypes: ["keyVault", "sqlDatabase", "containerRegistry"],
    message:
      "[advisory] ISM-1480 requires multi-factor authentication for privileged users accessing this resource.",
    longExplanation:
      "Control ISM-1480 requires that privileged users authenticate with multi-factor authentication. MFA enforcement happens in Entra ID via Conditional Access policies and cannot be verified from an IaC graph, so this control is recorded as advisory. Confirm that named admin accounts and any break-glass identities used to manage Key Vault, SQL and ACR are covered by a Conditional Access policy that requires MFA.",
    tags: ["ism", "ism-1480", "acsc", "mfa", "privileged-access", "advisory"],
    predicate: () => false,
  }),

  // 5. ISM-0405 — Systems are patched promptly (runtime freshness).
  nodeRule({
    id: "ISM.0405",
    source: { ...ISM_BASE, ruleId: "ISM-0405" },
    category: "compliance",
    severity: "warning",
    serviceTypes: ["appService", "functionApp"],
    message:
      "Runtime version is not pinned — ISM-0405 expects a known, supported runtime so patch status can be reasoned about.",
    longExplanation:
      "Control ISM-0405 requires that systems are patched within defined timeframes. App Service and Function App rely on the platform-supplied runtime stack, so the auditable equivalent is that the deployment declares a specific, supported `runtimeVersion`. An empty or unset value defers the choice to whatever the platform decides at deploy time, which makes it impossible to evidence that the running version is within the supported window.",
    tags: ["ism", "ism-0405", "acsc", "patching"],
    predicate: (n) => {
      const v = (n.properties as { runtimeVersion?: string }).runtimeVersion;
      return !v || v.trim() === "";
    },
  }),

  // 6. ISM-1418 — Database firewall is configured (look for a private endpoint).
  graphRule({
    id: "ISM.1418",
    source: { ...ISM_BASE, ruleId: "ISM-1418" },
    category: "compliance",
    severity: "warning",
    message:
      "SQL Database has no private endpoint — ISM-1418 expects a network firewall in front of database access.",
    longExplanation:
      "Control ISM-1418 directs that database firewalls are configured so that only authorised hosts can connect. The cloud-native equivalent in Azure is to front Azure SQL with a private endpoint (and disable public network access). Without a private endpoint in the graph the database is reachable from the public SQL gateway, which does not meet the intent of the control.",
    tags: ["ism", "ism-1418", "acsc", "network", "database"],
    predicate: (graph) => {
      const sqls = nodesOfType(graph, "sqlDatabase");
      if (sqls.length === 0) return [];
      const findings: Array<{ nodeIds?: string[]; message?: string }> = [];
      for (const sql of sqls) {
        const hasPe = graph.edges.some((e) => {
          if (e.target !== sql.id) return false;
          const src = graph.nodes.find((n) => n.id === e.source);
          return src?.type === "privateEndpoint";
        });
        if (!hasPe) {
          findings.push({
            nodeIds: [sql.id],
            message: `Add a privateEndpoint targeting SQL Database '${sql.name}'.`,
          });
        }
      }
      return findings;
    },
  }),

  // 7. ISM-1546 — TLS or IPSec is used to protect data in transit.
  nodeRule({
    id: "ISM.1546",
    source: { ...ISM_BASE, ruleId: "ISM-1546" },
    category: "compliance",
    severity: "warning",
    serviceTypes: ["storageAccount"],
    message:
      "Storage Account does not enforce TLS 1.2 — ISM-1546 expects TLS or IPSec for data in transit.",
    longExplanation:
      "Control ISM-1546 directs that data in transit between systems is protected with TLS or IPSec. For Azure Storage the practical check is that `minTlsVersion` is set to `1.2` so that legacy clients cannot negotiate down to TLS 1.0 or 1.1. This is the lower-severity sibling of ISM-1552 and surfaces the same property from a different angle.",
    tags: ["ism", "ism-1546", "acsc", "tls", "data-in-transit"],
    predicate: (n) => {
      const v = (n.properties as { minTlsVersion?: string }).minTlsVersion;
      return v === "1.0" || v === "1.1";
    },
  }),

  // 8. ISM-1233 — System logs are securely stored centrally.
  graphRule({
    id: "ISM.1233",
    source: { ...ISM_BASE, ruleId: "ISM-1233" },
    category: "compliance",
    severity: "warning",
    message:
      "No Log Analytics workspace defined — ISM-1233 requires logs to be centrally and securely stored.",
    longExplanation:
      "Control ISM-1233 directs that event logs are retained centrally and protected from unauthorised modification. In Azure this is realised by sending diagnostic settings into a Log Analytics workspace (often combined with Sentinel for SIEM). A graph that contains workloads but no workspace has no sink for these logs and therefore cannot demonstrate the control.",
    tags: ["ism", "ism-1233", "acsc", "logging"],
    predicate: (graph) => {
      const workspaces = nodesOfType(graph, "logAnalytics");
      if (workspaces.length > 0) return [];
      return [
        {
          message:
            "Add a Log Analytics workspace and wire diagnostic settings from each resource into it.",
        },
      ];
    },
  }),

  // 9. ISM-0859 — Logs are centrally stored (diagnostic emitters need a sink).
  graphRule({
    id: "ISM.0859",
    source: { ...ISM_BASE, ruleId: "ISM-0859" },
    category: "compliance",
    severity: "warning",
    message:
      "Diagnostic-capable resources are present but no Log Analytics workspace receives them (ISM-0859).",
    longExplanation:
      "Control ISM-0859 requires that event logs from systems are forwarded to a central log repository. Most Azure workloads (App Service, Function App, Storage, SQL, Cosmos, Key Vault, ACR, Application Gateway, Front Door, API Management) can emit diagnostic settings but only when a Log Analytics workspace exists to receive them. This rule flags graphs that contain such emitters without a workspace target.",
    tags: ["ism", "ism-0859", "acsc", "logging", "diagnostics"],
    predicate: (graph) => {
      const workspaces = nodesOfType(graph, "logAnalytics");
      if (workspaces.length > 0) return [];
      const emitterTypes: ReadonlyArray<string> = [
        "appService",
        "functionApp",
        "storageAccount",
        "sqlDatabase",
        "cosmosDb",
        "keyVault",
        "containerRegistry",
        "applicationGateway",
        "frontDoor",
        "apiManagement",
      ];
      const emitters = graph.nodes.filter((n) => emitterTypes.includes(n.type));
      if (emitters.length === 0) return [];
      return [
        {
          nodeIds: emitters.map((n) => n.id),
          message:
            "Resources capable of emitting diagnostics exist but there is no Log Analytics workspace to receive them.",
        },
      ];
    },
  }),

  // 10. ISM-1175 — Web application input validation.
  nodeRule({
    id: "ISM.1175",
    source: { ...ISM_BASE, ruleId: "ISM-1175" },
    category: "compliance",
    severity: "info",
    serviceTypes: ["appService", "functionApp", "staticWebApp", "apiManagement"],
    message:
      "[advisory] ISM-1175 expects input validation in web applications — verify in application code or via WAF policy.",
    longExplanation:
      "Control ISM-1175 requires that web applications validate input from untrusted sources. This is implemented inside the application or, defensively, with a WAF (Application Gateway WAF_v2 or Front Door Premium). Bunya cannot inspect application code, so this is recorded as advisory; verify validation behaviour during the application security review.",
    tags: ["ism", "ism-1175", "acsc", "appsec", "advisory"],
    predicate: () => false,
  }),

  // 11. ISM-0457 — Privileged access events are logged.
  nodeRule({
    id: "ISM.0457",
    source: { ...ISM_BASE, ruleId: "ISM-0457" },
    category: "compliance",
    severity: "info",
    serviceTypes: ["keyVault", "sqlDatabase", "storageAccount"],
    message:
      "[advisory] ISM-0457 requires privileged access events to be logged — confirm AuditEvent / SQL audit / Storage diagnostic settings are enabled.",
    longExplanation:
      "Control ISM-0457 directs that events involving privileged access are recorded. For Key Vault this is the `AuditEvent` diagnostic category, for Azure SQL it is the SQL audit log, and for Storage it is the per-API diagnostic settings. These are configured via diagnostic settings rather than top-level properties, so the control is surfaced as advisory until the project explicitly wires the relevant categories to Log Analytics.",
    tags: ["ism", "ism-0457", "acsc", "logging", "privileged-access", "advisory"],
    predicate: () => false,
  }),

  // 12. ISM-1537 — Privileged access is periodically reviewed.
  nodeRule({
    id: "ISM.1537",
    source: { ...ISM_BASE, ruleId: "ISM-1537" },
    category: "compliance",
    severity: "info",
    serviceTypes: ["keyVault", "userAssignedIdentity"],
    message:
      "[advisory] ISM-1537 requires periodic review of privileged access — operate Entra access reviews on RBAC assignments.",
    longExplanation:
      "Control ISM-1537 requires that privileged access rights are reviewed on a defined cadence to confirm continued need. The control is implemented via Entra ID access reviews against the RBAC role assignments granting access to Key Vault and to user-assigned managed identities, so it cannot be detected from the resource graph and is recorded as advisory.",
    tags: ["ism", "ism-1537", "acsc", "privileged-access", "advisory"],
    predicate: () => false,
  }),

  // 13. ISM-1297 — Strong passwords / non-default admin identifiers.
  nodeRule({
    id: "ISM.1297",
    source: { ...ISM_BASE, ruleId: "ISM-1297" },
    category: "compliance",
    severity: "warning",
    serviceTypes: ["sqlDatabase"],
    message:
      "SQL Database adminLogin is a default-style value (sa/admin/sqladmin/bunyaadmin) — choose a non-guessable account name (ISM-1297).",
    longExplanation:
      "Control ISM-1297 covers protection of privileged credentials, including making them resistant to brute-force and credential-stuffing. Default-style admin names such as `sa`, `admin`, `sqladmin` or the scaffolded `bunyaadmin` are the first values attackers will try against an Azure SQL public endpoint, so the administrator login should be set to a workload-specific value.",
    tags: ["ism", "ism-1297", "acsc", "sql", "privileged-access"],
    predicate: (n) => {
      const login = (n.properties as { adminLogin?: string }).adminLogin;
      if (!login) return false;
      return DEFAULT_SQL_ADMINS.has(login.toLowerCase());
    },
  }),

  // 14. ISM-0140 — Cyber security incidents are reported.
  nodeRule({
    id: "ISM.0140",
    source: { ...ISM_BASE, ruleId: "ISM-0140" },
    category: "compliance",
    severity: "info",
    serviceTypes: ["resourceGroup"],
    message:
      "[advisory] ISM-0140 requires cyber security incidents to be reported to ASD/ACSC — confirm the incident response process covers this workload.",
    longExplanation:
      "Control ISM-0140 directs that cyber security incidents are reported to the Australian Signals Directorate. This is an operational and governance control rather than an IaC property, so it is surfaced as advisory on the resource group representing the workload boundary. Confirm that the supporting incident response plan and contact register cover the resources defined in this graph.",
    tags: ["ism", "ism-0140", "acsc", "incident-response", "advisory"],
    predicate: () => false,
  }),

  // 15. ISM-1241 — Web content filtering.
  nodeRule({
    id: "ISM.1241",
    source: { ...ISM_BASE, ruleId: "ISM-1241" },
    category: "compliance",
    severity: "info",
    serviceTypes: ["frontDoor", "applicationGateway", "apiManagement"],
    message:
      "[advisory] ISM-1241 expects web content filtering — verify WAF / policy rules on the perimeter service.",
    longExplanation:
      "Control ISM-1241 requires filtering of web content traversing perimeter services. In Azure this is implemented by the WAF profile attached to Front Door Premium or Application Gateway WAF_v2, or by request/response policy on API Management. Bunya cannot inspect the configured WAF ruleset from the property model, so this control is recorded as advisory and must be confirmed against the WAF policy attached at deploy time.",
    tags: ["ism", "ism-1241", "acsc", "web-filtering", "advisory"],
    predicate: () => false,
  }),

  // 16. ISM-1622 — Secure ICT environments.
  nodeRule({
    id: "ISM.1622",
    source: { ...ISM_BASE, ruleId: "ISM-1622" },
    category: "compliance",
    severity: "info",
    serviceTypes: ["resourceGroup"],
    message:
      "[advisory] ISM-1622 expects ICT environments to be hardened — operate baseline policy (Defender for Cloud, Azure Policy, Sentinel).",
    longExplanation:
      "Control ISM-1622 calls for ICT environments to be configured securely against an authoritative baseline. In Azure this is realised by enabling Microsoft Defender for Cloud, applying Azure Policy initiatives aligned with the ACSC baseline, and centralising signal in Microsoft Sentinel. These controls live above the workload graph, so they are recorded as advisory at the resource group scope.",
    tags: ["ism", "ism-1622", "acsc", "baseline", "advisory"],
    predicate: () => false,
  }),

  // 17. ISM-1418 (subsidiary) — Database accounts: SQL public network access off.
  nodeRule({
    id: "ISM.1418.sub",
    source: { ...ISM_BASE, ruleId: "ISM-1418" },
    category: "compliance",
    severity: "warning",
    serviceTypes: ["sqlDatabase"],
    message:
      "[advisory] ISM-1418 (database accounts) — confirm public network access on the SQL logical server is disabled.",
    longExplanation:
      "Control ISM-1418 also covers database accounts and the network exposure of database services. The Bunya `sqlDatabase` property model does not yet expose a `publicNetworkAccess` toggle for the parent SQL logical server, so this is surfaced as an advisory check: confirm during deployment that the SQL server has `publicNetworkAccess` disabled and is reached exclusively via the private endpoint flagged by ISM.1418.",
    tags: ["ism", "ism-1418", "acsc", "network", "database", "advisory"],
    predicate: () => false,
  }),
];
