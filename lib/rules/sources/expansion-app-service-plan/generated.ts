// Auto-curated App Service Plan rule expansion, re-encoded for Bunya.
// Source bundles: PSRule for Azure (MIT), Azure Policy built-ins (CC-BY-4.0),
// Checkov for Azure (Apache-2.0), and Microsoft Learn (CC-BY-4.0).
// Each entry cites its upstream rule ID and canonical doc URL.
// Advisory rules whose check cannot run on Bunya's property model are
// marked [advisory] in the message and have a `() => false` predicate.

import { nodeRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";

const NAME_PATTERN = /^[a-zA-Z0-9-]+$/;

export const EXPANSION_APP_SERVICE_PLAN_RULES: RuleEntry[] = [
  // ---------------------------------------------------------------------------
  // 1. PSRULE.APPSERVICEPLAN.MIN-PLAN — Basic SKU in prod is too small.
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "PSRULE.APPSERVICEPLAN.MIN-PLAN",
    source: {
      name: "PSRule for Azure",
      license: "MIT",
      version: "v1.42.0",
      url: "https://azure.github.io/PSRule.Rules.Azure/en/rules/Azure.AppService.MinPlan/",
      ruleId: "Azure.AppService.MinPlan",
    },
    category: "reliability",
    severity: "warning",
    serviceTypes: ["appServicePlan"],
    message: "App Service Plan SKU is too small for a production workload.",
    longExplanation:
      "PSRule's Azure.AppService.MinPlan check requires production App Service Plans to sit on a Standard or Premium tier rather than Free, Shared or Basic. Basic SKUs do not get an availability SLA, lack VNet integration on Linux, and cannot scale beyond a small number of workers. Move prod plans to S1 or Premium v3.",
    tags: ["bunya", "psrule", "app-service-plan", "reliability", "expansion"],
    predicate: (n, graph) =>
      graph.metadata.environment === "prod" &&
      (n.properties.sku === "B1" || n.properties.sku === "B2"),
  }),

  // ---------------------------------------------------------------------------
  // 2. PSRULE.APPSERVICEPLAN.INSTANCES — Run at least 2 instances in prod.
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "PSRULE.APPSERVICEPLAN.INSTANCES",
    source: {
      name: "PSRule for Azure",
      license: "MIT",
      version: "v1.42.0",
      url: "https://azure.github.io/PSRule.Rules.Azure/en/rules/Azure.AppService.PlanInstanceCount/",
      ruleId: "Azure.AppService.PlanInstanceCount",
    },
    category: "reliability",
    severity: "warning",
    serviceTypes: ["appServicePlan"],
    message: "App Service Plan should run at least two instances in production.",
    longExplanation:
      "Azure.AppService.PlanInstanceCount requires production plans to have a capacity of at least 2 workers so that platform-initiated restarts, host updates and single-instance failures do not cause an outage. A single-instance plan also disables the App Service availability SLA. Increase the plan capacity to 2 or more in prod.",
    tags: ["bunya", "psrule", "app-service-plan", "reliability", "expansion"],
    predicate: (n, graph) => {
      if (graph.metadata.environment !== "prod") return false;
      const capacity = (n.properties as { capacity?: number }).capacity;
      return typeof capacity === "number" && capacity < 2;
    },
  }),

  // ---------------------------------------------------------------------------
  // 3. AZPOL.APPSERVICEPLAN.AUTOSCALE — Premium plan should allow autoscale.
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "AZPOL.APPSERVICEPLAN.AUTOSCALE",
    source: {
      name: "Azure Policy built-ins",
      license: "CC-BY-4.0",
      url: "https://learn.microsoft.com/en-us/azure/governance/policy/samples/built-in-policies",
      ruleId: "App Service Plans should have autoscale enabled",
    },
    category: "reliability",
    severity: "info",
    serviceTypes: ["appServicePlan"],
    message:
      "[advisory] Premium App Service Plan should allow autoscale beyond a single worker in production.",
    longExplanation:
      "The built-in Azure Policy 'App Service Plans should have autoscale enabled' checks for an autoscale setting attached to the plan that can scale beyond a single instance. Bunya does not model the Microsoft.Insights/autoscaleSettings resource on the App Service plan, so this rule is surfaced as guidance rather than auto-flagged. Configure an autoscale rule in your IaC alongside the plan.",
    tags: ["bunya", "azure-policy", "app-service-plan", "autoscale", "advisory", "expansion"],
    predicate: () => false,
  }),

  // ---------------------------------------------------------------------------
  // 4. BUNYA.NAM.APP-SERVICE-PLAN — Name length 1-40, charset [a-zA-Z0-9-].
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "BUNYA.NAM.APP-SERVICE-PLAN",
    source: {
      name: "Azure resource naming rules",
      license: "CC-BY-4.0",
      url: "https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules",
      ruleId: "Microsoft.Web/serverFarms",
    },
    category: "naming",
    severity: "error",
    serviceTypes: ["appServicePlan"],
    message:
      "App Service Plan name must be 1-40 characters and use only letters, numbers and hyphens.",
    longExplanation:
      "The Azure Resource Manager naming rules for Microsoft.Web/serverFarms restrict App Service Plan names to 1-40 characters drawn from the alphanumeric and hyphen alphabet. Names outside this range are rejected at deployment time, so the check is run on resourceName to catch the error before the IaC is shipped.",
    tags: ["bunya", "naming", "app-service-plan", "arm", "expansion"],
    predicate: (n) => {
      const name = n.resourceName;
      if (typeof name !== "string") return true;
      if (name.length < 1 || name.length > 40) return true;
      return !NAME_PATTERN.test(name);
    },
  }),

  // ---------------------------------------------------------------------------
  // 5. WAF.APPSERVICEPLAN.RELIABILITY-ZONES — Premium SKU should be zone-redundant.
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "WAF.APPSERVICEPLAN.RELIABILITY-ZONES",
    source: {
      name: "Azure Reliability — Availability zones overview",
      license: "CC-BY-4.0",
      url: "https://learn.microsoft.com/en-us/azure/reliability/availability-zones-overview",
      ruleId: "availability-zones-overview#app-service",
    },
    category: "reliability",
    severity: "info",
    serviceTypes: ["appServicePlan"],
    message:
      "[advisory] Premium App Service Plan in prod should be deployed zone-redundant across availability zones.",
    longExplanation:
      "The Well-Architected Framework reliability pillar and the Azure Reliability availability-zones overview recommend that Premium v3 App Service Plans in production are deployed with `zoneRedundant: true` so that a single-AZ failure does not take the plan offline. Bunya's appServicePlanSchema does not currently model zoneRedundant, so this rule is surfaced as guidance only; enforce zone redundancy in your IaC and reflect it once Bunya tracks the property.",
    tags: ["bunya", "well-architected", "app-service-plan", "availability-zones", "advisory", "expansion"],
    predicate: () => false,
  }),

  // ---------------------------------------------------------------------------
  // 6. CHECKOV.AZURE.APPSERVICEPLAN.FORCED-HTTPS — Plan-tier HTTPS enforcement.
  // ---------------------------------------------------------------------------
  nodeRule({
    id: "CHECKOV.AZURE.APPSERVICEPLAN.FORCED-HTTPS",
    source: {
      name: "Checkov for Azure",
      license: "Apache-2.0",
      url: "https://docs.bridgecrew.io/docs/ckv-azure-14",
      ruleId: "CKV_AZURE_14",
    },
    category: "compliance",
    severity: "info",
    serviceTypes: ["appServicePlan"],
    message:
      "[advisory] App Service Plan should lock its child sites to HTTPS-only at the plan tier.",
    longExplanation:
      "Checkov CKV_AZURE_14 verifies that App Service workloads enforce HTTPS. The plan tier itself does not carry an httpsOnly toggle in ARM, so this rule is surfaced as advisory: configure `httpsOnly: true` on every child appService / functionApp attached to the plan, and audit the plan periodically to confirm new children inherit the setting.",
    tags: ["bunya", "checkov", "app-service-plan", "https", "advisory", "expansion"],
    predicate: () => false,
  }),
];
