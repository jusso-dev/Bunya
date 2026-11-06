import { getServiceDefinition } from "@/lib/catalogue/services";
import {
  DEFAULT_CONTAINER_SIZE,
  isContainerType,
  type GraphDocument,
  type GraphNode,
  type ServiceType,
} from "@/lib/graph/schema";
import { freeSubnetPrefix, subnetVirtualNetwork } from "@/lib/graph/topology";
import type { Point } from "./geometry";

// Cloud Adoption Framework abbreviations for each resource type.
const RESOURCE_PREFIX: Record<ServiceType, string> = {
  resourceGroup: "rg",
  virtualNetwork: "vnet",
  subnet: "snet",
  networkSecurityGroup: "nsg",
  privateEndpoint: "pe",
  privateDnsZone: "dns",
  appServicePlan: "plan",
  appService: "app",
  functionApp: "func",
  staticWebApp: "swa",
  aksCluster: "aks",
  virtualMachineScaleSet: "vmss",
  storageAccount: "st",
  sqlDatabase: "sql",
  cosmosDb: "cosmos",
  keyVault: "kv",
  applicationInsights: "appi",
  logAnalytics: "log",
  monitorAlert: "alert",
  actionGroup: "ag",
  frontDoor: "fd",
  applicationGateway: "agw",
  apiManagement: "apim",
  containerRegistry: "acr",
  userAssignedIdentity: "id",
  roleAssignment: "rbac",
};

// Globally unique, letters-and-digits names (storage, Key Vault) stay short
// enough for the strictest of them.
const ALPHANUM_NAME_MAX = 24;

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workload";
}

function resourceNameFor(type: ServiceType, name: string, taken: Set<string>): string {
  const definition = getServiceDefinition(type);
  const alphanum = definition.azureNamePattern === "lowercase-alphanum-global";
  const max = alphanum ? Math.min(ALPHANUM_NAME_MAX, definition.nameMaxLength) : definition.nameMaxLength;
  const base = alphanum ? `${RESOURCE_PREFIX[type]}${slug(name).replace(/-/g, "")}` : `${RESOURCE_PREFIX[type]}-${slug(name)}`;
  return firstFree((n) => {
    const suffix = n === 1 ? "" : alphanum ? String(n) : `-${n}`;
    return base.slice(0, max - suffix.length) + suffix;
  }, taken);
}

function firstFree(candidate: (n: number) => string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const value = candidate(n);
    if (!taken.has(value)) return value;
  }
}

// Default layout for nodes added without a drop point: rows of four.
export function gridPosition(index: number): Point {
  return { x: 180 + (index % 4) * 240, y: 80 + Math.floor(index / 4) * 170 };
}

export type NewNodeInput = {
  type: ServiceType;
  position: Point;
  parentId?: string | null;
  name?: string;
  resourceName?: string;
  properties?: Record<string, unknown>;
};

// A new node with the service's defaults, a display and resource name not yet
// used by that service type, and room of its own: containers get their
// default size and a subnet in a VNet gets a free address prefix.
export function newNode(document: GraphDocument, input: NewNodeInput): Omit<GraphNode, "id"> {
  const definition = getServiceDefinition(input.type);
  const parsed = definition.propertiesSchema.safeParse({ ...definition.defaultProperties, ...input.properties });
  if (!parsed.success) throw new Error(`Invalid properties for ${definition.label}: ${parsed.error.message}`);
  const properties = parsed.data as Record<string, unknown>;

  const parent = input.parentId ? document.nodes.find((node) => node.id === input.parentId) : undefined;
  if (input.type === "subnet" && parent?.type === "virtualNetwork" && input.properties?.addressPrefix === undefined) {
    const used = document.nodes
      .filter((node) => node.type === "subnet" && subnetVirtualNetwork(document, node)?.id === parent.id)
      .map((node) => node.properties.addressPrefix);
    const prefix = freeSubnetPrefix(parent.properties.addressSpace, used);
    if (prefix) properties.addressPrefix = prefix;
  }

  const sameType = document.nodes.filter((node) => node.type === input.type);
  const names = new Set(sameType.map((node) => node.name));
  const name = input.name ?? firstFree((n) => (n === 1 ? definition.label : `${definition.label} ${n}`), names);
  const resourceName = input.resourceName ?? resourceNameFor(input.type, name, new Set(sameType.map((node) => node.resourceName)));

  return {
    type: input.type,
    name,
    resourceName,
    position: input.position,
    parentId: input.parentId,
    properties,
    ...(isContainerType(input.type) ? { size: DEFAULT_CONTAINER_SIZE[input.type] } : {}),
  };
}
