import { nodeRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";

const AZURE_NAMING_SOURCE = {
  name: "Azure resource name rules",
  url: "https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules",
  license: "CC-BY-4.0",
} as const;

const CAF_NAMING_SOURCE = {
  name: "Cloud Adoption Framework resource naming",
  url: "https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-naming",
  license: "CC-BY-4.0",
} as const;

const CAF_ABBREVIATION_SOURCE = {
  name: "Cloud Adoption Framework resource abbreviations",
  url: "https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations",
  license: "CC-BY-4.0",
} as const;

// CAF-recommended abbreviation prefixes per resource type. Keep this conservative —
// the rule is informational and only fires when the resource name does not start with
// one of the listed prefixes for that service type.
const CAF_PREFIXES: Partial<Record<string, string[]>> = {
  resourceGroup: ["rg-", "rg"],
  virtualNetwork: ["vnet-", "vnet"],
  subnet: ["snet-", "snet"],
  networkSecurityGroup: ["nsg-", "nsg"],
  privateEndpoint: ["pep-", "pe-", "pep", "pe"],
  appServicePlan: ["asp-", "plan-", "asp", "plan"],
  appService: ["app-", "web-", "app", "web"],
  functionApp: ["func-", "fn-", "func", "fn"],
  staticWebApp: ["stapp-", "swa-", "stapp", "swa"],
  storageAccount: ["st", "stg", "sa"],
  sqlDatabase: ["sqldb-", "sqldb"],
  cosmosDb: ["cosmos-", "cosno-", "cosmos", "cosno"],
  keyVault: ["kv-", "kv"],
  applicationInsights: ["appi-", "ai-", "appi", "ai"],
  logAnalytics: ["log-", "la-", "log", "la"],
  frontDoor: ["afd-", "fd-", "afd", "fd"],
  applicationGateway: ["agw-", "agw"],
  apiManagement: ["apim-", "apim"],
  containerRegistry: ["cr", "acr"],
  userAssignedIdentity: ["id-", "umi-", "id", "umi"],
};

export const namingRules: RuleEntry[] = [
  nodeRule({
    id: "BUNYA.NAM.001",
    source: AZURE_NAMING_SOURCE,
    category: "naming",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message: "Storage Account name must match [a-z0-9]{3,24}.",
    longExplanation:
      "Storage account names are globally unique, lower-case alphanumeric, 3 to 24 characters. Any uppercase letter, hyphen, underscore, or out-of-range length causes deployment to fail at the ARM layer before any resource is created.",
    tags: ["bunya", "naming", "storage"],
    predicate: (n) => !/^[a-z0-9]{3,24}$/.test(n.resourceName),
  }),

  nodeRule({
    id: "BUNYA.NAM.002",
    source: AZURE_NAMING_SOURCE,
    category: "naming",
    severity: "error",
    serviceTypes: ["keyVault"],
    message: "Key Vault name must match [a-zA-Z0-9-]{3,24} and start with a letter.",
    longExplanation:
      "Key Vault names are globally unique, 3 to 24 characters, alphanumeric and hyphens, and must start with a letter. Names that violate these rules are rejected by the Key Vault resource provider during deployment.",
    tags: ["bunya", "naming", "key-vault"],
    predicate: (n) => {
      const v = n.resourceName;
      if (!/^[a-zA-Z][a-zA-Z0-9-]{2,23}$/.test(v)) return true;
      // Reject consecutive hyphens and trailing hyphen which Azure also disallows.
      if (v.endsWith("-") || /--/.test(v)) return true;
      return false;
    },
  }),

  nodeRule({
    id: "BUNYA.NAM.003",
    source: AZURE_NAMING_SOURCE,
    category: "naming",
    severity: "error",
    serviceTypes: ["containerRegistry"],
    message: "Container Registry name must match [a-zA-Z0-9]{5,50}.",
    longExplanation:
      "Azure Container Registry names are globally unique, 5 to 50 characters, and strictly alphanumeric. Hyphens, underscores and other punctuation are not accepted by the registry resource provider.",
    tags: ["bunya", "naming", "container-registry"],
    predicate: (n) => !/^[a-zA-Z0-9]{5,50}$/.test(n.resourceName),
  }),

  nodeRule({
    id: "BUNYA.NAM.004",
    source: AZURE_NAMING_SOURCE,
    category: "naming",
    severity: "error",
    serviceTypes: ["appService", "functionApp", "frontDoor", "apiManagement"],
    message:
      "App Service / Function App / Front Door / API Management name must match [a-z0-9][a-z0-9-]{1,58}[a-z0-9].",
    longExplanation:
      "Resources that expose a global DNS hostname (App Service, Function App, Front Door, API Management) must be 3 to 60 lower-case alphanumeric characters with optional internal hyphens. The name cannot start or end with a hyphen and is part of the public *.azurewebsites.net or *.azurefd.net record.",
    tags: ["bunya", "naming", "global-dns"],
    predicate: (n) => !/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(n.resourceName),
  }),

  nodeRule({
    id: "BUNYA.NAM.005",
    source: AZURE_NAMING_SOURCE,
    category: "naming",
    severity: "error",
    serviceTypes: ["resourceGroup"],
    message:
      "Resource Group name must be 1-90 chars from [A-Za-z0-9._()-] and may not end with a period.",
    longExplanation:
      "Resource Group names accept alphanumerics, underscore, parentheses, hyphens and periods, up to 90 characters, and cannot end with a period. Names outside this character class will be rejected by ARM at subscription scope.",
    tags: ["bunya", "naming", "resource-group"],
    predicate: (n) => {
      const v = n.resourceName;
      if (v.length < 1 || v.length > 90) return true;
      if (!/^[A-Za-z0-9._()-]+$/.test(v)) return true;
      if (v.endsWith(".")) return true;
      return false;
    },
  }),

  nodeRule({
    id: "BUNYA.NAM.006",
    source: AZURE_NAMING_SOURCE,
    category: "naming",
    severity: "error",
    serviceTypes: ["cosmosDb"],
    message: "Cosmos DB account name must match [a-z0-9-]{3,44}.",
    longExplanation:
      "Cosmos DB account names are globally unique, 3 to 44 characters, lower-case alphanumeric and hyphen. The name forms part of the *.documents.azure.com hostname so uppercase letters and unsupported punctuation are rejected.",
    tags: ["bunya", "naming", "cosmos-db"],
    predicate: (n) => !/^[a-z0-9-]{3,44}$/.test(n.resourceName),
  }),

  nodeRule({
    id: "BUNYA.NAM.007",
    source: CAF_NAMING_SOURCE,
    category: "naming",
    severity: "info",
    serviceTypes: [
      "resourceGroup",
      "virtualNetwork",
      "subnet",
      "networkSecurityGroup",
      "privateEndpoint",
      "appServicePlan",
      "appService",
      "functionApp",
      "staticWebApp",
      "storageAccount",
      "sqlDatabase",
      "cosmosDb",
      "keyVault",
      "applicationInsights",
      "logAnalytics",
      "frontDoor",
      "applicationGateway",
      "apiManagement",
      "containerRegistry",
      "userAssignedIdentity",
    ],
    message: "Resource name should include the environment (dev/test/prod) suffix or token.",
    longExplanation:
      "The Cloud Adoption Framework recommends embedding the deployment environment into resource names so dev, test and prod resources are visually distinguishable in portal lists, alerts and bills. Including the environment token also reduces the chance of cross-environment mistakes when humans operate on resources.",
    tags: ["bunya", "naming", "environment", "caf"],
    predicate: (n, graph) => {
      const env = graph.metadata.environment;
      if (!env) return false;
      const haystack = `${n.name} ${n.resourceName}`.toLowerCase();
      return !haystack.includes(env.toLowerCase());
    },
  }),

  nodeRule({
    id: "BUNYA.NAM.008",
    source: AZURE_NAMING_SOURCE,
    category: "naming",
    severity: "error",
    serviceTypes: ["sqlDatabase"],
    message:
      "SQL Server base name must match [a-z0-9][a-z0-9-]{0,61}[a-z0-9] (used to derive the *-srv server name).",
    longExplanation:
      "Bunya derives the implicit Azure SQL Server hostname from the database resource name by appending '-srv'. The derived server name must be 3 to 63 lower-case alphanumeric characters with optional internal hyphens; otherwise the SQL resource provider will reject the deployment.",
    tags: ["bunya", "naming", "sql"],
    predicate: (n) => !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(n.resourceName),
  }),

  nodeRule({
    id: "BUNYA.NAM.009",
    source: AZURE_NAMING_SOURCE,
    category: "naming",
    severity: "error",
    serviceTypes: ["virtualNetwork", "subnet"],
    message:
      "Virtual Network / Subnet name must be 1-80 chars, start with a letter or number, and not end with hyphen or period.",
    longExplanation:
      "VNet and Subnet names live in the Microsoft.Network namespace which requires 1 to 80 characters, must start with a letter or digit, may contain letters, digits, underscores, periods or hyphens, and must end with a letter, digit or underscore.",
    tags: ["bunya", "naming", "network"],
    predicate: (n) => {
      const v = n.resourceName;
      if (v.length < 1 || v.length > 80) return true;
      return !/^[A-Za-z0-9][A-Za-z0-9._-]{0,78}[A-Za-z0-9_]$|^[A-Za-z0-9]$/.test(v);
    },
  }),

  nodeRule({
    id: "BUNYA.NAM.010",
    source: CAF_ABBREVIATION_SOURCE,
    category: "naming",
    severity: "info",
    serviceTypes: [
      "resourceGroup",
      "virtualNetwork",
      "subnet",
      "networkSecurityGroup",
      "privateEndpoint",
      "appServicePlan",
      "appService",
      "functionApp",
      "staticWebApp",
      "storageAccount",
      "sqlDatabase",
      "cosmosDb",
      "keyVault",
      "applicationInsights",
      "logAnalytics",
      "frontDoor",
      "applicationGateway",
      "apiManagement",
      "containerRegistry",
      "userAssignedIdentity",
    ],
    message: "Resource name should start with the CAF-recommended abbreviation prefix (e.g. rg-, st, kv-).",
    longExplanation:
      "The Cloud Adoption Framework publishes a canonical list of short prefixes per Azure resource type (rg- for resource groups, st for storage accounts, kv- for key vaults, etc.). Consistent prefixes make resource purpose self-evident in tooling and reduce ambiguity in cross-team operations.",
    tags: ["bunya", "naming", "caf", "abbreviation"],
    predicate: (n) => {
      const prefixes = CAF_PREFIXES[n.type];
      if (!prefixes || prefixes.length === 0) return false;
      const name = n.resourceName.toLowerCase();
      return !prefixes.some((p) => name.startsWith(p.toLowerCase()));
    },
  }),
];
