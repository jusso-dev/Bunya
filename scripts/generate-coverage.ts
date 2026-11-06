/**
 * Entry point for `pnpm rules:coverage`. Regenerates project-docs/rules/COVERAGE.md
 * and GAPS.md from the rule registry, and lists sources SOURCES.md classifies
 * INGEST that have no rule bundle yet.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { SERVICE_TYPES } from "@/lib/graph/schema";
import {
  COMPLIANCE_FRAMEWORKS,
  POLICY_METADATA_SOURCE,
  ruleAlignments,
} from "@/lib/rules/compliance";
import { REGISTRY, RULE_BUNDLES } from "@/lib/rules/registry";
import type { Rule, RuleEntry } from "@/lib/rules/schema";
import { PROJECT_ROOT, run } from "./lib";

const DOCS_DIR = path.join(PROJECT_ROOT, "project-docs", "rules");
const COVERAGE_PATH = path.join(DOCS_DIR, "COVERAGE.md");
const GAPS_PATH = path.join(DOCS_DIR, "GAPS.md");
const SOURCES_MD_PATH = path.join(DOCS_DIR, "SOURCES.md");

const FRAMEWORK_PATTERNS: { framework: string; patterns: RegExp[] }[] = [
  { framework: "Australian ISM", patterns: [/\bism\b/i, /australian government information security/i] },
  { framework: "Essential Eight", patterns: [/essential[- ]eight/i, /\be8\b/i] },
  { framework: "Microsoft Cloud Security Benchmark", patterns: [/mcsb/i, /cloud security benchmark/i] },
  // Not /waf/: that also matches Web Application Firewall rules.
  { framework: "Well-Architected Framework", patterns: [/well[- ]architected/i] },
  { framework: "DTA Hosting Certification Framework", patterns: [/hosting certification/i, /\bhcf\b/i] },
];

const ISSUES = "https://github.com/jusso-dev/Bunya/issues";

const OUT_OF_SCOPE_TOPICS = [
  `runtime policy enforcement (drift detection at runtime) — needs tenant credentials, polling and a backend; Bunya stays design-time and exports an audit-only Azure Policy initiative instead ([#8](${ISSUES}/8))`,
  `configuration drift between IaC and live Azure tenant — same reason as runtime enforcement; Azure Policy, Defender for Cloud and CSPM tools own this ([#8](${ISSUES}/8))`,
  `AWS and GCP support — the catalogue, edge semantics, rules and generators are built on Azure's resource model ([#10](${ISSUES}/10))`,
  "cost prediction / forecasting — Bunya shows indicative retail estimates only",
  "multi-region failover orchestration",
  "DDoS pricing tier optimisation",
];

const CATEGORY_THIN_THRESHOLD = 5;
const SERVICE_THIN_THRESHOLD = 5;

type Counts = Map<string, number>;

function increment(map: Counts, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

// Every service is listed, with 0 when no rule covers it, so gaps show up.
function countByService(rules: RuleEntry[]): Counts {
  const counts: Counts = new Map(["graph", ...SERVICE_TYPES].map((service) => [service, 0]));
  for (const entry of rules) {
    for (const target of new Set(entry.rule.appliesTo)) increment(counts, target);
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

/**
 * SOURCES.md entries classified INGEST that no rule bundle in
 * lib/rules/registry.ts carries yet. Each `### <Name>` heading is paired with
 * the `- Classification:` bullet below it; the name must equal a bundle label.
 */
async function pendingSources(): Promise<string[]> {
  const text = await fs.readFile(SOURCES_MD_PATH, "utf8");
  const labels = new Set(RULE_BUNDLES.map((bundle) => bundle.label));
  const pending: string[] = [];
  let heading: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const headingMatch = /^###\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      heading = headingMatch[1];
      continue;
    }
    if (!heading || !/^[-*]\s*Classification\s*:/i.test(line)) continue;
    const classification = line.replace(/^[-*]\s*Classification\s*:\s*/i, "");
    if (/INGEST/i.test(classification) && (/not yet imported/i.test(classification) || !labels.has(heading))) {
      pending.push(`${heading} — ${classification}`);
    }
    heading = null;
  }
  return pending;
}

