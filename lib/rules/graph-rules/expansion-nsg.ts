// Graph-level expansion rules for Network Security Groups.
// These rules sit on top of the extended nsgSchema in
// lib/catalogue/services.ts (inboundRules / outboundRules arrays) and look at
// edges between NSG, subnet and other resources to catch orphan NSGs,
// Application Gateway subnet requirements, and overly permissive egress.

import { graphRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";
import type { GraphDocument, GraphNode } from "@/lib/graph/schema";

type NsgRule = {
  name?: string;
  priority?: number;
  direction?: "Inbound" | "Outbound";
  access?: "Allow" | "Deny";
  protocol?: "Tcp" | "Udp" | "Icmp" | "*";
  sourceAddressPrefix?: string;
  destinationAddressPrefix?: string;
  destinationPortRange?: string;
};

function inboundRulesOf(node: GraphNode): NsgRule[] {
  const raw = node.properties.inboundRules as unknown;
  return Array.isArray(raw) ? (raw as NsgRule[]) : [];
}

function outboundRulesOf(node: GraphNode): NsgRule[] {
  const raw = node.properties.outboundRules as unknown;
  return Array.isArray(raw) ? (raw as NsgRule[]) : [];
}

function portContains(range: string | undefined, port: number): boolean {
  if (range === undefined) return false;
  if (range === "*") return true;
  if (range.includes(",")) {
    return range.split(",").map((s) => s.trim()).some((p) => Number(p) === port);
  }
  if (range.includes("-")) {
    const [lo, hi] = range.split("-").map((s) => Number(s.trim()));
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      return port >= lo && port <= hi;
    }
  }
  return Number(range) === port;
}

function rangesOverlap(range: string | undefined, lo: number, hi: number): boolean {
  if (range === undefined) return false;
  if (range === "*") return true;
  if (range.includes(",")) {
    return range
      .split(",")
      .map((s) => s.trim())
      .some((p) => {
        const n = Number(p);
        return Number.isFinite(n) && n >= lo && n <= hi;
      });
  }
  if (range.includes("-")) {
    const [a, b] = range.split("-").map((s) => Number(s.trim()));
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return a <= hi && b >= lo;
    }
  }
  const single = Number(range);
  return Number.isFinite(single) && single >= lo && single <= hi;
}

