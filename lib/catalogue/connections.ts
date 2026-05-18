import { GraphDocument, EdgeKind, ServiceType } from "@/lib/graph/schema";
import { topologicalSort } from "@/lib/generators/shared/ordering";
import { getServiceDefinition, isEdgeKindAllowed, inferDefaultEdgeKind } from "./services";

export type ConnectionResult =
  | { ok: true; kind: EdgeKind }
  | { ok: false; reason: string };

export function canConnect(
  graph: GraphDocument,
  sourceId: string,
  targetId: string,
  preferredKind?: EdgeKind,
): ConnectionResult {
  if (sourceId === targetId) {
    return { ok: false, reason: "Cannot connect a resource to itself." };
  }
  const source = graph.nodes.find((n) => n.id === sourceId);
  const target = graph.nodes.find((n) => n.id === targetId);
  if (!source || !target) {
    return { ok: false, reason: "Source or target node is missing." };
  }
  const sourceDef = getServiceDefinition(source.type);
  if (sourceDef.allowedEdgeTargets.length === 0) {
    return {
      ok: false,
      reason: `${sourceDef.label} cannot originate edges.`,
    };
  }
  if (!sourceDef.allowedEdgeTargets.includes(target.type)) {
    return {
      ok: false,
      reason: `${sourceDef.label} cannot connect to ${getServiceDefinition(target.type).label}.`,
    };
  }
  const duplicate = graph.edges.find(
    (e) => e.source === sourceId && e.target === targetId,
  );
  if (duplicate) {
    return { ok: false, reason: "Edge already exists between these nodes." };
  }
  const kind = preferredKind ?? inferDefaultEdgeKind(source.type, target.type);
  if (!isEdgeKindAllowed(source.type, target.type, kind)) {
    return {
      ok: false,
      reason: `${kind} edge is not allowed from ${sourceDef.label} to ${getServiceDefinition(target.type).label}.`,
    };
  }
  const candidate: GraphDocument = {
    ...graph,
    edges: [...graph.edges, { id: "__candidate__", source: sourceId, target: targetId, kind }],
  };
  const topo = topologicalSort(candidate);
  if (!topo.ok) {
    return { ok: false, reason: "Connecting these nodes would create a dependency cycle." };
  }
  return { ok: true, kind };
}

export function describeAllowedTargets(type: ServiceType): { type: ServiceType; label: string }[] {
  const def = getServiceDefinition(type);
  return def.allowedEdgeTargets.map((t) => ({
    type: t,
    label: getServiceDefinition(t).label,
  }));
}
