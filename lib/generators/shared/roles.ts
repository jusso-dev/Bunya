// Role assignments implied by the diagram, shared by the Terraform, Bicep and
// ARM exporters so they grant the same roles.
import type { GraphNode, ServiceType } from "@/lib/graph/schema";
import { GRANT_PRINCIPALS, GRANT_SCOPES, ROLE_DEFINITION_IDS, edgeRoleFor, type RoleName } from "@/lib/catalogue/azure";
import { GeneratorContext, sources, targets } from "./context";

// Services exporters give a managed identity that can hold a role.
const IDENTITY_PRINCIPALS: ReadonlySet<ServiceType> = new Set([...GRANT_PRINCIPALS, "aksCluster", "virtualMachineScaleSet"]);

export type RoleGrant = {
  principal: GraphNode;
  scope: GraphNode;
  role: RoleName;
  roleId: string;
  // Drawn as a Role Assignment node rather than an identity edge.
  drawn: boolean;
};

// Every grant: one per identity edge from a principal to a scope, with the
// role the catalogue gives that scope, then one per drawn Role Assignment
// node. A drawn node can repeat an edge grant; Azure rejects duplicate
// assignments, so the first is kept.
export function roleGrants(ctx: GeneratorContext): RoleGrant[] {
  const grants: RoleGrant[] = [];
  const grant = (principal: GraphNode, scope: GraphNode, role: RoleName, drawn: boolean) => {
    if (!IDENTITY_PRINCIPALS.has(principal.type)) return;
    const key = (g: RoleGrant) => `${g.scope.type}|${ctx.name(g.scope.id)}|${ctx.name(g.principal.id)}|${g.role}`;
    const next = { principal, scope, role, roleId: ROLE_DEFINITION_IDS[role], drawn };
    if (!grants.some((existing) => key(existing) === key(next))) grants.push(next);
  };
  for (const edge of ctx.edges) {
    if (edge.kind !== "identity") continue;
    const principal = ctx.nodesById.get(edge.source)!;
    const scope = ctx.nodesById.get(edge.target)!;
    // A principal -> user-assigned identity edge attaches the identity; it grants nothing.
    if (principal.type === "roleAssignment" || scope.type === "roleAssignment" || scope.type === "userAssignedIdentity") continue;
    grant(principal, scope, edgeRoleFor(scope.type), false);
  }
  for (const node of ctx.document.nodes.filter((candidate) => candidate.type === "roleAssignment")) {
    const [principal] = sources(ctx, node.id, "identity");
    const [scope] = targets(ctx, node.id, "identity");
    if (principal && scope) grant(principal, scope, node.properties.roleDefinitionName as RoleName, true);
  }
  return grants;
}

// The grants Terraform and Bicep write: identity edges between GRANT_PRINCIPALS
// and GRANT_SCOPES, the set the ARM importer folds back into edges. ARM also
// writes drawn Role Assignments and grants to AKS and scale set identities.
export function portableGrants(ctx: GeneratorContext): RoleGrant[] {
  return roleGrants(ctx).filter((grant) => !grant.drawn && GRANT_PRINCIPALS.has(grant.principal.type) && GRANT_SCOPES.has(grant.scope.type));
}

export function roleSlug(role: RoleName): string {
  return role.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}
