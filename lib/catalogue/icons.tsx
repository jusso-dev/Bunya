import {
  Boxes,
  Network,
  Layers,
  ShieldCheck,
  Link2,
  Server,
  Globe,
  Zap,
  FileCode2,
  Database,
  HardDrive,
  Orbit,
  KeyRound,
  Activity,
  Terminal,
  DoorOpen,
  ShieldHalf,
  Braces,
  Container,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import type { ServiceCategory } from "./services";
import { ServiceType } from "@/lib/graph/schema";

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

export const SERVICE_ICONS: Record<ServiceType, LucideIcon> = {
  resourceGroup: Boxes,
  virtualNetwork: Network,
  subnet: Layers,
  networkSecurityGroup: ShieldCheck,
  privateEndpoint: Link2,
  appServicePlan: Server,
  appService: Globe,
  functionApp: Zap,
  staticWebApp: FileCode2,
  storageAccount: HardDrive,
  sqlDatabase: Database,
  cosmosDb: Orbit,
  keyVault: KeyRound,
  applicationInsights: Activity,
  logAnalytics: Terminal,
  frontDoor: DoorOpen,
  applicationGateway: ShieldHalf,
  apiManagement: Braces,
  containerRegistry: Container,
  userAssignedIdentity: UserCog,
};

export function getServiceIcon(type: ServiceType): LucideIcon {
  return SERVICE_ICONS[type] ?? Boxes;
}
