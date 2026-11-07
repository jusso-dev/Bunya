import type { ServiceType } from "@/lib/graph/schema";
import { SUFFIXED_NAME_TYPES } from "@/lib/catalogue/azure";
import { getServiceDefinition } from "@/lib/catalogue/services";

function shortHash(input: string, length = 6): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(length, "0").slice(0, length);
}

export function terraformIdentifier(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^[^a-z]/, "r_$&");
  return cleaned.length > 0 ? cleaned : "resource";
}

// Globally unique services get a suffix seeded by the diagram, so two
// diagrams using the same base name do not collide.
export function azureResourceName(type: ServiceType, baseName: string, documentSeed: string): string {
  if (!SUFFIXED_NAME_TYPES.has(type)) return baseName;
  const hash = shortHash(`${documentSeed}:${type}:${baseName}`);
  const max = getServiceDefinition(type).nameMaxLength;
  if (type === "storageAccount") {
    const base = baseName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, max - hash.length);
    return (base || "stg") + hash;
  }
  const base = baseName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, max - hash.length - 1);
  return `${base || "kv"}-${hash}`;
}
