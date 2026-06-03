import { z } from "zod";
import { EdgeKind, ServiceType, AzureRegion } from "@/lib/graph/schema";

export type ServiceCategory =
  | "compute"
  | "data"
  | "network"
  | "security"
  | "observability"
  | "scaffold"
  | "integration";

export type ServiceDefinition = {
  type: ServiceType;
  label: string;
  shortLabel: string;
  category: ServiceCategory;
  description: string;
  propertiesSchema: z.ZodTypeAny;
  defaultProperties: Record<string, unknown>;
  allowedEdgeTargets: ReadonlyArray<ServiceType>;
  allowedOutgoingKinds: ReadonlyArray<EdgeKind>;
  azureNamePattern: "global" | "rg" | "lowercase-alphanum-global";
  icon: string;
};

const region = z.enum([
  "australiaeast",
  "australiasoutheast",
  "australiacentral",
  "australiacentral2",
] satisfies readonly AzureRegion[]);

export const resourceGroupSchema = z.object({
  region: region.default("australiaeast"),
  tags: z.record(z.string(), z.string()).default({}),
});

export const virtualNetworkSchema = z.object({
  addressSpace: z.string().regex(/^\d+\.\d+\.\d+\.\d+\/\d+$/).default("10.0.0.0/16"),
  dnsServers: z.array(z.string()).default([]),
});

export const subnetSchema = z.object({
  addressPrefix: z.string().regex(/^\d+\.\d+\.\d+\.\d+\/\d+$/).default("10.0.1.0/24"),
  serviceEndpoints: z.array(z.string()).default([]),
  privateEndpointNetworkPolicies: z.enum(["Enabled", "Disabled"]).default("Disabled"),
  delegations: z.array(z.string()).default([]),
});

const nsgRuleSchema = z.object({
  name: z.string(),
  priority: z.number().int().min(100).max(4096),
  direction: z.enum(["Inbound", "Outbound"]),
  access: z.enum(["Allow", "Deny"]),
  protocol: z.enum(["Tcp", "Udp", "Icmp", "*"]).default("*"),
  sourceAddressPrefix: z.string().default("*"),
  destinationAddressPrefix: z.string().default("*"),
  destinationPortRange: z.string().default("*"),
});

export const nsgSchema = z.object({
  defaultDeny: z.boolean().default(true),
  inboundRules: z.array(nsgRuleSchema).default([]),
  outboundRules: z.array(nsgRuleSchema).default([]),
});

export const privateEndpointSchema = z.object({
  groupId: z.enum([
    "blob",
    "file",
    "queue",
    "table",
    "sqlServer",
    "vault",
    "sites",
    "registry",
    "Sql",
  ]).default("blob"),
  manualApproval: z.boolean().default(false),
});

export const privateDnsZoneSchema = z.object({
  zoneName: z
    .enum([
      "privatelink.blob.core.windows.net",
      "privatelink.file.core.windows.net",
      "privatelink.queue.core.windows.net",
      "privatelink.table.core.windows.net",
      "privatelink.vaultcore.azure.net",
      "privatelink.azurecr.io",
      "privatelink.azurewebsites.net",
      "privatelink.database.windows.net",
      "privatelink.documents.azure.com",
    ])
    .default("privatelink.blob.core.windows.net"),
  linkedToVnet: z.boolean().default(true),
});

export const appServicePlanSchema = z.object({
  sku: z.enum(["B1", "B2", "S1", "P1v3", "P2v3"]).default("B1"),
  os: z.enum(["Linux", "Windows"]).default("Linux"),
  capacity: z.number().int().min(1).max(10).default(1),
});

export const appServiceSchema = z.object({
  runtime: z.enum(["node", "python", "dotnet", "java"]).default("node"),
  runtimeVersion: z.string().default("20-lts"),
  httpsOnly: z.boolean().default(true),
  alwaysOn: z.boolean().default(true),
  vnetIntegration: z.boolean().default(false),
  publicNetworkAccess: z.boolean().default(true),
});

