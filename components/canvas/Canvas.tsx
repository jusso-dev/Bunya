"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  MarkerType,
  MiniMap,
  Node,
  NodeChange,
  NodePositionChange,
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
import { canConnect } from "@/lib/catalogue/connections";
import {
  DEFAULT_CONTAINER_SIZE,
  EDGE_KINDS,
  EdgeKind,
  GraphDocument,
  GraphNode,
  ServiceType,
  isContainerType,
} from "@/lib/graph/schema";
import { ServiceNode, ServiceNodeData } from "./ServiceNode";
import { ContainerNode } from "./ContainerNode";
import { isPortableFile, parseImportText, readFileAsText } from "@/lib/graph/portable";

const NODE_TYPES = {
  service: ServiceNode,
  container: ContainerNode,
};

const EDGE_COLOUR: Record<EdgeKind, string> = {
  network: "#1d4ed8",
  identity: "#b91c1c",
  data: "#b45309",
  depends_on: "#475569",
  diagnostic: "#7c3aed",
};

function defaultResourceName(type: ServiceType, index: number): string {
  const slug = type
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "");
  return `${slug}-${index}`;
}

function nodeSize(node: GraphNode): { width: number; height: number } {
  if (node.size) return node.size;
  if (isContainerType(node.type)) return DEFAULT_CONTAINER_SIZE[node.type];
  return { width: 220, height: 50 };
}

function absolutePosition(document: GraphDocument, node: GraphNode): { x: number; y: number } {
  let { x, y } = node.position;
  let cursor = node.parentId
    ? document.nodes.find((n) => n.id === node.parentId)
    : undefined;
  while (cursor) {
    x += cursor.position.x;
    y += cursor.position.y;
    cursor = cursor.parentId
      ? document.nodes.find((n) => n.id === cursor!.parentId)
      : undefined;
  }
  return { x, y };
}

function findContainerAt(
  document: GraphDocument,
  excludeId: string | null,
  point: { x: number; y: number },
  candidateType: ServiceType,
): GraphNode | null {
  const candidates = document.nodes
    .filter((n) => n.id !== excludeId && isContainerType(n.type))
    .filter((n) => acceptsChild(n.type, candidateType));
  let chosen: GraphNode | null = null;
  let chosenArea = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const abs = absolutePosition(document, c);
    const { width, height } = nodeSize(c);
    if (
      point.x >= abs.x &&
      point.x <= abs.x + width &&
      point.y >= abs.y &&
      point.y <= abs.y + height
    ) {
      const area = width * height;
      if (area < chosenArea) {
        chosen = c;
        chosenArea = area;
      }
    }
  }
  return chosen;
}

