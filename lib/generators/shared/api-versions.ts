// API version the Bicep and ARM exporters deploy each resource type with.
// Property shapes in both exporters follow these versions, so change them
// together with the bodies.
const API_VERSIONS: Record<string, string> = {
  "Microsoft.ApiManagement/service": "2023-09-01-preview",
  "Microsoft.Authorization/roleAssignments": "2022-04-01",
  "Microsoft.Cdn/profiles": "2024-02-01",
  "Microsoft.Compute/virtualMachineScaleSets": "2024-07-01",
  "Microsoft.ContainerRegistry/registries": "2023-11-01-preview",
  "Microsoft.ContainerService/managedClusters": "2024-07-01",
  "Microsoft.DocumentDB/databaseAccounts": "2024-05-15",
  "Microsoft.Insights/actionGroups": "2023-01-01",
  "Microsoft.Insights/components": "2020-02-02",
  "Microsoft.Insights/diagnosticSettings": "2021-05-01-preview",
  "Microsoft.Insights/metricAlerts": "2018-03-01",
  "Microsoft.KeyVault/vaults": "2023-07-01",
  "Microsoft.ManagedIdentity/userAssignedIdentities": "2023-01-31",
  "Microsoft.Network/applicationGateways": "2023-11-01",
  "Microsoft.Network/networkSecurityGroups": "2023-11-01",
  "Microsoft.Network/privateDnsZones": "2020-06-01",
  "Microsoft.Network/privateDnsZones/virtualNetworkLinks": "2020-06-01",
  "Microsoft.Network/privateEndpoints": "2023-11-01",
  "Microsoft.Network/privateEndpoints/privateDnsZoneGroups": "2023-11-01",
  "Microsoft.Network/virtualNetworks": "2023-11-01",
  "Microsoft.Network/virtualNetworks/subnets": "2023-11-01",
  "Microsoft.OperationalInsights/workspaces": "2023-09-01",
  "Microsoft.Sql/servers": "2023-08-01-preview",
  "Microsoft.Sql/servers/databases": "2023-08-01-preview",
  "Microsoft.Storage/storageAccounts": "2023-05-01",
  "Microsoft.Storage/storageAccounts/blobServices/containers": "2023-05-01",
  "Microsoft.Storage/storageAccounts/fileServices/shares": "2023-05-01",
  "Microsoft.Web/serverfarms": "2024-04-01",
  "Microsoft.Web/sites": "2024-04-01",
  "Microsoft.Web/staticSites": "2023-12-01",
};

export function apiVersion(armType: string): string {
  const version = API_VERSIONS[armType];
  if (!version) throw new Error(`No API version for ${armType}.`);
  return version;
}
