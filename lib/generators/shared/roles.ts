// Role assignments implied by identity edges, shared by the Terraform, Bicep
// and ARM exporters so they grant the same roles.
import type { GraphNode, ServiceType } from "@/lib/graph/schema";
import { GeneratorContext } from "./context";

export const ROLE_DEFINITION_IDS: Record<string, string> = {
  AcrPull: "7f951dda-4ed3-4680-a7ca-43fe172d538d",
  "Key Vault Secrets User": "4633458b-17de-408a-b874-0445c86b69e6",
  "Storage Blob Data Contributor": "ba92f5b4-2d11-453d-a403-e96b0029c9fe",
  "Storage Queue Data Contributor": "974c5e8b-45b9-4653-ba55-5f855dd0fb88",
  "Monitoring Metrics Publisher": "3913510d-42f4-4e42-8a64-420c390055eb",
  Reader: "acdd72a7-3385-48ef-bd42-f606fba81ae7",
  Contributor: "b24988ac-6180-42a0-ab88-20f7382dd24c",
};

export function defaultRoleNameFor(target: GraphNode): string {
  switch (target.type) {
    case "containerRegistry":
      return "AcrPull";
    case "keyVault":
      return "Key Vault Secrets User";
    case "storageAccount":
      return "Storage Blob Data Contributor";
    case "logAnalytics":
      return "Monitoring Metrics Publisher";
    default:
      return "Reader";
  }
}

// Principals whose identity the exporters can reference.
const PRINCIPALS: ReadonlySet<ServiceType> = new Set(["appService", "functionApp", "userAssignedIdentity"]);
// Scopes the Terraform and Bicep exporters grant roles on directly. Key Vault
// stays in its own emitter for backwards-compatible resource names.
const SCOPES: ReadonlySet<ServiceType> = new Set(["containerRegistry", "storageAccount"]);

export type RoleGrant = { principal: GraphNode; scope: GraphNode; role: string; roleId: string };

// Identity edges from a site or user-assigned identity to a registry or storage
// account. Key Vault grants are emitted beside the vault.
export function roleAssignmentsFor(ctx: GeneratorContext): RoleGrant[] {
  const grants: RoleGrant[] = [];
  for (const edge of ctx.edges) {
    if (edge.kind !== "identity") continue;
    const principal = ctx.nodesById.get(edge.source);
    const scope = ctx.nodesById.get(edge.target);
    if (!principal || !scope || !PRINCIPALS.has(principal.type) || !SCOPES.has(scope.type)) continue;
    const role = defaultRoleNameFor(scope);
    grants.push({ principal, scope, role, roleId: ROLE_DEFINITION_IDS[role] });
  }
  return grants;
}
