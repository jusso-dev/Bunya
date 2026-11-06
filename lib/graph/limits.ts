export const MAX_IMPORT_BYTES = 1024 * 1024;

export function checkImportText(text: string): void {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new Error("Import exceeds the 1 MiB limit.");
  }
}

export function checkObjectDepth(value: unknown, maxDepth = 32): void {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  while (stack.length) {
    const item = stack.pop()!;
    if (item.depth > maxDepth) throw new Error(`Import nesting exceeds ${maxDepth} levels.`);
    if (item.value && typeof item.value === "object") {
      for (const child of Object.values(item.value)) stack.push({ value: child, depth: item.depth + 1 });
    }
  }
}

// Size check, JSON.parse and depth check for any text a user or link supplies.
export function parseJsonInput(text: string, maxDepth?: number): unknown {
  checkImportText(text);
  const parsed: unknown = JSON.parse(text);
  checkObjectDepth(parsed, maxDepth);
  return parsed;
}

// Azure Resource Manager accepts // and /* */ comments and trailing commas in
// templates (Microsoft Learn, "Template syntax: comments"); JSON.parse does not.
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      out += " ";
    } else if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] !== "}" && text[j] !== "]") out += ch;
    } else {
      out += ch;
    }
  }
  return out;
}
