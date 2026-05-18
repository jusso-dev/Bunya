"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  MiniMap,
  Node,
  NodeChange,
  Position,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import { useGraphStore } from "@/lib/graph/store";
import { getServiceDefinition, inferDefaultEdgeKind } from "@/lib/catalogue/services";
import { EDGE_KINDS, EdgeKind, ServiceType } from "@/lib/graph/schema";

const EDGE_COLOUR: Record<EdgeKind, string> = {
  network: "#1d4ed8",
  identity: "#b91c1c",
  data: "#b45309",
  depends_on: "#475569",
  diagnostic: "#5b21b6",
};

function defaultResourceName(type: ServiceType, index: number): string {
  const slug = type
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "");
  return `${slug}-${index}`;
}

function CanvasInner() {
  const document = useGraphStore((s) => s.document);
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const moveNode = useGraphStore((s) => s.moveNode);
  const addNode = useGraphStore((s) => s.addNode);
  const addEdge = useGraphStore((s) => s.addEdge);
  const removeNode = useGraphStore((s) => s.removeNode);
  const removeEdge = useGraphStore((s) => s.removeEdge);
  const setEdgeKind = useGraphStore((s) => s.setEdgeKind);
  const selectNode = useGraphStore((s) => s.selectNode);
  const selectEdge = useGraphStore((s) => s.selectEdge);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const { project } = useReactFlow();

  const nodes = useMemo<Node[]>(() => {
    return document.nodes.map((n) => {
      const def = getServiceDefinition(n.type);
      return {
        id: n.id,
        position: n.position,
        type: "default",
        data: { label: `${def.shortLabel} | ${n.name}` },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          padding: 6,
          borderRadius: 8,
          background: selectedNodeId === n.id ? "#fde68a" : "#ffffff",
          border:
            selectedNodeId === n.id
              ? "2px solid #b45309"
              : "1px solid #cbd5e1",
          fontFamily: "ui-sans-serif",
          fontSize: 12,
          color: "#0f172a",
          minWidth: 160,
        },
      } satisfies Node;
    });
  }, [document.nodes, selectedNodeId]);

  const edges = useMemo<Edge[]>(() => {
    return document.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.kind,
      animated: e.kind === "diagnostic",
      style: {
        stroke: EDGE_COLOUR[e.kind],
        strokeWidth: selectedEdgeId === e.id ? 3 : 1.5,
      },
      labelStyle: { fill: EDGE_COLOUR[e.kind], fontWeight: 600, fontSize: 11 },
    }));
  }, [document.edges, selectedEdgeId]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, nodes);
      for (const node of next) moveNode(node.id, node.position);
      for (const change of changes) {
        if (change.type === "remove") removeNode(change.id);
      }
    },
    [moveNode, nodes, removeNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      applyEdgeChanges(changes, edges);
      for (const change of changes) {
        if (change.type === "remove") removeEdge(change.id);
      }
    },
    [edges, removeEdge],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const source = document.nodes.find((n) => n.id === connection.source);
      const target = document.nodes.find((n) => n.id === connection.target);
      if (!source || !target) return;
      const kind = inferDefaultEdgeKind(source.type, target.type);
      addEdge({ source: connection.source, target: connection.target, kind });
    },
    [addEdge, document.nodes],
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const counterRef = useRef(1);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/bunya-service") as ServiceType | "";
      if (!type) return;
      const wrapper = reactFlowWrapper.current;
      if (!wrapper || !rfInstance) return;
      const bounds = wrapper.getBoundingClientRect();
      const position = project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      const def = getServiceDefinition(type);
      const index = counterRef.current++;
      addNode({
        type,
        position,
        name: `${def.label} ${index}`,
        resourceName: defaultResourceName(type, index),
        properties: { ...def.defaultProperties },
      });
    },
    [addNode, project, rfInstance],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.target instanceof HTMLInputElement) return;
      if (selectedNodeId) {
        removeNode(selectedNodeId);
        event.preventDefault();
        return;
      }
      if (selectedEdgeId) {
        removeEdge(selectedEdgeId);
        event.preventDefault();
      }
    },
    [removeEdge, removeNode, selectedEdgeId, selectedNodeId],
  );

  const selectedEdge = document.edges.find((e) => e.id === selectedEdgeId) ?? null;

  return (
    <div
      ref={reactFlowWrapper}
      className="relative h-full w-full bg-zinc-50"
      data-testid="bunya-canvas"
      onDragOver={onDragOver}
      onDrop={onDrop}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={setRfInstance}
        onNodeClick={(_, node) => selectNode(node.id)}
        onEdgeClick={(_, edge) => selectEdge(edge.id)}
        onPaneClick={() => {
          selectNode(null);
          selectEdge(null);
        }}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        deleteKeyCode={null}
      >
        <Background gap={16} />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
      {selectedEdge ? (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900">
          <span className="mr-2 font-semibold text-zinc-700 dark:text-zinc-200">
            Edge kind:
          </span>
          <select
            className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            value={selectedEdge.kind}
            onChange={(e) => setEdgeKind(selectedEdge.id, e.target.value as EdgeKind)}
          >
            {EDGE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => removeEdge(selectedEdge.id)}
            className="ml-3 text-xs font-medium text-red-600 hover:text-red-700"
          >
            Delete edge
          </button>
        </div>
      ) : null}
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
