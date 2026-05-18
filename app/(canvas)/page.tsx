import { ServicePalette } from "@/components/catalogue/ServicePalette";
import { OutputTabs } from "@/components/output/OutputTabs";
import { CanvasMount } from "@/components/canvas/CanvasMount";

export default function CanvasPage() {
  return (
    <div className="flex h-screen w-screen bg-zinc-100 dark:bg-zinc-900">
      <ServicePalette />
      <main className="flex-1">
        <CanvasMount />
      </main>
      <OutputTabs />
    </div>
  );
}
