import { beforeEach, describe, expect, it } from "vitest";
import { useGraphStore } from "./store";

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

  it("drops the exact-name flag when a resource is renamed", () => {
    const id = useGraphStore.getState().addNode({ ...baseNode, type: "storageAccount", resourceName: "stimported", exactName: true });
    useGraphStore.getState().updateNode(id, { name: "Renamed label" });
    expect(useGraphStore.getState().document.nodes[0].exactName).toBe(true);
    useGraphStore.getState().updateNode(id, { resourceName: "stnew" });
    expect(useGraphStore.getState().document.nodes[0].exactName).toBeUndefined();
  });
});

describe("drag history", () => {
  const store = () => useGraphStore.getState();
  // Where every node sits, the part of the document a drag changes.
  const layout = () => store().document.nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, parent: n.parentId ?? null }));

  let rg: string;
  let vnet: string;
  let storage: string;

  beforeEach(() => {
    store().reset();
    rg = store().addNode({ ...baseNode, position: { x: 0, y: 0 } });
    vnet = store().addNode({ ...baseNode, type: "virtualNetwork", name: "VNet", resourceName: "vnet", position: { x: 400, y: 0 } });
    storage = store().addNode({ ...baseNode, type: "storageAccount", name: "Storage", resourceName: "st", position: { x: 40, y: 40 }, parentId: rg });
    // Start each case from a clean undo stack so counts below are the drag's own.
    store().reset(store().document);
  });

  function drag(id: string, steps: Array<{ x: number; y: number }>) {
    store().beginDrag();
    for (const step of steps) store().moveNode(id, step);
    store().endDrag();
  }

  it("records one undo step for a drag made of many pointer moves", () => {
    const before = layout();
    drag(storage, Array.from({ length: 200 }, (_, i) => ({ x: 40 + i, y: 40 + i })));
    expect(store().history).toHaveLength(1);
    const after = layout();
    expect(after.find((n) => n.id === storage)).toMatchObject({ x: 239, y: 239, parent: rg });

    store().undo();
    expect(layout()).toEqual(before);
    expect(store().history).toHaveLength(0);
    store().redo();
    expect(layout()).toEqual(after);
  });

  it("does not record anything while the gesture is still in progress", () => {
    store().beginDrag();
    store().moveNode(storage, { x: 80, y: 80 });
    store().moveNode(storage, { x: 120, y: 120 });
    expect(store().history).toHaveLength(0);
    store().endDrag();
    expect(store().history).toHaveLength(1);
  });

  it("makes a container drag undoable", () => {
    const before = layout();
    drag(rg, [{ x: 10, y: 10 }, { x: 160, y: 96 }]);
    expect(store().history).toHaveLength(1);
    expect(store().document.nodes.find((n) => n.id === rg)?.position).toEqual({ x: 160, y: 96 });
    store().undo();
    expect(layout()).toEqual(before);
  });

  it("folds a reparent at the end of the drag into the same step", () => {
    const before = layout();
    store().beginDrag();
    store().moveNode(storage, { x: 300, y: 20 });
    store().moveNode(storage, { x: 352, y: 32 });
    store().reparentNode(storage, vnet, { x: 32, y: 48 });
    store().endDrag();
    expect(store().history).toHaveLength(1);
    expect(layout().find((n) => n.id === storage)).toMatchObject({ x: 32, y: 48, parent: vnet });

    store().undo();
    expect(layout()).toEqual(before);
    expect(layout().find((n) => n.id === storage)).toMatchObject({ x: 40, y: 40, parent: rg });
    store().redo();
    expect(layout().find((n) => n.id === storage)).toMatchObject({ x: 32, y: 48, parent: vnet });
  });

  it("leaves history and redo alone when a drag ends where it began", () => {
    // Build a redo branch first.
    drag(storage, [{ x: 100, y: 100 }]);
    store().undo();
    const history = store().history;
    const future = store().future;
    expect(future).toHaveLength(1);

    drag(storage, [{ x: 90, y: 90 }, { x: 40, y: 40 }]);
    expect(store().history).toEqual(history);
    expect(store().future).toEqual(future);

    store().beginDrag();
    store().endDrag();
    expect(store().history).toEqual(history);
    expect(store().future).toEqual(future);
    store().redo();
    expect(layout().find((n) => n.id === storage)).toMatchObject({ x: 100, y: 100 });
  });

  it("drops the redo branch when a drag changes something", () => {
    drag(storage, [{ x: 100, y: 100 }]);
    store().undo();
    expect(store().future).toHaveLength(1);
    drag(storage, [{ x: 200, y: 200 }]);
    expect(store().future).toHaveLength(0);
  });

  it("moves several nodes dragged together as one step", () => {
    const before = layout();
    store().beginDrag();
    store().moveNode(storage, { x: 64, y: 64 });
    store().moveNode(vnet, { x: 480, y: 80 });
    store().endDrag();
    expect(store().history).toHaveLength(1);
    store().undo();
    expect(layout()).toEqual(before);
  });

  it("makes a nudge with no drag in progress its own undo step, and ignores a nudge that goes nowhere", () => {
    const before = layout();
    store().moveNode(storage, { x: 56, y: 40 });
    expect(store().history).toHaveLength(1);
    store().moveNode(storage, { x: 56, y: 40 });
    expect(store().history).toHaveLength(1);
    store().undo();
    expect(layout()).toEqual(before);
  });

  it("closes an open drag in order when another edit arrives mid-gesture", () => {
    const before = layout();
    store().beginDrag();
    store().moveNode(storage, { x: 120, y: 120 });
    const mid = layout();
    store().addNode({ ...baseNode, type: "keyVault", name: "Vault", resourceName: "kv", position: { x: 600, y: 0 } });
    expect(store().history).toHaveLength(2);
    // Undo steps back through the add, then the drag, never skipping either.
    store().undo();
    expect(layout()).toEqual(mid);
    store().undo();
    expect(layout()).toEqual(before);
    // The drag is closed, so a later move is its own step rather than being swallowed.
    store().moveNode(storage, { x: 200, y: 200 });
    expect(store().history).toHaveLength(1);
  });

  it("does not let an abandoned gesture swallow later history", () => {
    store().beginDrag();
    store().moveNode(storage, { x: 80, y: 80 });
    store().reset();
    store().addNode({ ...baseNode, name: "Another", resourceName: "rg-other" });
    store().moveNode(store().document.nodes[0].id, { x: 16, y: 16 });
    // addNode and the nudge are each undoable; nothing was left open by the reset.
    expect(store().history).toHaveLength(2);

    store().beginDrag();
    store().moveNode(store().document.nodes[0].id, { x: 32, y: 32 });
    store().undo();
    store().moveNode(store().document.nodes[0].id, { x: 48, y: 48 });
    expect(store().history).toHaveLength(2);
    store().endDrag();
    expect(store().history).toHaveLength(2);
  });
});

