export const MAX_IMPORT_BYTES = 1024 * 1024;

export function checkImportText(text: string): void {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new Error("Import exceeds the 1 MiB limit.");
  }
}

export function checkObjectDepth(value: unknown): void {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  while (stack.length) {
    const item = stack.pop()!;
    if (item.depth > 32) throw new Error("Import nesting exceeds 32 levels.");
    if (item.value && typeof item.value === "object") {
      for (const child of Object.values(item.value)) stack.push({ value: child, depth: item.depth + 1 });
    }
  }
}

// Size check, JSON.parse and depth check for any text a user or link supplies.
export function parseJsonInput(text: string): unknown {
  checkImportText(text);
  const parsed: unknown = JSON.parse(text);
  checkObjectDepth(parsed);
  return parsed;
}
