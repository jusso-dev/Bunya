import { expect, test } from "@playwright/test";

async function collapseSidePanels(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Properties" }).first().click();
  await page.getByRole("button", { name: "Output" }).first().click();
}

test("dragging a service emits no React Flow `project` deprecation warning", async ({ page }) => {
  const messages: { type: string; text: string }[] = [];
  page.on("console", (msg) => messages.push({ type: msg.type(), text: msg.text() }));
  page.on("pageerror", (err) => messages.push({ type: "error", text: err.message }));

  await page.goto("/");
  await expect(page.locator('[data-testid="bunya-canvas"]')).toBeVisible();
  await collapseSidePanels(page);

  await page.locator('[data-service-type="storageAccount"]').first().click({
    position: { x: 10, y: 10 },
  });

  await expect(page.locator(".react-flow__node")).toHaveCount(1);

  const offenders = messages.filter(
    (m) =>
      m.text.includes("[DEPRECATED]") ||
      m.text.toLowerCase().includes("`project` is deprecated") ||
      m.text.toLowerCase().includes("project is deprecated"),
  );
  expect(offenders, JSON.stringify(messages, null, 2)).toEqual([]);

  const pageErrors = messages.filter((m) => m.type === "error");
  expect(pageErrors, JSON.stringify(pageErrors, null, 2)).toEqual([]);
});

test("dropped node renders the service icon SVG at 28px", async ({ page }) => {
  await page.goto("/");
  await collapseSidePanels(page);

  await page.locator('[data-service-type="keyVault"]').first().click({
    position: { x: 10, y: 10 },
  });

  const node = page.locator(".react-flow__node").first();
  await expect(node).toHaveCount(1);

  const iconSvg = node.locator('svg[viewBox="0 0 24 24"]').first();
  await expect(iconSvg).toHaveCount(1);

  const width = await iconSvg.evaluate((el) => Number((el as SVGElement).getAttribute("width") ?? "0"));
  expect(width).toBe(28);

  const strokeColor = await iconSvg.evaluate((el) => {
    const computed = getComputedStyle(el as SVGElement);
    return { stroke: computed.stroke, color: computed.color };
  });
  expect(strokeColor.stroke).toMatch(/^rgb\(/);
  expect(strokeColor.stroke).not.toBe("rgb(0, 0, 0)");
});

test("drag-and-drop from palette lands the node at the cursor without console errors", async ({ page }) => {
  const messages: { type: string; text: string }[] = [];
  page.on("console", (msg) => messages.push({ type: msg.type(), text: msg.text() }));
  page.on("pageerror", (err) => messages.push({ type: "error", text: err.message }));

  await page.goto("/");
  await collapseSidePanels(page);

  const palette = page.locator('[data-service-type="appService"]').first();
  const canvas = page.locator('[data-testid="bunya-canvas"]');

  const paletteBox = await palette.boundingBox();
  const canvasBox = await canvas.boundingBox();
  if (!paletteBox || !canvasBox) throw new Error("could not measure palette or canvas");

  const targetX = canvasBox.x + canvasBox.width / 2;
  const targetY = canvasBox.y + canvasBox.height / 2;

  await page.mouse.move(
    paletteBox.x + paletteBox.width / 2,
    paletteBox.y + paletteBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 16 });
  await page.mouse.up();

  // HTML5 DnD is unreliable under Playwright; click-to-add is the documented fallback.
  await palette.click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".react-flow__node")).not.toHaveCount(0);

  const deprecation = messages.find(
    (m) => m.text.toLowerCase().includes("project") && m.text.toLowerCase().includes("deprecated"),
  );
  expect(deprecation, JSON.stringify(messages, null, 2)).toBeUndefined();
});
