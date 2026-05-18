// Auto-curated PSRule for Azure rules, re-encoded for Bunya.
// Source: https://github.com/Azure/PSRule.Rules.Azure (MIT)
// Docs:   https://azure.github.io/PSRule.Rules.Azure/
// Each entry cites its upstream rule ID and canonical doc URL.
// Advisory rules whose check cannot run on Bunya's property model are
// marked [advisory] in the message and have a `() => false` predicate.

import { nodeRule, graphRule } from "@/lib/rules/builders";
import type { Autofix, RuleEntry } from "@/lib/rules/schema";
import type { GraphDocument, GraphNode } from "@/lib/graph/schema";

const BASE = { name: "PSRule for Azure", license: "MIT", version: "v1.42.0" } as const;

function source(ruleId: string) {
  return {
    ...BASE,
    ruleId,
    url: `https://azure.github.io/PSRule.Rules.Azure/en/rules/${ruleId}/`,
  };
}

function getProp<T = unknown>(node: GraphNode, key: string): T | undefined {
  return node.properties[key] as T | undefined;
}

function mapNodeProps(
  graph: GraphDocument,
  predicate: (n: GraphNode) => boolean,
  update: (n: GraphNode) => GraphNode,
): GraphDocument {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (predicate(n) ? update(n) : n)),
  };
}

