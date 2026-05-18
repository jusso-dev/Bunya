# Bunya

Bunya draws its name from the bunya pine, a tall south-east Queensland conifer
whose tiered, geometric silhouette already resembles a system diagram. The tree
is also tied to large Aboriginal gatherings that historically pulled nations
together to trade and share before dispersing again. Bunya the tool does much
the same job for cloud architecture: it gathers disparate Azure services into a
shared graph, makes the relationships explicit, and disperses the result into
the formats different teams actually use, including Terraform, Bicep,
PowerShell, az CLI, ARM, and Mermaid.

## Status

First cut. The Terraform generator is real and snapshot tested for five
services: Resource Group, App Service Plan, App Service, Storage Account, and
Key Vault. Everything else is on the backlog.

## Local development

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 to use the editor. The left palette adds services to
the canvas, the canvas wires up dependencies, and the right panel shows the
generated Terraform.

## Scripts

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run (snapshots in lib/generators/__snapshots__)
pnpm build       # next build
pnpm lint        # eslint
```

## Project layout

```
app/(canvas)/page.tsx        # editor route
components/                  # canvas, palette, output UI
lib/graph/                   # Zod schema, Zustand store, migrate stub
lib/catalogue/services.ts    # service catalogue (first-cut: 5 services)
lib/generators/terraform.ts  # Terraform generator + snapshot tests
```

## How the rules engine works

Bunya validates every graph against a registry of ~240 rules sourced from
authoritative publishers: PSRule for Azure, Checkov, Azure Policy built-ins,
the Azure Naming Tool, Bicep types, the Azure Private Link FAQ, the Australian
Government Information Security Manual, the Essential Eight Maturity Model,
Microsoft Learn well-known architectures, and Bunya's own hand-written
graph-shape rules under `lib/rules/graph-rules/`.

The rules engine is build-time. `pnpm rules:import` walks `lib/rules/sources/`,
calls each folder's `import.ts`, verifies every rule has a populated `source.url`
+ `message` + `longExplanation` + `tags`, then regenerates
`docs/rules/COVERAGE.md` and `docs/rules/GAPS.md`. The running app never makes
HTTP calls; rules ship as committed TypeScript so PR diffs are reviewable. When
a rule fires in the canvas the side panel cites the source URL so the engineer
can read the original definition.

The point of this design is honesty. Every rule has a publisher you can audit.
The coverage tables expose exactly what is and is not checked. Portfolio
reviewers value scoped, cited validation more than vague claims of
completeness, and this engine is the bit that makes Bunya credible alongside
visual-only diagram tools.

### Rule sources

Twenty source publishers indexed under three classifications (INGEST, MANUAL,
OUT-OF-SCOPE). See [`docs/rules/SOURCES.md`](docs/rules/SOURCES.md) for the
full list with licences. Highlights:

- PSRule for Azure (55 rules ingested)
- Checkov (31), Azure Policy built-ins (20)
- Azure Naming Tool (22), Bicep types (21)
- Australian Government ISM (17), Essential Eight Maturity Model (8)
- Azure Private Link FAQ (9), Microsoft Learn well-known patterns (10)
- Bunya hand-written graph-rules (49) under `lib/rules/graph-rules/`

Coverage table: [`docs/rules/COVERAGE.md`](docs/rules/COVERAGE.md). Run
`pnpm rules:import` to refresh both files.

### Known gaps

Bunya does not currently check the following. This list is generated, not
hidden. See [`docs/rules/GAPS.md`](docs/rules/GAPS.md) for the live, complete
version.

- **applicationInsights** — 4 rules
- **appServicePlan** — 4 rules
- **networkSecurityGroup** — 4 rules
- CIS Microsoft Azure Foundations Benchmark — commercial, not redistributable
- PCI DSS — commercial standard; out of project licence scope
- HITRUST CSF — commercial; not in scope for Australian-government workloads
- runtime policy enforcement (drift detection at runtime)
- cost prediction / forecasting

## Licence

MIT. See `LICENSE` when added.
