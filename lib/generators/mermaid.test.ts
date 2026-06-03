import { describe, expect, it } from "vitest";
import { generateMermaid } from "./mermaid";
import { firstCutGraph } from "./__fixtures__/firstCut";
import { fullStackGraph } from "./__fixtures__/fullStack";

describe("generateMermaid", () => {
  it("snapshots first-cut mermaid diagram", () => {
    const result = generateMermaid(firstCutGraph);
    if (!result.ok) throw new Error("expected ok");
    expect(result.files[0].path).toBe("architecture.mmd");
    expect(result.files[0].content).toMatchSnapshot();
  });

  it("includes every node and edge for the full-stack fixture", () => {
    const result = generateMermaid(fullStackGraph);
    if (!result.ok) throw new Error("expected ok");
    const content = result.files[0].content;
    expect(content).toContain("flowchart LR");
    expect(content.split("\n").filter((l) => l.includes(":::"))).toHaveLength(22);
  });
});
