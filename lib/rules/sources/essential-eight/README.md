# Essential Eight Maturity Model — imported rules

This folder contains a re-encoding of the eight mitigation strategies in the
[Essential Eight Maturity Model](https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/essential-eight),
published by the Australian Signals Directorate's Australian Cyber Security
Centre (ACSC), translated into Bunya's `RuleEntry` shape.

- Source: <https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/essential-eight>
- Publisher: Australian Signals Directorate — Australian Cyber Security Centre
- Pinned release: see `pinned.json`
- Licence: **Commonwealth of Australia copyright** — reproduced here in
  paraphrased form with attribution back to cyber.gov.au. No verbatim ACSC prose
  is included.

Each of the eight strategies is encoded as a single rule. Strategies that
cannot be evaluated at design time from an Azure resource graph (application
control, macro settings, user application hardening, multi-factor
authentication) are marked `[advisory]` with `predicate: () => false`, so the
strategy remains surfaced in documentation without being auto-flagged. The
remaining strategies (patch applications, restrict admin privileges, patch OS,
regular backups) are encoded as property-level checks against the Bunya service
schemas.
