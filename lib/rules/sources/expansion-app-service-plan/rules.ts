// App Service Plan rules curated from PSRule for Azure, Azure Policy built-ins,
// Checkov and Microsoft Learn.
// Rules prefixed [advisory] document controls Bunya's property model cannot
// evaluate; their predicates never fire.
import { graphRule, nodeRule, nodesOfType } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";
import type { GraphDocument, GraphNode } from "@/lib/graph/schema";
import { siteRegistry, sitePlan } from "@/lib/graph/topology";
import { planFamily, planSkuTier } from "@/lib/catalogue/app-service-plans";

const FUNCTIONS_SCALE_SOURCE = {
  name: "Microsoft Learn — Azure Functions hosting options and scale",
  license: "CC-BY-4.0",
  url: "https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale",
} as const;

const APP_SERVICE_HOSTING_SOURCE = {
  name: "Microsoft Learn — Azure App Service hosting plans",
  license: "CC-BY-4.0",
  url: "https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans",
} as const;

// Basic and Premium v2 workers bill per vCPU-hour without scaling the way the
// Functions docs assume; every other plan family or tier suits a lone Function App.
const LONELY_FUNCTION_TIERS_FLAGGED = new Set(["Basic", "PremiumV2"]);

// App Service runtimes that Bunya deploys as Linux web apps. If the plan os is
// Windows the deployment will fail at provisioning time.
const LINUX_ONLY_RUNTIMES = new Set(["node", "python"]);

const NAME_PATTERN = /^[a-zA-Z0-9-]+$/;

