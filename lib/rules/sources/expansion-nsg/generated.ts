// Expansion ruleset: Network Security Groups.
// Re-encodes a curated subset of PSRule for Azure, Checkov and Azure Policy
// built-in NSG controls against Bunya's *extended* nsgSchema (inboundRules /
// outboundRules arrays in lib/catalogue/services.ts).
//
// Each rule cites its upstream rule ID and canonical doc URL. Predicates that
// rely on properties Bunya does not yet model are marked [advisory] and have
// a `() => false` predicate. Predicates that rely on `inboundRules` short-
// circuit when the array is empty/undefined so legacy graphs (pre-extension)
// surface no false positives.

import { nodeRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";
import type { GraphNode } from "@/lib/graph/schema";

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

function portMatches(range: string | undefined, port: string): boolean {
  if (range === undefined) return false;
  if (range === "*") return true;
  if (range === port) return true;
  // Comma-separated list (e.g. "22,3389").
  if (range.includes(",")) {
    return range.split(",").map((s) => s.trim()).includes(port);
  }
  // Range form (e.g. "20-25").
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
  return prefix === "*" || prefix === "Internet" || prefix === "0.0.0.0/0";
}

export const EXPANSION_NSG_RULES: RuleEntry[] = [
  // 1. PSRULE.NSG.ANY-INBOUND-V2 — No Allow rule with `*` source on `*` port.
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

  // 2. PSRULE.NSG.NO-INTERNET-RDP — No inbound Allow on TCP 3389 from Internet/*.
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

  // 3. PSRULE.NSG.NO-INTERNET-SSH — No inbound Allow on TCP 22 from Internet/*.
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

  // 4. PSRULE.NSG.LATERAL-TRAVERSAL — No inbound Allow on SMB (445) or NetBIOS (137-139).
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

  // 5. CHECKOV.AZURE.160 — Disable forwarding inbound from internet.
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

  // 6. AZPOL.NSG.FLOW-LOGS — Flow logs configured (advisory; property not modelled).
  nodeRule({
    id: "AZPOL.NSG.FLOW-LOGS",
    source: {
      name: "Azure Policy built-ins",
      license: "MIT",
      version: "2026-04-01",
      url: "https://learn.microsoft.com/en-us/azure/governance/policy/samples/built-in-policies",
      ruleId: "Network Security Groups should have NSG Flow Logs enabled",
    },
    category: "observability",
    severity: "info",
    serviceTypes: ["networkSecurityGroup"],
    message:
      "[advisory] NSG should have Flow Logs enabled (manual review — property not modelled).",
    longExplanation:
      "The Azure Policy built-in *Network Security Groups should have NSG Flow Logs enabled* requires every NSG to emit flow logs to a Network Watcher and storage account so traffic can be audited and replayed for incident response. Bunya does not currently model the Flow Logs resource, so this rule is surfaced as advisory: confirm in your IaC or policy assignment that flowLogs is enabled with traffic analytics where appropriate.",
    tags: ["bunya", "azure-policy", "nsg", "flow-logs", "observability", "advisory"],
    predicate: () => false,
  }),
];
