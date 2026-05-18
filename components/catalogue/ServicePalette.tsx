"use client";

import { listFirstCutServices } from "@/lib/catalogue/services";
import { useGraphStore } from "@/lib/graph/store";

export function ServicePalette() {
  const addNode = useGraphStore((s) => s.addNode);
  const services = listFirstCutServices();

  return (
    <aside className="flex w-64 flex-col gap-2 border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Services
      </h2>
      <ul className="flex flex-col gap-2">
        {services.map((def) => (
          <li key={def.type}>
            <button
              type="button"
              onClick={() =>
                addNode({
                  type: def.type,
                  name: def.label,
                  resourceName: `${def.type}-1`,
                  position: {
                    x: 80 + Math.random() * 240,
                    y: 80 + Math.random() * 240,
                  },
                  properties: { ...def.defaultProperties },
                })
              }
              className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <div>{def.label}</div>
              <div className="text-xs font-normal text-zinc-500">
                {def.category}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
