import { graphRule } from "../builders";
import type { RuleEntry } from "../schema";

export const implicitRules: RuleEntry[] = [
  graphRule({
    id: "BUNYA.IMP.001",
    source: {
      name: "Azure Functions storage considerations",
      url: "https://learn.microsoft.com/en-us/azure/azure-functions/storage-considerations",
      license: "CC-BY-4.0",
    },
    category: "reliability",
    severity: "error",
    message: "Function App must have a backing Storage Account.",
    longExplanation:
      "Azure Functions require a general-purpose Storage Account to persist function code, host keys, and runtime state such as trigger lease blobs. Without a linked Storage Account the runtime fails to start and timer/queue triggers stop firing. Bunya auto-inserts one during code generation, but declaring the data edge explicitly avoids surprises at deploy time.",
    tags: ["bunya", "functions", "storage", "implicit"],
    predicate: (graph) => {
      const partials: Array<{ nodeIds?: string[]; autofixId?: string }> = [];
      for (const fn of graph.nodes.filter((n) => n.type === "functionApp")) {
        const hasStg = graph.edges.some(
          (e) =>
            e.source === fn.id &&
            e.kind === "data" &&
            graph.nodes.find((n) => n.id === e.target)?.type === "storageAccount",
        );
        if (!hasStg) partials.push({ nodeIds: [fn.id], autofixId: "add-storage" });
      }
      return partials;
    },
    autofixes: {
      "add-storage": (graph) => graph,
    },
  }),
  graphRule({
    id: "BUNYA.IMP.002",
    source: {
      name: "App Service hosting plans overview",
      url: "https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans",
      license: "CC-BY-4.0",
    },
    category: "reliability",
    severity: "error",
    message: "App Service / Function App must depend on an App Service Plan.",
    longExplanation:
      "Every App Service site (including Function Apps on a dedicated plan) runs on top of an App Service Plan that defines the SKU, OS and scale. A missing depends_on edge means deployment ordering is undefined and the site will fail to provision because its serverFarmId cannot be resolved. Bunya emits the dependency explicitly so the generated IaC creates the plan first.",
    tags: ["bunya", "app-service", "function-app", "implicit"],
    predicate: (graph) => {
      const partials: Array<{ nodeIds?: string[]; autofixId?: string }> = [];
      for (const site of graph.nodes.filter(
        (n) => n.type === "appService" || n.type === "functionApp",
      )) {
        const hasPlan = graph.edges.some(
          (e) =>
            e.source === site.id &&
            e.kind === "depends_on" &&
            graph.nodes.find((n) => n.id === e.target)?.type === "appServicePlan",
        );
        if (!hasPlan) partials.push({ nodeIds: [site.id], autofixId: "add-plan" });
      }
      return partials;
    },
  }),
  graphRule({
    id: "BUNYA.IMP.003",
    source: {
      name: "Manage subnets in an Azure virtual network",
      url: "https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-manage-subnet",
      license: "CC-BY-4.0",
    },
    category: "reliability",
    severity: "error",
    message: "Subnet must depend on a Virtual Network.",
    longExplanation:
      "Subnets are child resources of a Virtual Network and cannot exist without a parent VNet. The depends_on edge is the only signal Bunya has to derive parent scope and ARM resource path during code generation. Without it the subnet will fail to deploy or worse, be attached to the wrong VNet if multiple are defined.",
    tags: ["bunya", "network", "subnet", "implicit"],
    predicate: (graph) => {
      const partials: Array<{ nodeIds?: string[]; autofixId?: string }> = [];
      for (const subnet of graph.nodes.filter((n) => n.type === "subnet")) {
        const hasVnet = graph.edges.some(
          (e) =>
            e.source === subnet.id &&
            e.kind === "depends_on" &&
            graph.nodes.find((n) => n.id === e.target)?.type === "virtualNetwork",
        );
        if (!hasVnet) partials.push({ nodeIds: [subnet.id], autofixId: "add-vnet" });
      }
      return partials;
    },
  }),
  graphRule({
    id: "BUNYA.IMP.004",
    source: {
      name: "Manage a private endpoint",
      url: "https://learn.microsoft.com/en-us/azure/private-link/manage-private-endpoint",
      license: "CC-BY-4.0",
    },
    category: "reliability",
    severity: "error",
    message: "Private Endpoint must attach to a Subnet via a network edge.",
    longExplanation:
      "A Private Endpoint consumes a private IP from a Subnet in your VNet; the subnet reference is mandatory at create time. Without a network edge to a Subnet, Bunya cannot wire up the privateEndpoint's ipConfigurations and the deployment will fail validation. The Subnet must also have privateEndpointNetworkPolicies set appropriately, but the link itself is the first prerequisite.",
    tags: ["bunya", "network", "private-endpoint", "implicit"],
    predicate: (graph) => {
      const partials: Array<{ nodeIds?: string[]; autofixId?: string }> = [];
      for (const pe of graph.nodes.filter((n) => n.type === "privateEndpoint")) {
        const hasSubnet = graph.edges.some(
          (e) =>
            e.source === pe.id &&
            e.kind === "network" &&
            graph.nodes.find((n) => n.id === e.target)?.type === "subnet",
        );
        if (!hasSubnet) partials.push({ nodeIds: [pe.id], autofixId: "add-subnet" });
      }
      return partials;
    },
  }),
  graphRule({
    id: "BUNYA.IMP.005",
    source: {
      name: "Workspace-based Application Insights resources",
      url: "https://learn.microsoft.com/en-us/azure/azure-monitor/app/create-workspace-resource",
      license: "CC-BY-4.0",
    },
    category: "reliability",
    severity: "warning",
    message: "Application Insights should be workspace-based (link to a Log Analytics workspace).",
    longExplanation:
      "Classic (non-workspace) Application Insights components have been retired and new components must be backed by a Log Analytics workspace. Linking the component lets you use shared retention, RBAC and KQL across logs and APM data. Bunya represents this as a depends_on edge from the applicationInsights node to a logAnalytics node.",
    tags: ["bunya", "observability", "application-insights", "implicit"],
    predicate: (graph) => {
      const partials: Array<{ nodeIds?: string[]; autofixId?: string }> = [];
      for (const ai of graph.nodes.filter((n) => n.type === "applicationInsights")) {
        const hasWs = graph.edges.some(
          (e) =>
            e.source === ai.id &&
            e.kind === "depends_on" &&
            graph.nodes.find((n) => n.id === e.target)?.type === "logAnalytics",
        );
        if (!hasWs) partials.push({ nodeIds: [ai.id], autofixId: "add-workspace" });
      }
      return partials;
    },
  }),
];
