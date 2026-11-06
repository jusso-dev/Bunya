import { z } from "zod";

export type FieldKind = "string" | "number" | "boolean" | "enum" | "stringArray" | "record";

export type FieldDescriptor = {
  name: string;
  kind: FieldKind;
  options?: string[];
  min?: number;
  max?: number;
  integer?: boolean;
  maxLength?: number;
  optional: boolean;
  defaultValue: unknown;
};

function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  while (current instanceof z.ZodDefault || current instanceof z.ZodOptional) {
    current = current.unwrap() as z.ZodType;
  }
  return current;
}

function fieldKind(schema: z.ZodType): FieldKind {
  if (schema instanceof z.ZodNumber) return "number";
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodEnum) return "enum";
  if (schema instanceof z.ZodArray) return schema.element instanceof z.ZodString ? "stringArray" : "record";
  if (schema instanceof z.ZodRecord || schema instanceof z.ZodObject) return "record";
  return "string";
}

export function describeObjectSchema(schema: z.ZodObject<z.ZodRawShape>): FieldDescriptor[] {
  return Object.entries(schema.shape as Record<string, z.ZodType>).map(([name, raw]) => {
    const inner = unwrap(raw);
    const kind = fieldKind(inner);
    const parsed = raw.safeParse(undefined);
    return {
      name,
      kind,
      options: inner instanceof z.ZodEnum ? (inner.options as string[]) : undefined,
      min: inner instanceof z.ZodNumber ? inner.minValue ?? undefined : undefined,
      max: inner instanceof z.ZodNumber ? inner.maxValue ?? undefined : undefined,
      ...(inner instanceof z.ZodNumber && inner.isInt ? { integer: true } : {}),
      ...(inner instanceof z.ZodString && inner.maxLength ? { maxLength: inner.maxLength } : {}),
      optional: raw instanceof z.ZodOptional,
      defaultValue: parsed.success ? parsed.data : undefined,
    };
  });
}
