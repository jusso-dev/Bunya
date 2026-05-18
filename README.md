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

## Licence

MIT. See `LICENSE` when added.
