// Role assignments implied by identity edges, shared by the Terraform, Bicep
// and ARM exporters so they grant the same roles.
import type { GraphNode, ServiceType } from "@/lib/graph/schema";
import { GRANT_PRINCIPALS, ROLE_DEFINITION_IDS, edgeRoleFor, type RoleName } from "@/lib/catalogue/azure";
import { GeneratorContext } from "./context";

// Scopes the Terraform and Bicep exporters grant roles on directly. Key Vault
// stays in its own emitter for backwards-compatible resource names.
const SCOPES: ReadonlySet<ServiceType> = new Set(["containerRegistry", "storageAccount"]);

export type RoleGrant = { principal: GraphNode; scope: GraphNode; role: RoleName; roleId: string };

// Identity edges from a site or user-assigned identity to a registry or storage
// account. Key Vault grants are emitted beside the vault.
export function roleAssignmentsFor(ctx: GeneratorContext): RoleGrant[] {
  const grants: RoleGrant[] = [];
  for (const edge of ctx.edges) {
    if (edge.kind !== "identity") continue;
    const principal = ctx.nodesById.get(edge.source);
    const scope = ctx.nodesById.get(edge.target);
    if (!principal || !scope || !GRANT_PRINCIPALS.has(principal.type) || !SCOPES.has(scope.type)) continue;
    const role = edgeRoleFor(scope.type);
    grants.push({ principal, scope, role, roleId: ROLE_DEFINITION_IDS[role] });
  }
  return grants;
}
