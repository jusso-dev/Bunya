/**
 * Entry point for `pnpm upstream:check`.
 *
 * Read-only drift report for the things Bunya pins or depends on upstream:
 *   - rule sources with releases newer than their pinned.json
 *   - an AzureRM provider major version newer than the Terraform generator's
 *     constraint
 *   - Azure retirement notices that mention a service Bunya models
 *   - hand-curated (MANUAL) sources that have not been reviewed recently
 *
 * Nothing is changed. Upstream releases need a human to re-curate rules, so
 * the nightly workflow publishes this report as a tracking issue.
 *
 * Usage: pnpm upstream:check [--report report.md] [--days 14]
 * Set GITHUB_TOKEN to avoid GitHub API rate limits.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const SOURCES_DIR = path.join(PROJECT_ROOT, "lib", "rules", "sources");
const AZURE_UPDATES_RSS = "https://www.microsoft.com/releasecommunications/api/v2/azure/rss";
const TERRAFORM_AZURERM_MAJOR = 4;
const MANUAL_REVIEW_DAYS = 180;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

type Release = { repo: string; folder: string; key?: string };

const RELEASE_PINS: Release[] = [
  { repo: "Azure/PSRule.Rules.Azure", folder: "psrule-azure" },
  { repo: "bridgecrewio/checkov", folder: "checkov-azure" },
  { repo: "mspnp/AzureNamingTool", folder: "azure-naming-tool" },
];

// Hand-curated sources whose upstream has no machine-readable release feed.
const MANUAL_PINS: { folder: string; label: string; field: string }[] = [
  { folder: "ism", label: "Australian ISM", field: "release" },
  { folder: "essential-eight", label: "Essential Eight Maturity Model", field: "release" },
  { folder: "private-link-faq", label: "Azure Private Link FAQ", field: "revision" },
  { folder: "well-known-patterns", label: "Azure Architecture Center patterns", field: "revision" },
];

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

async function pinned(folder: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(SOURCES_DIR, folder, "pinned.json"), "utf8")) as Record<string, unknown>;
}

async function checkReleases(lines: string[], errors: string[]): Promise<void> {
  for (const pin of RELEASE_PINS) {
    try {
      const current = String((await pinned(pin.folder)).commit ?? "");
      const release = (await github(`/repos/${pin.repo}/releases/latest`)) as { tag_name: string; html_url: string };
      if (newer(release.tag_name, current)) {
        lines.push(`- **${pin.repo}** ${release.tag_name} is available; \`lib/rules/sources/${pin.folder}\` is pinned to ${current}. Review the [release notes](${release.html_url}) for new or changed Azure rules.`);
      }
    } catch (error) {
      errors.push(`${pin.repo}: ${(error as Error).message}`);
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

async function checkManual(lines: string[]): Promise<void> {
  for (const pin of MANUAL_PINS) {
    const data = await pinned(pin.folder);
    const fetchedAt = Date.parse(String(data.fetched_at ?? ""));
    if (Number.isNaN(fetchedAt)) continue;
    const age = Math.floor((Date.now() - fetchedAt) / (24 * 60 * 60 * 1000));
    if (age > MANUAL_REVIEW_DAYS) {
      lines.push(`- **${pin.label}** (\`${String(data[pin.field] ?? "unpinned")}\`) was last reviewed ${age} days ago. Check for a newer publication and update \`lib/rules/sources/${pin.folder}/pinned.json\`.`);
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
  await checkManual(manual);

  const section = (title: string, items: string[], empty: string) => [`#### ${title}`, "", ...(items.length > 0 ? items : [`- ${empty}`]), ""];
  const body = [
    "### Upstream changes",
    "",
    ...section("Rule sources and providers", releases, "All pinned sources are current."),
    ...section(`Azure retirements for modelled services (last ${days} days)`, retirements, "None."),
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

main().catch((err) => {
  console.error("[upstream] crashed:", err);
  process.exit(1);
});
