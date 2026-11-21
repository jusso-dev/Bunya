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
    const lower = token.value.toLowerCase();
    if (!(peek()?.kind === "punct" && peek()!.value === "(")) {
      if (lower === "true") return { kind: "literal", value: true };
      if (lower === "false") return { kind: "literal", value: false };
      if (lower === "null") return { kind: "literal", value: null };
    }
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
    return { kind: "call", name: lower, args };
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
  if (Object.hasOwn(record, key)) return key;
  const lower = key.toLowerCase();
  return Object.keys(record).find((candidate) => candidate.toLowerCase() === lower);
}

const MAX_EVAL_LENGTH = 65_536;
const MAX_EVAL_STEPS = 10_000;

function withinSizeLimit(value: Value): Value {
  if (typeof value === "string" && value.length > MAX_EVAL_LENGTH) return UNRESOLVED;
  if (Array.isArray(value) && value.length > MAX_EVAL_LENGTH) return UNRESOLVED;
  return value;
}

function stableEqual(
  a: unknown,
  b: unknown,
  charge: () => boolean,
  memo = new Map<object, Map<object, boolean>>(),
): boolean | typeof UNRESOLVED {
  if (!charge()) return UNRESOLVED;
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a === "object" && typeof b === "object") {
    const cached = memo.get(a)?.get(b);
    if (cached !== undefined) return cached;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    let equal = true;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        equal = false;
      } else {
        for (let i = 0; i < a.length; i++) {
          const res = stableEqual(a[i], b[i], charge, memo);
          if (res === UNRESOLVED) return UNRESOLVED;
          if (!res) { equal = false; break; }
        }
      }
    } else {
      const ra = a as Record<string, unknown>;
      const rb = b as Record<string, unknown>;
      const ka = Object.keys(ra).sort();
      const kb = Object.keys(rb).sort();
      if (ka.length !== kb.length) {
        equal = false;
      } else {
        for (let i = 0; i < ka.length; i++) {
          if (ka[i] !== kb[i]) { equal = false; break; }
          const res = stableEqual(ra[ka[i]], rb[kb[i]], charge, memo);
          if (res === UNRESOLVED) return UNRESOLVED;
          if (!res) { equal = false; break; }
        }
      }
    }
    let inner = memo.get(a);
    if (!inner) {
      inner = new Map();
      memo.set(a, inner);
    }
    inner.set(b, equal);
    return equal;
  }
  return false;
}

