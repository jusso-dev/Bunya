import { isPortableFile, parseImportText, readFileAsText } from "@/lib/graph/portable";
import type { GraphDocument } from "@/lib/graph/schema";
import { useGraphStore } from "@/lib/session/store";
import { useSessionUi } from "./ui";

export type ImportSource = File | { text: string; label: string };

export type ImportNotes = { source: string; notes: string[] };

export type ReadImport =
  | { ok: true; document: GraphDocument; imported: ImportNotes }
  | { ok: false; reason: string };

// Reads a dropped, chosen or pasted Bunya export or ARM template.
export async function readImport(input: ImportSource): Promise<ReadImport> {
  const source = input instanceof File ? input.name : input.label;
  let text: string;
  if (input instanceof File) {
    if (!isPortableFile(input)) return { ok: false, reason: `Skipped ${source}: upload a .json or .bunya.json file.` };
    try { text = await readFileAsText(input); }
    catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "Could not read file." }; }
  } else {
    text = input.text;
  }
  const result = parseImportText(text);
  if (!result.ok) return { ok: false, reason: `Import failed: ${result.reason}` };
  const notes = (result.warning ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  return { ok: true, document: result.document, imported: { source, notes } };
}

// Puts a whole new diagram on the canvas; undo restores the previous one.
// The URL fragment is cleared because it no longer describes what is shown,
// and import notes only ever describe the document just loaded.
export function loadDocument(document: GraphDocument, imported?: ImportNotes): void {
  const graph = useGraphStore.getState();
  graph.replaceDocument(document);
  graph.setImportNotes(imported && imported.notes.length > 0 ? imported : null);
  window.history.replaceState(null, "", "#");
  const ui = useSessionUi.getState();
  ui.setImportNotesOpen(false);
  ui.requestFit();
}
