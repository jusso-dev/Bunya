import { expect, test } from "@playwright/test";

test("canvas renders multiple nodes with visible Lucide icons", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Properties" }).first().click();
  await page.getByRole("button", { name: "Output" }).first().click();

  for (const type of ["storageAccount", "keyVault", "appService"]) {
    await page.locator(`[data-service-type="${type}"]`).first().click({
      position: { x: 10, y: 10 },
    });
  }

  await page.waitForTimeout(500);

  const nodes = page.locator(".react-flow__node");
  await expect(nodes).toHaveCount(3);

  const lucideIcons = page.locator(".react-flow__node svg.lucide");
  await expect(lucideIcons).toHaveCount(3);

  // Verify the bulk of the dropped nodes overlap the visible canvas viewport
  const canvasBox = await page.locator('[data-testid="bunya-canvas"]').boundingBox();
  if (!canvasBox) throw new Error("canvas not measured");
  let overlappingCount = 0;
  for (let i = 0; i < 3; i++) {
    const nodeBox = await nodes.nth(i).boundingBox();
    if (!nodeBox) continue;
    const overlapsX = nodeBox.x + nodeBox.width > canvasBox.x && nodeBox.x < canvasBox.x + canvasBox.width;
    const overlapsY = nodeBox.y + nodeBox.height > canvasBox.y && nodeBox.y < canvasBox.y + canvasBox.height;
    if (overlapsX && overlapsY) overlappingCount++;
  }
  expect(overlappingCount, "at least 2 of 3 nodes should be on-screen after fitView").toBeGreaterThanOrEqual(2);

  await page.screenshot({ path: "test-results/canvas-with-three-nodes.png", fullPage: false });

  // Diagnostic: dump computed styles + bounding rects
  const dump = await nodes.evaluateAll((els) =>
    els.map((el) => {
      const s = getComputedStyle(el);
      const r = (el as HTMLElement).getBoundingClientRect();
      return {
        transform: s.transform,
        opacity: s.opacity,
        visibility: s.visibility,
        display: s.display,
        zIndex: s.zIndex,
        width: s.width,
        height: s.height,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        innerHTML: el.innerHTML.slice(0, 200),
      };
    }),
  );
  void dump;
});
