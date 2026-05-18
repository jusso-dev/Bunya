# PSRule for Azure — imported rules

This folder contains a curated re-encoding of selected rules from
[PSRule for Azure](https://github.com/Azure/PSRule.Rules.Azure) translated into
Bunya's `RuleEntry` shape. PSRule for Azure is the Microsoft-maintained guardrail
ruleset for Azure resources and aligns with the Azure Well-Architected Framework
and Cloud Adoption Framework.

- Source: <https://github.com/Azure/PSRule.Rules.Azure>
- Docs:   <https://azure.github.io/PSRule.Rules.Azure/>
- Pinned commit / tag: see `pinned.json`
- Licence: **MIT** (compatible with redistribution; attribution preserved in
  `RuleSource.url` on every rule)

Each rule cites its upstream rule ID (e.g. `Azure.Storage.MinTLS`) and the
canonical doc URL of the form
`https://azure.github.io/PSRule.Rules.Azure/en/rules/<RuleId>/`. Where Bunya's
property model cannot evaluate the upstream check (for example soft-delete
retention or Defender plan enablement) the predicate is set to `() => false`
and the message is prefixed with `[advisory]`, so the rule is still surfaced in
documentation but is not auto-flagged.
