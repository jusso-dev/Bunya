import { getServiceDefinition } from "../catalogue/services";
import { ARM_NODE_ID_PREFIX, GraphDocument, GraphDocumentSchema } from "./schema";

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
        // network endpoint. ARM imports only ever filled it from
        // allowBlobPublicAccess and never read the network setting, so an
        // imported account keeps Azure's default (open endpoint); hand-drawn
        // accounts keep what older exports deployed.
        if (node.type === "storageAccount" && typeof node.properties.publicNetworkAccess !== "boolean") {
          const imported = node.id.startsWith(ARM_NODE_ID_PREFIX);
          node.properties = { ...node.properties, publicNetworkAccess: imported || node.properties.allowPublicAccess === true };
        }
      }
      for (const node of document.nodes) getServiceDefinition(node.type).propertiesSchema.parse(node.properties);
      return document;
    default:
      throw new Error(`unsupported schemaVersion: ${String(version)}`);
  }
}
