import {
  EdgeKind,
  GraphDocument,
  GraphEdge,
  GraphNode,
  ServiceType,
} from "@/lib/graph/schema";
import { getServiceDefinition } from "@/lib/catalogue/services";

export type ImplicitAddition =
  | { kind: "node"; node: GraphNode; reason: string }
  | { kind: "edge"; edge: GraphEdge; reason: string };

export type ExpandedGraph = {
  document: GraphDocument;
  additions: ImplicitAddition[];
  autoNodeIds: Set<string>;
  autoEdgeIds: Set<string>;
};

let counter = 0;
function deterministicId(seed: string, kind: string): string {
  counter += 1;
  return `auto-${kind}-${seed}-${counter}`;
}

function makeNode(
  type: ServiceType,
  baseName: string,
  position: { x: number; y: number },
): GraphNode {
  const def = getServiceDefinition(type);
  return {
    id: deterministicId(baseName, type),
    type,
    name: `${def.label} (auto)`,
    resourceName: baseName,
    position,
    properties: { ...def.defaultProperties },
  };
}

function makeEdge(source: string, target: string, kind: EdgeKind): GraphEdge {
  return {
    id: deterministicId(`${source}-${target}`, kind),
    source,
    target,
    kind,
  };
}

export function expandImplicits(document: GraphDocument): ExpandedGraph {
  counter = 0;
  const nodes = [...document.nodes];
  const edges = [...document.edges];
  const additions: ImplicitAddition[] = [];
  const autoNodeIds = new Set<string>();
  const autoEdgeIds = new Set<string>();

  const findFirstOfType = (t: ServiceType) => nodes.find((n) => n.type === t);
  const hasOutgoing = (sourceId: string, targetType: ServiceType, kind?: EdgeKind) =>
    edges.some(
      (e) =>
        e.source === sourceId &&
        nodes.find((n) => n.id === e.target)?.type === targetType &&
        (kind === undefined || e.kind === kind),
    );
  const hasParent = (node: GraphNode, parentType: ServiceType) =>
    !!node.parentId && nodes.find((n) => n.id === node.parentId)?.type === parentType;

  let resourceGroup = findFirstOfType("resourceGroup");
  if (!resourceGroup) {
    resourceGroup = makeNode("resourceGroup", `rg-${document.metadata.name}`, { x: 0, y: 0 });
    nodes.push(resourceGroup);
    autoNodeIds.add(resourceGroup.id);
    additions.push({ kind: "node", node: resourceGroup, reason: "no Resource Group present in graph" });
  }
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === "resourceGroup") continue;
    if (n.parentId) continue;
    nodes[i] = { ...n, parentId: resourceGroup.id };
  }

  let plan = findFirstOfType("appServicePlan");
  const computeNodes = nodes.filter(
    (n) => n.type === "appService" || n.type === "functionApp",
  );

  for (const c of computeNodes) {
    if (!hasOutgoing(c.id, "appServicePlan", "depends_on") && !hasParent(c, "appServicePlan")) {
      if (!plan) {
        plan = makeNode("appServicePlan", `plan-${document.metadata.name}`, {
          x: c.position.x,
          y: c.position.y + 120,
        });
        nodes.push(plan);
        autoNodeIds.add(plan.id);
        additions.push({
          kind: "node",
          node: plan,
          reason: "App Service or Function App requires an App Service Plan",
        });
      }
      const edge = makeEdge(c.id, plan.id, "depends_on");
      edges.push(edge);
      autoEdgeIds.add(edge.id);
      additions.push({
        kind: "edge",
        edge,
        reason: `${c.type} must depend on an App Service Plan`,
      });
    }
  }

  const fnNodes = nodes.filter((n) => n.type === "functionApp");
  let storage = findFirstOfType("storageAccount");
  for (const fn of fnNodes) {
    if (!hasOutgoing(fn.id, "storageAccount", "data")) {
      if (!storage) {
        storage = makeNode("storageAccount", `${document.metadata.name}fn`, {
          x: fn.position.x + 200,
          y: fn.position.y + 120,
        });
        nodes.push(storage);
        autoNodeIds.add(storage.id);
        additions.push({
          kind: "node",
          node: storage,
          reason: "Function App requires a backing Storage Account",
        });
      }
      const edge = makeEdge(fn.id, storage.id, "data");
      edges.push(edge);
      autoEdgeIds.add(edge.id);
      additions.push({
        kind: "edge",
        edge,
        reason: "Function App needs a Storage Account for state",
      });
    }
  }

  const peNodes = nodes.filter((n) => n.type === "privateEndpoint");
  if (peNodes.length > 0) {
    let subnet = findFirstOfType("subnet");
    let vnet = findFirstOfType("virtualNetwork");
    for (const pe of peNodes) {
      if (!hasOutgoing(pe.id, "subnet", "network")) {
        if (!subnet) {
          if (!vnet) {
            vnet = makeNode("virtualNetwork", `vnet-${document.metadata.name}`, {
              x: pe.position.x - 240,
              y: pe.position.y - 80,
            });
            nodes.push(vnet);
            autoNodeIds.add(vnet.id);
            additions.push({
              kind: "node",
              node: vnet,
              reason: "Private Endpoint needs a hosting Virtual Network",
            });
          }
          subnet = makeNode("subnet", `snet-pe-${document.metadata.name}`, {
            x: pe.position.x - 240,
            y: pe.position.y + 40,
          });
          nodes.push(subnet);
          autoNodeIds.add(subnet.id);
          additions.push({
            kind: "node",
            node: subnet,
            reason: "Private Endpoint needs a delegated Subnet",
          });
          const snToVnet = makeEdge(subnet.id, vnet.id, "depends_on");
          edges.push(snToVnet);
          autoEdgeIds.add(snToVnet.id);
          additions.push({
            kind: "edge",
            edge: snToVnet,
            reason: "Subnet belongs to Virtual Network",
          });
        }
        const peToSubnet = makeEdge(pe.id, subnet.id, "network");
        edges.push(peToSubnet);
        autoEdgeIds.add(peToSubnet.id);
        additions.push({
          kind: "edge",
          edge: peToSubnet,
          reason: "Private Endpoint must be wired to a subnet",
        });
      }
    }
  }

  const aiNodes = nodes.filter((n) => n.type === "applicationInsights");
  let workspace = findFirstOfType("logAnalytics");
  for (const ai of aiNodes) {
    if (!hasOutgoing(ai.id, "logAnalytics", "depends_on")) {
      if (!workspace) {
        workspace = makeNode("logAnalytics", `log-${document.metadata.name}`, {
          x: ai.position.x + 200,
          y: ai.position.y,
        });
        nodes.push(workspace);
        autoNodeIds.add(workspace.id);
        additions.push({
          kind: "node",
          node: workspace,
          reason: "Application Insights v2 workspace-based requires Log Analytics",
        });
      }
      const edge = makeEdge(ai.id, workspace.id, "depends_on");
      edges.push(edge);
      autoEdgeIds.add(edge.id);
      additions.push({
        kind: "edge",
        edge,
        reason: "Application Insights must reference a Log Analytics workspace",
      });
    }
  }

  return {
    document: { ...document, nodes, edges },
    additions,
    autoNodeIds,
    autoEdgeIds,
  };
}

export function isAutoGenerated(graph: ExpandedGraph, id: string): boolean {
  return graph.autoNodeIds.has(id) || graph.autoEdgeIds.has(id);
}
