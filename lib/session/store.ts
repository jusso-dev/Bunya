import { create, type StateCreator } from "zustand";
import { createStore } from "zustand/vanilla";
import { ulid } from "ulid";
import { clampFxRate, DEFAULT_FX_AUD_PER_USD } from "@/lib/pricing/data";
import {
  EdgeKind,
  GraphDocument,
  GraphEdge,
  GraphNode,
  emptyGraph,
} from "@/lib/graph/schema";
import type { OrganisationRule } from "@/lib/rules/organisation";

type AddNodeInput = Omit<GraphNode, "id">;
type AddEdgeInput = Omit<GraphEdge, "id">;

export type PanelId = "palette" | "properties" | "output" | "validation";

export type GraphStoreState = {
  document: GraphDocument;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  history: GraphDocument[];
  future: GraphDocument[];
  // The document as it was when the current drag began; null when no drag is open.
  dragOrigin: GraphDocument | null;
  collapsed: Record<PanelId, boolean>;
  fxAudPerUsd: number;
  organisationRules: OrganisationRule[];
  importNotes: { source: string; notes: string[] } | null;
};

export type GraphStoreActions = {
  setImportNotes: (notes: { source: string; notes: string[] } | null) => void;
  addNode: (input: AddNodeInput) => string;
  removeNode: (id: string) => void;
  // A drag is one undo step: beginDrag remembers the document, moveNode and
  // reparentNode then update it without recording history, and endDrag records
  // the remembered document once if any node ended up somewhere else.
  beginDrag: () => void;
  endDrag: () => void;
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
  setFxAudPerUsd: (rate: number) => void;
  addOrganisationRule: (rule: OrganisationRule) => void;
  updateOrganisationRule: (id: string, patch: Partial<OrganisationRule>) => void;
  removeOrganisationRule: (id: string) => void;
  replaceOrganisationRules: (rules: OrganisationRule[]) => void;
};

export type GraphStore = GraphStoreState & GraphStoreActions;

const HISTORY_LIMIT = 50;

// localStorage key for the AUD/USD rate the user set.
export const FX_RATE_STORAGE_KEY = "bunya.settings.fxAudPerUsd";

// Below this width the panels overlay the canvas, so only one stays open.
export const COMPACT_LAYOUT_QUERY = "(max-width: 1023px)";

function pushHistory(state: GraphStoreState): Pick<GraphStoreState, "history" | "future"> {
  const next = [...state.history, state.document].slice(-HISTORY_LIMIT);
  return { history: next, future: [] };
}

// Whether any node now sits at a different position or under a different parent.
function layoutChanged(before: GraphDocument, after: GraphDocument): boolean {
  if (before.nodes === after.nodes) return false;
  const origin = new Map(before.nodes.map((n) => [n.id, n]));
  return after.nodes.some((n) => {
    const was = origin.get(n.id);
    return !!was && (was.position.x !== n.position.x || was.position.y !== n.position.y || (was.parentId ?? null) !== (n.parentId ?? null));
  });
}

// Records `origin` as an undo step when the layout has moved since.
function commitDrag(state: GraphStoreState): Partial<GraphStoreState> {
  const origin = state.dragOrigin;
  if (!origin) return {};
  if (!layoutChanged(origin, state.document)) return { dragOrigin: null };
  return { history: [...state.history, origin].slice(-HISTORY_LIMIT), future: [], dragOrigin: null };
}

