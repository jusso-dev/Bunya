"use client";

import { useMemo, useState } from "react";
import type { GraphDocument } from "@/lib/graph/schema";
import { estimateCost, formatMoney } from "@/lib/pricing/estimate";
import { DEFAULT_FX_AUD_PER_USD, type Currency } from "@/lib/pricing/data";
import { useGraphStore } from "@/lib/graph/store";

export function CostPanel({ document }: { document: GraphDocument }) {
  const [currency, setCurrency] = useState<Currency>("AUD");
  const [sortBy, setSortBy] = useState<"monthly" | "service">("monthly");
  const fxAudPerUsd = useGraphStore((s) => s.fxAudPerUsd);
  const setFxAudPerUsd = useGraphStore((s) => s.setFxAudPerUsd);
  const [fxDraft, setFxDraft] = useState<string>(String(fxAudPerUsd));

  const estimate = useMemo(
    () => estimateCost(document, { currency, audPerUsd: fxAudPerUsd }),
    [document, currency, fxAudPerUsd],
  );
  const items = useMemo(() => {
    const copy = [...estimate.lineItems];
    if (sortBy === "monthly") copy.sort((a, b) => b.monthly - a.monthly);
    else copy.sort((a, b) => a.serviceLabel.localeCompare(b.serviceLabel));
    return copy;
  }, [estimate.lineItems, sortBy]);

  const onFxCommit = () => {
    const next = Number(fxDraft);
    if (!Number.isFinite(next) || next <= 0) {
      setFxDraft(String(fxAudPerUsd));
      return;
    }
    setFxAudPerUsd(next);
    setFxDraft(String(next));
  };

  const onFxReset = () => {
    setFxAudPerUsd(DEFAULT_FX_AUD_PER_USD);
    setFxDraft(String(DEFAULT_FX_AUD_PER_USD));
  };

  return (
    <div className="flex flex-col gap-3 text-zinc-800 dark:text-zinc-100">
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-amber-50 px-3 py-2 text-[12px] dark:border-zinc-700 dark:bg-amber-950/30">
        <div>
          <strong>Estimated monthly cost: {formatMoney(estimate.total, currency)}</strong>
          <span className="ml-2 text-zinc-600 dark:text-zinc-400">
            Snapshot {estimate.snapshotDate}. Indicative only.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] uppercase tracking-wide text-zinc-500">Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="AUD">AUD</option>
            <option value="USD">USD</option>
          </select>
          <label className="text-[11px] uppercase tracking-wide text-zinc-500">Sort</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "monthly" | "service")}
            className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="monthly">Monthly cost</option>
            <option value="service">Service</option>
          </select>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-[12px] dark:border-zinc-700 dark:bg-zinc-900">
        <label className="text-[11px] uppercase tracking-wide text-zinc-500" htmlFor="fx-rate">
          AUD per USD
        </label>
        <input
          id="fx-rate"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.5"
          max="10"
          value={fxDraft}
          onChange={(e) => setFxDraft(e.target.value)}
          onBlur={onFxCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-24 rounded border border-zinc-200 bg-white px-2 py-0.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-800"
          aria-label="AUD per USD exchange rate"
        />
        <button
          type="button"
          onClick={onFxReset}
          className="rounded border border-zinc-200 px-2 py-0.5 text-[11px] hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          title={`Reset to ${DEFAULT_FX_AUD_PER_USD}`}
        >
          Reset
        </button>
        <span className="ml-1 text-[11px] text-zinc-500">
          Enter your treasury's current rate. Stored locally; affects AUD figures only.
        </span>
      </div>

      <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50/50 p-3 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
        {estimate.caveats.map((c) => (
          <li key={c}>• {c}</li>
        ))}
      </ul>

      <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-[12px]">
          <thead className="bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-2 py-1.5">Resource</th>
              <th className="px-2 py-1.5">Service</th>
              <th className="px-2 py-1.5">SKU</th>
              <th className="px-2 py-1.5 text-right">Monthly</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {items.map((item) => (
              <tr key={item.nodeId} className={item.unmodelled ? "opacity-60" : ""}>
                <td className="px-2 py-1.5 font-mono text-[11px]">{item.resourceName}</td>
                <td className="px-2 py-1.5">{item.serviceLabel}</td>
                <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">{item.sku}</td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {formatMoney(item.monthly, currency)}
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-3 text-center text-zinc-500">
                  Add resources to see a cost estimate.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot className="bg-zinc-50 font-semibold dark:bg-zinc-900">
            <tr>
              <td colSpan={3} className="px-2 py-1.5 text-right">
                Total (indicative)
              </td>
              <td className="px-2 py-1.5 text-right font-mono">
                {formatMoney(estimate.total, currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
