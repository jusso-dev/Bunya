# Expansion: Network Security Group rule coverage

This folder expands Bunya's coverage of Network Security Group (NSG) controls
past the original five rules. It re-encodes selected PSRule for Azure, Checkov
and Azure Policy built-in checks against the **extended** `nsgSchema` in
`lib/catalogue/services.ts`, which now carries `inboundRules` / `outboundRules`
arrays so PSRule-style port-and-source checks can run against the property
model rather than being permanently advisory.

- PSRule for Azure: <https://github.com/Azure/PSRule.Rules.Azure> (MIT)
- Checkov:          <https://github.com/bridgecrewio/checkov> (Apache-2.0)
- Azure Policy:     <https://learn.microsoft.com/en-us/azure/governance/policy/samples/built-in-policies> (MIT)
- Pinned commits / tags: see `pinned.json`

Each rule cites its upstream rule ID and canonical doc URL. Rules whose
predicate depends on properties Bunya does not yet model are marked
`[advisory]` and have a `() => false` predicate so they still surface in
documentation but do not auto-flag. Where `inboundRules` is empty or
undefined on the graph node the predicate short-circuits and emits no
finding — diagrams from before the schema extension remain backwards
compatible.
