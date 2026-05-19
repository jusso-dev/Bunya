import { expect, test } from "@playwright/test";

test("dropping a service onto a Resource Group reparents it inside the container", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Properties" }).first().click();
  await page.getByRole("button", { name: "Output" }).first().click();

  // 1. Drop a Resource Group (becomes a container)
  await page.locator('[data-service-type="resourceGroup"]').first().click({
    position: { x: 10, y: 10 },
  });

  // 2. Drop a Storage Account afterwards — it should land inside the RG
  await page.locator('[data-service-type="storageAccount"]').first().click({
    position: { x: 10, y: 10 },
  });

  await page.waitForTimeout(400);

  const containerNodes = page.locator(".react-flow__node-container");
  await expect(containerNodes).toHaveCount(1);

  const serviceNodes = page.locator(".react-flow__node-service");
  await expect(serviceNodes).toHaveCount(1);

  await page.screenshot({ path: "test-results/canvas-container.png", fullPage: false });
});