function renderCoverage(rules: RuleEntry[], serviceCounts: Counts, categoryCounts: Counts): string {
  const serviceRows = sortedRows(serviceCounts);
  const categoryRows = sortedRows(categoryCounts);
  const bundleRows = RULE_BUNDLES.map((bundle) => [bundle.label, `\`${bundle.slug}\``, bundle.pin?.version ?? "", String(bundle.rules.length)]);
  const sourceRows = sortedRows(countBySource(rules));
  const frameworkRows = sortedRows(countByFramework(rules));

  const sections = [
    `# Rules Coverage`,
    ``,
    `_Generated ${isoDate()} from ${rules.length} rules across ${RULE_BUNDLES.length} bundles._`,
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
    `## Coverage by bundle`,
    ``,
    table(["Bundle", "Folder", "Pinned", "Rules"], bundleRows),
    ``,
    `## Coverage by cited source`,
    ``,
    table(["Source", "Rules"], sourceRows),
    ``,
    `## Compliance framework mapping`,
    ``,
    table(["Framework", "Rules"], frameworkRows),
    ``,
    ...renderAlignment(rules),
  ];
  return sections.join("\n");
}

function renderAlignment(rules: RuleEntry[]): string[] {
  const sections: string[] = [];
  for (const framework of COMPLIANCE_FRAMEWORKS) {
    const byControl = new Map<string, Set<string>>();
    for (const entry of rules) {
      for (const a of ruleAlignments(entry.rule.id)) {
        if (a.framework.id !== framework.id) continue;
        const set = byControl.get(a.controlId) ?? new Set<string>();
        set.add(entry.rule.id);
        byControl.set(a.controlId, set);
      }
    }
    const rows = [...byControl.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
      .map(([control, ids]) => [control, String(ids.size), [...ids].sort().map((id) => `\`${id}\``).join(", ")]);
    sections.push(
      `## ${framework.name} v${framework.version} alignment`,
      ``,
      `Control IDs come from Microsoft's Azure Policy regulatory-compliance initiative \`${framework.initiativeId}\` (v${framework.initiativeVersion}, [Azure/azure-policy](${POLICY_METADATA_SOURCE.repository}) commit \`${POLICY_METADATA_SOURCE.commit.slice(0, 12)}\`). A rule is aligned with a control when it checks the same setting as a built-in policy Microsoft groups under that control. Alignment is not compliance, and no benchmark text is included.`,
      ``,
      table(["Control", "Rules", "Rule IDs"], rows),
      ``,
    );
  }
  return sections;
}

function renderGaps(
  rules: RuleEntry[],
  serviceCounts: Counts,
  categoryCounts: Counts,
  pendingSources: string[],
): string {
  const thinServices = [...serviceCounts.entries()]
    .filter(([, count]) => count < SERVICE_THIN_THRESHOLD)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

  const thinCategories = [...categoryCounts.entries()]
    .filter(([, count]) => count < CATEGORY_THIN_THRESHOLD)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

  // Scope decisions for frameworks Bunya does not ingest. CIS is listed even
  // though rules carry CIS control IDs: alignment is not ingestion.
  const cisAligned = rules.filter((entry) =>
    ruleAlignments(entry.rule.id).some((a) => a.framework.id === "cis-azure"),
  ).length;
  const cis = COMPLIANCE_FRAMEWORKS.find((f) => f.id === "cis-azure");
  const frameworkDecisions = [
    `- CIS Microsoft Azure Foundations Benchmark — CIS licence terms do not permit redistribution in Bunya. Benchmark text is never ingested. ${cisAligned} rules are tagged \`cis-azure-v${cis?.version ?? "?"}:<control>\` through Microsoft's Azure Policy regulatory-compliance mapping, shown as "aligned", never "compliant" ([#5](${ISSUES}/5))`,
    `- PCI DSS — permanently out of scope. Bunya does not check PCI DSS and adds no PCI tags; use a QSA, not a diagram tool ([#6](${ISSUES}/6))`,
    `- HITRUST CSF — won't fix. Commercial, US-healthcare-centric and outside the Australian-government audience ([#7](${ISSUES}/7))`,
  ];

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
    `## Compliance frameworks not ingested`,
    ``,
    ...frameworkDecisions,
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
    pendingSources.length === 0 ? `- _none_` : pendingSources.map((s) => `- ${s}`).join("\n"),
    ``,
  ];

  return sections.join("\n");
}

async function main(): Promise<void> {
  const serviceCounts = countByService(REGISTRY);
  const categoryCounts = countByCategory(REGISTRY);
  await fs.writeFile(COVERAGE_PATH, renderCoverage(REGISTRY, serviceCounts, categoryCounts), "utf8");
  await fs.writeFile(GAPS_PATH, renderGaps(REGISTRY, serviceCounts, categoryCounts, await pendingSources()), "utf8");
  console.log(`[coverage] wrote ${path.relative(PROJECT_ROOT, COVERAGE_PATH)}`);
  console.log(`[coverage] wrote ${path.relative(PROJECT_ROOT, GAPS_PATH)}`);
}

run("coverage", main);
