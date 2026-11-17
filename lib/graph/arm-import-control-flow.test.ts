import { describe, expect, it } from "vitest";
import { parseArmTemplate } from "./arm-import";
import { generateArm } from "@/lib/generators/arm";
import { generateTerraform } from "@/lib/generators/terraform";
import type { GraphDocument } from "./schema";

const SCHEMA = "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#";
const STORAGE = "Microsoft.Storage/storageAccounts";

function imported(template: unknown): { document: GraphDocument; warning: string } {
  const result = parseArmTemplate(JSON.stringify(template));
  if (!result.ok) throw new Error(result.reason);
  return { document: result.document, warning: result.warning ?? "" };
}

function storage(name: string, extra: Record<string, unknown> = {}) {
  return { type: STORAGE, apiVersion: "2023-01-01", name, sku: { name: "Standard_LRS" }, kind: "StorageV2", ...extra };
}

// An unconditional sibling keeps the import valid when the conditional branch is empty.
const KEEP = "stkeepalways";
const MAYBE = "stmaybedeployed";

function names(document: GraphDocument, type = "storageAccount"): string[] {
  return document.nodes.filter((n) => n.type === type).map((n) => n.resourceName ?? "").sort();
}

function withCondition(condition: unknown, parameters: Record<string, unknown> = {}) {
  return imported({
    $schema: SCHEMA,
    parameters,
    resources: [storage(KEEP), storage(MAYBE, { condition })],
  });
}

describe("ARM resource conditions", () => {
  it("skips a literal false condition and says why", () => {
    const { document, warning } = withCondition(false);
    expect(names(document)).toEqual([KEEP]);
    expect(warning).toContain(MAYBE);
    expect(warning).toMatch(/condition evaluates to false/);
  });

  it("keeps a literal true condition without warning about it", () => {
    const { document, warning } = withCondition(true);
    expect(names(document)).toEqual([KEEP, MAYBE]);
    expect(warning).not.toContain(MAYBE);
  });

  it("follows a boolean parameter default in both directions", () => {
    const off = withCondition("[parameters('deploy')]", { deploy: { type: "bool", defaultValue: false } });
    expect(names(off.document)).toEqual([KEEP]);
    expect(off.warning).toMatch(/condition evaluates to false/);
    const on = withCondition("[parameters('deploy')]", { deploy: { type: "bool", defaultValue: true } });
    expect(names(on.document)).toEqual([KEEP, MAYBE]);
  });

  it("evaluates template-only boolean expressions", () => {
    const parameters = { tier: { type: "string", defaultValue: "Basic" } };
    const off = withCondition("[equals(parameters('tier'), 'Premium')]", parameters);
    expect(names(off.document)).toEqual([KEEP]);
    const on = withCondition("[not(equals(parameters('tier'), 'Premium'))]", parameters);
    expect(names(on.document)).toEqual([KEEP, MAYBE]);
  });

  it("skips a condition that depends on deployment-time values and flags it as unsupported, not false", () => {
    const { document, warning } = withCondition("[parameters('deploy')]", { deploy: { type: "bool" } });
    expect(names(document)).toEqual([KEEP]);
    expect(warning).toContain(MAYBE);
    expect(warning).toMatch(/deployment/);
    expect(warning).not.toMatch(/condition evaluates to false/);
    const reference = withCondition("[equals(resourceGroup().location, 'australiaeast')]");
    expect(names(reference.document)).toEqual([KEEP]);
    expect(reference.warning).toMatch(/deployment/);
  });

  it("skips a nonboolean condition instead of treating it as truthy", () => {
    for (const condition of ["yes", 1, "true", { allOf: [] }, null]) {
      const { document, warning } = withCondition(condition);
      expect(names(document), JSON.stringify(condition)).toEqual([KEEP]);
      expect(warning, JSON.stringify(condition)).toMatch(/not true or false/);
    }
    const expression = withCondition("[concat('a', 'b')]");
    expect(names(expression.document)).toEqual([KEEP]);
    expect(expression.warning).toMatch(/not true or false/);
  });

  it("leaves out nested resources of a skipped parent and says so", () => {
    const { document, warning } = imported({
      $schema: SCHEMA,
      resources: [
        storage(KEEP),
        {
          type: "Microsoft.Network/virtualNetworks",
          apiVersion: "2023-11-01",
          name: "vnet-off",
          condition: false,
          properties: { addressSpace: { addressPrefixes: ["10.0.0.0/16"] }, subnets: [{ name: "inline", properties: { addressPrefix: "10.0.9.0/24" } }] },
          resources: [{ type: "subnets", apiVersion: "2023-11-01", name: "child", properties: { addressPrefix: "10.0.1.0/24" } }],
        },
      ],
    });
    expect(document.nodes.some((n) => n.type === "virtualNetwork")).toBe(false);
    expect(document.nodes.some((n) => n.type === "subnet")).toBe(false);
    expect(warning).toMatch(/nested/);
  });

  it("keeps a true parent together with its children", () => {
    const { document } = imported({
      $schema: SCHEMA,
      resources: [
        {
          type: "Microsoft.Network/virtualNetworks",
          apiVersion: "2023-11-01",
          name: "vnet-on",
          condition: true,
          properties: { addressSpace: { addressPrefixes: ["10.0.0.0/16"] } },
          resources: [{ type: "subnets", apiVersion: "2023-11-01", name: "child", properties: { addressPrefix: "10.0.1.0/24" } }],
        },
      ],
    });
    expect(names(document, "subnet")).toEqual(["child"]);
  });

  it("evaluates a nested child's own condition", () => {
    const { document } = imported({
      $schema: SCHEMA,
      resources: [
        {
          type: "Microsoft.Network/virtualNetworks",
          apiVersion: "2023-11-01",
          name: "vnet-on",
          properties: { addressSpace: { addressPrefixes: ["10.0.0.0/16"] } },
          resources: [
            { type: "subnets", apiVersion: "2023-11-01", name: "kept", properties: { addressPrefix: "10.0.1.0/24" } },
            { type: "subnets", apiVersion: "2023-11-01", name: "dropped", condition: false, properties: { addressPrefix: "10.0.2.0/24" } },
          ],
        },
      ],
    });
    expect(names(document, "subnet")).toEqual(["kept"]);
  });
});

