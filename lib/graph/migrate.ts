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
      for (const node of document.nodes) {
        // Storage used one flag for anonymous blob access and the public
        // network endpoint; keep both meanings for diagrams saved before the split.
        if (node.type === "storageAccount" && typeof node.properties.publicNetworkAccess !== "boolean") {
          node.properties = { ...node.properties, publicNetworkAccess: node.properties.allowPublicAccess === true };
        }
      }
      for (const node of document.nodes) getServiceDefinition(node.type).propertiesSchema.parse(node.properties);
      return document;
    default:
      throw new Error(`unsupported schemaVersion: ${String(version)}`);
  }
}
