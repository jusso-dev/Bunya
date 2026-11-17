# Plan 003: Gate Pages deployment with tests and static-site smoke checks
Priority P2 · Effort M · Risk LOW · Category tests/DX · Depends on none.

## Executor contract

Work only in an isolated execution checkout. Read this entire plan before editing. Use `caveman` for replies, `karpathy-guidelines` for implementation, Semble MCP before codebase discovery, and `rtk` for shell commands. Read relevant installed Next.js guides under `node_modules/next/dist/docs/` before code changes. Use Context7 for library/API changes; no cloud account access required.

Bunya is a static Azure-only design tool; imports approximate supported resources and must explain lost semantics. Preserve existing diagram compatibility, export safety guards, and unrelated work. Never print secrets, call real cloud services, trigger CodeBuild, or publish/deploy. Commit logical changes in the isolated branch using conventional commits (existing example: `fix: robustness audit of imports, inputs, toasts and saved diagrams`). Do not push or merge. Reviewer maintains `plans/README.md`.

Planned at `c870765371b6e10cf9968659c568f368afe920f9`, 2026-11-17. Before editing, run `rtk git diff --stat c870765371b6e10cf9968659c568f368afe920f9..HEAD -- <in-scope paths below>`, then compare excerpts. Earlier plans in the same execution sequence may intentionally change shared files; reconcile those changes explicitly. Unexplained drift requires a report before proceeding.

## Baseline commands

- `rtk proxy pnpm install --frozen-lockfile`: exit 0; expected to create ignored dependencies only.
- `rtk proxy pnpm lint`, `rtk proxy pnpm typecheck`, `rtk proxy pnpm test`, `rtk proxy pnpm rules:verify`: each exits 0.
- `rtk proxy pnpm build`: exit 0; static app builds.
- `rtk git diff --check`: exit 0.
- These commands were verified in manifests, not executed during planning. Record actual results; do not inherit prior pass claims.

## Why this matters

The repository has 12 Playwright spec files but no workflow runs them. Pages deploys after its own build without a verification dependency. Existing passing runs do not prevent a future browser regression or a failed-test commit from deploying.

## Current state

`.github/workflows/ci.yml` ends after `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm rules:verify`, `pnpm build`.
`.github/workflows/pages.yml:52-55`:
```yaml
deploy:
  name: Deploy
  needs: build
  runs-on: ubuntu-24.04
```

`playwright.config.ts` runs Chromium against `next dev` on loopback port 3189, base URL `/`. `next.config.ts` exports static files under `/Bunya` when `GITHUB_PAGES=true`. Scripts `build:pages` and `e2e` already exist.
`e2e/screenshots.spec.ts` and `e2e/screenshot-cost.spec.ts` write documentation PNGs under `project-docs/screenshots`; they must not run in normal quality gates.

Match existing SHA-pinned actions, Node 22, pnpm 10.33.0, minimal permissions, and existing concurrency policy. Browser assertions follow `e2e/portable.spec.ts` and `e2e/arm-import.spec.ts`: accessible locators, awaited state, ordinary imports. No sleeps to hide races.

## Scope

`.github/workflows/ci.yml`, `.github/workflows/pages.yml`, new `.github/workflows/verify.yml` if used, `playwright.config.ts`, new `playwright.pages.config.ts`, new `scripts/serve-pages.mjs` if needed for local static serving, new `e2e/pages-smoke.spec.ts`, `package.json`, `README.md` (verification commands), and only demonstrably broken browser-test helpers/specs under `e2e/` revealed by running the new gate. Do not alter runtime application behaviour merely to appease tests. No tracked screenshot/fixture regeneration, unrelated workflow edits, dependency additions, or CodeBuild.

## Steps and gates

1. Configure normal browser tests to exclude the two documentation-capture specs and the dedicated Pages smoke spec. Expose an explicit screenshot command if preserving discoverability requires it. Verify: `rtk proxy pnpm exec playwright test --list` lists functional specs, not documentation capture or Pages-only checks.
2. Add a separate static configuration and `e2e:pages` script. Build `out/` using `build:pages`, then serve it at the real `/Bunya/` URL with a minimal local-only static server using Node built-ins or an already installed tool. Do not introduce a dev server masquerading as production. Smoke checks: canvas visible, Azure image loads with nonzero natural width, template/import interaction renders nodes, deployment output tab renders, no page errors or missing app assets. Verify `rtk proxy pnpm build:pages` then `rtk proxy pnpm e2e:pages` exits 0.
3. Wire identical verification into PR CI and Pages before deploy. Preferred small structure: reusable `verify.yml` using `workflow_call`, called from both `ci.yml` and `pages.yml`; Pages build depends on successful verification and deploy remains dependent on that build. Same invocation must test/build the same `github.sha`; no mutable branch lookup or cross-run artifact selection. Browser install on Linux: `pnpm exec playwright install --with-deps chromium`. Preserve pinned existing setup actions. Verify workflow YAML parses and dependency inspection proves no deploy path bypasses verification.
4. Run `rtk proxy pnpm exec playwright install chromium` locally, then `rtk proxy pnpm e2e`; repair genuine test harness races with state-based waits or selectors, never weaken assertions or add skips/retries to mask failures. Verify full functional browser suite passes and tracked screenshots are unchanged.
5. Run all baseline gates and both browser suites. If a YAML/workflow validator is available, run it; otherwise report static validation limits. No remote workflow dispatch required.

## Test plan and done criteria

Functional E2E command must discover actual browser tests; Pages smoke must request the built /Bunya site, not dev mode. A missing icon or absent canvas must fail smoke. Tests must fail on page errors and target meaningful interactions. All local gates pass. `rtk git diff --name-only -- project-docs/screenshots` is empty. Workflow deploy graph includes successful verification for its source SHA. Hosted checks remain unverified until separately published.

## STOP conditions

Report if browser installation/network access is unavailable, a real application defect outside these five plans blocks the gate, or a deployment change would require secrets/production access. Do not alter branch protection or cloud resources. Do not introduce `continue-on-error` on gates. Two unsuccessful fixes to the same failure require a precise report.

## Maintenance notes

Keep documentation capture opt-in. Static base-path smoke complements dev E2E. Reusable validation may run twice on main via separate workflows; optimise later only if evidence warrants it, without weakening same-SHA gating.
