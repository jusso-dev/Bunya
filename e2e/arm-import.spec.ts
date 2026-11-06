import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

const FIXTURES = join(__dirname, "fixtures", "arm");
const templates = readdirSync(FIXTURES).filter((name) => name.endsWith(".json"));

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

    // Every output tab renders either generated code or Bunya's explanation
    // of why it cannot generate this diagram, never a crash.
    await page.getByRole("button", { name: "Output" }).first().click();
    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    expect(count).toBeGreaterThan(5);
    for (let index = 0; index < count; index++) {
      await tabs.nth(index).click();
      await expect(page.getByRole("tabpanel")).not.toBeEmpty();
    }
    expect(errors).toEqual([]);
  });
}