export const EXPANSION_APP_SERVICE_PLAN_RULES: RuleEntry[] = [
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
      typeof n.properties.sku === "string" && planSkuTier(n.properties.sku) === "Basic",
  }),

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

  nodeRule({
    id: "AZPOL.APPSERVICEPLAN.AUTOSCALE",
    source: {
      name: "Azure Monitor autoscale",
      license: "CC-BY-4.0",
      url: "https://learn.microsoft.com/en-us/azure/azure-monitor/autoscale/autoscale-get-started",
      ruleId: "Autoscale for App Service plans",
    },
    category: "reliability",
    severity: "info",
    serviceTypes: ["appServicePlan"],
    message:
      "[advisory] Premium App Service Plan should allow autoscale beyond a single worker in production.",
    longExplanation:
      "Azure Monitor autoscale settings let a Premium App Service plan scale beyond a single worker when load rises. There is no built-in Azure Policy for this setting, so it cannot be exported as a policy assignment. Bunya does not model the Microsoft.Insights/autoscaleSettings resource on the App Service plan, so this rule is surfaced as guidance rather than auto-flagged. Configure an autoscale rule in your IaC alongside the plan.",
    tags: ["bunya", "azure-monitor", "app-service-plan", "autoscale", "advisory", "expansion"],
    predicate: () => false,
  }),

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

  graphRule({
    id: "BUNYA.COST.PLAN-CONSUMPTION-FOR-LONELY-FN",
    source: FUNCTIONS_SCALE_SOURCE,
    category: "cost",
    severity: "info",
    message:
      "Function App is the only workload on its App Service Plan, but the plan SKU is not consumption-friendly.",
    longExplanation:
      "Azure Functions scales most efficiently on Consumption, Flex Consumption, or a Premium-style App Service Plan (S1 or P*v3). When a Function App is the sole tenant of a Dedicated plan that is not in that set the workload pays per vCPU-hour even when idle and cannot scale out as the docs assume. Either move the Function App to a consumption-friendly SKU or co-locate additional compute on the plan to amortise its cost.",
    tags: ["bunya", "cost", "app-service-plan", "functions", "expansion"],
    predicate: (graph) => {
      const findings: Array<{ nodeIds?: string[]; message?: string }> = [];
      for (const plan of nodesOfType(graph, "appServicePlan")) {
        const nested = graph.nodes.filter(
          (n) =>
            n.parentId === plan.id &&
            (n.type === "appService" || n.type === "functionApp"),
        );
        const explicit = graph.edges
          .filter((e) => e.target === plan.id && e.kind === "depends_on")
          .map((e) => graph.nodes.find((n) => n.id === e.source))
          .filter((n): n is GraphNode => Boolean(n))
          .filter((n) => n.type === "appService" || n.type === "functionApp");
        const attached = [...new Map([...nested, ...explicit].map((n) => [n.id, n])).values()];
        if (attached.length !== 1) continue;
        if (attached[0].type !== "functionApp") continue;
        const sku = (plan.properties as { sku?: string }).sku;
        if (!sku) continue;
        if (!LONELY_FUNCTION_TIERS_FLAGGED.has(planSkuTier(sku))) continue;
        findings.push({
          nodeIds: [plan.id, attached[0].id],
          message: `Plan SKU ${sku} is not consumption-friendly for the lone Function App attached to it.`,
        });
      }
      return findings;
    },
  }),

  nodeRule({
    id: "BUNYA.COST.PLAN-LINUX-CONSUMPTION-RETIRING",
    source: {
      name: "Microsoft Learn — Migrate Consumption plan apps to the Flex Consumption plan",
      license: "CC-BY-4.0",
      url: "https://learn.microsoft.com/en-us/azure/azure-functions/migration/migrate-plan-consumption-to-flex",
    },
    category: "cost",
    severity: "warning",
    serviceTypes: ["appServicePlan"],
    message: "Linux Consumption (Y1) plans retire on 30 September 2028; use Flex Consumption (FC1) for new Function Apps.",
    longExplanation:
      "Microsoft is retiring Function Apps on Linux in a Consumption plan on 30 September 2028, and the plan gets no new features or language versions. Flex Consumption (FC1) is the replacement: it also bills per execution, scales to zero, and adds VNet integration and larger instances. Bunya exports Linux sites, so a Y1 plan here is a Linux Consumption plan.",
    tags: ["bunya", "app-service-plan", "functions", "retirement"],
    predicate: (node) => planFamily(node.properties.sku) === "consumption",
  }),

  graphRule({
    id: "BUNYA.COMP.PLAN-OS-MISMATCH",
    source: APP_SERVICE_HOSTING_SOURCE,
    category: "compliance",
    severity: "error",
    message:
      "App Service or Function App runtime requires a Linux App Service Plan but the plan is configured for Windows.",
    longExplanation:
      "Azure App Service plans are pinned to a single OS at create time, and Bunya emits node and python web workloads as Linux App Services. Attaching a node or python app to a Windows plan will fail at provisioning, and even if it deploys it cannot use the Linux-only runtime stacks. Switch the plan os to Linux or move the workload to a Linux plan.",
    tags: ["bunya", "compliance", "app-service-plan", "linux", "expansion"],
    predicate: (graph) => {
      const findings: Array<{ nodeIds?: string[]; message?: string }> = [];
      const compute = [
        ...nodesOfType(graph, "appService"),
        ...nodesOfType(graph, "functionApp"),
      ];
      for (const c of compute) {
        const runtime = (c.properties as { runtime?: string }).runtime;
        if (!runtime || !LINUX_ONLY_RUNTIMES.has(runtime)) continue;
        const plan = sitePlan(graph, c);
        if (!plan) continue;
        const os = (plan.properties as { os?: string }).os;
        if (os && os !== "Linux") {
          findings.push({
            nodeIds: [c.id, plan.id],
            message: `${c.type} runtime '${runtime}' requires a Linux plan, but the attached plan os is '${os}'.`,
          });
        }
      }
      return findings;
    },
  }),

  graphRule({
    id: "BUNYA.IDN.PULL-SYSTEM-IDENTITY-FIRST-DEPLOY",
    source: {
      name: "Microsoft Learn — Use managed identity to pull images from Azure Container Registry",
      license: "CC-BY-4.0",
      url: "https://learn.microsoft.com/en-us/azure/app-service/configure-custom-container#use-managed-identity-to-pull-image-from-azure-container-registry",
    },
    category: "identity",
    severity: "warning",
    message: "The app pulls its image with its system-assigned identity, so the first pull after a new deployment can fail until the app restarts.",
    longExplanation:
      "A system-assigned identity is created with the app, so the AcrPull role assignment that lets it pull can only be made after the app exists, and it can take a few minutes to apply. Azure tries the first image pull straight away, so a brand new app often fails to start until it is restarted. Use a user-assigned identity for the pull (Bunya grants its AcrPull before creating the app), or restart the app once after the first deployment.",
    tags: ["bunya", "acr", "managed-identity", "containers"],
    predicate: (graph: GraphDocument) => {
      const findings: Array<{ nodeIds?: string[]; message?: string }> = [];
      for (const site of [...nodesOfType(graph, "appService"), ...nodesOfType(graph, "functionApp")]) {
        const registry = siteRegistry(graph, site);
        if (!registry) continue;
        const direct = graph.edges.some((edge) => edge.source === site.id && edge.target === registry.id && edge.kind === "identity");
        if (!direct) continue;
        findings.push({
          nodeIds: [site.id, registry.id],
          message: `${site.resourceName} pulls from ${registry.resourceName} with its system-assigned identity; the first pull after creation can fail until the app restarts. Pull with a user-assigned identity to avoid this.`,
        });
      }
      return findings;
    },
  }),
];
