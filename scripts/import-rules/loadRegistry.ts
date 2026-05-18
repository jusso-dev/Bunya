/**
 * Builds the merged rules registry by walking `lib/rules/sources/<folder>/`
 * and invoking the exported `import*` function from each folder's `import.ts`.
 *
 * Each source folder is expected to contain:
 *   - `pinned.json` (required by `run.ts`, but `loadRegistry` only requires
 *     `import.ts` to be importable)
 *   - `import.ts` exporting at least one async function named `import*` that
 *     returns `{ count: number; rules: RuleEntry[] }`.
 *
 * Sources that fail to load (e.g. because a sibling agent has not yet written
 * `generated.ts`) are skipped with a warning rather than aborting the run.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RuleEntry } from "@/lib/rules/schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type SourceLoad = {
  name: string;
  folder: string;
  count: number;
  rules: RuleEntry[];
};

export type LoadedRegistry = {
  rules: RuleEntry[];
  sources: SourceLoad[];
  errors: { folder: string; error: string }[];
};

export const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
export const SOURCES_DIR = path.join(PROJECT_ROOT, "lib", "rules", "sources");

async function dirExists(dir: string): Promise<boolean> {
  try {
    const st = await fs.stat(dir);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function listSourceFolders(sourcesDir: string): Promise<string[]> {
  if (!(await dirExists(sourcesDir))) return [];
  const entries = await fs.readdir(sourcesDir, { withFileTypes: true });
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

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function importSource(folder: string): Promise<SourceLoad> {
  const importPath = path.join(SOURCES_DIR, folder, "import.ts");
  if (!(await fileExists(importPath))) {
    throw new Error(`missing import.ts in ${folder}`);
  }
  // tsx evaluates .ts via the dynamic import hook.
  const mod = (await import(pathToFileURL(importPath).href)) as Record<string, unknown>;
  const fn = Object.entries(mod).find(
    ([key, value]) => key.startsWith("import") && isImportFunction(value),
  )?.[1];
  if (!fn || !isImportFunction(fn)) {
    throw new Error(`no exported import* function found in ${folder}/import.ts`);
  }
  const result = await fn();
  if (!result || !Array.isArray(result.rules)) {
    throw new Error(`import* in ${folder} did not return { count, rules }`);
  }
  return {
    name: folder,
    folder,
    count: result.count,
    rules: result.rules,
  };
}

export type LoadOptions = {
  /**
   * If true (default), missing/failing source folders are returned in
   * `errors` instead of throwing. Used by `run.ts`, `verify.ts`, and
   * `generate-coverage.ts` so the pipeline tolerates parallel agents
   * still writing `generated.ts` files.
   */
  tolerant?: boolean;
  /**
   * Limits the load to a specific subset of source folder names. Empty/
   * undefined loads everything under `lib/rules/sources/`.
   */
  only?: string[];
};

async function loadGraphRules(): Promise<SourceLoad | null> {
  const indexPath = path.join(PROJECT_ROOT, "lib", "rules", "graph-rules", "index.ts");
  if (!(await fileExists(indexPath))) return null;
  try {
    const mod = (await import(pathToFileURL(indexPath).href)) as { GRAPH_RULES?: RuleEntry[] };
    const rules = Array.isArray(mod.GRAPH_RULES) ? mod.GRAPH_RULES : [];
    return { name: "graph-rules", folder: "graph-rules", count: rules.length, rules };
  } catch {
    return null;
  }
}

export async function loadRegistry(options: LoadOptions = {}): Promise<LoadedRegistry> {
  const tolerant = options.tolerant !== false;
  const folders = await listSourceFolders(SOURCES_DIR);
  const filtered = options.only && options.only.length > 0
    ? folders.filter((f) => options.only!.includes(f))
    : folders;

  const sources: SourceLoad[] = [];
  const errors: { folder: string; error: string }[] = [];
  const allRules: RuleEntry[] = [];

  for (const folder of filtered) {
    try {
      const loaded = await importSource(folder);
      sources.push(loaded);
      allRules.push(...loaded.rules);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!tolerant) throw err;
      errors.push({ folder, error: message });
    }
  }

  const includeGraph = !options.only || options.only.length === 0 || options.only.includes("graph-rules");
  if (includeGraph) {
    const graph = await loadGraphRules();
    if (graph) {
      sources.push(graph);
      allRules.push(...graph.rules);
    }
  }

  return { rules: allRules, sources, errors };
}
