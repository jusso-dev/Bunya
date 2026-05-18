// Generated from the Checkov (Azure) ruleset, pinned at v3.2.0.
// This file is hand-curated but lives behind the same `import.ts` stub that the
// fetcher script will overwrite when run online. Do not edit individual rules
// here — re-run the generator if you need to refresh the set.
import { nodeRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";

const CHECKOV_BASE = {
  name: "Checkov",
  license: "Apache-2.0",
  version: "v3.2.0",
} as const;

function checkovSrc(ruleId: string) {
  return {
    ...CHECKOV_BASE,
    ruleId,
    url: `https://docs.bridgecrew.io/docs/${ruleId.toLowerCase().replace(/_/g, "-")}`,
  };
}

function getProp<T = unknown>(
  node: { properties: Record<string, unknown> },
  key: string,
): T | undefined {
  return node.properties[key] as T | undefined;
}

export const CHECKOV_RULES: RuleEntry[] = [
  // 1. CKV_AZURE_1 — App Service authentication enabled (advisory; closest property is httpsOnly)
  nodeRule({
    id: "CHECKOV.AZURE.1",
    source: checkovSrc("CKV_AZURE_1"),
    category: "identity",
    severity: "warning",
    serviceTypes: ["appService"],
    message:
      "[advisory] App Service should have authentication (Easy Auth) enabled.",
    longExplanation:
      "Checkov CKV_AZURE_1 requires App Service authentication to be enabled so unauthenticated callers cannot reach application endpoints. Bunya does not yet model the auth settings block, so this rule is surfaced as advisory only.",
    tags: ["checkov", "identity", "authentication", "advisory"],
    predicate: () => false,
  }),

  // 2. CKV_AZURE_2 — Storage min TLS 1.2
  nodeRule({
    id: "CHECKOV.AZURE.2",
    source: checkovSrc("CKV_AZURE_2"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message: "Storage Account minimum TLS version must be 1.2.",
    longExplanation:
      "Checkov CKV_AZURE_2 requires `min_tls_version` to be `TLS1_2` on every Azure Storage Account. Older TLS versions are deprecated and expose data in transit to known cipher weaknesses.",
    tags: ["checkov", "tls", "storage"],
    predicate: (n) => getProp<string>(n, "minTlsVersion") !== "1.2",
  }),

  // 3. CKV_AZURE_3 — Storage supportsHttpsTrafficOnly (advisory; not modelled)
  nodeRule({
    id: "CHECKOV.AZURE.3",
    source: checkovSrc("CKV_AZURE_3"),
    category: "data-protection",
    severity: "warning",
    serviceTypes: ["storageAccount"],
    message:
      "[advisory] Storage Account should require secure transfer (HTTPS only).",
    longExplanation:
      "Checkov CKV_AZURE_3 requires `supportsHttpsTrafficOnly = true` on every Storage Account. Bunya does not currently model that property; Azure defaults it to true for new accounts, so this rule is surfaced as advisory only.",
    tags: ["checkov", "https", "storage", "advisory"],
    predicate: () => false,
  }),

  // 4. CKV_AZURE_4 — Storage default network deny (allowPublicAccess false)
  nodeRule({
    id: "CHECKOV.AZURE.4",
    source: checkovSrc("CKV_AZURE_4"),
    category: "network",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message: "Storage Account default network action should be Deny.",
    longExplanation:
      "Checkov CKV_AZURE_4 requires the Storage Account network ACL `defaultAction` to be `Deny` so that only explicitly allowed networks or private endpoints can reach the account. Bunya models this as `allowPublicAccess: false`.",
    tags: ["checkov", "network", "storage", "public-access"],
    predicate: (n) => getProp<boolean>(n, "allowPublicAccess") === true,
  }),

  // 5. CKV_AZURE_5 — SQL Defender enabled (advisory)
  nodeRule({
    id: "CHECKOV.AZURE.5",
    source: checkovSrc("CKV_AZURE_5"),
    category: "data-protection",
    severity: "warning",
    serviceTypes: ["sqlDatabase"],
    message:
      "[advisory] Microsoft Defender for SQL should be enabled on Azure SQL servers.",
    longExplanation:
      "Checkov CKV_AZURE_5 requires Microsoft Defender for SQL to be enabled at the server level. Bunya does not yet model Defender plans, so this rule is surfaced as advisory only.",
    tags: ["checkov", "defender", "sql", "advisory"],
    predicate: () => false,
  }),

  // 6. CKV_AZURE_9 — SQL auditing enabled (advisory)
  nodeRule({
    id: "CHECKOV.AZURE.9",
    source: checkovSrc("CKV_AZURE_9"),
    category: "compliance",
    severity: "warning",
    serviceTypes: ["sqlDatabase"],
    message: "[advisory] Auditing should be enabled on Azure SQL servers.",
    longExplanation:
      "Checkov CKV_AZURE_9 requires that SQL Server-level auditing be enabled so that all database events are written to a storage account or Log Analytics workspace. Bunya does not yet model the auditing policy block, so this rule is surfaced as advisory only.",
    tags: ["checkov", "audit", "sql", "advisory"],
    predicate: () => false,
  }),

  // 7. CKV_AZURE_10 — SQL auditing retention ≥90 days (advisory)
  nodeRule({
    id: "CHECKOV.AZURE.10",
    source: checkovSrc("CKV_AZURE_10"),
    category: "compliance",
    severity: "warning",
    serviceTypes: ["sqlDatabase"],
    message:
      "[advisory] SQL auditing retention should be at least 90 days.",
    longExplanation:
      "Checkov CKV_AZURE_10 requires the SQL Server auditing policy to retain logs for at least 90 days to support forensic analysis and compliance regimes such as ISM and ISO 27001. Bunya does not yet model the auditing policy block.",
    tags: ["checkov", "audit", "retention", "sql", "advisory"],
    predicate: () => false,
  }),

  // 8. CKV_AZURE_13 — App Service authentication enabled (advisory; duplicate of CKV_AZURE_1)
  nodeRule({
    id: "CHECKOV.AZURE.13",
    source: checkovSrc("CKV_AZURE_13"),
    category: "identity",
    severity: "warning",
    serviceTypes: ["appService"],
    message:
      "[advisory] App Service should have authentication (Easy Auth) configured.",
    longExplanation:
      "Checkov CKV_AZURE_13 is a variant of CKV_AZURE_1 that requires App Service authentication to be configured so that anonymous traffic is rejected at the platform layer. Bunya does not yet model the auth settings block.",
    tags: ["checkov", "identity", "authentication", "advisory"],
    predicate: () => false,
  }),

  // 9. CKV_AZURE_14 — App Service HTTPS only
  nodeRule({
    id: "CHECKOV.AZURE.14",
    source: checkovSrc("CKV_AZURE_14"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["appService"],
    message: "App Service must have HTTPS Only enabled.",
    longExplanation:
      "Checkov CKV_AZURE_14 requires `httpsOnly = true` on every App Service so that HTTP requests are redirected and tokens or cookies cannot leak over plaintext.",
    tags: ["checkov", "https", "app-service"],
    predicate: (n) => getProp<boolean>(n, "httpsOnly") === false,
  }),

  // 10. CKV_AZURE_15 — App Service latest TLS
  nodeRule({
    id: "CHECKOV.AZURE.15",
    source: checkovSrc("CKV_AZURE_15"),
    category: "data-protection",
    severity: "warning",
    serviceTypes: ["appService"],
    message:
      "[advisory] App Service should require the latest TLS version (1.2 or newer).",
    longExplanation:
      "Checkov CKV_AZURE_15 requires the App Service `minTlsVersion` site config to be 1.2 or newer. Bunya does not yet model that site config setting; new App Services default to 1.2.",
    tags: ["checkov", "tls", "app-service", "advisory"],
    predicate: () => false,
  }),

  // 11. CKV_AZURE_17 — App Service client certificates enabled (advisory)
  nodeRule({
    id: "CHECKOV.AZURE.17",
    source: checkovSrc("CKV_AZURE_17"),
    category: "identity",
    severity: "warning",
    serviceTypes: ["appService"],
    message:
      "[advisory] App Service should require incoming client certificates.",
    longExplanation:
      "Checkov CKV_AZURE_17 requires App Service `clientCertEnabled = true` so that callers must present a TLS client certificate. Bunya does not yet model client certificate configuration.",
    tags: ["checkov", "mtls", "app-service", "advisory"],
    predicate: () => false,
  }),

  // 12. CKV_AZURE_18 — App Service HTTP Version (advisory)
  nodeRule({
    id: "CHECKOV.AZURE.18",
    source: checkovSrc("CKV_AZURE_18"),
    category: "data-protection",
    severity: "warning",
    serviceTypes: ["appService"],
    message:
      "[advisory] App Service should use the latest HTTP version (HTTP/2).",
    longExplanation:
      "Checkov CKV_AZURE_18 requires the App Service site config `http20Enabled = true` so that modern clients use HTTP/2. Bunya does not yet model that site config setting.",
    tags: ["checkov", "http2", "app-service", "advisory"],
    predicate: () => false,
  }),

  // 13. CKV_AZURE_23 — SQL public access disabled (advisory)
  nodeRule({
    id: "CHECKOV.AZURE.23",
    source: checkovSrc("CKV_AZURE_23"),
    category: "network",
    severity: "warning",
    serviceTypes: ["sqlDatabase"],
    message:
      "[advisory] Azure SQL Server should disable public network access.",
    longExplanation:
      "Checkov CKV_AZURE_23 requires the SQL Server `publicNetworkAccess` property to be `Disabled` so that access only flows through private endpoints. Bunya models the SQL database but not the parent server's public access flag, so this rule is surfaced as advisory only.",
    tags: ["checkov", "sql", "public-access", "advisory"],
    predicate: () => false,
  }),

  // 14. CKV_AZURE_28 — Function App HTTPS Only
  nodeRule({
    id: "CHECKOV.AZURE.28",
    source: checkovSrc("CKV_AZURE_28"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["functionApp"],
    message: "Function App must have HTTPS Only enabled.",
    longExplanation:
      "Checkov CKV_AZURE_28 requires `httpsOnly = true` on every Function App so triggers and admin endpoints cannot be reached over plaintext.",
    tags: ["checkov", "https", "function-app"],
    predicate: (n) => getProp<boolean>(n, "httpsOnly") === false,
  }),

  // 15. CKV_AZURE_33 — Storage queue logging (advisory)
  nodeRule({
    id: "CHECKOV.AZURE.33",
    source: checkovSrc("CKV_AZURE_33"),
    category: "compliance",
    severity: "warning",
    serviceTypes: ["storageAccount"],
    message:
      "[advisory] Storage Account queue service logging should be enabled.",
    longExplanation:
      "Checkov CKV_AZURE_33 requires Storage Account queue logging for read, write and delete operations. Bunya does not yet model storage logging diagnostic settings at this granularity.",
    tags: ["checkov", "logging", "storage", "advisory"],
    predicate: () => false,
  }),

  // 16. CKV_AZURE_35 — Storage default network deny (alias of CKV_AZURE_4)
  nodeRule({
    id: "CHECKOV.AZURE.35",
    source: checkovSrc("CKV_AZURE_35"),
    category: "network",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message:
      "Storage Account network rules should default to Deny (public access disabled).",
    longExplanation:
      "Checkov CKV_AZURE_35 enforces a default Deny network ACL on Storage Accounts so any access must come from explicitly allowed virtual networks, IP ranges, or private endpoints. Bunya models this as `allowPublicAccess: false`.",
    tags: ["checkov", "network", "storage"],
    predicate: (n) => getProp<boolean>(n, "allowPublicAccess") === true,
  }),

  // 17. CKV_AZURE_36 — Storage trusted services bypass (advisory)
  nodeRule({
    id: "CHECKOV.AZURE.36",
    source: checkovSrc("CKV_AZURE_36"),
    category: "network",
    severity: "warning",
    serviceTypes: ["storageAccount"],
    message:
      "[advisory] Storage Account should only bypass network rules for AzureServices when required.",
    longExplanation:
      "Checkov CKV_AZURE_36 inspects the Storage Account network ACL `bypass` value and warns when trusted Azure services are allowed beyond what is needed. Bunya does not yet model the bypass property.",
    tags: ["checkov", "storage", "bypass", "advisory"],
    predicate: () => false,
  }),

  // 18. CKV_AZURE_42 — Key Vault purge protection
  nodeRule({
    id: "CHECKOV.AZURE.42",
    source: checkovSrc("CKV_AZURE_42"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["keyVault"],
    message: "Key Vault must have purge protection enabled.",
    longExplanation:
      "Checkov CKV_AZURE_42 requires `purgeProtectionEnabled = true` on every Key Vault. Purge protection prevents an attacker (or accidental delete) from permanently destroying secrets, keys, and certificates within the soft-delete retention window.",
    tags: ["checkov", "key-vault", "purge-protection"],
    predicate: (n) => getProp<boolean>(n, "purgeProtection") === false,
  }),

  // 19. CKV_AZURE_43 — Storage secure transfer (covered by CKV_AZURE_3 — advisory)
  nodeRule({
    id: "CHECKOV.AZURE.43",
    source: checkovSrc("CKV_AZURE_43"),
    category: "data-protection",
    severity: "warning",
    serviceTypes: ["storageAccount"],
    message:
      "[advisory] Storage Account secure-transfer naming convention should be followed.",
    longExplanation:
      "Checkov CKV_AZURE_43 is a companion to CKV_AZURE_3 covering secure transfer naming rules for Storage Accounts. Bunya does not currently model the underlying property.",
    tags: ["checkov", "https", "storage", "advisory"],
    predicate: () => false,
  }),

  // 20. CKV_AZURE_44 — Storage latest TLS (alias of CKV_AZURE_2)
  nodeRule({
    id: "CHECKOV.AZURE.44",
    source: checkovSrc("CKV_AZURE_44"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message:
      "Storage Account should require the latest TLS version (1.2 or newer).",
    longExplanation:
      "Checkov CKV_AZURE_44 enforces the same rule as CKV_AZURE_2: every Storage Account must require TLS 1.2 or newer. Both checks ship in Checkov for historical reasons, so we encode both for traceability.",
    tags: ["checkov", "tls", "storage"],
    predicate: (n) => getProp<string>(n, "minTlsVersion") !== "1.2",
  }),

  // 21. CKV_AZURE_50 — Function App authentication (advisory)
  nodeRule({
    id: "CHECKOV.AZURE.50",
    source: checkovSrc("CKV_AZURE_50"),
    category: "identity",
    severity: "warning",
    serviceTypes: ["functionApp"],
    message: "[advisory] Function App should have authentication enabled.",
    longExplanation:
      "Checkov CKV_AZURE_50 requires Function App authentication (Easy Auth) to be enabled so anonymous traffic is rejected. Bunya does not yet model the auth settings block on Function Apps.",
    tags: ["checkov", "identity", "function-app", "advisory"],
    predicate: () => false,
  }),

  // 22. CKV_AZURE_56 — Function App HTTP version (advisory)
  nodeRule({
    id: "CHECKOV.AZURE.56",
    source: checkovSrc("CKV_AZURE_56"),
    category: "data-protection",
    severity: "warning",
    serviceTypes: ["functionApp"],
    message:
      "[advisory] Function App should use the latest HTTP version (HTTP/2).",
    longExplanation:
      "Checkov CKV_AZURE_56 requires the Function App site config `http20Enabled = true`. Bunya does not yet model this site config setting.",
    tags: ["checkov", "http2", "function-app", "advisory"],
    predicate: () => false,
  }),

  // 23. CKV_AZURE_71 — App Service managed identity enabled (advisory; Bunya always sets system-assigned)
  nodeRule({
    id: "CHECKOV.AZURE.71",
    source: checkovSrc("CKV_AZURE_71"),
    category: "identity",
    severity: "warning",
    serviceTypes: ["appService"],
    message:
      "[advisory] App Service should have a managed identity assigned.",
    longExplanation:
      "Checkov CKV_AZURE_71 requires App Services to use a system-assigned or user-assigned managed identity to avoid embedding credentials. Bunya always provisions a system-assigned identity, so this rule is surfaced as advisory only.",
    tags: ["checkov", "identity", "managed-identity", "advisory"],
    predicate: () => false,
  }),

  // 24. CKV_AZURE_88 — App Service network access restriction
  nodeRule({
    id: "CHECKOV.AZURE.88",
    source: checkovSrc("CKV_AZURE_88"),
    category: "network",
    severity: "warning",
    serviceTypes: ["appService"],
    message:
      "App Service should restrict network access via VNet integration or by disabling public network access.",
    longExplanation:
      "Checkov CKV_AZURE_88 flags App Services that are reachable from the public internet without any access restriction. Bunya considers either `vnetIntegration = true` or `publicNetworkAccess = false` sufficient to satisfy this control.",
    tags: ["checkov", "network", "app-service"],
    predicate: (n) => {
      const vnet = getProp<boolean>(n, "vnetIntegration") === true;
      const publicDisabled = getProp<boolean>(n, "publicNetworkAccess") === false;
      return !(vnet || publicDisabled);
    },
  }),

  // 25. CKV_AZURE_94 — API Management public access (advisory)
  nodeRule({
    id: "CHECKOV.AZURE.94",
    source: checkovSrc("CKV_AZURE_94"),
    category: "network",
    severity: "warning",
    serviceTypes: ["apiManagement"],
    message:
      "[advisory] API Management public access should be reviewed; consider internal VNet mode for sensitive APIs.",
    longExplanation:
      "Checkov CKV_AZURE_94 warns when API Management is exposed to the public internet without restriction. Bunya does not yet model APIM virtual network mode.",
    tags: ["checkov", "apim", "public-access", "advisory"],
    predicate: () => false,
  }),

  // 26. CKV_AZURE_109 — Key Vault public network access disabled
  nodeRule({
    id: "CHECKOV.AZURE.109",
    source: checkovSrc("CKV_AZURE_109"),
    category: "network",
    severity: "error",
    serviceTypes: ["keyVault"],
    message: "Key Vault must disable public network access.",
    longExplanation:
      "Checkov CKV_AZURE_109 requires Key Vault `publicNetworkAccess = Disabled` so that secrets are reachable only through Private Endpoints or service firewall allow-lists.",
    tags: ["checkov", "key-vault", "public-access"],
    predicate: (n) => getProp<boolean>(n, "publicNetworkAccess") === true,
  }),

  // 27. CKV_AZURE_110 — Key Vault purge protection (duplicate of CKV_AZURE_42; encoded for traceability)
  nodeRule({
    id: "CHECKOV.AZURE.110",
    source: checkovSrc("CKV_AZURE_110"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["keyVault"],
    message:
      "Key Vault must have purge protection enabled (duplicate of CKV_AZURE_42).",
    longExplanation:
      "Checkov CKV_AZURE_110 restates the requirement from CKV_AZURE_42 that Key Vaults must enable purge protection. Both rules ship in Checkov; Bunya encodes both with distinct IDs so findings can be traced back to the upstream catalogue.",
    tags: ["checkov", "key-vault", "purge-protection"],
    predicate: (n) => getProp<boolean>(n, "purgeProtection") === false,
  }),

  // 28. CKV_AZURE_137 — ACR admin user disabled
  nodeRule({
    id: "CHECKOV.AZURE.137",
    source: checkovSrc("CKV_AZURE_137"),
    category: "identity",
    severity: "error",
    serviceTypes: ["containerRegistry"],
    message: "Container Registry must have the admin user disabled.",
    longExplanation:
      "Checkov CKV_AZURE_137 requires `adminUserEnabled = false` on every Azure Container Registry. The admin user is a shared credential and bypasses RBAC and managed identities, so it must remain disabled.",
    tags: ["checkov", "acr", "identity"],
    predicate: (n) => getProp<boolean>(n, "adminUserEnabled") === true,
  }),

  // 29. CKV_AZURE_138 — ACR retention policy (advisory)
  nodeRule({
    id: "CHECKOV.AZURE.138",
    source: checkovSrc("CKV_AZURE_138"),
    category: "compliance",
    severity: "warning",
    serviceTypes: ["containerRegistry"],
    message:
      "[advisory] Container Registry should have a retention policy configured.",
    longExplanation:
      "Checkov CKV_AZURE_138 requires the ACR retention policy block to be enabled so untagged manifests are reclaimed after a defined window. Bunya does not yet model the retention policy block.",
    tags: ["checkov", "acr", "retention", "advisory"],
    predicate: () => false,
  }),

  // 30. CKV_AZURE_139 — ACR public network access disabled
  nodeRule({
    id: "CHECKOV.AZURE.139",
    source: checkovSrc("CKV_AZURE_139"),
    category: "network",
    severity: "error",
    serviceTypes: ["containerRegistry"],
    message: "Container Registry must disable public network access.",
    longExplanation:
      "Checkov CKV_AZURE_139 requires ACR `publicNetworkAccess = Disabled` so images can only be pulled through Private Endpoints or trusted Microsoft services.",
    tags: ["checkov", "acr", "public-access"],
    predicate: (n) => getProp<boolean>(n, "publicNetworkAccess") === true,
  }),

  // 31. CKV_AZURE_140 — Cosmos firewall (publicNetworkAccess false advisory)
  nodeRule({
    id: "CHECKOV.AZURE.140",
    source: checkovSrc("CKV_AZURE_140"),
    category: "network",
    severity: "warning",
    serviceTypes: ["cosmosDb"],
    message:
      "[advisory] Cosmos DB account should disable public network access and rely on Private Endpoints.",
    longExplanation:
      "Checkov CKV_AZURE_140 requires Cosmos DB `publicNetworkAccess = Disabled` along with firewall rules. Bunya does not yet model the publicNetworkAccess property on Cosmos accounts.",
    tags: ["checkov", "cosmos", "public-access", "advisory"],
    predicate: () => false,
  }),
];