export function createEvaluator(scope: TemplateScope) {
  const variableCache = new Map<string, Value>();
  const resolving = new Set<string>();
  let lenient = false;
  let steps = 0;
  let evalDepth = 0;
  const STRING_FUNCTIONS = new Set(["concat", "format", "tolower", "toupper", "trim", "replace", "substring", "take"]);

  const chargeStep = (): boolean => ++steps <= MAX_EVAL_STEPS;

  const withBudget = <T,>(fn: () => T): T => {
    if (evalDepth === 0) steps = 0;
    evalDepth++;
    try {
      return fn();
    } finally {
      evalDepth--;
    }
  };

  const variable = (name: string): Value => withBudget(() => {
    const key = findKey(scope.variables, name);
    if (key === undefined) return UNRESOLVED;
    const cacheKey = `${lenient}:${key}`;
    if (variableCache.has(cacheKey)) return variableCache.get(cacheKey);
    if (resolving.has(`v:${key}`)) return UNRESOLVED;
    resolving.add(`v:${key}`);
    const value = withinSizeLimit(deep(scope.variables[key], true));
    resolving.delete(`v:${key}`);
    if (steps <= MAX_EVAL_STEPS) variableCache.set(cacheKey, value);
    return value;
  });

  const parameter = (name: string): Value => withBudget(() => {
    const key = findKey(scope.parameters, name);
    if (key === undefined || resolving.has(`p:${key}`)) return UNRESOLVED;
    const definition = asRecord(scope.parameters[key]);
    if (!Object.hasOwn(definition, "defaultValue")) return UNRESOLVED;
    resolving.add(`p:${key}`);
    const value = withinSizeLimit(deep(definition.defaultValue, true));
    resolving.delete(`p:${key}`);
    return value;
  });

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
        if (args.length !== 1 || typeof args[0] !== "string") return UNRESOLVED;
        const value = name === "parameters" ? parameter(args[0]) : variable(args[0]);
        // In a name, a reference with no default stands for itself.
        return value === UNRESOLVED && lenient ? args[0] : value;
      }
      case "concat": {
        if (args.length === 0) return UNRESOLVED;
        if (args.every(Array.isArray)) {
          let total = 0;
          for (const arr of args as unknown[][]) {
            total += arr.length;
            if (total > MAX_EVAL_LENGTH) return UNRESOLVED;
          }
          return (args as unknown[][]).flat();
        }
        const parts = strings(args);
        if (!parts) return UNRESOLVED;
        let total = 0;
        for (const part of parts) {
          total += part.length;
          if (total > MAX_EVAL_LENGTH) return UNRESOLVED;
        }
        return parts.join("");
      }
      case "format": {
        const [template, ...rest] = args;
        const values = strings(rest);
        if (typeof template !== "string" || !values) return UNRESOLVED;
        return withinSizeLimit(template.replace(/\{(\d+)(?::[^}]*)?\}/g, (match, index: string) => values[Number(index)] ?? match));
      }
      case "tolower":
        return args.length === 1 && typeof args[0] === "string" ? args[0].toLowerCase() : UNRESOLVED;
      case "toupper":
        return args.length === 1 && typeof args[0] === "string" ? args[0].toUpperCase() : UNRESOLVED;
      case "trim":
        return args.length === 1 && typeof args[0] === "string" ? args[0].trim() : UNRESOLVED;
      case "replace": {
        if (args.length !== 3 || !args.every((arg) => typeof arg === "string")) return UNRESOLVED;
        const [source, oldStr, newStr] = args as [string, string, string];
        if (oldStr === "") return source;
        const parts = source.split(oldStr);
        if (source.length + (parts.length - 1) * Math.max(0, newStr.length - oldStr.length) > MAX_EVAL_LENGTH) {
          return UNRESOLVED;
        }
        return parts.join(newStr);
      }
      case "substring": {
        const [text, start, length] = args;
        if (typeof text !== "string" || typeof start !== "number" || !Number.isInteger(start) || start < 0) return UNRESOLVED;
        if (length !== undefined && (typeof length !== "number" || !Number.isInteger(length) || length < 0)) return UNRESOLVED;
        return text.substring(start, typeof length === "number" ? start + length : undefined);
      }
      case "take":
        if (args.length !== 2 || typeof args[1] !== "number" || !Number.isInteger(args[1])) return UNRESOLVED;
        if (typeof args[0] === "string") return args[1] <= 0 ? "" : args[0].slice(0, args[1]);
        if (Array.isArray(args[0])) return args[1] <= 0 ? [] : args[0].slice(0, args[1]);
        return UNRESOLVED;
      case "string":
        if (args.length !== 1) return UNRESOLVED;
        return withinSizeLimit(typeof args[0] === "object" ? JSON.stringify(args[0]) : String(args[0]));
      case "int": {
        if (args.length !== 1) return UNRESOLVED;
        if (typeof args[0] === "number" && Number.isFinite(args[0])) return Math.trunc(args[0]);
        if (typeof args[0] === "string" && /^-?\d+$/.test(args[0].trim())) return Number.parseInt(args[0].trim(), 10);
        return UNRESOLVED;
      }
      case "bool": {
        if (args.length !== 1) return UNRESOLVED;
        if (typeof args[0] === "boolean") return args[0];
        if (args[0] === 1) return true;
        if (args[0] === 0) return false;
        if (typeof args[0] === "string") {
          const lower = args[0].trim().toLowerCase();
          if (lower === "true") return true;
          if (lower === "false") return false;
        }
        return UNRESOLVED;
      }
      case "true":
        return true;
      case "false":
        return false;
      case "null":
        return null;
      case "equals":
        return args.length === 2 ? stableEqual(args[0], args[1], chargeStep) : UNRESOLVED;
      case "not":
        return args.length === 1 && typeof args[0] === "boolean" ? !args[0] : UNRESOLVED;
      case "and":
        return args.length >= 2 && args.every((arg) => typeof arg === "boolean") ? args.every(Boolean) : UNRESOLVED;
      case "or":
        return args.length >= 2 && args.every((arg) => typeof arg === "boolean") ? args.some(Boolean) : UNRESOLVED;
      case "if":
        return args.length === 3 && typeof args[0] === "boolean" ? (args[0] ? args[1] : args[2]) : UNRESOLVED;
      case "empty":
        if (args.length !== 1) return UNRESOLVED;
        return args[0] === null || args[0] === "" || (Array.isArray(args[0]) && args[0].length === 0) || (typeof args[0] === "object" && args[0] !== null && Object.keys(args[0]).length === 0);
      case "coalesce":
        return args.length >= 1 ? (args.find((arg) => arg !== null) ?? null) : UNRESOLVED;
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
      // Bunya targets Azure public cloud (Microsoft Learn, "environment").
      case "environment":
        return {
          name: "AzureCloud",
          suffixes: {
            storage: "core.windows.net",
            sqlServerHostname: ".database.windows.net",
            keyvaultDns: ".vault.azure.net",
            acrLoginServer: ".azurecr.io",
          },
        };
      case "length":
        return args.length === 1 && (typeof args[0] === "string" || Array.isArray(args[0])) ? args[0].length : UNRESOLVED;
      default:
        return UNRESOLVED;
    }
  };

  const evaluateNode = (node: Node): Value => {
    if (!chargeStep()) return UNRESOLVED;
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
    if (Array.isArray(target) && typeof property === "number") return property >= 0 && property < target.length ? target[property] : UNRESOLVED;
    if (typeof property !== "string") return UNRESOLVED;
    const record = asRecord(target);
    const key = findKey(record, property);
    return key === undefined ? UNRESOLVED : record[key];
  };

  // One template string: an expression is evaluated, "[[" escapes a literal "[".
  const evaluate = (value: unknown): Value => withBudget(() => {
    if (typeof value !== "string") return value;
    if (/^\s*\[\[/.test(value)) return value.replace(/^(\s*)\[\[/, "$1[");
    if (!isExpression(value)) return value;
    try {
      return withinSizeLimit(evaluateNode(parse(value.trim().slice(1, -1))));
    } catch {
      return UNRESOLVED;
    }
  });

  // Every string in `value` evaluated. With `strict`, any unresolvable part
  // makes the result UNRESOLVED; otherwise the original expression is kept.
  function deep(value: unknown, strict = false): Value {
    return withBudget(() => {
      if (typeof value === "string") {
        const result = evaluate(value);
        return result === UNRESOLVED && !strict ? value : result;
      }
      if (Array.isArray(value)) {
        const items = value.map((item) => deep(item, strict));
        return strict && items.includes(UNRESOLVED) ? UNRESOLVED : items;
      }
      if (value && typeof value === "object") {
        const entries: [string, unknown][] = [];
        for (const [key, item] of Object.entries(value)) {
          const evaluatedKey = evaluate(key);
          if (strict && (evaluatedKey === UNRESOLVED || typeof evaluatedKey !== "string")) return UNRESOLVED;
          const resolvedKey = typeof evaluatedKey === "string" ? evaluatedKey : key;
          const resolvedItem = deep(item, strict);
          if (strict && resolvedItem === UNRESOLVED) return UNRESOLVED;
          entries.push([resolvedKey, resolvedItem]);
        }
        return Object.fromEntries(entries);
      }
      return value;
    });
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

  // Every string evaluated leniently, for matching references to resource
  // names that were themselves evaluated leniently.
  const resolveAllLenient = (value: unknown): Value => {
    lenient = true;
    try {
      return deep(value);
    } finally {
      lenient = false;
    }
  };

  return {
    evaluate,
    evaluateLenient,
    resolveAll: (value: unknown) => deep(value),
    resolveAllLenient,
    parameter,
    variable,
  };
}

export type Evaluator = ReturnType<typeof createEvaluator>;
