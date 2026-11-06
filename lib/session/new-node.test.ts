import { describe, expect, it } from "vitest";
import { emptyGraph, type GraphDocument, type GraphNode } from "@/lib/graph/schema";
import { newNode } from "./new-node";
import { placeAt } from "./geometry";

function add(document: GraphDocument, node: Omit<GraphNode, "id">, id = `n${document.nodes.length + 1}`): GraphNode {
  const created = { id, ...node };
  document.nodes.push(created);
  return created;
}

describe("newNode", () => {
  it("gives repeated services distinct display and resource names", () => {
    const document = emptyGraph("t");
    const first = add(document, newNode(document, { type: "storageAccount", position: { x: 0, y: 0 } }));
    const second = add(document, newNode(document, { type: "storageAccount", position: { x: 0, y: 0 } }));
    expect([first.name, second.name]).toEqual(["Storage Account", "Storage Account 2"]);
    expect(first.resourceName).not.toBe(second.resourceName);
    expect(second.resourceName).toMatch(/^[a-z0-9]{3,24}$/);
  });

  it("sizes containers and gives a subnet a free prefix in its VNet", () => {
    const document = emptyGraph("t");
    const vnet = add(document, newNode(document, { type: "virtualNetwork", position: { x: 0, y: 0 } }));
    expect(vnet.size).toBeDefined();
    const prefixes = [0, 1].map(() => add(document, newNode(document, { type: "subnet", parentId: vnet.id, position: { x: 10, y: 10 } })).properties.addressPrefix);
    expect(new Set(prefixes).size).toBe(2);
  });

  it("rejects properties the service schema does not allow", () => {
    expect(() => newNode(emptyGraph("t"), { type: "storageAccount", position: { x: 0, y: 0 }, properties: { sku: 42 } })).toThrow(/Invalid properties/);
  });
});

describe("placeAt", () => {
  it("puts a point inside a container into it, relative to the container", () => {
    const document = emptyGraph("t");
    const group = add(document, newNode(document, { type: "resourceGroup", position: { x: 100, y: 100 } }));
    expect(placeAt(document, { x: 150, y: 160 }, "keyVault")).toEqual({ parentId: group.id, position: { x: 50, y: 60 } });
    expect(placeAt(document, { x: 10, y: 10 }, "keyVault")).toEqual({ parentId: null, position: { x: 10, y: 10 } });
    expect(placeAt(document, { x: 150, y: 160 }, "resourceGroup").parentId).toBeNull();
  });
});
