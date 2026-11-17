# Bunya improvement audit

Date: 17 November 2026. Status: all seven plans complete and independently reviewed locally. Five fixes implemented; two feature designs completed.

## Execution index

User selected all work. Plans 001–005 implement the five retained findings; plans 006–007 produce scoped designs for the two optional product directions. Execute in order in one isolated worktree. The reviewer owns this index and independently verifies completed work before marking DONE.

| Plan | Deliverable | Priority | Depends on | Status |
|---|---|---|---|---|
| [001](001-patch-mcp-validation-dependencies.md) | Patched MCP SDK and Zod | P1 | None | DONE |
| [002](002-preserve-arm-resource-control-flow.md) | Explicit ARM conditions and copy handling | P2 | None | DONE |
| [003](003-gate-pages-with-browser-verification.md) | Browser gates and verified Pages deployment path | P2 | None | DONE |
| [004](004-make-drag-history-transactional.md) | One undo entry per drag | P2 | Verify with 003 | DONE |
| [005](005-avoid-noop-numeric-history.md) | No duplicate numeric undo entry | P3 | 004 when executed together | DONE |
| [006](006-design-nsg-export.md) | NSG export design and acceptance matrix | P2 | None | DONE |
| [007](007-design-typed-alert-criteria.md) | Typed metric-alert design and acceptance matrix | P3 | None | DONE |

Execution baseline: local `main` was safely fast-forwarded to the reviewed upstream commit `c870765371b6e10cf9968659c568f368afe920f9`. The untracked audit report was preserved. Source changes belong in the executor's isolated worktree; no push, PR, merge of implementation changes, or deployment is authorised by these plans. The audit facts below describe the earlier checkout and remain as provenance.

