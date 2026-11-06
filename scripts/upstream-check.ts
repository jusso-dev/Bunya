/**
 * Entry point for `pnpm upstream:check`.
 *
 * Read-only drift report for the things Bunya pins or depends on upstream:
 *   - rule sources with releases newer than their pin in lib/rules/registry.ts
 *   - an AzureRM provider major version newer than the Terraform generator's
 *     constraint
 *   - Azure retirement notices that mention a service Bunya models
 *   - hand-curated (MANUAL) sources that have not been reviewed recently
 *
 * Nothing is changed. Upstream releases need a human to re-curate rules, so
 * the nightly workflow publishes this report as a tracking issue.
 *
 * Usage: pnpm upstream:check [--report report.md] [--days 14] [--previous issue.md]
 *
 * `--days` only limits which retirement notices are new. Notices listed in the
 * previous report (`--previous`, the open tracking issue's body) are carried
 * forward until someone deletes them from the issue or closes it.
 * Set GITHUB_TOKEN to avoid GitHub API rate limits.
 */
import { promises as fs } from "node:fs";
import { RULE_BUNDLES } from "@/lib/rules/registry";
import { arg, run } from "./lib";

const AZURE_UPDATES_RSS = "https://www.microsoft.com/releasecommunications/api/v2/azure/rss";
const TERRAFORM_AZURERM_MAJOR = 4;
const MANUAL_REVIEW_DAYS = 180;

// Azure Updates product categories and title keywords for each modelled service.
const SERVICE_KEYWORDS = [
  "App Service",
  "Azure Functions",
  "Static Web Apps",
  "Azure Kubernetes Service",
  "AKS",
  "Virtual Machine Scale Sets",
  "Azure Blob Storage",
  "Azure Storage",
  "Storage Accounts",
  "Azure SQL Database",
  "Azure Cosmos DB",
  "Key Vault",
  "Container Registry",
  "Application Insights",
  "Log Analytics",
  "Azure Monitor",
  "Azure Front Door",
  "Application Gateway",
  "API Management",
  "Virtual Network",
  "Network Security Group",
  "Azure Private Link",
  "Private Endpoint",
  "Azure DNS",
  "Managed Identities",
  "Azure Policy",
];

async function github(pathname: string): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "bunya-upstream-check",
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com${pathname}`, { headers });
  if (!response.ok) throw new Error(`GET ${pathname} returned ${response.status}`);
  return response.json();
}

const normalise = (tag: string) => tag.replace(/^v/i, "").trim();

function newer(latest: string, pinned: string): boolean {
  const a = normalise(latest).split(/[.-]/).map((p) => Number.parseInt(p, 10));
  const b = normalise(pinned).split(/[.-]/).map((p) => Number.parseInt(p, 10));
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = Number.isNaN(a[i]) ? 0 : (a[i] ?? 0);
    const y = Number.isNaN(b[i]) ? 0 : (b[i] ?? 0);
    if (x !== y) return x > y;
  }
  return false;
}

async function checkReleases(lines: string[], errors: string[]): Promise<void> {
  for (const { slug, pin } of RULE_BUNDLES) {
    if (pin?.watch?.kind !== "github-release") continue;
    const { repo } = pin.watch;
    try {
      const release = (await github(`/repos/${repo}/releases/latest`)) as { tag_name: string; html_url: string };
      if (newer(release.tag_name, pin.version)) {
        lines.push(`- **${repo}** ${release.tag_name} is available; \`lib/rules/sources/${slug}\` is pinned to ${pin.version}. Review the [release notes](${release.html_url}) for new or changed Azure rules.`);
      }
    } catch (error) {
      errors.push(`${repo}: ${(error as Error).message}`);
    }
  }
}

async function checkAzureRm(lines: string[], errors: string[]): Promise<void> {
  try {
    const release = (await github("/repos/hashicorp/terraform-provider-azurerm/releases/latest")) as { tag_name: string; html_url: string };
    const major = Number.parseInt(normalise(release.tag_name), 10);
    if (major > TERRAFORM_AZURERM_MAJOR) {
      lines.push(`- **AzureRM provider** ${release.tag_name} is a new major version; the Terraform generator pins \`~> ${TERRAFORM_AZURERM_MAJOR}.0\`. Review the [upgrade guide](${release.html_url}) before bumping.`);
    }
  } catch (error) {
    errors.push(`terraform-provider-azurerm: ${(error as Error).message}`);
  }
}

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

