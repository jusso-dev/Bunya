"use client";

import { useMemo, useState } from "react";
import { listServices, ServiceDefinition } from "@/lib/catalogue/services";
import { ServiceType } from "@/lib/graph/schema";
import { useGraphStore } from "@/lib/graph/store";
import { CATEGORY_THEME, getServiceIcon } from "@/lib/catalogue/icons";

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
  const addNode = useGraphStore((s) => s.addNode);

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

  const handleQuickAdd = (def: ServiceDefinition) => {
    addNode({
      type: def.type,
      name: def.label,
      resourceName: defaultResourceNameFor(def.type),
      position: { x: 120 + Math.random() * 200, y: 120 + Math.random() * 200 },
      properties: { ...def.defaultProperties },
    });
  };

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
          Drag onto the canvas, or click to drop it in.
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
                  <ServiceCard key={def.type} def={def} onClick={() => handleQuickAdd(def)} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function ServiceCard({
  def,
  onClick,
}: {
  def: ServiceDefinition;
  onClick: () => void;
}) {
  const theme = CATEGORY_THEME[def.category];
  const Icon = getServiceIcon(def.type);
  const onDragStart = (event: React.DragEvent<HTMLLIElement>) => {
    event.dataTransfer.setData("application/bunya-service", def.type);
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="group flex cursor-grab items-center gap-2 rounded-md border bg-white px-2 py-2 text-sm text-zinc-800 transition-colors hover:bg-zinc-50 active:cursor-grabbing dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      style={{ borderColor: theme.soft }}
      data-service-type={def.type as ServiceType}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{ background: theme.bg, color: theme.ink }}
      >
        <Icon style={{ width: 20, height: 20 }} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium leading-tight">{def.label}</span>
        <span className="truncate text-[11px] leading-tight text-zinc-500">
          {def.description}
        </span>
      </span>
    </li>
  );
}

function defaultResourceNameFor(type: ServiceType): string {
  const slug = type.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "");
  switch (type) {
    case "storageAccount":
    case "containerRegistry":
      return `${slug.replace(/-/g, "")}1`;
    default:
      return `${slug}-1`;
  }
}
