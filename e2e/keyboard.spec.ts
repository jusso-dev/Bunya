import { expect, test } from "@playwright/test";

test("Backspace deletes the selected canvas node", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-testid="bunya-canvas"]')).toBeVisible();

  await page.locator('[data-service-type="storageAccount"]').first().click({
    position: { x: 10, y: 10 },
  });

  const nodes = page.locator(".react-flow__node");
  await expect(nodes).toHaveCount(1);

  await nodes.first().click();
  await page.keyboard.press("Backspace");

  await expect(nodes).toHaveCount(0);
});

test("Backspace edits text fields without deleting the selected canvas node", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-testid="bunya-canvas"]')).toBeVisible();

  await page.locator('[data-service-type="storageAccount"]').first().click({
    position: { x: 10, y: 10 },
  });

  const nodes = page.locator(".react-flow__node");
  await expect(nodes).toHaveCount(1);
  await nodes.first().click();

  const nameInput = page.locator('section:has-text("Storage Account") input').first();
  await nameInput.fill("abc");
  await nameInput.press("Backspace");

  await expect(nameInput).toHaveValue("ab");
  await expect(nodes).toHaveCount(1);
});
