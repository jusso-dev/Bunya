"use client";

import { toast } from "sonner";
import { Dialog } from "@/components/Dialog";
import { useGraphStore } from "@/lib/session/store";
import { loadDocument, readImport, type ImportSource } from "@/lib/session/import";
import { useSessionUi } from "@/lib/session/ui";

// Imports a file or pasted text. A failure opens the Import dialog with the
// reason and leaves the canvas as it was. Returns whether the import loaded.
export async function importDiagram(input: ImportSource): Promise<boolean> {
  const ui = useSessionUi.getState();
  const result = await readImport(input);
  if (!result.ok) {
    ui.openImport(result.reason);
    return false;
  }
  loadDocument(result.document, result.imported);
  ui.closeImport();
  announceImport(result.imported.source, result.document.nodes.length, result.imported.notes);
  return true;
}

// One short toast per import. Long notes live in a scrollable dialog, so a
// large import can never cover the screen.
function announceImport(source: string, nodes: number, notes: string[]) {
  const title = `Imported ${source} (${nodes} resource${nodes === 1 ? "" : "s"}).`;
  if (notes.length === 0) {
    toast.success(title, { id: "import" });
    return;
  }
  toast.info(title, {
    id: "import",
    description: `${notes.length} note${notes.length === 1 ? "" : "s"}; also under Import notes in the toolbar.`,
    duration: 6000,
    action: { label: "View notes", onClick: () => useSessionUi.getState().setImportNotesOpen(true) },
  });
}

export function ImportNotesDialog() {
  const importNotes = useGraphStore((s) => s.importNotes);
  const open = useSessionUi((s) => s.importNotesOpen);
  const setOpen = useSessionUi((s) => s.setImportNotesOpen);
  if (!open || !importNotes) return null;
  return (
    <Dialog label="Import notes" onClose={() => setOpen(false)}>
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
