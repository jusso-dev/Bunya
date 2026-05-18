/**
 * Generates auto-derived coverage and gaps reports for the rules registry.
 *
 * Outputs:
 *   - docs/rules/COVERAGE.md — Coverage by service / category / source +
 *     a compliance framework mapping.
 *   - docs/rules/GAPS.md — Services with thin coverage, frameworks not yet
 *     ingested, categories with low counts, explicit out-of-scope items,
 *     and sources known to exist but not yet ingested (parsed best-effort
 *     from SOURCES.md when present).
 *
 * Both files are regenerated every run. `generateCoverage()` is invoked by
 * `scripts/import-rules/run.ts`; the file is also runnable directly
 * (`pnpm rules:coverage`).
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { allArmTypes, serviceTypeOf } from "@/lib/rules/mapping";
import type { Rule, RuleEntry } from "@/lib/rules/schema";
import { loadRegistry } from "./import-rules/loadRegistry";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = path.join(PROJECT_ROOT, "docs", "rules");
const COVERAGE_PATH = path.join(DOCS_DIR, "COVERAGE.md");
const GAPS_PATH = path.join(DOCS_DIR, "GAPS.md");
const SOURCES_MD_PATH = path.join(DOCS_DIR, "SOURCES.md");

const FRAMEWORK_PATTERNS: { framework: string; patterns: RegExp[] }[] = [
  { framework: "Australian ISM", patterns: [/\bism\b/i, /australian government information security/i] },
  { framework: "Essential Eight", patterns: [/essential[- ]eight/i, /e8/i] },
  { framework: "Microsoft Cloud Security Benchmark", patterns: [/mcsb/i, /cloud security benchmark/i] },
  { framework: "Well-Architected Framework", patterns: [/waf/i, /well[- ]architected/i] },
  { framework: "Azure Policy built-ins", patterns: [/azure[- ]policy/i, /policy[- ]builtin/i] },
  { framework: "PSRule for Azure", patterns: [/psrule/i] },
  { framework: "Checkov", patterns: [/checkov/i] },
  { framework: "Bicep types", patterns: [/bicep[- ]types?/i] },
  { framework: "Azure Naming Tool", patterns: [/azure[- ]naming/i, /naming[- ]tool/i] },
  { framework: "DTA Hosting Certification Framework", patterns: [/hosting certification/i, /\bhcf\b/i] },
];

const OUT_OF_SCOPE_FRAMEWORKS = [
  "CIS Microsoft Azure Foundations Benchmark",
  "PCI DSS",
  "HITRUST CSF",
];

const OUT_OF_SCOPE_TOPICS = [
  "runtime policy enforcement (drift detection at runtime)",
  "configuration drift between IaC and live Azure tenant",
  "cost prediction / forecasting",
  "multi-region failover orchestration",
  "DDoS pricing tier optimisation",
];

const CATEGORY_THIN_THRESHOLD = 5;
const SERVICE_THIN_THRESHOLD = 5;

type Counts = Map<string, number>;

function increment(map: Counts, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function countByService(rules: RuleEntry[]): Counts {
  const counts: Counts = new Map();
  for (const entry of rules) {
    const rule = entry.rule;
    const services = new Set<string>();
    for (const target of rule.appliesTo) {
      if (target === "graph") {
        services.add("graph");
        continue;
      }
      const svc = serviceTypeOf(target);
      services.add(svc ?? target);
    }
    for (const svc of services) increment(counts, svc);
  }
  return counts;
}

function countByCategory(rules: RuleEntry[]): Counts {
  const counts: Counts = new Map();
  for (const entry of rules) increment(counts, entry.rule.category);
  return counts;
}

function countBySource(rules: RuleEntry[]): Counts {
  const counts: Counts = new Map();
  for (const entry of rules) increment(counts, entry.rule.source.name);
  return counts;
}

function frameworkOf(rule: Rule): string[] {
  const haystack = [
    rule.source.name,
    rule.source.url,
    rule.source.ruleId ?? "",
    ...rule.tags,
  ]
    .filter(Boolean)
    .join(" ");
  const matches: string[] = [];
  for (const { framework, patterns } of FRAMEWORK_PATTERNS) {
    if (patterns.some((re) => re.test(haystack))) matches.push(framework);
  }
  return matches;
}

function countByFramework(rules: RuleEntry[]): Counts {
  const counts: Counts = new Map();
  for (const entry of rules) {
    for (const fw of frameworkOf(entry.rule)) increment(counts, fw);
  }
  return counts;
}

function table(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => "---").join(" | ");
  const head = headers.join(" | ");
  const body = rows.map((r) => r.join(" | ")).join("\n");
  return `| ${head} |\n| ${sep} |\n${rows.length > 0 ? body.split("\n").map((l) => `| ${l} |`).join("\n") : "| _no entries_ |".padEnd(0)}`;
}

function sortedRows(counts: Counts): string[][] {
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([key, value]) => [key, String(value)]);
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDocsDir(): Promise<void> {
  await fs.mkdir(DOCS_DIR, { recursive: true });
}

/**
 * Best-effort parse of SOURCES.md to extract sources classified `INGEST`
 * that do not yet have a corresponding `lib/rules/sources/<slug>/` folder.
 *
 * Heuristic: pair each `### <Name>` heading with the next
 * `- Classification: ...` bullet underneath it. If the classification
 * contains `INGEST`, slugify the name and check whether a matching folder
 * exists in `lib/rules/sources/`. Anything classified `INGEST (not yet
 * imported)` or otherwise unmatched is reported as a pending source.
 */
