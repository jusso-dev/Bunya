import { ServicePalette } from "@/components/catalogue/ServicePalette";
import { OutputTabs } from "@/components/output/OutputTabs";
import { CanvasMount } from "@/components/canvas/CanvasMount";
import { PropertiesPanel } from "@/components/properties/PropertiesPanel";
import { Toolbar } from "@/components/canvas/Toolbar";
import { ValidationPanel } from "@/components/canvas/ValidationPanel";

export default function CanvasPage() {
  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-100 dark:bg-zinc-900">
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        <ServicePalette />
        <div className="flex flex-1 flex-col">
          <div className="flex-1">
            <CanvasMount />
          </div>
          <ValidationPanel />
        </div>
        <PropertiesPanel />
        <OutputTabs />
      </div>
    </div>
  );
}
