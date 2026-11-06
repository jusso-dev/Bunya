// Evaluates the parts of the ARM template expression language that depend only
// on the template itself (parameter defaults, variables and string functions).
// Anything that needs a deployment, such as resourceGroup(), uniqueString() or
// reference(), is UNRESOLVED rather than guessed.
// Microsoft Learn, "Template functions" (azure-resource-manager/templates).

export const UNRESOLVED = Symbol("unresolved");
type Value = unknown;

type Token =
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "ident"; value: string }
  | { kind: "punct"; value: "(" | ")" | "," | "." | "[" | "]" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "'") {
      let value = "";
      i++;
      for (;;) {
        if (i >= source.length) throw new Error("unterminated string");
        if (source[i] === "'") {
          if (source[i + 1] === "'") { value += "'"; i += 2; continue; }
          i++;
          break;
        }
        value += source[i++];
      }
      tokens.push({ kind: "string", value });
      continue;
    }
    if (/[0-9-]/.test(ch)) {
      const match = /^-?\d+(\.\d+)?/.exec(source.slice(i));
      if (!match) throw new Error(`unexpected ${ch}`);
      tokens.push({ kind: "number", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))!;
      tokens.push({ kind: "ident", value: match[0] });
      i += match[0].length;
      continue;
    }
    if ("(),.[]".includes(ch)) {
      tokens.push({ kind: "punct", value: ch as "(" });
      i++;
      continue;
    }
    throw new Error(`unexpected ${ch}`);
  }
  return tokens;
}

type Node =
  | { kind: "literal"; value: Value }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "member"; target: Node; property: Node };

function parse(source: string): Node {
  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos];
  const expect = (value: string) => {
    const token = tokens[pos++];
    if (!token || token.kind !== "punct" || token.value !== value) throw new Error(`expected ${value}`);
  };
  const primary = (): Node => {
    const token = tokens[pos++];
    if (!token) throw new Error("unexpected end");
    if (token.kind === "string" || token.kind === "number") return { kind: "literal", value: token.value };
    if (token.kind !== "ident") throw new Error("unexpected token");
    expect("(");
    const args: Node[] = [];
    if (!(peek()?.kind === "punct" && peek()!.value === ")")) {
      for (;;) {
        args.push(expression());
        const next = tokens[pos++];
        if (next?.kind === "punct" && next.value === ")") break;
        if (!(next?.kind === "punct" && next.value === ",")) throw new Error("expected , or )");
      }
    } else {
      pos++;
    }
    return { kind: "call", name: token.value.toLowerCase(), args };
  };
  const expression = (): Node => {
    let node = primary();
    for (;;) {
      const token = peek();
      if (token?.kind === "punct" && token.value === ".") {
        pos++;
        const name = tokens[pos++];
        if (!name || name.kind !== "ident") throw new Error("expected property");
        node = { kind: "member", target: node, property: { kind: "literal", value: name.value } };
      } else if (token?.kind === "punct" && token.value === "[") {
        pos++;
        const property = expression();
        expect("]");
        node = { kind: "member", target: node, property };
      } else {
        return node;
      }
    }
  };
  const node = expression();
  if (pos !== tokens.length) throw new Error("trailing tokens");
  return node;
}

