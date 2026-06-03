import type { ServiceType } from "@/lib/graph/schema";

const ARM_TYPES: Record<ServiceType, string> = {
  resourceGroup: "Microsoft.Resources/resourceGroups",
  virtualNetwork: "Microsoft.Network/virtualNetworks",
  subnet: "Microsoft.Network/virtualNetworks/subnets",
  networkSecurityGroup: "Microsoft.Network/networkSecurityGroups",
  privateEndpoint: "Microsoft.Network/privateEndpoints",
  privateDnsZone: "Microsoft.Network/privateDnsZones",
  appServicePlan: "Microsoft.Web/serverfarms",
  appService: "Microsoft.Web/sites",
  functionApp: "Microsoft.Web/sites/functions",
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

const SERVICE_TYPES: Record<string, ServiceType> = Object.fromEntries(
  Object.entries(ARM_TYPES).map(([k, v]) => [v.toLowerCase(), k as ServiceType]),
);

export function armTypeOf(serviceType: ServiceType): string {
  return ARM_TYPES[serviceType];
}

export function serviceTypeOf(armType: string): ServiceType | null {
  return SERVICE_TYPES[armType.toLowerCase()] ?? null;
}

export function armTypes(...serviceTypes: ServiceType[]): string[] {
  return serviceTypes.map(armTypeOf);
}

export function allServiceTypes(): ServiceType[] {
  return Object.keys(ARM_TYPES) as ServiceType[];
}

export function allArmTypes(): string[] {
  return Object.values(ARM_TYPES);
}
