import { GraphDocument, GraphNode } from "@/lib/graph/schema";

export type TopoResult =
  | { ok: true; order: GraphNode[] }
  | { ok: false; cycle: string[] };

export function topologicalSort(graph: GraphDocument): TopoResult {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, string[]>();
  for (const n of graph.nodes) adjacency.set(n.id, []);
  for (const e of graph.edges) {
    if (e.kind === "diagnostic") continue;
    adjacency.get(e.source)?.push(e.target);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const id of nodesById.keys()) colour.set(id, WHITE);

  const order: GraphNode[] = [];
  const stack: { id: string; iter: Iterator<string> }[] = [];
  const path: string[] = [];

  for (const startId of nodesById.keys()) {
    if (colour.get(startId) !== WHITE) continue;
    stack.push({ id: startId, iter: (adjacency.get(startId) ?? [])[Symbol.iterator]() });
    colour.set(startId, GRAY);
    path.push(startId);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const next = frame.iter.next();
      if (next.done) {
        colour.set(frame.id, BLACK);
        const finished = nodesById.get(frame.id);
        if (finished) order.unshift(finished);
        stack.pop();
        path.pop();
        continue;
      }
      const childId = next.value;
      const childColour = colour.get(childId) ?? WHITE;
      if (childColour === GRAY) {
        const idx = path.indexOf(childId);
        return { ok: false, cycle: path.slice(idx).concat(childId) };
      }
      if (childColour === BLACK) continue;
      colour.set(childId, GRAY);
      path.push(childId);
      stack.push({ id: childId, iter: (adjacency.get(childId) ?? [])[Symbol.iterator]() });
    }
  }

  return { ok: true, order };
}
