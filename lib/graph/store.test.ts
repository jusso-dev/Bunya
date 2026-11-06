import { beforeEach, describe, expect, it } from "vitest";
import { useGraphStore, inferDefaultEdgeKind } from "./store";

const baseNode = {
  type: "resourceGroup" as const,
  position: { x: 0, y: 0 },
  name: "RG",
  resourceName: "rg-demo",
  properties: {},
};

describe("useGraphStore", () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
  });

  it("adds and removes nodes", () => {
    const id = useGraphStore.getState().addNode(baseNode);
    expect(useGraphStore.getState().document.nodes).toHaveLength(1);
    useGraphStore.getState().removeNode(id);
    expect(useGraphStore.getState().document.nodes).toHaveLength(0);
  });

  it("supports undo and redo", () => {
    useGraphStore.getState().addNode(baseNode);
    useGraphStore.getState().undo();
    expect(useGraphStore.getState().document.nodes).toHaveLength(0);
    useGraphStore.getState().redo();
    expect(useGraphStore.getState().document.nodes).toHaveLength(1);
  });

  it("infers identity as default edge kind into Key Vault", () => {
    expect(inferDefaultEdgeKind("appService", "keyVault")).toBe("identity");
    expect(inferDefaultEdgeKind("appService", "storageAccount")).toBe("data");
  });

  it("drops the exact-name flag when a resource is renamed", () => {
    const id = useGraphStore.getState().addNode({ ...baseNode, type: "storageAccount", resourceName: "stimported", exactName: true });
    useGraphStore.getState().updateNode(id, { name: "Renamed label" });
    expect(useGraphStore.getState().document.nodes[0].exactName).toBe(true);
    useGraphStore.getState().updateNode(id, { resourceName: "stnew" });
    expect(useGraphStore.getState().document.nodes[0].exactName).toBeUndefined();
  });
});
