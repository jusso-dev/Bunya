import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

const FIXTURES = join(__dirname, "fixtures", "arm");
const templates = readdirSync(FIXTURES).filter((name) => name.endsWith(".json"));

// Wide enough that the Output panel starts open (it collapses below 1440px).
test.use({ viewport: { width: 1600, height: 1000 } });

for (const name of templates) {
  test(`imports the ${name.replace(/\.json$/, "")} quickstart and generates every output`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto("/");
    await page.setInputFiles('input[aria-label="Import Bunya file"]', {
      name,
      mimeType: "application/json",
      buffer: readFileSync(join(FIXTURES, name)),
    });

    await expect(page.getByRole("dialog", { name: "Import diagram" })).toHaveCount(0);
    await expect.poll(() => page.locator(".react-flow__node").count()).toBeGreaterThan(4);
    await expect(page.getByRole("button", { name: /Import notes/ })).toBeVisible();

    // Every output renders either generated code or Bunya's explanation of
    // why it cannot generate this diagram, never a crash.
    const output = page.locator("section.editor-output");
    for (const label of ["Terraform", "Bicep", "ARM", "az CLI", "PowerShell", "Azure Policy", "Mermaid", "README", "Cost"]) {
      const tab = output.getByRole("button", { name: label, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-pressed", "true");
      await expect(output.locator("pre, [role=alert], table").first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
