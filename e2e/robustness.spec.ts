import { expect, test, type Page } from "@playwright/test";

// Regressions from the November 2026 robustness audit: unbounded inputs,
// toasts that covered the screen, and diagrams lost on reload.

async function documentNameInput(page: Page) {
  return page.getByRole("region").or(page.locator("section.editor-properties")).locator("label", { hasText: "Name" }).locator("input").first();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await expect(page.locator('[data-testid="bunya-canvas"]')).toBeVisible();
});

test("document name is capped and the header stays on one line", async ({ page }) => {
  const input = await documentNameInput(page);
  await input.fill("x".repeat(5000));
  await expect(input).toHaveValue("x".repeat(80));
  const header = page.getByRole("banner");
  const box = await header.boundingBox();
  expect(box!.height).toBeLessThan(60);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(1600);
});

test("an invalid number never reaches the saved diagram", async ({ page }) => {
  await page.getByRole("button", { name: "Add App Service Plan", exact: true }).click();
  await page.locator(".react-flow__node").first().click();
  const capacity = page.locator("label", { hasText: "capacity" }).locator("input");
  await capacity.fill("-5");
  await capacity.blur();
  await expect(capacity).toHaveValue("0");
  await capacity.fill("3.7");
  await capacity.blur();
  await expect(capacity).toHaveValue("4");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("bunya.document.v1") ?? "{}").nodes?.[0]?.properties.capacity)).toBe(4);
  await page.reload();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
});

test("a bad saved diagram is recovered from the backup instead of wiped", async ({ page }) => {
  await page.getByRole("button", { name: "Add Key Vault", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("bunya.document.v1") ?? "{}").nodes?.length)).toBe(1);
  await page.getByRole("button", { name: "Add Storage Account", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("bunya.document.v1") ?? "{}").nodes?.length)).toBe(2);
  // Corrupt the current copy as an older build could have.
  await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("bunya.document.v1")!);
    doc.metadata.name = "y".repeat(300);
    localStorage.setItem("bunya.document.v1", JSON.stringify(doc));
  });
  await page.reload();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "restored the previous saved version" })).toBeVisible();
});

test("a large import shows one short toast and notes in a closable dialog", async ({ page }) => {
  const sites = Array.from({ length: 60 }, (_, index) => ({
    type: "Microsoft.Web/sites",
    name: `web-${index}-${"q".repeat(40)}`,
    location: "australiaeast",
    kind: "app,linux",
    properties: { siteConfig: { linuxFxVersion: `RUBY|2.${index}` } },
  }));
  const unsupported = Array.from({ length: 40 }, (_, index) => ({ type: `Microsoft.Example/thing${index}`, name: `thing-${index}`, location: "australiaeast" }));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByLabel("Diagram JSON").fill(JSON.stringify({ resources: [...sites, ...unsupported] }));
  await page.getByRole("dialog", { name: "Import diagram" }).getByRole("button", { name: "Import", exact: true }).last().click();

  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Imported pasted JSON" }).first();
  await expect(toast).toBeVisible();
  const box = await toast.boundingBox();
  expect(box!.height).toBeLessThan(200);
  expect(box!.y).toBeGreaterThan(0);

  await toast.getByRole("button", { name: "View notes" }).click();
  const dialog = page.getByRole("dialog", { name: "Import notes" });
  await expect(dialog).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox!.height).toBeLessThanOrEqual(900);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // Notes stay available from the toolbar.
  await page.getByRole("banner").getByRole("button", { name: "Import notes" }).click();
  await expect(page.getByRole("dialog", { name: "Import notes" })).toBeVisible();
});

test("repeated actions replace their toast instead of stacking", async ({ page }) => {
  await page.getByRole("button", { name: "Add Key Vault", exact: true }).click();
  for (let index = 0; index < 5; index++) await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(1);
});

test("download names stay short and safe", async ({ page }) => {
  await page.getByRole("button", { name: "Add Key Vault", exact: true }).click();
  const input = await documentNameInput(page);
  await input.fill("My: Prod/Diagram " + "z".repeat(200));
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const name = (await download).suggestedFilename();
  expect(name).toMatch(/^[a-z0-9-]+\.bunya\.json$/);
  expect(name.length).toBeLessThanOrEqual(80 + ".bunya.json".length);
});
