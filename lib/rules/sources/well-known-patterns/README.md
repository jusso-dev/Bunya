# Azure well-known patterns — imported rules

This folder contains a hand-encoded set of pattern-completion checks drawn
from the [Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/)
reference architectures and the [Azure Well-Architected Framework](https://learn.microsoft.com/en-us/azure/well-architected/)
service guides. Each rule expresses a positive topology — a "shape" the docs
recommend — and fires when a Bunya graph clearly signals intent to use that
shape but is missing a required complement.

- Source: <https://learn.microsoft.com/en-us/azure/architecture/> and
  <https://learn.microsoft.com/en-us/azure/well-architected/>
- Revision pin: see `pinned.json`
- Licence: **CC-BY-4.0** (Microsoft Learn documentation; attribution
  preserved in `RuleSource.url` on every rule)

These rules are intentionally heuristic. They look for the well-known
combinations of resources that the Azure docs treat as a pattern (Hub & Spoke
with NSGs, App Service behind Front Door, Function App with Application
Insights, Static Web App with managed Functions, Key Vault with diagnostic
settings, Application Gateway with WAF v2, prod with zone-redundant SKUs,
prod with geo-redundant storage, SQL with Private Endpoint, and any
compute -> data path using a managed identity) and emit a finding when the
matching complement is absent. All rules use category `reliability` or
`network` and tag `well-architected` / `architecture-center` so reviewers can
filter for them in the UI.

All content has been paraphrased; no verbatim prose from Microsoft Learn is
copied into the predicates or messages.
