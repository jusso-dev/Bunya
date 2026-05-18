# Azure Private Link FAQ — imported rules

This folder contains a hand-encoded re-statement of guidance drawn from the
[Azure Private Link FAQ](https://learn.microsoft.com/en-us/azure/private-link/private-link-faq)
on Microsoft Learn, translated into Bunya's `RuleEntry` shape. Each entry cites
the specific FAQ anchor it derives from so that reviewers can trace a finding
back to the upstream answer.

- Source: <https://learn.microsoft.com/en-us/azure/private-link/private-link-faq>
- Revision pin: see `pinned.json`
- Licence: **CC-BY-4.0** (Microsoft Learn documentation; attribution preserved
  in `RuleSource.url` on every rule)

The FAQ describes operational behaviour of Azure Private Link / Private
Endpoints — public reachability, regional placement, DNS integration, NSG flow
log capture, deletion semantics, costs and supported services. The predicates
here are intentionally conservative: they emit `info` advisories for
informational FAQ answers and only escalate to `warning` or `error` when the
graph clearly contradicts a load-bearing FAQ statement (for example a
Private Endpoint whose subnet is in a different region than the document, or
a graph that fronts Private Endpoints without any public ingress hop).

All content has been paraphrased; no verbatim prose from Microsoft Learn is
copied into the predicates or messages. The category for every FAQ-derived
rule is `network`.
