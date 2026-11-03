/**
 * Entry point for `pnpm compliance:sync`.
 *
 * Reads a local checkout of https://github.com/Azure/azure-policy (MIT) and
 * regenerates lib/rules/compliance/policy-metadata.generated.ts for every
 * built-in policy referenced by lib/rules/compliance/policy-alignments.ts.
 *
 * Only identifiers are copied: policy display names, versions, parameter
 * shapes and the framework control IDs Microsoft groups each policy under.
 * No framework text is read or redistributed.
 *
 * Usage:
 *   git clone --depth 1 --filter=blob:none --sparse https://github.com/Azure/azure-policy.git /tmp/azure-policy
 *   git -C /tmp/azure-policy sparse-checkout set built-in-policies/policyDefinitions "built-in-policies/policySetDefinitions/Regulatory Compliance"
 *   pnpm compliance:sync --repo /tmp/azure-policy [--report report.md]
 *
 * Exit codes: 0 when every mapped policy exists and is current, 1 when the
 * report contains problems that need a human (missing or deprecated policies,
 * stale citations). The generated file is written either way so the diff can
 * be reviewed.
 */
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { POLICY_ALIGNMENTS } from "@/lib/rules/compliance/policy-alignments";
import type { ComplianceFramework, PolicyMetadata, PolicyParameterMetadata } from "@/lib/rules/compliance/types";
import { REGISTRY } from "@/lib/rules/registry";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(PROJECT_ROOT, "lib", "rules", "compliance", "policy-metadata.generated.ts");

type FrameworkConfig = {
  id: string;
  name: string;
  shortName: string;
  /** Initiative file name pattern; the first capture group is the framework version. */
  filePattern: RegExp;
  /** Framework version Bunya is pinned to. Newer versions are reported, not adopted. */
  pinnedVersion: string;
  fileName: (version: string) => string;
  groupPrefix: (version: string) => string;
};

// PCI DSS and HITRUST initiatives also exist upstream; they are out of scope
// by decision (issues #6 and #7), so they are deliberately not listed here.
const FRAMEWORKS: FrameworkConfig[] = [
  {
    id: "cis-azure",
    name: "CIS Microsoft Azure Foundations Benchmark",
    shortName: "CIS Azure",
    filePattern: /^CIS_Azure_Foundations_v(\d+\.\d+\.\d+)\.json$/,
    pinnedVersion: "3.0.0",
    fileName: (version) => `CIS_Azure_Foundations_v${version}.json`,
    groupPrefix: (version) => `CIS_Azure_Foundations_v${version}_`,
  },
];

