import { graphRule, nodeRule } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";

const AKS_TEMPLATE_SOURCE = {
  name: "Microsoft.ContainerService/managedClusters ARM template reference",
  url: "https://learn.microsoft.com/en-us/azure/templates/microsoft.containerservice/managedclusters",
  license: "CC-BY-4.0",
} as const;

const AKS_BASELINE_SOURCE = {
  name: "Azure Architecture Center AKS baseline architecture",
  url: "https://learn.microsoft.com/en-gb/azure/architecture/reference-architectures/containers/aks/baseline-aks",
  license: "CC-BY-4.0",
} as const;

const AKS_MONITOR_SOURCE = {
  name: "Azure Monitor best practices for Kubernetes",
  url: "https://learn.microsoft.com/en-us/azure/azure-monitor/containers/best-practices-containers",
  license: "CC-BY-4.0",
} as const;

const VMSS_TEMPLATE_SOURCE = {
  name: "Microsoft.Compute/virtualMachineScaleSets ARM template reference",
  url: "https://learn.microsoft.com/en-us/azure/templates/microsoft.compute/2024-07-01/virtualmachinescalesets",
  license: "CC-BY-4.0",
} as const;

const VMSS_REPAIR_SOURCE = {
  name: "Automatic instance repairs with Azure Virtual Machine Scale Sets",
  url: "https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/virtual-machine-scale-sets-automatic-instance-repairs",
  license: "CC-BY-4.0",
} as const;

const AKS_NETWORK_SOURCE = {
  name: "AKS network best practices",
  url: "https://learn.microsoft.com/en-us/azure/aks/operator-best-practices-network",
  license: "CC-BY-4.0",
} as const;

const AKS_POLICY_SOURCE = {
  name: "AKS network policy best practices",
  url: "https://learn.microsoft.com/en-us/azure/aks/network-policy-best-practices",
  license: "CC-BY-4.0",
} as const;

const VMSS_UPGRADE_SOURCE = {
  name: "Configure rolling upgrades on Virtual Machine Scale Sets",
  url: "https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/virtual-machine-scale-sets-configure-rolling-upgrades",
  license: "CC-BY-4.0",
} as const;

const VMSS_MONITOR_SOURCE = {
  name: "Enable monitoring for an Azure virtual machine scale set",
  url: "https://learn.microsoft.com/en-us/azure/azure-monitor/vm/tutorial-scale-set-enable-monitoring",
  license: "CC-BY-4.0",
} as const;

