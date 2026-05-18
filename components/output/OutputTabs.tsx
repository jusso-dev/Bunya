"use client";

import { useMemo, useState } from "react";
import { useGraphStore } from "@/lib/graph/store";
import { generateTerraform } from "@/lib/generators/terraform";

const TABS = ["terraform"] as const;
type Tab = (typeof TABS)[number];

export function OutputTabs() {
  const document = useGraphStore((s) => s.document);
  const [tab, setTab] = useState<Tab>("terraform");

  const result = useMemo(() => generateTerraform(document), [document]);

  return (
    <section className="flex w-[28rem] flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium ${
              t === tab
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "text-zinc-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {!result.ok ? (
          <pre className="whitespace-pre-wrap text-xs text-red-600">
            {result.reason}
            {result.cycle ? `\nCycle: ${result.cycle.join(" -> ")}` : ""}
          </pre>
        ) : (
          result.files.map((f) => (
            <details key={f.path} className="mb-2" open={f.path === "main.tf"}>
              <summary className="cursor-pointer text-xs font-semibold uppercase text-zinc-500">
                {f.path}
              </summary>
              <pre className="mt-1 overflow-auto rounded bg-zinc-50 p-3 text-xs leading-5 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
                {f.content}
              </pre>
            </details>
          ))
        )}
      </div>
    </section>
  );
}
