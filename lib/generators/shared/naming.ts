import { ServiceType } from "@/lib/graph/schema";

const STORAGE_MAX = 24;
const KEYVAULT_MAX = 24;

export function sanitiseAlphanumLower(raw: string, max: number): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cleaned.slice(0, max);
}

export function shortHash(input: string, length = 6): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).padStart(length, "0").slice(0, length);
}

export function terraformIdentifier(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^[^a-z]/, "r_$&");
  return cleaned.length > 0 ? cleaned : "resource";
}

export function azureResourceName(
  type: ServiceType,
  baseName: string,
  documentSeed: string,
): string {
  const hash = shortHash(`${documentSeed}:${type}:${baseName}`);
  switch (type) {
    case "storageAccount": {
      const base = sanitiseAlphanumLower(baseName, STORAGE_MAX - hash.length);
      return (base.length > 0 ? base : "stg") + hash;
    }
    case "keyVault": {
      const base = baseName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
      const trimmed = base.slice(0, KEYVAULT_MAX - hash.length - 1);
      return `${trimmed || "kv"}-${hash}`;
    }
    default:
      return baseName;
  }
}
