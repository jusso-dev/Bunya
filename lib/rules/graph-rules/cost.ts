import { nodeRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";

const APP_SERVICE_PLAN_SOURCE = {
  name: "Azure App Service hosting plans",
  url: "https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans",
  license: "CC-BY-4.0",
} as const;

const ACR_SKU_SOURCE = {
  name: "Azure Container Registry SKUs",
  url: "https://learn.microsoft.com/en-us/azure/container-registry/container-registry-skus",
  license: "CC-BY-4.0",
} as const;

const COSMOS_FREE_TIER_SOURCE = {
  name: "Azure Cosmos DB free tier",
  url: "https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier",
  license: "CC-BY-4.0",
} as const;

const FRONT_DOOR_TIER_SOURCE = {
  name: "Front Door tier comparison",
  url: "https://learn.microsoft.com/en-us/azure/frontdoor/standard-premium/tier-comparison",
  license: "CC-BY-4.0",
} as const;

const STORAGE_REDUNDANCY_SOURCE = {
  name: "Azure Storage redundancy options",
  url: "https://learn.microsoft.com/en-us/azure/storage/common/storage-redundancy",
  license: "CC-BY-4.0",
} as const;

export const costRules: RuleEntry[] = [
  nodeRule({
    id: "BUNYA.COST.001",
    source: APP_SERVICE_PLAN_SOURCE,
    category: "cost",
    severity: "info",
    serviceTypes: ["appServicePlan"],
    message:
      "Premium App Service Plan (P1v3/P2v3) has no App Service or Function App attached and is incurring fixed cost.",
    longExplanation:
      "Premium v3 App Service Plans bill per vCPU-hour regardless of workload. A premium plan with no attached compute is a common leftover from prototyping that quietly costs hundreds of dollars per month. Either attach a web/function app or downgrade the plan to a lower SKU.",
    tags: ["bunya", "cost", "app-service-plan"],
    predicate: (n, graph) => {
      const sku = (n.properties as { sku?: string }).sku;
      if (sku !== "P1v3" && sku !== "P2v3") return false;
      const attached =
        graph.nodes.some(
          (child) =>
            child.parentId === n.id &&
            (child.type === "appService" || child.type === "functionApp"),
        ) ||
        graph.edges.some((e) => {
          if (e.target !== n.id) return false;
          const src = graph.nodes.find((x) => x.id === e.source);
          return src?.type === "appService" || src?.type === "functionApp";
        });
      return !attached;
    },
  }),

  nodeRule({
    id: "BUNYA.COST.002",
    source: ACR_SKU_SOURCE,
    category: "cost",
    severity: "info",
    serviceTypes: ["containerRegistry"],
    message: "Container Registry SKU 'Premium' is rarely justified for dev/test environments.",
    longExplanation:
      "ACR Premium adds geo-replication, content trust and private link at a substantial fixed monthly cost. Dev and test environments almost never need those capabilities and can run on Basic or Standard, which still support service principals and webhooks.",
    tags: ["bunya", "cost", "container-registry"],
    predicate: (n, graph) => {
      const env = graph.metadata.environment;
      if (env !== "dev" && env !== "test") return false;
      const sku = (n.properties as { sku?: string }).sku;
      return sku === "Premium";
    },
  }),

  nodeRule({
    id: "BUNYA.COST.003",
    source: COSMOS_FREE_TIER_SOURCE,
    category: "cost",
    severity: "info",
    serviceTypes: ["cosmosDb"],
    message: "Cosmos DB in a dev environment is not using the free tier discount.",
    longExplanation:
      "Each Azure subscription is entitled to one Cosmos DB free-tier account that provides the first 1000 RU/s and 25 GB of storage at no cost. For dev workloads this almost always covers usage, so enabling freeTier on the dev account avoids unnecessary RU-based charges.",
    tags: ["bunya", "cost", "cosmos-db"],
    predicate: (n, graph) => {
      if (graph.metadata.environment !== "dev") return false;
      const freeTier = (n.properties as { freeTier?: boolean }).freeTier;
      return freeTier !== true;
    },
  }),

  nodeRule({
    id: "BUNYA.COST.004",
    source: FRONT_DOOR_TIER_SOURCE,
    category: "cost",
    severity: "info",
    serviceTypes: ["frontDoor"],
    message:
      "Front Door Premium SKU is configured but no WAF rule features are in use — Standard may be sufficient.",
    longExplanation:
      "The Premium tier of Azure Front Door is priced above Standard primarily for managed WAF rule sets, bot management and private origins. If you are not exercising those features the Standard tier delivers the same global edge for substantially less.",
    tags: ["bunya", "cost", "front-door", "waf"],
    predicate: (n) => {
      const props = n.properties as { sku?: string; wafPolicyId?: string; wafEnabled?: boolean };
      if (props.sku !== "Premium_AzureFrontDoor") return false;
      const hasWaf = Boolean(props.wafPolicyId) || props.wafEnabled === true;
      return !hasWaf;
    },
  }),

  nodeRule({
    id: "BUNYA.COST.005",
    source: STORAGE_REDUNDANCY_SOURCE,
    category: "cost",
    severity: "info",
    serviceTypes: ["storageAccount"],
    message:
      "Storage Account uses geo-redundant SKU (Standard_GRS/Standard_RAGRS) in a dev environment.",
    longExplanation:
      "Geo-redundant storage replicates every write to a paired region and roughly doubles the per-GB cost compared to LRS. Dev environments rarely justify cross-region durability and should typically use Standard_LRS or Standard_ZRS for the same workload.",
    tags: ["bunya", "cost", "storage", "redundancy"],
    predicate: (n, graph) => {
      if (graph.metadata.environment !== "dev") return false;
      const sku = (n.properties as { sku?: string }).sku;
      return sku === "Standard_GRS" || sku === "Standard_RAGRS";
    },
  }),
];
