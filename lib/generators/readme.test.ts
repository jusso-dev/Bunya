import { describe, expect, it } from "vitest";
import { generateReadme } from "./readme";
import { firstCutGraph } from "./__fixtures__/firstCut";

describe("generateReadme", () => {
  it("snapshots README output and includes mermaid block", () => {
    const result = generateReadme(firstCutGraph);
    if (!result.ok) throw new Error("expected ok");
    expect(result.files[0].path).toBe("README.md");
    const content = result.files[0].content;
    expect(content).toContain("```mermaid");
    expect(content).toContain("## Resources");
    expect(content).toMatchSnapshot();
  });
});
