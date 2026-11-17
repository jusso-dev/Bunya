# Plan 001: Patch MCP validation dependencies
Priority P1 · Effort S · Risk MED · Category security/dependencies · Depends on none.

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

The lockfile resolves MCP SDK 1.31.0 and Zod 4.6.5. Current advisories identify validation memory-exhaustion defects, patched in SDK 1.32.0 and Zod 4.6.6. Bunya uses these dependencies on input-validation paths. Existing size/depth/host limits remain valuable and must stay. No exploit reproduction is required or authorised.

## Current state

`package.json:26,35`:
```json
"@modelcontextprotocol/sdk": "^1.31.0",
"zod": "^4.6.5"
```

`mcp/http-server.ts:44-49` reads bounded JSON, creates a server, connects `StreamableHTTPServerTransport`, then calls `transport.handleRequest(request, response, body)`. `mcp/bunya.ts:35-43` uses Zod arrays capped at 100 nodes / 250 connections. Lockfile entries resolve SDK 1.31.0 and Zod 4.6.5.

Use `mcp/http-server.test.ts` as test convention: Vitest, loopback ephemeral port, afterEach closes connections and servers; it already tests healthy initialisation and existing boundary rejection. `mcp/bunya.test.ts` tests graph creation and exports. Avoid duplication of those tests.

Advisories: https://github.com/advisories/GHSA-46jr-4wx8-v453 and https://github.com/advisories/GHSA-mrhx-c7xc-m3w5.

## Scope

Modify only `package.json`, `pnpm-lock.yaml`, and, only for demonstrated compatibility fixes or missing benign coverage, `mcp/http-server.ts`, `mcp/create-server.ts`, `mcp/bunya.ts`, `mcp/http-server.test.ts`, `mcp/bunya.test.ts`. No Next/React upgrades, architecture changes, new authentication, or broad dependency refresh.

## Steps and gates

1. Install frozen baseline; inspect SDK 1.32.0 and Zod 4.6.6 release/API compatibility using Context7 where indexed. Verify: `rtk proxy pnpm exec vitest run mcp/http-server.test.ts mcp/bunya.test.ts lib/graph/schema.test.ts` passes, or record a baseline failure.
2. Raise manifest minimums to `^1.32.0` and `^4.6.6`, updating only their dependency graph. Prefer `rtk proxy pnpm add @modelcontextprotocol/sdk@^1.32.0 zod@^4.6.6`. Verify: `rtk proxy pnpm list @modelcontextprotocol/sdk zod --depth 0` shows patched releases and frozen installation exits 0.
3. Rerun focused tests; correct only necessary compatibility differences. If existing coverage lacks valid create/validate/export round-trip through the upgraded SDK, add bounded ordinary-data coverage. Verify: the focused test command in step 1 passes.
4. Run all baseline gates and `rtk proxy pnpm audit --json`. Audit may remain nonzero for unrelated packages; report them separately. Verify absence of the two named advisories for installed SDK/Zod versions, with actual package versions and audit results.

## Test plan and done criteria

- Existing valid stateless initialise request returns 200; graph creation/export retains its response shape.
- Existing malformed JSON, byte limits, hosts/origins, and schema rejection checks still pass.
- No stress payloads, memory-exhaustion attempts, or live endpoints.
- All baseline gates pass; manifests and lockfile agree; named advisories no longer match.
- Scope diff contains only listed paths; SDK/Zod minor updates do not silently upgrade Next.

## STOP conditions

Report if patched versions are unavailable, dependency resolution requires unrelated major upgrades, or compatibility changes exceed listed MCP paths. If a focused verification fails twice after reasonable fixes, report precise failure and preserve work.

## Maintenance notes

Do not mark all audit findings resolved merely because these two are fixed. Bunya's HTTP input guards and proxy-auth deployment contract remain unchanged.
