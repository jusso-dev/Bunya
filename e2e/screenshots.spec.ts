import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SHOTS_DIR = join(process.cwd(), "project-docs", "screenshots");
mkdirSync(SHOTS_DIR, { recursive: true });

async function collapsePanels(page: Page, hideOutput = false) {
  await page.getByRole("button", { name: "Properties" }).first().click();
  if (hideOutput) {
    await page.getByRole("button", { name: "Output" }).first().click();
  }
}

async function loadTemplate(page: Page, label: string) {
  await page.getByRole("button", { name: "Templates" }).click();
  const dropdown = page.locator(".absolute.right-0").filter({ hasText: "Static web app" });
  await dropdown.getByText(label, { exact: false }).first().click();
  await page.waitForTimeout(500);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 920 });
  await page.goto("/");
  await expect(page.locator('[data-testid="bunya-canvas"]')).toBeVisible();
});

test("01 empty canvas hero", async ({ page }) => {
  await collapsePanels(page, true);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SHOTS_DIR, "01-empty-canvas.png") });
});

test("02 three-tier template loaded", async ({ page }) => {
  await collapsePanels(page, true);
  await loadTemplate(page, "Three-tier");
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(SHOTS_DIR, "02-three-tier-canvas.png") });
});

test("03 event-driven template + Terraform output", async ({ page }) => {
  await collapsePanels(page, false);
  await loadTemplate(page, "Event-driven");
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(SHOTS_DIR, "03-event-driven-with-output.png") });
});

test("04 static web app with API", async ({ page }) => {
  await collapsePanels(page, true);
  await loadTemplate(page, "Static web app");
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(SHOTS_DIR, "04-static-with-api.png") });
});

test("05 validation findings with auto-fix", async ({ page }) => {
  await collapsePanels(page, true);
  await loadTemplate(page, "Three-tier");
  await page.waitForTimeout(500);
  // Open the validation panel
  const validationToggle = page.locator("summary", { hasText: "Validation findings" });
  if (await validationToggle.count()) {
    await validationToggle.click();
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: join(SHOTS_DIR, "05-validation-findings.png") });
});

test("06 resource group container with children", async ({ page }) => {
  await collapsePanels(page, true);
  await page.locator('[data-service-type="resourceGroup"]').first().click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(200);
  for (const t of ["appServicePlan", "appService", "storageAccount", "keyVault"]) {
    await page.locator(`[data-service-type="${t}"]`).first().click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(100);
  }
  await page.locator(".react-flow__controls-fitview").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS_DIR, "06-resource-group-container.png") });
});

test("07 bicep output panel close-up", async ({ page }) => {
  await collapsePanels(page, false);
  await loadTemplate(page, "Three-tier");
  await page.getByRole("button", { name: "Properties" }).first().click(); // collapse properties so output is wider
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Bicep" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS_DIR, "07-bicep-output.png") });
});

test("08 service palette panorama", async ({ page }) => {
  await collapsePanels(page, true);
  await page.screenshot({
    path: join(SHOTS_DIR, "08-service-palette.png"),
    clip: { x: 0, y: 0, width: 320, height: 920 },
  });
});
