import { create } from "zustand";
import { ulid } from "ulid";
import {
  EdgeKind,
  GraphDocument,
  GraphEdge,
  GraphNode,
  ServiceType,
  emptyGraph,
} from "./schema";

type AddNodeInput = Omit<GraphNode, "id">;
type AddEdgeInput = Omit<GraphEdge, "id">;

export type GraphStoreState = {
  document: GraphDocument;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  history: GraphDocument[];
  future: GraphDocument[];
};

export type GraphStoreActions = {
  addNode: (input: AddNodeInput) => string;
  removeNode: (id: string) => void;
  moveNode: (id: string, position: { x: number; y: number }) => void;
  addEdge: (input: AddEdgeInput) => string;
  removeEdge: (id: string) => void;
  setEdgeKind: (id: string, kind: EdgeKind) => void;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  reset: (doc?: GraphDocument) => void;
  undo: () => void;
  redo: () => void;
};

export type GraphStore = GraphStoreState & GraphStoreActions;

const HISTORY_LIMIT = 50;

function pushHistory(state: GraphStoreState): Pick<GraphStoreState, "history" | "future"> {
  const next = [...state.history, state.document].slice(-HISTORY_LIMIT);
  return { history: next, future: [] };
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  document: emptyGraph("bunya"),
  selectedNodeId: null,
  selectedEdgeId: null,
  history: [],
  future: [],

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
}));

export function inferDefaultEdgeKind(sourceType: ServiceType, targetType: ServiceType): EdgeKind {
  if (targetType === "keyVault") return "identity";
  if (targetType === "storageAccount") return "data";
  if (targetType === "logAnalytics") return "diagnostic";
  if (sourceType === "subnet" || targetType === "subnet") return "network";
  return "depends_on";
}
