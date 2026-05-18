import { describe, expect, it } from "vitest";
import { generateTerraform } from "./terraform";
import { firstCutGraph } from "./__fixtures__/firstCut";

describe("generateTerraform", () => {
  it("produces a stable file set for the first-cut fixture", () => {
    const result = generateTerraform(firstCutGraph);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = {
      paths: result.files.map((f) => f.path),
      mainTf: result.files.find((f) => f.path === "main.tf")?.content,
      versionsTf: result.files.find((f) => f.path === "versions.tf")?.content,
      outputsTf: result.files.find((f) => f.path === "outputs.tf")?.content,
    };
    expect(summary).toMatchSnapshot();
  });

  it("emits each of the five first-cut Terraform resource types", () => {
    const result = generateTerraform(firstCutGraph);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const main = result.files.find((f) => f.path === "main.tf")?.content ?? "";
    for (const kind of [
      "azurerm_resource_group",
      "azurerm_service_plan",
      "azurerm_linux_web_app",
      "azurerm_storage_account",
      "azurerm_key_vault",
    ]) {
      expect(main).toContain(kind);
    }
  });

  it("is deterministic across repeated calls", () => {
    const a = generateTerraform(firstCutGraph);
    const b = generateTerraform(firstCutGraph);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("refuses to generate when a dependency cycle exists", () => {
    const cyclic = {
      ...firstCutGraph,
      edges: [
        ...firstCutGraph.edges,
        { id: "cycle", source: "kv", target: "app", kind: "depends_on" as const },
      ],
    };
    const result = generateTerraform(cyclic);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cycle?.length ?? 0).toBeGreaterThan(0);
  });
});
