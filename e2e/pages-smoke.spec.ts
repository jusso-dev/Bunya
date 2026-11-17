import { expect, test, type Page } from "@playwright/test";

// Runs against the static export served at /Bunya/ (playwright.pages.config.ts),
// the same build GitHub Pages publishes. Catches base-path and asset breakage
// that the dev-server suite cannot see.
const BASE = "/Bunya/";

// Wide enough that the Output panel starts open (it collapses below 1440px).
test.use({ viewport: { width: 1600, height: 1000 } });

function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console error: ${message.text()}`);
  });
  page.on("requestfailed", (request) => problems.push(`request failed: ${request.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return problems;
}

const STORAGE_TEMPLATE = {
  $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  contentVersion: "1.0.0.0",
  resources: [
    {
      type: "Microsoft.Storage/storageAccounts",
      apiVersion: "2023-01-01",
      name: "stpagessmoke",
      location: "australiaeast",
      sku: { name: "Standard_LRS" },
      kind: "StorageV2",
    },
  ],
};

test("the published build renders the canvas, icons, templates, imports and outputs", async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto(BASE);
  await expect(page.getByTestId("bunya-canvas")).toBeVisible();

  // Icons come from the base-pathed /Bunya/azure-icons/ folder and must decode.
  const icons = page.locator(`img[src^="${BASE}azure-icons/"]`);
  await expect(icons.first()).toBeVisible();
  await expect
    .poll(() => icons.evaluateAll((images) => images.filter((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0).length))
    .toBeGreaterThan(0);
  expect(await icons.evaluateAll((images) => images.filter((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 0).length)).toBe(0);

  // A starter template draws nodes.
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("dialog", { name: "Starter templates" }).getByText("Three-tier", { exact: false }).first().click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  const templateNodes = await page.locator(".react-flow__node").count();
  expect(templateNodes).toBeGreaterThan(2);

  // An ARM import replaces the diagram.
  await page.setInputFiles('input[aria-label="Import Bunya file"]', {
    name: "storage.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(STORAGE_TEMPLATE)),
  });
  await expect(page.getByRole("dialog", { name: "Import diagram" })).toHaveCount(0);
  await expect(page.locator('[data-service-type="storageAccount"]').first()).toBeVisible();
  await expect.poll(() => page.locator(".react-flow__node").count()).toBeLessThan(templateNodes);

  // The deployment output renders generated code for the imported diagram.
  const output = page.locator("section.editor-output");
  const terraform = output.getByRole("button", { name: "Terraform", exact: true });
  await terraform.click();
  await expect(terraform).toHaveAttribute("aria-pressed", "true");
  await expect(output.locator("pre").filter({ hasText: "stpagessmoke" }).first()).toBeVisible();

  expect(problems).toEqual([]);
});

test("the site is served only under its base path", async ({ request }) => {
  expect((await request.get(BASE)).status()).toBe(200);
  expect((await request.get("/")).status()).toBe(404);
});