async function parseSourcesMd(): Promise<{ ingested: string[]; missing: string[] }> {
  if (!(await fileExists(SOURCES_MD_PATH))) {
    return { ingested: [], missing: [] };
  }
  const text = await fs.readFile(SOURCES_MD_PATH, "utf8");
  const lines = text.split(/\r?\n/);
  const sourcesRoot = path.join(PROJECT_ROOT, "lib", "rules", "sources");
  const existing = (await dirExists(sourcesRoot))
    ? new Set(await fs.readdir(sourcesRoot))
    : new Set<string>();

  const slugify = (name: string) =>
    name
      .toLowerCase()
      .replace(/\([^)]*\)/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  type Entry = { name: string; classification: string };
  const entries: Entry[] = [];
  let pendingHeading: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    const headingMatch = /^###\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      pendingHeading = headingMatch[1];
      continue;
    }
    if (pendingHeading && /^[-*]\s*Classification\s*:/i.test(line)) {
      const classification = line.replace(/^[-*]\s*Classification\s*:\s*/i, "");
      entries.push({ name: pendingHeading, classification });
      pendingHeading = null;
    }
  }

  // Match name to folder using a normalised compact form: lower-case
  // alphanumeric characters only, hyphens and other punctuation removed.
  // The compact form of "Azure Policy built-ins" -> "azurepolicybuiltins"
  // matches the folder "azure-policy-builtins" -> "azurepolicybuiltins".
  // For multi-word names we additionally require that every >=3-char,
  // non-stop-word token from the name appears as a substring of the
  // folder's compact form.
  const STOP = new Set(["for", "the", "and", "of", "a", "an"]);
  const tokenize = (slug: string) =>
    slug.split("-").filter((t) => t.length >= 3 && !STOP.has(t));
  const compact = (slug: string) => slug.replace(/-/g, "");

  const folderInfo = [...existing].map((folder) => ({
    folder,
    compact: compact(folder),
  }));

  const ingested: string[] = [];
  const missing: string[] = [];
  for (const { name, classification } of entries) {
    if (!/INGEST/i.test(classification)) continue;
    const slug = slugify(name);
    const tokens = tokenize(slug);
    const nameCompact = compact(slug);
    const isPending = /not yet imported/i.test(classification);
    const matched =
      !isPending &&
      (folderInfo.some(
        (info) =>
          info.compact === nameCompact ||
          info.compact.includes(nameCompact) ||
          nameCompact.includes(info.compact),
      ) ||
        (tokens.length > 0 &&
          folderInfo.some(({ compact: fc }) =>
            tokens.every((t) => fc.includes(t)),
          )));
    if (matched) {
      ingested.push(name);
    } else {
      missing.push(isPending ? `${name} — ${classification}` : name);
    }
  }
  return { ingested, missing };
}

function renderCoverage(
  rules: RuleEntry[],
  sourceCount: number,
  serviceCounts: Counts,
  categoryCounts: Counts,
  sourceNameCounts: Counts,
  frameworkCounts: Counts,
): string {
  const allServices = new Set<string>([
    "graph",
    ...allArmTypes().map((arm) => serviceTypeOf(arm) ?? arm),
  ]);
  // Ensure every known service appears in the table (with 0 if missing) so
  // gap analysis is meaningful even when a service has no rules.
  for (const svc of allServices) {
    if (!serviceCounts.has(svc)) serviceCounts.set(svc, 0);
  }

  const serviceRows = sortedRows(serviceCounts);
  const categoryRows = sortedRows(categoryCounts);
  const sourceRows = sortedRows(sourceNameCounts);
  const frameworkRows = sortedRows(frameworkCounts);

  const sections = [
    `# Rules Coverage`,
    ``,
    `_Generated ${isoDate()} from ${rules.length} rules across ${sourceCount} sources._`,
    ``,
    `> This file is auto-generated by \`pnpm rules:coverage\`. Do not edit by hand.`,
    ``,
    `## Coverage by service`,
    ``,
    table(["Service", "Rules"], serviceRows),
    ``,
    `## Coverage by category`,
    ``,
    table(["Category", "Rules"], categoryRows),
    ``,
    `## Coverage by source`,
    ``,
    table(["Source", "Rules"], sourceRows),
    ``,
    `## Compliance framework mapping`,
    ``,
    table(["Framework", "Rules"], frameworkRows),
    ``,
  ];
  return sections.join("\n");
}