export const functionAppSchema = z.object({
  runtime: z.enum(["node", "python", "dotnet", "java", "powershell"]).default("node"),
  runtimeVersion: z.string().default("20"),
  consumptionPlan: z.boolean().default(true),
  httpsOnly: z.boolean().default(true),
  publicNetworkAccess: z.boolean().default(true),
  vnetIntegration: z.boolean().default(false),
});

export const staticWebAppSchema = z.object({
  sku: z.enum(["Free", "Standard"]).default("Standard"),
  repositoryUrl: z.string().default(""),
  branch: z.string().default("main"),
});

export const aksClusterSchema = z.object({
  kubernetesVersion: z.string().default(""),
  dnsPrefix: z.string().default("aks"),
  nodeVmSize: z.enum(["Standard_B2s", "Standard_D2s_v5", "Standard_D4s_v5"]).default("Standard_D2s_v5"),
  nodeCount: z.number().int().min(1).max(50).default(3),
  networkPlugin: z.enum(["azure", "kubenet"]).default("azure"),
  networkPolicy: z.enum(["azure", "calico", "none"]).default("azure"),
  privateCluster: z.boolean().default(false),
  authorizedIpRanges: z.array(z.string()).default([]),
  managedIdentity: z.boolean().default(true),
  availabilityZones: z.array(z.string()).default([]),
  azureRbac: z.boolean().default(true),
  oidcIssuer: z.boolean().default(false),
});

export const virtualMachineScaleSetSchema = z.object({
  sku: z.enum(["Standard_B2s", "Standard_D2s_v5", "Standard_D4s_v5"]).default("Standard_B2s"),
  capacity: z.number().int().min(1).max(100).default(2),
  orchestrationMode: z.enum(["Flexible", "Uniform"]).default("Flexible"),
  upgradeMode: z.enum(["Automatic", "Manual", "Rolling"]).default("Automatic"),
  adminUsername: z.string().min(1).default("azureuser"),
  imagePublisher: z.string().min(1).default("Canonical"),
  imageOffer: z.string().min(1).default("0001-com-ubuntu-server-jammy"),
  imageSku: z.string().min(1).default("22_04-lts-gen2"),
  automaticRepairs: z.boolean().default(true),
  healthProbeConfigured: z.boolean().default(false),
  availabilityZones: z.array(z.string()).default([]),
  managedIdentity: z.boolean().default(true),
  azureMonitorAgent: z.boolean().default(false),
  trustedLaunch: z.boolean().default(false),
});

export const storageAccountSchema = z.object({
  sku: z
    .enum(["Standard_LRS", "Standard_ZRS", "Standard_GRS", "Standard_RAGRS", "Premium_LRS"])
    .default("Standard_LRS"),
  kind: z.enum(["StorageV2", "BlobStorage", "FileStorage"]).default("StorageV2"),
  allowPublicAccess: z.boolean().default(false),
  minTlsVersion: z.enum(["1.0", "1.1", "1.2"]).default("1.2"),
  hierarchicalNamespace: z.boolean().default(false),
  containers: z.array(z.string()).default([]),
});

export const sqlDatabaseSchema = z.object({
  sku: z.enum(["Basic", "S0", "S1", "GP_S_Gen5_2", "GP_Gen5_2"]).default("S0"),
  collation: z.string().default("SQL_Latin1_General_CP1_CI_AS"),
  adminLogin: z.string().min(1).default("bunyaadmin"),
  zoneRedundant: z.boolean().default(false),
});

export const cosmosDbSchema = z.object({
  consistency: z
    .enum(["Eventual", "Session", "BoundedStaleness", "Strong", "ConsistentPrefix"])
    .default("Session"),
  freeTier: z.boolean().default(false),
  multiRegionWrites: z.boolean().default(false),
  capabilities: z.array(z.string()).default([]),
});

