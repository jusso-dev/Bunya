# Plan 002: Handle ARM resource conditions and copy loops explicitly
Priority P2 · Effort M · Risk MED · Category correctness/tests · Depends on none.

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

Resource-level deployment conditions and copy loops currently disappear during import. A disabled resource can become unconditional output; repeated resources can collapse to one. Preserve the supported subset and explain unsupported semantics before a user generates code.

## Current state

`lib/graph/arm-import.ts:135-170`:
```ts
const written = asRecord(value) as ArmResource;
if (written.existing === true) return;
// type/name resolution
out.push(flat);
out.push(...flattenResources(resourceList(written.resources), evaluator, warnings, flat));
```

`ArmResource` at lines 28-41 has neither `condition` nor `copy`. Inline VNet subnets with `entry.copy !== undefined` are silently skipped at lines 173-176. `lib/graph/arm-expressions.ts` exports `UNRESOLVED` and an evaluator of template-local expressions; deployment-dependent results are not guessed.

Match `lib/graph/arm-import-expressions.test.ts`: construct small plain template objects, call `parseArmTemplate(JSON.stringify(template))`, require `ok`, inspect node membership and returned warning. Existing tests use an `imported` helper and real template fixtures. Keep approximate-import warnings; do not implement a full ARM interpreter.

## Scope

`lib/graph/arm-import.ts`, `lib/graph/arm-import.test.ts`, `lib/graph/arm-import-expressions.test.ts`, new `lib/graph/arm-import-control-flow.test.ts`, `README.md` (import contract only). Read evaluator and exporters, but do not rewrite them. No changes to resource catalogue, live Azure calls, or automatic deployment.

## Steps and gates

1. Add focused regression cases with an unconditional supported sibling so an intentionally empty conditional branch does not confuse import result assertions. Cases: literal false/true; parameter-default boolean; supported expression yielding boolean; unresolved deployment condition; invalid nonboolean condition; resource copy with zero/static/dynamic count; nested children of omitted parents; copied inline subnets. Verify: `rtk proxy pnpm exec vitest run lib/graph/arm-import-control-flow.test.ts` fails on the intended membership/warning assertions before the fix.
2. Add optional unknown `condition` and `copy` fields. Before flattening, evaluate conditions strictly: true retains, false skips, unresolved/nonboolean warns and skips. Distinguish unsupported conditions from known false conditions in diagnostics. Skip descendants of skipped resources conservatively and explain approximation where relevant. Verify the same focused tests pass for condition cases.
3. For this bounded fix, do not expand loops: detect resource-level copy (including zero count), warn clearly and skip that resource/subtree. Give copied inline subnet declarations an explicit warning too. Avoid evaluating a copy-dependent name as a single ordinary node. Verify loop cases and mixed valid siblings pass.
4. Assert absent resources stay absent in generated ARM and another deployment format for a simple supported fixture. Do not accept an output-generation error as proof of correct membership. Update import limitations in README. Verify: `rtk proxy pnpm exec vitest run lib/graph/arm-import-control-flow.test.ts lib/graph/arm-import.test.ts lib/graph/arm-import-expressions.test.ts` passes.
5. Run lint/typecheck/full tests/rules verification/build and `rtk git diff --check`. Existing Azure quickstart imports remain green; inspect any changed expectation, never replace fixtures wholesale.

## Done criteria

All named condition/copy branches have behavioural assertions. No unsupported copy is imported as one ordinary resource. False conditions cannot generate resources. Unknown/invalid conditions and omitted copy declarations produce useful warnings. Ordinary resources and true conditions still import. Regression test fails on old production logic and passes on fixed logic. Full gates pass and scope remains listed.

## STOP conditions

Report if correct handling requires new expression-language features, loop expansion, or a schema migration. Do not silently support a condition using JavaScript truthiness. Preserve existing intentional external-DNS behaviour. Stop after two unsuccessful focused fix attempts.

## Maintenance notes

Future loop support must respect input/node limits and resolve references per instance. Do not remove warnings until semantics are represented faithfully.
