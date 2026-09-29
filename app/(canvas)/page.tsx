"use client";

import { useEffect } from "react";
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

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 1023px)");
    const collapse = () => {
      if (compact.matches) for (const panel of ["palette", "properties", "output"] as const) {
        useGraphStore.getState().setPanelCollapsed(panel, true);
      }
    };
    collapse();
    compact.addEventListener("change", collapse);
    return () => compact.removeEventListener("change", collapse);
  }, []);

  return (
    <div className="flex h-dvh w-full flex-col bg-zinc-100 dark:bg-zinc-900">
      <Toolbar />
      <main aria-label="Architecture editor" className="relative flex min-h-0 flex-1 overflow-hidden">
        {collapsed.palette ? (
          <CollapsedRail label="Services" side="left" onClick={() => togglePanel("palette")} />
        ) : (
          <ServicePalette />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
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
      </main>
    </div>
  );
}
