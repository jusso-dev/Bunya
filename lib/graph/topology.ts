import type { GraphDocument, GraphNode, ServiceType } from "./schema";
import { parseContainerImage, planFamily } from "@/lib/catalogue/app-service-plans";
import { storagePublicNetwork } from "@/lib/catalogue/services";

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

// "azure": Azure itself rejects or cannot run this design.
// "bunya": the design may run in Azure, but Bunya cannot export it faithfully.
export type TopologyProblem = { nodeIds: string[]; message: string; kind: "azure" | "bunya" };

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

// Services a Private Endpoint can connect to (catalogue privateEndpoint
// targets other than its subnet and DNS zones).
export const PRIVATE_LINK_TARGETS: ReadonlySet<ServiceType> = new Set([
  "storageAccount",
  "keyVault",
  "sqlDatabase",
  "cosmosDb",
  "containerRegistry",
  "appService",
  "functionApp",
]);

// The service a Private Endpoint connects to, whatever order its edges were drawn in.
export function privateEndpointTarget(document: GraphDocument, pe: GraphNode): GraphNode | undefined {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  return document.edges
    .filter((edge) => edge.source === pe.id && edge.kind === "network")
    .map((edge) => byId.get(edge.target))
    .find((target): target is GraphNode => !!target && PRIVATE_LINK_TARGETS.has(target.type));
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

// Flex Consumption language versions (Microsoft Learn, "Supported language
// stack versions", Flex Consumption plan, November 2026).
const FLEX_RUNTIME_VERSIONS: Record<string, readonly string[]> = {
  dotnet: ["8.0", "9.0", "10.0"],
  java: ["8", "11", "17", "21", "25"],
  node: ["22", "24"],
  powershell: ["7.4", "7.6"],
  python: ["3.10", "3.11", "3.12", "3.13", "3.14"],
};

// Canonical Flex runtime version: "22-lts" -> "22", .NET "8" -> "8.0".
// Exporters emit this same value, so validation and output always agree.
export function flexRuntimeVersion(runtime: string, version: string): string {
  const trimmed = version.trim().replace(/-lts$/i, "");
  return runtime === "dotnet" && /^\d+$/.test(trimmed) ? `${trimmed}.0` : trimmed;
}

// Storage sub-resources a Function App needs over Private Endpoints when its
// storage account has no public endpoint (Microsoft Learn, "Restrict your
// storage account to a virtual network"). Elastic Premium keeps its content
// share in Azure Files; every plan's host uses blob and table storage.
// Durable Functions also need queue, which Bunya cannot see, so it is not required.
export function requiredStorageEndpoints(sku: unknown): string[] {
  const family = planFamily(sku);
  if (family === "flex") return ["blob"];
  if (family === "elastic") return ["blob", "file", "table"];
  return ["blob", "table"];
}

const STORAGE_DNS_ZONES: Record<string, string> = {
  blob: "privatelink.blob.core.windows.net",
  file: "privatelink.file.core.windows.net",
  queue: "privatelink.queue.core.windows.net",
  table: "privatelink.table.core.windows.net",
};

// A Private Endpoint only works when the app resolves the storage hostname to
// it: its privatelink zone must be attached to the endpoint and linked to the
// app's VNet. A VNet with custom DNS servers resolves names itself.
function resolvesPrivately(document: GraphDocument, pe: GraphNode, groupId: string, appVnet: GraphNode): boolean {
  const servers = appVnet.properties.dnsServers;
  if (Array.isArray(servers) && servers.length > 0) return true;
  const zoneName = STORAGE_DNS_ZONES[groupId];
  const linked = (a: string, b: string) =>
    document.edges.some((edge) => edge.kind === "network" && ((edge.source === a && edge.target === b) || (edge.source === b && edge.target === a)));
  return document.nodes.some(
    (zone) =>
      zone.type === "privateDnsZone" &&
      String(zone.properties.zoneName ?? zone.resourceName) === zoneName &&
      linked(pe.id, zone.id) &&
      document.edges.some((edge) => edge.kind === "network" && edge.source === zone.id && edge.target === appVnet.id),
  );
}

// Sub-resources of `storage` with a Private Endpoint in the app's VNet that
// the app can resolve; `unresolved` collects endpoints missing DNS.
function privateStorageEndpoints(document: GraphDocument, site: GraphNode, storage: GraphNode, unresolved: Set<string> = new Set()): Set<string> {
  const subnet = siteIntegrationSubnet(document, site);
  const appVnet = subnet ? subnetVirtualNetwork(document, subnet) : undefined;
  const found = new Set<string>();
  if (!appVnet) return found;
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  for (const pe of document.nodes.filter((node) => node.type === "privateEndpoint")) {
    const targets = document.edges.filter((edge) => edge.source === pe.id && edge.kind === "network").map((edge) => byId.get(edge.target));
    if (!targets.some((target) => target?.id === storage.id)) continue;
    const peSubnet = targets.find((target) => target?.type === "subnet");
    if (!peSubnet || subnetVirtualNetwork(document, peSubnet)?.id !== appVnet.id) continue;
    const groupId = String(pe.properties.groupId ?? "blob");
    if (resolvesPrivately(document, pe, groupId, appVnet)) found.add(groupId);
    else unresolved.add(groupId);
  }
  for (const groupId of found) unresolved.delete(groupId);
  return found;
}

// The registry a site pulls its image from, when that registry is drawn.
export function siteRegistry(document: GraphDocument, site: GraphNode): GraphNode | undefined {
  const image = parseContainerImage(String(site.properties.containerImage ?? ""));
  if (!image) return undefined;
  const host = image.registryHost.toLowerCase();
  return document.nodes.find((node) => node.type === "containerRegistry" && `${node.resourceName.toLowerCase()}.azurecr.io` === host);
}

// True when the site, or a user-assigned identity it carries, has an identity
// edge to the registry, so exports can turn on managed-identity pulls.
export function hasRegistryPullIdentity(document: GraphDocument, site: GraphNode, registry: GraphNode): boolean {
  const identityTargets = (id: string) =>
    document.edges.filter((edge) => edge.source === id && edge.kind === "identity").map((edge) => edge.target);
  const direct = identityTargets(site.id);
  if (direct.includes(registry.id)) return true;
  return direct.some((id) => document.nodes.find((node) => node.id === id)?.type === "userAssignedIdentity" && identityTargets(id).includes(registry.id));
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
      problems.push({ nodeIds: pair, message: `${label(site)} runs on the Windows plan ${label(plan)}. Bunya exports Linux apps only, so it cannot generate code for this app; exclude it, or switch it to Linux if the app supports that.`, kind: "bunya" });
    }
    if (site.type === "appService" && family !== "dedicated") {
      problems.push({ nodeIds: pair, message: `${label(site)} is a web app, but ${label(plan)} (${sku}) only hosts Function Apps; use a Basic, Standard or Premium plan.`, kind: "azure" });
    }
    if (site.properties.containerImage && (family === "consumption" || family === "flex")) {
      problems.push({ nodeIds: pair, message: `${label(site)} runs a container image, which ${label(plan)} (${sku}) does not support; use an Elastic Premium or dedicated plan, or clear the image.`, kind: "azure" });
    }
    const registry = siteRegistry(document, site);
    if (registry && !hasRegistryPullIdentity(document, site, registry)) {
      problems.push({ nodeIds: [site.id, registry.id], message: `${label(site)} pulls its image from ${label(registry)} with registry credentials, which Bunya does not export. Draw an identity edge from the app (or a user-assigned identity it uses) to the registry so the exported code pulls with managed identity and grants AcrPull.`, kind: "bunya" });
    }
    if (family === "flex" && site.type === "functionApp") {
      const runtime = String(site.properties.runtime ?? "node");
      const allowed = FLEX_RUNTIME_VERSIONS[runtime] ?? [];
      const version = flexRuntimeVersion(runtime, String(site.properties.runtimeVersion ?? ""));
      if (!allowed.includes(version)) {
        problems.push({ nodeIds: pair, message: `${label(site)} uses ${runtime} ${String(site.properties.runtimeVersion)}, which Flex Consumption no longer accepts for new deployments (a running app keeps working); use ${runtime} ${allowed.join(", ")} to export it.`, kind: "bunya" });
      }
    }
    const backingStorage = site.type === "functionApp"
      ? document.edges.filter((edge) => edge.source === site.id && edge.kind === "data").map((edge) => byId.get(edge.target)).find((target) => target?.type === "storageAccount")
      : undefined;
    if (backingStorage && !storagePublicNetwork(backingStorage.properties)) {
      const needed = requiredStorageEndpoints(sku);
      const unresolved = new Set<string>();
      const present = privateStorageEndpoints(document, site, backingStorage, unresolved);
      const missing = needed.filter((groupId) => !present.has(groupId) && !unresolved.has(groupId));
      const noDns = needed.filter((groupId) => unresolved.has(groupId));
      if (noDns.length > 0) {
        problems.push({ nodeIds: [site.id, backingStorage.id], message: `Bunya cannot see how ${label(site)} resolves ${label(backingStorage)} privately (for example DNS zones in another subscription or a hub VNet): link ${noDns.map((groupId) => STORAGE_DNS_ZONES[groupId]).join(", ")} to its ${noDns.join(", ")} Private Endpoint${noDns.length > 1 ? "s" : ""} and to the app's VNet, or set custom DNS servers on the VNet.`, kind: "bunya" });
      }
      if (missing.length > 0) {
        const how = siteIntegrationSubnet(document, site)
          ? `add ${missing.join(", ")} Private Endpoints to it in the app's VNet`
          : `integrate the app with a VNet that has ${needed.join(", ")} Private Endpoints to it`;
        problems.push({ nodeIds: [site.id, backingStorage.id], message: `Bunya cannot see how ${label(site)} reaches ${label(backingStorage)}: its public network access is off and the diagram has no private path (peered hub networks are not modelled), so ${how}, or turn public network access on.${needed.includes("table") ? " Durable Functions also need a queue Private Endpoint." : ""}`, kind: "bunya" });
      }
    }
    if (family === "flex" && site.type === "functionApp" && !document.edges.some((edge) => edge.source === site.id && edge.kind === "data" && byId.get(edge.target)?.type === "storageAccount")) {
      problems.push({ nodeIds: pair, message: `${label(site)} runs on Flex Consumption, which deploys packages from a storage account that is not in this diagram; draw a data edge from the app to the Storage Account it uses.`, kind: "bunya" });
    }
    if (family === "consumption" && siteIntegrationSubnet(document, site)) {
      problems.push({ nodeIds: pair, message: `${label(site)} has VNet integration, which the Consumption plan ${label(plan)} (Y1) does not support; use Flex Consumption, Elastic Premium or a dedicated plan.`, kind: "azure" });
    }
  }

  for (const plan of document.nodes.filter((node) => node.type === "appServicePlan")) {
    const sku = String(plan.properties.sku);
    const family = planFamily(sku);
    const sites = sitesByPlan.get(plan.id) ?? [];
    if (family === "flex" && sites.length > 1) {
      problems.push({ nodeIds: [plan.id, ...sites.map((site) => site.id)], message: `${label(plan)} is a Flex Consumption plan, which hosts one Function App; give each app its own FC1 plan.`, kind: "azure" });
    }
    const capacity = Number(plan.properties.capacity);
    if ((family === "dedicated" || family === "elastic") && capacity < 1) {
      problems.push({ nodeIds: [plan.id], message: `${label(plan)} (${sku}) needs at least 1 instance; only Consumption and Flex Consumption plans run with 0.`, kind: "azure" });
    }
  }

  for (const subnet of document.nodes.filter((node) => node.type === "subnet")) {
    const delegations = subnetDelegations(document, subnet);
    if (delegations.length > 1) {
      problems.push({ nodeIds: [subnet.id], message: `${label(subnet)} would need several delegations (${delegations.join(", ")}); a subnet can be delegated to one service, so give each plan type its own subnet.`, kind: "azure" });
    }
    if (delegations.length === 0) continue;
    const others = document.edges
      .filter((edge) => edge.target === subnet.id && edge.kind === "network")
      .map((edge) => byId.get(edge.source))
      .filter((source): source is GraphNode => !!source && !isSite(source) && source.type !== "networkSecurityGroup");
    for (const other of others) {
      problems.push({ nodeIds: [other.id, subnet.id], message: `${label(other)} cannot join ${label(subnet)} because the subnet is delegated to ${delegations.join(", ")} for VNet integration; use a separate subnet.`, kind: "azure" });
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
      problems.push({ nodeIds: [node.id], message: `${label(node)}: a Resource Group cannot sit inside another container.`, kind: "azure" });
    } else if (parent && !acceptsChild(parent.type, node.type)) {
      problems.push({
        nodeIds: [node.id, parent.id],
        message: `${label(node)} cannot be placed inside ${label(parent)}; move it to the Resource Group${node.type === "subnet" ? " or a Virtual Network" : ""}.`,
        kind: "azure",
      });
    }
  }

  const subnetsByVnet = new Map<string, GraphNode[]>();
  for (const subnet of document.nodes.filter((node) => node.type === "subnet")) {
    const vnet = subnetVirtualNetwork(document, subnet);
    if (!vnet) {
      problems.push({ nodeIds: [subnet.id], message: `${label(subnet)} must belong to a Virtual Network; place it inside one.`, kind: "azure" });
      continue;
    }
    const list = subnetsByVnet.get(vnet.id) ?? [];
    list.push(subnet);
    subnetsByVnet.set(vnet.id, list);
  }

  for (const [vnetId, subnets] of subnetsByVnet) {
    const vnet = byId.get(vnetId)!;
    // A subnet may sit in any of the VNet's address ranges.
    const spaces = [vnet.properties.addressSpace, ...(Array.isArray(vnet.properties.additionalAddressSpaces) ? vnet.properties.additionalAddressSpaces : [])]
      .map(parseCidr)
      .filter((space): space is Cidr => space !== null);
    const ranges = subnets.map((subnet) => ({ subnet, range: parseCidr(subnet.properties.addressPrefix) }));
    for (const { subnet, range } of ranges) {
      if (spaces.length > 0 && range && !spaces.some((space) => range.start >= space.start && range.end <= space.end)) {
        problems.push({
          nodeIds: [subnet.id, vnet.id],
          message: `${label(subnet)} prefix ${String(subnet.properties.addressPrefix)} is outside ${label(vnet)} address space ${String(vnet.properties.addressSpace)}.`,
          kind: "azure",
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
            kind: "azure",
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
      problems.push({ nodeIds: [node.id], message: `${label(node)} must be connected to a subnet with a network edge.`, kind: "azure" });
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
