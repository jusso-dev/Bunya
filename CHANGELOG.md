# Changelog

All notable changes to this project will be documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project follows [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

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
