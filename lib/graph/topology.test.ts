import { describe, expect, it } from "vitest";
import { getServiceDefinition } from "@/lib/catalogue/services";
import { STARTER_TEMPLATES } from "@/lib/catalogue/templates";
import { generateArm } from "@/lib/generators/arm";
import { generateAzCli } from "@/lib/generators/azcli";
import { generateBicep } from "@/lib/generators/bicep";
import { generatePowerShell } from "@/lib/generators/powershell";
import { generateTerraform } from "@/lib/generators/terraform";
import type { GraphDocument, GraphEdge, GraphNode, ServiceType } from "./schema";
import { freeSubnetPrefix, topologyProblems } from "./topology";

function node(id: string, type: ServiceType, parentId: string | null, properties: Record<string, unknown> = {}): GraphNode {
  return {
    id,
    type,
    name: getServiceDefinition(type).label,
    resourceName: id,
    parentId,
    position: { x: 0, y: 0 },
    properties: { ...getServiceDefinition(type).defaultProperties, ...properties },
  };
}

function doc(nodes: GraphNode[], edges: GraphEdge[] = []): GraphDocument {
  return {
    schemaVersion: 1,
    metadata: {
      name: "topology",
      description: "",
      createdAt: "2026-11-06T00:00:00.000Z",
      updatedAt: "2026-11-06T00:00:00.000Z",
      region: "australiaeast",
      environment: "dev",
      resourceGroupName: "rg-topology",
    },
    nodes,
    edges,
  };
}

const rg = () => node("rg-topology", "resourceGroup", null);

describe("topologyProblems", () => {
  it("accepts subnets inside a VNet and sites inside a plan", () => {
    const graph = doc([
      rg(),
      node("vnet-app", "virtualNetwork", "rg-topology", { addressSpace: "10.42.0.0/16" }),
      node("snet-a", "subnet", "vnet-app", { addressPrefix: "10.42.1.0/24" }),
      node("snet-b", "subnet", "vnet-app", { addressPrefix: "10.42.2.0/24" }),
      node("plan", "appServicePlan", "rg-topology"),
      node("web", "appService", "plan"),
    ]);
    expect(topologyProblems(graph)).toEqual([]);
  });

  it("rejects placements Azure cannot deploy", () => {
    const graph = doc([
      rg(),
      node("vnet-app", "virtualNetwork", "rg-topology"),
      node("plan", "appServicePlan", "rg-topology"),
      node("stg", "storageAccount", "vnet-app"),
      node("snet-in-plan", "subnet", "plan"),
      node("snet-loose", "subnet", "rg-topology"),
      node("rg-nested", "resourceGroup", "rg-topology"),
      node("vmss", "virtualMachineScaleSet", "rg-topology"),
    ]);
    const messages = topologyProblems(graph).map((problem) => problem.message).join("\n");
    expect(messages).toContain('Storage Account "stg" cannot be placed inside Virtual Network "vnet-app"');
    expect(messages).toContain('Subnet "snet-in-plan" cannot be placed inside App Service Plan "plan"');
    expect(messages).toContain('Subnet "snet-loose" must belong to a Virtual Network');
    expect(messages).toContain('"rg-nested": a Resource Group cannot sit inside another container');
    expect(messages).toContain('"vmss" must be connected to a subnet');
  });

  it("rejects subnet prefixes outside the VNet or overlapping each other", () => {
    const graph = doc([
      rg(),
      node("vnet-app", "virtualNetwork", "rg-topology", { addressSpace: "10.42.0.0/16" }),
      node("snet-outside", "subnet", "vnet-app", { addressPrefix: "10.0.1.0/24" }),
      node("snet-wide", "subnet", "vnet-app", { addressPrefix: "10.42.0.0/23" }),
      node("snet-inner", "subnet", "vnet-app", { addressPrefix: "10.42.1.0/24" }),
    ]);
    const messages = topologyProblems(graph).map((problem) => problem.message).join("\n");
    expect(messages).toContain('"snet-outside" prefix 10.0.1.0/24 is outside');
    expect(messages).toContain('"snet-wide" and Subnet "snet-inner" have overlapping prefixes');
  });

  it("blocks deployment exports but keeps diagram exports available", () => {
    const graph = doc([rg(), node("snet-loose", "subnet", "rg-topology")]);
    const result = generateTerraform(graph);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("cannot be deployed to Azure as drawn");
  });
});

describe("subnet exports", () => {
  it("reference the containing VNet by name when no depends_on edge exists", () => {
    const graph = doc([
      rg(),
      node("vnet-app", "virtualNetwork", "rg-topology", { addressSpace: "10.42.0.0/16" }),
      node("snet-app", "subnet", "vnet-app", { addressPrefix: "10.42.1.0/24" }),
      node("vmss", "virtualMachineScaleSet", "rg-topology"),
    ], [{ id: "e1", source: "vmss", target: "snet-app", kind: "network" }]);
    for (const generate of [generateTerraform, generateBicep, generateArm, generateAzCli, generatePowerShell]) {
      const result = generate(graph);
      if (!result.ok) throw new Error(result.reason);
      const text = result.files.map((file) => file.content).join("\n");
      expect(text).not.toMatch(/main-vnet|mainVnet|azurerm_virtual_network\.main\b/);
    }
  });
});

describe("freeSubnetPrefix", () => {
  it("picks the first free /24 inside the address space", () => {
    expect(freeSubnetPrefix("10.42.0.0/16", [])).toBe("10.42.0.0/24");
    expect(freeSubnetPrefix("10.42.0.0/16", ["10.42.0.0/24", "10.42.1.0/25"])).toBe("10.42.2.0/24");
    expect(freeSubnetPrefix("10.42.0.0/26", [])).toBe("10.42.0.0/26");
    expect(freeSubnetPrefix("10.42.0.0/24", ["10.42.0.0/24"])).toBeNull();
  });
});

describe("starter templates", () => {
  it("are deployable as drawn", () => {
    for (const template of STARTER_TEMPLATES) {
      expect(topologyProblems(template.document), template.id).toEqual([]);
    }
  });
});
