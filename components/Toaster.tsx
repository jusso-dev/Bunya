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
      toastOptions={{
        classNames: {
          toast: "text-xs",
          description: "whitespace-pre-line",
        },
      }}
    />
  );
}
