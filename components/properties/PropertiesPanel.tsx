"use client";

import { useMemo, useState } from "react";
import { useGraphStore } from "@/lib/graph/store";
import { getServiceDefinition } from "@/lib/catalogue/services";
import { describeObjectSchema, FieldDescriptor } from "@/lib/catalogue/introspect";
import { AZURE_REGIONS, GraphDocumentSchema, GraphNode } from "@/lib/graph/schema";
import { FILENAME_STEM_MAX } from "@/lib/graph/filename";

// The document name becomes the stem of every download's file name.
const DOCUMENT_NAME_MAX = FILENAME_STEM_MAX;
const NODE_NAME_MAX = 80;
// TODO(untangle): use the exported literal length limit from lib/graph/literal (MAX_LITERAL is not exported)
const PROPERTY_TEXT_MAX = 4096;
const ENVIRONMENTS = GraphDocumentSchema.shape.metadata.shape.environment.options;

export function PropertiesPanel() {
  const document = useGraphStore((s) => s.document);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const setMetadata = useGraphStore((s) => s.setMetadata);

  const node = selectedNodeId
    ? document.nodes.find((n) => n.id === selectedNodeId) ?? null
    : null;

  if (!node) {
    return (
      <section className="editor-panel editor-properties flex w-64 shrink-0 flex-col gap-3 border-l border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Document
          </h2>
          <button
            type="button"
            onClick={() => useGraphStore.getState().togglePanel("properties")}
            className="rounded p-1 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Collapse properties"
            title="Collapse"
          >
            ›
          </button>
        </div>
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Name</span>
          <RequiredText
            value={document.metadata.name}
            maxLength={DOCUMENT_NAME_MAX}
            onCommit={(name) => setMetadata({ name })}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Environment</span>
          <select
            value={document.metadata.environment}
            onChange={(e) =>
              setMetadata({ environment: e.target.value as (typeof ENVIRONMENTS)[number] })
            }
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {ENVIRONMENTS.map((environment) => (
              <option key={environment} value={environment}>{environment}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Region</span>
          <select
            value={document.metadata.region}
            onChange={(e) =>
              setMetadata({ region: e.target.value as typeof document.metadata.region })
            }
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {AZURE_REGIONS.map((region) => (
              <option key={region} value={region}>{region}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Resource Group name</span>
          <RequiredText
            value={document.metadata.resourceGroupName}
            maxLength={getServiceDefinition("resourceGroup").nameMaxLength}
            onCommit={(resourceGroupName) => setMetadata({ resourceGroupName })}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          Select a node to edit its properties.
        </p>
      </section>
    );
  }

  return <NodeProperties key={node.id} node={node} />;
}

function NodeProperties({ node }: { node: GraphNode }) {
  const updateNode = useGraphStore((s) => s.updateNode);
  const updateNodeProperties = useGraphStore((s) => s.updateNodeProperties);
  const def = getServiceDefinition(node.type);
  const fields = useMemo(
    () => describeObjectSchema(def.propertiesSchema as never),
    [def.propertiesSchema],
  );

  return (
    <section className="editor-panel editor-properties flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-l border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {def.label}
          </p>
          <button
            type="button"
            onClick={() => useGraphStore.getState().togglePanel("properties")}
            className="rounded p-1 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Collapse properties"
            title="Collapse"
          >
            ›
          </button>
        </div>
        <RequiredText
          aria-label="Node name"
          value={node.name}
          maxLength={NODE_NAME_MAX}
          onCommit={(name) => updateNode(node.id, { name })}
          className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm font-semibold dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Resource name</span>
          <RequiredText
            value={node.resourceName}
            maxLength={def.nameMaxLength}
            aria-describedby={`${node.id}-name-limit`}
            onCommit={(resourceName) => updateNode(node.id, { resourceName })}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <span id={`${node.id}-name-limit`} className="block text-[10px] text-zinc-500 dark:text-zinc-400">
            Up to {def.nameMaxLength} characters ({node.resourceName.length} used)
          </span>
        </label>
      </header>
      <div className="flex flex-col gap-3">
        {fields.map((field) => (
          <Field
            key={field.name}
            field={field}
            value={node.properties[field.name]}
            onChange={(v) => updateNodeProperties(node.id, { [field.name]: v })}
          />
        ))}
      </div>
    </section>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldDescriptor;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const label = (
    <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{field.name}</span>
  );

  switch (field.kind) {
    case "boolean":
      return (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300"
          />
          <span className="text-sm text-zinc-700 dark:text-zinc-200">{field.name}</span>
        </label>
      );
    case "number":
      return <NumberField field={field} value={value} label={label} onChange={onChange} />;
    case "enum":
      return (
        <label className="space-y-1">
          {label}
          <select
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {(field.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      );
    case "stringArray":
      return (
        <label className="space-y-1">
          {label}
          <textarea
            value={Array.isArray(value) ? value.join("\n") : ""}
            maxLength={PROPERTY_TEXT_MAX}
            onChange={(e) =>
              onChange(
                e.target.value
                  .split("\n")
                  .map((s) => s.trim().slice(0, 256))
                  .filter(Boolean)
                  .slice(0, 100),
              )
            }
            rows={3}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
            placeholder="One per line"
          />
        </label>
      );
    case "record":
      return <RecordField name={field.name} value={value} onChange={onChange} />;
    case "string":
    default:
      return (
        <label className="space-y-1">
          {label}
          <input
            value={typeof value === "string" ? value : ""}
            maxLength={field.maxLength ?? PROPERTY_TEXT_MAX}
            onChange={(e) => onChange(e.target.value.slice(0, field.maxLength ?? PROPERTY_TEXT_MAX))}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
      );
  }
}

// A required name: capped at maxLength, and saved only when non-empty, so the
// field can be cleared while retyping without storing an invalid document.
function RequiredText({ value, maxLength, onCommit, ...rest }: { value: string; maxLength: number; onCommit: (next: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "maxLength">) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...rest}
      value={draft ?? value}
      maxLength={maxLength}
      onChange={(e) => {
        const next = e.target.value.slice(0, maxLength);
        setDraft(next);
        if (next.trim() !== "") onCommit(next);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

// Typing goes into a draft; only a whole number inside the schema range is
// stored, so an empty box, "-5" or "3.7" can never reach the saved diagram.
function NumberField({ field, value, label, onChange }: { field: FieldDescriptor; value: unknown; label: React.ReactNode; onChange: (next: unknown) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (typeof value === "number" ? String(value) : "");
  const parse = (text: string): number | null => {
    if (text.trim() === "") return null;
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    const whole = field.integer ? Math.round(n) : n;
    return Math.min(field.max ?? Number.MAX_SAFE_INTEGER, Math.max(field.min ?? -Number.MAX_SAFE_INTEGER, whole));
  };
  const range = field.min !== undefined && field.max !== undefined ? `${field.min} to ${field.max}` : undefined;
  return (
    <label className="space-y-1">
      {label}
      <input
        type="number"
        inputMode={field.integer ? "numeric" : "decimal"}
        value={shown}
        min={field.min}
        max={field.max}
        step={field.integer ? 1 : "any"}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n) && n === parse(e.target.value)) onChange(n);
        }}
        onBlur={() => {
          if (draft === null) return;
          const next = parse(draft);
          if (next !== null) onChange(next);
          setDraft(null);
        }}
        className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
      />
      {range ? <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">{field.integer ? "Whole number, " : ""}{range}</span> : null}
    </label>
  );
}

function RecordField({ name, value, onChange }: { name: string; value: unknown; onChange: (value: unknown) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);
  return <label className="space-y-1">
    <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">{name}</span>
    <textarea rows={4} maxLength={PROPERTY_TEXT_MAX} value={draft ?? JSON.stringify(value ?? {}, null, 2)} aria-invalid={error}
      className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 font-mono text-xs dark:bg-zinc-900"
      onChange={(event) => {
        setDraft(event.target.value);
        try {
          const parsed: unknown = JSON.parse(event.target.value);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected object");
          setError(false); onChange(parsed);
        } catch { setError(true); }
      }} onBlur={() => { if (!error) setDraft(null); }} />
    {error && <span role="alert" className="text-xs text-red-700 dark:text-red-300">Enter a valid JSON object. Last valid value is kept.</span>}
  </label>;
}