describe("ARM resource copy loops", () => {
  const fixed = (count: unknown, name ="[concat('stcopy', copyIndex())]") =>
    imported({
      $schema: SCHEMA,
      parameters: { items: { type: "array", defaultValue: ["a", "b"] }, runtime: { type: "int" } },
      resources: [storage(KEEP), storage(name, { copy: { name: "storageLoop", count } })],
    });

  it("skips a zero-count loop and reports that nothing deploys", () => {
    const { document, warning } = fixed(0);
    expect(names(document)).toEqual([KEEP]);
    expect(warning).toMatch(/copy count is 0/);
  });

  it("does not import a static-count loop as one ordinary resource", () => {
    const { document, warning } = fixed(3);
    expect(names(document)).toEqual([KEEP]);
    expect(warning).toMatch(/copy loop/);
    expect(warning).toMatch(/does not expand/);
  });

  it("does not import a loop whose count is only known at deployment", () => {
    const { document, warning } = fixed("[parameters('runtime')]");
    expect(names(document)).toEqual([KEEP]);
    expect(warning).toMatch(/copy loop/);
  });

  it("does not import a loop whose count comes from a parameter default", () => {
    const { document } = fixed("[length(parameters('items'))]", "stplainname");
    expect(names(document)).toEqual([KEEP]);
  });

  it("leaves out nested resources of a copied parent", () => {
    const { document, warning } = imported({
      $schema: SCHEMA,
      resources: [
        storage(KEEP),
        {
          type: "Microsoft.Network/virtualNetworks",
          apiVersion: "2023-11-01",
          name: "[concat('vnet', copyIndex())]",
          copy: { name: "vnets", count: 2 },
          properties: { addressSpace: { addressPrefixes: ["10.0.0.0/16"] } },
          resources: [{ type: "subnets", apiVersion: "2023-11-01", name: "child", properties: { addressPrefix: "10.0.1.0/24" } }],
        },
      ],
    });
    expect(document.nodes.some((n) => n.type === "virtualNetwork" || n.type === "subnet")).toBe(false);
    expect(warning).toMatch(/nested/);
  });

  it("warns about copied inline subnets instead of dropping them silently", () => {
    const vnet = (properties: Record<string, unknown>) => ({
      type: "Microsoft.Network/virtualNetworks",
      apiVersion: "2023-11-01",
      name: "vnet-app",
      properties: { addressSpace: { addressPrefixes: ["10.0.0.0/16"] }, ...properties },
    });
    const looped = imported({
      $schema: SCHEMA,
      resources: [vnet({ copy: [{ name: "subnets", count: 2, input: { name: "[concat('s', copyIndex())]", properties: { addressPrefix: "[concat('10.0.', copyIndex(), '.0/24')]" } } }] })],
    });
    expect(names(looped.document, "subnet")).toEqual([]);
    expect(looped.warning).toMatch(/subnets/);
    expect(looped.warning).toMatch(/copy loop/);

    const perEntry = imported({
      $schema: SCHEMA,
      resources: [vnet({ subnets: [{ name: "plain", properties: { addressPrefix: "10.0.1.0/24" } }, { name: "looped", copy: { name: "x", count: 2 }, properties: { addressPrefix: "10.0.2.0/24" } }] })],
    });
    expect(names(perEntry.document, "subnet")).toEqual(["plain"]);
    expect(perEntry.warning).toMatch(/copy loop/);
  });

  it("does not warn about copy used only inside properties of other resources", () => {
    const { warning } = imported({
      $schema: SCHEMA,
      resources: [storage(KEEP, { properties: { copy: [{ name: "x", count: 1, input: {} }] } })],
    });
    expect(warning).not.toMatch(/copy loop/);
  });
});

describe("skipped ARM resources stay out of generated deployments", () => {
  it("generates neither the false-condition nor the copied resource", () => {
    const { document } = imported({
      $schema: SCHEMA,
      resources: [storage(KEEP), storage(MAYBE, { condition: false }), storage("stcopied", { copy: { name: "loop", count: 2 } })],
    });
    expect(names(document)).toEqual([KEEP]);
    for (const result of [generateArm(document), generateTerraform(document)]) {
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const text = result.files.map((file) => file.content).join("\n");
      expect(text).toContain(KEEP);
      expect(text).not.toContain(MAYBE);
      expect(text).not.toContain("stcopied");
    }
  });
});