export const keyVaultSchema = z.object({
  sku: z.enum(["standard", "premium"]).default("standard"),
  purgeProtection: z.boolean().default(true),
  softDeleteRetentionDays: z.number().int().min(7).max(90).default(7),
  rbacAuthorization: z.boolean().default(true),
  publicNetworkAccess: z.boolean().default(false),
});

export const applicationInsightsSchema = z.object({
  type: z.enum(["web", "other"]).default("web"),
  sampling: z.number().min(0).max(100).default(100),
});

export const logAnalyticsSchema = z.object({
  sku: z.enum(["PerGB2018", "Free"]).default("PerGB2018"),
  retentionDays: z.number().int().min(30).max(730).default(30),
  defaultDiagnosticTarget: z.boolean().default(false),
});

export const monitorAlertSchema = z.object({
  severity: z.enum(["Sev0", "Sev1", "Sev2", "Sev3", "Sev4"]).default("Sev2"),
  condition: z.string().default("Platform metric or log query threshold"),
  enabled: z.boolean().default(true),
});

export const actionGroupSchema = z.object({
  shortName: z.string().min(1).max(12).default("ops"),
  email: z.string().email().default("ops@example.com"),
});

export const frontDoorSchema = z.object({
  sku: z.enum(["Standard_AzureFrontDoor", "Premium_AzureFrontDoor"]).default("Standard_AzureFrontDoor"),
  responseTimeoutSeconds: z.number().int().min(16).max(240).default(60),
});

export const applicationGatewaySchema = z.object({
  sku: z.enum(["Standard_v2", "WAF_v2"]).default("WAF_v2"),
  capacity: z.number().int().min(1).max(20).default(2),
  httpsListener: z.boolean().default(true),
});

export const apiManagementSchema = z.object({
  sku: z.enum(["Consumption", "Developer", "Basic"]).default("Consumption"),
  publisherEmail: z.string().email().default("ops@example.com"),
  publisherName: z.string().min(1).default("Bunya"),
});

export const containerRegistrySchema = z.object({
  sku: z.enum(["Basic", "Standard", "Premium"]).default("Basic"),
  adminUserEnabled: z.boolean().default(false),
  publicNetworkAccess: z.boolean().default(true),
});

export const userAssignedIdentitySchema = z.object({
  notes: z.string().default(""),
});

export const roleAssignmentSchema = z.object({
  roleDefinitionName: z
    .enum([
      "AcrPull",
      "Key Vault Secrets User",
      "Storage Blob Data Contributor",
      "Storage Queue Data Contributor",
      "Monitoring Metrics Publisher",
      "Reader",
      "Contributor",
    ])
    .default("Reader"),
  scope: z.string().default("target resource"),
  principalType: z.enum(["ServicePrincipal", "ManagedIdentity"]).default("ServicePrincipal"),
});

function parseDefaults<T extends z.ZodTypeAny>(s: T): Record<string, unknown> {
  return s.parse({}) as Record<string, unknown>;
}

const allEdgeKinds: ReadonlyArray<EdgeKind> = [
  "network",
  "identity",
  "data",
  "depends_on",
  "diagnostic",
];

