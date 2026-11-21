# Security Policy

## Supported versions

Bunya is pre-1.0 software developed and deployed continuously from the `main`
branch (including the static site published to GitHub Pages). Security fixes
are applied to `main` only.

| Version | Supported |
| --- | --- |
| `main` (latest) | Yes |
| Older commits and forks | No |

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues,
pull requests, or discussions.

Report suspected vulnerabilities privately using GitHub private vulnerability
reporting:

- Open a private report at
  [github.com/jusso-dev/Bunya/security/advisories/new](https://github.com/jusso-dev/Bunya/security/advisories/new),
  or go to the repository **Security** tab, select **Advisories**, and choose
  **Report a vulnerability**.

To help with triage and reproduction, please include:

- The affected component (for example, the web editor, `.bunya.json` or ARM
  template import, share URL decoding, an IaC generator, or the stdio/HTTP MCP
  server).
- Clear steps to reproduce or a minimal proof of concept (such as a redacted
  diagram file, ARM snippet, or MCP request).
- The potential security impact and any suggested remediation.

Do not include real secrets, credentials, Azure tenant IDs, or subscription IDs
in your report.

## Expected response times

Bunya is maintained on a best-effort basis. Target timelines for private
security reports are:

| Milestone | Target timeframe |
| --- | --- |
| Acknowledgement of receipt | Within 3 business days |
| Initial triage and severity assessment | Within 7 business days |
| Progress updates on confirmed issues | At least every 14 days |
| Remediation and coordinated disclosure | Prioritised by severity (critical and high issues first) |

## Scope

### In scope

- **Client-side editor and imports:** Cross-site scripting (XSS), DOM
  injection, or unsafe handling of untrusted inputs during share URL
  decompression, `.bunya.json` loading, ARM template import, or ARM expression
  evaluation.
- **IaC and script generators:** Injection flaws, quoting or escaping bypasses,
  or insecure-by-default output in generated Terraform, Bicep, ARM, Azure CLI,
  PowerShell, Azure Policy, Mermaid, or README artefacts that could cause
  unintended command execution or weakened infrastructure controls when run by
  an operator.
- **Resource and input limits:** Denial-of-service or resource-exhaustion
  conditions that bypass Bunya's documented import or share-link limits
  (payload size, nesting depth, node count, and edge count).
- **MCP server (`mcp/`):** Security flaws in the local stdio server
  (`mcp/server.ts`) or Streamable HTTP server (`mcp/http.ts`), including
  `BUNYA_ALLOWED_HOSTS` or `BUNYA_ALLOWED_ORIGINS` validation bypasses, request
  body size limit bypasses, or unintended filesystem or network access.
- **Dependencies and CI supply chain:** Exploitable vulnerabilities in direct
  or transitive runtime dependencies, or security issues in `.github/workflows/`.

### Out of scope

- Vulnerabilities in Microsoft Azure services or third-party upstream rule
  sources (PSRule, Checkov, Azure Policy, Azure Naming Tool) that are not
  specific to Bunya.
- Incomplete rule coverage, missing Azure resource types, or advisory
  compliance gaps. Bunya's rules engine provides design-time advisory checks
  rather than formal compliance certification or runtime enforcement; please
  raise rule bugs or enhancement requests as standard GitHub issues.
- Security of operator-managed reverse proxies, authentication, or TLS
  termination placed in front of a self-hosted `mcp:http` endpoint.
- Exposure of architecture details voluntarily encoded into a share URL
  fragment and distributed to unintended recipients.
- Findings that require physical access to a user's device, a compromised
  browser or extension, or self-XSS.

## Coordinated disclosure and safe harbour

Good-faith security research conducted against local instances of Bunya without
affecting other users is welcome. Please allow reasonable time to investigate
and merge a fix to `main` before disclosing details publicly. Reporters will
be credited in the security advisory unless anonymity is requested.
