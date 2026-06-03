import { describe, expect, it } from "vitest";
import { expandImplicits } from "./implicits";
import { GraphDocument } from "@/lib/graph/schema";
import { getServiceDefinition } from "@/lib/catalogue/services";

function tinyGraph(): GraphDocument {
  return {
    schemaVersion: 1,
    metadata: {
      name: "demo",
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z",
      region: "australiaeast",
      environment: "dev",
      resourceGroupName: "rg-demo",
    },
    nodes: [
      {
        id: "fn",
        type: "functionApp",
        name: "Worker",
        resourceName: "fn-demo",
        position: { x: 0, y: 0 },
        properties: { ...getServiceDefinition("functionApp").defaultProperties },
      },
    ],
    edges: [],
  };
}

describe("expandImplicits", () => {
  it("inserts a Resource Group, App Service Plan and Storage Account when missing", () => {
    const result = expandImplicits(tinyGraph());
    const types = result.document.nodes.map((n) => n.type).sort();
    expect(types).toContain("resourceGroup");
    expect(types).toContain("appServicePlan");
    expect(types).toContain("storageAccount");
    expect(result.additions.length).toBeGreaterThan(0);
  });

  it("inserts a Subnet + VNet when a Private Endpoint is alone", () => {
    const graph = tinyGraph();
    graph.nodes.push({
      id: "pe",
      type: "privateEndpoint",
      name: "PE",
      resourceName: "pe-demo",
      position: { x: 100, y: 0 },
      properties: { ...getServiceDefinition("privateEndpoint").defaultProperties },
    });
    const result = expandImplicits(graph);
    const types = result.document.nodes.map((n) => n.type);
    expect(types).toContain("subnet");
    expect(types).toContain("virtualNetwork");
  });

  it("flags new nodes as auto-generated", () => {
    const result = expandImplicits(tinyGraph());
    expect(result.autoNodeIds.size).toBeGreaterThan(0);
  });

  it("treats App Service Plan containment as a hosting relationship", () => {
    const graph = tinyGraph();
    graph.nodes.unshift({
      id: "plan",
      type: "appServicePlan",
      name: "Plan",
      resourceName: "plan-demo",
      position: { x: 0, y: 0 },
      properties: { ...getServiceDefinition("appServicePlan").defaultProperties },
    });
    graph.nodes = graph.nodes.map((node) =>
      node.id === "fn" ? { ...node, parentId: "plan" } : node,
    );
    const result = expandImplicits(graph);
    expect(result.document.nodes.filter((n) => n.type === "appServicePlan")).toHaveLength(1);
    expect(
      result.document.edges.some(
        (e) => e.source === "fn" && e.target === "plan" && e.kind === "depends_on",
      ),
    ).toBe(false);
  });
});
