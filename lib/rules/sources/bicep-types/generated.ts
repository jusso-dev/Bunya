// Generated from Azure/bicep-types-az@main. Each entry distills a single
// enum / required-property / value-range constraint encoded in the upstream
// type schema (generated/<provider>) into a Bunya RuleEntry whose predicate
// inspects GraphNode.properties. Do not hand-edit; rerun the importer.
import { nodeRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";
import type { GraphNode } from "@/lib/graph/schema";

const BICEP_BASE = {
  name: "Bicep types",
  license: "MIT",
  version: "main",
} as const;

function bicepSource(provider: string, ruleId: string) {
  return {
    ...BICEP_BASE,
    url: `https://github.com/Azure/bicep-types-az/tree/main/generated/${provider}`,
    ruleId,
  };
}

// Read a property tolerantly. Missing properties don't fire a violation —
// the rule only flags an explicitly-set out-of-enum / out-of-range value.
function getProp<T = unknown>(node: GraphNode, key: string): T | undefined {
  return node.properties[key] as T | undefined;
}

const STG_SKUS = [
  "Standard_LRS",
  "Standard_ZRS",
  "Standard_GRS",
  "Standard_RAGRS",
  "Premium_LRS",
] as const;
const STG_KINDS = ["StorageV2", "BlobStorage", "FileStorage"] as const;
const STG_TLS = ["TLS1_0", "TLS1_1", "TLS1_2", "1.0", "1.1", "1.2"] as const;
const SQL_TLS = ["1.0", "1.1", "1.2", "None"] as const;
const COSMOS_CONSISTENCY = [
  "Eventual",
  "Session",
  "BoundedStaleness",
  "Strong",
  "ConsistentPrefix",
] as const;
const KV_SKUS = ["standard", "premium"] as const;
const ACR_SKUS = ["Basic", "Standard", "Premium"] as const;
const AGW_SKUS = ["Standard_v2", "WAF_v2"] as const;
const FD_SKUS = ["Standard_AzureFrontDoor", "Premium_AzureFrontDoor"] as const;
const APIM_SKUS = ["Consumption", "Developer", "Basic", "Standard", "Premium"] as const;
const LA_SKUS = [
  "PerGB2018",
  "Free",
  "Standalone",
  "PerNode",
  "Premium",
  "Standard",
  "CapacityReservation",
  "LACluster",
] as const;
const AI_KINDS = ["web", "other"] as const;

const notIn = <T extends string>(value: unknown, allowed: readonly T[]): boolean =>
  typeof value === "string" && !(allowed as readonly string[]).includes(value);

export const BICEP_TYPE_RULES: RuleEntry[] = [
  // 1. Storage Account sku.name
  nodeRule({
    id: "BICEP.STG.SKU",
    source: bicepSource("microsoft.storage", "Microsoft.Storage/storageAccounts@2023-05-01"),
    category: "reliability",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message:
      "Storage Account sku must be one of Standard_LRS, Standard_ZRS, Standard_GRS, Standard_RAGRS, Premium_LRS.",
    longExplanation:
      "The bicep-types schema for Microsoft.Storage/storageAccounts@2023-05-01 declares sku.name as an enum. Values outside the enum fail ARM validation at deployment time.",
    tags: ["bicep-types", "storage", "sku"],
    predicate: (n) => notIn(getProp(n, "sku"), STG_SKUS),
  }),

  // 2. Storage Account kind
  nodeRule({
    id: "BICEP.STG.KIND",
    source: bicepSource("microsoft.storage", "Microsoft.Storage/storageAccounts@2023-05-01"),
    category: "reliability",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message: "Storage Account kind must be one of StorageV2, BlobStorage, FileStorage.",
    longExplanation:
      "The bicep-types schema for Microsoft.Storage/storageAccounts@2023-05-01 declares kind as an enum. Bunya restricts the value to the modern general-purpose / blob / file kinds — legacy Storage and BlockBlobStorage are intentionally omitted.",
    tags: ["bicep-types", "storage", "kind"],
    predicate: (n) => notIn(getProp(n, "kind"), STG_KINDS),
  }),

  // 3. Storage Account minimumTlsVersion
  nodeRule({
    id: "BICEP.STG.TLS",
    source: bicepSource("microsoft.storage", "Microsoft.Storage/storageAccounts@2023-05-01"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message: "Storage Account minimumTlsVersion must be one of TLS1_0, TLS1_1, TLS1_2.",
    longExplanation:
      "The bicep-types schema for Microsoft.Storage/storageAccounts@2023-05-01 declares minimumTlsVersion as an enum (TLS1_0/TLS1_1/TLS1_2). Bunya also accepts the catalogue's short form (1.0/1.1/1.2).",
    tags: ["bicep-types", "storage", "tls"],
    predicate: (n) => notIn(getProp(n, "minTlsVersion"), STG_TLS),
  }),

  // 4. App Service plan-os via runtime — runtime must indicate one of the supported runtimes
  nodeRule({
    id: "BICEP.WEB.PLAN-OS",
    source: bicepSource("microsoft.web", "Microsoft.Web/sites@2023-12-01"),
    category: "reliability",
    severity: "warning",
    serviceTypes: ["appService"],
    message: "App Service runtime must be one of node, python, dotnet, java.",
    longExplanation:
      "The bicep-types schema for Microsoft.Web/sites@2023-12-01 derives the kind ('app,linux' vs 'app') from the host OS. Bunya only ships first-party runtimes (node, python, dotnet, java); anything else implies an unsupported plan-OS combination.",
    tags: ["bicep-types", "appservice", "kind"],
    predicate: (n) => notIn(getProp(n, "runtime"), ["node", "python", "dotnet", "java"] as const),
  }),

  // 5. App Service linuxFxVersion — runtimeVersion must be non-empty so the
  //    derived siteConfig.linuxFxVersion ('NODE|<v>' / 'PYTHON|<v>' / 'DOTNETCORE|<v>')
  //    is well-formed.
  nodeRule({
    id: "BICEP.WEB.RUNTIME",
    source: bicepSource("microsoft.web", "Microsoft.Web/sites@2023-12-01"),
    category: "reliability",
    severity: "warning",
    serviceTypes: ["appService"],
    message: "App Service runtimeVersion is required so siteConfig.linuxFxVersion can be derived.",
    longExplanation:
      "The bicep-types schema for Microsoft.Web/sites@2023-12-01 declares siteConfig.linuxFxVersion as a string; the canonical form is '<RUNTIME>|<VERSION>' (e.g. NODE|20-lts, PYTHON|3.12, DOTNETCORE|8.0). Bunya derives that string from the runtimeVersion property, so an empty value would emit an invalid linuxFxVersion.",
    tags: ["bicep-types", "appservice", "runtime"],
    predicate: (n) => {
      const v = getProp<string>(n, "runtimeVersion");
      return typeof v === "string" && v.trim().length === 0;
    },
  }),

  // 6. Function App FUNCTIONS_EXTENSION_VERSION — runtimeVersion encodes the
  //    runtime stack version; only Functions v3 / v4 are supported.
  nodeRule({
    id: "BICEP.FN.FUNCTIONS-VERSION",
    source: bicepSource("microsoft.web", "Microsoft.Web/sites@2023-12-01"),
    category: "reliability",
    severity: "warning",
    serviceTypes: ["functionApp"],
    message: "Function App runtimeVersion must target Functions host v3 or v4.",
    longExplanation:
      "The bicep-types schema for Microsoft.Web/sites (functions kind) at apiVersion 2023-12-01 derives the FUNCTIONS_EXTENSION_VERSION app setting from the runtime stack. Microsoft only supports ~3 and ~4 for new deployments; older majors fail validation.",
    tags: ["bicep-types", "functions", "version"],
    predicate: (n) => {
      const v = getProp<string>(n, "runtimeVersion");
      if (typeof v !== "string" || v.length === 0) return false;
      // Accept the catalogue's bare-major form ('3','4','20') as well as the
      // canonical FUNCTIONS_EXTENSION_VERSION form ('~3','~4'). Anything else
      // is flagged as out of range.
      if (v === "~3" || v === "~4") return false;
      const major = Number.parseInt(v, 10);
      if (Number.isNaN(major)) return false;
      // Allow node major versions (16/18/20/22) — they map to ~4 implicitly.
      if (major >= 16) return false;
      return major < 3 || major > 4;
    },
  }),

  // 7. SQL Server minimalTlsVersion
  nodeRule({
    id: "BICEP.SQL.TLS",
    source: bicepSource("microsoft.sql", "Microsoft.Sql/servers@2023-08-01-preview"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["sqlDatabase"],
    message: "SQL Server minimalTlsVersion must be one of 1.0, 1.1, 1.2, None.",
    longExplanation:
      "The bicep-types schema for Microsoft.Sql/servers@2023-08-01-preview declares minimalTlsVersion as an enum: '1.0' | '1.1' | '1.2' | 'None'. Bunya stores the value on the sqlDatabase node; the rule only fires when it is explicitly set to an out-of-enum value.",
    tags: ["bicep-types", "sql", "tls"],
    predicate: (n) => {
      const v = getProp(n, "minimalTlsVersion");
      if (v === undefined || v === null) return false;
      return notIn(v, SQL_TLS);
    },
  }),

  // 8. SQL Server version — fixed at 12.0
  nodeRule({
    id: "BICEP.SQL.VERSION",
    source: bicepSource("microsoft.sql", "Microsoft.Sql/servers@2023-08-01-preview"),
    category: "reliability",
    severity: "error",
    serviceTypes: ["sqlDatabase"],
    message: "SQL Server version must be 12.0.",
    longExplanation:
      "The bicep-types schema for Microsoft.Sql/servers@2023-08-01-preview pins the server version to '12.0'. Any other value fails ARM validation.",
    tags: ["bicep-types", "sql", "version"],
    predicate: (n) => {
      const v = getProp(n, "version");
      if (v === undefined || v === null) return false;
      return v !== "12.0";
    },
  }),

  // 9. Cosmos DB databaseAccountOfferType
  nodeRule({
    id: "BICEP.COS.OFFER",
    source: bicepSource(
      "microsoft.documentdb",
      "Microsoft.DocumentDB/databaseAccounts@2024-05-15",
    ),
    category: "reliability",
    severity: "error",
    serviceTypes: ["cosmosDb"],
    message: "Cosmos DB databaseAccountOfferType must be 'Standard'.",
    longExplanation:
      "The bicep-types schema for Microsoft.DocumentDB/databaseAccounts@2024-05-15 pins databaseAccountOfferType to the single allowed value 'Standard'. Any other value fails ARM validation.",
    tags: ["bicep-types", "cosmos", "offer"],
    predicate: (n) => {
      const v = getProp(n, "databaseAccountOfferType");
      if (v === undefined || v === null) return false;
      return v !== "Standard";
    },
  }),

  // 10. Cosmos DB consistencyPolicy.defaultConsistencyLevel
  nodeRule({
    id: "BICEP.COS.CONSISTENCY",
    source: bicepSource(
      "microsoft.documentdb",
      "Microsoft.DocumentDB/databaseAccounts@2024-05-15",
    ),
    category: "reliability",
    severity: "error",
    serviceTypes: ["cosmosDb"],
    message:
      "Cosmos DB defaultConsistencyLevel must be one of Eventual, Session, BoundedStaleness, Strong, ConsistentPrefix.",
    longExplanation:
      "The bicep-types schema for Microsoft.DocumentDB/databaseAccounts@2024-05-15 declares consistencyPolicy.defaultConsistencyLevel as an enum. Bunya stores it as the cosmosDb.consistency property.",
    tags: ["bicep-types", "cosmos", "consistency"],
    predicate: (n) => notIn(getProp(n, "consistency"), COSMOS_CONSISTENCY),
  }),

  // 11. Key Vault sku.name
  nodeRule({
    id: "BICEP.KV.SKU",
    source: bicepSource("microsoft.keyvault", "Microsoft.KeyVault/vaults@2023-07-01"),
    category: "reliability",
    severity: "error",
    serviceTypes: ["keyVault"],
    message: "Key Vault sku.name must be 'standard' or 'premium'.",
    longExplanation:
      "The bicep-types schema for Microsoft.KeyVault/vaults@2023-07-01 declares sku.name as an enum ('standard' | 'premium').",
    tags: ["bicep-types", "keyvault", "sku"],
    predicate: (n) => notIn(getProp(n, "sku"), KV_SKUS),
  }),

  // 12. Key Vault softDeleteRetentionInDays — 7..90
  nodeRule({
    id: "BICEP.KV.SOFT-DELETE-RANGE",
    source: bicepSource("microsoft.keyvault", "Microsoft.KeyVault/vaults@2023-07-01"),
    category: "data-protection",
    severity: "error",
    serviceTypes: ["keyVault"],
    message: "Key Vault softDeleteRetentionInDays must be between 7 and 90.",
    longExplanation:
      "The bicep-types schema for Microsoft.KeyVault/vaults@2023-07-01 declares softDeleteRetentionInDays as an integer in the inclusive range 7..90.",
    tags: ["bicep-types", "keyvault", "retention"],
    predicate: (n) => {
      const v = getProp<number>(n, "softDeleteRetentionDays");
      if (typeof v !== "number") return false;
      return v < 7 || v > 90;
    },
  }),

  // 13. Container Registry sku.name
  nodeRule({
    id: "BICEP.ACR.SKU",
    source: bicepSource(
      "microsoft.containerregistry",
      "Microsoft.ContainerRegistry/registries@2023-11-01-preview",
    ),
    category: "reliability",
    severity: "error",
    serviceTypes: ["containerRegistry"],
    message: "Container Registry sku.name must be Basic, Standard, or Premium.",
    longExplanation:
      "The bicep-types schema for Microsoft.ContainerRegistry/registries@2023-11-01-preview declares sku.name as an enum ('Basic' | 'Standard' | 'Premium').",
    tags: ["bicep-types", "acr", "sku"],
    predicate: (n) => notIn(getProp(n, "sku"), ACR_SKUS),
  }),

  // 14. Application Gateway sku.name
  nodeRule({
    id: "BICEP.AGW.SKU",
    source: bicepSource(
      "microsoft.network",
      "Microsoft.Network/applicationGateways@2023-09-01",
    ),
    category: "reliability",
    severity: "error",
    serviceTypes: ["applicationGateway"],
    message: "Application Gateway sku.name must be Standard_v2 or WAF_v2.",
    longExplanation:
      "The bicep-types schema for Microsoft.Network/applicationGateways@2023-09-01 restricts sku.name to the v2 SKUs (Standard_v2 | WAF_v2) for new deployments. v1 SKUs are deprecated and explicitly excluded by Bunya.",
    tags: ["bicep-types", "appgw", "sku"],
    predicate: (n) => notIn(getProp(n, "sku"), AGW_SKUS),
  }),

  // 15. Application Gateway capacity — 1..125
  nodeRule({
    id: "BICEP.AGW.CAPACITY",
    source: bicepSource(
      "microsoft.network",
      "Microsoft.Network/applicationGateways@2023-09-01",
    ),
    category: "reliability",
    severity: "error",
    serviceTypes: ["applicationGateway"],
    message: "Application Gateway capacity must be between 1 and 125.",
    longExplanation:
      "The bicep-types schema for Microsoft.Network/applicationGateways@2023-09-01 declares sku.capacity as an integer in the inclusive range 1..125 (autoscale max).",
    tags: ["bicep-types", "appgw", "capacity"],
    predicate: (n) => {
      const v = getProp<number>(n, "capacity");
      if (typeof v !== "number") return false;
      return v < 1 || v > 125;
    },
  }),

  // 16. Front Door sku.name
  nodeRule({
    id: "BICEP.FD.SKU",
    source: bicepSource("microsoft.cdn", "Microsoft.Cdn/profiles@2024-02-01"),
    category: "reliability",
    severity: "error",
    serviceTypes: ["frontDoor"],
    message: "Front Door sku.name must be Standard_AzureFrontDoor or Premium_AzureFrontDoor.",
    longExplanation:
      "The bicep-types schema for Microsoft.Cdn/profiles@2024-02-01 restricts sku.name (for Azure Front Door) to Standard_AzureFrontDoor and Premium_AzureFrontDoor. The legacy Front Door (classic) SKU is excluded.",
    tags: ["bicep-types", "frontdoor", "sku"],
    predicate: (n) => notIn(getProp(n, "sku"), FD_SKUS),
  }),

  // 17. API Management sku.name
  nodeRule({
    id: "BICEP.APIM.SKU",
    source: bicepSource(
      "microsoft.apimanagement",
      "Microsoft.ApiManagement/service@2023-05-01-preview",
    ),
    category: "reliability",
    severity: "error",
    serviceTypes: ["apiManagement"],
    message:
      "API Management sku.name must be one of Consumption, Developer, Basic, Standard, Premium.",
    longExplanation:
      "The bicep-types schema for Microsoft.ApiManagement/service@2023-05-01-preview declares sku.name as an enum spanning the consumption, developer, basic, standard, and premium tiers.",
    tags: ["bicep-types", "apim", "sku"],
    predicate: (n) => notIn(getProp(n, "sku"), APIM_SKUS),
  }),

  // 18. Log Analytics sku.name
  nodeRule({
    id: "BICEP.LA.SKU",
    source: bicepSource(
      "microsoft.operationalinsights",
      "Microsoft.OperationalInsights/workspaces@2023-09-01",
    ),
    category: "reliability",
    severity: "error",
    serviceTypes: ["logAnalytics"],
    message:
      "Log Analytics sku.name must be one of PerGB2018, Free, Standalone, PerNode, Premium, Standard, CapacityReservation, LACluster.",
    longExplanation:
      "The bicep-types schema for Microsoft.OperationalInsights/workspaces@2023-09-01 declares sku.name as an enum of pricing tiers. PerGB2018 is the modern default; the others are legacy or capacity tiers retained for compatibility.",
    tags: ["bicep-types", "loganalytics", "sku"],
    predicate: (n) => notIn(getProp(n, "sku"), LA_SKUS),
  }),

  // 19. Log Analytics retentionInDays — 30..730
  nodeRule({
    id: "BICEP.LA.RETENTION-RANGE",
    source: bicepSource(
      "microsoft.operationalinsights",
      "Microsoft.OperationalInsights/workspaces@2023-09-01",
    ),
    category: "observability",
    severity: "error",
    serviceTypes: ["logAnalytics"],
    message: "Log Analytics retentionInDays must be between 30 and 730.",
    longExplanation:
      "The bicep-types schema for Microsoft.OperationalInsights/workspaces@2023-09-01 declares retentionInDays as an integer in the inclusive range 30..730 (extendable to 4 years via interactive / archive tiers, which Bunya does not model).",
    tags: ["bicep-types", "loganalytics", "retention"],
    predicate: (n) => {
      const v = getProp<number>(n, "retentionDays");
      if (typeof v !== "number") return false;
      return v < 30 || v > 730;
    },
  }),

  // 20. Application Insights kind
  nodeRule({
    id: "BICEP.AI.KIND",
    source: bicepSource("microsoft.insights", "Microsoft.Insights/components@2020-02-02"),
    category: "observability",
    severity: "warning",
    serviceTypes: ["applicationInsights"],
    message: "Application Insights kind must be 'web' or 'other'.",
    longExplanation:
      "The bicep-types schema for Microsoft.Insights/components@2020-02-02 declares kind as a free-form string but the portal only recognises 'web' and 'other' for workspace-based components.",
    tags: ["bicep-types", "appinsights", "kind"],
    predicate: (n) => notIn(getProp(n, "type"), AI_KINDS),
  }),

  // 21. Private Endpoint groupIds[0] non-empty
  nodeRule({
    id: "BICEP.PE.GROUP-ID",
    source: bicepSource(
      "microsoft.network",
      "Microsoft.Network/privateEndpoints@2023-09-01",
    ),
    category: "network",
    severity: "error",
    serviceTypes: ["privateEndpoint"],
    message: "Private Endpoint groupId must be non-empty.",
    longExplanation:
      "The bicep-types schema for Microsoft.Network/privateEndpoints@2023-09-01 requires privateLinkServiceConnections[*].groupIds to contain at least one non-empty entry (e.g. 'blob', 'vault', 'sqlServer'). Bunya stores the first group id as the groupId property.",
    tags: ["bicep-types", "private-endpoint", "groupid"],
    predicate: (n) => {
      const v = getProp<string>(n, "groupId");
      return typeof v === "string" && v.trim().length === 0;
    },
  }),
];
