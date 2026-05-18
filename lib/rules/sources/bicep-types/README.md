# Bicep types — imported rules

This folder contains a curated re-encoding of property constraints from the
[Azure/bicep-types-az](https://github.com/Azure/bicep-types-az) repository
translated into Bunya's `RuleEntry` shape. `bicep-types-az` is the auto-generated
schema source used by the Bicep compiler and Visual Studio Code Bicep extension;
it encodes enums, required properties, and value ranges for every Azure resource
provider apiVersion.

- Source: <https://github.com/Azure/bicep-types-az>
- Pinned commit / tag: see `pinned.json`
- Licence: **MIT** (compatible with redistribution; attribution preserved in
  `RuleSource.url` on every rule)

Each rule cites its upstream type (e.g.
`Microsoft.Storage/storageAccounts@2023-05-01`) and a URL pointing to the
`generated/<provider>` folder in the upstream tree. Predicates inspect
`GraphNode.properties` and return `true` when the value is outside the allowed
enum / range encoded in the upstream type definition.
