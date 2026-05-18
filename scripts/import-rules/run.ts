/**
 * Entry point for `pnpm rules:import`.
 *
 * For every directory under `lib/rules/sources/`:
 *   1. Refuses to run if `pinned.json` is missing (logs `[abort]` and exits 2).
 *   2. Dynamically imports `import.ts` and calls its exported `import*` fn.
 *   3. Collects { folder, count } rows for the summary table.
 *
 * After all sources are imported:
 *   - Prints `[summary] N sources, M total rules` to stdout.
 *   - Prints a per-source counts table.
 *   - Invokes `verify()`; exits non-zero if verification fails.
 *   - Invokes `generateCoverage()` to refresh COVERAGE.md and GAPS.md.
 *
 * Network access is NOT required: each `import.ts` re-exports its
 * `generated.ts` so reading the array is enough.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RuleEntry } from "@/lib/rules/schema";
import { verify } from "./verify";
import { generateCoverage } from "../generate-coverage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SOURCES_DIR = path.join(PROJECT_ROOT, "lib", "rules", "sources");

type SourceRow = {
  folder: string;
  count: number;
  status: "ok" | "skipped" | "failed";
  note?: string;
};

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

async function listFolders(dir: string): Promise<string[]> {
  if (!(await dirExists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function isImportFunction(value: unknown): value is () => Promise<{
  count: number;
  rules: RuleEntry[];
}> {
  return typeof value === "function";
}

async function importSource(folder: string): Promise<{
  count: number;
  rules: RuleEntry[];
}> {
  const importPath = path.join(SOURCES_DIR, folder, "import.ts");
  if (!(await fileExists(importPath))) {
    throw new Error(`missing import.ts`);
  }
  const mod = (await import(pathToFileURL(importPath).href)) as Record<string, unknown>;
  const fnEntry = Object.entries(mod).find(
    ([key, value]) => key.startsWith("import") && isImportFunction(value),
  );
  if (!fnEntry) throw new Error(`no exported import* function`);
  const result = await (fnEntry[1] as () => Promise<{
    count: number;
    rules: RuleEntry[];
  }>)();
  if (!result || !Array.isArray(result.rules)) {
    throw new Error(`import* did not return { count, rules }`);
  }
  return result;
}

function printTable(rows: SourceRow[]): void {
  const headers = ["Source", "Rules", "Status", "Note"];
  const data: string[][] = rows.map((r) => [
    r.folder,
    String(r.count),
    r.status,
    r.note ?? "",
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((row) => row[i].length)),
  );
  const fmt = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(fmt(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of data) console.log(fmt(row));
}

async function main(): Promise<void> {
  if (!(await dirExists(SOURCES_DIR))) {
    console.error(`[abort] sources directory not found at ${SOURCES_DIR}`);
    process.exit(2);
  }

  const folders = await listFolders(SOURCES_DIR);
  if (folders.length === 0) {
    console.warn(`[warn] no source folders under ${SOURCES_DIR}`);
  }

  // First pass: every folder MUST have pinned.json.
  for (const folder of folders) {
    const pinned = path.join(SOURCES_DIR, folder, "pinned.json");
    if (!(await fileExists(pinned))) {
      console.error(`[abort] missing pinned.json in ${folder}`);
      process.exit(2);
    }
  }

  const rows: SourceRow[] = [];
  const allRules: RuleEntry[] = [];
  let importFailed = false;

  for (const folder of folders) {
    try {
      const { count, rules } = await importSource(folder);
      rows.push({ folder, count, status: "ok" });
      allRules.push(...rules);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[warn] source ${folder} failed: ${msg}`);
      rows.push({ folder, count: 0, status: "failed", note: msg });
      importFailed = true;
    }
  }

  console.log(`[summary] ${rows.filter((r) => r.status === "ok").length} sources, ${allRules.length} total rules`);
  printTable(rows);

  if (importFailed) {
    console.warn(
      `[warn] one or more sources failed to import — verify/coverage may report fewer rules than expected`,
    );
  }

  console.log("[verify] running rule verification…");
  const result = await verify(allRules);
  if (!result.ok) {
    console.error(`[verify] FAILED with ${result.errors.length} error(s):`);
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log("[verify] OK");

  console.log("[coverage] generating COVERAGE.md and GAPS.md…");
  await generateCoverage(allRules);
  console.log("[coverage] OK");

  process.exit(0);
}

main().catch((err) => {
  console.error("[run] crashed:", err);
  process.exit(1);
});
