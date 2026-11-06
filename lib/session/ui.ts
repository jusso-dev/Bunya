import { create } from "zustand";

// TODO(untangle): use COMPACT_LAYOUT_QUERY from lib/graph/store
// Must match the compact breakpoint in app/globals.css.
export const COMPACT_LAYOUT_QUERY = "(max-width: 1023px)";

type SessionUi = {
  importDialog: { open: boolean; message: string | null };
  importNotesOpen: boolean;
  saveFailed: boolean;
  // Bumped whenever the canvas should fit every node into view.
  fitRequest: number;
  openImport: (message?: string | null) => void;
  closeImport: () => void;
  setImportNotesOpen: (open: boolean) => void;
  setSaveFailed: (failed: boolean) => void;
  requestFit: () => void;
};

// Editor state that is not part of the diagram and is never saved.
export const useSessionUi = create<SessionUi>((set) => ({
  importDialog: { open: false, message: null },
  importNotesOpen: false,
  saveFailed: false,
  fitRequest: 0,
  openImport: (message = null) => set({ importDialog: { open: true, message } }),
  closeImport: () => set({ importDialog: { open: false, message: null } }),
  setImportNotesOpen: (importNotesOpen) => set({ importNotesOpen }),
  setSaveFailed: (saveFailed) => set({ saveFailed }),
  requestFit: () => set((state) => ({ fitRequest: state.fitRequest + 1 })),
}));
