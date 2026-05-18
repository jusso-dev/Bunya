// Generated from mspnp/AzureNamingTool@v3.4.0 (src/repository/resourcetypes.json).
// Each entry encodes a single naming constraint (length / charset / case)
// against GraphNode.resourceName. Do not hand-edit; rerun the importer.
import { nodeRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";

const NAMING_BASE = {
  name: "Azure Naming Tool",
  license: "MIT",
  version: "v3.4.0",
  url: "https://github.com/mspnp/AzureNamingTool/blob/main/src/repository/resourcetypes.json",
} as const;

// Helpers — kept tiny so each predicate stays a single readable expression.
const lenOutside = (s: string, min: number, max: number): boolean =>
  s.length < min || s.length > max;

const matchesNot = (s: string, re: RegExp): boolean => !re.test(s);

export const NAMING_RULES: RuleEntry[] = [
  // 1. storageAccount — length 3-24
  nodeRule({
    id: "NAMING.STORAGEACCOUNT.LENGTH",
    source: { ...NAMING_BASE, ruleId: "Microsoft.Storage/storageAccounts.length" },
    category: "naming",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message: "Storage Account name must be 3-24 characters.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.Storage/storageAccounts length constraint: 3 to 24 characters, globally unique.",
    tags: ["naming", "azure-naming-tool", "length"],
    predicate: (n) => lenOutside(n.resourceName, 3, 24),
  }),

  // 2. storageAccount — charset [a-z0-9]
  nodeRule({
    id: "NAMING.STORAGEACCOUNT.CHARSET",
    source: { ...NAMING_BASE, ruleId: "Microsoft.Storage/storageAccounts.charset" },
    category: "naming",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message: "Storage Account name must contain only lowercase letters and digits.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.Storage/storageAccounts character set: lowercase alphanumeric only (no dashes, dots, or uppercase).",
    tags: ["naming", "azure-naming-tool", "charset"],
    predicate: (n) => matchesNot(n.resourceName, /^[a-z0-9]+$/),
  }),

  // 3. keyVault — length 3-24
  nodeRule({
    id: "NAMING.KEYVAULT.LENGTH",
    source: { ...NAMING_BASE, ruleId: "Microsoft.KeyVault/vaults.length" },
    category: "naming",
    severity: "error",
    serviceTypes: ["keyVault"],
    message: "Key Vault name must be 3-24 characters.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.KeyVault/vaults length constraint: 3 to 24 characters.",
    tags: ["naming", "azure-naming-tool", "length"],
    predicate: (n) => lenOutside(n.resourceName, 3, 24),
  }),

  // 4. keyVault — charset [a-zA-Z0-9-], no leading/trailing dash, no consecutive dashes
  nodeRule({
    id: "NAMING.KEYVAULT.CHARSET",
    source: { ...NAMING_BASE, ruleId: "Microsoft.KeyVault/vaults.charset" },
    category: "naming",
    severity: "error",
    serviceTypes: ["keyVault"],
    message: "Key Vault name must be alphanumeric or dashes, must start with a letter, and may not end with a dash.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.KeyVault/vaults character set: alphanumeric and hyphens only; must start with a letter and cannot end with a hyphen.",
    tags: ["naming", "azure-naming-tool", "charset"],
    predicate: (n) => matchesNot(n.resourceName, /^[A-Za-z][A-Za-z0-9-]*[A-Za-z0-9]$/),
  }),

  // 5. containerRegistry — length 5-50
  nodeRule({
    id: "NAMING.CONTAINERREGISTRY.LENGTH",
    source: { ...NAMING_BASE, ruleId: "Microsoft.ContainerRegistry/registries.length" },
    category: "naming",
    severity: "error",
    serviceTypes: ["containerRegistry"],
    message: "Container Registry name must be 5-50 characters.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.ContainerRegistry/registries length constraint: 5 to 50 characters.",
    tags: ["naming", "azure-naming-tool", "length"],
    predicate: (n) => lenOutside(n.resourceName, 5, 50),
  }),

  // 6. containerRegistry — charset [a-zA-Z0-9]
  nodeRule({
    id: "NAMING.CONTAINERREGISTRY.CHARSET",
    source: { ...NAMING_BASE, ruleId: "Microsoft.ContainerRegistry/registries.charset" },
    category: "naming",
    severity: "error",
    serviceTypes: ["containerRegistry"],
    message: "Container Registry name must contain only letters and digits.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.ContainerRegistry/registries character set: alphanumeric only (no dashes, dots, or underscores).",
    tags: ["naming", "azure-naming-tool", "charset"],
    predicate: (n) => matchesNot(n.resourceName, /^[A-Za-z0-9]+$/),
  }),

  // 7. appService — length 2-60
  nodeRule({
    id: "NAMING.APPSERVICE.LENGTH",
    source: { ...NAMING_BASE, ruleId: "Microsoft.Web/sites.length" },
    category: "naming",
    severity: "error",
    serviceTypes: ["appService"],
    message: "App Service name must be 2-60 characters.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.Web/sites length constraint: 2 to 60 characters.",
    tags: ["naming", "azure-naming-tool", "length"],
    predicate: (n) => lenOutside(n.resourceName, 2, 60),
  }),

  // 8. appService — charset [a-zA-Z0-9-], cannot end with dash
  nodeRule({
    id: "NAMING.APPSERVICE.CHARSET",
    source: { ...NAMING_BASE, ruleId: "Microsoft.Web/sites.charset" },
    category: "naming",
    severity: "error",
    serviceTypes: ["appService"],
    message: "App Service name must be alphanumeric or dashes and may not end with a dash.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.Web/sites character set: alphanumeric and hyphens only; the name cannot start or end with a hyphen.",
    tags: ["naming", "azure-naming-tool", "charset"],
    predicate: (n) => matchesNot(n.resourceName, /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/),
  }),

  // 9. functionApp — length 2-60
  nodeRule({
    id: "NAMING.FUNCTIONAPP.LENGTH",
    source: { ...NAMING_BASE, ruleId: "Microsoft.Web/sites.functions.length" },
    category: "naming",
    severity: "error",
    serviceTypes: ["functionApp"],
    message: "Function App name must be 2-60 characters.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.Web/sites (functions kind) length constraint: 2 to 60 characters.",
    tags: ["naming", "azure-naming-tool", "length"],
    predicate: (n) => lenOutside(n.resourceName, 2, 60),
  }),

  // 10. functionApp — charset [a-zA-Z0-9-], cannot end with dash
  nodeRule({
    id: "NAMING.FUNCTIONAPP.CHARSET",
    source: { ...NAMING_BASE, ruleId: "Microsoft.Web/sites.functions.charset" },
    category: "naming",
    severity: "error",
    serviceTypes: ["functionApp"],
    message: "Function App name must be alphanumeric or dashes and may not end with a dash.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.Web/sites (functions kind) character set: alphanumeric and hyphens only; the name cannot start or end with a hyphen.",
    tags: ["naming", "azure-naming-tool", "charset"],
    predicate: (n) => matchesNot(n.resourceName, /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/),
  }),

  // 11. resourceGroup — length 1-90
  nodeRule({
    id: "NAMING.RESOURCEGROUP.LENGTH",
    source: { ...NAMING_BASE, ruleId: "Microsoft.Resources/resourceGroups.length" },
    category: "naming",
    severity: "error",
    serviceTypes: ["resourceGroup"],
    message: "Resource Group name must be 1-90 characters.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.Resources/resourceGroups length constraint: 1 to 90 characters.",
    tags: ["naming", "azure-naming-tool", "length"],
    predicate: (n) => lenOutside(n.resourceName, 1, 90),
  }),

  // 12. resourceGroup — charset [A-Za-z0-9._()-], cannot end with period
  nodeRule({
    id: "NAMING.RESOURCEGROUP.CHARSET",
    source: { ...NAMING_BASE, ruleId: "Microsoft.Resources/resourceGroups.charset" },
    category: "naming",
    severity: "error",
    serviceTypes: ["resourceGroup"],
    message: "Resource Group name allows letters, digits, periods, underscores, hyphens, and parentheses, and may not end with a period.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.Resources/resourceGroups character set: alphanumeric, underscore, parentheses, hyphen, and period; the name cannot end with a period.",
    tags: ["naming", "azure-naming-tool", "charset"],
    predicate: (n) =>
      matchesNot(n.resourceName, /^[A-Za-z0-9._()-]+$/) || n.resourceName.endsWith("."),
  }),

  // 13. virtualNetwork — length 2-64
  nodeRule({
    id: "NAMING.VIRTUALNETWORK.LENGTH",
    source: { ...NAMING_BASE, ruleId: "Microsoft.Network/virtualNetworks.length" },
    category: "naming",
    severity: "error",
    serviceTypes: ["virtualNetwork"],
    message: "Virtual Network name must be 2-64 characters.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.Network/virtualNetworks length constraint: 2 to 64 characters.",
    tags: ["naming", "azure-naming-tool", "length"],
    predicate: (n) => lenOutside(n.resourceName, 2, 64),
  }),

  // 14. virtualNetwork — charset [A-Za-z0-9._-]
  nodeRule({
    id: "NAMING.VIRTUALNETWORK.CHARSET",
    source: { ...NAMING_BASE, ruleId: "Microsoft.Network/virtualNetworks.charset" },
    category: "naming",
    severity: "error",
    serviceTypes: ["virtualNetwork"],
    message: "Virtual Network name must contain only letters, digits, periods, underscores, and dashes.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.Network/virtualNetworks character set: alphanumeric, underscore, dot, and dash; must start with alphanumeric and end with alphanumeric or underscore.",
    tags: ["naming", "azure-naming-tool", "charset"],
    predicate: (n) =>
      matchesNot(n.resourceName, /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_])?$/),
  }),

  // 15. subnet — length 1-80
  nodeRule({
    id: "NAMING.SUBNET.LENGTH",
    source: { ...NAMING_BASE, ruleId: "Microsoft.Network/virtualNetworks/subnets.length" },
    category: "naming",
    severity: "error",
    serviceTypes: ["subnet"],
    message: "Subnet name must be 1-80 characters.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.Network/virtualNetworks/subnets length constraint: 1 to 80 characters.",
    tags: ["naming", "azure-naming-tool", "length"],
    predicate: (n) => lenOutside(n.resourceName, 1, 80),
  }),

  // 16. subnet — charset [A-Za-z0-9._-]
  nodeRule({
    id: "NAMING.SUBNET.CHARSET",
    source: { ...NAMING_BASE, ruleId: "Microsoft.Network/virtualNetworks/subnets.charset" },
    category: "naming",
    severity: "error",
    serviceTypes: ["subnet"],
    message: "Subnet name must contain only letters, digits, periods, underscores, and dashes.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.Network/virtualNetworks/subnets character set: alphanumeric, underscore, dot, and dash; must start with alphanumeric and end with alphanumeric or underscore.",
    tags: ["naming", "azure-naming-tool", "charset"],
    predicate: (n) =>
      matchesNot(n.resourceName, /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_])?$/),
  }),

  // 17. cosmosDb — length 3-44
  nodeRule({
    id: "NAMING.COSMOSDB.LENGTH",
    source: { ...NAMING_BASE, ruleId: "Microsoft.DocumentDB/databaseAccounts.length" },
    category: "naming",
    severity: "error",
    serviceTypes: ["cosmosDb"],
    message: "Cosmos DB account name must be 3-44 characters.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.DocumentDB/databaseAccounts length constraint: 3 to 44 characters.",
    tags: ["naming", "azure-naming-tool", "length"],
    predicate: (n) => lenOutside(n.resourceName, 3, 44),
  }),

  // 18. cosmosDb — lowercase (and dashes/digits)
  nodeRule({
    id: "NAMING.COSMOSDB.LOWERCASE",
    source: { ...NAMING_BASE, ruleId: "Microsoft.DocumentDB/databaseAccounts.charset" },
    category: "naming",
    severity: "error",
    serviceTypes: ["cosmosDb"],
    message: "Cosmos DB account name must be lowercase letters, digits, and dashes only.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.DocumentDB/databaseAccounts character set: lowercase alphanumeric and hyphens; must start with a letter or digit and not end with a hyphen.",
    tags: ["naming", "azure-naming-tool", "lowercase", "charset"],
    predicate: (n) => matchesNot(n.resourceName, /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  }),

  // 19. apiManagement — length 1-50
  nodeRule({
    id: "NAMING.APIMANAGEMENT.LENGTH",
    source: { ...NAMING_BASE, ruleId: "Microsoft.ApiManagement/service.length" },
    category: "naming",
    severity: "error",
    serviceTypes: ["apiManagement"],
    message: "API Management service name must be 1-50 characters.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.ApiManagement/service length constraint: 1 to 50 characters.",
    tags: ["naming", "azure-naming-tool", "length"],
    predicate: (n) => lenOutside(n.resourceName, 1, 50),
  }),

  // 20. frontDoor — length 5-64
  nodeRule({
    id: "NAMING.FRONTDOOR.LENGTH",
    source: { ...NAMING_BASE, ruleId: "Microsoft.Cdn/profiles.length" },
    category: "naming",
    severity: "error",
    serviceTypes: ["frontDoor"],
    message: "Front Door profile name must be 5-64 characters.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.Cdn/profiles length constraint for Azure Front Door (Standard / Premium): 5 to 64 characters.",
    tags: ["naming", "azure-naming-tool", "length"],
    predicate: (n) => lenOutside(n.resourceName, 5, 64),
  }),

  // 21. applicationGateway — length 1-80 (bonus)
  nodeRule({
    id: "NAMING.APPLICATIONGATEWAY.LENGTH",
    source: { ...NAMING_BASE, ruleId: "Microsoft.Network/applicationGateways.length" },
    category: "naming",
    severity: "error",
    serviceTypes: ["applicationGateway"],
    message: "Application Gateway name must be 1-80 characters.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.Network/applicationGateways length constraint: 1 to 80 characters.",
    tags: ["naming", "azure-naming-tool", "length"],
    predicate: (n) => lenOutside(n.resourceName, 1, 80),
  }),

  // 22. userAssignedIdentity — length 3-128 (bonus)
  nodeRule({
    id: "NAMING.USERASSIGNEDIDENTITY.LENGTH",
    source: {
      ...NAMING_BASE,
      ruleId: "Microsoft.ManagedIdentity/userAssignedIdentities.length",
    },
    category: "naming",
    severity: "error",
    serviceTypes: ["userAssignedIdentity"],
    message: "User-Assigned Managed Identity name must be 3-128 characters.",
    longExplanation:
      "Azure Naming Tool encodes the Microsoft.ManagedIdentity/userAssignedIdentities length constraint: 3 to 128 characters.",
    tags: ["naming", "azure-naming-tool", "length"],
    predicate: (n) => lenOutside(n.resourceName, 3, 128),
  }),
];
