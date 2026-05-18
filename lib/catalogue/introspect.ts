import { z } from "zod";

export type FieldKind = "string" | "number" | "boolean" | "enum" | "stringArray" | "record";

export type FieldDescriptor = {
  name: string;
  kind: FieldKind;
  options?: string[];
  min?: number;
  max?: number;
  optional: boolean;
  defaultValue: unknown;
};

type AnySchema = z.ZodType<unknown, unknown>;

function unwrap(schema: AnySchema): AnySchema {
  let s = schema;
  while (true) {
    const def = (s as { _def?: { typeName?: string }; def?: { type?: string } })._def
      ?? (s as { def?: { type?: string } }).def;
    const typeName = (def as { typeName?: string; type?: string } | undefined)?.typeName
      ?? (def as { type?: string } | undefined)?.type;
    if (typeName === "ZodDefault" || typeName === "default") {
      const inner = (s as unknown as { _def: { innerType: AnySchema }; def?: { innerType: AnySchema } });
      s = (inner.def?.innerType ?? inner._def.innerType) as AnySchema;
      continue;
    }
    if (typeName === "ZodOptional" || typeName === "optional") {
      const inner = (s as unknown as { _def: { innerType: AnySchema }; def?: { innerType: AnySchema } });
      s = (inner.def?.innerType ?? inner._def.innerType) as AnySchema;
      continue;
    }
    return s;
  }
}

function getDefault(schema: AnySchema): unknown {
  try {
    return (schema.parse as (input?: unknown) => unknown)(undefined);
  } catch {
    try {
      return (schema.parse as (input?: unknown) => unknown)({});
    } catch {
      return undefined;
    }
  }
}

function readTypeName(schema: AnySchema): string | undefined {
  const flat = (schema as unknown as { def?: { type?: string }; _def?: { typeName?: string; type?: string } });
  return flat.def?.type ?? flat._def?.typeName ?? flat._def?.type;
}

function readEnumValues(schema: AnySchema): string[] | undefined {
  const def = (schema as unknown as { def?: { entries?: Record<string, string>; values?: readonly string[] }; _def?: { values?: readonly string[] } });
  if (def.def?.entries) return Object.values(def.def.entries);
  if (def.def?.values) return [...def.def.values];
  if (def._def?.values) return [...def._def.values];
  return undefined;
}

function readChecks(schema: AnySchema): { min?: number; max?: number } {
  const flat = schema as unknown as { minValue?: number; maxValue?: number };
  if (typeof flat.minValue === "number" || typeof flat.maxValue === "number") {
    return { min: flat.minValue, max: flat.maxValue };
  }
  const def = (schema as unknown as { def?: { checks?: Array<Record<string, unknown>> }; _def?: { checks?: Array<Record<string, unknown>> } });
  const checks = def.def?.checks ?? def._def?.checks ?? [];
  let min: number | undefined;
  let max: number | undefined;
  for (const c of checks) {
    const kind = c.kind ?? c.check;
    if (kind === "min" || kind === "greater_than" || kind === "min_size") {
      const v = c.value ?? c.minimum;
      if (typeof v === "number") min = v;
    }
    if (kind === "max" || kind === "less_than" || kind === "max_size") {
      const v = c.value ?? c.maximum;
      if (typeof v === "number") max = v;
    }
  }
  return { min, max };
}

export function describeObjectSchema(schema: z.ZodObject<z.ZodRawShape>): FieldDescriptor[] {
  const shape = schema.shape as Record<string, AnySchema>;
  const descriptors: FieldDescriptor[] = [];
  for (const [name, raw] of Object.entries(shape)) {
    const typeName = readTypeName(raw);
    const optional = typeName === "ZodOptional" || typeName === "optional";
    const inner = unwrap(raw);
    const innerType = readTypeName(inner);
    const defaultValue = getDefault(raw);

    let kind: FieldKind;
    let options: string[] | undefined;
    if (innerType === "string" || innerType === "ZodString") {
      kind = "string";
    } else if (innerType === "number" || innerType === "ZodNumber") {
      kind = "number";
    } else if (innerType === "boolean" || innerType === "ZodBoolean") {
      kind = "boolean";
    } else if (innerType === "enum" || innerType === "ZodEnum") {
      kind = "enum";
      options = readEnumValues(inner);
    } else if (innerType === "array" || innerType === "ZodArray") {
      const arrayDef = inner as unknown as { def?: { element: AnySchema }; _def?: { type: AnySchema; element?: AnySchema } };
      const elem = arrayDef.def?.element ?? arrayDef._def?.element ?? arrayDef._def?.type;
      const elemTypeName = elem ? readTypeName(elem) : undefined;
      kind = elemTypeName === "string" || elemTypeName === "ZodString" ? "stringArray" : "record";
    } else if (innerType === "record" || innerType === "ZodRecord" || innerType === "object" || innerType === "ZodObject") {
      kind = "record";
    } else {
      kind = "string";
    }

    const { min, max } = readChecks(inner);
    descriptors.push({ name, kind, options, min, max, optional, defaultValue });
  }
  return descriptors;
}
