"use client";

import dynamic from "next/dynamic";

const Canvas = dynamic(
  () => import("./Canvas").then((m) => m.Canvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">
        Loading canvas...
      </div>
    ),
  },
);

export function CanvasMount() {
  return <Canvas />;
}
