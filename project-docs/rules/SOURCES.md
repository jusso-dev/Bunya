# Rules Sources

This catalogue lists the upstream sources Bunya draws its rules from. Each
entry records the canonical URL, the licence we operate under, and a
classification that drives how the rule appears in the pipeline:

- **INGEST** — pulled into `lib/rules/sources/<slug>/` by the
  `pnpm rules:import` pipeline. Licence permits redistribution of the rule
  IDs and metadata we use.
- **MANUAL** — used as reference material to hand-author rules; we do not
  redistribute the upstream document verbatim. Attribution required.
- **OUT-OF-SCOPE** — recognised standard, but not redistributable under our
  licence terms or not relevant to Australian-government deployments.

> This file is hand-written. Do not regenerate it from the importer.
> COVERAGE.md and GAPS.md are auto-generated and reference these classifications.

---

## INGEST

### PSRule for Azure
- URL: https://github.com/Azure/PSRule.Rules.Azure
- Licence: MIT
- Classification: INGEST
- Description: Microsoft-maintained PSRule ruleset covering Azure resource
  best practices across networking, identity, data protection, and reliability.

### Checkov
- URL: https://github.com/bridgecrewio/checkov
- Licence: Apache-2.0
- Classification: INGEST
- Description: Bridgecrew's static analysis ruleset for Terraform, Bicep, and
  ARM templates; the `CKV_AZURE_*` family is the source we ingest.

### Azure Policy built-ins
- URL: https://github.com/Azure/azure-policy
- Licence: MIT
- Classification: INGEST
- Description: Microsoft's catalogue of built-in Azure Policy definitions
  used to align our rules with Azure-native enforcement.

### Azure Naming Tool
- URL: https://github.com/mspnp/AzureNamingTool
- Licence: MIT
- Classification: INGEST
- Description: Microsoft Patterns and Practices naming-constraint catalogue
  for Azure resource types (length, charset, case rules).

### Bicep types
- URL: https://github.com/Azure/bicep-types-az
- Licence: MIT
- Classification: INGEST
- Description: Auto-generated Bicep type definitions; the source of truth
  for valid property names, enum values, and required fields.

### tfsec / Trivy IaC
- URL: https://github.com/aquasecurity/trivy
- Licence: Apache-2.0
- Classification: INGEST (not yet imported)
- Description: Aqua Security's IaC scanner covering Azure Terraform; will be
  added in a future iteration of the rules pipeline.

### KICS Azure queries
- URL: https://github.com/Checkmarx/kics
- Licence: Apache-2.0
- Classification: INGEST (not yet imported)
- Description: Checkmarx's Keeping Infrastructure as Code Secure project
  contains a substantial Azure query set we plan to ingest.

### TFLint AzureRM ruleset
- URL: https://github.com/terraform-linters/tflint-ruleset-azurerm
- Licence: MPL-2.0
- Classification: INGEST (not yet imported)
- Description: AzureRM-specific TFLint plugin rules; complementary to the
  general Checkov set and useful for Terraform-first teams.

---

## MANUAL

### Australian Government Information Security Manual (ISM)
- URL: https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/ism
- Licence: Commonwealth copyright (attribution)
- Classification: MANUAL
- Description: ACSC's primary cyber-security guidance for Australian
  government systems. We map relevant controls into Bunya rule metadata.

### Essential Eight Maturity Model
- URL: https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/essential-eight
- Licence: Commonwealth copyright (attribution)
- Classification: MANUAL
- Description: ACSC's mitigation strategies and maturity levels — used to
  tag rules with the Essential Eight controls they support.

### Azure Private Link FAQ
- URL: https://learn.microsoft.com/en-us/azure/private-link/private-link-faq
- Licence: CC-BY-4.0
- Classification: MANUAL
- Description: Microsoft Learn FAQ on Private Link semantics and supported
  resource types; informs our private-endpoint network rules.

### Azure Well-Architected Framework
- URL: https://learn.microsoft.com/en-us/azure/well-architected/
- Licence: CC-BY-4.0
- Classification: MANUAL
- Description: Microsoft's framework covering reliability, security, cost,
  operational excellence, and performance efficiency pillars.

### Azure Architecture Center
- URL: https://learn.microsoft.com/en-us/azure/architecture/
- Licence: CC-BY-4.0
- Classification: MANUAL
- Description: Reference architectures and design guidance underpinning the
  graph-scoped rules in Bunya.

### Microsoft Cloud Security Benchmark v3
- URL: https://learn.microsoft.com/en-us/security/benchmark/azure/
- Licence: CC-BY-4.0
- Classification: MANUAL
- Description: Microsoft's prescriptive Azure security baseline; maps neatly
  to many ISM controls and Bunya rule severities.

### Azure Verified Modules
- URL: https://aka.ms/AVM/ModuleIndex/Bicep
- Licence: MIT
- Classification: MANUAL
- Description: Microsoft-curated Bicep modules with opinionated defaults.
  Used as reference for "secure-by-default" property values.

### DTA Hosting Certification Framework
- URL: https://www.dta.gov.au/our-projects/digital-sourcing-contracting/hosting-strategy/hosting-certification-framework
- Licence: Commonwealth copyright
- Classification: MANUAL
- Description: Australian Digital Transformation Agency's framework for
  certified hosting providers; informs sovereignty-tagged rules.

### Subnet delegation overview
- URL: https://learn.microsoft.com/en-us/azure/virtual-network/subnet-delegation-overview
- Licence: CC-BY-4.0
- Classification: MANUAL
- Description: Microsoft Learn documentation enumerating which Azure
  services require dedicated/delegated subnets.

---

## OUT-OF-SCOPE

### CIS Microsoft Azure Foundations Benchmark
- URL: https://www.cisecurity.org/benchmark/azure
- Licence: Commercial — not redistributable
- Classification: OUT-OF-SCOPE
- Description: CIS Benchmark for Azure. Licence terms prevent us from
  shipping rule text directly; we map equivalent rules from other sources.

### PCI DSS
- URL: https://www.pcisecuritystandards.org/
- Licence: Commercial standard
- Classification: OUT-OF-SCOPE
- Description: Payment Card Industry Data Security Standard. Out of project
  licence scope; not ingested.

### HITRUST CSF
- URL: https://hitrustalliance.net/
- Licence: Commercial; out of Australian government scope
- Classification: OUT-OF-SCOPE
- Description: HITRUST Common Security Framework. Commercial and not in
  scope for Australian-government workloads Bunya targets.
