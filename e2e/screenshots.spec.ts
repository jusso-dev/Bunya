import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { canvasSettled } from "./settled";

// Generates the README screenshots in project-docs/screenshots.
const SHOTS_DIR = join(process.cwd(), "project-docs", "screenshots");
mkdirSync(SHOTS_DIR, { recursive: true });

async function collapsePanels(page: Page, hideOutput = false) {
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  if (hideOutput) await page.getByRole("button", { name: "Output", exact: true }).click();
}

async function loadTemplate(page: Page, label: string) {
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("dialog", { name: "Starter templates" }).getByText(label, { exact: false }).first().click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await canvasSettled(page);
}

async function shoot(page: Page, file: string, clip?: { x: number; y: number; width: number; height: number }) {
  await canvasSettled(page);
  await page.screenshot({ path: join(SHOTS_DIR, file), clip });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 920 });
  await page.goto("/");
  await expect(page.getByTestId("bunya-canvas")).toBeVisible();
});

test("01 empty canvas hero", async ({ page }) => {
  await collapsePanels(page, true);
  await shoot(page, "01-empty-canvas.png");
});

test("02 three-tier template loaded", async ({ page }) => {
  await collapsePanels(page, true);
  await loadTemplate(page, "Three-tier");
  await shoot(page, "02-three-tier-canvas.png");
});

test("03 event-driven template + Terraform output", async ({ page }) => {
  await collapsePanels(page, false);
  await loadTemplate(page, "Event-driven");
  await expect(page.getByRole("button", { name: "Terraform", exact: true })).toHaveAttribute("aria-pressed", "true");
  await shoot(page, "03-event-driven-with-output.png");
});

test("04 static web app with API", async ({ page }) => {
  await collapsePanels(page, true);
  await loadTemplate(page, "Static web app");
  await shoot(page, "04-static-with-api.png");
});

test("05 validation findings with auto-fix", async ({ page }) => {
  await collapsePanels(page, true);
  await loadTemplate(page, "Three-tier");
  await page.locator("summary", { hasText: "Validation findings" }).click();
  await expect(page.getByText("Model checks are advisory")).toBeVisible();
  await shoot(page, "05-validation-findings.png");
});

test("06 resource group container with children", async ({ page }) => {
  await collapsePanels(page, true);
  for (const service of ["Resource Group", "App Service Plan", "Web App (App Service)", "Storage Account", "Key Vault"]) {
    await page.getByRole("button", { name: `Add ${service}`, exact: true }).click();
  }
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await page.getByRole("button", { name: "fit view" }).click();
  await shoot(page, "06-resource-group-container.png");
});

test("07 bicep output panel close-up", async ({ page }) => {
  await collapsePanels(page, false);
  await loadTemplate(page, "Three-tier");
  await page.getByRole("button", { name: "Bicep", exact: true }).click();
  await expect(page.getByText("main.bicep").first()).toBeVisible();
  await shoot(page, "07-bicep-output.png");
});

test("08 service palette panorama", async ({ page }) => {
  await collapsePanels(page, true);
  await shoot(page, "08-service-palette.png", { x: 0, y: 0, width: 320, height: 920 });
});
