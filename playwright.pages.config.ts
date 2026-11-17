import { defineConfig, devices } from "@playwright/test";

// Smoke checks against the static export served under its real GitHub Pages
// base path (/Bunya/). Build first: pnpm build:pages. Run: pnpm e2e:pages.
const port = Number(process.env.PLAYWRIGHT_PAGES_PORT ?? 3190);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/pages-smoke.spec.ts",
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
    command: `node scripts/serve-pages.mjs --port ${port}`,
    url: `http://127.0.0.1:${port}/Bunya/`,
    // Never reuse: a stale server could be serving an older build.
    reuseExistingServer: false,
    timeout: 30000,
  },
});
