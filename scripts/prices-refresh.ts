/**
 * Refreshes Bunya's offline pricing snapshot from the Azure Retail Prices API.
 *
 *   pnpm prices:refresh
 *
 * The API is unauthenticated, paginated, and supports OData filters. We pull
 * one armRegionName=australiaeast page per meter we care about, derive monthly
 * figures, and write a JSON snapshot under `lib/pricing/data/prices.json` plus
 * an audit trail to `scripts/prices-refresh.log.json`.
 *
 * No app code reads `lib/pricing/data/prices.json` at runtime; it is consumed
 * only by `lib/pricing/data.ts` updates. Treat this script as a tool that
 * suggests price diffs for the human to apply.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "lib", "pricing", "data");
const SNAPSHOT_PATH = path.join(DATA_DIR, "prices.json");
const LOG_PATH = path.join(__dirname, "prices-refresh.log.json");

const REGION = "australiaeast";
const API = "https://prices.azure.com/api/retail/prices";

type Meter = {
  bunyaKey: string;
  filter: string;
  multiplier?: number;
  note?: string;
};

// Keep this list narrow. Each meter is one Retail Prices API filter.
const METERS: Meter[] = [
  {
    bunyaKey: "appServicePlan.B1",
    filter: `serviceName eq 'Azure App Service' and skuName eq 'B1' and armRegionName eq '${REGION}' and priceType eq 'Consumption'`,
    multiplier: 730,
    note: "Basic B1 hourly * 730h",
  },
  {
    bunyaKey: "appServicePlan.S1",
    filter: `serviceName eq 'Azure App Service' and skuName eq 'S1' and armRegionName eq '${REGION}' and priceType eq 'Consumption'`,
    multiplier: 730,
  },
  {
    bunyaKey: "appServicePlan.P1v3",
    filter: `serviceName eq 'Azure App Service' and skuName eq 'P1 v3' and armRegionName eq '${REGION}' and priceType eq 'Consumption'`,
    multiplier: 730,
  },
  {
    bunyaKey: "storageAccount.Standard_LRS",
    filter: `serviceName eq 'Storage' and skuName eq 'Standard LRS' and armRegionName eq '${REGION}' and meterName eq 'Hot LRS Data Stored'`,
    multiplier: 100,
    note: "100GB Hot Blob LRS",
  },
  {
    bunyaKey: "keyVault.standard",
    filter: `serviceName eq 'Key Vault' and skuName eq 'A1 Standard' and armRegionName eq '${REGION}'`,
    multiplier: 10,
    note: "~10k operations / month",
  },
  {
    bunyaKey: "sqlDatabase.S0",
    filter: `serviceName eq 'SQL Database' and skuName eq 'Standard' and armRegionName eq '${REGION}' and productName eq 'SQL DB Single Standard S0'`,
    multiplier: 730,
  },
];

type Result = {
  bunyaKey: string;
  monthlyUsd: number | null;
  unitPrice: number | null;
  meterName?: string;
  note?: string;
  filter: string;
  error?: string;
};

async function fetchMeter(meter: Meter): Promise<Result> {
  const url = `${API}?$filter=${encodeURIComponent(meter.filter)}&$top=1`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      return {
        bunyaKey: meter.bunyaKey,
        monthlyUsd: null,
        unitPrice: null,
        filter: meter.filter,
        error: `HTTP ${res.status}`,
      };
    }
    const body = (await res.json()) as { Items?: Array<{ unitPrice?: number; retailPrice?: number; meterName?: string }> };
    const item = body.Items?.[0];
    if (!item) {
      return {
        bunyaKey: meter.bunyaKey,
        monthlyUsd: null,
        unitPrice: null,
        filter: meter.filter,
        error: "no items returned",
      };
    }
    const unit = item.retailPrice ?? item.unitPrice ?? null;
    if (unit === null) {
      return {
        bunyaKey: meter.bunyaKey,
        monthlyUsd: null,
        unitPrice: null,
        meterName: item.meterName,
        filter: meter.filter,
        error: "missing price field",
      };
    }
    const monthly = unit * (meter.multiplier ?? 1);
    return {
      bunyaKey: meter.bunyaKey,
      monthlyUsd: Number(monthly.toFixed(2)),
      unitPrice: unit,
      meterName: item.meterName,
      note: meter.note,
      filter: meter.filter,
    };
  } catch (err) {
    return {
      bunyaKey: meter.bunyaKey,
      monthlyUsd: null,
      unitPrice: null,
      filter: meter.filter,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const force = process.argv.includes("--force");
  console.log(`[prices] querying ${METERS.length} meters against ${API} (${REGION})…`);
  const results: Result[] = [];
  for (const meter of METERS) {
    const result = await fetchMeter(meter);
    results.push(result);
    if (result.error) {
      console.warn(`[prices] ${meter.bunyaKey}: ${result.error}`);
    } else {
      console.log(
        `[prices] ${meter.bunyaKey}: $${result.monthlyUsd?.toFixed(2)} / month (unit $${result.unitPrice?.toFixed(4)})`,
      );
    }
  }
  const snapshot = {
    refreshedAt: new Date().toISOString(),
    region: REGION,
    source: API,
    results,
  };
  await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), "utf8");
  await fs.writeFile(LOG_PATH, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(`[prices] wrote ${SNAPSHOT_PATH}`);
  console.log(`[prices] review the diff against \`lib/pricing/data.ts\` and update by hand.`);
  if (force) console.log(`[prices] --force noted (no caching layer to bypass yet).`);
}

void main();
