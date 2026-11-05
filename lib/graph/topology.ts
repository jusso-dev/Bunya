import type { GraphDocument, GraphNode, ServiceType } from "./schema";

// Azure placement rules Bunya can draw. A Virtual Network holds only subnets
// (VNet-injected services join a subnet through a network edge), an App
// Service Plan hosts only sites, and Resource Groups never nest.
export function acceptsChild(parentType: ServiceType, childType: ServiceType): boolean {
  if (parentType === "virtualNetwork") return childType === "subnet";
  if (parentType === "appServicePlan") return childType === "appService" || childType === "functionApp";
  if (parentType === "resourceGroup") return childType !== "resourceGroup";
  return false;
}

// Services Azure deploys into a subnet. Exporters reference a subnet that
// does not exist when the edge is missing, so generation is blocked.
const REQUIRES_SUBNET: ReadonlySet<ServiceType> = new Set(["virtualMachineScaleSet"]);

export type TopologyProblem = { nodeIds: string[]; message: string };

type Cidr = { start: number; end: number };

export function parseCidr(value: unknown): Cidr | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  const bits = Number(match[5]);
  if (octets.some((octet) => octet > 255) || bits > 32) return null;
  const address = octets.reduce((acc, octet) => acc * 256 + octet, 0);
  const size = 2 ** (32 - bits);
  const start = Math.floor(address / size) * size;
  return { start, end: start + size - 1 };
}

function label(node: GraphNode): string {
  return `${node.name} "${node.resourceName}"`;
}

export function subnetVirtualNetwork(document: GraphDocument, subnet: GraphNode): GraphNode | undefined {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const parent = subnet.parentId ? byId.get(subnet.parentId) : undefined;
  if (parent?.type === "virtualNetwork") return parent;
  return document.edges
    .filter((edge) => edge.source === subnet.id && edge.kind === "depends_on")
    .map((edge) => byId.get(edge.target))
    .find((target) => target?.type === "virtualNetwork");
}

export function topologyProblems(document: GraphDocument): TopologyProblem[] {
  const problems: TopologyProblem[] = [];
  const byId = new Map(document.nodes.map((node) => [node.id, node]));

  for (const node of document.nodes) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (node.type === "resourceGroup" && node.parentId) {
      problems.push({ nodeIds: [node.id], message: `${label(node)}: a Resource Group cannot sit inside another container.` });
    } else if (parent && !acceptsChild(parent.type, node.type)) {
      problems.push({
        nodeIds: [node.id, parent.id],
        message: `${label(node)} cannot be placed inside ${label(parent)}; move it to the Resource Group${node.type === "subnet" ? " or a Virtual Network" : ""}.`,
      });
    }
  }

  const subnetsByVnet = new Map<string, GraphNode[]>();
  for (const subnet of document.nodes.filter((node) => node.type === "subnet")) {
    const vnet = subnetVirtualNetwork(document, subnet);
    if (!vnet) {
      problems.push({ nodeIds: [subnet.id], message: `${label(subnet)} must belong to a Virtual Network; place it inside one.` });
      continue;
    }
    const list = subnetsByVnet.get(vnet.id) ?? [];
    list.push(subnet);
    subnetsByVnet.set(vnet.id, list);
  }

  for (const [vnetId, subnets] of subnetsByVnet) {
    const vnet = byId.get(vnetId)!;
    const space = parseCidr(vnet.properties.addressSpace);
    const ranges = subnets.map((subnet) => ({ subnet, range: parseCidr(subnet.properties.addressPrefix) }));
    for (const { subnet, range } of ranges) {
      if (space && range && (range.start < space.start || range.end > space.end)) {
        problems.push({
          nodeIds: [subnet.id, vnet.id],
          message: `${label(subnet)} prefix ${String(subnet.properties.addressPrefix)} is outside ${label(vnet)} address space ${String(vnet.properties.addressSpace)}.`,
        });
      }
    }
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const a = ranges[i];
        const b = ranges[j];
        if (a.range && b.range && a.range.start <= b.range.end && b.range.start <= a.range.end) {
          problems.push({
            nodeIds: [a.subnet.id, b.subnet.id],
            message: `${label(a.subnet)} and ${label(b.subnet)} have overlapping prefixes in ${label(vnet)}.`,
          });
        }
      }
    }
  }

  for (const node of document.nodes.filter((candidate) => REQUIRES_SUBNET.has(candidate.type))) {
    const joined = document.edges.some(
      (edge) => edge.source === node.id && edge.kind === "network" && byId.get(edge.target)?.type === "subnet",
    );
    if (!joined) {
      problems.push({ nodeIds: [node.id], message: `${label(node)} must be connected to a subnet with a network edge.` });
    }
  }

  return problems;
}

// First free prefix of `bits` length inside the VNet, or null when full.
export function freeSubnetPrefix(addressSpace: unknown, used: unknown[], bits = 24): string | null {
  const space = parseCidr(addressSpace);
  if (!space) return null;
  const spaceBits = 32 - Math.log2(space.end - space.start + 1);
  const length = Math.max(bits, spaceBits);
  const size = 2 ** (32 - length);
  const taken = used.map(parseCidr).filter((range): range is Cidr => range !== null);
  for (let start = space.start; start + size - 1 <= space.end; start += size) {
    const end = start + size - 1;
    if (taken.some((range) => range.start <= end && start <= range.end)) continue;
    const octets = [24, 16, 8, 0].map((shift) => Math.floor(start / 2 ** shift) % 256);
    return `${octets.join(".")}/${length}`;
  }
  return null;
}
