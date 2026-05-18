"use client";

import { useCallback, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  NodeChange,
  applyNodeChanges,
  ReactFlowProvider,
} from "reactflow";
import "reactflow/dist/style.css";
import { useGraphStore } from "@/lib/graph/store";
import { getServiceDefinition } from "@/lib/catalogue/services";

function CanvasInner() {
  const document = useGraphStore((s) => s.document);
  const moveNode = useGraphStore((s) => s.moveNode);
  const selectNode = useGraphStore((s) => s.selectNode);

  const nodes = useMemo<Node[]>(
    () =>
      document.nodes.map((n) => ({
        id: n.id,
        position: n.position,
        data: { label: `${getServiceDefinition(n.type).label}\n${n.name}` },
        type: "default",
      })),
    [document.nodes],
  );

  const edges = useMemo<Edge[]>(
    () =>
      document.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.kind,
      })),
    [document.edges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, nodes);
      for (const node of next) {
        moveNode(node.id, node.position);
      }
    },
    [moveNode, nodes],
  );

  return (
    <div className="h-full w-full" data-testid="bunya-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => selectNode(node.id)}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
      >
        <Background gap={16} />
        <MiniMap />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