function renderGaps(
  rules: RuleEntry[],
  serviceCounts: Counts,
  categoryCounts: Counts,
  frameworkCounts: Counts,
  pendingSources: string[],
): string {
  const thinServices = [...serviceCounts.entries()]
    .filter(([, count]) => count < SERVICE_THIN_THRESHOLD)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

  const thinCategories = [...categoryCounts.entries()]
    .filter(([, count]) => count < CATEGORY_THIN_THRESHOLD)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

  // The hardcoded list IS the OUT_OF_SCOPE_FRAMEWORKS catalogue, with one
  // concise rationale per entry. Filtering against frameworkCounts is
  // defensive — we never want CIS/PCI/HITRUST to appear in the matched
  // set, but if a rule somehow tags itself with one of these names we still
  // want it surfaced as a gap rather than counted as coverage.
  const FRAMEWORK_RATIONALE: Record<string, string> = {
    "CIS Microsoft Azure Foundations Benchmark":
      "commercial, not redistributable",
    "PCI DSS": "commercial standard; out of project licence scope",
    "HITRUST CSF":
      "commercial; not in scope for Australian-government workloads",
  };
  const missingFrameworks = OUT_OF_SCOPE_FRAMEWORKS.filter(
    (fw) => !frameworkCounts.has(fw),
  );

  const sections: string[] = [
    `# Rules Coverage Gaps`,
    ``,
    `_Generated ${isoDate()} from ${rules.length} rules._`,
    ``,
    `> This file is auto-generated by \`pnpm rules:coverage\`. Do not edit by hand.`,
    ``,
    `## Services with <${SERVICE_THIN_THRESHOLD} rules`,
    ``,
    thinServices.length === 0
      ? `- _no thinly-covered services_`
      : thinServices.map(([svc, count]) => `- **${svc}** — ${count} rule${count === 1 ? "" : "s"}`).join("\n"),
    ``,
    `## Compliance frameworks not yet ingested`,
    ``,
    ...missingFrameworks.map(
      (fw) => `- ${fw} — ${FRAMEWORK_RATIONALE[fw] ?? "out-of-scope"}`,
    ),
    ``,
    `## Categories with thin coverage`,
    ``,
    thinCategories.length === 0
      ? `- _no thinly-covered categories_`
      : thinCategories.map(([cat, count]) => `- **${cat}** — ${count} rule${count === 1 ? "" : "s"}`).join("\n"),
    ``,
    `## Out-of-scope topics`,
    ``,
    ...OUT_OF_SCOPE_TOPICS.map((topic) => `- ${topic}`),
    ``,
    `## Sources known to exist but not yet ingested`,
    ``,
    pendingSources.length === 0
      ? `- tfsec / Trivy IaC — Apache-2.0 — TODO: add a sources/ folder\n- KICS Azure queries — Apache-2.0 — TODO: add a sources/ folder\n- TFLint AzureRM ruleset — MPL-2.0 — TODO: add a sources/ folder`
      : pendingSources.map((s) => `- ${s}`).join("\n"),
    ``,
  ];

  return sections.join("\n");
}

export async function generateCoverage(rules?: RuleEntry[]): Promise<void> {
  let allRules: RuleEntry[];
  let sourceCount: number;

  if (rules) {
    allRules = rules;
    const sourceNames = new Set(allRules.map((r) => r.rule.source.name));
    sourceCount = sourceNames.size;
  } else {
    const loaded = await loadRegistry({ tolerant: true });
    allRules = loaded.rules;
    sourceCount = loaded.sources.length;
    if (loaded.errors.length > 0) {
      for (const { folder, error } of loaded.errors) {
        console.warn(`[coverage] skipped source ${folder}: ${error}`);
      }
    }
  }

  const serviceCounts = countByService(allRules);
  const categoryCounts = countByCategory(allRules);
  const sourceNameCounts = countBySource(allRules);
  const frameworkCounts = countByFramework(allRules);

  await ensureDocsDir();

  const coverage = renderCoverage(
    allRules,
    sourceCount,
    serviceCounts,
    categoryCounts,
    sourceNameCounts,
    frameworkCounts,
  );
  await fs.writeFile(COVERAGE_PATH, coverage, "utf8");

  const { missing: pendingSources } = await parseSourcesMd();
  const gaps = renderGaps(
    allRules,
    serviceCounts,
    categoryCounts,
    frameworkCounts,
    pendingSources,
  );
  await fs.writeFile(GAPS_PATH, gaps, "utf8");
}

async function main(): Promise<void> {
  await generateCoverage();
  console.log(`[coverage] wrote ${path.relative(PROJECT_ROOT, COVERAGE_PATH)}`);
  console.log(`[coverage] wrote ${path.relative(PROJECT_ROOT, GAPS_PATH)}`);
}

const isMain = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("[coverage] crashed:", err);
    process.exit(1);
  });
}
