// Graph-level rules for the App Service Plan expansion bundle.
// Companion to lib/rules/sources/expansion-app-service-plan/generated.ts.
//
// These rules look across the whole graph rather than at a single node so that
// they can correlate an App Service Plan's SKU/OS with the workloads attached
// to it (Function Apps, App Services) and emit findings on either the plan or
// the attached compute.

import { graphRule, nodesOfType } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";
import type { GraphDocument, GraphNode } from "@/lib/graph/schema";

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

// SKUs that are friendly to a lone Function App (per-execution-style billing or
// dedicated tiers that can scale efficiently for spiky compute). B1 / B2 / P1v3 /
// P2v3 are Dedicated tiers; S1 and the P*v3 tiers expose Premium-plan style
// scaling for Functions, so they are the recommended landing zone if you keep a
// Function App on a real plan instead of consumption.
const CONSUMPTION_FRIENDLY_SKUS = new Set(["S1", "P1v3", "P2v3"]);

// App Service runtimes that Bunya deploys as Linux web apps. If the plan os is
// Windows the deployment will fail at provisioning time.
const LINUX_ONLY_RUNTIMES = new Set(["node", "python"]);

function planForCompute(graph: GraphDocument, compute: GraphNode): GraphNode | undefined {
  if (compute.parentId) {
    const parent = graph.nodes.find((n) => n.id === compute.parentId);
    if (parent?.type === "appServicePlan") return parent;
  }
  const planEdge = graph.edges.find(
    (e) => e.source === compute.id && e.kind === "depends_on",
  );
  if (!planEdge) return undefined;
  const target = graph.nodes.find((n) => n.id === planEdge.target);
  return target?.type === "appServicePlan" ? target : undefined;
}

export const expansionAppServicePlanRules: RuleEntry[] = [
  // 7. BUNYA.COST.PLAN-CONSUMPTION-FOR-LONELY-FN
  //    Function App is the only compute attached to a plan that is not on a
  //    consumption-friendly SKU.
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
        // Find every compute node attached to this plan via nesting or depends_on.
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
        if (CONSUMPTION_FRIENDLY_SKUS.has(sku)) continue;
        findings.push({
          nodeIds: [plan.id, attached[0].id],
          message: `Plan SKU ${sku} is not consumption-friendly for the lone Function App attached to it.`,
        });
      }
      return findings;
    },
  }),

  // 8. BUNYA.COMP.PLAN-OS-MISMATCH
  //    App Service / Function App attached to a plan where plan.os is not Linux
  //    while the runtime is node or python (Bunya treats those as Linux web apps).
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
        const plan = planForCompute(graph, c);
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
];
