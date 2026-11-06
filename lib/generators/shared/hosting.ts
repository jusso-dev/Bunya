// Hosting facts every exporter needs for a web or function app: its plan
// family, container image, registry pull identity, VNet integration subnet,
// Application Insights component and Flex deployment container.
import { parseContainerImage, planFamily, type ContainerImage, type PlanFamily } from "@/lib/catalogue/app-service-plans";
import type { GraphNode } from "@/lib/graph/schema";
import { flexRuntimeVersion, integrationDelegation, siteIntegrationSubnet } from "@/lib/graph/topology";
import { storagePublicNetwork } from "@/lib/catalogue/services";
import { GeneratorContext, outgoingOf, resolveAppServicePlan } from "./context";

export type SiteHosting = {
  plan: GraphNode | null;
  family: PlanFamily;
  image: ContainerImage | null;
  // Registry in the diagram that the image is pulled from.
  registry: GraphNode | null;
  // Identity that pulls the image: the site's own identity, a user-assigned
  // identity linked to both, or null for anonymous/public pulls.
  pullIdentity: { kind: "system" } | { kind: "user"; node: GraphNode } | null;
  subnet: GraphNode | null;
  appInsights: GraphNode | null;
  storage: GraphNode | null;
  // Blob container Flex Consumption deploys packages from.
  deploymentContainer: string;
  userIdentities: GraphNode[];
  // FUNCTIONS_WORKER_RUNTIME / Flex runtime name.
  workerRuntime: string;
  // Canonical Flex runtime version, the value validation checked.
  flexVersion: string;
  // Content share reached over the VNet because storage has no public
  // endpoint: needs vnetContentShareEnabled and a pre-created file share.
  privateContentShare: boolean;
};

export function siteHosting(ctx: GeneratorContext, node: GraphNode): SiteHosting {
  const plan = resolveAppServicePlan(ctx, node);
  const family = planFamily(plan?.properties.sku ?? "B1");
  const image = parseContainerImage(String(node.properties.containerImage ?? ""));
  const targets = (kind: Parameters<typeof outgoingOf>[2]) =>
    outgoingOf(ctx, node.id, kind)
      .map((edge) => ctx.nodesById.get(edge.target))
      .filter((target): target is GraphNode => !!target);
  const userIdentities = targets("identity").filter((target) => target.type === "userAssignedIdentity");
  const registryHost = image?.registryHost.toLowerCase();
  const registryFor = (candidate: GraphNode) =>
    candidate.type === "containerRegistry" &&
    `${(ctx.resourceNames.get(candidate.id) ?? candidate.resourceName).toLowerCase()}.azurecr.io` === registryHost;
  const registry = image ? ctx.document.nodes.find(registryFor) ?? null : null;

  let pullIdentity: SiteHosting["pullIdentity"] = null;
  if (registry) {
    if (targets("identity").some((target) => target.id === registry.id)) {
      pullIdentity = { kind: "system" };
    } else {
      const viaUser = userIdentities.find((identity) =>
        outgoingOf(ctx, identity.id, "identity").some((edge) => edge.target === registry.id),
      );
      if (viaUser) pullIdentity = { kind: "user", node: viaUser };
    }
  }

  const subnet = siteIntegrationSubnet(ctx.document, node) ?? null;
  const appInsights = targets("diagnostic").find((target) => target.type === "applicationInsights") ?? null;
  const storage = targets("data").find((target) => target.type === "storageAccount") ?? null;
  const runtime = String(node.properties.runtime ?? "node");
  return {
    plan,
    family,
    image,
    registry,
    pullIdentity,
    subnet,
    appInsights,
    storage,
    deploymentContainer: `app-package-${(ctx.resourceNames.get(node.id) ?? node.resourceName).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40)}`.replace(/-+$/, ""),
    userIdentities,
    workerRuntime: runtime === "dotnet" ? "dotnet-isolated" : runtime,
    flexVersion: flexRuntimeVersion(runtime, String(node.properties.runtimeVersion ?? "22")),
    privateContentShare: node.type === "functionApp" && (family === "consumption" || family === "elastic") && !!storage && !storagePublicNetwork(storage.properties),
  };
}

// Content share for event-driven Function plans (Consumption and Elastic
// Premium); Flex and dedicated plans do not use one.
export function needsContentShare(hosting: SiteHosting): boolean {
  return hosting.family === "consumption" || hosting.family === "elastic";
}

export function contentShareName(ctx: GeneratorContext, node: GraphNode): string {
  return (ctx.resourceNames.get(node.id) ?? node.resourceName).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63).replace(/-+$/, "");
}

export { integrationDelegation };

// Shell exports hand these to the ARM template: the CLI and Az module create
// Flex, Elastic Premium and container apps in several separately-failing
// steps, some of them preview-only.
export function needsTemplateDeployment(ctx: GeneratorContext): string | null {
  for (const node of ctx.document.nodes) {
    // The CLIs create zones, links, zone groups and DNS servers in separate
    // steps the scripts do not emit; the ARM template wires them together.
    if (node.type === "privateDnsZone" && ctx.edges.some((edge) => edge.kind === "network" && (edge.source === node.id || edge.target === node.id))) {
      return `Private DNS Zone "${node.resourceName}" is linked to endpoints or VNets`;
    }
    if (node.type === "virtualNetwork" && Array.isArray(node.properties.dnsServers) && node.properties.dnsServers.length > 0) {
      return `Virtual Network "${node.resourceName}" uses custom DNS servers`;
    }
    if (node.type === "appServicePlan") {
      const family = planFamily(node.properties.sku);
      if (family !== "dedicated") return `App Service Plan "${node.resourceName}" uses ${String(node.properties.sku)}`;
    }
    if ((node.type === "appService" || node.type === "functionApp") && node.properties.containerImage) {
      return `"${node.resourceName}" runs a container image`;
    }
    if ((node.type === "appService" || node.type === "functionApp") && siteIntegrationSubnet(ctx.document, node)) {
      return `"${node.resourceName}" uses VNet integration`;
    }
  }
  return null;
}
