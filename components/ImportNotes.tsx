"use client";

import { toast } from "sonner";
import { Dialog } from "@/components/Dialog";
import { useGraphStore } from "@/lib/graph/store";

const OPEN_EVENT = "bunya:open-import-notes";

// One short toast per import. Long notes live in a scrollable dialog, so a
// large import can never cover the screen.
export function announceImport(source: string, nodes: number, warning: string | undefined) {
  const notes = (warning ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  useGraphStore.getState().setImportNotes(notes.length > 0 ? { source, notes } : null);
  const title = `Imported ${source} (${nodes} resource${nodes === 1 ? "" : "s"}).`;
  if (notes.length === 0) {
    toast.success(title, { id: "import" });
    return;
  }
  toast.info(title, {
    id: "import",
    description: `${notes.length} note${notes.length === 1 ? "" : "s"}; also under Import notes in the toolbar.`,
    duration: 6000,
    action: { label: "View notes", onClick: () => window.dispatchEvent(new Event(OPEN_EVENT)) },
  });
}

export function openImportNotes() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export { OPEN_EVENT as IMPORT_NOTES_EVENT };

export function ImportNotesDialog({ onClose }: { onClose: () => void }) {
  const importNotes = useGraphStore((s) => s.importNotes);
  if (!importNotes) return null;
  return (
    <Dialog label="Import notes" onClose={onClose}>
      <div className="flex w-[36rem] max-w-full flex-col gap-2 text-xs">
        <p className="text-zinc-600 dark:text-zinc-300">
          {importNotes.notes.length} note{importNotes.notes.length === 1 ? "" : "s"} from importing {importNotes.source}. These describe settings Bunya changed or did not keep; the resources in Azure are unaffected.
        </p>
        <ul className="max-h-[60dvh] list-disc space-y-1 overflow-y-auto pl-4 [overflow-wrap:anywhere]">
          {importNotes.notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
