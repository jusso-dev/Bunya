# Plan 005: Avoid duplicate undo entries on numeric edit and blur
Priority P3 · Effort S · Risk LOW · Category correctness · Depends on plan 004 only when both run together, because they edit the same store.

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

A valid numeric input commits during change and again on blur. The store snapshots both, so first Undo can do nothing. Fix no-op commits without breaking clamping or draft input.

## Current state

`components/properties/PropertiesPanel.tsx:287-296`:
```ts
onChange={(e) => {
  setDraft(e.target.value);
  const n = Number(e.target.value);
  if (e.target.value.trim() !== "" && Number.isFinite(n) && n === parse(e.target.value)) onChange(n);
}}
onBlur={() => {
  if (draft === null) return;
  const next = parse(draft);
  if (next !== null) onChange(next);
  setDraft(null);
}}
```

`lib/session/store.ts:226-235` calls `pushHistory` for every property patch. Existing `e2e/robustness.spec.ts` checks App Service Plan capacity clamps -5 to 0 and 3.7 to 4 and persists the valid value. Preserve that behaviour.

## Scope

`lib/session/store.ts`, `lib/session/store.test.ts`, `components/properties/PropertiesPanel.tsx` if needed, `e2e/robustness.spec.ts`, `e2e/history.spec.ts`. No deep-comparison library, property schema migration, or unrelated property-editor refactor.

## Steps and gates

1. Add a store test committing the same scalar property twice: the second call must preserve document/history/future and first Undo restores the prior value. Also cover nonexistent node IDs and an actual changed patch. Verify `rtk proxy pnpm exec vitest run lib/session/store.test.ts` initially fails on the duplicate history assertion.
2. Prefer a small no-op guard in `updateNodeProperties`: locate the node, compare patch entries with existing values using appropriate scalar/reference equality, return unchanged state if no value changes. Do not alter nested-object semantics globally. Alternatively avoid the duplicate blur commit, but retain store tests for chosen behaviour. Verify targeted store tests pass, including plan 004 regressions.
3. Add browser coverage: edit capacity to a valid different value, blur, click Undo once, reselect node if required, and assert original capacity; Redo once restores changed value. Test invalid/clamped draft behaviour remains intact. Verify `rtk proxy pnpm exec playwright test e2e/robustness.spec.ts e2e/history.spec.ts` passes.
4. Run all baseline gates and normal E2E. Demonstrate the numeric regression fails with this fix removed and passes when restored.

## Done criteria

A valid numeric edit followed by blur produces no identical undo snapshot. Unchanged updates neither clear redo nor consume history. Real changes remain undoable. Existing clamp/persistence tests and drag transaction tests pass. Scope contains only listed files.

## STOP conditions

Report if fixing this requires deep equality across arbitrary graph properties, changes the persisted document shape, or conflicts with active drag transactions. Two unsuccessful focused fix attempts require an evidence-based report.

## Maintenance notes

This fixes duplicate commits, not keystroke coalescing for all text inputs. A broader edit-session history model is outside scope.
