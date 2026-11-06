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

  describe("App Service hosting", () => {
    const messages = (document: GraphDocument) => topologyProblems(document).map((problem) => problem.message).join("\n");

    it("blocks web apps on Functions-only plans and Windows plans", () => {
      const document = doc([
        node("rg", "resourceGroup", null),
        node("flex", "appServicePlan", "rg", { sku: "FC1", capacity: 0 }),
        node("web", "appService", "flex"),
        node("win", "appServicePlan", "rg", { sku: "S1", os: "Windows" }),
        node("web2", "appService", "win"),
      ]);
      expect(messages(document)).toContain('"web" is a web app, but App Service Plan "flex" (FC1) only hosts Function Apps');
      expect(messages(document)).toContain('"web2" is exported as a Linux app, but App Service Plan "win" is a Windows plan');
    });

    it("allows one Function App per Flex plan and no container images on serverless plans", () => {
      const document = doc([
        node("rg", "resourceGroup", null),
        node("flex", "appServicePlan", "rg", { sku: "FC1", capacity: 0 }),
        node("fn1", "functionApp", "flex"),
        node("fn2", "functionApp", "flex", { containerImage: "acr1.azurecr.io/fn:1" }),
        node("y1", "appServicePlan", "rg", { sku: "Y1", capacity: 0 }),
        node("fn3", "functionApp", "y1", { containerImage: "acr1.azurecr.io/fn:1" }),
      ]);
      const text = messages(document);
      expect(text).toContain("is a Flex Consumption plan, which hosts one Function App");
      expect(text).toContain('"fn2" runs a container image');
      expect(text).toContain('"fn3" runs a container image');
    });

    it("requires instances on dedicated plans and allows zero on serverless plans", () => {
      const document = doc([
        node("rg", "resourceGroup", null),
        node("b1", "appServicePlan", "rg", { sku: "B1", capacity: 0 }),
        node("y1", "appServicePlan", "rg", { sku: "Y1", capacity: 0 }),
      ]);
      const problems = topologyProblems(document);
      expect(problems).toHaveLength(1);
      expect(problems[0].message).toContain('"b1" (B1) needs at least 1 instance');
    });

    it("keeps VNet integration subnets single-purpose", () => {
      const document = doc(
        [
          node("rg", "resourceGroup", null),
          node("vnet", "virtualNetwork", "rg", { addressSpace: "10.0.0.0/16" }),
          node("snet", "subnet", "vnet", { addressPrefix: "10.0.1.0/24" }),
          node("plan", "appServicePlan", "rg", { sku: "P1v3" }),
          node("web", "appService", "plan"),
          node("flex", "appServicePlan", "rg", { sku: "FC1", capacity: 0 }),
          node("fn", "functionApp", "flex"),
          node("pe", "privateEndpoint", "rg"),
          node("y1", "appServicePlan", "rg", { sku: "Y1", capacity: 0 }),
          node("fn2", "functionApp", "y1"),
        ],
        [
          { id: "e1", source: "web", target: "snet", kind: "network" },
          { id: "e2", source: "fn", target: "snet", kind: "network" },
          { id: "e3", source: "pe", target: "snet", kind: "network" },
          { id: "e4", source: "fn2", target: "snet", kind: "network" },
        ],
      );
      const text = messages(document);
      expect(text).toContain("would need several delegations (Microsoft.Web/serverFarms, Microsoft.App/environments)");
      expect(text).toContain('Private Endpoint "pe" cannot join Subnet "snet"');
      expect(text).toContain('"fn2" has VNet integration, which the Consumption plan');
    });

    it("never puts an unattached app on a serverless plan when exporting", () => {
      const document = doc([
        node("rg", "resourceGroup", null),
        node("flex", "appServicePlan", "rg", { sku: "FC1", capacity: 0 }),
        node("fn", "functionApp", "flex"),
        node("stg", "storageAccount", "rg"),
        node("web", "appService", "rg", { containerImage: "acr1.azurecr.io/api:1" }),
      ], [{ id: "e1", source: "fn", target: "stg", kind: "data" }]);
      const result = generateArm(document);
      if (!result.ok) throw new Error(result.reason);
      const template = JSON.parse(result.files[0].content) as { resources: { type: string; name: string; sku?: { name: string }; properties?: { serverFarmId?: string } }[] };
      const web = template.resources.find((r) => r.type === "Microsoft.Web/sites" && r.name === "web")!;
      const plans = template.resources.filter((r) => r.type === "Microsoft.Web/serverfarms");
      expect(plans.map((p) => p.sku?.name).sort()).toEqual(["B1", "FC1"]);
      expect(web.properties?.serverFarmId).not.toContain("'flex'");
    });

    it("checks the plans implicit expansion adds before exporting", () => {
      const document = doc([
        node("rg", "resourceGroup", null),
        node("win", "appServicePlan", "rg", { sku: "S1", os: "Windows" }),
        node("web", "appService", "rg"),
      ]);
      const result = generateTerraform(document);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.files.find((f) => f.path === "main.tf")?.content).toMatch(/os_type\s+= "Linux"/);
    });

    it("exports the new dedicated SKUs", () => {
      for (const sku of ["B3", "S2", "S3", "P0v3", "P3v3", "P1v2", "P2v2", "P3v2"]) {
        const document = doc([
          node("rg", "resourceGroup", null),
          node("plan", "appServicePlan", "rg", { sku }),
          node("web", "appService", "plan"),
        ]);
        for (const generate of [generateTerraform, generateBicep, generateArm, generateAzCli]) {
          const result = generate(document);
          expect(result.ok ? result.files.map((file) => file.content).join("\n") : result.reason, `${sku}`).toContain(sku);
        }
      }
    });
  });
});
