import { GraphDocument, GraphDocumentSchema } from "./schema";

export function migrate(raw: unknown): GraphDocument {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("invalid graph document");
  }
  const version = (raw as { schemaVersion?: number }).schemaVersion;
  switch (version) {
    case 1:
      return GraphDocumentSchema.parse(raw);
    default:
      throw new Error(`unsupported schemaVersion: ${String(version)}`);
  }
}
