"use client";

import { useMemo, useState } from "react";
import { listServices, ServiceDefinition } from "@/lib/catalogue/services";
import { ServiceType } from "@/lib/graph/schema";

const CATEGORY_ORDER: ServiceDefinition["category"][] = [
  "scaffold",
  "network",
  "compute",
  "data",
  "security",
  "observability",
  "integration",
];

const CATEGORY_LABEL: Record<ServiceDefinition["category"], string> = {
  scaffold: "Scaffold",
  network: "Network",
  compute: "Compute",
  data: "Data",
  security: "Security",
  observability: "Observability",
  integration: "Integration",
};

export function ServicePalette() {
  const [filter, setFilter] = useState("");

  const grouped = useMemo(() => {
    const services = listServices().filter((s) =>
      filter.trim() === ""
        ? true
        : s.label.toLowerCase().includes(filter.toLowerCase()) ||
          s.type.toLowerCase().includes(filter.toLowerCase()),
    );
    const byCategory = new Map<ServiceDefinition["category"], ServiceDefinition[]>();
    for (const s of services) {
      if (!byCategory.has(s.category)) byCategory.set(s.category, []);
      byCategory.get(s.category)!.push(s);
    }
    return byCategory;
  }, [filter]);

  return (
    <aside className="flex w-72 flex-col gap-3 border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Services ({listServices().length})
        </h2>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter services..."
          className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <p className="text-[11px] leading-4 text-zinc-500">
          Drag a service onto the canvas, or click to add at the centre.
        </p>
      </header>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat);
          if (!items || items.length === 0) return null;
          return (
            <section key={cat} className="space-y-1.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                {CATEGORY_LABEL[cat]}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {items.map((def) => (
                  <ServiceCard key={def.type} def={def} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function ServiceCard({ def }: { def: ServiceDefinition }) {
  const onDragStart = (event: React.DragEvent<HTMLLIElement>) => {
    event.dataTransfer.setData("application/bunya-service", def.type);
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <li
      draggable
      onDragStart={onDragStart}
      className="group flex cursor-grab items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-800 transition-colors hover:border-zinc-400 hover:bg-zinc-50 active:cursor-grabbing dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      data-service-type={def.type as ServiceType}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-zinc-100 text-[10px] font-bold uppercase text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
        {def.icon}
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-medium">{def.label}</span>
        <span className="text-[11px] text-zinc-500">{def.description}</span>
      </span>
    </li>
  );
}
