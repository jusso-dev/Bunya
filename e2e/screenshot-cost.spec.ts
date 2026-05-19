import { expect, test } from "@playwright/test";
import { join } from "node:path";

test("capture Cost tab screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 920 });
  await page.goto("/");
  await page.getByRole("button", { name: "Properties" }).first().click();
  await page.getByRole("button", { name: "Templates" }).click();
  await page
    .locator(".absolute.right-0")
    .filter({ hasText: "Static web app" })
    .getByText("Three-tier", { exact: false })
    .first()
    .click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Cost" }).click();
  await page.waitForTimeout(400);
  await expect(page.getByText(/Estimated monthly cost/)).toBeVisible();
  await page.screenshot({ path: join(process.cwd(), "docs", "screenshots", "09-cost-panel.png") });
});
