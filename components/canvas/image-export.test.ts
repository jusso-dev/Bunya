import { describe, expect, it } from "vitest";
import type { Node } from "reactflow";
import { exportFrame, imageFilename } from "./image-export";

const node = (id: string, x: number, y: number, width = 220, height = 50): Node => ({
  id,
  position: { x, y },
  positionAbsolute: { x, y },
  width,
  height,
  data: {},
});

describe("image export", () => {
  it("names files from the diagram name", () => {
    expect(imageFilename("Three-tier web app", "jpeg")).toBe("three-tier-web-app.jpg");
    expect(imageFilename("  ", "png")).toBe("bunya-diagram.png");
  });

  it("frames every node with padding, not just the visible area", () => {
    const frame = exportFrame([node("a", -400, -200), node("b", 1600, 900)]);
    // The nodes span 2220 x 1150.
    expect(frame.width).toBeGreaterThan(2220);
    expect(frame.height).toBeGreaterThan(1150);
    expect(frame.transform).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\) scale\([\d.]+\)$/);
  });

  it("caps very large diagrams inside browser canvas limits", () => {
    const frame = exportFrame([node("a", 0, 0), node("b", 20000, 20000)]);
    expect(frame.width).toBeLessThanOrEqual(4096);
    expect(frame.height).toBeLessThanOrEqual(4096);
  });
});
