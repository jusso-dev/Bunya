"use client";

import { toast } from "sonner";
import { fileStem } from "@/lib/graph/filename";
import { useMemo, useState } from "react";
import JSZip from "jszip";
import { useGraphStore } from "@/lib/graph/store";
import { generateTerraform } from "@/lib/generators/terraform";
import { generateBicep } from "@/lib/generators/bicep";
import { generateArm } from "@/lib/generators/arm";
import { generateAzCli } from "@/lib/generators/azcli";
import { generatePowerShell } from "@/lib/generators/powershell";
import { generateMermaid } from "@/lib/generators/mermaid";
import { generateReadme } from "@/lib/generators/readme";
import { generateCostEstimate } from "@/lib/generators/cost";
import { generateAzurePolicy } from "@/lib/generators/azure-policy";
import { GeneratedFile, GeneratorResult } from "@/lib/generators/types";
import { CostPanel } from "./CostPanel";

type TabId = "terraform" | "bicep" | "arm" | "azcli" | "powershell" | "policy" | "mermaid" | "readme" | "cost";

type Tab = {
  id: TabId;
  label: string;
  folder: string;
  run: typeof generateTerraform;
};

const TABS: Tab[] = [
  { id: "terraform", label: "Terraform", folder: "terraform", run: generateTerraform },
  { id: "bicep", label: "Bicep", folder: "bicep", run: generateBicep },
  { id: "arm", label: "ARM", folder: "arm", run: generateArm },
  { id: "azcli", label: "az CLI", folder: "azcli", run: generateAzCli },
  { id: "powershell", label: "PowerShell", folder: "powershell", run: generatePowerShell },
  { id: "policy", label: "Azure Policy", folder: "azure-policy", run: generateAzurePolicy },
  { id: "mermaid", label: "Mermaid", folder: "mermaid", run: generateMermaid },
  { id: "readme", label: "README", folder: ".", run: generateReadme },
  { id: "cost", label: "Cost", folder: "cost", run: generateCostEstimate },
];

function downloadFile(file: GeneratedFile) {
  const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = file.path.split("/").pop() ?? "file.txt";
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadZip(results: { tab: Tab; result: GeneratorResult }[], baseName: string) {
  const zip = new JSZip();
  for (const { tab, result } of results) {
    if (!result.ok) continue;
    for (const file of result.files) {
      const path = tab.folder === "." ? file.path : `${tab.folder}/${file.path}`;
      zip.file(path, file.content);
    }
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = `${fileStem(baseName, "bunya")}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export function OutputTabs() {
  const document = useGraphStore((s) => s.document);
  const [activeId, setActiveId] = useState<TabId>("terraform");

  const fxAudPerUsd = useGraphStore((s) => s.fxAudPerUsd);
  const results = useMemo(
    () =>
      TABS.map((tab) => ({
        tab,
        result:
          tab.id === "cost"
            ? generateCostEstimate(document, { audPerUsd: fxAudPerUsd })
            : tab.run(document),
      })),
    [document, fxAudPerUsd],
  );

  const failed = results.some(({ result }) => !result.ok);
  const active = results.find((r) => r.tab.id === activeId);

  const togglePanel = useGraphStore.getState().togglePanel;

  return (
    <section className="editor-panel editor-output flex w-[30rem] shrink-0 min-w-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 px-1.5 py-1 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => togglePanel("output")}
          className="rounded p-1 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="Collapse output"
          title="Collapse output"
        >
          ›
        </button>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={activeId === t.id}
            onClick={() => setActiveId(t.id)}
            className={`rounded px-2 py-1 text-xs font-medium ${
              activeId === t.id
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          disabled={failed}
          title={failed ? "Resolve generation errors before downloading the complete bundle." : undefined}
          onClick={() => { void downloadZip(results, document.metadata.name || "bunya").then(() => toast.success("ZIP downloaded.", { id: "zip" })).catch(() => toast.error("Download failed. Try downloading individual files.")); }}
          className="ml-auto rounded border border-zinc-200 px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Download all (.zip)
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2">
        {failed && <p className="mb-2 text-xs text-zinc-600 dark:text-zinc-300">Some outputs cannot be generated yet, so the complete ZIP is unavailable; see the affected tabs.</p>}
        {activeId === "cost" ? (
          <CostPanel document={document} />
        ) : active ? (
          <ActivePanel tab={active.tab} result={active.result} />
        ) : null}
      </div>
    </section>
  );
}

// Reasons are line-based: a summary, optional "Heading:" lines and "- item"
// lines. Shown as a scrollable list so long reasons never fill the panel.
function GenerationError({ label, reason, cycle }: { label: string; reason: string; cycle?: string[] }) {
  // Single-line reasons get a short heading so the detail is not all bold.
  const lines = reason.split("\n");
  const [summary, ...rest] = lines.length > 1 ? lines : ["cannot be generated yet.", lines[0]];
  return (
    <div tabIndex={0} role="alert" className="max-h-[50vh] overflow-y-auto rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 [overflow-wrap:anywhere] dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <p className="font-semibold">{label}: {summary}</p>
      {rest.length > 0 ? (
        <div className="mt-2 space-y-1">
          {rest.map((line, index) =>
            line.startsWith("- ") ? (
              <p key={index} className="pl-3 -indent-3">• {line.slice(2)}</p>
            ) : line.endsWith(":") ? (
              <p key={index} className="mt-2 font-medium">{line}</p>
            ) : (
              <p key={index}>{line}</p>
            ),
          )}
        </div>
      ) : null}
      {cycle ? <p className="mt-2">Cycle: {cycle.join(" -> ")}</p> : null}
      <p className="mt-2 text-amber-800 dark:text-amber-200">The diagram, Mermaid, README, cost estimate and JSON export still work. Select an item on the canvas to fix it.</p>
    </div>
  );
}

function ActivePanel({ tab, result }: { tab: Tab; result: GeneratorResult }) {
  if (!result.ok) {
    return (
      <GenerationError label={tab.label} reason={result.reason} cycle={result.cycle} />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {result.files.map((file) => (
        <div key={file.path} className="rounded-md border border-zinc-200 dark:border-zinc-800">
          <header className="flex items-center justify-between px-3 py-1.5">
            <span className="font-mono text-xs text-zinc-700 dark:text-zinc-200">
              {file.path}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                aria-label={`Copy ${file.path}`}
                onClick={async () => {
                  try { await navigator.clipboard.writeText(file.content); toast.success(`Copied ${file.path}.`, { id: "copy" }); }
                  catch { toast.error(`Could not copy ${file.path}. Use Download instead.`); }
                }}
                className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] uppercase hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => downloadFile(file)}
                className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] uppercase hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Download
              </button>
            </div>
          </header>
          <pre tabIndex={0} className="max-h-[60vh] overflow-auto rounded-b-md border-t border-zinc-200 bg-zinc-50 p-3 text-[11px] leading-5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
            {file.content}
          </pre>
        </div>
      ))}
    </div>
  );
}
