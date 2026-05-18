import { GraphDocument, GraphDocumentSchema } from "./schema";
import { migrate } from "./migrate";

const STORAGE_KEY = "bunya.document.v1";
const URL_PREFIX = "bunya1:";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  if (typeof btoa === "undefined") return Buffer.from(binary, "binary").toString("base64");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): Uint8Array {
  const normalised = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "===".slice((normalised.length + 3) % 4);
  if (typeof atob === "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function compress(text: string): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    return new TextEncoder().encode(text);
  }
  const encoded = new TextEncoder().encode(text);
  const blob = new Blob([encoded.slice().buffer]);
  const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function decompress(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    return new TextDecoder().decode(bytes);
  }
  const blob = new Blob([bytes.slice().buffer]);
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

export async function serialiseToFragment(document: GraphDocument): Promise<string> {
  const json = JSON.stringify(document);
  const compressed = await compress(json);
  return URL_PREFIX + base64UrlEncode(compressed);
}

export async function deserialiseFromFragment(fragment: string): Promise<GraphDocument | null> {
  if (!fragment.startsWith(URL_PREFIX)) return null;
  const payload = fragment.slice(URL_PREFIX.length);
  try {
    const bytes = base64UrlDecode(payload);
    const text = await decompress(bytes);
    return migrate(JSON.parse(text));
  } catch {
    return null;
  }
}

export function shareUrlFromFragment(fragment: string, base?: string): string {
  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    url.hash = fragment;
    return url.toString();
  }
  return `${base ?? "https://bunya.example"}#${fragment}`;
}

export function saveToLocalStorage(document: GraphDocument): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
}

export function loadFromLocalStorage(): GraphDocument | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const migrated = migrate(parsed);
    return GraphDocumentSchema.parse(migrated);
  } catch {
    return null;
  }
}

export function clearLocalStorage(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export const FRAGMENT_SIZE_WARNING_BYTES = 6 * 1024;

export function fragmentByteLength(fragment: string): number {
  return new TextEncoder().encode(fragment).byteLength;
}
