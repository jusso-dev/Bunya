# Plan 007: Specify one typed metric-alert slice
Priority P3 · Effort M design / M–L implementation · Risk MED · Category direction · Depends on none.

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

## Deliverable and boundary

Design spike only: write `plans/007-typed-alert-design.md`. Specify one concrete supported metric-alert type, its graph/UI contract, export mapping, and old-diagram behaviour. No runtime code changes or cloud access.

## Why this matters

Alert nodes currently accept free-text conditions and output placeholders. A narrow typed slice could produce meaningful alerts while keeping unsupported alert types explicit.

## Current state

`lib/catalogue/services.ts:213-217`:
```ts
export const monitorAlertSchema = z.object({
  severity: z.enum(["Sev0", "Sev1", "Sev2", "Sev3", "Sev4"]).default("Sev2"),
  condition: z.string().default("Platform metric or log query threshold"),
  enabled: z.boolean().default(true),
});
```

`lib/generators/terraform.ts:820-853` emits the resource-group scope, hardcoded severity 2, namespace `Microsoft.Resources/subscriptions/resourceGroups`, metric `AllMetrics`, threshold 0, and a linked action group. README explicitly calls alerts scaffolded. Do not retrospectively treat the documented limitation as a newly discovered defect.

## Scope and commands

Write only `plans/007-typed-alert-design.md`; read catalogue, graph edges, alert importer, generator alert emitters, property introspection, and migration code. Use Semble for discovery; Context7 for current metric/alert API docs. Verify file exists with `rtk proxy test -s plans/007-typed-alert-design.md`, `rtk git diff --check` exits 0, and source diff is empty for the spike.

## Steps

1. Choose one simple service/metric pair already represented by the catalogue; default candidate is Web App HTTP 5xx count if current Azure documentation confirms its metric contract. Cite namespace, metric identifier, unit, aggregations, and resource scope. If unavailable, keep the choice open with explicit blocking evidence instead of guessing.
2. Define typed metric kind, explicit target resource edge, aggregation, comparator, threshold, frequency/window, severity, enabled state, and action-group link. Specify allowed combinations and units. Avoid embedding query-language execution.
3. Specify old diagrams: preserve condition text for display; do not guess a metric or threshold from it. Explain UI scaffold/incomplete state and export handling consistently across five formats.
4. Map all five deployment formats using current schema docs. Severity must come from the model, target must be a resource, and unsupported types stay explicit. Name exact files that a later implementation should modify.
5. Define fixtures and assertions for valid criteria, changed severity, disabled alert, missing/wrong target, multiple targets, absent action group, invalid time window/threshold, and a legacy free-text node. Test expected generated fields, not snapshots alone.

## Done criteria

Design has sections `Metric contract`, `Graph and UI schema`, `Legacy diagrams`, `Format mapping`, `Acceptance matrix`, `Rollout`, and `Open questions`. Every chosen API field has a reference. One narrow slice is fully specified; log-query alerts, dynamic thresholds, arbitrary dimensions, and broad service coverage remain out of scope. No fabricated working alert defaults.

## STOP conditions

Record uncertainty if metric availability or API support cannot be confirmed. Do not infer meaningful thresholds for a user's workload. Do not expand into runtime monitoring, automatic deployment, tenant credentials, or unrelated observability features.

## Maintenance notes

Future metrics need their own contract and tests. The graph should distinguish executable criteria from historical descriptive text.
