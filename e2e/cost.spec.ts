import { expect, test } from "@playwright/test";

test("Cost tab renders a non-zero total for a non-empty graph", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Properties" }).first().click();

  await page.locator('[data-service-type="resourceGroup"]').first().click({ position: { x: 10, y: 10 } });
  await page.locator('[data-service-type="appServicePlan"]').first().click({ position: { x: 10, y: 10 } });
  await page.locator('[data-service-type="appService"]').first().click({ position: { x: 10, y: 10 } });
  await page.locator('[data-service-type="keyVault"]').first().click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".react-flow__node")).toHaveCount(4);

  await page.getByRole("button", { name: "Cost" }).click();
  await expect(page.getByText(/Estimated monthly cost: A\$\d/)).toBeVisible();

  await page.getByRole("combobox").first().selectOption("USD");
  await expect(page.getByText(/Estimated monthly cost: \$\d/)).toBeVisible();
});

test("Cost tab caveats are always visible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Properties" }).first().click();
  await page.getByRole("button", { name: "Cost" }).click();
  await expect(page.getByText(/Indicative monthly figures/)).toBeVisible();
  await expect(page.getByText(/Snapshot date:/)).toBeVisible();
});
