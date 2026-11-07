"use client";

import { toast } from "sonner";
import { importDiagram } from "@/components/ImportNotes";
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
  Position,
  ReactFlowProvider,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import { useGraphStore } from "@/lib/session/store";
import { canConnect } from "@/lib/catalogue/connections";
import {
  EDGE_KINDS,
  EdgeKind,
  ServiceType,
  SERVICE_TYPES,
  isContainerType,
  nodeSize,
} from "@/lib/graph/schema";
import { ServiceNode, type CanvasNodeData } from "./ServiceNode";
import { ContainerNode } from "./ContainerNode";
import { isPortableFile } from "@/lib/graph/portable";
import { downloadDataUrl, imageFilename, renderDiagramImage, type ImageFormat } from "@/components/canvas/image-export";
import { absolutePosition, placeAt } from "@/lib/session/geometry";
import { newNode } from "@/lib/session/new-node";
import { useSessionUi } from "@/lib/session/ui";

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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

// isValidConnection fires repeatedly while dragging, so one toast id keeps a
// single connection warning on screen.
function setConnectionError(message: string | null) {
  if (message) toast.error(message, { id: "connection-error" });
  else toast.dismiss("connection-error");
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
  const fitRequest = useSessionUi((s) => s.fitRequest);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView, getNodes } = useReactFlow();
  const [exportingImage, setExportingImage] = useState(false);

  const exportImage = useCallback(async (format: ImageFormat) => {
    const wrapper = reactFlowWrapper.current;
    if (!wrapper) return;
    setExportingImage(true);
    try {
      const background = window.getComputedStyle(wrapper).backgroundColor || "#fafafa";
      const dataUrl = await renderDiagramImage(wrapper, getNodes(), format, background);
      const filename = imageFilename(document.metadata.name, format);
      downloadDataUrl(dataUrl, filename);
      toast.success(`Exported ${filename}.`, { id: "image-export" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export the diagram image.");
    } finally {
      setExportingImage(false);
    }
  }, [document.metadata.name, getNodes]);

  // fitView skips nodes React Flow has not measured yet, so wait until every
  // node on the canvas has a size.
  useEffect(() => {
    if (fitRequest === 0) return;
    let frame = 0;
    let attempts = 0;
    const fitWhenMeasured = () => {
      const measured = getNodes();
      const ready = measured.length === useGraphStore.getState().document.nodes.length && measured.every((n) => n.width && n.height);
      if (ready || ++attempts > 60) fitView({ padding: 0.3, duration: 250, maxZoom: 1.0, minZoom: 0.3 });
      else frame = window.requestAnimationFrame(fitWhenMeasured);
    };
    frame = window.requestAnimationFrame(fitWhenMeasured);
    return () => window.cancelAnimationFrame(frame);
  }, [fitRequest, fitView, getNodes]);

  // Containers render first so their children draw on top of them.
  const nodes = useMemo<Node<CanvasNodeData>[]>(() => {
    const sorted = [...document.nodes].sort((a, b) => Number(isContainerType(b.type)) - Number(isContainerType(a.type)));
    return sorted.map((n) => {
      const container = isContainerType(n.type);
      const size = nodeSize(n);
      return {
        id: n.id,
        type: container ? "container" : "service",
        position: n.position,
        parentNode: n.parentId ?? undefined,
        extent: n.parentId ? ("parent" as const) : undefined,
        selected: selectedNodeId === n.id,
        style: container ? { width: size.width, height: size.height, zIndex: -1 } : undefined,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: { serviceType: n.type, name: n.name, resourceName: n.resourceName },
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

  // React Flow's changes go straight to the store, which is the only copy
  // of the diagram.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === "remove") removeNode(change.id);
        if (change.type === "select" && change.selected) selectNode(change.id);
        if (change.type !== "position") continue;
        const current = useGraphStore.getState().document;
        const node = current.nodes.find((n) => n.id === change.id);
        if (!node) continue;
        const position = change.position ?? node.position;
        if (change.dragging || isContainerType(node.type)) {
          moveNode(node.id, position);
          continue;
        }
        const point = absolutePosition(current, { ...node, position });
        const target = placeAt(current, point, node.type, node.id);
        if (target.parentId === (node.parentId ?? null)) moveNode(node.id, position);
        else reparentNode(node.id, target.parentId, target.position);
      }
    },
    [moveNode, removeNode, reparentNode, selectNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === "remove") removeEdge(change.id);
      }
    },
    [removeEdge],
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
      addEdge({ source: connection.source, target: connection.target, kind: result.kind });
      setConnectionError(null);
    },
    [addEdge, document],
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) {
        void importDiagram(files.find(isPortableFile) ?? files[0]).then((loaded) => { if (loaded) setConnectionError(null); });
        return;
      }
      const type = event.dataTransfer.getData("application/bunya-service") as ServiceType | "";
      if (!type || !SERVICE_TYPES.includes(type)) return;
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(newNode(document, { type, ...placeAt(document, point, type) }));
    },
    [addNode, document, screenToFlowPosition],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;

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
      aria-label="Architecture canvas"
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
        onNodeClick={(_, node) => selectNode(node.id)}
        onEdgeClick={(_, edge) => selectEdge(edge.id)}
        onPaneClick={() => {
          selectNode(null);
          selectEdge(null);
          setConnectionError(null);
        }}
        snapToGrid
        snapGrid={[16, 16]}
        deleteKeyCode={null}
        connectionRadius={28}
      >
        <Background gap={16} />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
      {document.nodes.length > 0 && (
        <div className="absolute right-4 top-4 z-10 flex overflow-hidden rounded-md border border-zinc-200 bg-white text-xs font-medium shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" role="group" aria-label="Export diagram image">
          <span className="px-2 py-1 text-zinc-500 dark:text-zinc-400">Image</span>
          {(["jpeg", "png"] as const).map((format) => (
            <button
              key={format}
              type="button"
              disabled={exportingImage}
              onClick={() => void exportImage(format)}
              className="border-l border-zinc-200 px-2 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              title={`Download the whole diagram as ${format === "jpeg" ? "a JPEG" : "a PNG"}`}
            >
              {format === "jpeg" ? "JPEG" : "PNG"}
            </button>
          ))}
        </div>
      )}
      {document.nodes.length === 0 && <div className="pointer-events-none absolute inset-x-4 top-12 text-center text-sm text-zinc-600">
        <p className="font-semibold">Start your Azure architecture</p><p>Add a service from the palette or choose a starter template.</p>
      </div>}
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
