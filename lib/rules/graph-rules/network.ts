import { graphRule, nodeRule } from "@/lib/rules/builders";
import type { Autofix, RuleEntry } from "@/lib/rules/schema";
import type { GraphDocument } from "@/lib/graph/schema";

const MS_LEARN = "Microsoft Learn";

function getProp<T = unknown>(node: { properties: Record<string, unknown> }, key: string): T | undefined {
  return node.properties[key] as T | undefined;
}

export const networkRules: RuleEntry[] = [
  // BUNYA.NET.001 — PE subnet must not be delegated to Microsoft.Web/serverFarms
  nodeRule({
    id: "BUNYA.NET.001",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/virtual-network/subnet-delegation-overview",
      license: "CC-BY-4.0",
    },
    category: "network",
    severity: "warning",
    serviceTypes: ["subnet"],
    message:
      "Private Endpoint subnets must not be delegated to Microsoft.Web/serverFarms.",
    longExplanation:
      "Subnet delegation reserves a subnet for a single Azure service. A subnet delegated to Microsoft.Web/serverFarms is reserved for App Service VNet integration and cannot also host Private Endpoints. Mixing these workloads in one subnet causes deployment failures and surprising NIC behaviour, so PEs must live in an undelegated subnet.",
    tags: ["bunya", "private-link", "subnet", "delegation"],
    predicate: (node, graph) => {
      const delegations = (getProp<string[]>(node, "delegations") ?? []) as string[];
      const hostsPe = graph.edges.some((e) => {
        if (e.target !== node.id) return false;
        const src = graph.nodes.find((n) => n.id === e.source);
        return src?.type === "privateEndpoint";
      });
      if (!hostsPe) return false;
      return delegations.some((d) => d === "Microsoft.Web/serverFarms");
    },
  }),

  // BUNYA.NET.002 — PE subnet must have privateEndpointNetworkPolicies: "Disabled"
  nodeRule({
    id: "BUNYA.NET.002",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/private-link/disable-private-endpoint-network-policy",
      license: "CC-BY-4.0",
    },
    category: "network",
    severity: "error",
    serviceTypes: ["subnet"],
    message:
      "Subnet hosting a Private Endpoint must set privateEndpointNetworkPolicies to Disabled.",
    longExplanation:
      "Azure applies subnet-level network policies (NSG and UDR) to Private Endpoint NICs only when the subnet's privateEndpointNetworkPolicies property is Disabled. Leaving it Enabled prevents PEs from being created or routed correctly. Disable the policy on subnets that host Private Endpoints to keep deployments and traffic predictable.",
    tags: ["bunya", "private-link", "subnet", "network-policy"],
    autofixId: "set-pe-policy-disabled",
    autofixes: {
      "set-pe-policy-disabled": ((graph, finding) => {
        const id = finding.nodeIds?.[0];
        if (!id) return graph;
        return {
          ...graph,
          nodes: graph.nodes.map((n) =>
            n.id === id
              ? {
                  ...n,
                  properties: {
                    ...n.properties,
                    privateEndpointNetworkPolicies: "Disabled",
                  },
                }
              : n,
          ),
        };
      }) satisfies Autofix,
    },
    predicate: (node, graph) => {
      const hostsPe = graph.edges.some((e) => {
        if (e.target !== node.id) return false;
        if (e.kind !== "network") return false;
        const src = graph.nodes.find((n) => n.id === e.source);
        return src?.type === "privateEndpoint";
      });
      if (!hostsPe) return false;
      const policy = getProp<string>(node, "privateEndpointNetworkPolicies");
      return policy !== "Disabled";
    },
  }),

  // BUNYA.NET.003 — App Service VNet integration subnet vs PE subnet conflict
  nodeRule({
    id: "BUNYA.NET.003",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/app-service/overview-vnet-integration",
      license: "CC-BY-4.0",
    },
    category: "network",
    severity: "error",
    serviceTypes: ["subnet"],
    message:
      "App Service VNet integration subnets cannot also host Private Endpoints.",
    longExplanation:
      "App Service / Function App regional VNet integration requires a dedicated subnet delegated to Microsoft.Web/serverFarms; that subnet is then reserved for outbound integration NICs. Private Endpoints must live in a separate, undelegated subnet. A subnet that simultaneously receives traffic from compute and from a Private Endpoint will fail provisioning or behave unpredictably.",
    tags: ["bunya", "vnet-integration", "private-link", "subnet"],
    predicate: (node, graph) => {
      let hasCompute = false;
      let hasPe = false;
      for (const e of graph.edges) {
        if (e.target !== node.id) continue;
        if (e.kind !== "network") continue;
        const src = graph.nodes.find((n) => n.id === e.source);
        if (!src) continue;
        if (src.type === "appService" || src.type === "functionApp") hasCompute = true;
        if (src.type === "privateEndpoint") hasPe = true;
      }
      return hasCompute && hasPe;
    },
  }),

  // BUNYA.NET.004 — PE design without public ingress hop
  graphRule({
    id: "BUNYA.NET.004",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/private-link/private-link-faq",
      license: "CC-BY-4.0",
    },
    category: "network",
    severity: "warning",
    message:
      "Private Endpoint cannot accept direct public internet ingress.",
    longExplanation:
      "A Private Endpoint surfaces a resource on a VNet IP only and is not reachable from the public internet. If the design uses Private Endpoints inside a VNet but does not include Front Door, Application Gateway or API Management as a public ingress hop, end users will have no path into the workload. Add an ingress resource that bridges from the public internet into the VNet.",
    tags: ["bunya", "private-link", "ingress"],
    predicate: (graph) => {
      const vnets = graph.nodes.filter((n) => n.type === "virtualNetwork");
      if (vnets.length === 0) return [];
      const pes = graph.nodes.filter((n) => n.type === "privateEndpoint");
      if (pes.length === 0) return [];
      const ingressTypes = new Set(["frontDoor", "applicationGateway", "apiManagement"]);
      const hasIngress = graph.nodes.some((n) => ingressTypes.has(n.type));
      if (hasIngress) return [];
      // Target the PE-protected services for the finding nodeIds.
      const protectedTargets = new Set<string>();
      for (const pe of pes) {
        for (const e of graph.edges) {
          if (e.source === pe.id && e.kind === "network") {
            protectedTargets.add(e.target);
          }
        }
      }
      const nodeIds = protectedTargets.size > 0 ? [...protectedTargets] : pes.map((p) => p.id);
      return [{ nodeIds }];
    },
  }),

  // BUNYA.NET.005 — Public Storage in VNet-bearing graph without PE
  nodeRule({
    id: "BUNYA.NET.005",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/storage/common/storage-network-security",
      license: "CC-BY-4.0",
    },
    category: "network",
    severity: "warning",
    serviceTypes: ["storageAccount"],
    message:
      "Storage Account is publicly reachable while the design uses a VNet but no Private Endpoint.",
    longExplanation:
      "When a design includes a Virtual Network the intent is typically to keep data services off the public internet. A Storage Account that still permits public access and has no Private Endpoint contradicts that intent and leaves blob, file or table data reachable from anywhere. Either add a Private Endpoint and restrict public access, or be explicit about why public access is required.",
    tags: ["bunya", "storage", "private-link", "public-access"],
    predicate: (node, graph) => {
      const hasVnet = graph.nodes.some((n) => n.type === "virtualNetwork");
      if (!hasVnet) return false;
      const publicNetworkAccess = getProp<boolean | string>(node, "publicNetworkAccess");
      const allowPublicAccess = getProp<boolean>(node, "allowPublicAccess");
      const isPublic =
        publicNetworkAccess === true ||
        publicNetworkAccess === "Enabled" ||
        allowPublicAccess === true;
      if (!isPublic) return false;
      const hasPe = graph.edges.some((e) => {
        if (e.target !== node.id) return false;
        const src = graph.nodes.find((n) => n.id === e.source);
        return src?.type === "privateEndpoint";
      });
      return !hasPe;
    },
  }),

  // BUNYA.NET.006 — Subnet missing NSG association
  nodeRule({
    id: "BUNYA.NET.006",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview",
      license: "CC-BY-4.0",
    },
    category: "network",
    severity: "info",
    serviceTypes: ["subnet"],
    message: "Subnet has no Network Security Group associated.",
    longExplanation:
      "Network Security Groups are the primary stateful firewall for subnets in Azure and most CIS and ASB controls expect every subnet to carry one. A subnet without an NSG falls back to default platform rules, which permit broad east-west and internet traffic. Associate an NSG to make ingress and egress intent explicit and auditable.",
    tags: ["bunya", "nsg", "subnet", "defence-in-depth"],
    predicate: (node, graph) => {
      const hasVnet = graph.nodes.some((n) => n.type === "virtualNetwork");
      if (!hasVnet) return false;
      const hasNsg = graph.edges.some((e) => {
        if (e.kind !== "network") return false;
        // Subnet -> NSG association
        if (e.source === node.id) {
          const tgt = graph.nodes.find((n) => n.id === e.target);
          if (tgt?.type === "networkSecurityGroup") return true;
        }
        // Or NSG -> Subnet association
        if (e.target === node.id) {
          const src = graph.nodes.find((n) => n.id === e.source);
          if (src?.type === "networkSecurityGroup") return true;
        }
        return false;
      });
      return !hasNsg;
    },
  }),

  // BUNYA.NET.007 — AppGw points at private backend but is not joined to a subnet
  nodeRule({
    id: "BUNYA.NET.007",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/application-gateway/configuration-infrastructure",
      license: "CC-BY-4.0",
    },
    category: "network",
    severity: "warning",
    serviceTypes: ["applicationGateway"],
    message:
      "Application Gateway has a private backend but is not joined to a subnet.",
    longExplanation:
      "Application Gateway must live in its own dedicated subnet inside the VNet that hosts (or peers to) its backends. If a backend has publicNetworkAccess disabled the gateway must reach it over private networking, which is impossible without a subnet attachment. Wire the Application Gateway to a /24 (or larger) subnet in the same VNet as the backend before going to production.",
    tags: ["bunya", "application-gateway", "subnet", "private-backend"],
    predicate: (node, graph) => {
      const joinedToSubnet = graph.edges.some((e) => {
        if (e.source !== node.id || e.kind !== "network") return false;
        const tgt = graph.nodes.find((n) => n.id === e.target);
        return tgt?.type === "subnet";
      });
      if (joinedToSubnet) return false;
      // Look for any backend (appService/functionApp) wired from this AGW with publicNetworkAccess false
      return graph.edges.some((e) => {
        if (e.source !== node.id) return false;
        const tgt = graph.nodes.find((n) => n.id === e.target);
        if (!tgt) return false;
        if (tgt.type !== "appService" && tgt.type !== "functionApp") return false;
        const pna = getProp<boolean | string>(tgt, "publicNetworkAccess");
        return pna === false || pna === "Disabled";
      });
    },
  }),

  // BUNYA.NET.008 — Front Door origin is private but no Private Link origin configured
  nodeRule({
    id: "BUNYA.NET.008",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/frontdoor/private-link",
      license: "CC-BY-4.0",
    },
    category: "network",
    severity: "warning",
    serviceTypes: ["frontDoor"],
    message:
      "Front Door origin has public access disabled but no Private Link origin is configured.",
    longExplanation:
      "Front Door reaches public origins over the internet by default. When an origin App Service or Function App disables public network access, Front Door must connect through a Private Link origin (Premium SKU) and the origin must have a corresponding Private Endpoint. Without that wiring, requests from Front Door cannot reach the origin and the workload appears offline.",
    tags: ["bunya", "front-door", "private-link", "origin"],
    predicate: (node, graph) => {
      for (const e of graph.edges) {
        if (e.source !== node.id) continue;
        const tgt = graph.nodes.find((n) => n.id === e.target);
        if (!tgt) continue;
        if (tgt.type !== "appService" && tgt.type !== "functionApp") continue;
        const pna = getProp<boolean | string>(tgt, "publicNetworkAccess");
        const isPrivate = pna === false || pna === "Disabled";
        if (!isPrivate) continue;
        const hasPe = graph.edges.some((pe) => {
          if (pe.target !== tgt.id) return false;
          const src = graph.nodes.find((n) => n.id === pe.source);
          return src?.type === "privateEndpoint";
        });
        if (!hasPe) return true;
      }
      return false;
    },
  }),

  // BUNYA.NET.009 — Virtual Network with no subnet
  nodeRule({
    id: "BUNYA.NET.009",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-overview",
      license: "CC-BY-4.0",
    },
    category: "network",
    severity: "info",
    serviceTypes: ["virtualNetwork"],
    message: "Virtual Network has no subnet defined.",
    longExplanation:
      "A Virtual Network is just an address space until subnets are carved out of it; resources can only be attached to subnets, never to the VNet itself. A VNet with no subnet is unusable and almost always indicates an incomplete design. Add at least one subnet (for example a default workload subnet and a PrivateEndpoint subnet) before deploying.",
    tags: ["bunya", "virtual-network", "subnet"],
    predicate: (node, graph) => {
      const hasSubnet = graph.edges.some((e) => {
        if (e.target !== node.id) return false;
        const src = graph.nodes.find((n) => n.id === e.source);
        return src?.type === "subnet";
      });
      return !hasSubnet;
    },
  }),

  // BUNYA.NET.010 — Two PEs to the same target with the same groupId
  graphRule({
    id: "BUNYA.NET.010",
    source: {
      name: MS_LEARN,
      url: "https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-overview",
      license: "CC-BY-4.0",
    },
    category: "network",
    severity: "info",
    message:
      "Two Private Endpoints point at the same target without distinct groupIds.",
    longExplanation:
      "Each Private Endpoint binds to a single sub-resource of its target via a groupId (for example blob, file, vault, sites). Two endpoints to the same target with the same groupId duplicate the same private connection and waste IP space and cost without adding capability. If you need separate endpoints they should target different sub-resources, so each Private Endpoint should have a distinct groupId.",
    tags: ["bunya", "private-link", "group-id", "duplication"],
    predicate: (graph: GraphDocument) => {
      const pes = graph.nodes.filter((n) => n.type === "privateEndpoint");
      // For every target, collect (peId, groupId)
      const byTarget = new Map<string, Array<{ peId: string; groupId: string | undefined }>>();
      for (const pe of pes) {
        const targets = graph.edges
          .filter((e) => e.source === pe.id && e.kind === "network")
          .map((e) => e.target)
          .filter((tid) => {
            const tgt = graph.nodes.find((n) => n.id === tid);
            return tgt && tgt.type !== "subnet";
          });
        for (const tid of targets) {
          const list = byTarget.get(tid) ?? [];
          list.push({ peId: pe.id, groupId: getProp<string>(pe, "groupId") });
          byTarget.set(tid, list);
        }
      }
      const findings: ReturnType<Parameters<typeof graphRule>[0]["predicate"]> = [];
      for (const [targetId, entries] of byTarget) {
        if (entries.length < 2) continue;
        // Group by groupId to find collisions
        const seen = new Map<string, string[]>();
        for (const ent of entries) {
          const key = ent.groupId ?? "__undefined__";
          const arr = seen.get(key) ?? [];
          arr.push(ent.peId);
          seen.set(key, arr);
        }
        for (const peIds of seen.values()) {
          if (peIds.length >= 2) {
            findings.push({ nodeIds: [...peIds, targetId] });
          }
        }
      }
      return findings;
    },
  }),
];
