<p align="center">
  <img src="project-docs/logo-bunya.png" alt="Bunya logo" width="240"/>
</p>

<h1 align="center">Bunya</h1>

<p align="center">
  <em>Diagram-driven Azure Infrastructure as Code, with a rules engine that knows when the picture is wrong.</em>
</p>

<p align="center">
  <img src="project-docs/screenshots/02-three-tier-canvas.png" alt="Bunya canvas with the three-tier private architecture template loaded" width="1100"/>
</p>

Bunya turns Azure architecture diagrams into production-shaped Terraform,
Bicep, ARM, az CLI, PowerShell, Mermaid, and an auto-generated README, in one
pass. The diagram is the input. The IaC is the output. And before anything is
emitted, the graph is checked against 293 cited rules drawn from PSRule,
Checkov, Azure Policy, the Microsoft Cloud Security Benchmark, the Australian
ISM, and the Essential Eight.

[Skip to: How it works](#how-it-works) -
[Generators](#generators) -
[Rules engine](#rules-engine) -
[Organisation rule engine](#organisation-rule-engine) -
[Local dev](#local-development) -
[Known gaps](#known-gaps)

---

## Why Bunya is not just another diagram tool

There are dozens of tools that draw Azure boxes and arrows. Most of them are
diagram-first: pretty PNGs, awkward export buttons, and IaC output that no
serious engineer would put in front of a `terraform plan`. Bunya inverts that.
The diagram is a UI for the graph, the graph is the source of truth, and the
generators are the thing the project is actually judged on.

What that means in practice:

| Most diagram tools | Bunya |
| --- | --- |
| Boxes and arrows are the artefact | The graph is the artefact, diagram is a view |
| Export-to-Terraform is a half-finished feature | Six generators with snapshot tests |
| Edges are decoration | Edges have semantics: `network`, `identity`, `data`, `depends_on`, `diagnostic` - and they shape the generated resources |
| One Resource Group, hard-coded | Multi-RG architectures with nested containers, parent-aware emitters |
| Free text validation if any | 293 rules, each citing an authoritative publisher |
| "Looks good" is the gate | Every rule has an autofix or an explainable failure |

The whole point is the IaC. Drop a Resource Group on the canvas, drop an App
Service Plan and a Web App inside it, connect them with a `data` edge to
Storage and an `identity` edge to Key Vault, and click `Terraform`. What comes
out is real, idiomatic HCL with role assignments, diagnostic settings, and
managed-identity wiring. Click `Bicep` and the same graph emits idiomatic
Bicep, not a transliteration. Click `PowerShell` and the same graph emits
splatted, `Set-StrictMode`-aware Az cmdlets that pass `-WhatIf`.

## Built for Australian compliance

The product is opinionated about where data lives and how it talks. Default
region is `australiaeast`. Cross-region edges are flagged. Cosmos DB with
multi-region writes inside an Australia-resident workload raises a finding.
Resource names that don't pass the Azure Naming Tool's regex are caught at
design time, not at `terraform apply`. The Australian Government Information
Security Manual and the ACSC Essential Eight are first-class rule sources, not
afterthoughts.

If you are building for IRAP-aligned hosting, the rules engine is the part of
this tool that earns its keep.

---

## How it works

```
Palette ─┐
         ├─ drag/click ─┐
Templates┘              │
                        ▼
                  ┌───────────┐
                  │   Graph   │ ◄── Zod-validated, undo/redo, share URL
                  └─────┬─────┘
                        │
            ┌───────────┼────────────┐
            ▼           ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ Validate │ │  Render  │ │ Generate │
    │293 rules │ │ ReactFlow│ │  6 IaC   │
    └────┬─────┘ └──────────┘ └────┬─────┘
         │                         │
         ▼                         ▼
    Findings panel           Terraform, Bicep,
    with citations           ARM, az CLI,
    + autofix buttons        PowerShell, Mermaid,
                             README + zip download
```

1. **Drag a service from the palette onto the canvas.** Hit-test places the
   node inside the smallest container that accepts it. Resource Groups accept
   anything except other RGs. Virtual Networks accept Subnets. App Service
   Plans accept Web Apps and Function Apps.
2. **Drag from a node handle to another node to connect them.** The edge kind
   is inferred from the pair: `App Service -> Storage` is `data`, `App Service
   -> Key Vault` is `identity`, anything `-> Log Analytics` is `diagnostic`.
   Invalid connections are blocked at drag-time with a toast explaining why.
3. **Right panel auto-generates a form** from the selected node's Zod schema.
   Numeric ranges, enum dropdowns, boolean toggles, JSON record editors.
4. **The validation panel runs after every change.** Findings link back to
   nodes and edges; auto-fixable ones get a button.
5. **The output panel emits six IaC formats** plus an auto-README. Copy any
   file, download any file, or hit "Download all" for a zip you can drop into
   a fresh repo and `terraform apply`.

The whole thing is client-side. No backend, no accounts, no telemetry.
Persistence is `localStorage` plus three escape hatches:

- **Share URL** - gzips the graph into the URL fragment. Paste, open, same canvas.
- **Export** - downloads a versioned `.bunya.json` envelope (`{ format, version, exportedAt, generator, document }`). Hand it to a colleague, attach it to a Jira ticket, check it into a repo. It survives schema migrations because it pins `schemaVersion` and runs through `lib/graph/migrate.ts` on load.
- **Import** - via the toolbar button OR by dragging a `.bunya.json` or ARM
  template JSON file onto the canvas. You can also paste Azure Portal
  **Export Template** ARM JSON into the import dialog. Malformed files surface
  an explanation without clobbering the current graph.

## Supported services and import

Bunya currently models 26 Azure service/resource types:

- **Scaffold:** Resource Group.
- **Network:** Virtual Network, Subnet, Network Security Group, Private
  Endpoint, Private DNS Zone, Front Door, Application Gateway.
- **Compute:** App Service Plan, Web App (App Service), Function App, Static
  Web App, Azure Kubernetes Service, Virtual Machine Scale Set.
- **Data:** Storage Account, Azure SQL Database, Cosmos DB, Container Registry.
- **Security and identity:** Key Vault, User-Assigned Managed Identity, Role
  Assignment.
- **Observability:** Application Insights, Log Analytics Workspace, Monitor
  Alert Rule, Action Group.
- **Integration:** API Management.

ARM import is designed for the Azure Portal **Export Template** workflow. Paste
the ARM JSON or upload the file, and Bunya converts supported resources into a
working graph:

- Resource Groups, Virtual Networks, App Service Plans and their children are
  imported as nested containers where appropriate.
- App Service Plans become bounding boxes for Web Apps and Function Apps.
- AKS and VMSS imports preserve subnet references, node sizing, networking
  settings, managed identity, availability zones, monitoring hints and
  Log Analytics links where ARM exposes them.
- Private Endpoints import their subnet and target service edges.
- Private DNS Zones, VNet links and Private Endpoint DNS zone groups import as
  graphable DNS nodes and network edges.
- Function Apps infer backing Storage Account edges from `AzureWebJobsStorage`
  and ARM app settings.
- Role Assignments, Monitor Alert Rules and Action Groups import as explicit
  graph nodes where the exported template contains them.
- Unsupported ARM resources are skipped with a warning instead of failing the
  whole import.

## Generators

Each generator is a pure function `(graph) -> GeneratedFile[]`. Every change
to a generator forces a snapshot diff, so output regressions are visible on
PRs. Implicit resources (Function App without Storage, App Service without
Plan, Private Endpoint without Subnet) are inserted with a comment marker so
the user can promote them to explicit nodes.

| Target | Files emitted | Idiom |
| --- | --- | --- |
| Terraform | `versions.tf`, `main.tf`, `variables.tf`, `outputs.tf` | AzureRM 4.x. Per-resource module-friendly layout. Role assignments for identity edges. Diagnostic settings per `diagnostic` edge. Parent-aware `resource_group_name`. Includes AKS, VMSS, Private DNS Zone, Action Group and alert scaffolding. |
| Bicep | `main.bicep`, `main.parameters.json` | `targetScope = 'resourceGroup'`. `@allowed` decorators on enum properties. `@secure()` only when SQL is in the graph. Includes explicit service resources and comments where workload-specific alert/RBAC criteria need review. |
| ARM JSON | `azuredeploy.json`, `azuredeploy.parameters.json` | Verbose but valid. Dependency graph derived from edges, not hand-rolled. Emits Private DNS zones, VNet links, Private Endpoint DNS zone groups, generalized role assignments, alerts and action groups. |
| az CLI | `deploy.sh` | `set -euo pipefail`. `--only-show-errors`. Login check. `SQL_ADMIN_PASSWORD` guard only emitted when SQL is present. Emits deployable commands where CLI supports the resource cleanly and review comments for complex alert/RBAC cases. |
| PowerShell | `Deploy-Infrastructure.ps1` | `[CmdletBinding(SupportsShouldProcess)]`. Splatting. `Set-StrictMode -Version Latest`. No `Write-Host`. Emits deployable Az cmdlets where practical and explicit review comments for complex alert/RBAC cases. |
| Mermaid | `architecture.mmd` | `flowchart LR` with per-category classDefs and edge-kind labels. |
| README | `README.md` | Inlined Mermaid + deployment commands per format. |
| Cost | `cost-estimate.md` + in-tab table | Indicative monthly estimate per resource with AUD/USD toggle and a **user-editable AUD/USD exchange rate** (persisted to `localStorage`, plug in your treasury's number for accurate AUD). Source: `https://prices.azure.com/api/retail/prices`; refresh via `pnpm prices:refresh`. |

Conditional parameters: when the graph has no SQL Database, no generator
emits a SQL admin password parameter. When the graph has no Virtual Network,
no generator emits networking scaffolding. The output mirrors the graph
exactly.

<p align="center">
  <img src="project-docs/screenshots/07-bicep-output.png" alt="Bicep generated for the three-tier template, side-by-side with the canvas" width="1100"/>
</p>

<p align="center">
  <img src="project-docs/screenshots/09-cost-panel.png" alt="Cost tab showing monthly estimate per resource for the three-tier template" width="1100"/>
</p>

## Rules engine

Bunya checks every graph against 293 rules from curated source bundles. Every
rule cites a real URL. The running app never makes HTTP calls; rules ship
as committed TypeScript and are refreshed at build time with `pnpm rules:import`.

Sources currently ingested:

- **PSRule for Azure** - 55 rules covering Storage, App Service, SQL, Cosmos,
  Key Vault, ACR, VNet/NSG, App Gateway, Front Door, APIM, Functions, App
  Insights, Log Analytics.
- **Checkov** - 31 CKV_AZURE_* checks.
- **Azure Policy built-ins** - 20 policies translated from `Azure/azure-policy`.
- **Azure Naming Tool** - 22 length/charset rules.
- **Bicep types** - 21 enum/range rules derived from the AzureRM provider schema.
- **Australian Government ISM** - 17 controls including ISM-0974, ISM-1552,
  ISM-1525, ISM-1480, ISM-0405.
- **Essential Eight Maturity Model** - 8 strategy mappings to cloud configuration.
- **Azure Private Link FAQ** - 9 hand-encoded rules for Private Endpoint
  topology, the single richest source for edge rules.
- **Microsoft Learn well-known patterns** - 10 reference-architecture rules.
- **Application Insights expansion** - 6 workspace, sampling and retention
  rules.
- **App Service Plan expansion** - 6 hosting-plan reliability, cost and
  capacity rules.
- **NSG expansion** - 6 attachment and rule-shape checks.
- **User-Assigned Identity expansion** - 5 lifecycle and attachment checks.
- **Bunya hand-written graph-rules** - 77 rules under `lib/rules/graph-rules/`
  covering implicit dependencies, identity flow, observability, sovereignty,
  naming, cost, and compliance.

Recent graph-level coverage includes:

- Private Endpoint DNS correctness: matching Private DNS Zone, DNS zone group
  and VNet link.
- AKS hardening: kubenet retirement warning, network policy in prod, ACR
  identity edge, private/API exposure, Log Analytics and availability zones.
- VMSS hardening: subnet attachment, rolling upgrade mode, health probe /
  Application Health extension, Azure Monitor Agent / Log Analytics and
  availability zones.
- Public-network-disabled resources must have a valid private access path.
- Identity edges generate/check Azure RBAC role-assignment intent.
- Production graphs need Monitor Alert Rules and Action Groups, not only log
  storage.

Findings carry a `source.url` you can click. Many carry an `autofixId` you can
apply with one button. The compliance tables in
[`project-docs/rules/COVERAGE.md`](project-docs/rules/COVERAGE.md) regenerate every build.
[`project-docs/rules/GAPS.md`](project-docs/rules/GAPS.md) is honest about what is not
checked: CIS Benchmarks, PCI DSS, HITRUST CSF, runtime policy, cost prediction,
multi-region failover correctness.

<p align="center">
  <img src="project-docs/screenshots/05-validation-findings.png" alt="Validation findings panel with a real auto-fix" width="1100"/>
</p>

## Organisation rule engine

Bunya also has a session-scoped organisation rule engine for rules that are
specific to your platform team, landing zone, IRAP boundary, or internal Azure
Policy initiative. Open `Org Rules` in the toolbar to create rules without
changing the built-in rule bundle.

Organisation rules run in the same validation pipeline as PSRule, Checkov,
Azure Policy, ISM and Bunya graph rules. Findings show in the same panel,
carry the configured severity, and link back to the offending node. They are
stored separately from the diagram so teams can test different policy packs
against the same architecture.

What the creator supports today:

- **Property violation rules** - flag resources when a property is `equals`,
  `not_equals`, `present`, `missing`, `truthy`, `falsy` or `includes` a value.
  Example: `publicNetworkAccess equals true` on Web Apps, Functions, Key
  Vaults and Container Registries.
- **Relationship rules** - require or forbid graph edges by direction, edge
  kind and target service. Example: VMSS must have an outgoing `diagnostic`
  edge to Log Analytics, or Storage must have an incoming `network` edge from
  Private Endpoint.
- **Service scoping** - apply a rule to one service type, several service
  types, or every graph node.
- **Severity and enablement** - set `error`, `warning` or `info`, then toggle
  individual rules on and off without deleting them.
- **Presets** - add starter packs for `No Public`, `Private Path`, and
  `Diagnostics`. These are ordinary organisation rules after import, so they
  can be edited by exporting the pack, changing the JSON, and importing it
  again.

The Azure Policy import path is designed for the policy JSON teams already
have. Paste an Azure Policy definition, upload a JSON policy file, or import a
previous Bunya organisation rule pack. Bunya translates simple `policyRule.if`
conditions into graph checks by mapping common ARM resource types and aliases,
including:

- `Microsoft.Web/sites` -> Web App / Function App style `publicNetworkAccess`
  checks where the graph exposes that property.
- `Microsoft.Storage/storageAccounts` -> Storage Account public network,
  anonymous blob access and minimum TLS checks.
- `Microsoft.KeyVault/vaults` -> Key Vault public network and purge
  protection checks.
- `Microsoft.ContainerRegistry/registries` -> Container Registry public
  network access checks.
- `Microsoft.ContainerService/managedClusters` -> AKS-scoped rules when the
  policy field can be mapped to a Bunya property.
- `Microsoft.Compute/virtualMachineScaleSets` -> VMSS-scoped rules when the
  policy field can be mapped to a Bunya property.

Translation is intentionally conservative: if a policy condition cannot be
represented as a node-property or graph-edge check, import reports that it
could not extract usable rules instead of pretending runtime Azure Policy can
be fully simulated in a diagram. Complex effects, parameters, deployment-time
remediation and `deployIfNotExists` resources still belong in Azure Policy.
Bunya's value is catching the design intent while the architecture is still
being shaped.

Rule packs export as a versioned `.bunya-rules.json` envelope:

```json
{
  "format": "bunya-organisation-rules",
  "version": 1,
  "exportedAt": "2026-06-03T00:00:00.000Z",
  "rules": [
    {
      "id": "ORG.NO.PUBLIC.INGRESS",
      "name": "No public ingress",
      "description": "Internet-facing ingress must be explicitly approved.",
      "severity": "error",
      "enabled": true,
      "serviceTypes": ["appService", "functionApp"],
      "property": {
        "key": "publicNetworkAccess",
        "operator": "equals",
        "value": true
      },
      "message": "Public network access is not allowed for these workloads."
    }
  ]
}
```

Rules persist in `localStorage` under `bunya.organisationRules` for the current
browser session. They do not affect generated IaC directly; they affect the
validation gate, which is deliberate. If an organisation rule says "no public
ingress", the graph must model the private path explicitly before the design
goes clean.

## Containers and hierarchy

Real Azure architectures span multiple Resource Groups, Virtual Networks hold
Subnets, and App Service Plans are the compute boundary for Web Apps and
Function Apps. Bunya's graph models all three. Resource Groups, Virtual
Networks and App Service Plans render as dashed bounding boxes with a coloured
header pill. Drop a Storage Account inside an RG, a Subnet inside a VNet, or a
Function App inside a Plan and it becomes a child node, dragging-bound to its
parent. The generators walk the parent chain when resolving
`resource_group_name`, `virtual_network_name` or `serverFarmId`, so re-parenting
in the UI re-points the IaC.

<p align="center">
  <img src="project-docs/screenshots/06-resource-group-container.png" alt="Resource Group container with App Service Plan, App Service, Storage and Key Vault inside" width="1100"/>
</p>

## Starter templates

Three templates exist; choose one from the toolbar's `Templates` dropdown:

- **Static web app with API** - Static Web App + Function App + Storage +
  Application Insights pipeline.
- **Three-tier web app** - App Service + SQL + Storage behind Private
  Endpoints, with Key Vault and Log Analytics.
- **Event-driven Functions** - Function App + Storage + Cosmos DB with
  managed identity to Key Vault and App Insights to Log Analytics.

## Local development

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Open the editor. Drag from the left palette. Click `Templates` to load a
preset. The output panel updates live as you edit.

Scripts:

```bash
pnpm typecheck       # tsc --noEmit, strict
pnpm test            # vitest run (101 unit tests, snapshot coverage of every generator)
pnpm e2e             # playwright tests against the dev server
pnpm build           # next build (Turbopack)
pnpm rules:import    # rebuild rule registry + COVERAGE.md + GAPS.md
pnpm rules:verify    # assert every rule has source.url, no duplicates, >=100 total
pnpm rules:coverage  # regenerate coverage docs without re-ingesting
pnpm prices:refresh  # fetch Azure Retail Prices API and stage a snapshot diff
```

## Architecture

```
app/(canvas)/page.tsx               # editor route
components/
  canvas/Canvas.tsx                 # React Flow wrapper
  canvas/ServiceNode.tsx            # custom service node renderer
  canvas/ContainerNode.tsx          # bounding-box for Resource Group, VNet and App Service Plan
  canvas/Toolbar.tsx                # Undo/Redo, Templates, Share, panel toggles
  canvas/OrganisationRulesPanel.tsx # custom org rules, Azure Policy import/export
  canvas/ValidationPanel.tsx        # cited findings + autofix buttons
  catalogue/ServicePalette.tsx      # 26 services in 7 categories, drag + click
  output/OutputTabs.tsx             # seven tabs, copy/download/zip
  properties/PropertiesPanel.tsx    # auto-generated form from Zod schema
lib/
  graph/schema.ts                   # Zod schemas for GraphDocument/Node/Edge
  graph/store.ts                    # Zustand store, undo/redo, reparent
  graph/serialise.ts                # gzip + base64url share URL, localStorage
  catalogue/services.ts             # 26-service catalogue, allowed targets
  catalogue/icons.tsx               # Azure icon assets + category theme
  catalogue/templates.ts            # three starter templates
  catalogue/connections.ts          # canConnect() drag-time validator
  generators/                       # six generators + Mermaid + README
  rules/                            # rules engine: schema, runtime, sources
    organisation.ts                 # session custom rules + Azure Policy translation
    sources/<publisher>/            # one folder per upstream source
    graph-rules/                    # Bunya's hand-written BUNYA.* rules
  validation/runner.ts              # built-in + organisation rule validation
scripts/
  import-rules/                     # build-time ingestion pipeline
  generate-coverage.ts              # COVERAGE.md + GAPS.md generator
project-docs/
  rules/SOURCES.md                  # 20 sources, classified INGEST/MANUAL/OUT-OF-SCOPE
  rules/COVERAGE.md                 # auto-generated coverage tables
  rules/GAPS.md                     # auto-generated gap report
  screenshots/                      # captured by e2e/screenshots.spec.ts
e2e/                                # Playwright tests
```

## Tech stack

- Next.js 16 (App Router, Turbopack)
- TypeScript, strict mode, no `any`
- React Flow 11 for the canvas
- Zustand for graph state
- Zod for schema and form generation
- Tailwind CSS v4
- Lucide for toolbar/action icons; Azure architecture icon assets for service
  nodes.
- Vitest for unit tests, Playwright for end-to-end and visual capture
- `tsx` for the rules-engine build scripts

No backend. No accounts. No database. All client-side.

## Microsoft icon usage

Bunya may display Microsoft or Azure product icons only in the way Microsoft
permits them to be used for architecture diagrams, training materials, or
documentation. See Microsoft's
[Azure architecture icon guidance](https://learn.microsoft.com/en-us/azure/architecture/icons/)
for the current source guidance.

Do:

- Use the icon to illustrate how products can work together.
- In diagrams, include the product name somewhere close to the icon.
- Use the icons as they would appear within Azure.

Don't:

- Crop, flip, or rotate icons.
- Distort or change icon shape in any way.
- Use Microsoft product icons to represent Bunya or any other product or
  service.

## Known gaps

Bunya is honest about scope. The full live list is at
[`project-docs/rules/GAPS.md`](project-docs/rules/GAPS.md). Highlights:

- Azure services outside the 26 modelled node types are skipped during ARM
  import with a warning. The most important missing first-class services are
  Load Balancer, Public IP, NAT Gateway, Route Table, Azure Firewall, Bastion,
  Data Collection Rule, Recovery Services Vault, Service Bus, Event Grid,
  Event Hubs, Logic Apps, Container Apps, PostgreSQL Flexible Server, Redis and
  Virtual Machines.
- Monitor Alert Rule generation is intentionally scaffolded: the graph models
  alert ownership and routing, but metric names, dimensions and thresholds
  still need workload-specific review.
- Explicit Role Assignment nodes are graphable and ARM-exportable when Bunya
  can resolve principal and scope. Some CLI/PowerShell/Terraform/Bicep cases
  emit review comments where a principal ID or exact scope cannot be inferred
  safely.
- AKS node pools are modelled as properties of the AKS node, not separate
  draggable node-pool resources yet.
- VMSS health probes and Azure Monitor Agent are modelled as properties today;
  Load Balancer probes, Application Health extension and Data Collection Rules
  are not first-class graph nodes yet.
- CIS Microsoft Azure Foundations Benchmark - commercial, not redistributable.
- PCI DSS - commercial standard, out of project licence scope.
- HITRUST CSF - commercial, out of scope for Australian-government workloads.
- runtime policy enforcement (drift detection at runtime)
- AWS support, GCP support (intentionally out of scope - Azure only)

## The bunya pine

Bunya is named after the bunya pine, *Araucaria bidwillii*, a tall conifer
native to south-east Queensland and parts of northern New South Wales. The
tree has a distinctive architectural silhouette: a straight central trunk with
tiered, geometric branches stepping out at regular intervals. It looks like a
system diagram already.

The bunya is also significant in Aboriginal culture. Every few years the trees
produce enormous cones full of edible nuts, and historically this triggered
large gatherings of nations from across the region. People travelled long
distances to meet, trade, settle disputes, and share knowledge before
dispersing again. That is the metaphor for what this tool does: it gathers
disparate Azure services into a shared structure, makes the relationships
between them explicit, and then disperses the result into the formats
different teams actually use.

## Contributing

Pull requests welcome. The bar:

- `pnpm typecheck` clean
- `pnpm test` green (add tests for new generators or rules)
- New rules must cite a source URL (verify.ts will block PRs that don't)
- Generator changes get snapshot diffs reviewed
- Australian spelling in user-facing copy

## Licence

MIT. See [`LICENSE`](LICENSE).
