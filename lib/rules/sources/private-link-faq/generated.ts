// Generated from Microsoft Learn — Azure Private Link FAQ (revision 2026-04-01).
// Each entry encodes one FAQ answer as a Bunya RuleEntry. Do not hand-edit;
// rerun the importer.
import { graphRule, nodeRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";
import type { GraphDocument, GraphNode } from "@/lib/graph/schema";

const FAQ_BASE = {
  name: "Azure Private Link FAQ",
  license: "CC-BY-4.0",
  url: "https://learn.microsoft.com/en-us/azure/private-link/private-link-faq",
  version: "2026-04-01",
} as const;

function getProp<T = unknown>(
  node: { properties: Record<string, unknown> },
  key: string,
): T | undefined {
  return node.properties[key] as T | undefined;
}

function nodesOfTypeLocal(graph: GraphDocument, type: GraphNode["type"]): GraphNode[] {
  return graph.nodes.filter((n) => n.type === type);
}

export const PRIVATE_LINK_RULES: RuleEntry[] = [
  // 1. FAQ.PE-NO-PUBLIC-INGRESS — Private Endpoint cannot accept public ingress directly.
  graphRule({
    id: "FAQ.PE-NO-PUBLIC-INGRESS",
    source: {
      ...FAQ_BASE,
      ruleId:
        "private-link-faq#can-private-endpoints-accept-traffic-from-the-public-internet",
      url: "https://learn.microsoft.com/en-us/azure/private-link/private-link-faq#can-private-endpoints-accept-traffic-from-the-public-internet",
    },
    category: "network",
    severity: "warning",
    message:
      "Private Endpoints cannot accept traffic from the public internet directly.",
    longExplanation:
      "The Private Link FAQ states that a Private Endpoint exposes its target service only on a private IP inside the VNet. Public clients therefore have no path to a PE-fronted resource unless the design includes a public ingress hop such as Front Door (with a Private Link origin), Application Gateway or API Management. A graph with Private Endpoints but no ingress resource will not be reachable from the internet.",
    tags: ["private-link", "faq", "ingress"],
    predicate: (graph) => {
      const pes = nodesOfTypeLocal(graph, "privateEndpoint");
      if (pes.length === 0) return [];
      const ingressTypes = new Set<GraphNode["type"]>([
        "frontDoor",
        "applicationGateway",
        "apiManagement",
      ]);
      const hasIngress = graph.nodes.some((n) => ingressTypes.has(n.type));
      if (hasIngress) return [];
      return [{ nodeIds: pes.map((p) => p.id) }];
    },
  }),

  // 2. FAQ.PE-DNS-INTEGRATION — PE requires Azure Private DNS Zone or matching custom DNS.
  nodeRule({
    id: "FAQ.PE-DNS-INTEGRATION",
    source: {
      ...FAQ_BASE,
      ruleId: "private-link-faq#how-can-i-configure-dns-for-my-private-endpoint",
      url: "https://learn.microsoft.com/en-us/azure/private-link/private-link-faq#how-can-i-configure-dns-for-my-private-endpoint",
    },
    category: "network",
    severity: "info",
    serviceTypes: ["privateEndpoint"],
    message:
      "Private Endpoint requires Azure Private DNS Zone or matching custom DNS resolution.",
    longExplanation:
      "Per the FAQ, clients only reach a Private Endpoint when the target FQDN resolves to the PE private IP. Bunya does not model DNS resources directly, so this advisory exists to remind designers that a Private DNS Zone (e.g. privatelink.blob.core.windows.net) or an equivalent custom DNS server entry must be configured alongside every Private Endpoint. Without that, clients fall back to the public FQDN and bypass the PE entirely.",
    tags: ["private-link", "faq", "dns", "advisory"],
    predicate: () => true,
  }),

  // 3. FAQ.PE-NIC-LOCATION — PE NIC must be in same region as PE resource.
  graphRule({
    id: "FAQ.PE-NIC-LOCATION",
    source: {
      ...FAQ_BASE,
      ruleId: "private-link-faq#can-the-private-endpoint-be-in-a-different-region-than-the-virtual-network-or-the-resource",
      url: "https://learn.microsoft.com/en-us/azure/private-link/private-link-faq#can-the-private-endpoint-be-in-a-different-region-than-the-virtual-network-or-the-resource",
    },
    category: "network",
    severity: "error",
    message:
      "Private Endpoint and its hosting subnet must be in the same region as the document.",
    longExplanation:
      "The FAQ states that a Private Endpoint resource and its NIC must live in the same Azure region as the Virtual Network that hosts it. Bunya stores the design region in metadata.region; if a privateEndpoint or its attached subnet/VNet carries a different region annotation, deployment will fail. Move the PE (and its subnet) into the same region as the rest of the workload.",
    tags: ["private-link", "faq", "region"],
    predicate: (graph) => {
      const docRegion = graph.metadata.region;
      const findings: Array<{ nodeIds?: string[] }> = [];
      const pes = nodesOfTypeLocal(graph, "privateEndpoint");
      for (const pe of pes) {
        const peRegion = getProp<string>(pe, "region");
        if (peRegion && peRegion !== docRegion) {
          findings.push({ nodeIds: [pe.id] });
          continue;
        }
        // Best-effort: look at the subnet/vnet the PE is attached to.
        for (const e of graph.edges) {
          if (e.source !== pe.id || e.kind !== "network") continue;
          const tgt = graph.nodes.find((n) => n.id === e.target);
          if (!tgt || tgt.type !== "subnet") continue;
          const subnetRegion = getProp<string>(tgt, "region");
          if (subnetRegion && subnetRegion !== docRegion) {
            findings.push({ nodeIds: [pe.id, tgt.id] });
          }
        }
      }
      return findings;
    },
  }),

  // 4. FAQ.PE-MULTIPLE-SUBSCRIPTIONS — Cross-subscription PE -> target is supported (advisory).
  nodeRule({
    id: "FAQ.PE-MULTIPLE-SUBSCRIPTIONS",
    source: {
      ...FAQ_BASE,
      ruleId: "private-link-faq#can-i-create-a-private-endpoint-to-a-resource-in-a-different-subscription",
      url: "https://learn.microsoft.com/en-us/azure/private-link/private-link-faq#can-i-create-a-private-endpoint-to-a-resource-in-a-different-subscription",
    },
    category: "network",
    severity: "info",
    serviceTypes: ["privateEndpoint"],
    message:
      "Private Endpoints can target services in another subscription with manual approval.",
    longExplanation:
      "The FAQ confirms that a Private Endpoint can connect to a target service that lives in a different Azure subscription (and even a different tenant) provided the connection is manually approved by the owner of the target. Bunya does not model subscription boundaries, but designers should set manualApproval=true on cross-subscription PEs so the deployment workflow waits for the target owner's approval.",
    tags: ["private-link", "faq", "subscription", "advisory"],
    predicate: () => true,
  }),

  // 5. FAQ.PE-NSG-FLOW-LOGS — Flow logs do not capture PE inbound traffic on older platform versions.
  nodeRule({
    id: "FAQ.PE-NSG-FLOW-LOGS",
    source: {
      ...FAQ_BASE,
      ruleId: "private-link-faq#are-network-security-groups-supported-on-private-endpoints",
      url: "https://learn.microsoft.com/en-us/azure/private-link/private-link-faq#are-network-security-groups-supported-on-private-endpoints",
    },
    category: "network",
    severity: "info",
    serviceTypes: ["privateEndpoint"],
    message:
      "NSG flow logs may not capture inbound traffic to Private Endpoints on older platform versions.",
    longExplanation:
      "The FAQ notes that NSG enforcement and flow log capture for Private Endpoints depend on the subnet's PrivateEndpointNetworkPolicies setting and the underlying platform version. Designs that rely on flow logs for compliance or forensics should confirm that the subscription is on the current platform release and that NSGs are explicitly evaluated against PE traffic. Treat this as an advisory whenever Private Endpoints are part of an audit-sensitive workload.",
    tags: ["private-link", "faq", "nsg", "flow-logs", "advisory"],
    predicate: () => true,
  }),

  // 6. FAQ.PE-DELETE-LOCK — PEs must be removed before deleting the target service.
  nodeRule({
    id: "FAQ.PE-DELETE-LOCK",
    source: {
      ...FAQ_BASE,
      ruleId: "private-link-faq#what-happens-if-i-delete-the-target-resource-of-a-private-endpoint",
      url: "https://learn.microsoft.com/en-us/azure/private-link/private-link-faq#what-happens-if-i-delete-the-target-resource-of-a-private-endpoint",
    },
    category: "network",
    severity: "info",
    serviceTypes: ["privateEndpoint"],
    message:
      "Active Private Endpoints must be removed before the target service can be deleted cleanly.",
    longExplanation:
      "The FAQ explains that deleting a target service while a Private Endpoint still connects to it leaves orphan connections that block re-creation and confuse downstream DNS. The supported teardown order is: detach (or delete) every Private Endpoint first, then delete the target resource. This advisory exists so the deployment runbook for any PE-bearing design includes that step.",
    tags: ["private-link", "faq", "lifecycle", "advisory"],
    predicate: () => true,
  }),

  // 7. FAQ.PE-EGRESS-FROM-PE — Traffic to a PE is unidirectional inbound.
  nodeRule({
    id: "FAQ.PE-EGRESS-FROM-PE",
    source: {
      ...FAQ_BASE,
      ruleId: "private-link-faq#is-traffic-to-a-private-endpoint-unidirectional",
      url: "https://learn.microsoft.com/en-us/azure/private-link/private-link-faq#is-traffic-to-a-private-endpoint-unidirectional",
    },
    category: "network",
    severity: "info",
    serviceTypes: ["privateEndpoint"],
    message:
      "Traffic to a Private Endpoint is unidirectional inbound; reply traffic from the service uses standard egress.",
    longExplanation:
      "The FAQ clarifies that a Private Endpoint only carries inbound traffic from the VNet to the target service. The service's own outbound calls (for example a SQL database calling out to Key Vault, or a web app fetching from Storage) are not tunnelled back through the PE — they use the target service's normal egress path and service endpoints. Designers who assume the PE is a bidirectional tunnel will be surprised by outbound flows leaving via the public network.",
    tags: ["private-link", "faq", "egress", "advisory"],
    predicate: () => true,
  }),

  // 8. FAQ.PE-COSTS — Each Private Endpoint billed per-hour + per-GB.
  graphRule({
    id: "FAQ.PE-COSTS",
    source: {
      ...FAQ_BASE,
      ruleId: "private-link-faq#how-am-i-billed-for-private-link",
      url: "https://learn.microsoft.com/en-us/azure/private-link/private-link-faq#how-am-i-billed-for-private-link",
    },
    category: "network",
    severity: "info",
    message:
      "Design contains five or more Private Endpoints; review per-hour and per-GB Private Link charges.",
    longExplanation:
      "The FAQ notes that every Private Endpoint is billed per provisioned hour plus per GB of inbound and outbound data processed. The unit cost is small, but it compounds quickly across regions, environments and sub-resources (a Storage Account alone often needs blob, file, queue and table PEs). When a single design crosses five or more PEs the cost line item is worth budgeting explicitly rather than treating it as zero.",
    tags: ["private-link", "faq", "cost"],
    predicate: (graph) => {
      const pes = nodesOfTypeLocal(graph, "privateEndpoint");
      if (pes.length < 5) return [];
      return [{ nodeIds: pes.map((p) => p.id) }];
    },
  }),

  // 9. FAQ.PE-AVAILABLE-SERVICES — PE without explicit groupId is ambiguous.
  nodeRule({
    id: "FAQ.PE-AVAILABLE-SERVICES",
    source: {
      ...FAQ_BASE,
      ruleId: "private-link-faq#what-services-support-private-endpoints",
      url: "https://learn.microsoft.com/en-us/azure/private-link/private-link-faq#what-services-support-private-endpoints",
    },
    category: "network",
    severity: "warning",
    serviceTypes: ["privateEndpoint"],
    message:
      "Private Endpoint is missing a groupId; pick the specific sub-resource it should target.",
    longExplanation:
      "The FAQ lists the Azure services that support Private Link and the sub-resources (groupIds) each one exposes — for example a Storage Account offers blob, file, queue and table; a Key Vault offers vault. Bunya only models a subset of these services, and a Private Endpoint without a chosen groupId cannot be deployed because Azure has no way to decide which sub-resource to wire up. Set groupId to the specific sub-resource you want to expose.",
    tags: ["private-link", "faq", "group-id"],
    predicate: (node) => {
      const groupId = getProp<string>(node, "groupId");
      return !groupId || groupId.length === 0;
    },
  }),
];