describe("property edit history", () => {
  const store = () => useGraphStore.getState();
  let id: string;

  beforeEach(() => {
    store().reset();
    id = store().addNode({ ...baseNode, type: "appServicePlan", name: "Plan", resourceName: "plan", properties: { capacity: 1, sku: "B1" } });
    store().reset(store().document);
  });

  const properties = () => store().document.nodes.find((n) => n.id === id)?.properties;

  it("undoes a changed value in one step and redoes it", () => {
    store().updateNodeProperties(id, { capacity: 3 });
    expect(properties()).toMatchObject({ capacity: 3, sku: "B1" });
    expect(store().history).toHaveLength(1);
    store().undo();
    expect(properties()).toMatchObject({ capacity: 1 });
    store().redo();
    expect(properties()).toMatchObject({ capacity: 3 });
  });

  it("ignores a second commit of the same value (change, then blur)", () => {
    store().updateNodeProperties(id, { capacity: 3 });
    const document = store().document;
    store().updateNodeProperties(id, { capacity: 3 });
    expect(store().history).toHaveLength(1);
    expect(store().document).toBe(document);

    // The first Undo already restores the earlier value.
    store().undo();
    expect(properties()).toMatchObject({ capacity: 1 });
  });

  it("keeps redo when an edit changes nothing", () => {
    store().updateNodeProperties(id, { capacity: 3 });
    store().undo();
    expect(store().future).toHaveLength(1);
    store().updateNodeProperties(id, { capacity: 1, sku: "B1" });
    expect(store().future).toHaveLength(1);
    expect(store().history).toHaveLength(0);
    store().redo();
    expect(properties()).toMatchObject({ capacity: 3 });
  });

  it("records a patch that changes only some of its values, and drops redo", () => {
    store().updateNodeProperties(id, { capacity: 3 });
    store().undo();
    store().updateNodeProperties(id, { capacity: 1, sku: "P1v3" });
    expect(properties()).toMatchObject({ capacity: 1, sku: "P1v3" });
    expect(store().history).toHaveLength(1);
    expect(store().future).toHaveLength(0);
  });

  it("records a property that was not set before", () => {
    store().updateNodeProperties(id, { zoneRedundant: false });
    expect(properties()).toMatchObject({ zoneRedundant: false });
    expect(store().history).toHaveLength(1);
  });

  it("treats a rebuilt array or object as a change", () => {
    store().updateNodeProperties(id, { tags: { env: "dev" } });
    store().updateNodeProperties(id, { tags: { env: "dev" } });
    expect(store().history).toHaveLength(2);
  });

  it("does nothing for a node that does not exist", () => {
    const document = store().document;
    store().updateNodeProperties("missing", { capacity: 9 });
    expect(store().document).toBe(document);
    expect(store().history).toHaveLength(0);
  });
});