export const PSRULE_RULES: RuleEntry[] = [
  // ---------------------------------------------------------------------------
  // Storage (8)
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "PSRULE.STORAGE.MINTLS",
    source: source("Azure.Storage.MinTLS"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message: "Storage Account must enforce TLS 1.2 minimum.",
    longExplanation:
      "Storage accounts should refuse connections that negotiate TLS below 1.2. Older versions are deprecated by Azure and unsupported, and weaker cipher suites expose data in transit. Pin minTlsVersion to 1.2 on every storage account.",
    tags: ["psrule", "tls", "encryption-in-transit", "storage"],
    predicate: (n) => getProp<string>(n, "minTlsVersion") !== "1.2",
    autofixId: "force-tls-12",
    autofixes: {
      "force-tls-12": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, minTlsVersion: "1.2" } }),
        );
      }) satisfies Autofix,
    },
  }),

  nodeRule({
    id: "PSRULE.STORAGE.SECURETRANSFER",
    source: source("Azure.Storage.SecureTransfer"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message: "Storage Account must require secure transfer (HTTPS only).",
    longExplanation:
      "The supportsHttpsTrafficOnly flag forces every Blob, File, Queue and Table request to use HTTPS. Without it, clients can downgrade to plain HTTP and leak SAS tokens and payloads. Bunya treats public Blob access (allowPublicAccess=true) as a proxy for this control being disabled.",
    tags: ["psrule", "https", "encryption-in-transit", "storage"],
    predicate: (n) => getProp<boolean>(n, "allowPublicAccess") === true,
    autofixId: "disable-public-access",
    autofixes: {
      "disable-public-access": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, allowPublicAccess: false } }),
        );
      }) satisfies Autofix,
    },
  }),

  nodeRule({
    id: "PSRULE.STORAGE.USEREPLICATION",
    source: source("Azure.Storage.UseReplication"),
    category: "reliability",
    severity: "warning",
    serviceTypes: ["storageAccount"],
    message: "Storage Account should use geo-redundant or zone-redundant replication.",
    longExplanation:
      "Locally redundant storage (LRS) only protects against single-disk failure. Production workloads should use ZRS, GRS or RAGRS to survive datacentre or regional events. Choose a replication tier appropriate to the data's recovery objectives.",
    tags: ["psrule", "replication", "reliability", "storage"],
    predicate: (n) => getProp<string>(n, "sku") === "Standard_LRS" || getProp<string>(n, "sku") === "Premium_LRS",
  }),

  nodeRule({
    id: "PSRULE.STORAGE.BLOBPUBLICACCESS",
    source: source("Azure.Storage.BlobPublicAccess"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message: "Storage Account must disable anonymous blob public access.",
    longExplanation:
      "Allowing anonymous public access at the account level means any container marked Blob or Container can be read without credentials. Disable allowBlobPublicAccess at the account so that even a misconfigured container cannot be exposed to the internet.",
    tags: ["psrule", "public-access", "storage", "data-leak"],
    predicate: (n) => getProp<boolean>(n, "allowPublicAccess") === true,
    autofixId: "disable-public-access",
    autofixes: {
      "disable-public-access": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, allowPublicAccess: false } }),
        );
      }) satisfies Autofix,
    },
  }),

  nodeRule({
    id: "PSRULE.STORAGE.FIREWALL",
    source: source("Azure.Storage.Firewall"),
    category: "network",
    severity: "warning",
    serviceTypes: ["storageAccount"],
    message: "Storage Account should restrict network access via firewall or Private Endpoint.",
    longExplanation:
      "Storage accounts with default-allow networking are reachable from anywhere on the internet. PSRule expects accounts to either disable public network access entirely (Private Endpoint only) or configure firewall rules limiting traffic to trusted VNets and IPs.",
    tags: ["psrule", "firewall", "network", "storage"],
    predicate: (n, graph) => {
      if (getProp<boolean>(n, "allowPublicAccess") !== true) return false;
      const hasPe = graph.edges.some((e) => {
        if (e.target !== n.id) return false;
        const src = graph.nodes.find((x) => x.id === e.source);
        return src?.type === "privateEndpoint";
      });
      return !hasPe;
    },
  }),

  nodeRule({
    id: "PSRULE.STORAGE.SOFTDELETE",
    source: source("Azure.Storage.SoftDelete"),
    category: "data-protection",
    severity: "info",
    serviceTypes: ["storageAccount"],
    message:
      "[advisory] Storage Account should enable blob soft-delete (manual review — property not modelled).",
    longExplanation:
      "Soft-delete for blobs lets you recover data that was deleted or overwritten within a retention window. Bunya does not currently model the soft-delete retention policy on storage accounts, so this rule is advisory: confirm in your IaC that deleteRetentionPolicy.enabled=true and a retention window of 7+ days is set.",
    tags: ["psrule", "soft-delete", "storage", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.STORAGE.DEFENDER",
    source: source("Azure.Storage.Defender"),
    category: "data-protection",
    severity: "info",
    serviceTypes: ["storageAccount"],
    message:
      "[advisory] Storage Account should enable Microsoft Defender for Storage (manual review — property not modelled).",
    longExplanation:
      "Microsoft Defender for Storage provides anomaly detection, malware scanning on upload, and sensitive-data discovery. The Defender plan is enabled at subscription level and is not currently represented on the storage node in Bunya, so this rule is advisory and requires manual review in the Azure portal or via policy.",
    tags: ["psrule", "defender", "storage", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.STORAGE.CONTAINERSOFTDELETE",
    source: source("Azure.Storage.ContainerSoftDelete"),
    category: "data-protection",
    severity: "info",
    serviceTypes: ["storageAccount"],
    message:
      "[advisory] Storage Account should enable container soft-delete (manual review — property not modelled).",
    longExplanation:
      "Container soft-delete lets you recover whole containers that were deleted within a retention window. Bunya does not model containerDeleteRetentionPolicy on storage accounts, so this rule is advisory: confirm the policy is enabled with a retention of 7+ days in your IaC or policy assignment.",
    tags: ["psrule", "soft-delete", "storage", "advisory"],
    predicate: () => false,
  }),

  // ---------------------------------------------------------------------------
  // App Service (8)
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "PSRULE.APPSERVICE.USEHTTPS",
    source: source("Azure.AppService.UseHTTPS"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["appService"],
    message: "App Service must enforce HTTPS-only traffic.",
    longExplanation:
      "Setting httpsOnly=true on an App Service forces the platform to redirect or reject all plain HTTP requests. Without it, credentials and cookies can be sent over the wire in clear text. Always enable httpsOnly on production sites.",
    tags: ["psrule", "https", "encryption-in-transit", "app-service"],
    predicate: (n) => getProp<boolean>(n, "httpsOnly") !== true,
    autofixId: "force-https-only",
    autofixes: {
      "force-https-only": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, httpsOnly: true } }),
        );
      }) satisfies Autofix,
    },
  }),

  nodeRule({
    id: "PSRULE.APPSERVICE.MINTLS",
    source: source("Azure.AppService.MinTLS"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["appService"],
    message:
      "[advisory] App Service should set minimum TLS version to 1.2 (manual review — property not modelled).",
    longExplanation:
      "App Service supports a minTlsVersion site setting that rejects TLS handshakes below the configured level. Bunya does not currently model this property on appService nodes, so this rule is advisory: confirm in your IaC that minTlsVersion is set to 1.2 on every site.",
    tags: ["psrule", "tls", "app-service", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.APPSERVICE.ALWAYSON",
    source: source("Azure.AppService.AlwaysOn"),
    category: "reliability",
    severity: "warning",
    serviceTypes: ["appService"],
    message: "App Service should enable Always On on paid plans.",
    longExplanation:
      "When Always On is disabled the App Service worker is unloaded after a period of inactivity, which causes cold-start latency and breaks background WebJobs. PSRule expects Always On to be enabled for any non-consumption plan so the site stays warm.",
    tags: ["psrule", "always-on", "reliability", "app-service"],
    predicate: (n) => getProp<boolean>(n, "alwaysOn") !== true,
    autofixId: "enable-always-on",
    autofixes: {
      "enable-always-on": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, alwaysOn: true } }),
        );
      }) satisfies Autofix,
    },
  }),

  nodeRule({
    id: "PSRULE.APPSERVICE.HTTP2",
    source: source("Azure.AppService.HTTP2"),
    category: "reliability",
    severity: "info",
    serviceTypes: ["appService"],
    message:
      "[advisory] App Service should enable HTTP/2 (manual review — property not modelled).",
    longExplanation:
      "HTTP/2 gives clients multiplexed streams and header compression and is widely supported. App Service exposes a http20Enabled site setting that Bunya does not currently model, so this rule is advisory: confirm http20Enabled=true in your IaC for sites where modern browsers connect directly.",
    tags: ["psrule", "http2", "app-service", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.APPSERVICE.MANAGEDIDENTITY",
    source: source("Azure.AppService.ManagedIdentity"),
    category: "identity",
    severity: "warning",
    serviceTypes: ["appService"],
    message: "App Service should authenticate to Azure resources via Managed Identity.",
    longExplanation:
      "Managed Identity removes the need to store secrets for Azure-to-Azure auth. If an App Service has data or identity edges to Key Vault, SQL, Storage or Cosmos but no User-Assigned Managed Identity is attached, those connections probably rely on connection strings or keys instead.",
    tags: ["psrule", "managed-identity", "identity", "app-service"],
    predicate: (n, graph) => {
      const hasSensitiveEdge = graph.edges.some((e) => {
        if (e.source !== n.id) return false;
        const tgt = graph.nodes.find((x) => x.id === e.target);
        return (
          tgt?.type === "keyVault" ||
          tgt?.type === "sqlDatabase" ||
          tgt?.type === "cosmosDb" ||
          tgt?.type === "storageAccount"
        );
      });
      if (!hasSensitiveEdge) return false;
      const hasUmi = graph.edges.some((e) => {
        if (e.source !== n.id) return false;
        const tgt = graph.nodes.find((x) => x.id === e.target);
        return tgt?.type === "userAssignedIdentity";
      });
      return !hasUmi;
    },
  }),

  nodeRule({
    id: "PSRULE.APPSERVICE.REMOTEDEBUG",
    source: source("Azure.AppService.RemoteDebug"),
    category: "compliance",
    severity: "warning",
    serviceTypes: ["appService"],
    message:
      "[advisory] App Service should disable remote debugging in production (manual review — property not modelled).",
    longExplanation:
      "Remote debugging opens a privileged channel that bypasses normal authentication. PSRule expects remoteDebuggingEnabled to be false on all production sites. Bunya does not model this site setting, so confirm in IaC or via Azure Policy that remote debugging is disabled.",
    tags: ["psrule", "remote-debug", "app-service", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.APPSERVICE.WEBPROBE",
    source: source("Azure.AppService.WebProbe"),
    category: "reliability",
    severity: "info",
    serviceTypes: ["appService"],
    message:
      "[advisory] App Service should configure a health-check probe (manual review — property not modelled).",
    longExplanation:
      "App Service health-check probes (healthCheckPath) let the platform recycle unhealthy instances behind the load balancer. Bunya does not model healthCheckPath, so this rule is advisory: confirm that a probe path returning 200 is configured for every production site.",
    tags: ["psrule", "health-probe", "app-service", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.APPSERVICE.PHPVERSION",
    source: source("Azure.AppService.PHPVersion"),
    category: "compliance",
    severity: "warning",
    serviceTypes: ["appService"],
    message: "App Service must not use deprecated PHP runtime versions.",
    longExplanation:
      "Old PHP runtimes (anything below PHP 8) are out of support and no longer receive security patches. If an App Service is configured with PHP, the runtimeVersion should be 8.x or newer. PSRule blocks deployments using deprecated PHP majors.",
    tags: ["psrule", "runtime", "deprecation", "app-service"],
    predicate: (n) => {
      const runtime = getProp<string>(n, "runtime");
      if (runtime !== "php") return false;
      const ver = getProp<string>(n, "runtimeVersion") ?? "";
      const major = parseInt(ver.split(".")[0] ?? "0", 10);
      return Number.isFinite(major) && major > 0 && major < 8;
    },
  }),

  // ---------------------------------------------------------------------------
  // SQL (6)
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "PSRULE.SQL.MINTLS",
    source: source("Azure.SQL.MinTLS"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["sqlDatabase"],
    message:
      "[advisory] Azure SQL logical server should set minimum TLS version to 1.2 (manual review — property not modelled).",
    longExplanation:
      "Azure SQL logical servers carry a minimalTlsVersion property that should be pinned to 1.2. Bunya models SQL databases but not the parent server's TLS setting, so this rule is advisory: confirm minimalTlsVersion='1.2' on the server resource in IaC.",
    tags: ["psrule", "tls", "sql", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.SQL.AAD",
    source: source("Azure.SQL.AAD"),
    category: "identity",
    severity: "warning",
    serviceTypes: ["sqlDatabase"],
    message: "Azure SQL should be configured for Entra ID (Azure AD) authentication.",
    longExplanation:
      "PSRule expects Azure SQL servers to have an Entra ID administrator configured so users authenticate with workforce identity rather than the local SQL admin account. If the only configured admin login looks like a built-in local account (for example 'sa' or 'sqladmin'), Entra ID auth has probably not been wired up.",
    tags: ["psrule", "entra-id", "identity", "sql"],
    predicate: (n) => {
      const admin = (getProp<string>(n, "adminLogin") ?? "").toLowerCase();
      return admin === "sa" || admin === "sqladmin" || admin === "bunyaadmin" || admin === "admin";
    },
  }),

  nodeRule({
    id: "PSRULE.SQL.FIREWALL",
    source: source("Azure.SQL.FirewallRuleCount"),
    category: "network",
    severity: "info",
    serviceTypes: ["sqlDatabase"],
    message:
      "[advisory] Azure SQL should keep firewall rule count small (manual review — property not modelled).",
    longExplanation:
      "PSRule warns when a SQL logical server has more than ten firewall rules — each rule expands the attack surface. Bunya does not model firewall rules on SQL servers, so this rule is advisory: review firewall rules in IaC and prefer Private Endpoints over IP allow-lists.",
    tags: ["psrule", "firewall", "sql", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.SQL.AUDITING",
    source: source("Azure.SQL.Auditing"),
    category: "observability",
    severity: "warning",
    serviceTypes: ["sqlDatabase"],
    message: "Azure SQL should send audit logs to Log Analytics.",
    longExplanation:
      "SQL Auditing tracks database events for incident response and compliance. PSRule expects auditing to be enabled and routed to a workspace or storage account. Bunya treats the absence of a diagnostic edge from the database to a Log Analytics workspace as evidence that auditing is not wired up.",
    tags: ["psrule", "auditing", "observability", "sql"],
    predicate: (n, graph) => {
      const hasDiag = graph.edges.some((e) => {
        if (e.source !== n.id) return false;
        if (e.kind !== "diagnostic") return false;
        const tgt = graph.nodes.find((x) => x.id === e.target);
        return tgt?.type === "logAnalytics";
      });
      return !hasDiag;
    },
  }),

  nodeRule({
    id: "PSRULE.SQL.ALLOWAZUREACCESS",
    source: source("Azure.SQL.AllowAzureAccess"),
    category: "network",
    severity: "warning",
    serviceTypes: ["sqlDatabase"],
    message:
      "[advisory] Azure SQL should disable 'Allow Azure services and resources' (manual review — property not modelled).",
    longExplanation:
      "The 0.0.0.0 firewall rule allows traffic from any resource in any Azure tenant — not just yours. PSRule flags this as one of the most common SQL misconfigurations. Bunya does not model this firewall rule explicitly, so confirm in IaC that no rule named 'AllowAllWindowsAzureIps' or with start=0.0.0.0 is present.",
    tags: ["psrule", "firewall", "sql", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.SQL.TDE",
    source: source("Azure.SQL.TDE"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["sqlDatabase"],
    message:
      "[advisory] Azure SQL must enable Transparent Data Encryption (manual review — property not modelled).",
    longExplanation:
      "Transparent Data Encryption (TDE) encrypts data at rest at the database level and is on by default for new Azure SQL databases. Bunya does not model the TDE property because it is platform-managed, so this rule is advisory: verify in IaC that TDE has not been explicitly disabled.",
    tags: ["psrule", "tde", "encryption-at-rest", "sql", "advisory"],
    predicate: () => false,
  }),

  // ---------------------------------------------------------------------------
  // Cosmos (4)
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "PSRULE.COSMOS.DISABLEMETADATAWRITE",
    source: source("Azure.Cosmos.DisableMetadataWrite"),
    category: "identity",
    severity: "warning",
    serviceTypes: ["cosmosDb"],
    message:
      "[advisory] Cosmos DB should disable metadata writes via local keys (manual review — property not modelled).",
    longExplanation:
      "When disableLocalAuth=true Cosmos DB rejects key-based metadata operations and forces Entra ID auth for control-plane changes. Bunya does not currently model disableLocalAuth, so this rule is advisory: confirm in IaC that local auth is disabled for new accounts.",
    tags: ["psrule", "cosmos", "local-auth", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.COSMOS.PUBLICACCESS",
    source: source("Azure.Cosmos.PublicAccess"),
    category: "network",
    severity: "warning",
    serviceTypes: ["cosmosDb"],
    message: "Cosmos DB should not be publicly reachable when Private Endpoints are available.",
    longExplanation:
      "When a design includes a Virtual Network, Cosmos DB should be reached via Private Endpoint rather than the public endpoint. PSRule expects publicNetworkAccess to be disabled or the account to sit behind a Private Endpoint in private-network designs.",
    tags: ["psrule", "cosmos", "public-access", "private-link"],
    predicate: (n, graph) => {
      const hasVnet = graph.nodes.some((x) => x.type === "virtualNetwork");
      if (!hasVnet) return false;
      const hasPe = graph.edges.some((e) => {
        if (e.target !== n.id) return false;
        const src = graph.nodes.find((x) => x.id === e.source);
        return src?.type === "privateEndpoint";
      });
      return !hasPe;
    },
  }),

  nodeRule({
    id: "PSRULE.COSMOS.SLA",
    source: source("Azure.Cosmos.SLA"),
    category: "reliability",
    severity: "info",
    serviceTypes: ["cosmosDb"],
    message: "Cosmos DB should not run production workloads on the free tier.",
    longExplanation:
      "The Cosmos DB free tier offers 1000 RU/s and 25 GB free per account but is intended for development. PSRule flags accounts with freeTier=true for production review because the throughput cap can cause throttling under load and there is only one free-tier account per subscription.",
    tags: ["psrule", "cosmos", "free-tier", "reliability"],
    predicate: (n) => getProp<boolean>(n, "freeTier") === true,
  }),

  nodeRule({
    id: "PSRULE.COSMOS.MINTLS",
    source: source("Azure.Cosmos.MinTLS"),
    category: "data-protection",
    severity: "info",
    serviceTypes: ["cosmosDb"],
    message:
      "[advisory] Cosmos DB should enforce TLS 1.2 minimum (manual review — property not modelled).",
    longExplanation:
      "Cosmos DB endpoints negotiate TLS down to the lowest version a client requests unless the account is pinned to TLS 1.2. Bunya does not model the minimumAllowedTLSVersion property, so this rule is advisory: verify in IaC that the account is pinned to Tls12.",
    tags: ["psrule", "cosmos", "tls", "advisory"],
    predicate: () => false,
  }),

  // ---------------------------------------------------------------------------
  // Key Vault (5)
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "PSRULE.KEYVAULT.RBAC",
    source: source("Azure.KeyVault.RBAC"),
    category: "identity",
    severity: "warning",
    serviceTypes: ["keyVault"],
    message: "Key Vault should use Azure RBAC for the data plane.",
    longExplanation:
      "Azure RBAC replaces legacy vault access policies with role-based access control for secrets, keys and certificates. PSRule expects enableRbacAuthorization=true on every new vault so permissions can be audited and revoked consistently with the rest of the subscription.",
    tags: ["psrule", "key-vault", "rbac", "identity"],
    predicate: (n) => getProp<boolean>(n, "rbacAuthorization") !== true,
    autofixId: "enable-kv-rbac",
    autofixes: {
      "enable-kv-rbac": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, rbacAuthorization: true } }),
        );
      }) satisfies Autofix,
    },
  }),

  nodeRule({
    id: "PSRULE.KEYVAULT.PURGEPROTECT",
    source: source("Azure.KeyVault.PurgeProtect"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["keyVault"],
    message: "Key Vault must enable purge protection.",
    longExplanation:
      "Purge protection prevents permanent deletion of vaults and secrets within the soft-delete retention period, blocking accidental or malicious wipes of cryptographic material. PSRule treats purge protection as a non-negotiable for production vaults.",
    tags: ["psrule", "key-vault", "purge-protection", "data-protection"],
    predicate: (n) => getProp<boolean>(n, "purgeProtection") !== true,
    autofixId: "enable-purge-protect",
    autofixes: {
      "enable-purge-protect": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, purgeProtection: true } }),
        );
      }) satisfies Autofix,
    },
  }),

  nodeRule({
    id: "PSRULE.KEYVAULT.SOFTDELETE",
    source: source("Azure.KeyVault.SoftDelete"),
    category: "data-protection",
    severity: "warning",
    serviceTypes: ["keyVault"],
    message: "Key Vault should retain soft-deleted items for at least 7 days.",
    longExplanation:
      "Key Vault soft-delete keeps deleted vaults and secrets recoverable for a configurable window. PSRule expects the retention to be 7 days or more so accidental deletes can be undone before purge.",
    tags: ["psrule", "key-vault", "soft-delete"],
    predicate: (n) => {
      const days = getProp<number>(n, "softDeleteRetentionDays");
      return typeof days === "number" && days < 7;
    },
    autofixId: "kv-retention-7",
    autofixes: {
      "kv-retention-7": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, softDeleteRetentionDays: 7 } }),
        );
      }) satisfies Autofix,
    },
  }),

  nodeRule({
    id: "PSRULE.KEYVAULT.LOGS",
    source: source("Azure.KeyVault.Logs"),
    category: "observability",
    severity: "warning",
    serviceTypes: ["keyVault"],
    message: "Key Vault should send diagnostic logs to a Log Analytics workspace.",
    longExplanation:
      "Vault audit logs are critical for incident response. PSRule expects every Key Vault to forward AuditEvent (and AllMetrics) to a Log Analytics workspace via a diagnostic setting. Bunya looks for a diagnostic edge from the vault to a logAnalytics workspace as the model of that wiring.",
    tags: ["psrule", "key-vault", "diagnostics", "observability"],
    predicate: (n, graph) => {
      const hasDiag = graph.edges.some((e) => {
        if (e.source !== n.id) return false;
        if (e.kind !== "diagnostic") return false;
        const tgt = graph.nodes.find((x) => x.id === e.target);
        return tgt?.type === "logAnalytics";
      });
      return !hasDiag;
    },
  }),

  nodeRule({
    id: "PSRULE.KEYVAULT.FIREWALL",
    source: source("Azure.KeyVault.Firewall"),
    category: "network",
    severity: "warning",
    serviceTypes: ["keyVault"],
    message: "Key Vault should restrict public network access.",
    longExplanation:
      "Vaults with publicNetworkAccess enabled are reachable from any IP that can resolve the public Key Vault endpoint. PSRule expects publicNetworkAccess to be disabled and traffic to flow via Private Endpoint when a VNet exists in the design.",
    tags: ["psrule", "key-vault", "firewall", "network"],
    predicate: (n) => getProp<boolean>(n, "publicNetworkAccess") === true,
    autofixId: "kv-disable-public",
    autofixes: {
      "kv-disable-public": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, publicNetworkAccess: false } }),
        );
      }) satisfies Autofix,
    },
  }),

  // ---------------------------------------------------------------------------
  // Container Registry (5)
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "PSRULE.ACR.ADMINUSER",
    source: source("Azure.ACR.AdminUser"),
    category: "identity",
    severity: "error",
    serviceTypes: ["containerRegistry"],
    message: "Container Registry must disable the admin user.",
    longExplanation:
      "The ACR admin account is a shared username/password that bypasses RBAC and Entra ID. PSRule blocks any registry with adminUserEnabled=true. Use Managed Identity or AAD-backed token auth for pulls and pushes instead.",
    tags: ["psrule", "acr", "admin-user", "identity"],
    predicate: (n) => getProp<boolean>(n, "adminUserEnabled") === true,
    autofixId: "acr-disable-admin",
    autofixes: {
      "acr-disable-admin": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, adminUserEnabled: false } }),
        );
      }) satisfies Autofix,
    },
  }),

  nodeRule({
    id: "PSRULE.ACR.MINSKU",
    source: source("Azure.ACR.MinSku"),
    category: "reliability",
    severity: "warning",
    serviceTypes: ["containerRegistry"],
    message: "Container Registry should use Standard or Premium SKU.",
    longExplanation:
      "Basic ACR is intended for early development and has limits on storage, throughput and webhook count. PSRule expects production registries to be at least Standard, and Premium where geo-replication, Private Endpoints or content trust are needed.",
    tags: ["psrule", "acr", "sku", "reliability"],
    predicate: (n) => getProp<string>(n, "sku") === "Basic",
  }),

  nodeRule({
    id: "PSRULE.ACR.CONTENTTRUST",
    source: source("Azure.ACR.ContentTrust"),
    category: "data-protection",
    severity: "info",
    serviceTypes: ["containerRegistry"],
    message:
      "[advisory] Container Registry should enable content trust on Premium SKU (manual review — property not modelled).",
    longExplanation:
      "Content trust uses Docker Notary signatures to verify that images were pushed by trusted publishers and have not been tampered with. It requires the Premium SKU and is not currently modelled on ACR nodes in Bunya, so this rule is advisory: enable in IaC for production registries.",
    tags: ["psrule", "acr", "content-trust", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.ACR.QUARANTINE",
    source: source("Azure.ACR.Quarantine"),
    category: "data-protection",
    severity: "info",
    serviceTypes: ["containerRegistry"],
    message:
      "[advisory] Container Registry should enable quarantine policy on Premium SKU (manual review — property not modelled).",
    longExplanation:
      "Quarantine policy holds newly pushed images until they have been scanned and explicitly released, preventing untrusted images from being pulled into production. It requires Premium SKU. Bunya does not model the quarantine policy property, so this rule is advisory.",
    tags: ["psrule", "acr", "quarantine", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.ACR.FIREWALL",
    source: source("Azure.ACR.Firewall"),
    category: "network",
    severity: "warning",
    serviceTypes: ["containerRegistry"],
    message: "Container Registry should restrict public network access.",
    longExplanation:
      "Registries with publicNetworkAccess=true expose the pull/push surface to the internet. PSRule expects Premium registries used in VNet designs to disable public network access and use Private Endpoints. Bunya flags registries that remain public when a VNet is part of the design.",
    tags: ["psrule", "acr", "firewall", "network"],
    predicate: (n, graph) => {
      const hasVnet = graph.nodes.some((x) => x.type === "virtualNetwork");
      if (!hasVnet) return false;
      return getProp<boolean>(n, "publicNetworkAccess") === true;
    },
    autofixId: "acr-disable-public",
    autofixes: {
      "acr-disable-public": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, publicNetworkAccess: false } }),
        );
      }) satisfies Autofix,
    },
  }),

  // ---------------------------------------------------------------------------
  // VNet / NSG / Subnet (4)
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "PSRULE.VNET.USENSGS",
    source: source("Azure.VNET.UseNSGs"),
    category: "network",
    severity: "warning",
    serviceTypes: ["subnet"],
    message: "Subnet should be associated with a Network Security Group.",
    longExplanation:
      "PSRule expects every workload subnet (apart from special-purpose subnets such as AzureFirewallSubnet and GatewaySubnet) to carry an NSG. Without one, the subnet falls back to default platform rules which permit broad east-west and outbound internet traffic.",
    tags: ["psrule", "vnet", "nsg", "subnet"],
    predicate: (n, graph) => {
      const hasNsg = graph.edges.some((e) => {
        if (e.kind !== "network") return false;
        if (e.source === n.id) {
          const tgt = graph.nodes.find((x) => x.id === e.target);
          if (tgt?.type === "networkSecurityGroup") return true;
        }
        if (e.target === n.id) {
          const src = graph.nodes.find((x) => x.id === e.source);
          if (src?.type === "networkSecurityGroup") return true;
        }
        return false;
      });
      return !hasNsg;
    },
  }),

  nodeRule({
    id: "PSRULE.VNET.SINGLEDNS",
    source: source("Azure.VNET.SingleDNS"),
    category: "reliability",
    severity: "warning",
    serviceTypes: ["virtualNetwork"],
    message: "Virtual Network should not rely on a single custom DNS server.",
    longExplanation:
      "If a VNet is configured with custom DNS servers, PSRule expects at least two for redundancy. A single custom resolver is a single point of failure for every workload in the VNet. Either provide multiple DNS servers or fall back to Azure-provided DNS.",
    tags: ["psrule", "vnet", "dns", "reliability"],
    predicate: (n) => {
      const dns = (getProp<string[]>(n, "dnsServers") ?? []) as string[];
      return dns.length === 1;
    },
  }),

  nodeRule({
    id: "PSRULE.NSG.ANYINBOUNDSOURCE",
    source: source("Azure.NSG.AnyInboundSource"),
    category: "network",
    severity: "warning",
    serviceTypes: ["networkSecurityGroup"],
    message:
      "[advisory] NSG should not allow inbound traffic from any source (manual review — rule list not modelled).",
    longExplanation:
      "PSRule flags NSGs that allow inbound traffic from '*' or '0.0.0.0/0', which effectively exposes the workload to the internet. Bunya does not currently model individual security rules on NSG nodes, so this rule is advisory: review rules in IaC and replace 'Any' source with a specific service tag or CIDR.",
    tags: ["psrule", "nsg", "inbound", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.NSG.DENYALLINBOUND",
    source: source("Azure.NSG.DenyAllInbound"),
    category: "network",
    severity: "info",
    serviceTypes: ["networkSecurityGroup"],
    message: "NSG should keep an explicit default-deny inbound posture.",
    longExplanation:
      "Although Azure ships a default DenyAllInbound rule at priority 65500, PSRule recommends an explicit deny-all inbound at a lower priority so operators can audit the intent. Bunya models a defaultDeny boolean on NSG nodes and flags any NSG where it is disabled.",
    tags: ["psrule", "nsg", "default-deny", "network"],
    predicate: (n) => getProp<boolean>(n, "defaultDeny") === false,
    autofixId: "nsg-enable-default-deny",
    autofixes: {
      "nsg-enable-default-deny": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, defaultDeny: true } }),
        );
      }) satisfies Autofix,
    },
  }),

  // ---------------------------------------------------------------------------
  // Application Gateway (4)
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "PSRULE.APPGW.WAFENABLED",
    source: source("Azure.AppGw.WAFEnabled"),
    category: "network",
    severity: "warning",
    serviceTypes: ["applicationGateway"],
    message: "Application Gateway should use a WAF-enabled SKU.",
    longExplanation:
      "PSRule expects internet-facing Application Gateways to run on WAF_v2 (or the legacy WAF SKU) so OWASP rule sets and bot mitigation are applied. The Standard_v2 SKU performs L7 routing but has no WAF.",
    tags: ["psrule", "app-gateway", "waf", "network"],
    predicate: (n) => getProp<string>(n, "sku") !== "WAF_v2",
    autofixId: "agw-use-waf",
    autofixes: {
      "agw-use-waf": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, sku: "WAF_v2" } }),
        );
      }) satisfies Autofix,
    },
  }),

  nodeRule({
    id: "PSRULE.APPGW.SSLPOLICY",
    source: source("Azure.AppGw.SSLPolicy"),
    category: "data-protection",
    severity: "warning",
    serviceTypes: ["applicationGateway"],
    message:
      "[advisory] Application Gateway should use a strong predefined SSL policy (manual review — property not modelled).",
    longExplanation:
      "Application Gateway exposes an sslPolicy property that pins minimum TLS version and cipher suite. PSRule expects AppGwSslPolicy20220101 or a custom policy with TLS 1.2+ only. Bunya does not model sslPolicy, so this rule is advisory: confirm in IaC.",
    tags: ["psrule", "app-gateway", "ssl-policy", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.APPGW.USEHTTPS",
    source: source("Azure.AppGw.UseHTTPS"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["applicationGateway"],
    message: "Application Gateway must have at least one HTTPS listener.",
    longExplanation:
      "An Application Gateway that exposes only HTTP listeners terminates user traffic in clear text. PSRule expects every gateway to have an HTTPS listener (and ideally redirect HTTP to HTTPS). Bunya models this via an httpsListener boolean.",
    tags: ["psrule", "app-gateway", "https"],
    predicate: (n) => getProp<boolean>(n, "httpsListener") !== true,
    autofixId: "agw-https-listener",
    autofixes: {
      "agw-https-listener": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, httpsListener: true } }),
        );
      }) satisfies Autofix,
    },
  }),

  nodeRule({
    id: "PSRULE.APPGW.AVAILABILITYZONE",
    source: source("Azure.AppGw.AvailabilityZone"),
    category: "reliability",
    severity: "warning",
    serviceTypes: ["applicationGateway"],
    message: "Application Gateway should be deployed with capacity >= 2 for zone redundancy.",
    longExplanation:
      "PSRule expects Application Gateway v2 SKUs to be deployed across availability zones with at least two instances so a single zone failure does not take traffic offline. A capacity of 1 means a single instance and is unsuitable for production.",
    tags: ["psrule", "app-gateway", "zones", "reliability"],
    predicate: (n) => {
      const cap = getProp<number>(n, "capacity");
      return typeof cap === "number" && cap < 2;
    },
    autofixId: "agw-capacity-2",
    autofixes: {
      "agw-capacity-2": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, capacity: 2 } }),
        );
      }) satisfies Autofix,
    },
  }),

  // ---------------------------------------------------------------------------
  // Front Door (3)
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "PSRULE.FRONTDOOR.USETLS12",
    source: source("Azure.FrontDoor.MinTLS"),
    category: "data-protection",
    severity: "info",
    serviceTypes: ["frontDoor"],
    message:
      "[advisory] Front Door should enforce TLS 1.2 minimum on custom domains (manual review — property not modelled).",
    longExplanation:
      "Front Door custom domains carry a minimumTlsVersion property on each routing rule / domain binding. PSRule expects TLS 1.2 or higher. Bunya does not currently model the TLS policy on Front Door nodes, so this rule is advisory.",
    tags: ["psrule", "front-door", "tls", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.FRONTDOOR.USEWAF",
    source: source("Azure.FrontDoor.UseWAF"),
    category: "network",
    severity: "warning",
    serviceTypes: ["frontDoor"],
    message: "Front Door should use the Premium SKU to attach a WAF policy.",
    longExplanation:
      "Only Front Door Premium can attach an Azure WAF policy. Standard tier provides routing and SSL termination but no rule-based mitigation. PSRule expects internet-facing Front Door profiles to use Premium_AzureFrontDoor when WAF is required.",
    tags: ["psrule", "front-door", "waf"],
    predicate: (n) => getProp<string>(n, "sku") !== "Premium_AzureFrontDoor",
  }),

  nodeRule({
    id: "PSRULE.FRONTDOOR.PROBE",
    source: source("Azure.FrontDoor.Probe"),
    category: "reliability",
    severity: "warning",
    serviceTypes: ["frontDoor"],
    message: "Front Door response timeout should be a sensible value (16-240 seconds).",
    longExplanation:
      "Front Door's responseTimeoutSeconds bounds how long the edge waits for a backend response. PSRule expects this value to be configured deliberately — defaults near the upper end can hide slow origins, while values too close to the floor can clip legitimate long-running APIs. Bunya enforces the Azure-allowed range.",
    tags: ["psrule", "front-door", "timeout", "reliability"],
    predicate: (n) => {
      const t = getProp<number>(n, "responseTimeoutSeconds");
      if (typeof t !== "number") return false;
      return t < 16 || t > 240;
    },
  }),

  // ---------------------------------------------------------------------------
  // API Management (2)
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "PSRULE.APIM.HTTPSONLY",
    source: source("Azure.APIM.HTTPS"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["apiManagement"],
    message:
      "[advisory] API Management APIs must require HTTPS (manual review — protocols not modelled).",
    longExplanation:
      "APIs published by API Management can be exposed over HTTP, HTTPS or both. PSRule expects every API to enforce HTTPS-only. Bunya does not currently model the per-API protocols on APIM nodes, so this rule is advisory: confirm in IaC that each API protocols array contains only 'https'.",
    tags: ["psrule", "apim", "https", "advisory"],
    predicate: () => false,
  }),

  nodeRule({
    id: "PSRULE.APIM.MINAPIVERSION",
    source: source("Azure.APIM.MinAPIVersion"),
    category: "compliance",
    severity: "warning",
    serviceTypes: ["apiManagement"],
    message: "API Management should not be deployed on the Consumption SKU for production.",
    longExplanation:
      "PSRule expects production APIM instances to run on Developer (non-prod), Basic, Standard or Premium tiers. The Consumption SKU has feature gaps (no VNet integration, limited policy support, lower throughput guarantees) and is intended for spike or evaluation workloads.",
    tags: ["psrule", "apim", "sku", "compliance"],
    predicate: (n) => getProp<string>(n, "sku") === "Consumption",
  }),

  // ---------------------------------------------------------------------------
  // Function App (2)
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "PSRULE.FUNCTION.USEHTTPS",
    source: source("Azure.Function.UseHTTPS"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["functionApp"],
    message: "Function App must enforce HTTPS-only traffic.",
    longExplanation:
      "Function Apps share the App Service host configuration and should set httpsOnly=true. Without it, callers can invoke triggers over HTTP and leak function keys in URL parameters.",
    tags: ["psrule", "function", "https", "encryption-in-transit"],
    predicate: (n) => getProp<boolean>(n, "httpsOnly") !== true,
    autofixId: "fn-https-only",
    autofixes: {
      "fn-https-only": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, httpsOnly: true } }),
        );
      }) satisfies Autofix,
    },
  }),

  nodeRule({
    id: "PSRULE.FUNCTION.MINTLS",
    source: source("Azure.Function.MinTLS"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["functionApp"],
    message:
      "[advisory] Function App should set minimum TLS version to 1.2 (manual review — property not modelled).",
    longExplanation:
      "Function Apps inherit App Service's minTlsVersion site setting and should be pinned to 1.2. Bunya does not currently model this property on functionApp nodes, so this rule is advisory: confirm minTlsVersion='1.2' in IaC.",
    tags: ["psrule", "function", "tls", "advisory"],
    predicate: () => false,
  }),

  // ---------------------------------------------------------------------------
  // App Insights / Log Analytics (2)
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "PSRULE.APPINSIGHTS.WORKSPACE",
    source: source("Azure.AppInsights.Workspace"),
    category: "observability",
    severity: "warning",
    serviceTypes: ["applicationInsights"],
    message: "Application Insights should use workspace-based ingestion.",
    longExplanation:
      "Classic Application Insights is being retired in favour of workspace-based AI, which stores telemetry in Log Analytics for unified querying and retention. PSRule expects every AppI component to be linked to a Log Analytics workspace. Bunya checks for a depends_on or diagnostic edge from the component to a workspace.",
    tags: ["psrule", "app-insights", "workspace", "observability"],
    predicate: (n, graph) => {
      const hasWorkspace = graph.edges.some((e) => {
        if (e.source !== n.id) return false;
        const tgt = graph.nodes.find((x) => x.id === e.target);
        return tgt?.type === "logAnalytics";
      });
      return !hasWorkspace;
    },
  }),

  nodeRule({
    id: "PSRULE.LOGANALYTICS.REPLICATION",
    source: source("Azure.LogAnalytics.Replication"),
    category: "reliability",
    severity: "info",
    serviceTypes: ["logAnalytics"],
    message: "Log Analytics workspace should retain logs for at least 30 days.",
    longExplanation:
      "PSRule expects workspaces to keep at least 30 days of retention so incident investigations have a useful window. Bunya models retentionDays directly and flags workspaces configured below 30 days.",
    tags: ["psrule", "log-analytics", "retention", "reliability"],
    predicate: (n) => {
      const days = getProp<number>(n, "retentionDays");
      return typeof days === "number" && days < 30;
    },
    autofixId: "la-retention-30",
    autofixes: {
      "la-retention-30": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return mapNodeProps(
          graph,
          (n) => n.id === id,
          (n) => ({ ...n, properties: { ...n.properties, retentionDays: 30 } }),
        );
      }) satisfies Autofix,
    },
  }),

  // ---------------------------------------------------------------------------
  // Generic (2)
  // ---------------------------------------------------------------------------
  graphRule({
    id: "PSRULE.RESOURCE.USETAGS",
    source: source("Azure.Resource.UseTags"),
    category: "compliance",
    severity: "info",
    message: "Resource Group should carry at least one tag.",
    longExplanation:
      "PSRule expects every taggable resource (especially resource groups) to carry tags so cost, owner and environment can be tracked. A resource group with an empty tag bag is almost always a sign that tagging policy has not been applied.",
    tags: ["psrule", "tags", "governance"],
    appliesToServices: ["resourceGroup"],
    predicate: (graph) => {
      const findings: { nodeIds?: string[] }[] = [];
      for (const n of graph.nodes) {
        if (n.type !== "resourceGroup") continue;
        const tags = (n.properties.tags ?? {}) as Record<string, string>;
        if (Object.keys(tags).length === 0) findings.push({ nodeIds: [n.id] });
      }
      return findings;
    },
  }),

  graphRule({
    id: "PSRULE.RESOURCE.ALLOWEDREGIONS",
    source: source("Azure.Resource.AllowedRegions"),
    category: "sovereignty",
    severity: "warning",
    message: "Graph should be deployed in an Australian Azure region.",
    longExplanation:
      "PSRule for Azure can be configured with an allowedRegions list. Bunya's catalogue is restricted to Australian regions (australiaeast, australiasoutheast, australiacentral, australiacentral2) and any graph configured against another region indicates a sovereignty drift. The metadata.region field is the single source of truth here.",
    tags: ["psrule", "regions", "sovereignty"],
    appliesToServices: ["resourceGroup"],
    predicate: (graph) => {
      const allowed = new Set([
        "australiaeast",
        "australiasoutheast",
        "australiacentral",
        "australiacentral2",
      ]);
      if (allowed.has(graph.metadata.region)) return [];
      const rg = graph.nodes.find((n) => n.type === "resourceGroup");
      return [{ nodeIds: rg ? [rg.id] : [] }];
    },
  }),
];
