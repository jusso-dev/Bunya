/**
 * Entry point for `pnpm icons:sync`.
 *
 * Finds the current Azure architecture icon pack on Microsoft Learn,
 * downloads it, and refreshes public/azure-icons/<serviceType>.svg from the
 * files named in lib/catalogue/icon-manifest.json. Icons are copied byte for
 * byte: Microsoft's terms do not allow them to be cropped, recoloured or
 * otherwise modified.
 *
 * When Microsoft renumbers an icon between packs, the file is matched by its
 * name without the numeric prefix (preferring the same category folder).
 *
 * Usage: pnpm icons:sync [--zip <local pack.zip>] [--report report.md]
 * Exit codes: 0 on success (with or without changes), 1 when a mapped icon
 * cannot be found in the current pack.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import JSZip from "jszip";
import { arg, PROJECT_ROOT, run } from "./lib";

const MANIFEST_PATH = path.join(PROJECT_ROOT, "lib", "catalogue", "icon-manifest.json");
const ICON_DIR = path.join(PROJECT_ROOT, "public", "azure-icons");
const ICONS_PAGE = "https://learn.microsoft.com/en-us/azure/architecture/icons/";

type Manifest = {
  $comment?: string;
  pack: { version: number; url: string; page: string };
  icons: Record<string, { file: string; sha256: string }>;
};

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const nameKey = (file: string) => path.basename(file).replace(/^\d+-/, "").toLowerCase();

async function latestPack(): Promise<{ version: number; url: string }> {
  const response = await fetch(ICONS_PAGE, { headers: { "user-agent": "bunya-icons-sync" } });
  if (!response.ok) throw new Error(`GET ${ICONS_PAGE} returned ${response.status}`);
  const html = await response.text();
  const packs = [...html.matchAll(/https:\/\/[^"'\s]+Azure_Public_Service_Icons_V(\d+)\.zip/g)].map((m) => ({
    url: m[0],
    version: Number(m[1]),
  }));
  if (packs.length === 0) throw new Error("No icon pack link found on the Azure architecture icons page.");
  return packs.sort((a, b) => b.version - a.version)[0];
}

async function loadZip(source: string): Promise<JSZip> {
  if (!/^https?:/.test(source)) return JSZip.loadAsync(await fs.readFile(source));
  const response = await fetch(source, { headers: { "user-agent": "bunya-icons-sync" } });
  if (!response.ok) throw new Error(`GET ${source} returned ${response.status}`);
  return JSZip.loadAsync(await response.arrayBuffer());
}

async function readIfExists(file: string): Promise<Uint8Array | null> {
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const reportPath = arg("report");
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8")) as Manifest;
  const localZip = arg("zip");
  const pack = localZip ? manifest.pack : await latestPack();
  const zip = await loadZip(localZip ?? pack.url);

  // Index pack entries by their path under Icons/ and by renumber-proof name.
  const byPath = new Map<string, JSZip.JSZipObject>();
  const byName = new Map<string, string[]>();
  zip.forEach((relative, entry) => {
    const match = /(?:^|\/)Icons\/(.+\.svg)$/i.exec(relative);
    if (!match || entry.dir) return;
    byPath.set(match[1], entry);
    byName.set(nameKey(match[1]), [...(byName.get(nameKey(match[1])) ?? []), match[1]]);
  });

  const problems: string[] = [];
  const changes: string[] = [];
  for (const [serviceType, icon] of Object.entries(manifest.icons)) {
    let file = icon.file;
    if (!byPath.has(file)) {
      const candidates = byName.get(nameKey(file)) ?? [];
      const folder = path.dirname(file);
      const replacement = candidates.find((c) => path.dirname(c) === folder) ?? candidates[0];
      if (!replacement) {
        problems.push(`\`${serviceType}\`: \`${file}\` is not in icon pack V${pack.version}. Pick a replacement in lib/catalogue/icon-manifest.json.`);
        continue;
      }
      changes.push(`\`${serviceType}\`: moved from \`${file}\` to \`${replacement}\`.`);
      file = replacement;
    }
    const data = await byPath.get(file)!.async("uint8array");
    const hash = sha256(data);
    const target = path.join(ICON_DIR, `${serviceType}.svg`);
    const current = await readIfExists(target);
    if (hash !== icon.sha256 || !current || sha256(current) !== hash) {
      await fs.writeFile(target, data);
      if (hash !== icon.sha256) changes.push(`\`${serviceType}\`: artwork updated from \`${file}\`.`);
    }
    manifest.icons[serviceType] = { file, sha256: hash };
  }

  if (pack.version !== manifest.pack.version) {
    changes.unshift(`Icon pack V${manifest.pack.version} → V${pack.version} (${pack.url}).`);
  }
  manifest.pack = { ...manifest.pack, version: pack.version, url: pack.url };
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const body = [
    "### Azure architecture icons",
    "",
    `Pack: V${pack.version}`,
    "",
    ...(changes.length > 0 ? changes.map((c) => `- ${c}`) : ["- No icon changes."]),
    ...problems.map((p) => `- ❌ ${p}`),
    "",
  ].join("\n");
  console.log(body);
  if (reportPath) await fs.writeFile(reportPath, body, "utf8");
  process.exit(problems.length > 0 ? 1 : 0);
}

run("icons", main);
