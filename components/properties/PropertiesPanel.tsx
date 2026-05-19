"use client";

import { useMemo } from "react";
import { useGraphStore } from "@/lib/graph/store";
import { getServiceDefinition } from "@/lib/catalogue/services";
import { describeObjectSchema, FieldDescriptor } from "@/lib/catalogue/introspect";
import { GraphNode } from "@/lib/graph/schema";

export function PropertiesPanel() {
  const document = useGraphStore((s) => s.document);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const setMetadata = useGraphStore((s) => s.setMetadata);

  const node = selectedNodeId
    ? document.nodes.find((n) => n.id === selectedNodeId) ?? null
    : null;

  if (!node) {
    return (
      <section className="flex w-80 flex-col gap-3 border-l border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Document
          </h2>
          <button
            type="button"
            onClick={() => useGraphStore.getState().togglePanel("properties")}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Collapse properties"
            title="Collapse"
          >
            ›
          </button>
        </div>
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-zinc-500">Name</span>
          <input
            value={document.metadata.name}
            onChange={(e) => setMetadata({ name: e.target.value })}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-zinc-500">Environment</span>
          <select
            value={document.metadata.environment}
            onChange={(e) =>
              setMetadata({ environment: e.target.value as "dev" | "test" | "prod" })
            }
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="dev">dev</option>
            <option value="test">test</option>
            <option value="prod">prod</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-zinc-500">Region</span>
          <select
            value={document.metadata.region}
            onChange={(e) =>
              setMetadata({ region: e.target.value as typeof document.metadata.region })
            }
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="australiaeast">australiaeast</option>
            <option value="australiasoutheast">australiasoutheast</option>
            <option value="australiacentral">australiacentral</option>
            <option value="australiacentral2">australiacentral2</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-zinc-500">Resource Group name</span>
          <input
            value={document.metadata.resourceGroupName}
            onChange={(e) => setMetadata({ resourceGroupName: e.target.value })}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        <p className="mt-4 text-xs text-zinc-500">
          Select a node to edit its properties.
        </p>
      </section>
    );
  }

  return <NodeProperties node={node} />;
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
    <section className="flex w-80 flex-col gap-3 overflow-y-auto border-l border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">
            {def.label}
          </p>
          <button
            type="button"
            onClick={() => useGraphStore.getState().togglePanel("properties")}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Collapse properties"
            title="Collapse"
          >
            ›
          </button>
        </div>
        <input
          value={node.name}
          onChange={(e) => updateNode(node.id, { name: e.target.value })}
          className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm font-semibold dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-zinc-500">Resource name</span>
          <input
            value={node.resourceName}
            onChange={(e) => updateNode(node.id, { resourceName: e.target.value })}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
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
    <span className="text-[11px] font-medium text-zinc-500">{field.name}</span>
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
      return (
        <label className="space-y-1">
          {label}
          <input
            type="number"
            value={value === undefined || value === null ? "" : String(value)}
            min={field.min}
            max={field.max}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
      );
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
            onChange={(e) =>
              onChange(
                e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            rows={3}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
            placeholder="One per line"
          />
        </label>
      );
    case "record":
      return (
        <label className="space-y-1">
          {label}
          <textarea
            value={
              typeof value === "object" && value !== null
                ? JSON.stringify(value, null, 2)
                : "{}"
            }
            onChange={(e) => {
              try {
                onChange(JSON.parse(e.target.value));
              } catch {
                // tolerate invalid JSON while user types
              }
            }}
            rows={4}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
      );
    case "string":
    default:
      return (
        <label className="space-y-1">
          {label}
          <input
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
      );
  }
}