export function isExpression(value: unknown): boolean {
  return typeof value === "string" && /^\s*\[/.test(value) && !/^\s*\[\[/.test(value) && /\]\s*$/.test(value);
}

export type TemplateScope = {
  parameters: Record<string, unknown>;
  variables: Record<string, unknown>;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function findKey(record: Record<string, unknown>, key: string): string | undefined {
  if (key in record) return key;
  const lower = key.toLowerCase();
  return Object.keys(record).find((candidate) => candidate.toLowerCase() === lower);
}

export function createEvaluator(scope: TemplateScope) {
  const variableCache = new Map<string, Value>();
  const resolving = new Set<string>();
  let lenient = false;
  const STRING_FUNCTIONS = new Set(["concat", "format", "tolower", "toupper", "trim", "replace", "substring", "take"]);

  const variable = (name: string): Value => {
    const key = findKey(scope.variables, name);
    if (key === undefined) return UNRESOLVED;
    const cacheKey = `${lenient}:${key}`;
    if (variableCache.has(cacheKey)) return variableCache.get(cacheKey);
    if (resolving.has(`v:${key}`)) return UNRESOLVED;
    resolving.add(`v:${key}`);
    const value = deep(scope.variables[key], true);
    resolving.delete(`v:${key}`);
    variableCache.set(cacheKey, value);
    return value;
  };

  const parameter = (name: string): Value => {
    const key = findKey(scope.parameters, name);
    if (key === undefined || resolving.has(`p:${key}`)) return UNRESOLVED;
    const definition = asRecord(scope.parameters[key]);
    if (!("defaultValue" in definition)) return UNRESOLVED;
    resolving.add(`p:${key}`);
    const value = deep(definition.defaultValue, true);
    resolving.delete(`p:${key}`);
    return value;
  };

  const strings = (values: Value[]): string[] | undefined =>
    values.every((value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      ? values.map(String)
      : undefined;

  const call = (name: string, input: Value[]): Value => {
    const args = lenient && STRING_FUNCTIONS.has(name) ? input.map((arg) => (arg === UNRESOLVED ? "" : arg)) : input;
    if (args.some((arg) => arg === UNRESOLVED)) return UNRESOLVED;
    switch (name) {
      case "parameters":
      case "variables": {
        if (typeof args[0] !== "string") return UNRESOLVED;
        const value = name === "parameters" ? parameter(args[0]) : variable(args[0]);
        // In a name, a reference with no default stands for itself.
        return value === UNRESOLVED && lenient ? args[0] : value;
      }
      case "concat": {
        if (args.every(Array.isArray)) return (args as unknown[][]).flat();
        return strings(args)?.join("") ?? UNRESOLVED;
      }
      case "format": {
        const [template, ...rest] = args;
        const values = strings(rest);
        if (typeof template !== "string" || !values) return UNRESOLVED;
        return template.replace(/\{(\d+)(?::[^}]*)?\}/g, (match, index: string) => values[Number(index)] ?? match);
      }
      case "tolower":
        return typeof args[0] === "string" ? args[0].toLowerCase() : UNRESOLVED;
      case "toupper":
        return typeof args[0] === "string" ? args[0].toUpperCase() : UNRESOLVED;
      case "trim":
        return typeof args[0] === "string" ? args[0].trim() : UNRESOLVED;
      case "replace":
        return args.every((arg) => typeof arg === "string") ? (args[0] as string).split(args[1] as string).join(args[2] as string) : UNRESOLVED;
      case "substring": {
        const [text, start, length] = args;
        if (typeof text !== "string" || typeof start !== "number") return UNRESOLVED;
        return text.substring(start, typeof length === "number" ? start + length : undefined);
      }
      case "take":
        return typeof args[0] === "string" && typeof args[1] === "number" ? args[0].slice(0, args[1]) : UNRESOLVED;
      case "string":
        return typeof args[0] === "object" ? JSON.stringify(args[0]) : String(args[0]);
      case "int":
        return Number.isFinite(Number(args[0])) ? Math.trunc(Number(args[0])) : UNRESOLVED;
      case "bool":
        return typeof args[0] === "boolean" ? args[0] : typeof args[0] === "string" ? args[0].toLowerCase() === "true" : UNRESOLVED;
      case "true":
        return true;
      case "false":
        return false;
      case "null":
        return null;
      case "equals":
        return JSON.stringify(args[0]) === JSON.stringify(args[1]);
      case "not":
        return typeof args[0] === "boolean" ? !args[0] : UNRESOLVED;
      case "and":
        return args.every((arg) => typeof arg === "boolean") ? args.every(Boolean) : UNRESOLVED;
      case "or":
        return args.every((arg) => typeof arg === "boolean") ? args.some(Boolean) : UNRESOLVED;
      case "if":
        return typeof args[0] === "boolean" ? (args[0] ? args[1] : args[2]) : UNRESOLVED;
      case "empty":
        return args[0] === null || args[0] === "" || (Array.isArray(args[0]) && args[0].length === 0) || (typeof args[0] === "object" && args[0] !== null && Object.keys(args[0]).length === 0);
      case "coalesce":
        return args.find((arg) => arg !== null) ?? null;
      case "resourceid":
      case "subscriptionresourceid":
      case "tenantresourceid":
      case "extensionresourceid": {
        const values = strings(args);
        if (!values) return UNRESOLVED;
        const typeIndex = values.findIndex((value) => /^[A-Za-z0-9]+\.[A-Za-z0-9.]+\/[^/]/.test(value));
        if (typeIndex < 0) return UNRESOLVED;
        const segments = values[typeIndex].split("/");
        const names = values.slice(typeIndex + 1).flatMap((value) => value.split("/"));
        const path = [segments[0], ...segments.slice(1).flatMap((segment, index) => [segment, names[index] ?? ""])];
        return `/providers/${path.join("/")}`;
      }
      case "length":
        return typeof args[0] === "string" || Array.isArray(args[0]) ? args[0].length : UNRESOLVED;
      default:
        return UNRESOLVED;
    }
  };

  const evaluateNode = (node: Node): Value => {
    if (node.kind === "literal") return node.value;
    if (node.kind === "call") {
      // if() evaluates only the branch it takes, so an unresolvable branch it
      // skips does not make the whole expression unresolvable.
      if (node.name === "if" && node.args.length === 3) {
        const condition = evaluateNode(node.args[0]);
        return typeof condition === "boolean" ? evaluateNode(node.args[condition ? 1 : 2]) : UNRESOLVED;
      }
      return call(node.name, node.args.map(evaluateNode));
    }
    const target = evaluateNode(node.target);
    const property = evaluateNode(node.property);
    if (target === UNRESOLVED || property === UNRESOLVED) return UNRESOLVED;
    if (Array.isArray(target) && typeof property === "number") return property in target ? target[property] : UNRESOLVED;
    if (typeof property !== "string") return UNRESOLVED;
    const record = asRecord(target);
    const key = findKey(record, property);
    return key === undefined ? UNRESOLVED : record[key];
  };

  // One template string: an expression is evaluated, "[[" escapes a literal "[".
  const evaluate = (value: unknown): Value => {
    if (typeof value !== "string") return value;
    if (/^\s*\[\[/.test(value)) return value.replace(/^(\s*)\[\[/, "$1[");
    if (!isExpression(value)) return value;
    try {
      return evaluateNode(parse(value.trim().slice(1, -1)));
    } catch {
      return UNRESOLVED;
    }
  };

  // Every string in `value` evaluated. With `strict`, any unresolvable part
  // makes the result UNRESOLVED; otherwise the original expression is kept.
  function deep(value: unknown, strict = false): Value {
    if (typeof value === "string") {
      const result = evaluate(value);
      return result === UNRESOLVED && !strict ? value : result;
    }
    if (Array.isArray(value)) {
      const items = value.map((item) => deep(item, strict));
      return strict && items.includes(UNRESOLVED) ? UNRESOLVED : items;
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value).map(([key, item]) => [key, deep(item, strict)] as const);
      return strict && entries.some(([, item]) => item === UNRESOLVED) ? UNRESOLVED : Object.fromEntries(entries);
    }
    return value;
  }

  // A name or label: string functions keep the parts that can be evaluated.
  const evaluateLenient = (value: unknown): Value => {
    lenient = true;
    try {
      return evaluate(value);
    } finally {
      lenient = false;
    }
  };

  return {
    evaluate,
    evaluateLenient,
    resolveAll: (value: unknown) => deep(value),
    parameter,
    variable,
  };
}

export type Evaluator = ReturnType<typeof createEvaluator>;
