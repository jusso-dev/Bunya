"use client";

import { useMemo, useState } from "react";
import { listServices, ServiceDefinition } from "@/lib/catalogue/services";
import { ServiceType } from "@/lib/graph/schema";
import { useGraphStore } from "@/lib/graph/store";
import { CATEGORY_THEME, ServiceIcon } from "@/lib/catalogue/icons";

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
        : s.label.toLowerCase().includes(filter.trim().toLowerCase()) ||
          s.type.toLowerCase().includes(filter.trim().toLowerCase()),
    );
    const byCategory = new Map<ServiceDefinition["category"], ServiceDefinition[]>();
    for (const s of services) {
      if (!byCategory.has(s.category)) byCategory.set(s.category, []);
      byCategory.get(s.category)!.push(s);
    }
    return byCategory;
  }, [filter]);

  const nodeCount = useGraphStore((s) => s.document.nodes.length);

  const handleQuickAdd = (def: ServiceDefinition) => {
    const column = nodeCount % 3;
    const row = Math.floor(nodeCount / 3);
    const id = addNode({
      type: def.type,
      name: def.label,
      resourceName: defaultResourceNameFor(def.type, nodeCount + 1),
      position: { x: 80 + column * 260, y: 60 + row * 120 },
      properties: { ...def.defaultProperties },
    });
    useGraphStore.getState().selectNode(id);
    if (window.matchMedia("(max-width: 1023px)").matches) useGraphStore.getState().setPanelCollapsed("palette", true);
  };

  return (
    <aside className="editor-panel editor-palette flex w-60 shrink-0 flex-col gap-3 border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Services ({listServices().length})
          </h2>
          <button
            type="button"
            onClick={() => useGraphStore.getState().togglePanel("palette")}
            className="rounded p-1 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Collapse palette"
            title="Collapse"
          >
            ‹
          </button>
        </div>
        <input
          aria-label="Filter services"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter services..."
          className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <p className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
          Drag onto the canvas, or click to drop it in.
        </p>
      </header>
      <div tabIndex={0} aria-label="Available services" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {grouped.size === 0 && <p role="status">No services match “{filter}”.</p>}
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat);
          if (!items || items.length === 0) return null;
          return (
            <section key={cat} className="space-y-1.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
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
  const onDragStart = (event: React.DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData("application/bunya-service", def.type);
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <li>
    <button type="button"
      aria-label={`Add ${def.label}`}
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={`group flex w-full text-left cursor-grab items-center gap-2 rounded-md border bg-white px-2 py-2 text-sm text-zinc-800 transition-colors hover:bg-zinc-50 active:cursor-grabbing dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 ${theme.cardRing}`}
      data-service-type={def.type as ServiceType}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${theme.tile} ${theme.tileText}`}
      >
        <ServiceIcon type={def.type} size={20} strokeWidth={1.75} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium leading-tight">{def.label}</span>
        <span className="truncate text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
          {def.description}
        </span>
      </span>
    </button>
    </li>
  );
}

function defaultResourceNameFor(type: ServiceType, index: number): string {
  const slug = type.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "");
  switch (type) {
    case "storageAccount":
    case "containerRegistry":
      return `${slug.replace(/-/g, "")}${index}`;
    default:
      return `${slug}-${index}`;
  }
}
