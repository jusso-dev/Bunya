import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3189);

// The two documentation-capture specs rewrite tracked PNGs in
// project-docs/screenshots, so they run only on request (pnpm e2e:screenshots).
// The static-site smoke spec has its own config (playwright.pages.config.ts).
const documentationSpecs = ["**/screenshots.spec.ts", "**/screenshot-cost.spec.ts"];
const documentation = process.env.PLAYWRIGHT_DOCS === "1";

export default defineConfig({
  testDir: "./e2e",
  ...(documentation
    ? { testMatch: documentationSpecs }
    : { testIgnore: [...documentationSpecs, "**/pages-smoke.spec.ts"] }),
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
