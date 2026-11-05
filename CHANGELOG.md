# Changelog

All notable changes to this project will be documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project follows [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### ARM import fixes and deployability checks

- ARM import nests web apps in their App Service Plan when the export
  references plans through `parameters(...)`, maps Container Registry, SQL
  Database and Cosmos DB settings, and renames resources whose names exporters
  cannot emit (for example action groups with spaces).
- Import notes list one per line and include the unsupported value.
- Deployment exports no longer fail on catalogue display names such as
  "Web App (App Service)".
- New `BUNYA.NET.013` error, also enforced by deployment exporters: subnets
  must belong to a Virtual Network, subnet prefixes must fit the VNet and not
  overlap, containers accept only valid children, and VM Scale Sets must join
  a subnet.
- Bicep, ARM, PowerShell and Azure CLI exports reference a subnet's containing
  VNet instead of `main-vnet` when the subnet has no `depends_on` edge.
- Implicit Private Endpoint subnets and subnets dropped into a VNet pick a free
  prefix inside the VNet address space. The three-tier template no longer ships
  overlapping subnets.
- Dark mode toolbar buttons keep readable contrast on hover.

### Compliance alignment, Azure Policy export and nightly upstream sync

- Tagged 44 rules with CIS Microsoft Azure Foundations v3.0.0 control IDs
  (`cis-azure-v3.0.0:<control>`) through Microsoft's Azure Policy
  regulatory-compliance initiative. No CIS text is shipped, and the validation
  panel shows "Aligned", never "compliant" (#5).
- Added an **Azure Policy** output tab and MCP export target: an audit-only
  initiative of the built-in policies matching the diagram's rules, with Bicep
  and az CLI assignment to the deployed resource groups (#8). The generated
  README links to it.
- Recorded permanent scope decisions for PCI DSS (#6), HITRUST CSF (#7),
  runtime drift detection (#8) and AWS/GCP (#10) in `BACKLOG.md`, `SOURCES.md`,
  `GAPS.md` and the README.
- Replaced hand-drawn or borrowed icons for AKS, VMSS, Private DNS Zone, Monitor
  Alert Rule, Action Group and Role Assignment with official Azure icons, and
  recorded every icon in `lib/catalogue/icon-manifest.json`.
- Added `pnpm compliance:sync`, `pnpm icons:sync` and `pnpm upstream:check`, and
  a nightly workflow that opens one pull request for mechanical updates and keeps
  one report issue for changes that need review.
- Added a CI workflow for lint, typecheck, unit tests, rules verification,
  build and Playwright e2e.
- Added `BUNYA.COMP.RUNTIME-EOL`, which warns when an App Service or Function App
  runtime is past, or within 90 days of, the end of Azure support. New App
  Service and Function App nodes now default to Node 22 (Node 20 support ended
  on 30 April 2026).
- Fixed Azure Policy citations that named renamed, deprecated or non-existent
  built-ins, and updated the NSG flow-log rule for the move to virtual network
  flow logs.
- Validation findings now link to their source.
- ARM import keeps the Linux runtime and version from `siteConfig.linuxFxVersion`
  instead of replacing it with Bunya defaults.
- Added `THIRD_PARTY_NOTICES.md` for the Azure Policy metadata and Azure icons.
- Fixed coverage framework counting that matched any `waf` or `e8` substring.

### First cut

- Scaffolded Next.js 16 (App Router, Turbopack, Tailwind v4) project.
- Defined versioned `GraphDocument`, `GraphNode`, `GraphEdge` Zod schemas.
- Implemented Zustand store with add/remove/select/undo/redo and history.
- Locked first-cut catalogue to five services and wrote a deterministic
  Terraform generator with snapshot coverage.

### End-to-end build

- Expanded the catalogue to all 20 services with per-service Zod schemas and
  edge-kind inference.
- Added implicit resource expansion for App Service Plans, Storage Accounts,
  Private Endpoint subnets, and Application Insights workspaces.
- Added generators for Bicep, ARM JSON, az CLI bash, PowerShell, Mermaid and
  auto-generated README, each with snapshot tests covering every service.
- Implemented validation runner with 11 rules covering Essential Eight, ISM,
  generic graph hygiene, naming, and cost.
- Built drag-and-drop palette, React Flow canvas with typed edges, edge-kind
  picker, properties panel auto-generated from Zod, validation panel with
  click-through and auto-fix, and seven-tab output viewer with copy/download
  per file and a download-all zip.
- Added gzip+base64url share URLs, localStorage persistence, and three starter
  templates (static + API, three-tier private, event-driven Functions).

### Visual + connection hardening

- Built 20 hand-drawn SVG service icons and rendered them on both the palette
  cards and the custom React Flow canvas nodes, colour-coded per category.
- Added click-to-add as a drag-and-drop alternative on the palette.
- Replaced default React Flow nodes with a custom `ServiceNode` showing the
  icon, friendly name and resource name with category-coloured handles.
- Hardened connection creation: React Flow `isValidConnection` rejects
  self-loops, duplicate edges, unknown target types and would-be cycles, and
  the canvas surfaces a dismissable toast explaining the rejection.
- Added six new validation rules: `PE-PUBLIC`, `PE-INGRESS`, `PE-SUBNET-POLICY`,
  `PE-EDGE-KIND`, `NET-INGRESS-PUBLIC`, `IDENT-SOURCE`, each with autofixes
  where mechanical, covering the most common ways a Private Endpoint plan can
  be silently broken at deploy time.
