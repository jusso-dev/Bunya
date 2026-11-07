/**
 * Entry point for `pnpm prices:refresh`.
 *
 * Read-only drift check of Bunya's App Service and Functions prices against
 * the Azure Retail Prices API (Linux, pay-as-you-go, Australia East). The
 * API is unauthenticated. Nothing in lib/ is changed: prices are reviewed and
 * applied to lib/pricing/data.ts by hand, so a bad API response can never
 * reach the site.
 *
 * Usage: pnpm prices:refresh [--report report.md] [--tolerance 0.02]
 *
 * Exit codes: 0 when the check ran (drift or not), 1 when the API could not
 * be read. In GitHub Actions `attention=true` is written to GITHUB_OUTPUT
 * when any price drifted beyond the tolerance or could not be found.
 */
import { promises as fs } from "node:fs";
import { PRICE_BOOK } from "../lib/pricing/data";
import { arg, run } from "./lib";

const REGION = "australiaeast";
const API = "https://prices.azure.com/api/retail/prices";
const HOURS_PER_MONTH = 730;

type RetailItem = {
  skuName?: string;
  productName?: string;
  meterName?: string;
  retailPrice?: number;
  unitOfMeasure?: string;
  type?: string;
  tierMinimumUnits?: number;
};

async function fetchAll(filter: string): Promise<RetailItem[]> {
  const items: RetailItem[] = [];
  let url: string | null = `${API}?$filter=${encodeURIComponent(filter)}`;
  // The API pages at 100 items; App Service in one region is a few pages.
  for (let page = 0; url && page < 20; page++) {
    const response = await fetch(url, { headers: { Accept: "application/json", "user-agent": "bunya-prices-refresh" } });
    if (!response.ok) throw new Error(`GET ${API} returned ${response.status}`);
    const body = (await response.json()) as { Items?: RetailItem[]; NextPageLink?: string | null };
    items.push(...(body.Items ?? []));
    url = body.NextPageLink ?? null;
  }
  return items;
}

// Bunya SKU -> Retail Prices API skuName on the "- Linux" App Service products.
const PLAN_SKUS: Record<string, string> = {
  B1: "B1", B2: "B2", B3: "B3",
  S1: "S1", S2: "S2", S3: "S3",
  P1v2: "P1 v2", P2v2: "P2 v2", P3v2: "P3 v2",
  P0v3: "P0v3", P1v3: "P1 v3", P2v3: "P2 v3", P3v3: "P3 v3",
};

// Functions Premium instance sizes: vCPU and GiB per EP SKU.
const ELASTIC: Record<string, { vcpu: number; gib: number }> = {
  EP1: { vcpu: 1, gib: 3.5 },
  EP2: { vcpu: 2, gib: 7 },
  EP3: { vcpu: 4, gib: 14 },
};

type Row = { key: string; current: number; live: number | null; detail: string };

async function main() {
  const reportPath = arg("report");
  const tolerance = Number(arg("tolerance") ?? 0.02);
  const rows: Row[] = [];
  let failed = false;
  try {
    const appService = await fetchAll(
      `serviceName eq 'Azure App Service' and armRegionName eq '${REGION}' and priceType eq 'Consumption'`,
    );
    for (const [sku, apiSku] of Object.entries(PLAN_SKUS)) {
      const item = appService.find(
        (candidate) =>
          candidate.skuName === apiSku &&
          candidate.productName?.endsWith("- Linux") &&
          candidate.unitOfMeasure === "1 Hour" &&
          candidate.type === "Consumption",
      );
      const live = item?.retailPrice !== undefined ? Number((item.retailPrice * HOURS_PER_MONTH).toFixed(2)) : null;
      rows.push({ key: `appServicePlan.${sku}`, current: PRICE_BOOK[`appServicePlan.${sku}`]?.monthlyUsd ?? NaN, live, detail: item ? `${item.productName} ${item.skuName} $${item.retailPrice}/h` : "not found" });
    }

    const functions = await fetchAll(`serviceName eq 'Functions' and armRegionName eq '${REGION}' and priceType eq 'Consumption'`);
    const meter = (name: string) => functions.find((item) => item.productName === "Premium Functions" && item.meterName === name)?.retailPrice;
    const vcpu = meter("Premium vCPU Duration");
    const memory = meter("Premium Memory Duration");
    for (const [sku, size] of Object.entries(ELASTIC)) {
      const live = vcpu !== undefined && memory !== undefined
        ? Number(((size.vcpu * vcpu + size.gib * memory) * HOURS_PER_MONTH).toFixed(2))
        : null;
      rows.push({ key: `appServicePlan.${sku}`, current: PRICE_BOOK[`appServicePlan.${sku}`]?.monthlyUsd ?? NaN, live, detail: live === null ? "not found" : `${size.vcpu} vCPU x $${vcpu}/h + ${size.gib} GiB x $${memory}/h` });
    }
  } catch (error) {
    failed = true;
    console.error(`[prices] ${error instanceof Error ? error.message : String(error)}`);
  }

  const drifted = rows.filter(
    (row) => row.live === null || !Number.isFinite(row.current) || Math.abs(row.live - row.current) > Math.max(0.01, row.current * tolerance),
  );
  const lines = ["### Azure retail prices (App Service and Functions, Linux, Australia East)", ""];
  if (failed) {
    lines.push("- ❌ Could not read the Azure Retail Prices API; see the run log.");
  } else if (drifted.length === 0) {
    lines.push(`- ✅ ${rows.length} prices in \`lib/pricing/data.ts\` match the Retail Prices API within ${(tolerance * 100).toFixed(0)}%.`);
  } else {
    lines.push(`- ⚠️ ${drifted.length} of ${rows.length} prices drifted. Update \`lib/pricing/data.ts\` and \`APP_SERVICE_PRICE_SNAPSHOT_DATE\` by hand:`, "");
    lines.push("| Price key | Bunya (USD/month) | Live (USD/month) | Source |", "| --- | --- | --- | --- |");
    for (const row of drifted) {
      lines.push(`| \`${row.key}\` | ${Number.isFinite(row.current) ? row.current.toFixed(2) : "missing"} | ${row.live === null ? "not found" : row.live.toFixed(2)} | ${row.detail} |`);
    }
  }
  const body = `${lines.join("\n")}\n`;
  if (reportPath) await fs.writeFile(reportPath, body, "utf8");
  else console.log(body);
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `attention=${failed || drifted.length > 0}\n`);
  }
  process.exit(failed ? 1 : 0);
}

run("prices", main);
