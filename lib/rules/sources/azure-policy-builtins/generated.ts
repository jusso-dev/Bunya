// Generated from the Azure Policy built-in definitions catalogue, pinned at the
// 2026-04-01 snapshot. This file is hand-curated but lives behind the same
// `import.ts` stub that the fetcher script will overwrite when run online. Do
// not edit individual rules here — re-run the generator if you need to refresh
// the set.
import { graphRule, nodeRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";

const AZURE_POLICY_DOCS =
  "https://learn.microsoft.com/en-us/azure/governance/policy/samples/built-in-policies";

function policySrc(displayName: string) {
  return {
    name: "Azure Policy built-ins",
    license: "MIT",
    url: AZURE_POLICY_DOCS,
    ruleId: displayName,
    version: "2026-04-01",
  } as const;
}

function getProp<T = unknown>(
  node: { properties: Record<string, unknown> },
  key: string,
): T | undefined {
  return node.properties[key] as T | undefined;
}

export const AZURE_POLICY_RULES: RuleEntry[] = [
  // 1. AZPOL.STG.SECURE-TRANSFER — Secure transfer to storage accounts should be enabled (advisory)
  nodeRule({
    id: "AZPOL.STG.SECURE-TRANSFER",
    source: policySrc(
      "Secure transfer to storage accounts should be enabled",
    ),
    category: "data-protection",
    severity: "warning",
    serviceTypes: ["storageAccount"],
    message:
      "[advisory] Secure transfer (HTTPS only) should be enabled on Storage Accounts.",
    longExplanation:
      "Azure Policy built-in *Secure transfer to storage accounts should be enabled* enforces `supportsHttpsTrafficOnly = true`. Bunya does not currently model this property; new accounts default to true, so this rule is surfaced as advisory only.",
    tags: ["azure-policy", "storage", "https", "advisory"],
    predicate: () => false,
  }),

  // 2. AZPOL.STG.PUBLIC-ACCESS — Storage accounts should disable public network access
  nodeRule({
    id: "AZPOL.STG.PUBLIC-ACCESS",
    source: policySrc(
      "Storage accounts should disable public network access",
    ),
    category: "network",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message: "Storage Account must disable public network access.",
    longExplanation:
      "Azure Policy built-in *Storage accounts should disable public network access* requires `publicNetworkAccess` to be `Disabled`. Bunya models the equivalent flag as `allowPublicAccess`.",
    tags: ["azure-policy", "storage", "public-access"],
    predicate: (n) => getProp<boolean>(n, "allowPublicAccess") === true,
  }),

  // 3. AZPOL.STG.MIN-TLS — Storage accounts should have the specified minimum TLS version (1.2)
  nodeRule({
    id: "AZPOL.STG.MIN-TLS",
    source: policySrc(
      "Storage accounts should have the specified minimum TLS version",
    ),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message: "Storage Account must use minimum TLS version 1.2.",
    longExplanation:
      "Azure Policy built-in *Storage accounts should have the specified minimum TLS version* requires `minimumTlsVersion = TLS1_2`. Older TLS versions are deprecated and weak.",
    tags: ["azure-policy", "storage", "tls"],
    predicate: (n) => getProp<string>(n, "minTlsVersion") !== "1.2",
  }),

  // 4. AZPOL.WEB.HTTPS-ONLY — App Service apps should only be accessible over HTTPS
  nodeRule({
    id: "AZPOL.WEB.HTTPS-ONLY",
    source: policySrc(
      "App Service apps should only be accessible over HTTPS",
    ),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["appService"],
    message: "App Service must require HTTPS-only access.",
    longExplanation:
      "Azure Policy built-in *App Service apps should only be accessible over HTTPS* requires `httpsOnly = true`. HTTP traffic must be redirected so credentials and tokens cannot leak in transit.",
    tags: ["azure-policy", "app-service", "https"],
    predicate: (n) => getProp<boolean>(n, "httpsOnly") === false,
  }),

  // 5. AZPOL.WEB.LATEST-TLS — Latest TLS version should be used in your Web App
  nodeRule({
    id: "AZPOL.WEB.LATEST-TLS",
    source: policySrc(
      "Latest TLS version should be used in your Web App",
    ),
    category: "data-protection",
    severity: "warning",
    serviceTypes: ["appService"],
    message:
      "[advisory] App Service should use the latest TLS version (1.2 or newer).",
    longExplanation:
      "Azure Policy built-in *Latest TLS version should be used in your Web App* requires the site config `minTlsVersion` to be 1.2 or newer. Bunya does not yet model that site config setting.",
    tags: ["azure-policy", "app-service", "tls", "advisory"],
    predicate: () => false,
  }),

  // 6. AZPOL.WEB.MANAGED-IDENTITY — App Service apps should use managed identity (advisory)
  nodeRule({
    id: "AZPOL.WEB.MANAGED-IDENTITY",
    source: policySrc("App Service apps should use managed identity"),
    category: "identity",
    severity: "warning",
    serviceTypes: ["appService"],
    message: "[advisory] App Service should use a managed identity.",
    longExplanation:
      "Azure Policy built-in *App Service apps should use managed identity* requires `identity.type` to include `SystemAssigned` or `UserAssigned`. Bunya always provisions a system-assigned identity, so this rule is surfaced as advisory only.",
    tags: ["azure-policy", "app-service", "managed-identity", "advisory"],
    predicate: () => false,
  }),

  // 7. AZPOL.FN.HTTPS-ONLY — Function apps should only be accessible over HTTPS
  nodeRule({
    id: "AZPOL.FN.HTTPS-ONLY",
    source: policySrc(
      "Function apps should only be accessible over HTTPS",
    ),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["functionApp"],
    message: "Function App must require HTTPS-only access.",
    longExplanation:
      "Azure Policy built-in *Function apps should only be accessible over HTTPS* requires `httpsOnly = true` on every Function App so triggers and admin endpoints cannot be reached over plaintext.",
    tags: ["azure-policy", "function-app", "https"],
    predicate: (n) => getProp<boolean>(n, "httpsOnly") === false,
  }),

  // 8. AZPOL.FN.LATEST-TLS — Latest TLS version should be used in your Function App
  nodeRule({
    id: "AZPOL.FN.LATEST-TLS",
    source: policySrc(
      "Latest TLS version should be used in your Function App",
    ),
    category: "data-protection",
    severity: "warning",
    serviceTypes: ["functionApp"],
    message:
      "[advisory] Function App should use the latest TLS version (1.2 or newer).",
    longExplanation:
      "Azure Policy built-in *Latest TLS version should be used in your Function App* requires the site config `minTlsVersion` to be 1.2 or newer. Bunya does not yet model that site config setting.",
    tags: ["azure-policy", "function-app", "tls", "advisory"],
    predicate: () => false,
  }),

  // 9. AZPOL.SQL.AAD-AUTH — Azure SQL Database should have Microsoft Entra-only authentication (advisory)
  nodeRule({
    id: "AZPOL.SQL.AAD-AUTH",
    source: policySrc(
      "Azure SQL Database should have Microsoft Entra-only authentication enabled",
    ),
    category: "identity",
    severity: "warning",
    serviceTypes: ["sqlDatabase"],
    message:
      "[advisory] Azure SQL should use Microsoft Entra-only authentication.",
    longExplanation:
      "Azure Policy built-in *Azure SQL Database should have Microsoft Entra-only authentication enabled* requires the SQL Server to disable SQL authentication. Bunya does not yet model the Entra-only flag.",
    tags: ["azure-policy", "sql", "entra", "advisory"],
    predicate: () => false,
  }),

  // 10. AZPOL.SQL.TDE — Transparent Data Encryption on SQL databases should be enabled (advisory)
  nodeRule({
    id: "AZPOL.SQL.TDE",
    source: policySrc(
      "Transparent Data Encryption on SQL databases should be enabled",
    ),
    category: "data-protection",
    severity: "warning",
    serviceTypes: ["sqlDatabase"],
    message:
      "[advisory] Transparent Data Encryption (TDE) should be enabled on SQL databases.",
    longExplanation:
      "Azure Policy built-in *Transparent Data Encryption on SQL databases should be enabled* requires TDE to be on. Azure enables TDE by default for new databases; Bunya does not yet model the TDE flag.",
    tags: ["azure-policy", "sql", "encryption", "advisory"],
    predicate: () => false,
  }),

  // 11. AZPOL.SQL.PUBLIC-ACCESS — Public network access on Azure SQL Database should be disabled (advisory)
  nodeRule({
    id: "AZPOL.SQL.PUBLIC-ACCESS",
    source: policySrc(
      "Public network access on Azure SQL Database should be disabled",
    ),
    category: "network",
    severity: "warning",
    serviceTypes: ["sqlDatabase"],
    message:
      "[advisory] Azure SQL Server should disable public network access.",
    longExplanation:
      "Azure Policy built-in *Public network access on Azure SQL Database should be disabled* requires `publicNetworkAccess = Disabled` on the SQL Server. Bunya models the database but not the parent server's public access flag.",
    tags: ["azure-policy", "sql", "public-access", "advisory"],
    predicate: () => false,
  }),

  // 12. AZPOL.COS.PUBLIC-ACCESS — Public network access should be disabled for Cosmos DB (advisory)
  nodeRule({
    id: "AZPOL.COS.PUBLIC-ACCESS",
    source: policySrc(
      "Azure Cosmos DB accounts should have public network access disabled",
    ),
    category: "network",
    severity: "warning",
    serviceTypes: ["cosmosDb"],
    message:
      "[advisory] Cosmos DB account should disable public network access.",
    longExplanation:
      "Azure Policy built-in *Azure Cosmos DB accounts should have public network access disabled* requires `publicNetworkAccess = Disabled`. Bunya does not yet model this property on Cosmos accounts.",
    tags: ["azure-policy", "cosmos", "public-access", "advisory"],
    predicate: () => false,
  }),

  // 13. AZPOL.KV.FIREWALL — Azure Key Vault should have firewall enabled
  nodeRule({
    id: "AZPOL.KV.FIREWALL",
    source: policySrc("Azure Key Vault should have firewall enabled"),
    category: "network",
    severity: "error",
    serviceTypes: ["keyVault"],
    message: "Key Vault must disable public network access (firewall on).",
    longExplanation:
      "Azure Policy built-in *Azure Key Vault should have firewall enabled* requires `publicNetworkAccess = Disabled` (or a tight `networkAcls` block). Bunya models this as the `publicNetworkAccess` boolean.",
    tags: ["azure-policy", "key-vault", "firewall"],
    predicate: (n) => getProp<boolean>(n, "publicNetworkAccess") === true,
  }),

  // 14. AZPOL.KV.PURGE-PROTECT — Key vaults should have purge protection enabled
  nodeRule({
    id: "AZPOL.KV.PURGE-PROTECT",
    source: policySrc("Key vaults should have purge protection enabled"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["keyVault"],
    message: "Key Vault must have purge protection enabled.",
    longExplanation:
      "Azure Policy built-in *Key vaults should have purge protection enabled* requires `enablePurgeProtection = true`. Without purge protection, soft-deleted material can be permanently destroyed within the retention window.",
    tags: ["azure-policy", "key-vault", "purge-protection"],
    predicate: (n) => getProp<boolean>(n, "purgeProtection") === false,
  }),

  // 15. AZPOL.KV.SOFT-DELETE — Key vaults should have soft delete enabled (retention days set)
  nodeRule({
    id: "AZPOL.KV.SOFT-DELETE",
    source: policySrc("Key vaults should have soft delete enabled"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["keyVault"],
    message:
      "Key Vault must have soft-delete retention set to at least 7 days.",
    longExplanation:
      "Azure Policy built-in *Key vaults should have soft delete enabled* requires soft-delete to be enabled and a retention period configured. Bunya models the retention as `softDeleteRetentionDays`; a value below 7 days fails this control.",
    tags: ["azure-policy", "key-vault", "soft-delete"],
    predicate: (n) => {
      const days = getProp<number>(n, "softDeleteRetentionDays");
      return typeof days !== "number" || days < 7;
    },
  }),

  // 16. AZPOL.SNET.NSG — Subnets should be associated with a Network Security Group
  nodeRule({
    id: "AZPOL.SNET.NSG",
    source: policySrc(
      "Subnets should be associated with a Network Security Group",
    ),
    category: "network",
    severity: "warning",
    serviceTypes: ["subnet"],
    message:
      "Subnet should be associated with a Network Security Group.",
    longExplanation:
      "Azure Policy built-in *Subnets should be associated with a Network Security Group* requires every non-gateway subnet to reference an NSG so that ingress and egress are filtered. Bunya flags a subnet when no NSG edge targets it.",
    tags: ["azure-policy", "subnet", "nsg"],
    predicate: (n, graph) => {
      const hasNsg = graph.edges.some((e) => {
        if (e.target !== n.id) return false;
        const src = graph.nodes.find((sn) => sn.id === e.source);
        return src?.type === "networkSecurityGroup";
      });
      return !hasNsg;
    },
  }),

  // 17. AZPOL.DIAG.LOG-ANALYTICS — Resource logs should be enabled (graph-wide check)
  graphRule({
    id: "AZPOL.DIAG.LOG-ANALYTICS",
    source: policySrc("Resource logs should be enabled"),
    category: "compliance",
    severity: "warning",
    message:
      "AppService, SQL and Key Vault resources should ship diagnostic logs to a Log Analytics workspace.",
    longExplanation:
      "Azure Policy built-in *Resource logs should be enabled* requires diagnostic settings to be configured for in-scope resources. Bunya checks that App Services, SQL databases and Key Vaults have at least one `diagnostic` edge to a Log Analytics workspace.",
    tags: ["azure-policy", "diagnostics", "log-analytics"],
    appliesToServices: ["appService", "sqlDatabase", "keyVault"],
    predicate: (graph) => {
      const inScope = new Set(["appService", "sqlDatabase", "keyVault"]);
      return graph.nodes
        .filter((n) => inScope.has(n.type))
        .filter((n) => {
          const hasDiag = graph.edges.some((e) => {
            if (e.source !== n.id) return false;
            if (e.kind !== "diagnostic") return false;
            const target = graph.nodes.find((tn) => tn.id === e.target);
            return target?.type === "logAnalytics";
          });
          return !hasDiag;
        })
        .map((n) => ({
          nodeIds: [n.id],
          message: `${n.type} ${n.name} has no diagnostic edge to a Log Analytics workspace.`,
        }));
    },
  }),

  // 18. AZPOL.ACR.PRIVATE-LINK — ACR should use private link (publicNetworkAccess false)
  nodeRule({
    id: "AZPOL.ACR.PRIVATE-LINK",
    source: policySrc(
      "Container registries should use private link",
    ),
    category: "network",
    severity: "error",
    serviceTypes: ["containerRegistry"],
    message:
      "Container Registry must disable public network access (use Private Link).",
    longExplanation:
      "Azure Policy built-in *Container registries should use private link* requires `publicNetworkAccess = Disabled` and a Private Endpoint. Bunya enforces the public-access part here; Private Endpoint topology is checked elsewhere.",
    tags: ["azure-policy", "acr", "private-link"],
    predicate: (n) => getProp<boolean>(n, "publicNetworkAccess") === true,
  }),

  // 19. AZPOL.APIM.MIN-API-VERSION — API Management minimum API version (advisory)
  nodeRule({
    id: "AZPOL.APIM.MIN-API-VERSION",
    source: policySrc(
      "API Management minimum API version should be 2019-12-01 or newer",
    ),
    category: "compliance",
    severity: "warning",
    serviceTypes: ["apiManagement"],
    message:
      "[advisory] API Management should require management API version 2019-12-01 or newer.",
    longExplanation:
      "Azure Policy built-in *API Management minimum API version should be 2019-12-01 or newer* requires the `apiVersionConstraint.minApiVersion` to be at least 2019-12-01 so older, less-secure ARM operations are rejected. Bunya does not yet model this constraint.",
    tags: ["azure-policy", "apim", "compliance", "advisory"],
    predicate: () => false,
  }),

  // 20. AZPOL.AGW.WAF — Web Application Firewall should be enabled for Application Gateway
  nodeRule({
    id: "AZPOL.AGW.WAF",
    source: policySrc(
      "Web Application Firewall (WAF) should be enabled for Application Gateway",
    ),
    category: "network",
    severity: "error",
    serviceTypes: ["applicationGateway"],
    message:
      "Application Gateway must use the WAF_v2 SKU to enable the Web Application Firewall.",
    longExplanation:
      "Azure Policy built-in *Web Application Firewall (WAF) should be enabled for Application Gateway* requires the gateway SKU to be `WAF_v2` (or `WAF_Medium`/`WAF_Large` on the legacy stack). Bunya considers anything other than `WAF_v2` a fail.",
    tags: ["azure-policy", "application-gateway", "waf"],
    predicate: (n) => getProp<string>(n, "sku") !== "WAF_v2",
  }),
];
