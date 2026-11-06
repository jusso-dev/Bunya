import { ZodError } from "zod";
import { getServiceDefinition } from "../../catalogue/services";
import { GraphDocumentSchema, type GraphDocument } from "../../graph/schema";
import { checkImportText, checkObjectDepth } from "../../graph/limits";
import { topologyProblems } from "../../graph/topology";
import { expandImplicits } from "./implicits";
import { assertExportLiterals } from "../../graph/literal";

// Display names reach only diagrams and docs, never deployment code, so they
// may also use parentheses, e.g. the catalogue label "Web App (App Service)".
const displayName = /^[\p{L}\p{N} ._/@:+,=*()-]*$/u;

// Schema errors arrive as JSON issue lists; turn them into sentences.
function readableError(error: unknown): string {
  if (error instanceof ZodError) {
    const lines = error.issues.slice(0, 10).map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join(".") : "Diagram";
      if (issue.code === "too_big" && typeof issue.maximum === "number") return `- ${where} is too long or too large (maximum ${issue.maximum}).`;
      if (issue.code === "too_small" && typeof issue.minimum === "number") return `- ${where} is too short or too small (minimum ${issue.minimum}).`;
      return `- ${where}: ${issue.message}`;
    });
    return ["This diagram has settings Bunya cannot use:", ...lines, ...(error.issues.length > 10 ? [`- and ${error.issues.length - 10} more.`] : [])].join("\n");
  }
  return error instanceof Error ? error.message : "Invalid graph document.";
}

export function validateGeneration(document: GraphDocument, deployment = true): { ok: true; document: GraphDocument } | { ok: false; reason: string } {
  try {
    checkImportText(JSON.stringify(document));
    checkObjectDepth(document);
    const parsed = GraphDocumentSchema.parse(document);
    // Metadata names also seed implicit resource names and executable comments.
    assertExportLiterals(parsed.metadata, "Document");
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
      assertExportLiterals(properties, `${node.name} "${node.resourceName}"`);
      if (deployment && node.type === "networkSecurityGroup" && (
        properties.defaultDeny !== false || (properties.inboundRules as unknown[]).length > 0 ||
        (properties.outboundRules as unknown[]).length > 0 || parsed.edges.some((edge) => edge.source === node.id || edge.target === node.id)
      )) throw new Error(`Network Security Group "${node.resourceName}" has rules or subnet associations, which Bunya's deployment exports do not emit yet. Export is blocked so they are not silently dropped. Your Azure NSG is unaffected; the diagram and JSON export still work.`);
      node.properties = properties;
    }
    if (deployment) {
      // Check the graph as drawn and as exporters emit it, including plans and
      // edges implicit expansion adds for unattached apps.
      const messages = new Set<string>();
      const problems = [...topologyProblems(parsed), ...topologyProblems(expandImplicits(parsed).document)].filter((problem) => {
        if (messages.has(problem.message)) return false;
        messages.add(problem.message);
        return true;
      });
      if (problems.length > 0) {
        const azure = problems.filter((problem) => problem.kind === "azure");
        const bunya = problems.filter((problem) => problem.kind === "bunya");
        // One item per line so the output panel can list them.
        throw new Error([
          `Bunya cannot generate deployment code for this diagram yet (${problems.length} item${problems.length === 1 ? "" : "s"} to fix).`,
          ...(bunya.length > 0 ? ["Not supported by Bunya's exports (these can still run in Azure):", ...bunya.map((problem) => `- ${problem.message}`)] : []),
          ...(azure.length > 0 ? ["Azure would reject:", ...azure.map((problem) => `- ${problem.message}`)] : []),
        ].join("\n"));
      }
    }
    return { ok: true, document: parsed };
  } catch (error) {
    return { ok: false, reason: readableError(error) };
  }
}
