import { z } from "zod";
import { EdgeKind, ServiceType } from "@/lib/graph/schema";

export type ServiceDefinition = {
  type: ServiceType;
  label: string;
  category: "compute" | "data" | "network" | "security" | "observability" | "scaffold";
  description: string;
  propertiesSchema: z.ZodTypeAny;
  defaultProperties: Record<string, unknown>;
  allowedEdgeTargets: ReadonlyArray<ServiceType>;
  allowedOutgoingKinds: ReadonlyArray<EdgeKind>;
};

const appServiceSkuSchema = z.enum(["B1", "S1", "P1v3"]);
const tlsVersionSchema = z.enum(["1.0", "1.1", "1.2"]);

export const resourceGroupSchema = z.object({
  region: z.string().min(1).default("australiaeast"),
  tags: z.record(z.string(), z.string()).default({}),
});

export const appServicePlanSchema = z.object({
  sku: appServiceSkuSchema.default("B1"),
  os: z.enum(["Linux", "Windows"]).default("Linux"),
  capacity: z.number().int().min(1).max(10).default(1),
});

export const appServiceSchema = z.object({
  runtime: z.enum(["node", "python", "dotnet"]).default("node"),
  httpsOnly: z.boolean().default(true),
  alwaysOn: z.boolean().default(true),
  vnetIntegration: z.boolean().default(false),
});

export const storageAccountSchema = z.object({
  sku: z.enum(["Standard_LRS", "Standard_ZRS", "Standard_GRS"]).default("Standard_LRS"),
  kind: z.enum(["StorageV2", "BlobStorage"]).default("StorageV2"),
  allowPublicAccess: z.boolean().default(false),
  minTlsVersion: tlsVersionSchema.default("1.2"),
  hierarchicalNamespace: z.boolean().default(false),
});

export const keyVaultSchema = z.object({
  sku: z.enum(["standard", "premium"]).default("standard"),
  purgeProtection: z.boolean().default(true),
  softDeleteRetentionDays: z.number().int().min(7).max(90).default(7),
  rbacAuthorization: z.boolean().default(true),
});

const SERVICE_DEFS: Record<ServiceType, ServiceDefinition | null> = {
  resourceGroup: {
    type: "resourceGroup",
    label: "Resource Group",
    category: "scaffold",
    description: "Logical container for all other resources.",
    propertiesSchema: resourceGroupSchema,
    defaultProperties: resourceGroupSchema.parse({}),
    allowedEdgeTargets: [],
    allowedOutgoingKinds: [],
  },
  appServicePlan: {
    type: "appServicePlan",
    label: "App Service Plan",
    category: "compute",
    description: "Compute tier hosting App Services and Function Apps.",
    propertiesSchema: appServicePlanSchema,
    defaultProperties: appServicePlanSchema.parse({}),
    allowedEdgeTargets: [],
    allowedOutgoingKinds: [],
  },
  appService: {
    type: "appService",
    label: "App Service",
    category: "compute",
    description: "Managed web app on an App Service Plan.",
    propertiesSchema: appServiceSchema,
    defaultProperties: appServiceSchema.parse({}),
    allowedEdgeTargets: ["appServicePlan", "storageAccount", "keyVault", "logAnalytics"],
    allowedOutgoingKinds: ["depends_on", "data", "identity", "diagnostic"],
  },
  storageAccount: {
    type: "storageAccount",
    label: "Storage Account",
    category: "data",
    description: "Blob/Queue/Table/File storage.",
    propertiesSchema: storageAccountSchema,
    defaultProperties: storageAccountSchema.parse({}),
    allowedEdgeTargets: ["logAnalytics"],
    allowedOutgoingKinds: ["diagnostic"],
  },
  keyVault: {
    type: "keyVault",
    label: "Key Vault",
    category: "security",
    description: "Secrets, keys and certificates store.",
    propertiesSchema: keyVaultSchema,
    defaultProperties: keyVaultSchema.parse({}),
    allowedEdgeTargets: ["logAnalytics"],
    allowedOutgoingKinds: ["diagnostic"],
  },
  virtualNetwork: null,
  subnet: null,
  networkSecurityGroup: null,
  privateEndpoint: null,
  functionApp: null,
  staticWebApp: null,
  sqlDatabase: null,
  cosmosDb: null,
  applicationInsights: null,
  logAnalytics: null,
  frontDoor: null,
  applicationGateway: null,
  apiManagement: null,
  containerRegistry: null,
  userAssignedIdentity: null,
};

export function getServiceDefinition(type: ServiceType): ServiceDefinition {
  const def = SERVICE_DEFS[type];
  if (!def) throw new Error(`service not yet defined: ${type}`);
  return def;
}

export function listFirstCutServices(): ServiceDefinition[] {
  return [
    SERVICE_DEFS.resourceGroup,
    SERVICE_DEFS.appServicePlan,
    SERVICE_DEFS.appService,
    SERVICE_DEFS.storageAccount,
    SERVICE_DEFS.keyVault,
  ].filter((d): d is ServiceDefinition => d !== null);
}

export function isServiceImplemented(type: ServiceType): boolean {
  return SERVICE_DEFS[type] !== null;
}
