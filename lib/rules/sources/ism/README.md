# Australian Government Information Security Manual (ISM) — imported rules

This folder contains a curated re-encoding of selected controls from the
[Australian Government Information Security Manual](https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/ism),
published by the Australian Signals Directorate's Australian Cyber Security
Centre (ACSC), translated into Bunya's `RuleEntry` shape.

- Source: <https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/ism>
- Publisher: Australian Signals Directorate — Australian Cyber Security Centre
- Pinned release: see `pinned.json`
- Licence: **Commonwealth of Australia copyright** — the ISM is published by the
  ACSC and is reproduced here in paraphrased form with attribution back to
  cyber.gov.au. No verbatim ACSC prose is included.

Each rule cites a real ISM control identifier (e.g. `ISM-0974`) in
`RuleSource.ruleId`. Control statements are paraphrased in our own words to
summarise the intent of the control as it applies to an Azure Bicep / IaC
deployment authored in Bunya. Where the property model cannot evaluate the
control at design time (for example MFA enforcement, patch cadence, or incident
reporting), the predicate is set to `() => false` and the message is prefixed
with `[advisory]` so the control remains discoverable in documentation without
being auto-flagged.
