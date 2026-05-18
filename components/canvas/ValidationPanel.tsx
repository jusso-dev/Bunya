"use client";

import { useMemo } from "react";
import { useGraphStore } from "@/lib/graph/store";
import { runValidation, applyAutofix } from "@/lib/validation/runner";

const SEVERITY_STYLE: Record<string, string> = {
  error: "border-red-200 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200",
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  info: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
};

export function ValidationPanel() {
  const document = useGraphStore((s) => s.document);
  const selectNode = useGraphStore((s) => s.selectNode);
  const selectEdge = useGraphStore((s) => s.selectEdge);
  const replaceDocument = useGraphStore((s) => s.replaceDocument);

  const findings = useMemo(() => runValidation(document), [document]);

  if (findings.length === 0) {
    return (
      <div className="border-t border-zinc-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 dark:border-zinc-800 dark:bg-emerald-950/40 dark:text-emerald-200">
        No validation findings. Looking good.
      </div>
    );
  }

  return (
    <details className="border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <summary className="cursor-pointer px-3 py-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-100">
        Validation findings ({findings.length})
      </summary>
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto px-3 pb-3">
        {findings.map((f, i) => (
          <li
            key={`${f.ruleId}-${i}`}
            className={`flex flex-col gap-1 rounded-md border px-2 py-1.5 text-[12px] ${SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.info}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">{f.ruleId}</span>
              <span className="text-[10px] uppercase tracking-wide">{f.severity}</span>
            </div>
            <span>{f.message}</span>
            <span className="text-[11px] opacity-80">{f.explanation}</span>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
              {f.nodeIds?.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectNode(id)}
                  className="rounded border border-current/40 px-1.5 py-0.5"
                >
                  node
                </button>
              ))}
              {f.edgeIds?.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectEdge(id)}
                  className="rounded border border-current/40 px-1.5 py-0.5"
                >
                  edge
                </button>
              ))}
              {f.autofixId ? (
                <button
                  type="button"
                  onClick={() => replaceDocument(applyAutofix(document, f))}
                  className="rounded bg-zinc-900 px-1.5 py-0.5 font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
                >
                  Auto-fix
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