export const computeRules: RuleEntry[] = [
  nodeRule({
    id: "BUNYA.COMP.010",
    source: AKS_TEMPLATE_SOURCE,
    category: "identity",
    severity: "error",
    serviceTypes: ["aksCluster"],
    message: "AKS should deploy with a managed identity.",
    longExplanation:
      "AKS can use managed identity for Azure control-plane integration instead of a long-lived service principal. Bunya emits SystemAssigned identity by default; disabling it makes deployments harder to secure and usually forces secret rotation work back onto the operator.",
    tags: ["bunya", "aks", "identity", "deployment"],
    predicate: (n) => (n.properties as { managedIdentity?: boolean }).managedIdentity === false,
  }),
  graphRule({
    id: "BUNYA.COMP.011",
    source: AKS_BASELINE_SOURCE,
    category: "network",
    severity: "warning",
    appliesToServices: ["aksCluster"],
    message: "AKS should be wired to a subnet for production network control.",
    longExplanation:
      "A subnet edge lets Bunya generate the agentPoolProfiles.vnetSubnetID setting for Azure CNI clusters. Without it the cluster can still deploy, but the network boundary, route tables, NSGs and private connectivity are not explicit in the diagram.",
    tags: ["bunya", "aks", "network", "azure-cni"],
    predicate: (graph) =>
      graph.nodes
        .filter((n) => n.type === "aksCluster")
        .filter(
          (aks) =>
            !graph.edges.some(
              (e) =>
                e.source === aks.id &&
                e.kind === "network" &&
                graph.nodes.find((n) => n.id === e.target)?.type === "subnet",
            ),
        )
        .map((aks) => ({ nodeIds: [aks.id] })),
  }),
  graphRule({
    id: "BUNYA.COMP.012",
    source: AKS_MONITOR_SOURCE,
    category: "observability",
    severity: "warning",
    appliesToServices: ["aksCluster"],
    message: "AKS should send monitoring data to Log Analytics.",
    longExplanation:
      "AKS operations need container logs, node metrics, control-plane diagnostics and alerting. Add a diagnostic edge from AKS to a Log Analytics workspace so generated ARM/Bicep/Terraform enables the monitoring add-on or diagnostic path.",
    tags: ["bunya", "aks", "monitoring", "log-analytics"],
    predicate: (graph) =>
      graph.nodes
        .filter((n) => n.type === "aksCluster")
        .filter(
          (aks) =>
            !graph.edges.some(
              (e) =>
                e.source === aks.id &&
                e.kind === "diagnostic" &&
                graph.nodes.find((n) => n.id === e.target)?.type === "logAnalytics",
            ),
        )
        .map((aks) => ({ nodeIds: [aks.id] })),
  }),
  nodeRule({
    id: "BUNYA.COMP.013",
    source: AKS_BASELINE_SOURCE,
    category: "network",
    severity: "info",
    serviceTypes: ["aksCluster"],
    message: "Public AKS API server has no authorized IP ranges.",
    longExplanation:
      "For clusters that are not private, restrict the API server to trusted management IP ranges where possible. Leave authorizedIpRanges empty only when the cluster must be administered from unpredictable networks.",
    tags: ["bunya", "aks", "api-server", "hardening"],
    predicate: (n) => {
      const props = n.properties as { privateCluster?: boolean; authorizedIpRanges?: string[] };
      return props.privateCluster !== true && (props.authorizedIpRanges ?? []).length === 0;
    },
  }),
  nodeRule({
    id: "BUNYA.COMP.014",
    source: AKS_NETWORK_SOURCE,
    category: "network",
    severity: "warning",
    serviceTypes: ["aksCluster"],
    message: "AKS uses kubenet, which retires on 31 March 2028.",
    longExplanation:
      "Microsoft has announced kubenet networking retirement for AKS on 31 March 2028. New clusters should use Azure CNI or Azure CNI Overlay so IP planning, Network Policy, Private Link integration and future upgrades stay supportable. Treat any imported kubenet cluster as technical debt and plan migration before the retirement date.",
    tags: ["bunya", "aks", "kubenet", "retirement", "azure-cni"],
    predicate: (n) => (n.properties as { networkPlugin?: string }).networkPlugin === "kubenet",
  }),
  nodeRule({
    id: "BUNYA.COMP.015",
    source: AKS_POLICY_SOURCE,
    category: "network",
    severity: "warning",
    serviceTypes: ["aksCluster"],
    message: "Production AKS must not leave network policy disabled.",
    longExplanation:
      "Network Policy is the Kubernetes control used to limit pod-to-pod and pod-to-service traffic. In production, leaving networkPolicy set to none makes every pod broadly reachable inside the cluster and undermines namespace isolation. Use a supported policy engine and make the intended east-west traffic paths explicit.",
    tags: ["bunya", "aks", "network-policy", "prod", "zero-trust"],
    predicate: (n, graph) =>
      graph.metadata.environment === "prod" &&
      (n.properties as { networkPolicy?: string }).networkPolicy === "none",
  }),
  graphRule({
    id: "BUNYA.COMP.016",
    source: {
      name: "Authenticate with Azure Container Registry from AKS",
      url: "https://learn.microsoft.com/en-us/azure/aks/cluster-container-registry-integration",
      license: "CC-BY-4.0",
    },
    category: "identity",
    severity: "warning",
    appliesToServices: ["aksCluster"],
    message: "AKS should pull images from ACR using an identity edge.",
    longExplanation:
      "AKS production clusters almost always pull workload images from Azure Container Registry. The secure path is an AcrPull role assignment to the cluster or kubelet identity, represented in Bunya as an identity edge from AKS to ACR. Without that edge generated IaC cannot grant pull access and deployments fall back to manual role assignment or registry credentials.",
    tags: ["bunya", "aks", "acr", "identity", "acrpull"],
    predicate: (graph) =>
      graph.nodes
        .filter((n) => n.type === "aksCluster")
        .filter(
          (aks) =>
            !graph.edges.some(
              (e) =>
                e.source === aks.id &&
                e.kind === "identity" &&
                graph.nodes.find((n) => n.id === e.target)?.type === "containerRegistry",
            ),
        )
        .map((aks) => ({ nodeIds: [aks.id] })),
  }),
  nodeRule({
    id: "BUNYA.COMP.017",
    source: AKS_BASELINE_SOURCE,
    category: "reliability",
    severity: "warning",
    serviceTypes: ["aksCluster"],
    message: "Production AKS should model at least two availability zones.",
    longExplanation:
      "AKS node pools can span availability zones so a single datacenter failure does not remove the whole worker capacity pool. In production diagrams, model the zones explicitly so capacity, subnet IP planning and failure-domain assumptions are visible before deployment.",
    tags: ["bunya", "aks", "availability-zones", "reliability", "prod"],
    predicate: (n, graph) =>
      graph.metadata.environment === "prod" &&
      ((n.properties as { availabilityZones?: string[] }).availabilityZones ?? []).length < 2,
  }),
  graphRule({
    id: "BUNYA.COMP.020",
    source: VMSS_TEMPLATE_SOURCE,
    category: "network",
    severity: "error",
    appliesToServices: ["virtualMachineScaleSet"],
    message: "VMSS must attach NICs to a subnet.",
    longExplanation:
      "A VM scale set network profile needs a subnet reference for each NIC IP configuration. Add a network edge from the VMSS to a subnet so generated ARM, Bicep and Terraform can emit the subnet ID.",
    tags: ["bunya", "vmss", "network", "deployment"],
    predicate: (graph) =>
      graph.nodes
        .filter((n) => n.type === "virtualMachineScaleSet")
        .filter(
          (vmss) =>
            !graph.edges.some(
              (e) =>
                e.source === vmss.id &&
                e.kind === "network" &&
                graph.nodes.find((n) => n.id === e.target)?.type === "subnet",
            ),
        )
        .map((vmss) => ({ nodeIds: [vmss.id] })),
  }),
  nodeRule({
    id: "BUNYA.COMP.021",
    source: VMSS_REPAIR_SOURCE,
    category: "reliability",
    severity: "warning",
    serviceTypes: ["virtualMachineScaleSet"],
    message: "VMSS automatic instance repairs should be enabled.",
    longExplanation:
      "Automatic instance repairs replace, reimage or restart unhealthy instances after health monitoring reports a failure. Keep automaticRepairs enabled and pair it with a load balancer health probe or Application Health extension before production use.",
    tags: ["bunya", "vmss", "repairs", "availability"],
    predicate: (n) => (n.properties as { automaticRepairs?: boolean }).automaticRepairs === false,
  }),
  nodeRule({
    id: "BUNYA.COMP.022",
    source: VMSS_REPAIR_SOURCE,
    category: "reliability",
    severity: "info",
    serviceTypes: ["virtualMachineScaleSet"],
    message: "VMSS health probe or Application Health extension is not modelled.",
    longExplanation:
      "VMSS automatic repairs depend on health monitoring from a load balancer health probe or Application Health extension. Bunya cannot deploy that full app-specific probe yet, so capture the probe requirement before handing the template to an implementation team.",
    tags: ["bunya", "vmss", "health-probe", "deployment-tip"],
    predicate: (n) => (n.properties as { healthProbeConfigured?: boolean }).healthProbeConfigured !== true,
  }),
  nodeRule({
    id: "BUNYA.COMP.023",
    source: VMSS_UPGRADE_SOURCE,
    category: "reliability",
    severity: "warning",
    serviceTypes: ["virtualMachineScaleSet"],
    message: "Production VMSS should use rolling upgrades and health monitoring.",
    longExplanation:
      "Rolling upgrades are the safest update path for production VM scale sets because instances are updated in batches and health is checked before continuing. A production VMSS using Automatic or Manual upgrade mode without a health probe or Application Health extension risks either uncontrolled restarts or invisible drift. Set upgradeMode to Rolling and model the health probe requirement.",
    tags: ["bunya", "vmss", "rolling-upgrade", "health-probe", "prod"],
    predicate: (n, graph) => {
      if (graph.metadata.environment !== "prod") return false;
      const props = n.properties as { upgradeMode?: string; healthProbeConfigured?: boolean };
      return props.upgradeMode !== "Rolling" || props.healthProbeConfigured !== true;
    },
  }),
  graphRule({
    id: "BUNYA.COMP.024",
    source: VMSS_MONITOR_SOURCE,
    category: "observability",
    severity: "warning",
    appliesToServices: ["virtualMachineScaleSet"],
    message: "VMSS should send guest and platform monitoring to Log Analytics.",
    longExplanation:
      "VM scale sets emit platform metrics automatically, but production operations usually need guest OS telemetry collected by Azure Monitor Agent and routed to Log Analytics through a data collection rule. Model a diagnostic edge from VMSS to Log Analytics and set azureMonitorAgent when the exported ARM template includes the extension.",
    tags: ["bunya", "vmss", "azure-monitor-agent", "log-analytics"],
    predicate: (graph) =>
      graph.nodes
        .filter((n) => n.type === "virtualMachineScaleSet")
        .filter((vmss) => {
          const hasWorkspace = graph.edges.some(
            (e) =>
              e.source === vmss.id &&
              e.kind === "diagnostic" &&
              graph.nodes.find((n) => n.id === e.target)?.type === "logAnalytics",
          );
          const hasAgent = (vmss.properties as { azureMonitorAgent?: boolean }).azureMonitorAgent === true;
          return !hasWorkspace || !hasAgent;
        })
        .map((vmss) => ({ nodeIds: [vmss.id] })),
  }),
  nodeRule({
    id: "BUNYA.COMP.025",
    source: {
      name: "Architecture Best Practices for Azure Virtual Machines and Scale Sets",
      url: "https://learn.microsoft.com/en-us/azure/well-architected/service-guides/virtual-machines",
      license: "CC-BY-4.0",
    },
    category: "reliability",
    severity: "warning",
    serviceTypes: ["virtualMachineScaleSet"],
    message: "Production VMSS should model at least two availability zones.",
    longExplanation:
      "Availability zones separate VMSS instances across independent datacenter failure domains. For production scale sets, modelling at least two zones makes resilience expectations visible and lets generated templates preserve the intended zone spread.",
    tags: ["bunya", "vmss", "availability-zones", "reliability", "prod"],
    predicate: (n, graph) =>
      graph.metadata.environment === "prod" &&
      ((n.properties as { availabilityZones?: string[] }).availabilityZones ?? []).length < 2,
  }),
];