type Json = Record<string, unknown>;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readJson(file: string): Promise<Json> {
  const text = await fs.readFile(file, "utf8");
  return JSON.parse(text.replace(/^﻿/, "")) as Json;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function compareControls(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

type IndexedPolicy = { name: string; properties: Json };

async function indexDefinitions(repo: string): Promise<Map<string, IndexedPolicy>> {
  const index = new Map<string, IndexedPolicy>();
  const root = path.join(repo, "built-in-policies", "policyDefinitions");
  for (const file of await walk(root)) {
    let json: Json;
    try {
      json = await readJson(file);
    } catch {
      continue;
    }
    const name = typeof json.name === "string" ? json.name.toLowerCase() : null;
    const properties = (json.properties ?? json) as Json;
    if (name && typeof properties.displayName === "string") index.set(name, { name, properties });
  }
  return index;
}

function toMetadata(policy: IndexedPolicy): Omit<PolicyMetadata, "controls"> {
  const p = policy.properties;
  const meta = (p.metadata ?? {}) as Json;
  const params = (p.parameters ?? {}) as Record<string, Json>;
  let effect: PolicyMetadata["effect"] = null;
  const parameters: Record<string, PolicyParameterMetadata> = {};
  for (const [key, value] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
    if (key.toLowerCase() === "effect") {
      effect = {
        ...(typeof value.defaultValue === "string" ? { defaultValue: value.defaultValue } : {}),
        allowedValues: Array.isArray(value.allowedValues) ? value.allowedValues.map(String) : [],
      };
      continue;
    }
    parameters[key] = {
      type: String(value.type ?? "String"),
      ...(value.defaultValue !== undefined ? { defaultValue: value.defaultValue } : {}),
      ...(Array.isArray(value.allowedValues) ? { allowedValues: value.allowedValues } : {}),
    };
  }
  return {
    displayName: String(p.displayName),
    version: String(p.version ?? meta.version ?? "0.0.0"),
    category: String(meta.category ?? ""),
    deprecated: meta.deprecated === true,
    preview: meta.preview === true,
    effect,
    parameters,
  };
}

type Report = { problems: string[]; notices: string[] };

async function loadFramework(
  repo: string,
  config: FrameworkConfig,
  report: Report,
): Promise<{ framework: ComplianceFramework; controls: Map<string, string[]> }> {
  const dir = path.join(repo, "built-in-policies", "policySetDefinitions", "Regulatory Compliance");
  const versions = (await fs.readdir(dir))
    .map((file) => config.filePattern.exec(file)?.[1])
    .filter((v): v is string => Boolean(v))
    .sort(compareVersions);
  const latest = versions.at(-1);
  if (latest && compareVersions(latest, config.pinnedVersion) > 0) {
    report.notices.push(
      `${config.name} v${latest} initiative is available upstream; Bunya is pinned to v${config.pinnedVersion}. Review control renumbering before bumping \`pinnedVersion\` in scripts/compliance-sync.ts.`,
    );
  }
  const json = await readJson(path.join(dir, config.fileName(config.pinnedVersion)));
  const p = json.properties as Json;
  const prefix = config.groupPrefix(config.pinnedVersion);
  const controls = new Map<string, string[]>();
  for (const ref of (p.policyDefinitions ?? []) as Json[]) {
    const id = String(ref.policyDefinitionId).split("/").pop()!.toLowerCase();
    const groups = ((ref.groupNames ?? []) as string[])
      .filter((g) => g.startsWith(prefix))
      .map((g) => g.slice(prefix.length));
    controls.set(id, [...new Set([...(controls.get(id) ?? []), ...groups])].sort(compareControls));
  }
  return {
    framework: {
      id: config.id,
      name: config.name,
      shortName: config.shortName,
      version: config.pinnedVersion,
      initiativeId: String(json.name),
      initiativeVersion: String(p.version ?? (p.metadata as Json)?.version ?? "0.0.0"),
    },
    controls,
  };
}

function gitCommit(repo: string): string {
  try {
    return execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function render(
  commit: string,
  frameworks: ComplianceFramework[],
  metadata: Record<string, PolicyMetadata>,
): string {
  const lines = [
    "// Generated by `pnpm compliance:sync` from https://github.com/Azure/azure-policy (MIT).",
    "// Do not edit by hand. Contains policy identifiers and framework control IDs only.",
    'import type { ComplianceFramework, PolicyMetadata, PolicyMetadataSource } from "./types";',
    "",
    `export const POLICY_METADATA_SOURCE: PolicyMetadataSource = ${JSON.stringify(
      { repository: "https://github.com/Azure/azure-policy", commit, syncedAt: new Date().toISOString().slice(0, 10) },
      null,
      2,
    )};`,
    "",
    `export const COMPLIANCE_FRAMEWORKS: ComplianceFramework[] = ${JSON.stringify(frameworks, null, 2)};`,
    "",
    `export const POLICY_METADATA: Record<string, PolicyMetadata> = ${JSON.stringify(metadata, null, 2)};`,
    "",
  ];
  return lines.join("\n");
}

function checkCitations(index: Map<string, IndexedPolicy>, report: Report): void {
  const byName = new Map<string, Json>();
  for (const { properties } of index.values()) byName.set(String(properties.displayName), properties);
  for (const { rule } of REGISTRY) {
    if (rule.source.name !== "Azure Policy built-ins" || !rule.source.ruleId) continue;
    const cited = byName.get(rule.source.ruleId);
    if (!cited) {
      report.problems.push(`\`${rule.id}\` cites Azure Policy "${rule.source.ruleId}", which no longer exists under that display name.`);
    } else if ((cited.metadata as Json | undefined)?.deprecated === true && !rule.source.ruleId.startsWith("[Deprecated]")) {
      // Citations that already name the "[Deprecated]: ..." display name have
      // been reviewed; only report newly deprecated ones.
      report.notices.push(`\`${rule.id}\` cites Azure Policy "${rule.source.ruleId}", which is deprecated upstream.`);
    }
  }
}

async function main(): Promise<void> {
  const repo = arg("repo") ?? process.env.AZURE_POLICY_REPO;
  if (!repo) {
    console.error("[compliance] pass --repo <azure-policy checkout> or set AZURE_POLICY_REPO");
    process.exit(2);
  }
  const reportPath = arg("report");
  const report: Report = { problems: [], notices: [] };
  const index = await indexDefinitions(repo);
  console.log(`[compliance] indexed ${index.size} built-in policy definitions`);

  const frameworks: ComplianceFramework[] = [];
  const frameworkControls: { id: string; controls: Map<string, string[]> }[] = [];
  for (const config of FRAMEWORKS) {
    const loaded = await loadFramework(repo, config, report);
    frameworks.push(loaded.framework);
    frameworkControls.push({ id: config.id, controls: loaded.controls });
  }

  const ruleIds = new Set(REGISTRY.map((entry) => entry.rule.id));
  const metadata: Record<string, PolicyMetadata> = {};
  for (const alignment of [...POLICY_ALIGNMENTS].sort((a, b) => a.policyDefinitionId.localeCompare(b.policyDefinitionId))) {
    const id = alignment.policyDefinitionId.toLowerCase();
    for (const ruleId of alignment.ruleIds) {
      if (!ruleIds.has(ruleId)) report.problems.push(`Alignment for ${id} references unknown rule \`${ruleId}\`.`);
    }
    const policy = index.get(id);
    if (!policy) {
      report.problems.push(`Mapped policy ${id} no longer exists upstream.`);
      continue;
    }
    const base = toMetadata(policy);
    if (base.deprecated) report.problems.push(`Mapped policy ${id} ("${base.displayName}") is deprecated upstream.`);
    const controls: Record<string, string[]> = {};
    for (const { id: frameworkId, controls: map } of frameworkControls) {
      const ids = map.get(id);
      if (ids && ids.length > 0) controls[frameworkId] = ids;
    }
    metadata[id] = { ...base, controls };
  }

  checkCitations(index, report);

  // Only rewrite when the policy content changed, so the nightly job does not
  // open a pull request just to move the sync date or upstream commit.
  const next = render(gitCommit(repo), frameworks, metadata);
  const current = await fs.readFile(OUTPUT_PATH, "utf8").catch(() => "");
  const stable = (text: string) => text.replace(/"(commit|syncedAt)": "[^"]*"/g, "");
  if (stable(current) !== stable(next)) {
    await fs.writeFile(OUTPUT_PATH, next, "utf8");
    console.log(`[compliance] wrote ${path.relative(PROJECT_ROOT, OUTPUT_PATH)} (${Object.keys(metadata).length} policies)`);
  } else {
    console.log(`[compliance] ${path.relative(PROJECT_ROOT, OUTPUT_PATH)} is up to date (${Object.keys(metadata).length} policies)`);
  }

  const body = [
    "### Azure Policy compliance metadata",
    "",
    report.problems.length === 0 ? "- No problems found." : report.problems.map((p) => `- ❌ ${p}`).join("\n"),
    ...(report.notices.length > 0 ? ["", report.notices.map((n) => `- ℹ️ ${n}`).join("\n")] : []),
    "",
  ].join("\n");
  console.log(body);
  if (reportPath) await fs.writeFile(reportPath, body, "utf8");
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `attention=${report.problems.length + report.notices.length > 0}\n`);
  }
  process.exit(report.problems.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[compliance] crashed:", err);
  process.exit(1);
});
