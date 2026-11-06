import {
  DEFAULT_CONTAINER_SIZE,
  isContainerType,
  type GraphDocument,
  type GraphNode,
  type ServiceType,
} from "@/lib/graph/schema";
import { acceptsChild } from "@/lib/graph/topology";

// TODO(untangle): use SERVICE_NODE_SIZE from lib/graph/schema
export const SERVICE_NODE_SIZE = { width: 220, height: 50 } as const;

export type Point = { x: number; y: number };

export function nodeSize(node: Pick<GraphNode, "type" | "size">): { width: number; height: number } {
  if (node.size) return node.size;
  if (isContainerType(node.type)) return DEFAULT_CONTAINER_SIZE[node.type];
  return SERVICE_NODE_SIZE;
}

// Node positions are relative to their parent container.
export function absolutePosition(document: GraphDocument, node: Pick<GraphNode, "id" | "position" | "parentId">): Point {
  let { x, y } = node.position;
  const visited = new Set<string>([node.id]);
  let cursor = node.parentId ? document.nodes.find((n) => n.id === node.parentId) : undefined;
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    x += cursor.position.x;
    y += cursor.position.y;
    const parentId = cursor.parentId;
    cursor = parentId ? document.nodes.find((n) => n.id === parentId) : undefined;
  }
  return { x, y };
}

// The innermost container at `point` that may hold a node of `childType`.
export function findContainerAt(
  document: GraphDocument,
  point: Point,
  childType: ServiceType,
  excludeId?: string,
): GraphNode | null {
  let chosen: GraphNode | null = null;
  let chosenArea = Number.POSITIVE_INFINITY;
  for (const container of document.nodes) {
    if (container.id === excludeId || !isContainerType(container.type) || !acceptsChild(container.type, childType)) continue;
    const origin = absolutePosition(document, container);
    const { width, height } = nodeSize(container);
    const inside = point.x >= origin.x && point.x <= origin.x + width && point.y >= origin.y && point.y <= origin.y + height;
    if (inside && width * height < chosenArea) {
      chosen = container;
      chosenArea = width * height;
    }
  }
  return chosen;
}

// Where a node of `type` lands when placed at the absolute `point`: inside
// the container under it, with a position relative to that container.
export function placeAt(
  document: GraphDocument,
  point: Point,
  type: ServiceType,
  excludeId?: string,
): { parentId: string | null; position: Point } {
  const parent = findContainerAt(document, point, type, excludeId);
  if (!parent) return { parentId: null, position: point };
  const origin = absolutePosition(document, parent);
  return { parentId: parent.id, position: { x: point.x - origin.x, y: point.y - origin.y } };
}
