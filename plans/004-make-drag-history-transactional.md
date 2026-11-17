# Plan 004: Record one undo step per completed drag
Priority P2 · Effort S · Risk MED · Category correctness · Depends on none; validate with plan 003 browser gates before delivery.

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

Dragging a node within its parent or dragging a container updates positions without recording history. Undo skips the move, and an old redo branch can survive a fresh layout change. Users must be able to undo one gesture without replaying every pointer event.

## Current state

`components/canvas/Canvas.tsx:177-184`:
```ts
if (change.dragging || isContainerType(node.type)) {
  moveNode(node.id, position);
  continue;
}
const point = absolutePosition(current, { ...node, position });
const target = placeAt(current, point, node.type, node.id);
if (target.parentId === (node.parentId ?? null)) moveNode(node.id, position);
else reparentNode(node.id, target.parentId, target.position);
```

`lib/session/store.ts:178-184` replaces node position without `pushHistory`. `reparentNode` pushes current state after preceding drag events already changed coordinates. `pushHistory` retains 50 snapshots and clears future. `reset` clears history. Store tests in `lib/session/store.test.ts` use `beforeEach(reset)`, then assert actual node data after undo/redo.

## Scope

`lib/session/store.ts`, `lib/session/store.test.ts`, `components/canvas/Canvas.tsx`, new `e2e/history.spec.ts`, `e2e/drag-drop.spec.ts` only if reusing existing helpers. No broad store refactor, new state library, persistence format change, autosave redesign, or resize feature work.

## Steps and gates

1. Add store tests for one completed drag, many intermediate moves, same-parent move, container move, reparenting, no-op drag, and redo invalidation. Use snapshots of actual document positions/parent IDs, not callback-count-only assertions. Verify `rtk proxy pnpm exec vitest run lib/session/store.test.ts` demonstrates missing behaviour before production fix.
2. Add the smallest explicit drag transaction API/state needed to capture the document before first movement and push that original state once on successful changed completion. Keep intermediate moves smooth and out of history. Include final reparenting in the same transaction. No-op gestures leave history and redo unchanged. Reset/import/undo must not leave a stale transaction. Multiple selected node moves should be one gesture if React Flow supports them through the same callbacks. Verify the store tests pass.
3. Wire the appropriate React Flow v11 drag lifecycle (consult Context7 for installed API) so transaction begins before mutation and completes after final position/reparenting. Ensure keyboard moves do not become silently non-undoable. Add browser tests that use a real mouse gesture then toolbar Undo/Redo; verify coordinates and parent membership return to original/final states. Verify `rtk proxy pnpm exec playwright test e2e/history.spec.ts e2e/drag-drop.spec.ts` passes.
4. Run baseline gates and normal functional E2E. Confirm new tests fail with the history fix removed while preserving test setup. A focused rollback in the isolated checkout is acceptable; restore it immediately and rerun focused cases.

## Done criteria

One changed gesture adds exactly one history entry; multiple pointer updates do not fill the 50-entry limit. Undo restores start position and parent; redo restores final position and parent. Containers remain draggable. No-op gestures retain redo; changed gestures invalidate it. Unit and real browser assertions pass, and mutation check proves regression coverage.

## STOP conditions

Report if React Flow event ordering prevents reliable start/end capture, unrelated document mutations can enter the transaction unnoticed, or schema/persistence changes seem required. Do not solve this with per-mousemove snapshots. Stop after two unsuccessful targeted fixes.

## Maintenance notes

Subsequent editing gestures should reuse this boundary only when they need transaction semantics. Do not generalise all editor state into a new command framework.
