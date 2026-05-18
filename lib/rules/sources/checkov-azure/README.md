# Checkov (Azure) — imported rules

This folder contains a curated re-encoding of selected Azure checks from
[Checkov](https://github.com/bridgecrewio/checkov) by Bridgecrew/Prisma Cloud,
translated into Bunya's `RuleEntry` shape. Checkov is an open-source static
analysis tool for IaC and provides a broad library of `CKV_AZURE_*` checks for
Azure resources.

- Source: <https://github.com/bridgecrewio/checkov>
- Docs:   <https://docs.bridgecrew.io/docs>
- Pinned tag / commit: see `pinned.json`
- Licence: **Apache-2.0** (compatible with redistribution; attribution preserved
  in `RuleSource.url` on every rule)

Each rule cites its upstream rule ID (e.g. `CKV_AZURE_2`) and the canonical doc
URL of the form `https://docs.bridgecrew.io/docs/<rule-id-lowercase-with-dashes>`.
Where Bunya's property model cannot evaluate the upstream check (for example
Defender plan enablement, auditing retention, or storage logging) the predicate
is set to `() => false` and the message is prefixed with `[advisory]`, so the
rule is still surfaced in documentation but is not auto-flagged.
