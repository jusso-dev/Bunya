"use client";

import { toast } from "sonner";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Dialog } from "@/components/Dialog";
import { getServiceDefinition } from "@/lib/catalogue/services";
import { EDGE_KINDS, SERVICE_TYPES, type EdgeKind, type ServiceType } from "@/lib/graph/schema";
import { useGraphStore } from "@/lib/graph/store";
import { readFileAsText } from "@/lib/graph/portable";
import {
  ORGANISATION_RULES_EXTENSION,
  PROPERTY_OPERATORS,
  organisationRulesToBlob,
  parseOrganisationRulesText,
  type EdgeRequirement,
  type OrganisationRule,
  type PropertyOperator, RULE_KEY_MAX, RULE_NAME_MAX, RULE_TEXT_MAX } from "@/lib/rules/organisation";
import { SeveritySchema, type Severity } from "@/lib/rules/schema";
import { downloadBlob } from "@/lib/session/download";
import { ORGANISATION_PRESETS, customRule, mergeRules, operatorNeedsValue } from "@/lib/session/organisation-presets";

const EDGE_MODES: EdgeRequirement["mode"][] = ["must_exist", "must_not_exist"];
const EDGE_DIRECTIONS: EdgeRequirement["direction"][] = ["outgoing", "incoming", "either"];

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

  const enabledCount = useMemo(
    () => organisationRules.filter((rule) => rule.enabled).length,
    [organisationRules],
  );

  const setField = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage(null);
  };

  const addRules = (incoming: OrganisationRule[], source: string) => {
    if (incoming.length === 0) {
      setMessage(`${source} did not contain any usable organisation rules.`);
      return;
    }
    replaceOrganisationRules(mergeRules(organisationRules, incoming));
    setMessage(null);
    toast.success(`Imported ${incoming.length} rule${incoming.length === 1 ? "" : "s"} from ${source}.`, { id: "rules-import" });
  };

  const importRules = (text: string, source: string) => {
    const result = parseOrganisationRulesText(text);
    if (!result.ok) {
      setMessage(`Import failed: ${result.reason}`);
      return false;
    }
    addRules(result.rules, source);
    return true;
  };

  const addCustomRule = () => {
    const result = customRule({
      name: form.name,
      description: form.description,
      severity: form.severity,
      serviceTypes: form.serviceTypes,
      check: form.mode === "property"
        ? { mode: "property", key: form.propertyKey, operator: form.propertyOperator, value: form.propertyValue }
        : { mode: "edge", direction: form.edgeDirection, edgeMode: form.edgeMode, kind: form.edgeKind, targetType: form.edgeTargetType },
    }, organisationRules);
    if (!result.ok) {
      setMessage(result.reason);
      return;
    }
    addOrganisationRule(result.rule);
    setForm((current) => ({ ...current, name: "", description: "" }));
    setMessage(null);
    toast.success(`Added ${result.rule.name}.`, { id: "rules-add" });
  };

  const importRulesText = () => {
    const text = importText.trim();
    if (!text) {
      setMessage("Paste Azure Policy JSON or a Bunya rules file first.");
      return;
    }
    if (importRules(text, "pasted JSON")) setImportText("");
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    let text: string;
    try { text = await readFileAsText(file); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not read rules file."); return; }
    importRules(text, file.name);
  };

  const exportRules = () => {
    const filename = `organisation-rules${ORGANISATION_RULES_EXTENSION}`;
    downloadBlob(organisationRulesToBlob(organisationRules), filename);
    toast.success(`Exported ${filename}.`, { id: "rules-export" });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        title="Create, import, and export organisation rule packs"
      >
        Org Rules {organisationRules.length > 0 ? `(${enabledCount}/${organisationRules.length})` : ""}
      </button>
      {open ? (
        <Dialog label="Organisation rules" onClose={() => setOpen(false)}>
        <div className="grid w-[640px] max-w-full grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <section className="flex min-w-0 flex-col gap-2">
            <div>
              <div className="font-semibold text-zinc-800 dark:text-zinc-100">Organisation Rule Engine</div>
              <div className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                Session rules are added to validation findings and can be imported from Azure Policy JSON.
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {ORGANISATION_PRESETS.map((preset) => (
                <button key={preset.id} type="button" onClick={() => addRules(preset.rules(), preset.source)} className="rounded-md border border-zinc-200 px-2 py-1 font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
                  {preset.label}
                </button>
              ))}
            </div>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Name</span>
              <input
                value={form.name}
                maxLength={RULE_NAME_MAX}
                onChange={(event) => setField("name", event.target.value.slice(0, RULE_NAME_MAX))}
                className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                placeholder="No public ingress"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Finding Text</span>
              <input
                value={form.description}
                maxLength={RULE_TEXT_MAX}
                onChange={(event) => setField("description", event.target.value.slice(0, RULE_TEXT_MAX))}
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
                  {SeveritySchema.options.map((severity) => (
                    <option key={severity} value={severity}>{severity}</option>
                  ))}
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
                    maxLength={RULE_KEY_MAX}
                    onChange={(event) => setField("propertyKey", event.target.value.slice(0, RULE_KEY_MAX))}
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
                    maxLength={RULE_TEXT_MAX}
                    onChange={(event) => setField("propertyValue", event.target.value.slice(0, RULE_TEXT_MAX))}
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
              className="rounded-md bg-zinc-900 px-2 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
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
                <div className="px-2 py-4 text-center text-[11px] text-zinc-500 dark:text-zinc-400">No organisation rules in this session.</div>
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
                        <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{rule.id} · {rule.severity}</div>
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
              aria-label="Organisation rules JSON"
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
              <div role="status" className="max-h-16 overflow-auto rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
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
                className="rounded-md bg-zinc-900 px-2 py-1 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Import
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.bunya-rules.json,application/json"
              onChange={(event) => void onFileChange(event)}
              className="hidden"
              aria-label="Import organisation rules"
            />
          </section>
        </div>
        </Dialog>
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

function selectedServiceTypes(event: ChangeEvent<HTMLSelectElement>): ServiceType[] {
  return Array.from(event.target.selectedOptions)
    .map((option) => option.value)
    .filter((value): value is ServiceType => (SERVICE_TYPES as readonly string[]).includes(value));
}

function serviceLabelMap(): Record<string, string> {
  return Object.fromEntries(serviceOptions.map((option) => [option.type, option.label]));
}
