import { getServiceDefinition } from "../../catalogue/services";
import { GraphDocumentSchema, type GraphDocument } from "../../graph/schema";
import { checkImportText, checkObjectDepth } from "../../graph/limits";

// These exporters emit literal deployment values, never user-provided code.
// Keep one conservative literal grammar across Bash, PowerShell, HCL, Bicep
// and ARM; unsupported expressions fail visibly rather than changing meaning.
const literal = /^[\p{L}\p{N} ._/@:+,=*-]*$/u;

function checkLiteral(value: unknown, path: string): void {
  if (typeof value === "string" && (!literal.test(value) || value.length > 4096)) {
    throw new Error(`${path} contains unsupported code syntax. Use plain literal values without quotes, control characters or expressions.`);
  }
  if (Array.isArray(value)) value.forEach((item, index) => checkLiteral(item, `${path}[${index}]`));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    checkLiteral(key, `${path} key`);
    checkLiteral(item, `${path}.${key}`);
  }
}

export function validateGeneration(document: GraphDocument, deployment = true): { ok: true; document: GraphDocument } | { ok: false; reason: string } {
  try {
    checkImportText(JSON.stringify(document));
    checkObjectDepth(document);
    const parsed = GraphDocumentSchema.parse(document);
    // Metadata names also seed implicit resource names and executable comments.
    checkLiteral(parsed.metadata, "Document");
    if (!/^[A-Za-z0-9_.-]+$/.test(parsed.metadata.resourceGroupName)) throw new Error("Resource group name must use letters, numbers, dots, underscores or hyphens.");
    for (const node of parsed.nodes) {
      checkLiteral(node.name, `Node ${node.id} name`);
      if (!/^[A-Za-z0-9_.-]+$/.test(node.resourceName)) throw new Error(`Node ${node.id}: resource name must use letters, numbers, dots, underscores or hyphens.`);
      const properties = getServiceDefinition(node.type).propertiesSchema.parse(node.properties) as Record<string, unknown>;
      if (node.properties.tags !== undefined) {
        const tags = node.properties.tags;
        if (!tags || typeof tags !== "object" || Array.isArray(tags) || Object.values(tags).some((value) => typeof value !== "string")) throw new Error(`Node ${node.id}: tags must be a string map.`);
        properties.tags = tags;
      }
      checkLiteral(properties, `Node ${node.id}`);
      if (deployment && node.type === "networkSecurityGroup" && (
        properties.defaultDeny !== false || (properties.inboundRules as unknown[]).length > 0 ||
        (properties.outboundRules as unknown[]).length > 0 || parsed.edges.some((edge) => edge.source === node.id || edge.target === node.id)
      )) throw new Error("NSG rules and associations are not yet supported by deployment exporters. Export blocked to avoid silently dropping firewall controls. The diagram remains available for review and JSON export.");
      node.properties = properties;
    }
    return { ok: true, document: parsed };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Invalid graph document." };
  }
}
