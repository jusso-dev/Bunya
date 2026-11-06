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

test("dropped node renders a loaded Azure icon at 26px", async ({ page }) => {
  await page.goto("/");
  await collapseSidePanels(page);

  await page.locator('[data-service-type="keyVault"]').first().click({
    position: { x: 10, y: 10 },
  });

  const node = page.locator(".react-flow__node").first();
  await expect(node).toHaveCount(1);

  const icon = node.locator('img[src*="azure-icons/"]').first();
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute("width", "26");
  expect(await icon.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

test("drag-and-drop from palette lands the node at the cursor without console errors", async ({ page }) => {
  const messages: { type: string; text: string }[] = [];
  page.on("console", (msg) => messages.push({ type: msg.type(), text: msg.text() }));
  page.on("pageerror", (err) => messages.push({ type: "error", text: err.message }));

  await page.goto("/");
  await collapseSidePanels(page);

  const canvas = page.getByTestId("bunya-canvas");
  const canvasBox = (await canvas.boundingBox())!;
  const target = { x: canvasBox.width / 2, y: canvasBox.height / 2 };
  await page.getByRole("button", { name: "Add Web App (App Service)", exact: true }).dragTo(canvas, { targetPosition: target });

  const node = page.locator(".react-flow__node");
  await expect(node).toHaveCount(1);
  const nodeBox = (await node.boundingBox())!;
  // The drop point is the node's top-left corner.
  expect(Math.abs(nodeBox.x - (canvasBox.x + target.x))).toBeLessThan(20);
  expect(Math.abs(nodeBox.y - (canvasBox.y + target.y))).toBeLessThan(20);

  const deprecation = messages.find(
    (m) => m.text.toLowerCase().includes("project") && m.text.toLowerCase().includes("deprecated"),
  );
  expect(deprecation, JSON.stringify(messages, null, 2)).toBeUndefined();
  const pageErrors = messages.filter((m) => m.type === "error");
  expect(pageErrors, JSON.stringify(pageErrors, null, 2)).toEqual([]);
});
