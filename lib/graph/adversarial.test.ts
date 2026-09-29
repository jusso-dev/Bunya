import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { emptyGraph, GraphDocumentSchema } from "./schema";
import { parseImportText } from "./portable";
import { deserialiseFromFragment } from "./serialise";
import { MAX_IMPORT_BYTES } from "./limits";
import { createGraphStore } from "./store";

describe("hostile imports", () => {
  it("rejects decompression bombs before parsing", async () => {
    const payload = gzipSync(Buffer.from("a".repeat(MAX_IMPORT_BYTES + 1))).toString("base64url");
    expect(await deserialiseFromFragment(`bunya1:${payload}`)).toBeNull();
  });
  it("rejects oversized and deeply nested JSON", () => {
    expect(parseImportText(" ".repeat(MAX_IMPORT_BYTES + 1)).ok).toBe(false);
    expect(parseImportText('{"a":'.repeat(40) + '{}' + '}'.repeat(40)).ok).toBe(false);
  });
  it("rejects duplicate IDs, parent cycles and malformed service properties", () => {
    const doc = emptyGraph();
    const node = { id: "vnet", type: "virtualNetwork" as const, name: "VNet", resourceName: "vnet", position: { x: 0, y: 0 }, properties: {} };
    doc.nodes = [node, node]; expect(GraphDocumentSchema.safeParse(doc).success).toBe(false);
    doc.nodes = [{ ...node, parentId: "vnet" }]; expect(parseImportText(JSON.stringify(doc)).ok).toBe(false);
    doc.nodes = [{ ...node, properties: { addressSpace: 123 } }]; expect(parseImportText(JSON.stringify(doc)).ok).toBe(false);
  });
  it("deleting a container removes descendants and remains undoable", () => {
    const store = createGraphStore(); const root = store.getState().addNode({ type: "resourceGroup", name: "RG", resourceName: "rg", properties: {}, position: { x: 0, y: 0 } });
    store.getState().addNode({ type: "storageAccount", name: "Store", resourceName: "store", properties: {}, parentId: root, position: { x: 0, y: 0 } });
    store.getState().removeNode(root); expect(store.getState().document.nodes).toHaveLength(0);
    store.getState().undo(); expect(store.getState().document.nodes).toHaveLength(2);
  });
});
