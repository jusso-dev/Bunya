import type { EdgeKind, GraphDocument, GraphEdge, GraphNode, ServiceType } from "@/lib/graph/schema";
import { getServiceDefinition, storagePublicNetwork } from "@/lib/catalogue/services";
import { freeSubnetPrefix, isSite } from "@/lib/graph/topology";
import { planFamily } from "@/lib/catalogue/app-service-plans";

export type ExpandedGraph = {
  document: GraphDocument;
  autoNodeIds: Set<string>;
};

// Adds the resources Azure requires but the diagram may leave out: a resource
// group, a plan for each site, storage for each Function App, a subnet for
// each Private Endpoint and a workspace for each Application Insights
// component. Existing resources are reused where that keeps hosting the same.
export function expandImplicits(document: GraphDocument): ExpandedGraph {
  const nodes = [...document.nodes];
  const edges = [...document.edges];
  const autoNodeIds = new Set<string>();
  const reservedIds = new Set([...document.nodes, ...document.edges].map((item) => item.id));
  const slug = document.metadata.name.replace(/[^A-Za-z0-9_-]/g, "-");
  let counter = 0;

  const newId = (seed: string, kind: string): string => {
    let id: string;
    do { id = `auto-${kind}-${seed}-${++counter}`; } while (reservedIds.has(id));
    reservedIds.add(id);
    return id;
  };
  const addNode = (type: ServiceType, resourceName: string, position: { x: number; y: number }, properties: Record<string, unknown> = {}): GraphNode => {
    const def = getServiceDefinition(type);
    const node: GraphNode = {
      id: newId(resourceName, type),
      type,
      name: `${def.label} (auto)`,
      resourceName,
      position,
      properties: { ...def.defaultProperties, ...properties },
    };
    nodes.push(node);
    autoNodeIds.add(node.id);
    return node;
  };
  const addEdge = (source: string, target: string, kind: EdgeKind) => {
    const edge: GraphEdge = { id: newId(`${source}-${target}`, kind), source, target, kind };
    edges.push(edge);
  };
  const typeOf = (id: string | null | undefined) => nodes.find((node) => node.id === id)?.type;
  const hasOutgoing = (sourceId: string, targetType: ServiceType, kind: EdgeKind) =>
    edges.some((edge) => edge.source === sourceId && edge.kind === kind && typeOf(edge.target) === targetType);

  const resourceGroup = nodes.find((node) => node.type === "resourceGroup") ?? addNode("resourceGroup", `rg-${slug}`, { x: 0, y: 0 });
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== "resourceGroup" && !nodes[i].parentId) nodes[i] = { ...nodes[i], parentId: resourceGroup.id };
  }

  // Unattached sites share a dedicated Linux plan. Reusing a Flex,
  // Consumption, Elastic Premium or Windows plan would silently change
  // how the app is hosted (and often fails to deploy).
  let plan = nodes.find((node) => node.type === "appServicePlan" && planFamily(node.properties.sku) === "dedicated" && node.properties.os !== "Windows");
  for (const site of nodes.filter(isSite)) {
    if (hasOutgoing(site.id, "appServicePlan", "depends_on") || typeOf(site.parentId) === "appServicePlan") continue;
    plan ??= addNode("appServicePlan", `plan-${slug}`, { x: site.position.x, y: site.position.y + 120 });
    addEdge(site.id, plan.id, "depends_on");
  }

  // Only reuse an account the app can reach without private networking.
  let storage = nodes.find((node) => node.type === "storageAccount" && storagePublicNetwork(node.properties));
  for (const fn of nodes.filter((node) => node.type === "functionApp")) {
    if (hasOutgoing(fn.id, "storageAccount", "data")) continue;
    // The app has no private path to an auto-added account, so it must
    // reach the public endpoint. Anonymous blob access stays off.
    storage ??= addNode("storageAccount", `${slug}fn`, { x: fn.position.x + 200, y: fn.position.y + 120 }, { publicNetworkAccess: true });
    addEdge(fn.id, storage.id, "data");
  }

  // A Private Endpoint cannot share a subnet delegated to a service (for
  // example App Service VNet integration), so never place one there.
  const usableForEndpoints = (candidate: GraphNode) =>
    !(Array.isArray(candidate.properties.delegations) && candidate.properties.delegations.length > 0) &&
    !edges.some((edge) => edge.target === candidate.id && edge.kind === "network" && isSite(nodes.find((node) => node.id === edge.source)));
  let subnet = nodes.find((node) => node.type === "subnet" && usableForEndpoints(node));
  let vnet = nodes.find((node) => node.type === "virtualNetwork");
  for (const pe of nodes.filter((node) => node.type === "privateEndpoint")) {
    if (hasOutgoing(pe.id, "subnet", "network")) continue;
    if (!subnet) {
      vnet ??= addNode("virtualNetwork", `vnet-${slug}`, { x: pe.position.x - 240, y: pe.position.y - 80 });
      // The default prefix may fall outside an existing VNet's address space.
      const prefix = freeSubnetPrefix(vnet.properties.addressSpace, []);
      subnet = addNode("subnet", `snet-pe-${slug}`, { x: pe.position.x - 240, y: pe.position.y + 40 }, prefix ? { addressPrefix: prefix } : {});
      addEdge(subnet.id, vnet.id, "depends_on");
    }
    addEdge(pe.id, subnet.id, "network");
  }

  let workspace = nodes.find((node) => node.type === "logAnalytics");
  for (const ai of nodes.filter((node) => node.type === "applicationInsights")) {
    if (hasOutgoing(ai.id, "logAnalytics", "depends_on")) continue;
    workspace ??= addNode("logAnalytics", `log-${slug}`, { x: ai.position.x + 200, y: ai.position.y });
    addEdge(ai.id, workspace.id, "depends_on");
  }

  return { document: { ...document, nodes, edges }, autoNodeIds };
}
