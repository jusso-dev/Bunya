"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGraphStore } from "@/lib/graph/store";
import { STARTER_TEMPLATES, getTemplateById } from "@/lib/catalogue/templates";
import {
  FRAGMENT_SIZE_WARNING_BYTES,
  fragmentByteLength,
  saveToLocalStorage,
  loadFromLocalStorage,
  serialiseToFragment,
  deserialiseFromFragment,
  shareUrlFromFragment,
} from "@/lib/graph/serialise";
import {
  buildEnvelope,
  envelopeToBlob,
  isPortableFile,
  parseImportText,
  PORTABLE_EXTENSION,
  readFileAsText,
  suggestedFilename,
} from "@/lib/graph/portable";
import { emptyGraph } from "@/lib/graph/schema";
import { MAX_IMPORT_BYTES } from "@/lib/graph/limits";
import { Dialog } from "@/components/Dialog";
import { OrganisationRulesPanel } from "./OrganisationRulesPanel";

function PanelToggles() {
  const collapsed = useGraphStore((s) => s.collapsed);
  const togglePanel = useGraphStore((s) => s.togglePanel);
  const items: { id: "palette" | "properties" | "output"; label: string }[] = [
    { id: "palette", label: "Palette" },
    { id: "properties", label: "Properties" },
    { id: "output", label: "Output" },
  ];
  return (
    <div className="flex items-center gap-1">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-pressed={!collapsed[it.id]}
          onClick={() => togglePanel(it.id)}
          className={`rounded-md border px-2 py-1 text-xs font-medium ${
            collapsed[it.id]
              ? "border-zinc-200 bg-zinc-100 text-zinc-500 dark:text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
              : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          }`}
          title={collapsed[it.id] ? `Show ${it.label}` : `Hide ${it.label}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Toolbar() {
  const document = useGraphStore((s) => s.document);
  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  const canUndo = useGraphStore((s) => s.history.length > 0);
  const canRedo = useGraphStore((s) => s.future.length > 0);
  const replaceDocument = useGraphStore((s) => s.replaceDocument);

  const [ready, setReady] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const hash = window.location.hash.slice(1);
      const stored = loadFromLocalStorage();
      const shared = hash.startsWith("bunya1:") ? await deserialiseFromFragment(hash) : null;
      if (cancelled) return;
      if (shared) replaceDocument(shared);
      else if (stored) replaceDocument(stored);
      if (hash.startsWith("bunya1:") && !shared) setShareMessage("Shared diagram is invalid or too large. Restored your saved diagram.");
      try {
        const fx = Number(localStorage.getItem("bunya.settings.fxAudPerUsd"));
        if (Number.isFinite(fx) && fx > 0) useGraphStore.getState().setFxAudPerUsd(fx);
      } catch { /* Storage can be unavailable in private or restricted browsers. */ }
      setReady(true);
    };
    void restore();
    return () => { cancelled = true; };
  }, [replaceDocument]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => setSaveFailed(!saveToLocalStorage(document)), 250);
    return () => window.clearTimeout(timer);
  }, [document, ready]);

  const onShare = useCallback(async () => {
    let fragment: string;
    try { fragment = await serialiseToFragment(document); }
    catch { setShareMessage("Could not create share link. Export your diagram instead."); return; }
    const size = fragmentByteLength(fragment);
    if (size > FRAGMENT_SIZE_WARNING_BYTES) {
      setShareMessage(
        `Fragment is ${size} bytes; some browsers may truncate. Use Download instead.`,
      );
      return;
    }
    const url = shareUrlFromFragment(fragment);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${fragment}`);
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage("Share URL copied to clipboard.");
    } catch {
      setShareMessage(`Share URL: ${url}`);
    }
  }, [document]);

  const onLoadTemplate = (id: string) => {
    const template = getTemplateById(id);
    if (!template) return;
    replaceDocument(template.document);
    setTemplateOpen(false);
  };

  const onNew = () => {
    replaceDocument(emptyGraph("untitled"));
    setShareMessage("New diagram created. Undo restores your previous diagram.");
    if (typeof window !== "undefined") window.history.replaceState(null, "", "#");
  };

  const onExport = useCallback(() => {
    const envelope = buildEnvelope(document);
    const blob = envelopeToBlob(envelope);
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = suggestedFilename(document);
    a.click();
    URL.revokeObjectURL(url);
    setShareMessage(`Exported ${a.download}.${blob.size > MAX_IMPORT_BYTES ? " This file exceeds the 1 MiB import limit and cannot be reimported without reducing its size." : ""}`);
  }, [document]);

  const importFromFile = useCallback(
    async (file: File) => {
      if (!isPortableFile(file)) {
        setImportOpen(true);
        setImportMessage(`Skipped ${file.name}: upload a .json or .bunya.json file.`);
        return;
      }
      setImportOpen(true);
      let text: string;
      try { text = await readFileAsText(file); }
      catch (error) { setImportMessage(error instanceof Error ? error.message : "Could not read file."); return; }
      const result = parseImportText(text);
      if (!result.ok) {
        setImportMessage(`Import failed: ${result.reason}`);
        return;
      }
      replaceDocument(result.document);
      if (typeof window !== "undefined") window.history.replaceState(null, "", "#");
      setShareMessage(`Imported ${file.name} (${result.document.nodes.length} nodes).${result.warning ? ` ${result.warning}` : ""}`);
      setImportMessage(null);
      setImportOpen(false);
    },
    [replaceDocument],
  );

  const onImportClick = () => fileInputRef.current?.click();

  const onImportPaste = useCallback(() => {
    const text = importText.trim();
    if (!text) {
      setImportMessage("Paste a Bunya export or ARM template JSON first.");
      return;
    }
    const result = parseImportText(text);
    if (!result.ok) {
      setImportMessage(`Import failed: ${result.reason}`);
      return;
    }
    replaceDocument(result.document);
    if (typeof window !== "undefined") window.history.replaceState(null, "", "#");
    setImportText("");
    setImportMessage(null);
    setImportOpen(false);
    setShareMessage(`Imported pasted JSON (${result.document.nodes.length} nodes).${result.warning ? ` ${result.warning}` : ""}`);
  }, [importText, replaceDocument]);

  const onFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) await importFromFile(file);
      event.target.value = "";
    },
    [importFromFile],
  );

  return (
    <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-1.5">
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Bunya</h1>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">|</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {document.metadata.name} - {document.metadata.environment} - {document.metadata.region}
        </span>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <PanelToggles />
        <span className="h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
        <button
          type="button"
          disabled={!canUndo}
          onClick={undo}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={redo}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        >
          Redo
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setTemplateOpen((v) => !v)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          >
            Templates
          </button>
          {templateOpen ? (
            <Dialog label="Starter templates" onClose={() => setTemplateOpen(false)}>
            <div className="w-72 max-w-full">
              {STARTER_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onLoadTemplate(t.id)}
                  className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{t.description}</div>
                </button>
              ))}
            </div>
            </Dialog>
          ) : null}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setImportMessage(null);
              setImportOpen((v) => !v);
            }}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
            title={`Import a ${PORTABLE_EXTENSION} file or Azure ARM template`}
          >
            Import
          </button>
          {importOpen ? (
            <Dialog label="Import diagram" onClose={() => setImportOpen(false)}>
            <div className="flex w-96 max-w-full flex-col gap-2">
              <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                Import JSON
              </div>
              <textarea
                aria-label="Diagram JSON"
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value);
                  setImportMessage(null);
                }}
                rows={7}
                className="w-full resize-none rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 font-mono text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                placeholder="Paste Azure Export Template ARM JSON or a Bunya export..."
              />
              {importMessage ? (
                <div role="alert" className="max-h-24 overflow-auto rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  {importMessage}
                </div>
              ) : (
                <div className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                  Accepts raw JSON or a fenced markdown JSON block.
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={onImportClick}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  Upload JSON
                </button>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setImportText("");
                      setImportMessage(null);
                      setImportOpen(false);
                    }}
                    className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onImportPaste}
                    className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900"
                  >
                    Import
                  </button>
                </div>
              </div>
            </div>
            </Dialog>
          ) : null}
        </div>
        <OrganisationRulesPanel />
        <button
          type="button"
          onClick={onExport}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          title={`Download as ${PORTABLE_EXTENSION}`}
        >
          Export
        </button>
        <button
          type="button"
          onClick={onShare}
          className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900"
        >
          Share
        </button>
        <button
          type="button"
          onClick={onNew}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        >
          New
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json,application/x-bunya+json"
          onChange={onFileChange}
          className="hidden"
          aria-label="Import Bunya file"
        />
      </div>
      {saveFailed && <p role="alert" className="w-full text-sm text-red-700 dark:text-red-300">Changes cannot be saved in this browser. Export your diagram to keep your work.</p>}
      {shareMessage ? (
        <div role="status" className="absolute left-2 right-2 top-full z-40 mt-1 break-words rounded-md border border-zinc-200 bg-white px-3 py-1 text-xs shadow dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
          {shareMessage}
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setShareMessage(null)}
            className="ml-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            x
          </button>
        </div>
      ) : null}
    </header>
  );
}
