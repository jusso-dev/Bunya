// Azure facts about each Bunya service type, shared by the importer, the
// exporters, the rules and the catalogue. Values come from Microsoft Learn
// ("Azure resource types", "Private endpoint DNS zone values" and
// "Azure built-in roles").
import { AZURE_REGIONS, type ServiceType } from "@/lib/graph/schema";

export const ARM_TYPES: Record<ServiceType, string> = {
  resourceGroup: "Microsoft.Resources/resourceGroups",
  virtualNetwork: "Microsoft.Network/virtualNetworks",
  subnet: "Microsoft.Network/virtualNetworks/subnets",
  networkSecurityGroup: "Microsoft.Network/networkSecurityGroups",
  privateEndpoint: "Microsoft.Network/privateEndpoints",
  privateDnsZone: "Microsoft.Network/privateDnsZones",
  appServicePlan: "Microsoft.Web/serverfarms",
  appService: "Microsoft.Web/sites",
  functionApp: "Microsoft.Web/sites",
  staticWebApp: "Microsoft.Web/staticSites",
  aksCluster: "Microsoft.ContainerService/managedClusters",
  virtualMachineScaleSet: "Microsoft.Compute/virtualMachineScaleSets",
  storageAccount: "Microsoft.Storage/storageAccounts",
  sqlDatabase: "Microsoft.Sql/servers/databases",
  cosmosDb: "Microsoft.DocumentDB/databaseAccounts",
  keyVault: "Microsoft.KeyVault/vaults",
  applicationInsights: "Microsoft.Insights/components",
  logAnalytics: "Microsoft.OperationalInsights/workspaces",
  monitorAlert: "Microsoft.Insights/metricAlerts",
  actionGroup: "Microsoft.Insights/actionGroups",
  frontDoor: "Microsoft.Cdn/profiles",
  applicationGateway: "Microsoft.Network/applicationGateways",
  apiManagement: "Microsoft.ApiManagement/service",
  containerRegistry: "Microsoft.ContainerRegistry/registries",
  userAssignedIdentity: "Microsoft.ManagedIdentity/userAssignedIdentities",
  roleAssignment: "Microsoft.Authorization/roleAssignments",
};

// Web and function apps share Microsoft.Web/sites; `kind` tells them apart.
const SERVICE_BY_ARM_TYPE: Record<string, ServiceType> = Object.fromEntries(
  (Object.entries(ARM_TYPES) as [ServiceType, string][])
    .filter(([type]) => type !== "functionApp")
    .map(([type, arm]) => [arm.toLowerCase(), type]),
);

export function armTypeOf(type: ServiceType): string {
  return ARM_TYPES[type];
}

export function serviceTypeOfArm(armType: string, kind = ""): ServiceType | null {
  const type = SERVICE_BY_ARM_TYPE[armType.toLowerCase()] ?? null;
  if (type === "appService" && kind.toLowerCase().includes("functionapp")) return "functionApp";
  return type;
}

export const AUSTRALIAN_REGIONS: readonly string[] = [...AZURE_REGIONS].sort();

// Private Endpoint sub-resources (group IDs) Bunya models, with the private
// DNS zone each resolves through and the service that exposes it.
export const PRIVATE_LINK_GROUPS = {
  blob: { zone: "privatelink.blob.core.windows.net", service: "storageAccount" },
  file: { zone: "privatelink.file.core.windows.net", service: "storageAccount" },
  queue: { zone: "privatelink.queue.core.windows.net", service: "storageAccount" },
  table: { zone: "privatelink.table.core.windows.net", service: "storageAccount" },
  sqlServer: { zone: "privatelink.database.windows.net", service: "sqlDatabase" },
  vault: { zone: "privatelink.vaultcore.azure.net", service: "keyVault" },
  sites: { zone: "privatelink.azurewebsites.net", service: "appService" },
  registry: { zone: "privatelink.azurecr.io", service: "containerRegistry" },
  Sql: { zone: "privatelink.documents.azure.com", service: "cosmosDb" },
} as const satisfies Record<string, { zone: string; service: ServiceType }>;

export type PrivateLinkGroupId = keyof typeof PRIVATE_LINK_GROUPS;
export const PRIVATE_LINK_GROUP_IDS = Object.keys(PRIVATE_LINK_GROUPS) as [PrivateLinkGroupId, ...PrivateLinkGroupId[]];
export const PRIVATE_DNS_ZONES = [...new Set(Object.values(PRIVATE_LINK_GROUPS).map((group) => group.zone))] as [string, ...string[]];

export function privateDnsZoneFor(groupId: string): string | undefined {
  return (PRIVATE_LINK_GROUPS as Record<string, { zone: string }>)[groupId]?.zone;
}

