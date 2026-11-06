import type { GraphDocument, GraphNode, ServiceType } from "./schema";
import { planFamily } from "@/lib/catalogue/app-service-plans";

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

export function isSite(node: GraphNode | undefined): boolean {
  return node?.type === "appService" || node?.type === "functionApp";
}

// The plan a web or function app runs on: its container, else a depends_on edge.
export function sitePlan(document: GraphDocument, site: GraphNode): GraphNode | undefined {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const parent = site.parentId ? byId.get(site.parentId) : undefined;
  if (parent?.type === "appServicePlan") return parent;
  return document.edges
    .filter((edge) => edge.source === site.id && edge.kind === "depends_on")
    .map((edge) => byId.get(edge.target))
    .find((target) => target?.type === "appServicePlan");
}

// The subnet a web or function app integrates with (regional VNet integration).
export function siteIntegrationSubnet(document: GraphDocument, site: GraphNode): GraphNode | undefined {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  return document.edges
    .filter((edge) => edge.source === site.id && edge.kind === "network")
    .map((edge) => byId.get(edge.target))
    .find((target) => target?.type === "subnet");
}

// Flex Consumption integrates through Container Apps environments; every
// other plan through App Service plans.
export function integrationDelegation(document: GraphDocument, site: GraphNode): string {
  const plan = sitePlan(document, site);
  return planFamily(plan?.properties.sku) === "flex" ? "Microsoft.App/environments" : "Microsoft.Web/serverFarms";
}

// Delegations a subnet needs: those set on the subnet plus one for each
// integrated web or function app.
export function subnetDelegations(document: GraphDocument, subnet: GraphNode): string[] {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const declared = Array.isArray(subnet.properties.delegations)
    ? subnet.properties.delegations.filter((value): value is string => typeof value === "string")
    : [];
  const derived = document.edges
    .filter((edge) => edge.target === subnet.id && edge.kind === "network")
    .map((edge) => byId.get(edge.source))
    .filter((source): source is GraphNode => isSite(source))
    .map((site) => integrationDelegation(document, site));
  return [...new Set([...declared, ...derived])];
}

function hostingProblems(document: GraphDocument): TopologyProblem[] {
  const problems: TopologyProblem[] = [];
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const sitesByPlan = new Map<string, GraphNode[]>();

  for (const site of document.nodes.filter(isSite)) {
    const plan = sitePlan(document, site);
    if (!plan) continue;
    sitesByPlan.set(plan.id, [...(sitesByPlan.get(plan.id) ?? []), site]);
    const sku = String(plan.properties.sku);
    const family = planFamily(sku);
    const pair = [site.id, plan.id];
    if (plan.properties.os === "Windows") {
      problems.push({ nodeIds: pair, message: `${label(site)} is exported as a Linux app, but ${label(plan)} is a Windows plan; set the plan OS to Linux.` });
    }
    if (site.type === "appService" && family !== "dedicated") {
      problems.push({ nodeIds: pair, message: `${label(site)} is a web app, but ${label(plan)} (${sku}) only hosts Function Apps; use a Basic, Standard or Premium plan.` });
    }
    if (site.properties.containerImage && (family === "consumption" || family === "flex")) {
      problems.push({ nodeIds: pair, message: `${label(site)} runs a container image, which ${label(plan)} (${sku}) does not support; use an Elastic Premium or dedicated plan, or clear the image.` });
    }
    if (family === "consumption" && siteIntegrationSubnet(document, site)) {
      problems.push({ nodeIds: pair, message: `${label(site)} has VNet integration, which the Consumption plan ${label(plan)} (Y1) does not support; use Flex Consumption, Elastic Premium or a dedicated plan.` });
    }
  }

  for (const plan of document.nodes.filter((node) => node.type === "appServicePlan")) {
    const sku = String(plan.properties.sku);
    const family = planFamily(sku);
    const sites = sitesByPlan.get(plan.id) ?? [];
    if (family === "flex" && sites.length > 1) {
      problems.push({ nodeIds: [plan.id, ...sites.map((site) => site.id)], message: `${label(plan)} is a Flex Consumption plan, which hosts one Function App; give each app its own FC1 plan.` });
    }
    const capacity = Number(plan.properties.capacity);
    if ((family === "dedicated" || family === "elastic") && capacity < 1) {
      problems.push({ nodeIds: [plan.id], message: `${label(plan)} (${sku}) needs at least 1 instance; only Consumption and Flex Consumption plans run with 0.` });
    }
  }

  for (const subnet of document.nodes.filter((node) => node.type === "subnet")) {
    const delegations = subnetDelegations(document, subnet);
    if (delegations.length > 1) {
      problems.push({ nodeIds: [subnet.id], message: `${label(subnet)} would need several delegations (${delegations.join(", ")}); a subnet can be delegated to one service, so give each plan type its own subnet.` });
    }
    if (delegations.length === 0) continue;
    const others = document.edges
      .filter((edge) => edge.target === subnet.id && edge.kind === "network")
      .map((edge) => byId.get(edge.source))
      .filter((source): source is GraphNode => !!source && !isSite(source) && source.type !== "networkSecurityGroup");
    for (const other of others) {
      problems.push({ nodeIds: [other.id, subnet.id], message: `${label(other)} cannot join ${label(subnet)} because the subnet is delegated to ${delegations.join(", ")} for VNet integration; use a separate subnet.` });
    }
  }

  return problems;
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

  problems.push(...hostingProblems(document));
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
