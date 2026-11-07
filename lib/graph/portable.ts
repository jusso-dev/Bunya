import { fileStem } from "./filename";
import { MAX_IMPORT_BYTES, checkImportText, parseJsonInput } from "./limits";
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
  return `${fileStem(document.metadata.name, "untitled")}${PORTABLE_EXTENSION}`;
}

export type ImportResult =
  | { ok: true; document: GraphDocument; envelope: PortableEnvelope; warning?: string }
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function migrated(raw: unknown, failure: string): { ok: true; document: GraphDocument } | { ok: false; reason: string } {
  try {
    return { ok: true, document: migrate(raw) };
  } catch (err) {
    return { ok: false, reason: `${failure}: ${errorText(err)}.` };
  }
}

export function parsePortable(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = parseJsonInput(text);
  } catch (err) {
    return {
      ok: false,
      reason: `File is not valid JSON: ${errorText(err)}.`,
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
      const bare = migrated(candidate, "Bare graph document failed migration");
      return bare.ok ? { ...bare, envelope: buildEnvelope(bare.document, "legacy-raw-document") } : bare;
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
  const result = migrated(candidate.document, "Document failed migration");
  if (!result.ok) return result;
  return {
    ...result,
    envelope: {
      format: PORTABLE_FORMAT,
      version: PORTABLE_VERSION,
      exportedAt: typeof candidate.exportedAt === "string" ? candidate.exportedAt : new Date().toISOString(),
      generator: typeof candidate.generator === "string" ? candidate.generator : "unknown",
      document: result.document,
    },
  };
}

export function parseImportText(text: string): ImportResult {
  try { checkImportText(text); } catch (error) { return { ok: false, reason: errorText(error) }; }
  const normalised = normaliseImportText(text);
  const portable = parsePortable(normalised);
  if (portable.ok) return portable;
  try {
    const arm = parseArmTemplate(normalised);
    if (arm.ok) {
      const document = migrate(arm.document);
      return {
        ok: true,
        document,
        warning: arm.warning,
        envelope: buildEnvelope(
          document,
          "azure-arm-export",
        ),
      };
    }
    // A file that is not JSON fails both readers for the same reason; say it once.
    if (portable.reason.startsWith("File is not valid JSON") && arm.reason.startsWith("ARM template is not valid JSON")) {
      return { ok: false, reason: arm.reason };
    }
    return {
      ok: false,
      reason: `${portable.reason} Also failed ARM import: ${arm.reason}`,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `Unexpected ARM import error: ${errorText(err)}.`,
    };
  }
}

export async function readFileAsText(file: File): Promise<string> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("File exceeds the 1 MiB import limit.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsText(file);
  });
}

export function isPortableFile(file: File): boolean {
  if (file.name.toLowerCase().endsWith(".json")) return true;
  if (file.type === PORTABLE_MIME) return true;
  return false;
}
