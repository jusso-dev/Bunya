"use client";

import { ServicePalette } from "@/components/catalogue/ServicePalette";
import { OutputTabs } from "@/components/output/OutputTabs";
import { CanvasMount } from "@/components/canvas/CanvasMount";
import { PropertiesPanel } from "@/components/properties/PropertiesPanel";
import { Toolbar } from "@/components/canvas/Toolbar";
import { ValidationPanel } from "@/components/canvas/ValidationPanel";
import { useGraphStore } from "@/lib/graph/store";

function CollapsedRail({
  label,
  side,
  onClick,
}: {
  label: string;
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-8 shrink-0 flex-col items-center justify-start gap-2 border-zinc-200 bg-white py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 ${
        side === "left" ? "border-r" : "border-l"
      }`}
      aria-label={`Expand ${label}`}
      title={`Expand ${label}`}
    >
      <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
        {label}
      </span>
    </button>
  );
}

export default function CanvasPage() {
  const collapsed = useGraphStore((s) => s.collapsed);
  const togglePanel = useGraphStore((s) => s.togglePanel);

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-100 dark:bg-zinc-900">
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        {collapsed.palette ? (
          <CollapsedRail label="Services" side="left" onClick={() => togglePanel("palette")} />
        ) : (
          <ServicePalette />
        )}
        <div className="flex flex-1 flex-col">
          <div className="flex-1">
            <CanvasMount />
          </div>
          <ValidationPanel />
        </div>
        {collapsed.properties ? (
          <CollapsedRail label="Properties" side="right" onClick={() => togglePanel("properties")} />
        ) : (
          <PropertiesPanel />
        )}
        {collapsed.output ? (
          <CollapsedRail label="Output" side="right" onClick={() => togglePanel("output")} />
        ) : (
          <OutputTabs />
        )}
      </div>
    </div>
  );
}
