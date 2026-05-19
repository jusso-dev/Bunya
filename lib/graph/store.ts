import { create, type StateCreator } from "zustand";
import { createStore } from "zustand/vanilla";
import { ulid } from "ulid";
import {
  EdgeKind,
  GraphDocument,
  GraphEdge,
  GraphNode,
  emptyGraph,
} from "./schema";

type AddNodeInput = Omit<GraphNode, "id">;
type AddEdgeInput = Omit<GraphEdge, "id">;

export type PanelId = "palette" | "properties" | "output" | "validation";

export type GraphStoreState = {
  document: GraphDocument;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  history: GraphDocument[];
  future: GraphDocument[];
  collapsed: Record<PanelId, boolean>;
};

export type GraphStoreActions = {
  addNode: (input: AddNodeInput) => string;
  removeNode: (id: string) => void;
  moveNode: (id: string, position: { x: number; y: number }) => void;
  resizeNode: (id: string, size: { width: number; height: number }) => void;
  reparentNode: (
    id: string,
    parentId: string | null,
    position: { x: number; y: number },
  ) => void;
  updateNode: (id: string, patch: Partial<Omit<GraphNode, "id">>) => void;
  updateNodeProperties: (id: string, patch: Record<string, unknown>) => void;
  addEdge: (input: AddEdgeInput) => string;
  removeEdge: (id: string) => void;
  setEdgeKind: (id: string, kind: EdgeKind) => void;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  setMetadata: (patch: Partial<GraphDocument["metadata"]>) => void;
  replaceDocument: (doc: GraphDocument) => void;
  reset: (doc?: GraphDocument) => void;
  undo: () => void;
  redo: () => void;
  togglePanel: (id: PanelId) => void;
  setPanelCollapsed: (id: PanelId, collapsed: boolean) => void;
};

export type GraphStore = GraphStoreState & GraphStoreActions;

const HISTORY_LIMIT = 50;

function pushHistory(state: GraphStoreState): Pick<GraphStoreState, "history" | "future"> {
  const next = [...state.history, state.document].slice(-HISTORY_LIMIT);
  return { history: next, future: [] };
}

const graphStoreInitializer: StateCreator<GraphStore> = (set, get) => ({
  document: emptyGraph("bunya"),
  selectedNodeId: null,
  selectedEdgeId: null,
  history: [],
  future: [],
  collapsed: { palette: false, properties: false, output: false, validation: false },

  togglePanel: (id) => {
    set((state) => ({
      collapsed: { ...state.collapsed, [id]: !state.collapsed[id] },
    }));
  },

  setPanelCollapsed: (id, collapsed) => {
    set((state) => ({
      collapsed: { ...state.collapsed, [id]: collapsed },
    }));
  },

  addNode: (input) => {
    const id = ulid();
    set((state) => ({
      ...pushHistory(state),
      document: {
        ...state.document,
        nodes: [...state.document.nodes, { ...input, id }],
      },
    }));
    return id;
  },

  removeNode: (id) => {
    set((state) => ({
      ...pushHistory(state),
      document: {
        ...state.document,
        nodes: state.document.nodes.filter((n) => n.id !== id),
        edges: state.document.edges.filter((e) => e.source !== id && e.target !== id),
      },
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
    }));
  },

  moveNode: (id, position) => {
    set((state) => ({
      document: {
        ...state.document,
        nodes: state.document.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
      },
    }));
  },

  resizeNode: (id, size) => {
    set((state) => ({
      ...pushHistory(state),
      document: {
        ...state.document,
        nodes: state.document.nodes.map((n) => (n.id === id ? { ...n, size } : n)),
      },
    }));
  },

  reparentNode: (id, parentId, position) => {
    set((state) => ({
      ...pushHistory(state),
      document: {
        ...state.document,
        nodes: state.document.nodes.map((n) =>
          n.id === id ? { ...n, parentId: parentId ?? null, position } : n,
        ),
      },
    }));
  },

  updateNode: (id, patch) => {
    set((state) => ({
      ...pushHistory(state),
      document: {
        ...state.document,
        nodes: state.document.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      },
    }));
  },

  updateNodeProperties: (id, patch) => {
    set((state) => ({
      ...pushHistory(state),
      document: {
        ...state.document,
        nodes: state.document.nodes.map((n) =>
          n.id === id ? { ...n, properties: { ...n.properties, ...patch } } : n,
        ),
      },
    }));
  },

  setMetadata: (patch) => {
    set((state) => ({
      ...pushHistory(state),
      document: {
        ...state.document,
        metadata: { ...state.document.metadata, ...patch },
      },
    }));
  },

  replaceDocument: (doc) => {
    set((state) => ({
      ...pushHistory(state),
      document: doc,
      selectedNodeId: null,
      selectedEdgeId: null,
    }));
  },

  addEdge: (input) => {
    const id = ulid();
    set((state) => ({
      ...pushHistory(state),
      document: {
        ...state.document,
        edges: [...state.document.edges, { ...input, id }],
      },
    }));
    return id;
  },

  removeEdge: (id) => {
    set((state) => ({
      ...pushHistory(state),
      document: {
        ...state.document,
        edges: state.document.edges.filter((e) => e.id !== id),
      },
      selectedEdgeId: state.selectedEdgeId === id ? null : state.selectedEdgeId,
    }));
  },

  setEdgeKind: (id, kind) => {
    set((state) => ({
      ...pushHistory(state),
      document: {
        ...state.document,
        edges: state.document.edges.map((e) => (e.id === id ? { ...e, kind } : e)),
      },
    }));
  },

  selectNode: (id) => set({ selectedNodeId: id, selectedEdgeId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedNodeId: null }),

  reset: (doc) =>
    set({
      document: doc ?? emptyGraph("bunya"),
      selectedNodeId: null,
      selectedEdgeId: null,
      history: [],
      future: [],
    }),

  undo: () => {
    const state = get();
    const prev = state.history[state.history.length - 1];
    if (!prev) return;
    set({
      document: prev,
      history: state.history.slice(0, -1),
      future: [state.document, ...state.future],
    });
  },

  redo: () => {
    const state = get();
    const [next, ...rest] = state.future;
    if (!next) return;
    set({
      document: next,
      future: rest,
      history: [...state.history, state.document],
    });
  },
});

export const useGraphStore = create<GraphStore>(graphStoreInitializer);

export const createGraphStore = () => createStore<GraphStore>(graphStoreInitializer);

export { inferDefaultEdgeKind } from "@/lib/catalogue/services";