const graphStoreInitializer: StateCreator<GraphStore> = (set, get) => ({
  document: emptyGraph("bunya"),
  selectedNodeId: null,
  selectedEdgeId: null,
  history: [],
  future: [],
  dragOrigin: null,
  collapsed: { palette: false, properties: false, output: false, validation: false },
  fxAudPerUsd: DEFAULT_FX_AUD_PER_USD,
  organisationRules: [],
  importNotes: null,

  setImportNotes: (importNotes) => set({ importNotes }),

  addOrganisationRule: (rule) => {
    set((state) => ({
      organisationRules: [...state.organisationRules.filter((r) => r.id !== rule.id), rule],
    }));
  },

  updateOrganisationRule: (id, patch) => {
    set((state) => ({
      organisationRules: state.organisationRules.map((rule) =>
        rule.id === id ? { ...rule, ...patch } : rule,
      ),
    }));
  },

  removeOrganisationRule: (id) => {
    set((state) => ({
      organisationRules: state.organisationRules.filter((rule) => rule.id !== id),
    }));
  },

  replaceOrganisationRules: (rules) => {
    set({ organisationRules: rules });
  },

  setFxAudPerUsd: (rate) => {
    const clamped = clampFxRate(rate);
    set({ fxAudPerUsd: clamped });
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(FX_RATE_STORAGE_KEY, String(clamped));
      } catch {
        // Storage can be full or blocked; the rate still applies this session.
      }
    }
  },

  togglePanel: (id) => {
    set((state) => ({
      collapsed: {
        ...state.collapsed,
        ...(typeof window !== "undefined" && window.matchMedia(COMPACT_LAYOUT_QUERY).matches && state.collapsed[id]
          ? { palette: true, properties: true, output: true } : {}),
        [id]: !state.collapsed[id],
      },
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
    set((state) => {
      const removed = new Set([id]);
      for (let changed = true; changed;) {
        changed = false;
        for (const node of state.document.nodes) {
          if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) { removed.add(node.id); changed = true; }
        }
      }
      return {
        ...pushHistory(state),
        document: {
          ...state.document,
          nodes: state.document.nodes.filter((node) => !removed.has(node.id)),
          edges: state.document.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
        },
        selectedNodeId: null,
        selectedEdgeId: null,
      };
    });
  },

  beginDrag: () => {
    // A drag that never reported its end is closed first, so it is not lost.
    set((state) => ({ ...commitDrag(state), dragOrigin: state.document }));
  },

  endDrag: () => {
    set((state) => commitDrag(state));
  },

  moveNode: (id, position) => {
    set((state) => {
      const node = state.document.nodes.find((n) => n.id === id);
      if (!node || (node.position.x === position.x && node.position.y === position.y)) return state;
      return {
        // Inside a drag only endDrag records history; a lone move (arrow-key nudge) is its own step.
        ...(state.dragOrigin ? {} : pushHistory(state)),
        document: {
          ...state.document,
          nodes: state.document.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
        },
      };
    });
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
      ...(state.dragOrigin ? {} : pushHistory(state)),
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
        nodes: state.document.nodes.map((n) => {
          if (n.id !== id) return n;
          const next = { ...n, ...patch };
          // A renamed resource is a new Azure resource, so it gets the usual
          // uniqueness suffix again.
          if (patch.resourceName !== undefined && patch.resourceName !== n.resourceName && !("exactName" in patch)) delete next.exactName;
          return next;
        }),
      },
    }));
  },

  updateNodeProperties: (id, patch) => {
    set((state) => {
      const node = state.document.nodes.find((n) => n.id === id);
      // Committing the value a field already has (a number input commits on
      // change and again on blur) must not spend an undo step. Values compare
      // by identity, so a rebuilt array or object counts as a change.
      const changes = (key: string) => !(key in (node?.properties ?? {})) || !Object.is(node?.properties[key], patch[key]);
      if (!node || !Object.keys(patch).some(changes)) return state;
      return {
        ...pushHistory(state),
        document: {
          ...state.document,
          nodes: state.document.nodes.map((n) =>
            n.id === id ? { ...n, properties: { ...n.properties, ...patch } } : n,
          ),
        },
      };
    });
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
      dragOrigin: null,
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
      dragOrigin: null,
    }),

  undo: () => {
    const state = get();
    const prev = state.history[state.history.length - 1];
    if (!prev) return;
    set({
      document: prev,
      dragOrigin: null,
      selectedNodeId: null, selectedEdgeId: null,
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
      dragOrigin: null,
      selectedNodeId: null, selectedEdgeId: null,
      future: rest,
      history: [...state.history, state.document],
    });
  },
});

export const useGraphStore = create<GraphStore>(graphStoreInitializer);

export const createGraphStore = () => createStore<GraphStore>(graphStoreInitializer);