export const SERVICES: Record<ServiceType, ServiceDefinition> = {
  resourceGroup: {
    type: "resourceGroup",
    label: "Resource Group",
    shortLabel: "RG",
    category: "scaffold",
    description: "Logical container for all other resources.",
    propertiesSchema: resourceGroupSchema,
    defaultProperties: parseDefaults(resourceGroupSchema),
    allowedEdgeTargets: [],
    allowedOutgoingKinds: [],
    azureNamePattern: "rg",
    icon: "RG",
  },
  virtualNetwork: {
    type: "virtualNetwork",
    label: "Virtual Network",
    shortLabel: "VNet",
    category: "network",
    description: "Address space for private workloads.",
    propertiesSchema: virtualNetworkSchema,
    defaultProperties: parseDefaults(virtualNetworkSchema),
    allowedEdgeTargets: [],
    allowedOutgoingKinds: ["diagnostic"],
    azureNamePattern: "rg",
    icon: "VN",
  },
  subnet: {
    type: "subnet",
    label: "Subnet",
    shortLabel: "Subnet",
    category: "network",
    description: "Address range within a virtual network.",
    propertiesSchema: subnetSchema,
    defaultProperties: parseDefaults(subnetSchema),
    allowedEdgeTargets: ["virtualNetwork", "networkSecurityGroup"],
    allowedOutgoingKinds: ["depends_on", "network"],
    azureNamePattern: "rg",
    icon: "SN",
  },
  networkSecurityGroup: {
    type: "networkSecurityGroup",
    label: "Network Security Group",
    shortLabel: "NSG",
    category: "network",
    description: "Stateful firewall rules attached to subnets or NICs.",
    propertiesSchema: nsgSchema,
    defaultProperties: parseDefaults(nsgSchema),
    allowedEdgeTargets: ["subnet"],
    allowedOutgoingKinds: ["depends_on", "diagnostic"],
    azureNamePattern: "rg",
    icon: "NSG",
  },
  privateEndpoint: {
    type: "privateEndpoint",
    label: "Private Endpoint",
    shortLabel: "PE",
    category: "network",
    description: "Private IP attached to a target Azure service.",
    propertiesSchema: privateEndpointSchema,
    defaultProperties: parseDefaults(privateEndpointSchema),
    allowedEdgeTargets: [
      "subnet",
      "storageAccount",
      "keyVault",
      "sqlDatabase",
      "cosmosDb",
      "containerRegistry",
      "appService",
      "functionApp",
    ],
    allowedOutgoingKinds: ["network", "depends_on"],
    azureNamePattern: "rg",
    icon: "PE",
  },
  privateDnsZone: {
    type: "privateDnsZone",
    label: "Private DNS Zone",
    shortLabel: "DNS",
    category: "network",
    description: "Private Link DNS zone linked to a virtual network.",
    propertiesSchema: privateDnsZoneSchema,
    defaultProperties: parseDefaults(privateDnsZoneSchema),
    allowedEdgeTargets: ["virtualNetwork", "privateEndpoint"],
    allowedOutgoingKinds: ["network", "depends_on"],
    azureNamePattern: "global",
    icon: "DNS",
  },
  appServicePlan: {
    type: "appServicePlan",
    label: "App Service Plan",
    shortLabel: "Plan",
    category: "compute",
    description: "Hosting plan container for Web Apps and Function Apps.",
    propertiesSchema: appServicePlanSchema,
    defaultProperties: parseDefaults(appServicePlanSchema),
    allowedEdgeTargets: [],
    allowedOutgoingKinds: ["diagnostic"],
    azureNamePattern: "rg",
    icon: "ASP",
  },
  appService: {
    type: "appService",
    label: "Web App (App Service)",
    shortLabel: "Web",
    category: "compute",
    description: "Managed web application on an App Service Plan.",
    propertiesSchema: appServiceSchema,
    defaultProperties: parseDefaults(appServiceSchema),
    allowedEdgeTargets: [
      "appServicePlan",
      "functionApp",
      "storageAccount",
      "keyVault",
      "sqlDatabase",
      "cosmosDb",
      "applicationInsights",
      "logAnalytics",
      "userAssignedIdentity",
      "containerRegistry",
      "subnet",
      "roleAssignment",
    ],
    allowedOutgoingKinds: allEdgeKinds,
    azureNamePattern: "lowercase-alphanum-global",
    icon: "WEB",
  },
  functionApp: {
    type: "functionApp",
    label: "Function App",
    shortLabel: "Fn",
    category: "compute",
    description: "Serverless functions on consumption or premium plan.",
    propertiesSchema: functionAppSchema,
    defaultProperties: parseDefaults(functionAppSchema),
    allowedEdgeTargets: [
      "appServicePlan",
      "appService",
      "storageAccount",
      "keyVault",
      "sqlDatabase",
      "cosmosDb",
      "applicationInsights",
      "logAnalytics",
      "userAssignedIdentity",
      "containerRegistry",
      "subnet",
      "roleAssignment",
    ],
    allowedOutgoingKinds: allEdgeKinds,
    azureNamePattern: "lowercase-alphanum-global",
    icon: "FN",
  },
  staticWebApp: {
    type: "staticWebApp",
    label: "Static Web App",
    shortLabel: "SWA",
    category: "compute",
    description: "Static site with optional managed Functions backend.",
    propertiesSchema: staticWebAppSchema,
    defaultProperties: parseDefaults(staticWebAppSchema),
    allowedEdgeTargets: ["functionApp", "logAnalytics"],
    allowedOutgoingKinds: ["depends_on", "diagnostic"],
    azureNamePattern: "rg",
    icon: "SWA",
  },
  aksCluster: {
    type: "aksCluster",
    label: "Azure Kubernetes Service",
    shortLabel: "AKS",
    category: "compute",
    description: "Managed Kubernetes cluster with VMSS-backed node pools.",
    propertiesSchema: aksClusterSchema,
    defaultProperties: parseDefaults(aksClusterSchema),
    allowedEdgeTargets: [
      "subnet",
      "containerRegistry",
      "logAnalytics",
      "userAssignedIdentity",
      "keyVault",
      "roleAssignment",
    ],
    allowedOutgoingKinds: allEdgeKinds,
    azureNamePattern: "rg",
    icon: "AKS",
  },
  virtualMachineScaleSet: {
    type: "virtualMachineScaleSet",
    label: "Virtual Machine Scale Set",
    shortLabel: "VMSS",
    category: "compute",
    description: "Elastic set of identical Linux virtual machines.",
    propertiesSchema: virtualMachineScaleSetSchema,
    defaultProperties: parseDefaults(virtualMachineScaleSetSchema),
    allowedEdgeTargets: [
      "subnet",
      "networkSecurityGroup",
      "logAnalytics",
      "userAssignedIdentity",
      "roleAssignment",
    ],
    allowedOutgoingKinds: allEdgeKinds,
    azureNamePattern: "rg",
    icon: "VMSS",
  },
  storageAccount: {
    type: "storageAccount",
    label: "Storage Account",
    shortLabel: "Stg",
    category: "data",
    description: "Blob, Queue, Table and File storage.",
    propertiesSchema: storageAccountSchema,
    defaultProperties: parseDefaults(storageAccountSchema),
    allowedEdgeTargets: ["logAnalytics", "roleAssignment"],
    allowedOutgoingKinds: ["diagnostic"],
    azureNamePattern: "lowercase-alphanum-global",
    icon: "STG",
  },
  sqlDatabase: {
    type: "sqlDatabase",
    label: "Azure SQL Database",
    shortLabel: "SQL",
    category: "data",
    description: "Managed relational database with implicit SQL Server.",
    propertiesSchema: sqlDatabaseSchema,
    defaultProperties: parseDefaults(sqlDatabaseSchema),
    allowedEdgeTargets: ["logAnalytics", "roleAssignment"],
    allowedOutgoingKinds: ["diagnostic"],
    azureNamePattern: "rg",
    icon: "SQL",
  },
  cosmosDb: {
    type: "cosmosDb",
    label: "Cosmos DB",
    shortLabel: "Cos",
    category: "data",
    description: "Globally distributed document database (SQL API).",
    propertiesSchema: cosmosDbSchema,
    defaultProperties: parseDefaults(cosmosDbSchema),
    allowedEdgeTargets: ["logAnalytics", "roleAssignment"],
    allowedOutgoingKinds: ["diagnostic"],
    azureNamePattern: "lowercase-alphanum-global",
    icon: "COS",
  },
  keyVault: {
    type: "keyVault",
    label: "Key Vault",
    shortLabel: "KV",
    category: "security",
    description: "Secrets, keys and certificates store.",
    propertiesSchema: keyVaultSchema,
    defaultProperties: parseDefaults(keyVaultSchema),
    allowedEdgeTargets: ["logAnalytics", "roleAssignment"],
    allowedOutgoingKinds: ["diagnostic"],
    azureNamePattern: "lowercase-alphanum-global",
    icon: "KV",
  },
  applicationInsights: {
    type: "applicationInsights",
    label: "Application Insights",
    shortLabel: "AppI",
    category: "observability",
    description: "APM telemetry stored in Log Analytics workspace.",
    propertiesSchema: applicationInsightsSchema,
    defaultProperties: parseDefaults(applicationInsightsSchema),
    allowedEdgeTargets: ["logAnalytics"],
    allowedOutgoingKinds: ["depends_on", "diagnostic"],
    azureNamePattern: "rg",
    icon: "AI",
  },
  logAnalytics: {
    type: "logAnalytics",
    label: "Log Analytics Workspace",
    shortLabel: "LA",
    category: "observability",
    description: "Sink for diagnostic settings and Sentinel logs.",
    propertiesSchema: logAnalyticsSchema,
    defaultProperties: parseDefaults(logAnalyticsSchema),
    allowedEdgeTargets: [],
    allowedOutgoingKinds: [],
    azureNamePattern: "rg",
    icon: "LA",
  },
  monitorAlert: {
    type: "monitorAlert",
    label: "Monitor Alert Rule",
    shortLabel: "Alert",
    category: "observability",
    description: "Azure Monitor alert rule attached to a resource or workspace.",
    propertiesSchema: monitorAlertSchema,
    defaultProperties: parseDefaults(monitorAlertSchema),
    allowedEdgeTargets: ["logAnalytics", "actionGroup", "appService", "functionApp", "aksCluster", "virtualMachineScaleSet"],
    allowedOutgoingKinds: ["diagnostic", "depends_on"],
    azureNamePattern: "rg",
    icon: "Alert",
  },
  actionGroup: {
    type: "actionGroup",
    label: "Action Group",
    shortLabel: "Act",
    category: "observability",
    description: "Notification target for Azure Monitor alerts.",
    propertiesSchema: actionGroupSchema,
    defaultProperties: parseDefaults(actionGroupSchema),
    allowedEdgeTargets: [],
    allowedOutgoingKinds: [],
    azureNamePattern: "rg",
    icon: "AG",
  },
  frontDoor: {
    type: "frontDoor",
    label: "Front Door (Standard)",
    shortLabel: "FD",
    category: "network",
    description: "Global L7 load balancer + WAF.",
    propertiesSchema: frontDoorSchema,
    defaultProperties: parseDefaults(frontDoorSchema),
    allowedEdgeTargets: ["appService", "functionApp", "staticWebApp", "logAnalytics"],
    allowedOutgoingKinds: ["depends_on", "diagnostic"],
    azureNamePattern: "lowercase-alphanum-global",
    icon: "FD",
  },
  applicationGateway: {
    type: "applicationGateway",
    label: "Application Gateway",
    shortLabel: "AGW",
    category: "network",
    description: "Regional L7 load balancer with optional WAF.",
    propertiesSchema: applicationGatewaySchema,
    defaultProperties: parseDefaults(applicationGatewaySchema),
    allowedEdgeTargets: ["appService", "functionApp", "subnet", "logAnalytics"],
    allowedOutgoingKinds: ["depends_on", "network", "diagnostic"],
    azureNamePattern: "rg",
    icon: "AGW",
  },
  apiManagement: {
    type: "apiManagement",
    label: "API Management",
    shortLabel: "APIM",
    category: "integration",
    description: "API gateway with policy engine and developer portal.",
    propertiesSchema: apiManagementSchema,
    defaultProperties: parseDefaults(apiManagementSchema),
    allowedEdgeTargets: ["appService", "functionApp", "logAnalytics"],
    allowedOutgoingKinds: ["depends_on", "diagnostic"],
    azureNamePattern: "lowercase-alphanum-global",
    icon: "APIM",
  },
  containerRegistry: {
    type: "containerRegistry",
    label: "Container Registry",
    shortLabel: "ACR",
    category: "data",
    description: "Private Docker registry for container images.",
    propertiesSchema: containerRegistrySchema,
    defaultProperties: parseDefaults(containerRegistrySchema),
    allowedEdgeTargets: ["logAnalytics", "roleAssignment"],
    allowedOutgoingKinds: ["diagnostic"],
    azureNamePattern: "lowercase-alphanum-global",
    icon: "ACR",
  },
  userAssignedIdentity: {
    type: "userAssignedIdentity",
    label: "User-Assigned Managed Identity",
    shortLabel: "UMI",
    category: "security",
    description: "Reusable managed identity attachable to multiple resources.",
    propertiesSchema: userAssignedIdentitySchema,
    defaultProperties: parseDefaults(userAssignedIdentitySchema),
    allowedEdgeTargets: [
      "keyVault",
      "storageAccount",
      "sqlDatabase",
      "cosmosDb",
      "containerRegistry",
      "roleAssignment",
    ],
    allowedOutgoingKinds: ["identity"],
    azureNamePattern: "rg",
    icon: "UMI",
  },
  roleAssignment: {
    type: "roleAssignment",
    label: "Role Assignment",
    shortLabel: "RBAC",
    category: "security",
    description: "Azure RBAC binding between a principal, role and target scope.",
    propertiesSchema: roleAssignmentSchema,
    defaultProperties: parseDefaults(roleAssignmentSchema),
    allowedEdgeTargets: [
      "keyVault",
      "storageAccount",
      "sqlDatabase",
      "cosmosDb",
      "containerRegistry",
      "logAnalytics",
    ],
    allowedOutgoingKinds: ["identity", "depends_on"],
    azureNamePattern: "rg",
    icon: "RBAC",
  },
};

