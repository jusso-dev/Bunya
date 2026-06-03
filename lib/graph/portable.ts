import { GraphDocument } from "./schema";
import { migrate } from "./migrate";
import { parseArmTemplate } from "./arm-import";

const PORTABLE_FORMAT = "bunya" as const;
const PORTABLE_VERSION = 1 as const;
export const PORTABLE_EXTENSION = ".bunya.json";
export const PORTABLE_MIME = "application/x-bunya+json";

export type PortableEnvelope = {
  format: typeof PORTABLE_FORMAT;
  version: typeof PORTABLE_VERSION;
  exportedAt: string;
  generator: string;
  document: GraphDocument;
};

export function buildEnvelope(document: GraphDocument, generatorVersion = "bunya"): PortableEnvelope {
  return {
    format: PORTABLE_FORMAT,
    version: PORTABLE_VERSION,
    exportedAt: new Date().toISOString(),
    generator: generatorVersion,
    document,
  };
}

export function envelopeToBlob(envelope: PortableEnvelope): Blob {
  const json = JSON.stringify(envelope, null, 2);
  return new Blob([json], { type: PORTABLE_MIME });
}

export function suggestedFilename(document: GraphDocument): string {
  const slug = document.metadata.name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "untitled";
  return `${slug}${PORTABLE_EXTENSION}`;
}

export type ImportResult =
  | { ok: true; document: GraphDocument; envelope: PortableEnvelope }
  | { ok: false; reason: string };

function normaliseImportText(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json|arm|bunya)?\s*([\s\S]*?)\s*```$/i);
  if (fence?.[1]) return fence[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }
  return trimmed;
}

export function parsePortable(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      reason: `File is not valid JSON: ${err instanceof Error ? err.message : String(err)}.`,
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "File does not contain a JSON object." };
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate.format !== PORTABLE_FORMAT) {
    if (
      typeof candidate.schemaVersion === "number" &&
      Array.isArray(candidate.nodes) &&
      Array.isArray(candidate.edges)
    ) {
      try {
        const doc = migrate(candidate);
        return {
          ok: true,
          document: doc,
          envelope: buildEnvelope(doc, "legacy-raw-document"),
        };
      } catch (err) {
        return {
          ok: false,
          reason: `Bare graph document failed migration: ${err instanceof Error ? err.message : String(err)}.`,
        };
      }
    }
    return { ok: false, reason: `Not a Bunya export (missing format: "bunya").` };
  }
  if (candidate.version !== PORTABLE_VERSION) {
    return {
      ok: false,
      reason: `Unsupported Bunya export version: ${String(candidate.version)}.`,
    };
  }
  if (typeof candidate.document !== "object" || candidate.document === null) {
    return { ok: false, reason: "Envelope is missing a document." };
  }
  try {
    const doc = migrate(candidate.document);
    return {
      ok: true,
      document: doc,
      envelope: {
        format: PORTABLE_FORMAT,
        version: PORTABLE_VERSION,
        exportedAt: typeof candidate.exportedAt === "string" ? candidate.exportedAt : new Date().toISOString(),
        generator: typeof candidate.generator === "string" ? candidate.generator : "unknown",
        document: doc,
      },
    };
  } catch (err) {
    return {
      ok: false,
      reason: `Document failed migration: ${err instanceof Error ? err.message : String(err)}.`,
    };
  }
}

export function parseImportText(text: string): ImportResult {
  const normalised = normaliseImportText(text);
  const portable = parsePortable(normalised);
  if (portable.ok) return portable;
  try {
    const arm = parseArmTemplate(normalised);
    if (arm.ok) {
      return {
        ok: true,
        document: arm.document,
        envelope: buildEnvelope(
          arm.document,
          arm.warning ? `azure-arm-export (${arm.warning})` : "azure-arm-export",
        ),
      };
    }
    return {
      ok: false,
      reason: `${portable.reason} Also failed ARM import: ${arm.reason}`,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `Unexpected ARM import error: ${err instanceof Error ? err.message : String(err)}.`,
    };
  }
}

export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsText(file);
  });
}

export function isPortableFile(file: File): boolean {
  if (file.name.endsWith(PORTABLE_EXTENSION)) return true;
  if (file.name.endsWith(".json")) return true;
  if (file.type === PORTABLE_MIME) return true;
  return false;
}
