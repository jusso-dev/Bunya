import { graphRule } from "../builders";
import type { RuleEntry } from "../schema";

const AUSTRALIA_REGIONS = new Set([
  "australiaeast",
  "australiasoutheast",
  "australiacentral",
  "australiacentral2",
]);

export const sovereigntyRules: RuleEntry[] = [
  graphRule({
    id: "BUNYA.SOV.001",
    source: {
      name: "Cross-region replication in Azure",
      url: "https://learn.microsoft.com/en-us/azure/availability-zones/cross-region-replication-azure",
      license: "CC-BY-4.0",
    },
    category: "sovereignty",
    severity: "warning",
    message: "Document region is outside the Australia geography.",
    longExplanation:
      "Bunya is designed to default workloads into the Australia geography (australiaeast, australiasoutheast, australiacentral, australiacentral2) so that data at rest stays under Australian jurisdiction. A document metadata region outside that set means the generated resource group and child resources will be deployed offshore, which can breach data-residency commitments. Update metadata.region or confirm the workload is intentionally non-sovereign.",
    tags: ["bunya", "sovereignty", "data-sovereignty", "region"],
    predicate: (graph) => {
      const region = graph.metadata.region;
      if (AUSTRALIA_REGIONS.has(region)) return [];
      return [{}];
    },
  }),
  graphRule({
    id: "BUNYA.SOV.002",
    source: {
      name: "Manage Azure resource groups by using the Azure portal",
      url: "https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/manage-resource-groups-portal",
      license: "CC-BY-4.0",
    },
    category: "sovereignty",
    severity: "info",
    message: "Resource Group region differs from document metadata region.",
    longExplanation:
      "A Resource Group's location pins the metadata for that group and is the default for child resources created in the portal. When the resource group's region property differs from the document-level metadata.region, the generated IaC can end up with mismatched defaults and confusing audit trails. Either align them or document the split intentionally.",
    tags: ["bunya", "sovereignty", "resource-group", "region"],
    predicate: (graph) => {
      const docRegion = graph.metadata.region;
      const partials: Array<{ nodeIds?: string[] }> = [];
      for (const rg of graph.nodes.filter((n) => n.type === "resourceGroup")) {
        const rgRegion = rg.properties?.region;
        if (typeof rgRegion === "string" && rgRegion !== docRegion) {
          partials.push({ nodeIds: [rg.id] });
        }
      }
      return partials;
    },
  }),
  graphRule({
    id: "BUNYA.SOV.003",
    source: {
      name: "Distribute your data globally with Azure Cosmos DB",
      url: "https://learn.microsoft.com/en-us/azure/cosmos-db/distribute-data-globally",
      license: "CC-BY-4.0",
    },
    category: "sovereignty",
    severity: "warning",
    message: "Cosmos DB has multi-region writes enabled in an Australia-resident workload.",
    longExplanation:
      "Enabling multiRegionWrites on a Cosmos DB account is a deliberate choice to replicate data into additional Azure regions, which by default extends beyond the Australia geography. For workloads that are otherwise pinned to Australia this can silently move customer data offshore and break IRAP or contractual residency commitments. Either pin the additional write regions to Australia, disable multi-region writes, or document the deviation.",
    tags: ["bunya", "sovereignty", "data-sovereignty", "irap", "cosmos-db"],
    predicate: (graph) => {
      if (!AUSTRALIA_REGIONS.has(graph.metadata.region)) return [];
      const partials: Array<{ nodeIds?: string[] }> = [];
      for (const cosmos of graph.nodes.filter((n) => n.type === "cosmosDb")) {
        if (cosmos.properties?.multiRegionWrites === true) {
          partials.push({ nodeIds: [cosmos.id] });
        }
      }
      return partials;
    },
  }),
  graphRule({
    id: "BUNYA.SOV.004",
    source: {
      name: "What is Azure Front Door?",
      url: "https://learn.microsoft.com/en-us/azure/frontdoor/front-door-overview",
      license: "CC-BY-4.0",
    },
    category: "sovereignty",
    severity: "info",
    message: "Front Door is a global service; review when sovereignty matters.",
    longExplanation:
      "Azure Front Door is a global service whose edge points-of-presence sit outside any single Azure geography, and configuration metadata is stored at the global scope. Traffic flows through the global edge before reaching your regional origin, which is fine for most workloads but worth flagging on sovereignty-sensitive systems. Confirm that no customer data is cached or logged outside the Australia geography (for example, WAF logs go to a sovereign Log Analytics workspace).",
    tags: ["bunya", "sovereignty", "front-door", "global"],
    predicate: (graph) => {
      const partials: Array<{ nodeIds?: string[] }> = [];
      for (const fd of graph.nodes.filter((n) => n.type === "frontDoor")) {
        partials.push({ nodeIds: [fd.id] });
      }
      return partials;
    },
  }),
];
