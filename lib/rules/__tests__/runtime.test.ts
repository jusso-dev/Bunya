import { describe, expect, it } from "vitest";
import { runRules, applyAutofix } from "@/lib/rules/runtime";
import type { Finding } from "@/lib/rules/schema";
import { REGISTRY } from "@/lib/rules/registry";
import { healthyGraph } from "./fixtures/healthy";
import { brokenGraph } from "./fixtures/broken";
import { getServiceDefinition } from "@/lib/catalogue/services";
import type { GraphDocument, GraphNode, ServiceType } from "@/lib/graph/schema";
import { runtimeSupportStatus } from "@/lib/rules/graph-rules/compute";

function findingsForRule(findings: Finding[], ruleId: string): Finding[] {
  return findings.filter((f) => f.ruleId === ruleId);
}

function testNode(
  id: string,
  type: ServiceType,
  overrides: Record<string, unknown> = {},
): GraphNode {
  const def = getServiceDefinition(type);
  return {
    id,
    type,
    name: def.label,
    resourceName: id,
    position: { x: 0, y: 0 },
    properties: { ...def.defaultProperties, ...overrides },
  };
}

function graphFixture(
  nodes: GraphDocument["nodes"],
  edges: GraphDocument["edges"] = [],
  environment: GraphDocument["metadata"]["environment"] = "prod",
): GraphDocument {
  return {
    schemaVersion: 1,
    metadata: {
      name: "rule-fixture",
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      region: "australiaeast",
      environment,
      resourceGroupName: "rg-rule-fixture",
    },
    nodes,
    edges,
  };
}

