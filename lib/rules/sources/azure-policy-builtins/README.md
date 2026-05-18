# Azure Policy (built-ins) — imported rules

This folder contains a curated re-encoding of selected
[Azure Policy built-in definitions](https://learn.microsoft.com/en-us/azure/governance/policy/samples/built-in-policies)
translated into Bunya's `RuleEntry` shape. The built-ins are the Microsoft-
authored guardrails surfaced in the Azure portal under **Policy → Definitions →
Built-in** and form the basis of regulatory initiatives such as Microsoft Cloud
Security Benchmark and the Australian Government ISM PROTECTED initiative.

- Source / catalogue: <https://learn.microsoft.com/en-us/azure/governance/policy/samples/built-in-policies>
- Pinned snapshot date: see `pinned.json` (`commit` is the snapshot date)
- Licence: **MIT** for the policy JSON in the samples repo; attribution
  preserved in `RuleSource.url` on every rule

Each rule cites its upstream display name (e.g. *Secure transfer to storage
accounts should be enabled*) and the canonical built-ins doc URL. Where Bunya's
property model cannot evaluate the upstream policy (for example AAD-only auth or
TDE state) the predicate is set to `() => false` and the message is prefixed
with `[advisory]`, so the rule is still surfaced in documentation but is not
auto-flagged.
