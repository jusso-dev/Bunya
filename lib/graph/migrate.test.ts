import { describe, expect, it } from "vitest";
import { firstCutGraph } from "@/lib/generators/__fixtures__/firstCut";
import { migrate } from "./migrate";

describe("migrate", () => {
  it("keeps the meaning of storage saved before public network access was split out", () => {
    const legacy = (allowPublicAccess: boolean) => ({
      ...firstCutGraph,
      nodes: firstCutGraph.nodes.map((node) => {
        if (node.type !== "storageAccount") return node;
        const { publicNetworkAccess: _removed, ...rest } = node.properties;
        void _removed;
        return { ...node, properties: { ...rest, allowPublicAccess } };
      }),
    });
    const storage = (allowPublicAccess: boolean) =>
      migrate(legacy(allowPublicAccess)).nodes.find((node) => node.type === "storageAccount")?.properties;
    expect(storage(true)).toMatchObject({ allowPublicAccess: true, publicNetworkAccess: true });
    expect(storage(false)).toMatchObject({ allowPublicAccess: false, publicNetworkAccess: false });
  });

  it("leaves an explicit public network setting alone", () => {
    const document = {
      ...firstCutGraph,
      nodes: firstCutGraph.nodes.map((node) => (node.type === "storageAccount" ? { ...node, properties: { ...node.properties, allowPublicAccess: false, publicNetworkAccess: true } } : node)),
    };
    expect(migrate(document).nodes.find((node) => node.type === "storageAccount")?.properties.publicNetworkAccess).toBe(true);
  });

  it("keeps imported storage endpoints open when the old file never recorded them", () => {
    const legacy = {
      ...firstCutGraph,
      nodes: firstCutGraph.nodes.map((node) => {
        if (node.type !== "storageAccount") return node;
        const { publicNetworkAccess: _removed, ...rest } = node.properties;
        void _removed;
        return { ...node, id: "arm-node-15", properties: { ...rest, allowPublicAccess: false } };
      }),
      edges: firstCutGraph.edges.map((edge) => ({
        ...edge,
        source: firstCutGraph.nodes.find((n) => n.id === edge.source)?.type === "storageAccount" ? "arm-node-15" : edge.source,
        target: firstCutGraph.nodes.find((n) => n.id === edge.target)?.type === "storageAccount" ? "arm-node-15" : edge.target,
      })),
    };
    const storage = migrate(legacy).nodes.find((node) => node.type === "storageAccount")?.properties;
    expect(storage).toMatchObject({ allowPublicAccess: false, publicNetworkAccess: true });
  });
});
