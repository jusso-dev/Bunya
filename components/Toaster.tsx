"use client";

import { Toaster as Sonner } from "sonner";

// App-wide Sonner toasts. Bunya's dark mode follows the operating system
// (prefers-color-scheme), so toasts do too.
export function Toaster() {
  return (
    <Sonner
      theme="system"
      position="bottom-right"
      closeButton
      richColors
      visibleToasts={3}
      // Never taller than a third of the screen; long text wraps and scrolls.
      toastOptions={{
        classNames: {
          toast: "text-xs max-h-[33vh] [overflow-wrap:anywhere]",
          title: "line-clamp-3",
          description: "whitespace-pre-line max-h-[20vh] overflow-y-auto",
        },
      }}
    />
  );
}