export function getServiceDefinition(type: ServiceType): ServiceDefinition {
  const def = SERVICES[type];
  if (!def) throw new Error(`unknown service type: ${type}`);
  return def;
}

export function listServices(): ServiceDefinition[] {
  return Object.values(SERVICES);
}

export function listFirstCutServices(): ServiceDefinition[] {
  return [
    SERVICES.resourceGroup,
    SERVICES.appServicePlan,
    SERVICES.appService,
    SERVICES.storageAccount,
    SERVICES.keyVault,
  ];
}

export function isServiceImplemented(type: ServiceType): boolean {
  return type in SERVICES;
}

const EDGE_INFERENCE: Partial<Record<`${ServiceType}->${ServiceType}`, EdgeKind>> = {
  "appService->appServicePlan": "depends_on",
  "functionApp->appServicePlan": "depends_on",
  "appService->functionApp": "network",
  "functionApp->appService": "network",
  "appService->storageAccount": "data",
  "functionApp->storageAccount": "data",
  "appService->keyVault": "identity",
  "functionApp->keyVault": "identity",
  "appService->sqlDatabase": "data",
  "functionApp->sqlDatabase": "data",
  "appService->cosmosDb": "data",
  "functionApp->cosmosDb": "data",
  "appService->applicationInsights": "diagnostic",
  "functionApp->applicationInsights": "diagnostic",
  "appService->logAnalytics": "diagnostic",
  "functionApp->logAnalytics": "diagnostic",
  "aksCluster->logAnalytics": "diagnostic",
  "virtualMachineScaleSet->logAnalytics": "diagnostic",
  "aksCluster->subnet": "network",
  "virtualMachineScaleSet->subnet": "network",
  "virtualMachineScaleSet->networkSecurityGroup": "network",
  "aksCluster->containerRegistry": "identity",
  "aksCluster->keyVault": "identity",
  "aksCluster->userAssignedIdentity": "identity",
  "aksCluster->roleAssignment": "identity",
  "virtualMachineScaleSet->userAssignedIdentity": "identity",
  "virtualMachineScaleSet->roleAssignment": "identity",
  "storageAccount->logAnalytics": "diagnostic",
  "storageAccount->roleAssignment": "identity",
  "sqlDatabase->logAnalytics": "diagnostic",
  "sqlDatabase->roleAssignment": "identity",
  "cosmosDb->logAnalytics": "diagnostic",
  "cosmosDb->roleAssignment": "identity",
  "keyVault->logAnalytics": "diagnostic",
  "keyVault->roleAssignment": "identity",
  "containerRegistry->logAnalytics": "diagnostic",
  "containerRegistry->roleAssignment": "identity",
  "applicationGateway->logAnalytics": "diagnostic",
  "frontDoor->logAnalytics": "diagnostic",
  "apiManagement->logAnalytics": "diagnostic",
  "subnet->virtualNetwork": "depends_on",
  "subnet->networkSecurityGroup": "network",
  "privateEndpoint->subnet": "network",
  "privateEndpoint->storageAccount": "network",
  "privateEndpoint->keyVault": "network",
  "privateEndpoint->sqlDatabase": "network",
  "privateEndpoint->cosmosDb": "network",
  "privateEndpoint->containerRegistry": "network",
  "privateEndpoint->appService": "network",
  "privateEndpoint->functionApp": "network",
  "privateEndpoint->privateDnsZone": "network",
  "privateDnsZone->privateEndpoint": "network",
  "privateDnsZone->virtualNetwork": "network",
  "applicationInsights->logAnalytics": "depends_on",
  "monitorAlert->logAnalytics": "diagnostic",
  "monitorAlert->actionGroup": "depends_on",
  "monitorAlert->appService": "diagnostic",
  "monitorAlert->functionApp": "diagnostic",
  "monitorAlert->aksCluster": "diagnostic",
  "monitorAlert->virtualMachineScaleSet": "diagnostic",
  "frontDoor->appService": "network",
  "frontDoor->functionApp": "network",
  "frontDoor->staticWebApp": "network",
  "applicationGateway->appService": "network",
  "applicationGateway->functionApp": "network",
  "applicationGateway->subnet": "network",
  "apiManagement->appService": "network",
  "apiManagement->functionApp": "network",
  "userAssignedIdentity->keyVault": "identity",
  "userAssignedIdentity->storageAccount": "identity",
  "userAssignedIdentity->sqlDatabase": "identity",
  "userAssignedIdentity->cosmosDb": "identity",
  "userAssignedIdentity->containerRegistry": "identity",
  "userAssignedIdentity->roleAssignment": "identity",
  "roleAssignment->keyVault": "identity",
  "roleAssignment->storageAccount": "identity",
  "roleAssignment->sqlDatabase": "identity",
  "roleAssignment->cosmosDb": "identity",
  "roleAssignment->containerRegistry": "identity",
  "roleAssignment->logAnalytics": "identity",
  "appService->containerRegistry": "identity",
  "functionApp->containerRegistry": "identity",
  "appService->subnet": "network",
  "functionApp->subnet": "network",
  "appService->userAssignedIdentity": "identity",
  "functionApp->userAssignedIdentity": "identity",
  "appService->roleAssignment": "identity",
  "functionApp->roleAssignment": "identity",
  "staticWebApp->functionApp": "depends_on",
};

export function inferDefaultEdgeKind(
  sourceType: ServiceType,
  targetType: ServiceType,
): EdgeKind {
  const key: `${ServiceType}->${ServiceType}` = `${sourceType}->${targetType}`;
  return EDGE_INFERENCE[key] ?? "depends_on";
}

export function isEdgeKindAllowed(
  sourceType: ServiceType,
  targetType: ServiceType,
  kind: EdgeKind,
): boolean {
  const def = SERVICES[sourceType];
  if (!def.allowedOutgoingKinds.includes(kind)) return false;
  if (def.allowedEdgeTargets.length === 0) return false;
  return def.allowedEdgeTargets.includes(targetType);
}
