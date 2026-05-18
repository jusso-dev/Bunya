/**
 * ETag-aware HTTP cache helper for rules importers.
 *
 * Stores response bodies under <dir>/raw/<sha1(url)>.{json|txt} and the
 * remote ETag in a sibling `.etag` file. Skips the network entirely if a
 * cache file exists and `force` is not set. If the network is unavailable
 * but a cached body exists, returns the cache rather than failing the build.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export type FetchCachedResult = {
  body: string;
  status: number;
  cached: boolean;
};

export type FetchCachedOptions = {
  force?: boolean;
};

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

function extensionForUrl(url: string): "json" | "txt" {
  return /\.json($|\?)/i.test(url) ? "json" : "txt";
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readFileIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Fetch the URL with on-disk ETag caching.
 *
 * - Without `--force` and an existing cache file, no network call is made.
 * - With `--force`, the network is consulted; an `If-None-Match` header is
 *   sent if a previous ETag was stored, and a 304 falls back to the cache.
 * - If the network is unreachable, the cached body is returned when present.
 *   The error is only re-thrown when `force` is true *and* there is no cache.
 */
export async function fetchCached(
  url: string,
  dir: string,
  options: FetchCachedOptions = {},
): Promise<FetchCachedResult> {
  const force = options.force === true;
  const rawDir = path.join(dir, "raw");
  const hash = sha1(url);
  const ext = extensionForUrl(url);
  const bodyPath = path.join(rawDir, `${hash}.${ext}`);
  const etagPath = path.join(rawDir, `${hash}.etag`);

  await ensureDir(rawDir);

  const cachedBody = await readFileIfExists(bodyPath);
  const cachedEtag = await readFileIfExists(etagPath);

  // Offline fast-path: cache hit and not forcing.
  if (!force && cachedBody !== null) {
    return { body: cachedBody, status: 200, cached: true };
  }

  try {
    const headers: Record<string, string> = {};
    if (cachedEtag) headers["If-None-Match"] = cachedEtag.trim();

    const res = await fetch(url, { headers });

    if (res.status === 304 && cachedBody !== null) {
      return { body: cachedBody, status: 304, cached: true };
    }

    if (!res.ok) {
      if (cachedBody !== null && !force) {
        return { body: cachedBody, status: res.status, cached: true };
      }
      throw new Error(`fetchCached: ${url} -> HTTP ${res.status}`);
    }

    const body = await res.text();
    const etag = res.headers.get("etag");

    await fs.writeFile(bodyPath, body, "utf8");
    if (etag) await fs.writeFile(etagPath, etag, "utf8");

    return { body, status: res.status, cached: false };
  } catch (err) {
    // Network unreachable / DNS / TLS / etc.
    if (cachedBody !== null) {
      return { body: cachedBody, status: 0, cached: true };
    }
    if (force) throw err;
    // No cache and not forcing: re-throw so caller can decide.
    throw err;
  }
}
