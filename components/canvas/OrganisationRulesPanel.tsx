"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { getServiceDefinition } from "@/lib/catalogue/services";
import { EDGE_KINDS, SERVICE_TYPES, type EdgeKind, type ServiceType } from "@/lib/graph/schema";
import { useGraphStore } from "@/lib/graph/store";
import { readFileAsText } from "@/lib/graph/portable";
import {
  ORGANISATION_RULES_EXTENSION,
  makeRuleId,
  organisationRulesToBlob,
  parseOrganisationRulesText,
  type EdgeRequirement,
  type OrganisationRule,
  type PropertyOperator,
} from "@/lib/rules/organisation";
import type { Severity } from "@/lib/rules/schema";

const ORG_RULES_STORAGE_KEY = "bunya.organisationRules";

const PROPERTY_OPERATORS: PropertyOperator[] = [
  "equals",
  "not_equals",
  "present",
  "missing",
  "truthy",
  "falsy",
  "includes",
];

const EDGE_MODES: EdgeRequirement["mode"][] = ["must_exist", "must_not_exist"];
const EDGE_DIRECTIONS: EdgeRequirement["direction"][] = ["outgoing", "incoming", "either"];

const PUBLIC_NETWORK_SERVICES: ServiceType[] = [
  "appService",
  "functionApp",
  "keyVault",
  "containerRegistry",
];

const DATA_SERVICES: ServiceType[] = [
  "storageAccount",
  "sqlDatabase",
  "cosmosDb",
  "keyVault",
  "containerRegistry",
];

const COMPUTE_SERVICES: ServiceType[] = ["appService", "functionApp", "aksCluster", "virtualMachineScaleSet"];

type RuleMode = "property" | "edge";

type RuleForm = {
  name: string;
  description: string;
  severity: Severity;
  serviceTypes: ServiceType[];
  mode: RuleMode;
  propertyKey: string;
  propertyOperator: PropertyOperator;
  propertyValue: string;
  edgeDirection: EdgeRequirement["direction"];
  edgeKind: EdgeKind | "";
  edgeTargetType: ServiceType | "";
  edgeMode: EdgeRequirement["mode"];
};

const initialForm: RuleForm = {
  name: "",
  description: "",
  severity: "warning",
  serviceTypes: [],
  mode: "property",
  propertyKey: "publicNetworkAccess",
  propertyOperator: "equals",
  propertyValue: "true",
  edgeDirection: "outgoing",
  edgeKind: "diagnostic",
  edgeTargetType: "logAnalytics",
  edgeMode: "must_exist",
};

const serviceOptions = SERVICE_TYPES.map((type) => ({ type, label: getServiceDefinition(type).label }));

