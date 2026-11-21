// Exporters emit document values as plain literals, never user-provided code.
// One conservative grammar holds across Bash, PowerShell, HCL, Bicep and ARM;
// unsupported expressions fail visibly rather than changing meaning.
const literal = /^[\p{L}\p{N} ._/@:+,=*-]*$/u;
const notLiteral = /[^\p{L}\p{N} ._/@:+,=*-]/gu;
export const MAX_LITERAL = 4096;

// Email properties are validated by the schema and quoted per language, so
// they may contain characters such as apostrophes that Azure accepts, but
// never control characters/newlines or values over MAX_LITERAL.
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const EMPTY_KEYS: ReadonlySet<string> = new Set();

export function isExportLiteral(value: string): boolean {
  return literal.test(value) && value.length <= MAX_LITERAL;
}

export type LiteralChange = { path: string; from: string; to: string };

// Returns `value` with every string and key made exportable, plus each change made.
// `emailKeys` exempts only matching TOP-LEVEL keys (depth 0) whose values have
// already been validated as email addresses (never nested maps like `tags`).
export function toExportLiterals<T>(
  value: T,
  path: string,
  emailKeys: ReadonlySet<string> = EMPTY_KEYS,
): { value: T; changes: LiteralChange[] } {
  const changes: LiteralChange[] = [];
  const clean = (text: string, at: string): string => {
    if (isExportLiteral(text)) return text;
    const next = text.replace(notLiteral, "-").slice(0, MAX_LITERAL);
    changes.push({ path: at, from: text, to: next });
    return next;
  };
  const walk = (item: unknown, at: string, depth: number): unknown => {
    if (typeof item === "string") return clean(item, at);
    if (Array.isArray(item)) return item.map((child, index) => walk(child, `${at}[${index}]`, depth + 1));
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, child]) => {
        const safeKey = clean(key, `${at} key`);
        if (
          depth === 0 &&
          emailKeys.has(key) &&
          typeof child === "string" &&
          child.length <= MAX_LITERAL &&
          !CONTROL_CHARS.test(child)
        ) {
          return [safeKey, child];
        }
        return [safeKey, walk(child, `${at}.${safeKey}`, depth + 1)];
      }));
    }
    return item;
  };
  return { value: walk(value, path, 0) as T, changes };
}

export function assertExportLiterals(
  value: unknown,
  path: string,
  emailKeys: ReadonlySet<string> = EMPTY_KEYS,
): void {
  const [first] = toExportLiterals(value, path, emailKeys).changes;
  if (first) throw new Error(`${first.path} contains unsupported code syntax. Use plain literal values without quotes, control characters or expressions.`);
}
