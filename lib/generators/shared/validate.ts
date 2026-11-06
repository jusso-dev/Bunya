import { getServiceDefinition } from "../../catalogue/services";
import { GraphDocumentSchema, type GraphDocument } from "../../graph/schema";
import { checkImportText, checkObjectDepth } from "../../graph/limits";
import { topologyProblems } from "../../graph/topology";
import { planFamily } from "../../catalogue/app-service-plans";

// Hosting the exporters cannot emit faithfully yet. Blocking beats generating
// a code-deployed app on a plan that Azure would reject.
function unsupportedHosting(document: GraphDocument): string[] {
  const reasons: string[] = [];
  for (const node of document.nodes) {
    if (node.type === "appServicePlan") {
      const family = planFamily(node.properties.sku);
      if (family !== "dedicated") {
        const name = family === "flex" ? "Flex Consumption" : family === "consumption" ? "Consumption" : "Elastic Premium";
        reasons.push(`App Service Plan "${node.resourceName}" uses ${name} (${String(node.properties.sku)}).`);
      }
    }
    if ((node.type === "appService" || node.type === "functionApp") && node.properties.containerImage) {
      reasons.push(`${node.type === "appService" ? "Web App" : "Function App"} "${node.resourceName}" runs container image ${String(node.properties.containerImage)}.`);
    }
  }
  return reasons;
}

// These exporters emit literal deployment values, never user-provided code.
// Keep one conservative literal grammar across Bash, PowerShell, HCL, Bicep
// and ARM; unsupported expressions fail visibly rather than changing meaning.
const literal = /^[\p{L}\p{N} ._/@:+,=*-]*$/u;
// Display names reach only diagrams and docs, never deployment code, so they
// may also use parentheses, e.g. the catalogue label "Web App (App Service)".
const displayName = /^[\p{L}\p{N} ._/@:+,=*()-]*$/u;

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
      if (!displayName.test(node.name) || node.name.length > 4096) throw new Error(`${node.name.slice(0, 80)}: display name contains unsupported characters. Use letters, numbers, spaces and basic punctuation.`);
      if (!/^[A-Za-z0-9_.-]+$/.test(node.resourceName)) throw new Error(`${node.name} "${node.resourceName.slice(0, 80)}": resource name must use letters, numbers, dots, underscores or hyphens. Rename it in the inspector.`);
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
    if (deployment) {
      const problems = topologyProblems(parsed);
      if (problems.length > 0) throw new Error(`This diagram cannot be deployed to Azure as drawn: ${problems.map((problem) => problem.message).join(" ")}`);
      const unsupported = unsupportedHosting(parsed);
      if (unsupported.length > 0) throw new Error(`Deployment exports do not support this hosting yet, so export is blocked rather than emitting code that deploys something different: ${unsupported.join(" ")} The diagram, cost estimate and JSON export still work.`);
    }
    return { ok: true, document: parsed };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Invalid graph document." };
  }
}