// Feed titles go into a GitHub issue; keep them from mentioning users or
// linking issues.
function inert(text: string): string {
  return text.replace(/[[\]`]/g, "").replace(/([@#])/g, "$1\u200b");
}

async function checkRetirements(lines: string[], errors: string[], days: number): Promise<void> {
  try {
    const response = await fetch(AZURE_UPDATES_RSS, { headers: { "user-agent": "bunya-upstream-check" } });
    if (!response.ok) throw new Error(`returned ${response.status}`);
    const xml = await response.text();
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const categories = [...item.matchAll(/<category>([\s\S]*?)<\/category>/g)].map((m) => decode(m[1]));
      const title = decode(/<title>([\s\S]*?)<\/title>/.exec(item)?.[1] ?? "");
      const link = decode(/<link>([\s\S]*?)<\/link>/.exec(item)?.[1] ?? "");
      const published = Date.parse(decode(/<pubDate>([\s\S]*?)<\/pubDate>/.exec(item)?.[1] ?? "").replace(/ Z$/, " GMT"));
      if (!categories.includes("Retirements") && !/^retirement/i.test(title)) continue;
      if (!Number.isNaN(published) && published < since) continue;
      const haystack = [title, ...categories].join(" | ").toLowerCase();
      const matched = SERVICE_KEYWORDS.filter((k) => haystack.includes(k.toLowerCase()));
      if (matched.length === 0) continue;
      lines.push(`- [${inert(title)}](${link}) (${matched.join(", ")})`);
    }
  } catch (error) {
    errors.push(`Azure Updates feed: ${(error as Error).message}`);
  }
}

const RETIREMENTS_HEADING = "#### Azure retirements for modelled services";

/** Retirement lines from a previous report that are still unacknowledged. */
async function previousRetirements(file: string | undefined): Promise<string[]> {
  if (!file) return [];
  const text = await fs.readFile(file, "utf8").catch(() => "");
  const start = text.indexOf(RETIREMENTS_HEADING);
  if (start < 0) return [];
  const section = text.slice(start + RETIREMENTS_HEADING.length).split(/\n#{1,4} /)[0];
  return section.split("\n").filter((line) => /^- \[.+\]\(https:\/\/azure\.microsoft\.com\/updates\?id=\d+\)/.test(line));
}

const updateId = (line: string) => /updates\?id=(\d+)/.exec(line)?.[1] ?? line;

function checkManual(lines: string[]): void {
  for (const { slug, label, pin } of RULE_BUNDLES) {
    if (pin?.watch?.kind !== "manual-review") continue;
    const age = Math.floor((Date.now() - Date.parse(pin.reviewedAt)) / (24 * 60 * 60 * 1000));
    if (age > MANUAL_REVIEW_DAYS) {
      lines.push(`- **${label}** (\`${pin.version}\`) was last reviewed ${age} days ago. Check for a newer publication and update its pin in \`lib/rules/registry.ts\` (\`${slug}\`).`);
    }
  }
}

async function main(): Promise<void> {
  const reportPath = arg("report");
  const days = Number(arg("days") ?? 14);
  const releases: string[] = [];
  const retirements: string[] = [];
  const manual: string[] = [];
  const errors: string[] = [];

  await checkReleases(releases, errors);
  await checkAzureRm(releases, errors);
  await checkRetirements(retirements, errors, days);
  const seen = new Set(retirements.map(updateId));
  for (const line of await previousRetirements(arg("previous"))) {
    if (!seen.has(updateId(line))) retirements.push(line);
    seen.add(updateId(line));
  }
  checkManual(manual);

  const section = (title: string, items: string[], empty: string) => [`#### ${title}`, "", ...(items.length > 0 ? items : [`- ${empty}`]), ""];
  const body = [
    "### Upstream changes",
    "",
    ...section("Rule sources and providers", releases, "All pinned sources are current."),
    ...section(
      "Azure retirements for modelled services",
      retirements.length > 0
        ? [`_New notices from the last ${days} days are added; delete a line once it is handled._`, "", ...retirements]
        : [],
      "None.",
    ),
    ...section("Hand-curated sources due for review", manual, "None."),
    ...(errors.length > 0 ? section("Checks that could not run", errors.map((e) => `⚠️ ${e}`), "") : []),
  ].join("\n");
  console.log(body);
  if (reportPath) await fs.writeFile(reportPath, body, "utf8");
  // Signals "something needs attention" to the workflow without failing it.
  if (process.env.GITHUB_OUTPUT) {
    const total = releases.length + retirements.length + manual.length + errors.length;
    await fs.appendFile(process.env.GITHUB_OUTPUT, `attention=${total > 0}\n`);
  }
}

run("upstream", main);