Workflow: [shadcn/improve](https://github.com/shadcn/improve/blob/cac56e1ebd3c279aa9153616cfeac7b174ab90f9/skills/improve/SKILL.md), standard audit. Skill read directly from the pinned upstream revision; no global skill installation performed.


## Completion and verification

Implementation branch: `t3/bunya-shadcn-improvements`, isolated checkout `/Users/justinmiddler/code-projects/worktrees/bunya/t3-365781ed`. Reviewed source commit: `1a3e265` (documentation-only completion updates follow). Main source remains at `c870765`; no implementation merge, push, PR, hosted workflow run, or deployment occurred. This index and the original plans are preserved in the implementation branch; copies remain in main's untracked `plans/` directory.

- **001:** MCP SDK resolves to 1.32.2 and Zod to 4.6.7. Frozen install succeeds. Audit confirms both targeted advisories absent; 34 other advisories remain, so the overall audit exits 1. Added an in-memory MCP client round-trip covering tool discovery, creation, validation, ARM export and invalid export target.
- **002:** Conditions retain resources only when exactly true. False, unresolved and non-boolean conditions, resource copy loops and copied inline subnets are skipped with explicit warnings. Added 17 control-flow tests; unsupported parent descendants remain skipped.
- **003:** Reusable verification gates CI and Pages at the same source SHA. Functional browser tests exclude documentation screenshots. Static `/Bunya/` smoke verifies the published build and asset path. Read-only GitHub checks found no current main branch protection or applicable rules requiring the former check name.
- **004:** Drag transactions create one undo step, including reparenting; no-op drags preserve redo. Independent review found and fixed Undo/Redo during an open drag. Three regression assertions failed before the review fix; the store suite passes 22/22 afterward.
- **005:** Missing-node and unchanged property patches preserve state/history. Numeric editing and blur regressions pass.
- **006:** [NSG export design](006-nsg-export-design.md) complete, with multi-resource-group ownership and older-reader compatibility requirements corrected during review. This is a design, not enabled export functionality. Keep the export block until importer loss and supported rule emission are addressed.
- **007:** [Typed metric-alert design](007-typed-alert-design.md) complete. This is a design, not an implemented schema/export change. Owner decisions and unverified provider details remain explicit in both designs.

Independent final local checks, after the review fix:

| Check | Result |
|---|---|
| Frozen dependency install | Pass |
| Lint and TypeScript | Pass |
| Unit tests | 37 files, 272 tests pass |
| Rules verification | 297 rules pass |
| Functional Chromium E2E | 41 pass |
| Production build | Pass |
| Pages build | Pass |
| Static Pages Chromium smoke | 2 pass |
| Workflow actionlint | Pass |
| Diff whitespace check | Pass |
| Tracked documentation screenshots | Unchanged |

Local pnpm is 10.11.0; workflows pin 10.33.0. Hosted CI and Linux Playwright are unverified. Full baseline gates were not run before implementation; focused dependency and regression mutation checks provide before/after evidence. Next dev's generated `AGENTS.md` heading adjustment is retained, as required by project instructions. No Cargo commands ran.

The audit below is historical evidence from before implementation, not the current completion state.

## Scope and evidence

- Local checkout: `main`, `d6887f862564115b8f0705c156bd544ccda1e78b`, initially clean.
- Upstream: `c870765371b6e10cf9968659c568f368afe920f9`, confirmed against GitHub's main ref during this audit. Local checkout is 34 commits behind. No pull or checkout performed.
- Every retained finding was independently checked against upstream using `git show`; upstream line numbers below refer to that exact SHA. Paths moved by the upstream refactor are identified explicitly.
- Reviewed all nine improve categories, weighted towards graph import/export, editor state, MCP input boundaries, and CI. Three independent read-only audit lanes; findings vetted by the coordinating reviewer.
- Product intent: static, client-side, Azure-only design tool. No accounts, live tenant validation, direct deployment, multi-cloud expansion, or custom catalogue proposal. Read `README.md`, `BACKLOG.md`, project instructions, manifests, test configuration, and all repository workflows.
- Upstream contains 36 unit-test files and 12 Playwright spec files. These are file counts, not passing-test counts. Dependencies are absent locally; no installs, builds, unit tests, or browser tests ran.
- Read-only `pnpm audit --json` ran against the local lockfile. Retained dependency versions were then checked against the upstream lockfile. Raw local advisory totals are deliberately not presented as upstream totals.
- Existing upstream [CI](https://github.com/jusso-dev/Bunya/actions/runs/43412915459) and [Pages](https://github.com/jusso-dev/Bunya/actions/runs/43412915562) runs were successful at the reviewed upstream SHA. This is hosted evidence, not a fresh local verification.
- No cloud calls, deployment, vulnerability reproduction, source edits, commits, pushes, or issue publication. Only this report was written.

## Prioritised findings

Effort: S = hours; M = roughly a day, including focused tests. Severity expresses project impact, not dependency CVSS. Confidence in the code/version evidence is HIGH throughout; runtime limitations are stated below.

| # | Finding | Category | Impact | Effort | Fix risk | Upstream evidence |
|---|---|---|---|---|---|---|
| 1 | Patch MCP SDK and Zod | Security / dependencies | P1: known high-severity validation advisories affect dependencies used on input paths | S | MED | `package.json:26,35`; `pnpm-lock.yaml:22,3351`; `mcp/http-server.ts:44` |
| 2 | Preserve or explicitly reject ARM resource conditions and copy loops | Correctness / tests | P2: imported resource existence and multiplicity can differ from the template | M | MED | `lib/graph/arm-import.ts:135` |
| 3 | Run browser checks and gate Pages on verification | Tests / DX | P2: browser regressions lack an automated gate; deployment has no CI dependency | M | LOW | `.github/workflows/ci.yml:48`; `.github/workflows/pages.yml:54` |
| 4 | Make completed drags undoable | Correctness | P2: Undo skips layout changes or reverts an older edit | S | MED | `components/canvas/Canvas.tsx:167`; `lib/session/store.ts:178` |
| 5 | Avoid duplicate history entries for numeric edits | Correctness | P3: first Undo after blur can do nothing | S | LOW | `components/properties/PropertiesPanel.tsx:287`; `lib/session/store.ts:226` |

### 1. Patch MCP SDK and Zod

Upstream lockfile resolves `@modelcontextprotocol/sdk` 1.31.0 and Zod 4.6.5. Current audit reports:

- [GHSA-46jr-4wx8-v453](https://github.com/advisories/GHSA-46jr-4wx8-v453): SDK request-validation memory exhaustion; patched in 1.32.0.
- [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5): Zod constrained-collection validation memory exhaustion; patched in 4.6.6.

`mcp/http-server.ts:44-49` passes parsed input to the SDK transport. `mcp/create-server.ts:70-85` registers tool input validation; `mcp/bunya.ts:35-43` defines constrained arrays. Browser graph validation also uses constrained Zod arrays in `lib/graph/schema.ts:110-114`.

The HTTP wrapper already limits bytes and nesting, defaults to loopback, and checks hosts and browser origins. Actual exploitability under these guards was not tested. This is a confirmed vulnerable-dependency maintenance finding, not a claim that the static Pages site exposes an MCP server.

Fix sketch: raise minimum versions to patched compatible releases, refresh the lockfile, review transport changes, and run existing HTTP/schema tests plus normal verification. Inspect transitive audit results after updating. Do not treat every SDK advisory as reachable: experimental task handling and bearer authentication are not established Bunya paths. `body-parser` also has an advisory, but Bunya passes a pre-parsed body; its vulnerable parsing path was not established and is not separately claimed.

### 2. Preserve or explicitly reject ARM resource conditions and copy loops

`ArmResource` omits resource-level `condition` and `copy` (`lib/graph/arm-import.ts:28-41`). `flattenResources` skips `existing` resources, then unconditionally appends one flattened record (`:142-170`). The import conversion has no resource-condition or copy-loop handling. Inline copied subnets are separately skipped without a warning (`:173-176`).

A supported resource with a false deployment condition becomes a graph node. A repeated resource becomes one node rather than the intended instances. Re-export cannot recover the discarded existence/count semantics. Other import warnings can appear, but there is no warning specifically explaining this loss. Local counterpart: `lib/graph/arm-import.ts:140-170`.

Fix sketch: handle control-flow metadata before flattening. Evaluate supported constant conditions; prominently warn and skip unsupported conditional/repeated resources instead of presenting them as faithful imports. Loop expansion is optional and must remain bounded if implemented. Add focused tests for false/true/unresolved conditions, copied resources, and nested resources; assert graph membership and warnings, then inspect exported resource presence. No full ARM evaluator rewrite required.

### 3. Run browser checks and gate Pages on verification

CI executes lint, typecheck, Vitest, rules verification, and build, but none of the four workflows runs Playwright. Existing browser checks cover import, export, drag/drop, keyboard behaviour, and other critical editor interactions. The newer quickstart import suite lives at `e2e/arm-import.spec.ts:12-44`.

Pages runs independently on pushes to main and manual dispatch. Its deployment job only has `needs: build` (`.github/workflows/pages.yml:54`), so the workflow itself permits deployment when tests fail elsewhere. Repository protection settings were not audited; this finding describes the workflow dependency, not an observed bad deployment.

Fix sketch: add an appropriate Chromium gate using the existing test command, then require successful verification for the same source SHA before deploying its artifact. Include a focused smoke check against the exported `/Bunya` build, because current Playwright configuration exercises `next dev` at `/`. Keep screenshot-producing specs separate where they write tracked documentation assets. Use GitHub-hosted runners or local verification; never CodeBuild.

### 4. Make completed drags undoable

`Canvas.tsx:177-184` sends drag updates, container moves, and same-parent final positions through `moveNode`. That action replaces positions without calling `pushHistory` (`lib/session/store.ts:178-184`). Consequently, moving an existing node within its container—or moving the container—does not create an undo step. Undo may revert an earlier edit instead. Moves also leave any existing redo stack intact.

Local counterparts: `components/canvas/Canvas.tsx:263-301`, `lib/graph/store.ts:173-180`. This is a complete static call-path finding; no browser reproduction ran.

Fix sketch: capture state at drag start and commit one history transaction when a changed drag ends, clearing redo appropriately. Preserve live positioning during the drag. Cover same-parent moves, containers, reparenting, and no-op drags; avoid adding one history entry per pointer event.

### 5. Avoid duplicate history entries for numeric edits

`NumberField` commits a valid number during `onChange` and commits it again on blur (`components/properties/PropertiesPanel.tsx:287-296`). `updateNodeProperties` always pushes a snapshot, even when the merged value is identical (`lib/session/store.ts:226-235`). The first Undo after a valid edit and blur can therefore restore an identical document. Duplicate snapshots also consume the 50-entry history limit.

Local counterparts: `components/properties/PropertiesPanel.tsx:286-296`, `lib/graph/store.ts:221-230`.

Fix sketch: avoid committing an unchanged value, or make the store action return unchanged state for a no-op patch. Keep numeric clamping and invalid-draft handling intact. Test history length and first Undo after edit/blur. Coordinate with finding 4 because both touch store history.

## Direction options

These are optional product work, not defects ranked against the findings.

- **Complete NSG rule and subnet-association export.** Existing schemas, import, and validation already model NSG intent, but deployment output is deliberately blocked (`lib/generators/shared/validate.ts:44-47`; `README.md:673`). A scoped design spike could specify consistent emission and semantic checks across formats. Value: more imported network diagrams become exportable. Effort L; high correctness risk. Keep the current block until supported controls are faithfully emitted.
- **Replace alert scaffolding with typed criteria.** `monitorAlertSchema` currently stores severity, free-text condition, and enabled state (`lib/catalogue/services.ts:213-217`); Terraform uses placeholder metric criteria (`lib/generators/terraform.ts:820-853`). README explicitly documents this limitation (`:609-611`). Start with one resource/metric type and explicit target, threshold, and aggregation fields. Value: less manual editing after export. Effort M–L; broader metric/log support would expand scope substantially.

## Selection and dependency order

Recommend plans for findings 1–4 first. Finding 5 is a small follow-up or a tightly scoped addition to the history plan.

1. Reconcile the executor checkout with upstream before implementation; use `c870765` or re-vet a newer revision. Local source paths and dependency state differ substantially.
2. Patch dependency versions independently; do not wait for workflow restructuring to address them.
3. Establish browser CI coverage before merging history changes. ARM import regression tests accompany finding 2.
4. Keep findings 4 and 5 serial if separate plans, because both modify the store.

Existing verification commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm rules:verify`, `pnpm build`, `pnpm build:pages`, `pnpm e2e`. They were inspected in manifests/workflows, not executed locally. Browser installation and any screenshot-writing behaviour must be accounted for in an implementation plan.

All findings subsequently selected by the user. Seven self-contained plans are linked in the execution index above; the two direction items remain design spikes rather than unrestricted feature implementations.

## Considered and rejected

- **Upgrade Next.js:** local version is stale; upstream already upgraded to 16.4.6. Excluded from new work.
- **Consolidate generators, output registry, Azure facts, and editor imports:** upstream's 34 commits already perform substantial consolidation. No duplicate refactor recommendation.
- **Reject custom DNS unless private zones are visible in the diagram:** existing external resolver configuration is an accepted design-time boundary. Missing graph evidence does not prove deployed DNS is broken; no new blocker claimed.
- **Require in-app authentication:** static editor has no backend; optional remote MCP explicitly requires proxy/edge authentication and TLS. No contrary runtime configuration established.
- **Treat NSG export blocking or alert scaffolding as regressions:** both documented limitations. Offered only as direction options.
- **Speculative performance rewrites:** no measured performance regression or sufficiently strong bounded-graph evidence justified a plan. No browser, bundle, or large-diagram profiling ran.
- **Broad dependency-audit totals:** local Next and development-only dependency findings do not establish current production exposure. Only retained runtime validation dependency findings are ranked.
- **Generic documentation cleanup, multi-cloud, accounts, runtime drift, Terraform import, mobile redesign, and plugins:** no concrete current documentation defect selected; feature proposals conflict with recorded scope.

Not audited exhaustively: every Azure resource/property mapping, generated IaC through provider compilers, live Azure behaviour, deployed MCP configuration, branch protection, all transitive dependency call paths, or browser visuals/accessibility/performance. This audit does not certify deployment correctness or security.
