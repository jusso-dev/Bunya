import { describe, expect, it } from "vitest";
import { generateCostEstimate } from "./cost";
import { firstCutGraph } from "./__fixtures__/firstCut";
import { fullStackGraph } from "./__fixtures__/fullStack";

describe("generateCostEstimate", () => {
  it("produces a single cost-estimate.md file", () => {
    const result = generateCostEstimate(firstCutGraph);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("cost-estimate.md");
    expect(result.files[0].language).toBe("markdown");
  });

  it("renders caveats, line items table and total", () => {
    const result = generateCostEstimate(firstCutGraph);
    if (!result.ok) throw new Error("expected ok");
    const content = result.files[0].content;
    expect(content).toContain("## Caveats");
    expect(content).toContain("## Line items");
    expect(content).toContain("**Total (indicative):**");
  });

  it("snapshots the full-stack cost markdown", () => {
    const result = generateCostEstimate(fullStackGraph);
    if (!result.ok) throw new Error("expected ok");
    expect(result.files[0].content).toMatchSnapshot();
  });
});
