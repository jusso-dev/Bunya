import { expect, test } from "@playwright/test";

test("canvas renders multiple nodes with visible Azure icons", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Properties" }).first().click();
  await page.getByRole("button", { name: "Output" }).first().click();

  for (const type of ["storageAccount", "keyVault", "appService"]) {
    await page.locator(`[data-service-type="${type}"]`).first().click({
      position: { x: 10, y: 10 },
    });
  }

  const nodes = page.locator(".react-flow__node");
  await expect(nodes).toHaveCount(3);

  const icons = page.locator('.react-flow__node img[src*="azure-icons/"]');
  await expect(icons).toHaveCount(3);
  expect(await icons.evaluateAll((els) => els.every((el) => (el as HTMLImageElement).naturalWidth > 0))).toBe(true);

  const canvas = page.getByTestId("bunya-canvas");
  const onCanvas = async () => {
    const canvasBox = (await canvas.boundingBox())!;
    const boxes = await Promise.all((await nodes.all()).map((node) => node.boundingBox()));
    return boxes.filter((box) => box && box.x + box.width > canvasBox.x && box.x < canvasBox.x + canvasBox.width
      && box.y + box.height > canvasBox.y && box.y < canvasBox.y + canvasBox.height).length;
  };
  await expect.poll(onCanvas, { message: "every added node is fitted into the canvas" }).toBe(3);

  await page.screenshot({ path: "test-results/canvas-with-three-nodes.png", fullPage: false });
});
