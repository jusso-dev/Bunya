# Azure Naming Tool — imported rules

This folder contains a curated re-encoding of resource naming constraints from
the [Azure Naming Tool](https://github.com/mspnp/AzureNamingTool) (a Microsoft
Patterns & Practices project) translated into Bunya's `RuleEntry` shape. The
upstream tool encodes the canonical Azure resource name rules (length, charset,
case-sensitivity, allowed punctuation) for every Azure resource provider.

- Source: <https://github.com/mspnp/AzureNamingTool>
- Pinned commit / tag: see `pinned.json`
- Licence: **MIT** (compatible with redistribution; attribution preserved in
  `RuleSource.url` on every rule)

Each rule cites its upstream `resourceTypes.json` entry (e.g.
`Microsoft.Storage/storageAccounts.length`) and the canonical file URL
`https://github.com/mspnp/AzureNamingTool/blob/main/src/repository/resourcetypes.json`.
Predicates run against `GraphNode.resourceName` and return `true` when the name
violates the constraint.
