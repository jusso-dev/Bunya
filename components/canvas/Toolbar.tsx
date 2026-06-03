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
          onClick={() => togglePanel(it.id)}
          className={`rounded-md border px-2 py-1 text-xs font-medium ${
            collapsed[it.id]
              ? "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500"
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
  const reset = useGraphStore((s) => s.reset);
  const replaceDocument = useGraphStore((s) => s.replaceDocument);

  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.slice(1);
    if (hash.startsWith("bunya1:")) {
      void deserialiseFromFragment(hash).then((doc) => {
        if (doc) replaceDocument(doc);
      });
    } else {
      const stored = loadFromLocalStorage();
      if (stored) replaceDocument(stored);
    }
    const fxRaw = localStorage.getItem("bunya.settings.fxAudPerUsd");
    const fx = fxRaw === null ? NaN : Number(fxRaw);
    if (Number.isFinite(fx) && fx > 0) {
      useGraphStore.getState().setFxAudPerUsd(fx);
    }
  }, [replaceDocument]);

  useEffect(() => {
    saveToLocalStorage(document);
  }, [document]);

  const onShare = useCallback(async () => {
    const fragment = await serialiseToFragment(document);
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
    reset(emptyGraph("untitled"));
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
    setShareMessage(`Exported ${a.download}.`);
  }, [document]);

  const importFromFile = useCallback(
    async (file: File) => {
      if (!isPortableFile(file)) {
        setImportMessage(`Skipped ${file.name}: upload a .json or .bunya.json file.`);
        return;
      }
      const text = await readFileAsText(file);
      const result = parseImportText(text);
      if (!result.ok) {
        setImportMessage(`Import failed: ${result.reason}`);
        return;
      }
      replaceDocument(result.document);
      if (typeof window !== "undefined") window.history.replaceState(null, "", "#");
      setShareMessage(`Imported ${file.name} (${result.document.nodes.length} nodes).`);
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
    setShareMessage(`Imported pasted JSON (${result.document.nodes.length} nodes).`);
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
    <header className="relative flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Bunya</span>
        <span className="text-xs text-zinc-500">|</span>
        <span className="text-xs text-zinc-500">
          {document.metadata.name} - {document.metadata.environment} - {document.metadata.region}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <PanelToggles />
        <span className="h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
        <button
          type="button"
          onClick={undo}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        >
          Undo
        </button>
        <button
          type="button"
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
            <div className="absolute right-0 z-50 mt-1 w-72 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {STARTER_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onLoadTemplate(t.id)}
                  className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="text-[11px] text-zinc-500">{t.description}</div>
                </button>
              ))}
            </div>
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
            <div className="absolute right-0 z-50 mt-1 flex w-96 flex-col gap-2 rounded-md border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                Import JSON
              </div>
              <textarea
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
                <div className="max-h-24 overflow-auto rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  {importMessage}
                </div>
              ) : (
                <div className="text-[11px] leading-4 text-zinc-500">
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
      {shareMessage ? (
        <div className="absolute left-1/2 top-full mt-1 -translate-x-1/2 rounded-md border border-zinc-200 bg-white px-3 py-1 text-xs shadow dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
          {shareMessage}
          <button
            type="button"
            onClick={() => setShareMessage(null)}
            className="ml-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            x
          </button>
        </div>
      ) : null}
    </header>
  );
}