function acceptsChild(parentType: ServiceType, childType: ServiceType): boolean {
  if (parentType === "virtualNetwork") return childType === "subnet";
  if (parentType === "appServicePlan") {
    return childType === "appService" || childType === "functionApp";
  }
  if (parentType === "resourceGroup") {
    return childType !== "resourceGroup";
  }
  return false;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
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
  const reparentNode = useGraphStore((s) => s.reparentNode);
  const replaceDocument = useGraphStore((s) => s.replaceDocument);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const previousNodeCount = useRef(0);

  useEffect(() => {
    const count = document.nodes.length;
    if (count > previousNodeCount.current && count > 0) {
      const id = window.requestAnimationFrame(() => {
        fitView({ padding: 0.3, duration: 250, maxZoom: 1.0, minZoom: 0.3 });
      });
      previousNodeCount.current = count;
      return () => window.cancelAnimationFrame(id);
    }
    previousNodeCount.current = count;
  }, [document.nodes.length, fitView]);

  const nodes = useMemo<Node<ServiceNodeData>[]>(() => {
    const sorted = [...document.nodes].sort((a, b) => {
      if (isContainerType(a.type) && !isContainerType(b.type)) return -1;
      if (!isContainerType(a.type) && isContainerType(b.type)) return 1;
      return 0;
    });
    return sorted.map((n) => {
      const size = nodeSize(n);
      if (isContainerType(n.type)) {
        return {
          id: n.id,
          type: "container",
          position: n.position,
          parentNode: n.parentId ?? undefined,
          extent: n.parentId ? ("parent" as const) : undefined,
          selected: selectedNodeId === n.id,
          style: { width: size.width, height: size.height, zIndex: -1 },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: {
            serviceType: n.type,
            name: n.name,
            resourceName: n.resourceName,
            selected: selectedNodeId === n.id,
          },
        };
      }
      return {
        id: n.id,
        type: "service",
        position: n.position,
        parentNode: n.parentId ?? undefined,
        extent: n.parentId ? ("parent" as const) : undefined,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        selected: selectedNodeId === n.id,
        data: {
          serviceType: n.type,
          name: n.name,
          resourceName: n.resourceName,
          selected: selectedNodeId === n.id,
        },
      };
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
        strokeWidth: selectedEdgeId === e.id ? 2.5 : 1.5,
        strokeDasharray: e.kind === "diagnostic" ? "4 3" : undefined,
      },
      labelStyle: { fill: EDGE_COLOUR[e.kind], fontWeight: 600, fontSize: 10 },
      labelBgStyle: { fill: "#ffffff", fillOpacity: 0.85 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: EDGE_COLOUR[e.kind],
        width: 16,
        height: 16,
      },
    }));
  }, [document.edges, selectedEdgeId]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, nodes);
      for (const change of changes) {
        if (change.type === "remove") removeNode(change.id);
      }
      const positionChanges = changes.filter(
        (c): c is NodePositionChange => c.type === "position" && c.dragging === false,
      );
      for (const change of positionChanges) {
        const moved = next.find((n) => n.id === change.id);
        if (!moved) continue;
        const original = document.nodes.find((n) => n.id === change.id);
        if (!original) continue;
        if (isContainerType(original.type)) {
          moveNode(change.id, moved.position);
          continue;
        }
        const absPoint = (() => {
          if (!moved.parentNode) return moved.position;
          const parent = document.nodes.find((n) => n.id === moved.parentNode);
          if (!parent) return moved.position;
          const parentAbs = absolutePosition(document, parent);
          return { x: parentAbs.x + moved.position.x, y: parentAbs.y + moved.position.y };
        })();
        const newParent = findContainerAt(document, change.id, absPoint, original.type);
        const newParentId = newParent?.id ?? null;
        if ((newParentId ?? null) === (original.parentId ?? null)) {
          moveNode(change.id, moved.position);
        } else {
          const newPos = newParent
            ? {
                x: absPoint.x - absolutePosition(document, newParent).x,
                y: absPoint.y - absolutePosition(document, newParent).y,
              }
            : absPoint;
          reparentNode(change.id, newParentId, newPos);
        }
      }
      const liveDrags = changes.filter(
        (c): c is NodePositionChange => c.type === "position" && c.dragging === true,
      );
      for (const change of liveDrags) {
        const moved = next.find((n) => n.id === change.id);
        if (moved) moveNode(change.id, moved.position);
      }
    },
    [document, moveNode, nodes, removeNode, reparentNode],
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

  const isValidConnection = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return false;
      const result = canConnect(document, connection.source, connection.target);
      if (!result.ok) {
        setConnectionError(result.reason);
        return false;
      }
      return true;
    },
    [document],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const result = canConnect(document, connection.source, connection.target);
      if (!result.ok) {
        setConnectionError(result.reason);
        return;
      }
      const source = document.nodes.find((n) => n.id === connection.source);
      const target = document.nodes.find((n) => n.id === connection.target);
      if (!source || !target) return;
      const kind = inferDefaultEdgeKind(source.type, target.type);
      addEdge({ source: connection.source, target: connection.target, kind });
      setConnectionError(null);
    },
    [addEdge, document],
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const counterRef = useRef(1);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = Array.from(files).find(isPortableFile);
        if (file) {
          void (async () => {
            const text = await readFileAsText(file);
            const result = parseImportText(text);
            if (result.ok) {
              replaceDocument(result.document);
              if (typeof window !== "undefined") window.history.replaceState(null, "", "#");
              setConnectionError(null);
            } else {
              setConnectionError(`Import failed: ${result.reason}`);
            }
          })();
          return;
        }
      }
      const type = event.dataTransfer.getData("application/bunya-service") as ServiceType | "";
      if (!type) return;
      if (!rfInstance) return;
      const absPosition = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const parent = findContainerAt(document, null, absPosition, type);
      const def = getServiceDefinition(type);
      const index = counterRef.current++;
      const position = parent
        ? {
            x: absPosition.x - absolutePosition(document, parent).x,
            y: absPosition.y - absolutePosition(document, parent).y,
          }
        : absPosition;
      addNode({
        type,
        position,
        parentId: parent?.id ?? null,
        name: `${def.label} ${index}`,
        resourceName: defaultResourceName(type, index),
        properties: { ...def.defaultProperties },
        size: isContainerType(type) ? DEFAULT_CONTAINER_SIZE[type] : undefined,
      });
    },
    [addNode, document, replaceDocument, rfInstance, screenToFlowPosition],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
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
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onInit={setRfInstance}
        onNodeClick={(_, node) => selectNode(node.id)}
        onEdgeClick={(_, edge) => selectEdge(edge.id)}
        onPaneClick={() => {
          selectNode(null);
          selectEdge(null);
          setConnectionError(null);
        }}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        deleteKeyCode={null}
        disableKeyboardA11y
        connectionRadius={28}
      >
        <Background gap={16} />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
      {connectionError ? (
        <div className="pointer-events-auto absolute right-4 top-4 max-w-sm rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 shadow dark:bg-red-950/40 dark:text-red-200">
          <div className="flex items-start justify-between gap-2">
            <span>{connectionError}</span>
            <button
              type="button"
              onClick={() => setConnectionError(null)}
              className="text-red-500 hover:text-red-700"
              aria-label="Dismiss"
            >
              x
            </button>
          </div>
        </div>
      ) : null}
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
