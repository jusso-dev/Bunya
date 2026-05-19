# App Service Plan rule expansion

This folder expands Bunya's coverage of the `appServicePlan` resource type beyond the
five rules that already live in the upstream `psrule-azure`, `azure-policy-builtins`,
`checkov-azure`, `azure-naming-tool` and `well-known-patterns` source bundles.

It pulls from a mix of upstream rulesets so each finding can cite a canonical doc URL:

- [PSRule for Azure](https://github.com/Azure/PSRule.Rules.Azure) — `Azure.AppService.*`
  rules. Licence: **MIT**.
- [Azure Policy built-ins](https://learn.microsoft.com/en-us/azure/governance/policy/samples/built-in-policies).
  Licence: **CC-BY-4.0**.
- [Checkov for Azure](https://docs.bridgecrew.io/) — `CKV_AZURE_*`. Licence: **Apache-2.0**.
- Microsoft Learn — App Service hosting plans, naming rules, reliability availability
  zones, scaling guidance for Azure Functions. Licence: **CC-BY-4.0**.

Each `RuleEntry` cites the upstream rule ID where one exists and the canonical doc
URL on `RuleSource.url`. Where Bunya's `appServicePlanSchema` cannot evaluate the
upstream check (for example `zoneRedundant` is not modelled on the App Service plan
in `lib/catalogue/services.ts`), the predicate is set to `() => false` and the
message is prefixed with `[advisory]` so the rule is still surfaced in
documentation but is never auto-flagged.

The `expansion-app-service-plan` bundle is intentionally isolated from
`lib/rules/registry.ts` so it can be wired in via a follow-up PR alongside the
graph-rules bundle in `lib/rules/graph-rules/expansion-app-service-plan.ts`.

- Pinned upstream revision: see `pinned.json`.
- Generator metadata: see `generated.meta.json`.
- Importer entry point: `import.ts` (`importExpansionAppServicePlan`).
