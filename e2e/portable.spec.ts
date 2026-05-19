import { test, expect } from "@playwright/test";

test("Export button triggers a .bunya.json download", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Properties" }).first().click();
  await page.getByRole("button", { name: "Output" }).first().click();
  await page.locator('[data-service-type="resourceGroup"]').first().click({ position: { x: 10, y: 10 } });
  await page.locator('[data-service-type="storageAccount"]').first().click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".react-flow__node")).toHaveCount(2);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.bunya\.json$/);
});

test("Import button replaces the canvas with a Bunya envelope", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Properties" }).first().click();
  await page.getByRole("button", { name: "Output" }).first().click();

  // Existing graph: just a Key Vault
  await page.locator('[data-service-type="keyVault"]').first().click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".react-flow__node")).toHaveCount(1);

  const envelope = {
    format: "bunya",
    version: 1,
    exportedAt: "2026-05-19T00:00:00.000Z",
    generator: "bunya-test",
    document: {
      schemaVersion: 1,
      metadata: {
        name: "imported",
        createdAt: "2026-05-19T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:00.000Z",
        region: "australiaeast",
        environment: "dev",
        resourceGroupName: "rg-imported",
      },
      nodes: [
        {
          id: "rg",
          type: "resourceGroup",
          name: "RG",
          resourceName: "rg-imported",
          position: { x: 0, y: 0 },
          properties: { region: "australiaeast", tags: {} },
          parentId: null,
          size: { width: 720, height: 480 },
        },
        {
          id: "stg",
          type: "storageAccount",
          name: "Storage",
          resourceName: "importedstg",
          position: { x: 120, y: 80 },
          properties: {
            sku: "Standard_LRS",
            kind: "StorageV2",
            allowPublicAccess: false,
            minTlsVersion: "1.2",
            hierarchicalNamespace: false,
            containers: [],
          },
          parentId: "rg",
        },
        {
          id: "kv",
          type: "keyVault",
          name: "Vault",
          resourceName: "kv-imported",
          position: { x: 320, y: 80 },
          properties: {
            sku: "standard",
            purgeProtection: true,
            softDeleteRetentionDays: 7,
            rbacAuthorization: true,
            publicNetworkAccess: false,
          },
          parentId: "rg",
        },
      ],
      edges: [],
    },
  };

  await page.setInputFiles('input[aria-label="Import Bunya file"]', {
    name: "demo.bunya.json",
    mimeType: "application/x-bunya+json",
    buffer: Buffer.from(JSON.stringify(envelope)),
  });
  await expect(page.locator(".react-flow__node")).toHaveCount(3, { timeout: 5000 });
});

test("malformed import surfaces an error without clobbering the canvas", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Properties" }).first().click();
  await page.getByRole("button", { name: "Output" }).first().click();

  await page.locator('[data-service-type="keyVault"]').first().click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".react-flow__node")).toHaveCount(1);

  await page.setInputFiles('input[aria-label="Import Bunya file"]', {
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("not json at all"),
  });
  await page.waitForTimeout(300);
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
});
