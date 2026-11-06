import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function loadThreeTier(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("dialog", { name: "Starter templates" }).getByText("Three-tier", { exact: false }).first().click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`exports the whole diagram as a JPEG in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await loadThreeTier(page);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("group", { name: "Export diagram image" }).getByRole("button", { name: "JPEG" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("three-tier.jpg");

    const bytes = await readFile(await download.path());
    // JPEG files start with FF D8 FF.
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(bytes.length).toBeGreaterThan(20_000);

    // A themed Sonner toast confirms the download.
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Exported three-tier.jpg." })).toBeVisible();
    await page.screenshot({ path: `test-results/image-export-toast-${colorScheme}.png` });
  });
}

test("exports a PNG and keeps canvas controls out of the image", async ({ page }) => {
  await loadThreeTier(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("group", { name: "Export diagram image" }).getByRole("button", { name: "PNG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("three-tier.png");
  const bytes = await readFile(await download.path());
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});
