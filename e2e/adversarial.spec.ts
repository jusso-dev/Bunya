import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("keyboard can add services, reset and recover work", async ({ page }) => {
  await page.goto("/");
  const add = page.getByRole("button", { name: "Add Storage Account", exact: true });
  await add.focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
});

test("import errors are visible and preserve existing work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Key Vault", exact: true }).click();
  await page.setInputFiles('input[aria-label="Import Bunya file"]', { name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"broken":') });
  await expect(page.getByRole("dialog", { name: "Import diagram" })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Import failed");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("dialogs trap focus and restore their trigger", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Import", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Import diagram" });
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
});

test("local recovery survives reload and invalid share links", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Key Vault", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("bunya.document.v1") ?? "{}").nodes?.length)).toBe(1);
  await page.goto("/#bunya1:invalid"); await page.reload();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText("Shared diagram is invalid");
});

test("unavailable browser storage keeps editor usable with warning", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Blocked", "SecurityError"); };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Add Key Vault", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(page.getByRole("alert").filter({ hasText: "Changes cannot be saved" })).toBeVisible();
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`accessible editor and dialogs in ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expect(page.getByTestId("bunya-canvas")).toBeVisible();
    await page.getByRole("button", { name: "Add Storage Account", exact: true }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    for (const name of ["Import", "Templates", "Org Rules"]) {
      await page.getByRole("button", { name, exact: true }).click();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.keyboard.press("Escape");
    }
  });
}

test("mobile panels and dialogs stay within viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("bunya-canvas")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole("button", { name: "Palette", exact: true }).click();
  await page.getByRole("button", { name: "Add Storage Account", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