describe("rules-engine runtime", () => {
  it("does not confuse anonymous access, public networking and HTTPS", () => {
    const graph = graphFixture([testNode("storage", "storageAccount", { allowPublicAccess: true, publicNetworkAccess: true }), testNode("pe", "privateEndpoint")], [
      { id: "pe-edge", source: "pe", target: "storage", kind: "network" },
    ]);
    const findings = runRules(graph, REGISTRY);
    expect(findingsForRule(findings, "PSRULE.STORAGE.FIREWALL")).toHaveLength(1);
    expect(findingsForRule(findings, "PSRULE.STORAGE.SECURETRANSFER")[0]?.severity).toBe("info");

    const anonymousOnly = graphFixture([testNode("storage", "storageAccount", { allowPublicAccess: true, publicNetworkAccess: false })]);
    const anonymousFindings = runRules(anonymousOnly, REGISTRY);
    expect(findingsForRule(anonymousFindings, "PSRULE.STORAGE.BLOBPUBLICACCESS")).toHaveLength(1);
    expect(findingsForRule(anonymousFindings, "PSRULE.STORAGE.FIREWALL")).toHaveLength(0);
    const networkOnly = graphFixture([testNode("storage", "storageAccount", { allowPublicAccess: false, publicNetworkAccess: true })]);
    const networkFindings = runRules(networkOnly, REGISTRY);
    expect(findingsForRule(networkFindings, "PSRULE.STORAGE.BLOBPUBLICACCESS")).toHaveLength(0);
    expect(findingsForRule(networkFindings, "AZPOL.STG.PUBLIC-ACCESS")).toHaveLength(1);
  });

  it("requires the complete TCP gateway management port range", () => {
    const nsg = testNode("nsg", "networkSecurityGroup", { inboundRules: [{ access: "Allow", protocol: "Tcp", sourceAddressPrefix: "GatewayManager", destinationPortRange: "65200" }] });
    const graph = graphFixture([testNode("gateway", "applicationGateway"), testNode("subnet", "subnet"), nsg], [
      { id: "gateway-subnet", source: "gateway", target: "subnet", kind: "network" },
      { id: "subnet-nsg", source: "subnet", target: "nsg", kind: "network" },
    ]);
    const rule = REGISTRY.filter((entry) => entry.rule.id.includes("GATEWAY") && entry.rule.id.includes("NSG"));
    expect(rule).toHaveLength(1);
    expect(runRules(graph, rule)).toHaveLength(1);
    (nsg.properties.inboundRules as Array<Record<string, unknown>>)[0].destinationPortRange = "65200-65535";
    expect(runRules(graph, rule)).toHaveLength(0);
    (nsg.properties.inboundRules as Array<Record<string, unknown>>)[0].protocol = "Udp";
    expect(runRules(graph, rule)).toHaveLength(1);
  });

  it("healthy.ts produces zero error-severity findings", () => {
    const findings = runRules(healthyGraph, REGISTRY);
    const errors = findings.filter((f) => f.severity === "error");
    expect(
      errors,
      `Unexpected errors: ${errors.map((f) => f.ruleId).join(", ")}`,
    ).toHaveLength(0);
  });

  it("broken.ts fires the rules its comment lists, on the nodes it names", () => {
    const findings = runRules(brokenGraph, REGISTRY);
    const on = (ruleId: string) => findingsForRule(findings, ruleId).map((f) => f.nodeIds);
    expect(on("ISM.0974")).toEqual([["app"]]);
    expect(on("ISM.1552")).toEqual([["stg"]]);
    expect(on("BUNYA.COMP.001")).toEqual([["app"]]);
    expect(on("BUNYA.COMP.002")).toEqual([["stg"]]);
    expect(on("BUNYA.NAM.001")).toEqual([["stg"]]);
    expect(on("BUNYA.IMP.001")).toEqual([["fn"]]);
    expect(on("BUNYA.IMP.005")).toEqual([["ai"]]);
    expect(on("PSRULE.KEYVAULT.PURGEPROTECT")).toEqual([["kv"]]);
    // The app -> Key Vault data edge (e3) is both "not identity" and "should be identity".
    expect(findingsForRule(findings, "BUNYA.IDN.001").map((f) => f.edgeIds)).toEqual([["e3"]]);
    expect(findingsForRule(findings, "BUNYA.IDN.003").map((f) => f.edgeIds)).toEqual([["e3"]]);
  });

  it("applyAutofix repairs the storage minTlsVersion without touching the input graph", () => {
    const finding = findingsForRule(runRules(brokenGraph, REGISTRY), "PSRULE.STORAGE.MINTLS")[0];
    expect(finding?.autofixId).toBe("force-tls-12");
    const fixed = applyAutofix(brokenGraph, finding, REGISTRY);
    expect(fixed.nodes.find((n) => n.id === "stg")?.properties.minTlsVersion).toBe("1.2");
    expect(brokenGraph.nodes.find((n) => n.id === "stg")?.properties.minTlsVersion).toBe("1.0");
    expect(findingsForRule(runRules(fixed, REGISTRY), "PSRULE.STORAGE.MINTLS")).toHaveLength(0);
  });

  it("applyAutofix is a no-op when the finding has no autofixId", () => {
    const noFixFinding: Finding = {
      ruleId: "BUNYA.NAM.001",
      rule: {
        id: "BUNYA.NAM.001",
        source: { name: "test", url: "https://example.test" },
        category: "naming",
        severity: "error",
        appliesTo: ["storageAccount"],
        message: "test",
        longExplanation: "test",
        tags: ["test"],
      },
      severity: "error",
      source: { name: "test", url: "https://example.test" },
      message: "test",
      explanation: "test",
      nodeIds: ["stg"],
    };
    const result = applyAutofix(brokenGraph, noFixFinding, REGISTRY);
    expect(result).toBe(brokenGraph);
  });

  it("flags the requested AKS production hardening gaps", () => {
    const graph = graphFixture([
      testNode("aks", "aksCluster", {
        networkPlugin: "kubenet",
        networkPolicy: "none",
        availabilityZones: [],
      }),
      testNode("acr", "containerRegistry"),
    ]);
    const findings = runRules(graph, REGISTRY);
    expect(findingsForRule(findings, "BUNYA.COMP.014")).toHaveLength(1);
    expect(findingsForRule(findings, "BUNYA.COMP.015")).toHaveLength(1);
    expect(findingsForRule(findings, "BUNYA.COMP.016")).toHaveLength(1);
    expect(findingsForRule(findings, "BUNYA.COMP.017")).toHaveLength(1);
  });

  it("flags the requested VMSS production hardening gaps", () => {
    const graph = graphFixture([
      testNode("vmss", "virtualMachineScaleSet", {
        upgradeMode: "Automatic",
        healthProbeConfigured: false,
        azureMonitorAgent: false,
        availabilityZones: [],
      }),
      testNode("la", "logAnalytics"),
    ]);
    const findings = runRules(graph, REGISTRY);
    expect(findingsForRule(findings, "BUNYA.COMP.023")).toHaveLength(1);
    expect(findingsForRule(findings, "BUNYA.COMP.024")).toHaveLength(1);
    expect(findingsForRule(findings, "BUNYA.COMP.025")).toHaveLength(1);
  });

  it("checks Private Endpoint DNS and disabled public network private paths", () => {
    const graph = graphFixture([
      testNode("vnet", "virtualNetwork"),
      { ...testNode("subnet", "subnet"), parentId: "vnet" },
      testNode("pe", "privateEndpoint", { groupId: "blob" }),
      testNode("stg", "storageAccount", { allowPublicAccess: false, publicNetworkAccess: false }),
    ], [
      { id: "e1", source: "pe", target: "subnet", kind: "network" },
      { id: "e2", source: "pe", target: "stg", kind: "network" },
    ]);
    const findings = runRules(graph, REGISTRY);
    expect(findingsForRule(findings, "BUNYA.NET.011")).toHaveLength(1);
    expect(findingsForRule(findings, "BUNYA.NET.012")).toHaveLength(0);

    const noPrivatePath = graphFixture([
      testNode("stg", "storageAccount", { allowPublicAccess: false, publicNetworkAccess: false }),
    ]);
    expect(findingsForRule(runRules(noPrivatePath, REGISTRY), "BUNYA.NET.012")).toHaveLength(1);
  });

  it("checks explicit Role Assignment modelling for identity edges", () => {
    const direct = graphFixture([
      testNode("app", "appService"),
      testNode("kv", "keyVault"),
    ], [
      { id: "e1", source: "app", target: "kv", kind: "identity" },
    ]);
    expect(findingsForRule(runRules(direct, REGISTRY), "BUNYA.IDN.006")).toHaveLength(1);

    const explicit = graphFixture([
      testNode("app", "appService"),
      testNode("rbac", "roleAssignment", { roleDefinitionName: "Key Vault Secrets User" }),
      testNode("kv", "keyVault"),
    ], [
      { id: "e1", source: "app", target: "rbac", kind: "identity" },
      { id: "e2", source: "rbac", target: "kv", kind: "identity" },
    ]);
    expect(findingsForRule(runRules(explicit, REGISTRY), "BUNYA.IDN.006")).toHaveLength(0);
  });

  it("requires alerting on production graphs, not only Log Analytics", () => {
    const missing = graphFixture([
      testNode("app", "appService"),
      testNode("la", "logAnalytics"),
    ]);
    expect(findingsForRule(runRules(missing, REGISTRY), "BUNYA.OBS.010")).toHaveLength(1);

    const covered = graphFixture([
      testNode("app", "appService"),
      testNode("la", "logAnalytics"),
      testNode("alert", "monitorAlert"),
      testNode("ag", "actionGroup"),
    ], [
      { id: "e1", source: "alert", target: "ag", kind: "depends_on" },
    ]);
    expect(findingsForRule(runRules(covered, REGISTRY), "BUNYA.OBS.010")).toHaveLength(0);
  });

  it("flags App Service and Function App runtimes past Azure end of support", () => {
    const graph = graphFixture([
      testNode("web", "appService", { runtime: "node", runtimeVersion: "18-lts" }),
      testNode("fn", "functionApp", { runtime: "python", runtimeVersion: "3.9" }),
    ]);
    const findings = findingsForRule(runRules(graph, REGISTRY), "BUNYA.COMP.RUNTIME-EOL");
    expect(findings.map((f) => f.nodeIds)).toEqual([["web"], ["fn"]]);
    expect(findings[0].message).toContain("reached end of Azure support on 2025-04-30");
  });

  it("caps Virtual Network names at 64 characters and subnet names at 80", () => {
    const name = "v".repeat(70);
    const graph = graphFixture([
      { ...testNode("vnet", "virtualNetwork"), resourceName: name },
      { ...testNode("subnet", "subnet"), resourceName: name },
    ]);
    expect(findingsForRule(runRules(graph, REGISTRY), "BUNYA.NAM.009").map((f) => f.nodeIds)).toEqual([["vnet"]]);
  });

  it("flags identity edges from a user-assigned identity to types the catalogue does not let it target", () => {
    const graph = graphFixture([
      testNode("uai", "userAssignedIdentity"),
      testNode("kv", "keyVault"),
      testNode("app", "appService"),
    ], [
      { id: "to-kv", source: "uai", target: "kv", kind: "identity" },
      { id: "to-app", source: "uai", target: "app", kind: "identity" },
    ]);
    const findings = runRules(graph, REGISTRY);
    expect(findingsForRule(findings, "BUNYA.IDN.004").map((f) => f.edgeIds)).toEqual([["to-app"]]);
    expect(findingsForRule(findings, "BUNYA.IDN.UAI-UNSUPPORTED-TARGET").map((f) => f.edgeIds)).toEqual([["to-app"]]);
  });

  it("warns 90 days ahead of runtime end of support", () => {
    expect(runtimeSupportStatus("node", "22-lts", new Date("2027-02-15T00:00:00Z"))).toEqual({ state: "ending", endDate: "2027-04-30" });
    expect(runtimeSupportStatus("node", "22-lts", new Date("2026-11-01T00:00:00Z"))).toBeNull();
    expect(runtimeSupportStatus("dotnet", "v8.0", new Date("2026-11-11T00:00:00Z"))).toEqual({ state: "ended", endDate: "2026-11-10" });
    expect(runtimeSupportStatus("java", "17", new Date())).toBeNull();
  });
});
