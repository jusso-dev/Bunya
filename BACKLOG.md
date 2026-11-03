# Bunya backlog

Scope decisions, so they stop tempting mid-build. Items under "Permanently out
of scope" are closed decisions, not deferred plans.

## Permanently out of scope

### AWS and GCP support ([#10](https://github.com/jusso-dev/Bunya/issues/10))

Bunya is Azure-only. Its value is depth, not breadth: the catalogue, edge
semantics, validation rules and IaC generators are all built on Azure's
resource model. AWS IAM is not equivalent to Azure managed identities, and a
GCP project is not a resource group. Pretending otherwise produces bad IaC. The
audience is Australian-region Azure workloads, where ISM, Essential Eight, IRAP
and the DTA Hosting Certification Framework apply.

If you need something else:

- a multi-cloud diagram tool: Lucidchart, Cloudcraft or Hava;
- an AWS diagram with IaC: draw.io with AWS shapes and AWS Application Composer;
- cross-cloud security validation: Wiz, Orca or Prisma Cloud.

The architecture (typed catalogue, cited rules, per-target generators) ports
cleanly to a fork, but that would be a different product.

### Runtime policy enforcement and drift detection ([#8](https://github.com/jusso-dev/Bunya/issues/8))

Bunya is a design-time, client-side tool: no backend, no accounts, no
telemetry. Drift detection needs a tenant connection (service principal or
workload identity), continuous Azure Resource Graph polling and somewhere to
store last-known state. That turns a static asset into a trusted SaaS that
holds credentials, which is a different security posture and a different
product. Azure Policy, Defender for Cloud, Microsoft Sentinel and CSPM tools
already do this well.

The bridge Bunya offers instead is the **Azure Policy** export: the built-in
policies that check the same controls as the rules in a diagram, packaged as
an audit-only initiative you assign yourself.

### HITRUST CSF ([#7](https://github.com/jusso-dev/Bunya/issues/7))

Won't fix. HITRUST is a commercial, US-healthcare framework and its mapping
content is not freely redistributable. The relevant Australian equivalents are
the Australian Digital Health Agency's guidance and the Privacy Act, which
Bunya already touches through the ISM. Revisit only if a healthcare customer
materially funds the work.

### PCI DSS ([#6](https://github.com/jusso-dev/Bunya/issues/6))

Bunya does not check PCI DSS and adds no PCI tags. Use a QSA, not a diagram
tool. The standard is owned by the PCI Security Standards Council, applies to
card-handling workloads outside Bunya's core audience, and a PCI tab would
suggest a completeness Bunya cannot provide. Roughly 70% of Azure PCI guidance
overlaps the Microsoft Cloud Security Benchmark rules Bunya already ships.

## Decided

### CIS Microsoft Azure Foundations Benchmark ([#5](https://github.com/jusso-dev/Bunya/issues/5))

Indirect mapping. CIS benchmark text is never ingested. Microsoft's
CIS Azure Foundations v3.0.0 regulatory-compliance initiative in
[Azure/azure-policy](https://github.com/Azure/azure-policy) (MIT) groups
built-in policies under CIS control IDs. Bunya maps its rules to the built-in
policies that check the same setting (`lib/rules/compliance/policy-alignments.ts`),
and `pnpm compliance:sync` copies only the control IDs. Rules are tagged
`cis-azure-v3.0.0:<control>` and the UI shows them as "aligned", never
"compliant". The nightly workflow reports when a newer CIS initiative appears.

## Out of scope for now

- Terraform import (round-trip)
- User accounts, authentication and server-side persistence
- Real-time collaboration (CRDT, WebSocket)
- Direct deploy from the app
- AI-assisted layout or suggestion
- Custom service catalogues and plugins
- Mobile layout (desktop only; do not break on tablet)
- Cost prediction or forecasting beyond indicative retail estimates
- Ingesting tfsec/Trivy, KICS and TFLint AzureRM rules (see `project-docs/rules/SOURCES.md`)
- Re-curating rules for PSRule, Checkov and Azure Naming Tool releases newer
  than the pins, and the AzureRM 5.x provider (tracked by the nightly upstream
  report)
