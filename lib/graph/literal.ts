// Exporters emit document values as plain literals, never user-provided code.
// One conservative grammar holds across Bash, PowerShell, HCL, Bicep and ARM;
// unsupported expressions fail visibly rather than changing meaning.
const literal = /^[\p{L}\p{N} ._/@:+,=*-]*$/u;
const notLiteral = /[^\p{L}\p{N} ._/@:+,=*-]/gu;
export const MAX_LITERAL = 4096;

// Email properties are validated by the schema and quoted per language, so
// they may contain characters such as apostrophes that Azure accepts.
const EMAIL_KEYS = new Set(["email", "publisherEmail"]);

export function isExportLiteral(value: string): boolean {
  return literal.test(value) && value.length <= MAX_LITERAL;
}

export type LiteralChange = { path: string; from: string; to: string };

// Returns `value` with every string and key made exportable, plus each change made.
export function toExportLiterals<T>(value: T, path: string): { value: T; changes: LiteralChange[] } {
  const changes: LiteralChange[] = [];
  const clean = (text: string, at: string): string => {
    if (isExportLiteral(text)) return text;
    const next = text.replace(notLiteral, "-").slice(0, MAX_LITERAL);
    changes.push({ path: at, from: text, to: next });
    return next;
  };
  const walk = (item: unknown, at: string): unknown => {
    if (typeof item === "string") return clean(item, at);
    if (Array.isArray(item)) return item.map((child, index) => walk(child, `${at}[${index}]`));
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, child]) => {
        const safeKey = clean(key, `${at} key`);
        if (EMAIL_KEYS.has(key) && typeof child === "string") return [safeKey, child];
        return [safeKey, walk(child, `${at}.${safeKey}`)];
      }));
    }
    return item;
  };
  return { value: walk(value, path) as T, changes };
}

export function assertExportLiterals(value: unknown, path: string): void {
  const [first] = toExportLiterals(value, path).changes;
  if (first) throw new Error(`${first.path} contains unsupported code syntax. Use plain literal values without quotes, control characters or expressions.`);
}
