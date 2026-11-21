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
  // Pass 1: strip // and /* */ comments outside string literals.
  let noComments = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      noComments += ch;
      if (ch === "\\") noComments += text[++i] ?? "";
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      noComments += ch;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      noComments += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      noComments += " ";
    } else {
      noComments += ch;
    }
  }
  // Pass 2: strip trailing commas before } or ] outside string literals.
  let out = "";
  inString = false;
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i];
    if (inString) {
      out += ch;
      if (ch === "\\") out += noComments[++i] ?? "";
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === ",") {
      let j = i + 1;
      while (j < noComments.length && /\s/.test(noComments[j])) j++;
      if (noComments[j] !== "}" && noComments[j] !== "]") out += ch;
    } else {
      out += ch;
    }
  }
  return out;
}
