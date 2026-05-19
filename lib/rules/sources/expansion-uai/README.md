# expansion-uai — curated User-Assigned Managed Identity rules

Curated rule expansion targeting Azure User-Assigned Managed Identity
(`Microsoft.ManagedIdentity/userAssignedIdentities`). The rules in this folder
are re-encoded into Bunya's `RuleEntry` shape from these upstream authorities:

- **Microsoft Learn (Azure docs)** —
  <https://learn.microsoft.com/> — Canonical resource-name rules, managed
  identity authentication support matrix, customer-managed key guidance.
- **Microsoft Cloud Security Benchmark (MCSB v3)** —
  <https://learn.microsoft.com/en-us/security/benchmark/azure/> — Privileged
  access controls (PA-7) on preferring managed identities over service
  principals with secrets.
- **Azure Policy built-ins** —
  <https://learn.microsoft.com/en-us/azure/governance/policy/samples/built-in-policies>
  — Allowed-locations governance.
- **Australian ISM** —
  <https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/ism>
  — Privileged access logging requirements (ISM-0457).

Pinned snapshot details live in `pinned.json`. The generator metadata is in
`generated.meta.json`. Each `RuleEntry` carries the upstream `ruleId` (where it
exists) and the canonical doc URL on `source`, so attribution is preserved at
runtime.

Bunya models `userAssignedIdentity` with a single `notes: string` property, so
most controls that depend on identity-specific configuration (federation, role
assignments, region) cannot be evaluated against the property bag. Advisory
entries — where Bunya's property model cannot evaluate the upstream control —
are emitted with `predicate: () => false` (node rules) or `predicate: () => []`
(graph rules) and the `message` is prefixed with `[advisory]`. They appear in
documentation but never fire automatically.
