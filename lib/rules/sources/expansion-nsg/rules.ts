import { graphRule, nodeRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";
import type { GraphDocument, GraphNode } from "@/lib/graph/schema";
import type { nsgSchema } from "@/lib/catalogue/services";
import type { z } from "zod";

// Rules drawn before NSGs carried inboundRules/outboundRules have neither, so
// every field is optional and a missing list reads as empty.
type NsgRule = Partial<z.infer<typeof nsgSchema>["inboundRules"][number]>;

function rulesOf(node: GraphNode, key: "inboundRules" | "outboundRules"): NsgRule[] {
  const raw = node.properties[key];
  return Array.isArray(raw) ? (raw as NsgRule[]) : [];
}

const inboundRulesOf = (node: GraphNode) => rulesOf(node, "inboundRules");
const outboundRulesOf = (node: GraphNode) => rulesOf(node, "outboundRules");

function portMatches(range: string | undefined, port: string): boolean {
  if (range === undefined) return false;
  if (range === "*") return true;
  if (range === port) return true;
  if (range.includes(",")) {
    return range.split(",").map((s) => s.trim()).includes(port);
  }
  if (range.includes("-")) {
    const [lo, hi] = range.split("-").map((s) => Number(s.trim()));
    const p = Number(port);
    if (Number.isFinite(lo) && Number.isFinite(hi) && Number.isFinite(p)) {
      return p >= lo && p <= hi;
    }
  }
  return false;
}

function isInternetSource(prefix: string | undefined): boolean {
  return prefix === "*" || prefix === "Internet" || prefix === "0.0.0.0/0" || prefix === "::/0";
}

function coversGatewayPorts(range: string | undefined): boolean {
  if (range === "*") return true;
  const intervals = (range ?? "").split(",").map((part) => {
    const [low, high = low] = part.trim().split("-").map(Number);
    return [low, high];
  }).filter(([low, high]) => Number.isInteger(low) && Number.isInteger(high) && low <= high)
    .sort((a, b) => a[0] - b[0]);
  let next = 65200;
  for (const [low, high] of intervals) {
    if (low > next) break;
    if (high >= next) next = high + 1;
    if (next > 65535) return true;
  }
  return false;
}

export const EXPANSION_NSG_RULES: RuleEntry[] = [
  nodeRule({
    id: "PSRULE.NSG.ANY-INBOUND-V2",
    source: {
      name: "PSRule for Azure",
      license: "MIT",
      version: "v1.42.0",
      url: "https://azure.github.io/PSRule.Rules.Azure/en/rules/Azure.NSG.AnyInboundSource/",
      ruleId: "Azure.NSG.AnyInboundSource",
    },
    category: "network",
    severity: "error",
    serviceTypes: ["networkSecurityGroup"],
    message: "NSG must not Allow inbound traffic from any source on any port.",
    longExplanation:
      "A rule with `sourceAddressPrefix = \"*\"` and `destinationPortRange = \"*\"` set to Allow exposes every workload behind the NSG to the entire internet on every port. PSRule's Azure.NSG.AnyInboundSource flags this as a high-severity anti-pattern. Restrict the source to a specific service tag or CIDR and the destination port to the protocol actually needed.",
    tags: ["bunya", "psrule", "network", "nsg", "any-source"],
    predicate: (n) => {
      const rules = inboundRulesOf(n);
      return rules.some(
        (r) =>
          r.access === "Allow" &&
          isInternetSource(r.sourceAddressPrefix) &&
          (r.destinationPortRange === "*" || r.destinationPortRange === undefined),
      );
    },
  }),

  nodeRule({
    id: "PSRULE.NSG.NO-INTERNET-RDP",
    source: {
      name: "PSRule for Azure",
      license: "MIT",
      version: "v1.42.0",
      url: "https://azure.github.io/PSRule.Rules.Azure/en/rules/Azure.NSG.AdminRDP/",
      ruleId: "Azure.NSG.AdminRDP",
    },
    category: "network",
    severity: "error",
    serviceTypes: ["networkSecurityGroup"],
    message: "NSG must not allow inbound RDP (TCP 3389) from the internet.",
    longExplanation:
      "Inbound TCP 3389 from `*` or the `Internet` service tag exposes Remote Desktop to the public web and is one of the most frequently exploited paths into Azure VMs. Restrict 3389 to a bastion subnet, a jump-host CIDR, or a specific corporate IP range. Prefer Azure Bastion so the management surface is not internet-reachable at all.",
    tags: ["bunya", "psrule", "network", "rdp", "admin-port"],
    predicate: (n) => {
      const rules = inboundRulesOf(n);
      return rules.some(
        (r) =>
          r.access === "Allow" &&
          (r.protocol === "Tcp" || r.protocol === "*" || r.protocol === undefined) &&
          portMatches(r.destinationPortRange, "3389") &&
          isInternetSource(r.sourceAddressPrefix),
      );
    },
  }),

  nodeRule({
    id: "PSRULE.NSG.NO-INTERNET-SSH",
    source: {
      name: "PSRule for Azure",
      license: "MIT",
      version: "v1.42.0",
      url: "https://azure.github.io/PSRule.Rules.Azure/en/rules/Azure.NSG.AdminSSH/",
      ruleId: "Azure.NSG.AdminSSH",
    },
    category: "network",
    severity: "error",
    serviceTypes: ["networkSecurityGroup"],
    message: "NSG must not allow inbound SSH (TCP 22) from the internet.",
    longExplanation:
      "Inbound TCP 22 from `*` or the `Internet` service tag exposes SSH to brute-force and credential-stuffing campaigns. Restrict 22 to a bastion subnet, a jump host, or a specific operator CIDR. For most workloads Azure Bastion or just-in-time access via Microsoft Defender for Servers is the safer pattern.",
    tags: ["bunya", "psrule", "network", "ssh", "admin-port"],
    predicate: (n) => {
      const rules = inboundRulesOf(n);
      return rules.some(
        (r) =>
          r.access === "Allow" &&
          (r.protocol === "Tcp" || r.protocol === "*" || r.protocol === undefined) &&
          portMatches(r.destinationPortRange, "22") &&
          isInternetSource(r.sourceAddressPrefix),
      );
    },
  }),

  nodeRule({
    id: "PSRULE.NSG.LATERAL-TRAVERSAL",
    source: {
      name: "PSRule for Azure",
      license: "MIT",
      version: "v1.42.0",
      url: "https://azure.github.io/PSRule.Rules.Azure/en/rules/Azure.NSG.LateralTraversal/",
      ruleId: "Azure.NSG.LateralTraversal",
    },
    category: "network",
    severity: "warning",
    serviceTypes: ["networkSecurityGroup"],
    message:
      "NSG should not allow inbound SMB (445) or NetBIOS (137-139) — common lateral-movement vectors.",
    longExplanation:
      "SMB on TCP 445 and NetBIOS on UDP/TCP 137-139 are the protocols most frequently abused for lateral movement once an attacker has a foothold inside a VNet. PSRule's Azure.NSG.LateralTraversal recommends NSGs deny these ports east-west by default. Block 445 and 137-139 inbound unless a clearly scoped file-share workload requires them, and segment with subnet-level NSGs to limit blast radius.",
    tags: ["bunya", "psrule", "network", "smb", "netbios", "lateral-movement"],
    predicate: (n) => {
      const rules = inboundRulesOf(n);
      return rules.some((r) => {
        if (r.access !== "Allow") return false;
        const port = r.destinationPortRange;
        return (
          portMatches(port, "445") ||
          portMatches(port, "137") ||
          portMatches(port, "138") ||
          portMatches(port, "139")
        );
      });
    },
  }),

  nodeRule({
    id: "CHECKOV.AZURE.160",
    source: {
      name: "Checkov",
      license: "Apache-2.0",
      version: "v3.2.0",
      url: "https://docs.bridgecrew.io/docs/ckv-azure-160",
      ruleId: "CKV_AZURE_160",
    },
    category: "network",
    severity: "warning",
    serviceTypes: ["networkSecurityGroup"],
    message:
      "NSG should not blanket-Allow inbound traffic from the internet (Checkov CKV_AZURE_160).",
    longExplanation:
      "Checkov CKV_AZURE_160 flags NSGs that forward inbound traffic from the internet without restriction. Any Allow rule whose source is `*`, `Internet`, or `0.0.0.0/0` undermines the segmentation Azure customers expect from an NSG. Limit the source prefix to a specific service tag or CIDR, and prefer Front Door / Application Gateway as the single internet-facing hop.",
    tags: ["bunya", "checkov", "network", "nsg", "internet-forwarding"],
    predicate: (n) => {
      const rules = inboundRulesOf(n);
      return rules.some(
        (r) => r.access === "Allow" && isInternetSource(r.sourceAddressPrefix),
      );
    },
  }),

  nodeRule({
    id: "AZPOL.NSG.FLOW-LOGS",
    source: {
      name: "Azure Policy built-ins",
      license: "MIT",
      version: "2026-04-01",
      url: "https://learn.microsoft.com/en-us/azure/governance/policy/samples/built-in-policies",
      ruleId: "Audit flow logs configuration for every virtual network",
    },
    category: "observability",
    severity: "info",
    serviceTypes: ["networkSecurityGroup"],
    message:
      "[advisory] Traffic filtered by this NSG should be captured by virtual network flow logs (manual review — property not modelled).",
    longExplanation:
      "Flow logs let traffic through an NSG be audited and replayed during incident response. Microsoft has retired the creation of new NSG flow logs and recommends virtual network flow logs instead; the Azure Policy built-in *Audit flow logs configuration for every virtual network* checks that each virtual network has one. Bunya does not currently model the flow log resource, so this rule is advisory: confirm in your IaC or policy assignment that virtual network flow logs are enabled, with traffic analytics where appropriate.",
    tags: ["bunya", "azure-policy", "nsg", "flow-logs", "observability", "advisory"],
    predicate: () => false,
  }),

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
          if (e.target === nsg.id) {
            const src = graph.nodes.find((n) => n.id === e.source);
            if (src?.type === "subnet") return true;
          }
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
        const subnetIds = graph.edges
          .filter((e) => e.source === agw.id && e.kind === "network")
          .map((e) => e.target)
          .filter((tid) => {
            const tgt = graph.nodes.find((n) => n.id === tid);
            return tgt?.type === "subnet";
          });
        if (subnetIds.length === 0) continue;
        for (const subnetId of subnetIds) {
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
                (r.protocol === "Tcp" || r.protocol === "*") &&
                coversGatewayPorts(r.destinationPortRange),
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
