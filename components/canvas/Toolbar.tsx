"use client";

import { useCallback, useEffect, useState } from "react";
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
import { emptyGraph } from "@/lib/graph/schema";

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.slice(1);
    if (hash.startsWith("bunya1:")) {
      void deserialiseFromFragment(hash).then((doc) => {
        if (doc) replaceDocument(doc);
      });
      return;
    }
    const stored = loadFromLocalStorage();
    if (stored) replaceDocument(stored);
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
