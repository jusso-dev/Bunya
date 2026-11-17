# Plan 006: Specify faithful NSG rule and subnet-association export
Priority P2 · Effort M design / L implementation · Risk HIGH for later implementation · Category direction · Depends on none.

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

This is a design spike, not permission to remove export safeguards. Produce `plans/006-nsg-export-design.md` describing one implementable supported subset, migration impact, format mapping, and acceptance fixtures. No runtime code changes in this plan.

## Why this matters

NSGs already have rules in the catalogue and importer, but any configured rules or associations block deployment export. Faithful support would make more imported network diagrams usable without discarding firewall intent.

## Current state

`lib/catalogue/services.ts:50-67` defines rule name, priority (100–4096), direction, access, protocol, source/destination prefix, and destination port, plus `defaultDeny`, `inboundRules`, `outboundRules`. Source port, plural prefixes/ranges, and application security groups are not represented.
`lib/generators/shared/validate.ts:44-47`:
```ts
if (deployment && node.type === "networkSecurityGroup" && (
  properties.defaultDeny !== false || (properties.inboundRules as unknown[]).length > 0 ||
  (properties.outboundRules as unknown[]).length > 0 || parsed.edges.some((edge) => edge.source === node.id || edge.target === node.id)
)) throw new Error(/* export blocked rather than silently dropping intent */);
```

The catalogue's graph relationships and `lib/rules/graph-rules/expansion-nsg.ts` already check NSG intent. README describes export blocking as intentional. Existing generator tests use pure graph fixtures and format assertions; match those patterns in the proposed acceptance matrix.

## Scope and commands

Write only `plans/006-nsg-export-design.md`; read catalogue, ARM import, graph topology, NSG rules and the five deployment exporters. No installs/builds/cloud calls required for design. Use Semble for discovery, Context7 for current Azure/Terraform/CLI format contracts, and cite exact documentation URLs/versions in the design.

Verify deliverable exists with `rtk proxy test -s plans/006-nsg-export-design.md`; `rtk git diff --check` exits 0; source diff remains empty for this spike.

## Steps

1. Inventory every current NSG input and association path. Verify each claimed field against an exact source reference.
2. Define direction-array consistency, per-direction priority/name uniqueness, CIDR/service-tag/wildcard support, port validation, one-NSG-per-subnet constraints, and defaultDeny semantics. Do not invent allow rules or discard unsupported fields silently.
3. Map the subset into ARM securityRules and subnet references, Bicep equivalents, AzureRM resources/associations, az CLI, and PowerShell. Specify explicit ordering and unsupported-case errors. Preserve resource group scoping.
4. Define fixtures for empty NSG, inbound/outbound allow+deny, mixed priorities, duplicate priority, defaultDeny collision, multiple subnet associations, conflicting NSGs, unsupported source port/ASG/plural fields, and import→export fidelity. Include exact unit-test commands and expected semantic assertions for the subsequent implementation.
5. Write rollout boundaries: add emission and tests first; remove only proven-supported validation blocks last. List remaining gaps and why they remain blocked.

## Done criteria

Design has sections `Supported subset`, `Format mapping`, `Association semantics`, `Default deny`, `Import fidelity`, `Acceptance matrix`, `Rollout`, and `Open questions`. Each format has concrete fields and ordering, not generic prose. Fixture outcomes are machine-checkable and include negative cases. No source code changed or export block lifted.

## STOP conditions

If upstream docs disagree with assumed field semantics, record uncertainty and keep that case unsupported. Do not call Azure to resolve design questions or expand to all Azure firewall features.

## Maintenance notes

No security intent may be silently reduced. Subsequent implementation needs independent generated-output review across all five formats.