export const expansionNsgRules: RuleEntry[] = [
  // 7. BUNYA.NET.NSG-UNATTACHED — NSG with no incoming network edge from a subnet.
  graphRule({
    id: "BUNYA.NET.NSG-UNATTACHED",
    source: {
      name: "Microsoft Learn",
      license: "CC-BY-4.0",
      url: "https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview",
    },
    category: "network",
    severity: "info",
    message: "NSG is not attached to any subnet — it has no effect.",
    longExplanation:
      "An NSG only enforces rules when it is associated with a subnet (or a NIC). An NSG with no incoming `network` edge from any subnet is an orphan: its rules are evaluated against zero traffic and any control intent encoded in it is silently dropped. Either attach it to the subnet(s) it was authored for, or delete it to avoid drift between the diagram and reality.",
    tags: ["bunya", "network", "nsg", "orphan"],
    predicate: (graph: GraphDocument) => {
      const nsgs = graph.nodes.filter((n) => n.type === "networkSecurityGroup");
      const findings: Array<{ nodeIds: string[] }> = [];
      for (const nsg of nsgs) {
        const attached = graph.edges.some((e) => {
          if (e.kind !== "network") return false;
          // Subnet -> NSG association.
          if (e.target === nsg.id) {
            const src = graph.nodes.find((n) => n.id === e.source);
            if (src?.type === "subnet") return true;
          }
          // NSG -> Subnet association (less common but valid in some diagrams).
          if (e.source === nsg.id) {
            const tgt = graph.nodes.find((n) => n.id === e.target);
            if (tgt?.type === "subnet") return true;
          }
          return false;
        });
        if (!attached) findings.push({ nodeIds: [nsg.id] });
      }
      return findings;
    },
  }),

  // 8. BUNYA.NET.NSG-AGW-SUBNET-GATEWAYMANAGER — AGW subnet NSG must allow 65200-65535 from GatewayManager.
  graphRule({
    id: "BUNYA.NET.NSG-AGW-SUBNET-GATEWAYMANAGER",
    source: {
      name: "Microsoft Learn",
      license: "CC-BY-4.0",
      url: "https://learn.microsoft.com/en-us/azure/application-gateway/configuration-infrastructure#network-security-groups",
    },
    category: "network",
    severity: "warning",
    message:
      "[advisory] Application Gateway subnet's NSG should allow inbound 65200-65535 from the GatewayManager service tag.",
    longExplanation:
      "Application Gateway v2 receives health and management traffic from Azure on TCP ports 65200-65535, sourced from the `GatewayManager` service tag. If the NSG attached to the AGW subnet does not include an Allow rule covering that port range and source, the gateway can fail health probes or fall into a misconfigured state. This rule walks `applicationGateway -> subnet -> NSG` and checks the NSG's `inboundRules`; it stays silent if `inboundRules` is empty (legacy diagrams) to avoid noise.",
    tags: ["bunya", "network", "nsg", "application-gateway", "gateway-manager"],
    predicate: (graph: GraphDocument) => {
      const findings: Array<{ nodeIds: string[] }> = [];
      const agws = graph.nodes.filter((n) => n.type === "applicationGateway");
      for (const agw of agws) {
        // Find subnets the AGW joins via a network edge.
        const subnetIds = graph.edges
          .filter((e) => e.source === agw.id && e.kind === "network")
          .map((e) => e.target)
          .filter((tid) => {
            const tgt = graph.nodes.find((n) => n.id === tid);
            return tgt?.type === "subnet";
          });
        if (subnetIds.length === 0) continue;
        for (const subnetId of subnetIds) {
          // Find NSGs attached to that subnet via a network edge in either direction.
          const nsgIds = new Set<string>();
          for (const e of graph.edges) {
            if (e.kind !== "network") continue;
            if (e.source === subnetId) {
              const tgt = graph.nodes.find((n) => n.id === e.target);
              if (tgt?.type === "networkSecurityGroup") nsgIds.add(tgt.id);
            } else if (e.target === subnetId) {
              const src = graph.nodes.find((n) => n.id === e.source);
              if (src?.type === "networkSecurityGroup") nsgIds.add(src.id);
            }
          }
          for (const nsgId of nsgIds) {
            const nsg = graph.nodes.find((n) => n.id === nsgId);
            if (!nsg) continue;
            const rules = inboundRulesOf(nsg);
            if (rules.length === 0) continue; // advisory tone — skip when not modelled
            const ok = rules.some(
              (r) =>
                r.access === "Allow" &&
                r.sourceAddressPrefix === "GatewayManager" &&
                rangesOverlap(r.destinationPortRange, 65200, 65535),
            );
            if (!ok) {
              findings.push({ nodeIds: [nsg.id, subnetId, agw.id] });
            }
          }
        }
      }
      return findings;
    },
  }),

  // 9. BUNYA.NET.NSG-OUTBOUND-INTERNET-WIDE-OPEN — Outbound Allow rule with `*` destination is overly permissive.
  graphRule({
    id: "BUNYA.NET.NSG-OUTBOUND-INTERNET-WIDE-OPEN",
    source: {
      name: "Microsoft Learn",
      license: "CC-BY-4.0",
      url: "https://learn.microsoft.com/en-us/azure/virtual-network/security-overview",
    },
    category: "network",
    severity: "info",
    message:
      "NSG outbound Allow rule with `*` destination is overly permissive — narrow the destination service tag or CIDR.",
    longExplanation:
      "A wide-open outbound Allow rule (destination `*` or `Internet`) lets compromised workloads exfiltrate data to anywhere on the public internet. Microsoft Learn recommends narrowing egress to specific service tags (`Storage`, `Sql`, `AzureMonitor`, the relevant region) or to known partner CIDRs, and routing remaining internet egress through Azure Firewall or a managed proxy. Replace `*`-destination Allows with a least-privilege set of service-tag rules.",
    tags: ["bunya", "network", "nsg", "egress", "data-exfiltration"],
    predicate: (graph: GraphDocument) => {
      const findings: Array<{ nodeIds: string[] }> = [];
      const nsgs = graph.nodes.filter((n) => n.type === "networkSecurityGroup");
      for (const nsg of nsgs) {
        const rules = outboundRulesOf(nsg);
        const offending = rules.some(
          (r) =>
            r.access === "Allow" &&
            (r.destinationAddressPrefix === "*" ||
              r.destinationAddressPrefix === "Internet" ||
              r.destinationAddressPrefix === "0.0.0.0/0"),
        );
        if (offending) findings.push({ nodeIds: [nsg.id] });
      }
      return findings;
    },
  }),
];