// Services a Private Endpoint can connect to. Function apps share the "sites" group.
export const PRIVATE_LINK_TARGETS: ReadonlySet<ServiceType> = new Set<ServiceType>([
  ...Object.values(PRIVATE_LINK_GROUPS).map((group) => group.service),
  "functionApp",
]);

export const ROLE_DEFINITION_IDS = {
  AcrPull: "7f951dda-4ed3-4680-a7ca-43fe172d538d",
  "Key Vault Secrets User": "4633458b-17de-408a-b874-0445c86b69e6",
  "Storage Blob Data Contributor": "ba92f5b4-2d11-453d-a403-e96b0029c9fe",
  "Storage Queue Data Contributor": "974c5e8b-45b9-4653-ba55-5f855dd0fb88",
  "Monitoring Metrics Publisher": "3913510d-42f4-4e42-8a64-420c390055eb",
  Reader: "acdd72a7-3385-48ef-bd42-f606fba81ae7",
  Contributor: "b24988ac-6180-42a0-ab88-20f7382dd24c",
} as const;

export type RoleName = keyof typeof ROLE_DEFINITION_IDS;
export const ROLE_NAMES = Object.keys(ROLE_DEFINITION_IDS) as [RoleName, ...RoleName[]];

export function roleNameForId(roleDefinitionId: string): RoleName | undefined {
  const lower = roleDefinitionId.toLowerCase();
  return ROLE_NAMES.find((name) => lower.includes(ROLE_DEFINITION_IDS[name]));
}

// The role an identity edge to each scope grants; other scopes get Reader.
const EDGE_ROLES: Partial<Record<ServiceType, RoleName>> = {
  containerRegistry: "AcrPull",
  keyVault: "Key Vault Secrets User",
  storageAccount: "Storage Blob Data Contributor",
  logAnalytics: "Monitoring Metrics Publisher",
};

export function edgeRoleFor(scopeType: ServiceType): RoleName {
  return EDGE_ROLES[scopeType] ?? "Reader";
}

// Principals whose identity edges exporters turn into role assignments, and
// the scopes they grant on.
export const GRANT_PRINCIPALS: ReadonlySet<ServiceType> = new Set(["appService", "functionApp", "userAssignedIdentity"]);
export const GRANT_SCOPES: ReadonlySet<ServiceType> = new Set(["containerRegistry", "storageAccount", "keyVault"]);

// Storage minimumTlsVersion: ARM writes "TLS1_2", Bunya stores "1.2".
export function tlsVersionToArm(version: string): string {
  return `TLS1_${version.split(".")[1]}`;
}

export function tlsVersionFromArm(value: string): string {
  return value.replace("TLS1_", "1.");
}

// Stack names per Bunya runtime: `siteConfig.linuxFxVersion` prefixes
// ("NODE|22-lts") and the Functions worker runtime (FUNCTIONS_WORKER_RUNTIME,
// Flex `functionAppConfig.runtime.name`). .NET web apps use DOTNETCORE and
// isolated-worker Function Apps DOTNET-ISOLATED; DOTNET appears in older exports.
export const RUNTIME_STACKS = {
  node: { linuxFx: ["NODE"], worker: "node" },
  python: { linuxFx: ["PYTHON"], worker: "python" },
  dotnet: { linuxFx: ["DOTNETCORE", "DOTNET-ISOLATED", "DOTNET"], worker: "dotnet-isolated" },
  java: { linuxFx: ["JAVA"], worker: "java" },
  powershell: { linuxFx: ["POWERSHELL"], worker: "powershell" },
} as const satisfies Record<string, { linuxFx: readonly string[]; worker: string }>;

export type RuntimeName = keyof typeof RUNTIME_STACKS;

export function runtimeOfLinuxFx(stack: string): RuntimeName | undefined {
  const upper = stack.toUpperCase();
  return (Object.keys(RUNTIME_STACKS) as RuntimeName[]).find((name) => (RUNTIME_STACKS[name].linuxFx as readonly string[]).includes(upper));
}

export function runtimeOfWorker(worker: string): RuntimeName | undefined {
  const lower = worker.toLowerCase();
  return (Object.keys(RUNTIME_STACKS) as RuntimeName[]).find((name) => RUNTIME_STACKS[name].worker === lower);
}

// Azure SQL DTU capacity of each Standard service objective Bunya models.
export const SQL_STANDARD_DTUS = { S0: 10, S1: 20 } as const;

// Services whose exported names get a uniqueness suffix
// (lib/generators/shared/naming.ts). An imported name is already a unique
// Azure name, so the importer marks it exactName to keep it.
export const SUFFIXED_NAME_TYPES: ReadonlySet<ServiceType> = new Set(["storageAccount", "keyVault"]);
