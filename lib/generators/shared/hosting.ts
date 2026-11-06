// Hosting facts every exporter needs for a web or function app: its plan
// family, container image, registry pull identity, VNet integration subnet,
// Application Insights component and Flex deployment container.
import { parseContainerImage, planFamily, type ContainerImage, type PlanFamily } from "@/lib/catalogue/app-service-plans";
import type { GraphNode } from "@/lib/graph/schema";
import { flexRuntimeVersion, siteIntegrationSubnet, sitePlan } from "@/lib/graph/topology";
import { storagePublicNetwork } from "@/lib/catalogue/services";
import { GeneratorContext, endpointZones, subnetVnet, targetOfType, targets, zoneVnets } from "./context";

export type SiteHosting = {
  plan: GraphNode;
  family: PlanFamily;
  image: ContainerImage | null;
  // Registry in the diagram that the image is pulled from.
  registry: GraphNode | null;
  // Identity that pulls the image: the site's own identity, a user-assigned
  // identity linked to both, or null for anonymous/public pulls.
  pullIdentity: { kind: "system" } | { kind: "user"; node: GraphNode } | null;
  subnet: GraphNode | null;
  appInsights: GraphNode | null;
  // Function Apps always have one after implicit expansion.
  storage: GraphNode | null;
  userIdentities: GraphNode[];
  // FUNCTIONS_WORKER_RUNTIME / Flex runtime name.
  workerRuntime: string;
  // Canonical Flex runtime version, the value validation checked.
  flexVersion: string;
  // Flex Consumption deploys packages from a blob container.
  flex: boolean;
  // Content share reached over the VNet because storage has no public
  // endpoint: needs vnetContentShareEnabled and a pre-created file share.
  privateContentShare: boolean;
  // Private Endpoints to private backing storage. The host reaches storage
  // as soon as the app exists, so the app waits for these (and their DNS).
  storageEndpoints: { pe: GraphNode; hasDns: boolean }[];
  // Links from those endpoints' DNS zones to the app's VNet: until they
  // exist the storage name does not resolve privately from the app.
  storageDnsLinks: { zone: GraphNode; vnet: GraphNode }[];
};

export function siteHosting(ctx: GeneratorContext, node: GraphNode): SiteHosting {
  const plan = sitePlan(ctx.document, node)!;
  const family = planFamily(plan.properties.sku);
  const image = parseContainerImage(String(node.properties.containerImage));
  const identityTargets = targets(ctx, node.id, "identity");
  const userIdentities = identityTargets.filter((target) => target.type === "userAssignedIdentity");
  const registryHost = image?.registryHost.toLowerCase();
  const registry = image
    ? ctx.document.nodes.find((candidate) => candidate.type === "containerRegistry" && `${ctx.name(candidate.id).toLowerCase()}.azurecr.io` === registryHost) ?? null
    : null;

  let pullIdentity: SiteHosting["pullIdentity"] = null;
  if (registry) {
    const viaUser = userIdentities.find((identity) => targets(ctx, identity.id, "identity").some((target) => target.id === registry.id));
    if (identityTargets.some((target) => target.id === registry.id)) pullIdentity = { kind: "system" };
    else if (viaUser) pullIdentity = { kind: "user", node: viaUser };
  }

  const subnet = siteIntegrationSubnet(ctx.document, node) ?? null;
  const storage = targetOfType(ctx, node.id, "data", "storageAccount") ?? null;
  const runtime = String(node.properties.runtime);
  const privateStorage = node.type === "functionApp" && !!storage && !storagePublicNetwork(storage.properties);
  const storageEndpoints = privateStorage
    ? ctx.document.nodes
        .filter((pe) => pe.type === "privateEndpoint" && targets(ctx, pe.id, "network").some((target) => target.id === storage.id))
        .map((pe) => ({ pe, hasDns: endpointZones(ctx, pe).length > 0 }))
    : [];
  const vnet = subnet ? subnetVnet(ctx, subnet) : null;
  const storageDnsLinks: SiteHosting["storageDnsLinks"] = [];
  if (vnet) {
    for (const { pe } of storageEndpoints) {
      for (const zone of endpointZones(ctx, pe)) {
        if (zoneVnets(ctx, zone).some((linked) => linked.id === vnet.id) && !storageDnsLinks.some((link) => link.zone.id === zone.id)) {
          storageDnsLinks.push({ zone, vnet });
        }
      }
    }
  }
  return {
    plan,
    family,
    image,
    registry,
    pullIdentity,
    subnet,
    appInsights: targetOfType(ctx, node.id, "diagnostic", "applicationInsights") ?? null,
    storage,
    userIdentities,
    workerRuntime: runtime === "dotnet" ? "dotnet-isolated" : runtime,
    flexVersion: flexRuntimeVersion(runtime, String(node.properties.runtimeVersion)),
    flex: node.type === "functionApp" && family === "flex",
    privateContentShare: privateStorage && needsContentShare(family),
    storageEndpoints,
    storageDnsLinks,
  };
}

// Content share for event-driven Function plans (Consumption and Elastic
// Premium); Flex and dedicated plans do not use one.
export function needsContentShare(family: PlanFamily): boolean {
  return family === "consumption" || family === "elastic";
}

export function contentShareName(ctx: GeneratorContext, node: GraphNode): string {
  return ctx.name(node.id).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63).replace(/-+$/, "");
}

export function deploymentContainerName(ctx: GeneratorContext, node: GraphNode): string {
  return `app-package-${ctx.name(node.id).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40)}`.replace(/-+$/, "");
}
