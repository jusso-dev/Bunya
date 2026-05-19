import type { ComponentType, SVGProps } from "react";
import type { ServiceCategory } from "./services";
import { ServiceType } from "@/lib/graph/schema";

export const CATEGORY_THEME: Record<ServiceCategory, { bg: string; border: string; ink: string; soft: string }> = {
  scaffold: {
    bg: "#f1f5f9",
    border: "#475569",
    ink: "#0f172a",
    soft: "#cbd5e1",
  },
  network: {
    bg: "#dbeafe",
    border: "#1d4ed8",
    ink: "#1e3a8a",
    soft: "#93c5fd",
  },
  compute: {
    bg: "#dcfce7",
    border: "#15803d",
    ink: "#14532d",
    soft: "#86efac",
  },
  data: {
    bg: "#fef3c7",
    border: "#b45309",
    ink: "#7c2d12",
    soft: "#fcd34d",
  },
  security: {
    bg: "#fee2e2",
    border: "#b91c1c",
    ink: "#7f1d1d",
    soft: "#fca5a5",
  },
  observability: {
    bg: "#ede9fe",
    border: "#6d28d9",
    ink: "#3b0764",
    soft: "#c4b5fd",
  },
  integration: {
    bg: "#cffafe",
    border: "#0e7490",
    ink: "#083344",
    soft: "#67e8f9",
  },
};

type IconProps = SVGProps<SVGSVGElement>;

const base = (children: React.ReactNode): ComponentType<IconProps> => {
  const Icon = ({ width = 24, height = 24, ...rest }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      {...rest}
    >
      {children}
    </svg>
  );
  Icon.displayName = "ServiceIcon";
  return Icon;
};

const ResourceGroupIcon = base(
  <>
    <rect x="3" y="3" width="18" height="18" rx="3" strokeDasharray="3 2" />
    <path d="M7 9h10M7 13h10M7 17h6" />
  </>,
);

const VirtualNetworkIcon = base(
  <>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <rect x="5" y="9" width="5" height="6" rx="1" />
    <rect x="14" y="9" width="5" height="6" rx="1" />
    <path d="M10 12h4" />
  </>,
);

const SubnetIcon = base(
  <>
    <rect x="3" y="6" width="18" height="3" rx="1" />
    <rect x="3" y="11" width="18" height="3" rx="1" />
    <rect x="3" y="16" width="11" height="3" rx="1" />
  </>,
);

const NsgIcon = base(
  <>
    <path d="M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z" />
    <path d="M9 12l2 2 4-4" />
  </>,
);

const PrivateEndpointIcon = base(
  <>
    <rect x="3" y="10" width="10" height="8" rx="2" />
    <path d="M5 10V8a3 3 0 0 1 6 0v2" />
    <path d="M13 14h4M17 14v3M17 14l3-3" />
  </>,
);

const AppServicePlanIcon = base(
  <>
    <rect x="3" y="13" width="18" height="6" rx="1.5" />
    <rect x="5" y="8" width="14" height="5" rx="1.5" />
    <rect x="7" y="3" width="10" height="5" rx="1.5" />
  </>,
);

const AppServiceIcon = base(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </>,
);

const FunctionAppIcon = base(
  <>
    <path d="M13 2L4 14h6l-2 8 10-12h-6z" />
  </>,
);

const StaticWebAppIcon = base(
  <>
    <path d="M5 3h11l4 4v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M16 3v4h4" />
    <path d="M7 12h10M7 16h10M7 8h5" />
  </>,
);

const StorageIcon = base(
  <>
    <ellipse cx="12" cy="5" rx="8" ry="2.5" />
    <path d="M4 5v8c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5" />
    <path d="M4 13v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
  </>,
);

const SqlIcon = base(
  <>
    <ellipse cx="12" cy="5" rx="8" ry="2.5" />
    <path d="M4 5v14c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5" />
    <path d="M8 11h8M8 15h8" />
  </>,
);

const CosmosIcon = base(
  <>
    <circle cx="12" cy="12" r="6" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(120 12 12)" />
  </>,
);

const KeyVaultIcon = base(
  <>
    <circle cx="8" cy="12" r="4" />
    <path d="M11 12h10M17 12v3M21 12v3" />
  </>,
);

const AppInsightsIcon = base(
  <>
    <path d="M3 21V3M3 21h18" />
    <rect x="6" y="13" width="3" height="6" />
    <rect x="11" y="8" width="3" height="11" />
    <rect x="16" y="4" width="3" height="15" />
  </>,
);

const LogAnalyticsIcon = base(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 9l3 3-3 3M13 15h5" />
  </>,
);

const FrontDoorIcon = base(
  <>
    <path d="M5 21V8l7-5 7 5v13" />
    <rect x="9" y="12" width="6" height="9" rx="0.5" />
    <circle cx="13.5" cy="17" r="0.6" fill="currentColor" />
  </>,
);

const ApplicationGatewayIcon = base(
  <>
    <path d="M2 7h20M2 7l3-3h14l3 3" />
    <path d="M4 7v13h16V7" />
    <path d="M9 12h6M9 16h6" />
  </>,
);

const ApiManagementIcon = base(
  <>
    <path d="M8 4c-2 0-3 1-3 3v3c0 1.5-.7 2-2 2 1.3 0 2 .5 2 2v3c0 2 1 3 3 3" />
    <path d="M16 4c2 0 3 1 3 3v3c0 1.5.7 2 2 2-1.3 0-2 .5-2 2v3c0 2-1 3-3 3" />
  </>,
);

const ContainerRegistryIcon = base(
  <>
    <rect x="3" y="6" width="18" height="14" rx="1.5" />
    <path d="M3 10h18" />
    <path d="M7 6V4h4v2M13 6V4h4v2" />
    <path d="M9 15h6" />
  </>,
);

const UserAssignedIdentityIcon = base(
  <>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 21c0-4 3-7 7-7s7 3 7 7" />
  </>,
);

export const SERVICE_ICONS: Record<ServiceType, ComponentType<IconProps>> = {
  resourceGroup: ResourceGroupIcon,
  virtualNetwork: VirtualNetworkIcon,
  subnet: SubnetIcon,
  networkSecurityGroup: NsgIcon,
  privateEndpoint: PrivateEndpointIcon,
  appServicePlan: AppServicePlanIcon,
  appService: AppServiceIcon,
  functionApp: FunctionAppIcon,
  staticWebApp: StaticWebAppIcon,
  storageAccount: StorageIcon,
  sqlDatabase: SqlIcon,
  cosmosDb: CosmosIcon,
  keyVault: KeyVaultIcon,
  applicationInsights: AppInsightsIcon,
  logAnalytics: LogAnalyticsIcon,
  frontDoor: FrontDoorIcon,
  applicationGateway: ApplicationGatewayIcon,
  apiManagement: ApiManagementIcon,
  containerRegistry: ContainerRegistryIcon,
  userAssignedIdentity: UserAssignedIdentityIcon,
};

export function getServiceIcon(type: ServiceType): ComponentType<IconProps> {
  return SERVICE_ICONS[type] ?? ResourceGroupIcon;
}
