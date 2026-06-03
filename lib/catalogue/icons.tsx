import Image, { type ImageProps } from "next/image";
import type { ServiceCategory } from "./services";
import { ServiceType } from "@/lib/graph/schema";

type ServiceIconAsset = {
  src: string;
  title: string;
};

export type ServiceIconProps = Omit<ImageProps, "alt" | "height" | "src" | "width"> & {
  size?: number;
  strokeWidth?: number;
  title?: string;
  type: ServiceType;
};

export const CATEGORY_THEME: Record<
  ServiceCategory,
  { tile: string; tileText: string; cardRing: string; cardRingActive: string }
> = {
  scaffold: {
    tile: "bg-slate-100 dark:bg-slate-800",
    tileText: "text-slate-700 dark:text-slate-200",
    cardRing: "border-slate-200 dark:border-slate-700",
    cardRingActive: "border-slate-500 ring-2 ring-slate-400/40",
  },
  network: {
    tile: "bg-blue-100 dark:bg-blue-950/60",
    tileText: "text-blue-700 dark:text-blue-200",
    cardRing: "border-blue-200 dark:border-blue-900",
    cardRingActive: "border-blue-500 ring-2 ring-blue-400/40",
  },
  compute: {
    tile: "bg-emerald-100 dark:bg-emerald-950/60",
    tileText: "text-emerald-700 dark:text-emerald-200",
    cardRing: "border-emerald-200 dark:border-emerald-900",
    cardRingActive: "border-emerald-500 ring-2 ring-emerald-400/40",
  },
  data: {
    tile: "bg-amber-100 dark:bg-amber-950/60",
    tileText: "text-amber-800 dark:text-amber-200",
    cardRing: "border-amber-200 dark:border-amber-900",
    cardRingActive: "border-amber-500 ring-2 ring-amber-400/40",
  },
  security: {
    tile: "bg-rose-100 dark:bg-rose-950/60",
    tileText: "text-rose-700 dark:text-rose-200",
    cardRing: "border-rose-200 dark:border-rose-900",
    cardRingActive: "border-rose-500 ring-2 ring-rose-400/40",
  },
  observability: {
    tile: "bg-violet-100 dark:bg-violet-950/60",
    tileText: "text-violet-700 dark:text-violet-200",
    cardRing: "border-violet-200 dark:border-violet-900",
    cardRingActive: "border-violet-500 ring-2 ring-violet-400/40",
  },
  integration: {
    tile: "bg-cyan-100 dark:bg-cyan-950/60",
    tileText: "text-cyan-700 dark:text-cyan-200",
    cardRing: "border-cyan-200 dark:border-cyan-900",
    cardRingActive: "border-cyan-500 ring-2 ring-cyan-400/40",
  },
};

export const SERVICE_ICONS: Record<ServiceType, ServiceIconAsset> = {
  resourceGroup: { src: "/azure-icons/resourceGroup.svg", title: "Resource Group" },
  virtualNetwork: { src: "/azure-icons/virtualNetwork.svg", title: "Virtual Network" },
  subnet: { src: "/azure-icons/subnet.svg", title: "Subnet" },
  networkSecurityGroup: {
    src: "/azure-icons/networkSecurityGroup.svg",
    title: "Network Security Group",
  },
  privateEndpoint: { src: "/azure-icons/privateEndpoint.svg", title: "Private Endpoint" },
  privateDnsZone: { src: "/azure-icons/virtualNetwork.svg", title: "Private DNS Zone" },
  appServicePlan: { src: "/azure-icons/appServicePlan.svg", title: "App Service Plan" },
  appService: { src: "/azure-icons/appService.svg", title: "App Service" },
  functionApp: { src: "/azure-icons/functionApp.svg", title: "Function App" },
  staticWebApp: { src: "/azure-icons/staticWebApp.svg", title: "Static Web App" },
  aksCluster: { src: "/azure-icons/aksCluster.svg", title: "Azure Kubernetes Service" },
  virtualMachineScaleSet: {
    src: "/azure-icons/virtualMachineScaleSet.svg",
    title: "Virtual Machine Scale Set",
  },
  storageAccount: { src: "/azure-icons/storageAccount.svg", title: "Storage Account" },
  sqlDatabase: { src: "/azure-icons/sqlDatabase.svg", title: "Azure SQL Database" },
  cosmosDb: { src: "/azure-icons/cosmosDb.svg", title: "Cosmos DB" },
  keyVault: { src: "/azure-icons/keyVault.svg", title: "Key Vault" },
  applicationInsights: {
    src: "/azure-icons/applicationInsights.svg",
    title: "Application Insights",
  },
  logAnalytics: {
    src: "/azure-icons/logAnalytics.svg",
    title: "Log Analytics Workspace",
  },
  monitorAlert: { src: "/azure-icons/logAnalytics.svg", title: "Monitor Alert Rule" },
  actionGroup: { src: "/azure-icons/applicationInsights.svg", title: "Action Group" },
  frontDoor: { src: "/azure-icons/frontDoor.svg", title: "Front Door" },
  applicationGateway: {
    src: "/azure-icons/applicationGateway.svg",
    title: "Application Gateway",
  },
  apiManagement: { src: "/azure-icons/apiManagement.svg", title: "API Management" },
  containerRegistry: {
    src: "/azure-icons/containerRegistry.svg",
    title: "Container Registry",
  },
  userAssignedIdentity: {
    src: "/azure-icons/userAssignedIdentity.svg",
    title: "User-Assigned Managed Identity",
  },
  roleAssignment: {
    src: "/azure-icons/userAssignedIdentity.svg",
    title: "Role Assignment",
  },
};

export function getServiceIcon(type: ServiceType): ServiceIconAsset {
  return SERVICE_ICONS[type] ?? SERVICE_ICONS.resourceGroup;
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function ServiceIcon({
  size = 20,
  style,
  strokeWidth: _strokeWidth,
  title,
  type,
  ...props
}: ServiceIconProps) {
  void _strokeWidth;
  const icon = getServiceIcon(type);
  const label = title ?? icon.title;

  return (
    <Image
      {...props}
      alt={props["aria-hidden"] ? "" : label}
      draggable={false}
      height={size}
      src={`${BASE_PATH}${icon.src}`}
      style={{
        display: "block",
        height: size,
        objectFit: "contain",
        width: size,
        ...style,
      }}
      title={title}
      unoptimized
      width={size}
    />
  );
}
