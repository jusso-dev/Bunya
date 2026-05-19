# expansion-app-insights — curated Application Insights rules

Curated rule expansion targeting Azure Monitor Application Insights. The rules
in this folder are re-encoded into Bunya's `RuleEntry` shape from two upstream
authorities:

- **Microsoft Cloud Security Benchmark (MCSB v3)** —
  <https://learn.microsoft.com/en-us/security/benchmark/azure/> — Microsoft's
  consolidated cloud security baseline. Used for logging and telemetry guidance
  (LT-3 family) and policy/compliance citations.
- **PSRule for Azure** —
  <https://azure.github.io/PSRule.Rules.Azure/> — MIT-licensed Microsoft
  ruleset that ships canonical Application Insights checks
  (`Azure.AppInsights.Name`, `Azure.AppInsights.Workspace`).

Pinned snapshot details live in `pinned.json`. The generator metadata is in
`generated.meta.json`. Each `RuleEntry` carries the upstream `ruleId` and the
canonical doc URL on `source`, so attribution is preserved at runtime.

Advisory entries — where Bunya's property model cannot evaluate the upstream
control (for example local-auth disablement or customer-managed keys) — are
emitted with `predicate: () => false` (node rules) or `predicate: () => []`
(graph rules) and the `message` is prefixed with `[advisory]`. They appear in
documentation but never fire automatically.