export function OrganisationRulesPanel() {
  const organisationRules = useGraphStore((s) => s.organisationRules);
  const addOrganisationRule = useGraphStore((s) => s.addOrganisationRule);
  const updateOrganisationRule = useGraphStore((s) => s.updateOrganisationRule);
  const removeOrganisationRule = useGraphStore((s) => s.removeOrganisationRule);
  const replaceOrganisationRules = useGraphStore((s) => s.replaceOrganisationRules);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RuleForm>(initialForm);
  const [importText, setImportText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const skippedInitialSave = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ORG_RULES_STORAGE_KEY);
    if (!stored) return;
    const result = parseOrganisationRulesText(stored);
    if (result.ok) replaceOrganisationRules(result.rules);
  }, [replaceOrganisationRules]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!skippedInitialSave.current) {
      skippedInitialSave.current = true;
      return;
    }
    window.localStorage.setItem(
      ORG_RULES_STORAGE_KEY,
      JSON.stringify({ format: "bunya-organisation-rules", version: 1, rules: organisationRules }),
    );
  }, [organisationRules]);

  const enabledCount = useMemo(
    () => organisationRules.filter((rule) => rule.enabled).length,
    [organisationRules],
  );

  const setField = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage(null);
  };

  const mergeRules = useCallback(
    (incoming: OrganisationRule[], source: string) => {
      if (incoming.length === 0) {
        setMessage(`${source} did not contain any usable organisation rules.`);
        return;
      }
      const merged = new Map<string, OrganisationRule>();
      for (const rule of organisationRules) merged.set(rule.id, rule);
      for (const rule of incoming) merged.set(rule.id, rule);
      replaceOrganisationRules([...merged.values()]);
      setMessage(`Imported ${incoming.length} rule${incoming.length === 1 ? "" : "s"} from ${source}.`);
    },
    [organisationRules, replaceOrganisationRules],
  );

  const addCustomRule = () => {
    const name = form.name.trim();
    if (!name) {
      setMessage("Name the organisation rule first.");
      return;
    }
    if (form.mode === "property" && !form.propertyKey.trim()) {
      setMessage("Property rules need a property key.");
      return;
    }
    const baseId = makeRuleId(name);
    const rule: OrganisationRule = {
      id: uniqueRuleId(baseId, new Map(organisationRules.map((existing) => [existing.id, existing]))),
      name,
      description: form.description.trim() || "Organisation-defined deployment rule.",
      severity: form.severity,
      enabled: true,
      serviceTypes: form.serviceTypes,
      message:
        form.description.trim() ||
        (form.mode === "property"
          ? `${name}: ${form.propertyKey} ${form.propertyOperator.replace("_", " ")}`
          : `${name}: required relationship is missing or forbidden`),
      property:
        form.mode === "property"
          ? {
              key: form.propertyKey.trim(),
              operator: form.propertyOperator,
              value: operatorNeedsValue(form.propertyOperator) ? parseRuleValue(form.propertyValue) : undefined,
            }
          : undefined,
      edge:
        form.mode === "edge"
          ? {
              direction: form.edgeDirection,
              mode: form.edgeMode,
              kind: form.edgeKind || undefined,
              targetType: form.edgeTargetType || undefined,
            }
          : undefined,
    };
    addOrganisationRule(rule);
    setForm((current) => ({ ...current, name: "", description: "" }));
    setMessage(`Added ${rule.name}.`);
  };

  const importRulesText = () => {
    const text = importText.trim();
    if (!text) {
      setMessage("Paste Azure Policy JSON or a Bunya rules file first.");
      return;
    }
    const result = parseOrganisationRulesText(text);
    if (!result.ok) {
      setMessage(`Import failed: ${result.reason}`);
      return;
    }
    mergeRules(result.rules, "pasted JSON");
    setImportText("");
  };

  const importRulesFile = useCallback(
    async (file: File) => {
      const text = await readFileAsText(file);
      const result = parseOrganisationRulesText(text);
      if (!result.ok) {
        setMessage(`Import failed: ${result.reason}`);
        return;
      }
      mergeRules(result.rules, file.name);
    },
    [mergeRules],
  );

  const onFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) await importRulesFile(file);
      event.target.value = "";
    },
    [importRulesFile],
  );

  const exportRules = () => {
    const blob = organisationRulesToBlob(organisationRules);
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = `organisation-rules${ORGANISATION_RULES_EXTENSION}`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage(`Exported ${a.download}.`);
  };

  const addPublicIngressPreset = () => {
    const baseRules: OrganisationRule[] = [
      ...PUBLIC_NETWORK_SERVICES.map((serviceType) => presetPropertyRule({
        idSeed: `no-public-ingress-${serviceType}`,
        name: `No public ingress: ${getServiceDefinition(serviceType).label}`,
        serviceType,
        key: "publicNetworkAccess",
        operator: "equals",
        value: true,
        message: "Public network access must be disabled for organisation-managed workloads.",
      })),
      presetPropertyRule({
        idSeed: "no-storage-blob-public-access",
        name: "No anonymous blob public access",
        serviceType: "storageAccount",
        key: "allowPublicAccess",
        operator: "equals",
        value: true,
        message: "Storage accounts must not allow anonymous blob public access.",
      }),
    ];
    mergeRules(baseRules, "No public ingress preset");
  };

  const addPrivateEndpointPreset = () => {
    mergeRules(
      DATA_SERVICES.map((serviceType) => presetEdgeRule({
        idSeed: `private-endpoint-required-${serviceType}`,
        name: `Private endpoint required: ${getServiceDefinition(serviceType).label}`,
        serviceType,
        direction: "incoming",
        kind: "network",
        targetType: "privateEndpoint",
        message: "Private access must be modelled with a Private Endpoint network path.",
      })),
      "Private endpoint preset",
    );
  };

  const addDiagnosticsPreset = () => {
    mergeRules(
      COMPUTE_SERVICES.map((serviceType) => presetEdgeRule({
        idSeed: `diagnostics-required-${serviceType}`,
        name: `Diagnostics required: ${getServiceDefinition(serviceType).label}`,
        serviceType,
        direction: "outgoing",
        kind: "diagnostic",
        targetType: "logAnalytics",
        message: "Production workloads must send diagnostics to Log Analytics.",
      })),
      "Diagnostics preset",
    );
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        title="Create, import, and export organisation rule packs"
      >
        Org Rules {organisationRules.length > 0 ? `(${enabledCount}/${organisationRules.length})` : ""}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-1 grid w-[640px] max-w-[calc(100vw-2rem)] grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 rounded-md border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <section className="flex min-w-0 flex-col gap-2">
            <div>
              <div className="font-semibold text-zinc-800 dark:text-zinc-100">Organisation Rule Engine</div>
              <div className="text-[11px] leading-4 text-zinc-500">
                Session rules are added to validation findings and can be imported from Azure Policy JSON.
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <button type="button" onClick={addPublicIngressPreset} className="rounded-md border border-zinc-200 px-2 py-1 font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
                No Public
              </button>
              <button type="button" onClick={addPrivateEndpointPreset} className="rounded-md border border-zinc-200 px-2 py-1 font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
                Private Path
              </button>
              <button type="button" onClick={addDiagnosticsPreset} className="rounded-md border border-zinc-200 px-2 py-1 font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
                Diagnostics
              </button>
            </div>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Name</span>
              <input
                value={form.name}
                onChange={(event) => setField("name", event.target.value)}
                className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                placeholder="No public ingress"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Finding Text</span>
              <input
                value={form.description}
                onChange={(event) => setField("description", event.target.value)}
                className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                placeholder="Resources must not expose public network ingress."
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Severity</span>
                <select
                  value={form.severity}
                  onChange={(event) => setField("severity", event.target.value as Severity)}
                  className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <option value="error">error</option>
                  <option value="warning">warning</option>
                  <option value="info">info</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Check Type</span>
                <select
                  value={form.mode}
                  onChange={(event) => setField("mode", event.target.value as RuleMode)}
                  className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <option value="property">property</option>
                  <option value="edge">relationship</option>
                </select>
              </label>
            </div>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Applies To</span>
              <select
                multiple
                value={form.serviceTypes}
                onChange={(event) => setField("serviceTypes", selectedServiceTypes(event))}
                className="h-24 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950"
              >
                {serviceOptions.map((option) => (
                  <option key={option.type} value={option.type}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {form.mode === "property" ? (
              <div className="grid grid-cols-[1fr_7rem_6rem] gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Property</span>
                  <input
                    value={form.propertyKey}
                    onChange={(event) => setField("propertyKey", event.target.value)}
                    className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Operator</span>
                  <select
                    value={form.propertyOperator}
                    onChange={(event) => setField("propertyOperator", event.target.value as PropertyOperator)}
                    className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                  >
                    {PROPERTY_OPERATORS.map((operator) => (
                      <option key={operator} value={operator}>
                        {operator}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Value</span>
                  <input
                    value={form.propertyValue}
                    onChange={(event) => setField("propertyValue", event.target.value)}
                    disabled={!operatorNeedsValue(form.propertyOperator)}
                    className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </label>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <RuleSelect label="Direction" value={form.edgeDirection} values={EDGE_DIRECTIONS} onChange={(value) => setField("edgeDirection", value as EdgeRequirement["direction"])} />
                <RuleSelect label="Mode" value={form.edgeMode} values={EDGE_MODES} onChange={(value) => setField("edgeMode", value as EdgeRequirement["mode"])} />
                <RuleSelect label="Kind" value={form.edgeKind} values={["", ...EDGE_KINDS]} onChange={(value) => setField("edgeKind", value as EdgeKind | "")} />
                <RuleSelect label="Other Type" value={form.edgeTargetType} values={["", ...SERVICE_TYPES]} labels={serviceLabelMap()} onChange={(value) => setField("edgeTargetType", value as ServiceType | "")} />
              </div>
            )}
            <button
              type="button"
              onClick={addCustomRule}
              className="rounded-md bg-zinc-900 px-2 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900"
            >
              Add Rule
            </button>
          </section>
          <section className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-zinc-800 dark:text-zinc-100">Active Rules</div>
              <button
                type="button"
                onClick={exportRules}
                disabled={organisationRules.length === 0}
                className="rounded-md border border-zinc-200 px-2 py-1 font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              >
                Export
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
              {organisationRules.length === 0 ? (
                <div className="px-2 py-4 text-center text-[11px] text-zinc-500">No organisation rules in this session.</div>
              ) : (
                organisationRules.map((rule) => (
                  <div key={rule.id} className="border-b border-zinc-200 px-2 py-1.5 last:border-b-0 dark:border-zinc-800">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(event) => updateOrganisationRule(rule.id, { enabled: event.target.checked })}
                        className="mt-0.5"
                        aria-label={`Enable ${rule.name}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-zinc-800 dark:text-zinc-100">{rule.name}</div>
                        <div className="truncate text-[11px] text-zinc-500">{rule.id} · {rule.severity}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeOrganisationRule(rule.id)}
                        className="rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <textarea
              value={importText}
              onChange={(event) => {
                setImportText(event.target.value);
                setMessage(null);
              }}
              rows={7}
              className="w-full resize-none rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 font-mono text-[11px] text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
              placeholder="Paste Azure Policy JSON or exported Bunya organisation rules..."
            />
            {message ? (
              <div className="max-h-16 overflow-auto rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                {message}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-md border border-zinc-200 px-2 py-1 font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              >
                Upload Policy
              </button>
              <button
                type="button"
                onClick={importRulesText}
                className="rounded-md bg-zinc-900 px-2 py-1 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900"
              >
                Import
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.bunya-rules.json,application/json"
              onChange={onFileChange}
              className="hidden"
              aria-label="Import organisation rules"
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}

function RuleSelect({
  label,
  value,
  values,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  values: readonly string[];
  labels?: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950"
      >
        {values.map((item) => (
          <option key={item || "any"} value={item}>
            {item ? labels?.[item] ?? item : "Any"}
          </option>
        ))}
      </select>
    </label>
  );
}

function operatorNeedsValue(operator: PropertyOperator): boolean {
  return operator === "equals" || operator === "not_equals" || operator === "includes";
}

function selectedServiceTypes(event: ChangeEvent<HTMLSelectElement>): ServiceType[] {
  return Array.from(event.target.selectedOptions)
    .map((option) => option.value)
    .filter((value): value is ServiceType => (SERVICE_TYPES as readonly string[]).includes(value));
}

function parseRuleValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && String(numeric) === trimmed) return numeric;
  return trimmed;
}

function uniqueRuleId(id: string, existing: Map<string, OrganisationRule>): string {
  if (!existing.has(id)) return id;
  let suffix = 2;
  let next = `${id}.${suffix}`;
  while (existing.has(next)) {
    suffix += 1;
    next = `${id}.${suffix}`;
  }
  return next;
}

function presetPropertyRule(input: {
  idSeed: string;
  name: string;
  serviceType: ServiceType;
  key: string;
  operator: PropertyOperator;
  value: unknown;
  message: string;
}): OrganisationRule {
  return {
    id: makeRuleId(input.idSeed),
    name: input.name,
    description: input.message,
    severity: "error",
    enabled: true,
    serviceTypes: [input.serviceType],
    property: { key: input.key, operator: input.operator, value: input.value },
    message: input.message,
    source: { name: "Bunya organisation preset" },
  };
}

function presetEdgeRule(input: {
  idSeed: string;
  name: string;
  serviceType: ServiceType;
  direction: EdgeRequirement["direction"];
  kind: EdgeKind;
  targetType: ServiceType;
  message: string;
}): OrganisationRule {
  return {
    id: makeRuleId(input.idSeed),
    name: input.name,
    description: input.message,
    severity: "warning",
    enabled: true,
    serviceTypes: [input.serviceType],
    edge: {
      direction: input.direction,
      kind: input.kind,
      targetType: input.targetType,
      mode: "must_exist",
    },
    message: input.message,
    source: { name: "Bunya organisation preset" },
  };
}

function serviceLabelMap(): Record<string, string> {
  return Object.fromEntries(serviceOptions.map((option) => [option.type, option.label]));
}
