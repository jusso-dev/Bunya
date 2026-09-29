import { getServiceDefinition } from "../catalogue/services";
import { GraphDocument, GraphDocumentSchema } from "./schema";

export function migrate(raw: unknown): GraphDocument {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("invalid graph document");
  }
  const version = (raw as { schemaVersion?: number }).schemaVersion;
  switch (version) {
    case 1:
      const document = GraphDocumentSchema.parse(raw);
      for (const node of document.nodes) getServiceDefinition(node.type).propertiesSchema.parse(node.properties);
      return document;
    default:
      throw new Error(`unsupported schemaVersion: ${String(version)}`);
  }
}
