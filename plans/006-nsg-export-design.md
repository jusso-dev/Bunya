# Design 006: Faithful NSG rule and subnet-association export

Status: design only. No runtime code was changed and no export block was lifted.
Planned against `c870765371b6e10cf9968659c568f368afe920f9`; written 2026-11-17 on top of plans 001–005 (line numbers in `lib/graph/arm-import.ts` are those of the branch after plan 002, which added about 55 lines near the top).

Goal: let one well-defined subset of Network Security Group (NSG) intent reach all five deployment exports
(Terraform, Bicep, ARM, az CLI, PowerShell) without silently dropping or widening a rule. Everything outside the
subset stays blocked with a specific message.

## Findings that shape the design

Verified by reading the sources named, and (for the first) by running the importer on a small template.

1. **Export is blocked today for every NSG that carries intent.** `lib/generators/shared/validate.ts:44-47` throws for a
   deployment export when `defaultDeny !== false`, when either rule list is non-empty, or when any edge touches the NSG.
   The schema default is `defaultDeny: true` (`lib/catalogue/services.ts:62`), so even a freshly added NSG is blocked.
   `lib/generators/security.test.ts:48-53` pins that behaviour; the README limitations list ("NSG rules and associations are not yet emitted faithfully") documents it.
2. **The ARM importer already narrows rules, and one narrowing widens them.** `lib/graph/arm-import.ts:502-535`
   (probe run on a template with two rules):
   - `protocol: "TCP"` (the upper-case spelling Azure's own docs show) and `Esp`/`Ah` all become `"*"`, because the
     lookup is `PROTOCOLS.has(protocol) ? protocol : "*"` against `Tcp|Udp|Icmp|*` (line 517). A Deny on TCP becomes a Deny on every protocol; an Allow on ESP becomes an Allow on every protocol.
   - `sourceAddressPrefixes: ["10.0.0.0/24","10.0.1.0/24"]` keeps only the first element (line 519), likewise for the destination prefix and port plurals.
   - `sourcePortRange: "1024-2000"` is dropped (the model has no source port).
   - A rule with an unreadable direction, access or priority is dropped without a word (line 511); priority is clamped into 100–4096 (line 514); a missing name is invented as `rule-<priority>` (line 513).
   - Child resources of type `Microsoft.Network/networkSecurityGroups/securityRules` are not read at all, only the inline `properties.securityRules`.
   The single warning (line 524) says rules "stay blocked", which is true of export but does not tell the user the diagram itself is no longer the template's intent. **These must be fixed before the export block is lifted**, otherwise lifting it would emit widened rules.
3. **Associations are subnet-to-NSG `network` edges.** `lib/catalogue/services.ts:724` (`"subnet->networkSecurityGroup": "network"`) and the importer at `arm-import.ts:961-962`. The catalogue also lets an NSG originate a `depends_on` edge to a subnet (`allowedEdgeTargets: ["subnet"]`, `allowedOutgoingKinds: ["depends_on","diagnostic"]`, lines 304 and 316-320); the rule `BUNYA.NET.006` (`lib/rules/graph-rules/network.ts:150-167`) counts an edge in either direction as "attached". `lib/graph/ordering.ts:11-14` makes an edge's source depend on its target, so only `subnet -> nsg` puts the NSG first in output order. A VMSS can also connect to an NSG (`"virtualMachineScaleSet->networkSecurityGroup"`, line 703), which is a NIC-level association.
4. **The inspector cannot edit the rule lists today.** The arrays of objects are classed as `record` (`lib/catalogue/introspect.ts:fieldKind`) and `RecordField` (`components/properties/PropertiesPanel.tsx`, `RecordField`) rejects arrays (`Array.isArray(parsed)` throws "Expected object"). Rules enter the model through ARM import, imported Bunya JSON and the MCP server. (Read from code, not exercised in a browser.) Editing UI is out of scope here but is an Open question because export without any way to author rules helps imports only.
5. **Exporters emit an empty shell.** ARM `properties: { securityRules: [] }` (`lib/generators/arm.ts:106-116`), Bicep `securityRules: []` (`bicep.ts:106-118`), Terraform with no `security_rule` (`terraform.ts:132-142`), `az network nsg create` only (`azcli.ts:37-41`), `New-AzNetworkSecurityGroup` only (`powershell.ts:77-86`). No exporter references an NSG from a subnet (`emitSubnet` in `arm.ts:88`, `bicep.ts:72`, `terraform.ts:106`; subnet cases in `azcli.ts:30-36` and `powershell.ts:68-75`).
6. **Existing NSG rule checks read the current field shapes.** `lib/rules/sources/expansion-nsg/rules.ts` (`PSRULE.NSG.ANY-INBOUND-V2`, `NO-INTERNET-RDP`, `NO-INTERNET-SSH`, `LATERAL-TRAVERSAL`, `BUNYA.NET.NSG-*`) and `PSRULE.NSG.DENYALLINBOUND` (`lib/rules/sources/psrule-azure/rules.ts:751-776`, whose autofix sets `defaultDeny: true`). Their predicates use `sourceAddressPrefix`, `destinationPortRange` (including comma lists, `portMatches`) and `defaultDeny`. The design keeps these field names so no rule changes.

## Supported subset

One NSG model, version 1 of "emittable":

**Rule fields (unchanged names, `nsgRuleSchema`, `services.ts:50-59`)**

| Field | Accepted in the subset | Rejected with a named error |
| --- | --- | --- |
| `name` | Matches `^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,78}[A-Za-z0-9_])?$` (letters or digits first, ends in letter, digit or `_`, at most 80 characters, [Microsoft NSG overview](https://github.com/microsoftdocs/azure-docs/blob/main/articles/virtual-network/network-security-groups-overview.md): "unique name within the network security group... up to 80 characters"). Unique within the NSG across both directions, compared case-insensitively. | Reserved name `bunya-deny-all-inbound` (see Default deny); duplicates. |
| `priority` | Integer 100–4096, unique within one direction (Microsoft: "priority for a rule must be unique within each set"; azurerm docs: unique for each rule in the collection). Inbound and outbound may reuse a number. | Duplicate within a direction; out of range. |
| `direction` | `Inbound`, `Outbound`; the rule must sit in the matching array (`inboundRules` holds only `Inbound`). | Mismatch between array and `direction`. |
| `access` | `Allow`, `Deny`. | none |
| `protocol` | `Tcp`, `Udp`, `Icmp`, `*` (case as the schema writes it). | `Esp`, `Ah` stay out of the model; the importer must flag, never coerce. |
| `sourceAddressPrefix`, `destinationAddressPrefix` | Exactly one of: `*`; one IPv4 address; one IPv4 CIDR; one service tag from the pattern `^[A-Za-z][A-Za-z0-9.]*$` (e.g. `Internet`, `VirtualNetwork`, `AzureLoadBalancer`; the tag list is not validated against Azure, see Open questions); or a comma list of IPv4 addresses and CIDRs only. | A comma list that mixes a tag with anything else (Terraform docs: "Tags may not be used" in the plural prefix argument; Microsoft: "you can't specify multiple service tags... in a single rule"); IPv6; expressions. |
| `destinationPortRange` | `*`, one port 0–65535, one range `a-b` with `a <= b`, or a comma list of ports and ranges (the form `portMatches` already reads). | Port out of range, reversed range, empty element. |

Source port is always `*`. A source port other than `*` in an input is **unrepresentable**, not coerced.

**Not representable in the model, so never emitted (stay blocked):** source port ranges, application security group
references, `Esp`/`Ah`, rule descriptions, IPv6 prefixes, expression-valued fields, NSG flow logs, NIC-level
associations (the VMSS to NSG edge), and NSGs in a different resource group from their subnets. The last restriction is a deliberate first-slice boundary, not a limitation of Bunya's graph: multiple resource groups already exist and `resourceGroupOf(ctx, node)` resolves ancestry in `lib/generators/shared/context.ts`.

**Unrepresented-rule marker (new, additive).** Add to `nsgSchema` an optional
`unrepresentedRules: z.array(z.object({ name: z.string(), direction: z.enum(["Inbound","Outbound"]).optional(), reason: z.string() })).default([])`.
The importer appends here every rule (or rule field) it cannot hold, instead of coercing it. Non-empty means deployment export is blocked, with a message naming each rule and reason. Because the field defaults to `[]` and zod strips nothing the old reader needs, existing saved diagrams and share links still parse and `schemaVersion` stays 1 (`lib/graph/migrate.ts` needs no new step; add a migration test fixture, see matrix M01). Display: the inspector lists them read-only (follow-up UI, not required for correctness).

**Collection limits.** Bunya caps its own model at 200 nodes and 1,000 edges (README, "Imports and inflated share links are limited to..."); add an NSG cap of 100 rules per direction in `nsgSchema` so a diagram cannot imply a template Azure rejects. Azure's own per-NSG rule limit is documented inconsistently (see Open questions), so the Bunya cap is deliberately well below both figures.

## Format mapping

All five formats derive from the same normalised list, built once in a new `lib/generators/shared/nsg.ts`:

```ts
// Sketch only, not code to paste.
type NsgEmission = {
  rules: Array<{ name; priority; direction; access; protocol; sourcePrefixes: string[]; destinationPrefixes: string[]; destinationPorts: string[] }>;
  associations: Array<{ subnetId: string }>;
}
```

Normalisation, in this order, identical for every format:

1. Order: `Inbound` before `Outbound`; ascending `priority` within each; no ties are possible after validation.
2. If `defaultDeny` is `true`, append the reserved rule (see Default deny) at the end of the Inbound group. It has priority 4096, so it is last by priority too.
3. Split a comma list into a list (`"80, 1024-65535"` becomes `["80","1024-65535"]`, trimmed). A single value stays a single value so the common case produces the singular property.
4. A list of one element uses the singular property; two or more use the plural one. Never emit both (Azure requires exactly one of the pair; azurerm requires one of `destination_port_range` / `destination_port_ranges`).

API versions stay as in `lib/generators/shared/api-versions.ts` (NSG, subnet 2023-11-01). Preserve each exporter's existing scope handling; do not flatten graph resource groups into one. Terraform already uses `rgRef(ctx, node)` backed by `resourceGroupOf` for per-resource ownership. Compare the NSG and subnet's owning group before emitting an association; reject cross-group pairs in this first slice. Preserve existing location expressions. ARM/Bicep and shell formats must retain their existing deployment-scope restrictions rather than gaining implicit cross-group support through this feature.

### ARM (`lib/generators/arm.ts`, `emitNsg`, `emitSubnet`)

NSG, inline rules (not child resources; one resource, one `dependsOn`-free unit):

```json
{ "type": "Microsoft.Network/networkSecurityGroups", "apiVersion": "2023-11-01", "name": "<ctx.name>", "location": "[parameters('location')]", "tags": {...},
  "properties": { "securityRules": [
    { "name": "<rule>", "properties": {
        "protocol": "Tcp", "sourcePortRange": "*",
        "sourceAddressPrefix": "10.0.0.0/24",        // or "sourceAddressPrefixes": ["a","b"]
        "destinationAddressPrefix": "*",              // or "destinationAddressPrefixes": [...]
        "destinationPortRange": "443",                // or "destinationPortRanges": ["80","443"]
        "access": "Allow", "priority": 100, "direction": "Inbound" } } ] } }
```

Property names follow the shape in the [relocation example](https://github.com/microsoftdocs/azure-docs/blob/main/articles/azure-resource-manager/management/relocation/relocation-virtual-network-nsg.md) (`protocol`, `sourcePortRange`, `destinationPortRange`, `sourceAddressPrefix(es)`, `destinationAddressPrefix(es)`, `access`, `priority`, `direction`, plural arrays). Do not emit empty plural arrays (the relocation example shows them as read-back output only; not emitting them is the conservative choice and is a fixture assertion).

Subnet (`Microsoft.Network/virtualNetworks/subnets`) gains, only when associated:

```json
"properties": { ..., "networkSecurityGroup": { "id": "[resourceId('Microsoft.Network/networkSecurityGroups', '<nsg name>')]" } },
"dependsOn": [ "<existing vnet id>", "<nsg id, same expression>" ]
```

Use the existing `armResourceId(nsg, ctx)` helper so the expression matches how other references are written. The subnet resource is a top-level child-typed resource whose current `dependsOn` is `[vnet]` (`arm.ts:102`); the NSG id is added after it.

### Bicep (`lib/generators/bicep.ts`, `emitNsg`, `emitSubnet`)

NSG: `properties: { securityRules: [ { name: '...', properties: { protocol: 'Tcp', sourcePortRange: '*', sourceAddressPrefix: '...', destinationAddressPrefix: '...', destinationPortRange: '443', access: 'Allow', priority: 100, direction: 'Inbound' } } ] }` with the plural properties as arrays under the same rule as ARM. Subnet: inside `properties`, `networkSecurityGroup: { id: <nsgSymbol>.id }` using `nodeRef(ctx, nsg.id)`; the symbolic reference gives the implicit dependency, no `dependsOn`. Quote every literal through the existing Bicep literal helper (`lib/generators/shared/quote.ts`), never string concatenation of raw input.

### Terraform (`lib/generators/terraform.ts`, `emitNsg`, `emitSubnet`)

NSG with inline `security_rule` blocks (the azurerm docs warn standalone `azurerm_network_security_rule` and inline blocks conflict and overwrite each other, so use one style only; inline is chosen because it needs no extra resources and keeps rule order visible):

```hcl
resource "azurerm_network_security_group" "<ident>" {
  name = "..." location = ... resource_group_name = ...
  security_rule {
    name = "..." priority = 100 direction = "Inbound" access = "Allow" protocol = "Tcp"
    source_port_range = "*"
    source_address_prefix = "10.0.0.0/24"            # or source_address_prefixes = ["a","b"]
    destination_address_prefix = "*"                  # or destination_address_prefixes = [...]
    destination_port_range = "443"                    # or destination_port_ranges = ["80","443"]
  }
}
```

Argument names are from the azurerm v4.80.0 [`azurerm_network_security_group`](https://github.com/hashicorp/terraform-provider-azurerm/blob/v4.80.0/website/docs/r/network_security_group.html.markdown) page. Association (new resource, one per subnet, emitted after both nodes):

```hcl
resource "azurerm_subnet_network_security_group_association" "<subnetIdent>_<nsgIdent>" {
  subnet_id                 = azurerm_subnet.<subnetIdent>.id
  network_security_group_id = azurerm_network_security_group.<nsgIdent>.id
}
```

Arguments from the [association page](https://github.com/hashicorp/terraform-provider-azurerm/blob/v4.80.0/website/docs/r/subnet_network_security_group_association.html.markdown). `azurerm_subnet` itself is not given an NSG argument. The generated provider pin is `~> 4.35` (`terraform.ts:949-953`); the field names above are from the v4.80.0 pages (see Open questions).

### az CLI (`lib/generators/azcli.ts`)

In the NSG case, after `az network nsg create`, one command per rule in normalised order:

```sh
az network nsg rule create <COMMON> --nsg-name "<nsg>" --name "<rule>" --priority 100 --direction Inbound --access Allow --protocol Tcp \
  --source-address-prefixes "10.0.0.0/24" --source-port-ranges "*" --destination-address-prefixes "*" --destination-port-ranges 443 >/dev/null
```

Flags are those listed for `az network nsg rule create/update` in the [Azure CLI reference](https://github.com/microsoftdocs/azure-docs-cli/blob/main/docs-ref-autogen/Latest-version/latest/network/nsg/rule.yml): `--priority` 100–4096, `--protocol {*, Ah, Esp, Icmp, Tcp, Udp}`, plural flags take space-separated values, so a list is emitted as separate quoted arguments (`--destination-port-ranges 80 443`). Always use the plural flags (they accept one value too) so there is one code path. In the subnet case, after `az network vnet subnet create`, add when associated:

```sh
az network vnet subnet update <COMMON> --vnet-name "<vnet>" --name "<subnet>" --network-security-group "<nsg>" >/dev/null
```

(`--network-security-group --nsg` is documented for `subnet update`.) Order: topological order already puts the NSG before its subnets because of the `subnet -> nsg` edge. Quote every value through the existing shell quoting helper; a rule name or prefix is data, not shell text.

### PowerShell (`lib/generators/powershell.ts`)

NSG case: build rule configs, then the group:

```powershell
$nsgRules_<ident> = @(
  New-AzNetworkSecurityRuleConfig -Name '<rule>' -Access Allow -Protocol Tcp -Direction Inbound -Priority 100 `
    -SourceAddressPrefix '10.0.0.0/24' -SourcePortRange '*' -DestinationAddressPrefix '*' -DestinationPortRange '443'
)
New-AzNetworkSecurityGroup ... -SecurityRules $nsgRules_<ident> -Force
```

Parameters are those documented for [`New-AzNetworkSecurityRuleConfig`](https://github.com/azure/azure-powershell/blob/main/src/Network/Network/help/New-AzNetworkSecurityRuleConfig.md); `-SourceAddressPrefix`, `-DestinationAddressPrefix` and `-DestinationPortRange` take string arrays, so a list is `'a','b'`. A zero-rule NSG keeps the current splat without `-SecurityRules`. Assign the result of `New-AzNetworkSecurityGroup` to a variable (`$nsg_<ident> = ...`) so the subnet case can use `.Id`.

Subnet association hazard: the documented route for an existing in-memory subnet is `Set-AzVirtualNetworkSubnetConfig -Name -VirtualNetwork -AddressPrefix -NetworkSecurityGroupId $nsg.Id` then `Set-AzVirtualNetwork` ([cmdlet help](https://github.com/azure/azure-powershell/blob/main/src/Network/Network/help/Set-AzVirtualNetworkSubnetConfig.md)). That cmdlet restates the whole subnet, so the existing `-PrivateEndpointNetworkPoliciesFlag` and any delegation would be lost unless restated. Implementation must either pass `-NetworkSecurityGroup`/`-NetworkSecurityGroupId` on the existing `Add-AzVirtualNetworkSubnetConfig` call (confirm the cmdlet exposes it; not confirmed in the docs read for this design) or restate every subnet property on `Set-`. If neither can be confirmed, keep PowerShell blocked for associated NSGs and say so (the matrix has a case for this).

## Association semantics

- Canonical association: edge `source = subnet`, `target = NSG`, `kind = network`. This is what the importer creates and what the ordering needs.
- One NSG per subnet (Azure: NSGs per subnet = 1, [network-application-security-groups limits](https://github.com/microsoftdocs/azure-docs/blob/main/articles/networking/design-guide/network-application-security-groups.md)). Two edges from one subnet to two NSGs: blocked, message names the subnet and both NSGs ("conflicting NSGs").
- Many subnets may share one NSG: each emits its own reference (ARM/Bicep subnet property, one Terraform association resource each, one `subnet update` each).
- NSG to subnet `depends_on` edge: not an association in the subset. Blocked with "draw the association from the subnet to the NSG". (Rule `BUNYA.NET.006` still counts it as attached; leave that rule alone.)
- An NSG with no edges (unattached) and valid rules: exported as an unattached NSG, with the existing `BUNYA.NET.NSG-UNATTACHED` advisory remaining. Not an error.
- Any other edge touching an NSG (the VMSS to NSG edge, diagnostic edges): blocked, one message per cause.
- Cross-document facts to verify before shipping, not assumed here: that an NSG must be in the same region as the subnet it is associated with. Bunya emits both in the document region, so the current model satisfies it either way.

## Default deny

`defaultDeny` today means "Bunya adds explicit deny-all rules" and the importer sets it `false` because a portal export contains only custom rules (`arm-import.ts:526-529`). Subset semantics:

- `defaultDeny: false`: emit only the listed rules. Azure's built-in default rules (priorities in the 65000s; the overview says only that they have the lowest priority, and the repo's own PSRule text at `psrule-azure/rules.ts:760` cites 65500 for DenyAllInbound; the exact numbers of the other defaults are from memory and were not in the pages retrieved, [overview](https://github.com/microsoftdocs/azure-docs/blob/main/articles/virtual-network/network-security-groups-overview.md): "Azure default security rules are given the lowest priority") still apply and are never emitted by Bunya.
- `defaultDeny: true`: additionally emit one rule, name `bunya-deny-all-inbound`, `Inbound`, `Deny`, protocol `*`, source `*`, destination `*`, port `*`, **priority 4096**. No outbound deny is emitted: an outbound deny-all would cut off outbound internet and Azure platform dependencies, and `PSRULE.NSG.DENYALLINBOUND` (`psrule-azure/rules.ts:751`) asks only for an explicit inbound deny.
- Collision: a user rule named `bunya-deny-all-inbound`, or any user Inbound rule at priority 4096, makes export fail with a message naming it. The reserved rule is never silently renamed or dropped.
- Consequence to surface in generated README/output, not hide: priority 4096 sits below all custom rules but above Azure's default `AllowVnetInBound` and `AllowAzureLoadBalancerInBound` (their exact priorities, 65000 and 65001 from memory, were not confirmed in the pages retrieved), so with `defaultDeny: true` VNet-internal and load-balancer-probe traffic is denied unless the user draws an explicit Allow rule. Bunya must not invent those allows.

This changes what a default NSG node exports: today a fresh NSG is blocked; after the rollout it exports a lone inbound deny-all. That is a visible behaviour change, hence an Open question for the owner before implementation.

## Import fidelity

Required importer changes, each with a matrix case; all before any export block is lifted:

1. Read rules from both `properties.securityRules` and child resources of type `Microsoft.Network/networkSecurityGroups/securityRules` (name `<nsg>/<rule>`), merging by NSG name.
2. Compare protocol case-insensitively (`TCP` to `Tcp`, `UDP` to `Udp`, `ICMP` to `Icmp`, `*`); `Esp`, `Ah` and anything else go to `unrepresentedRules` with a reason, never `*`.
3. Singular and plural pairs: a plural of length one is that value; length two or more is joined with `,` when every element is an IPv4 address/CIDR (prefixes) or a port/range (ports); otherwise (tags, ASGs, IPv6, expressions) the rule goes to `unrepresentedRules`.
4. `sourcePortRange(s)` other than a single `*` (or empty/absent) goes to `unrepresentedRules`.
5. Source/destination ASG properties present: `unrepresentedRules`.
6. A rule missing name, direction, access or priority, or with priority outside 100–4096, is recorded in `unrepresentedRules`, not dropped, clamped or renamed.
7. Replace the "stay blocked" warning with one listing the rules held, the rules not representable and why. Keep `defaultDeny: false` on import.
8. A rule that is already in the model but violates the subset (duplicate priority in a direction, name clash, bad port) is kept in the arrays (so the diagram still shows it) and caught by export validation with a named error.

Round trip target: ARM template, import, generate ARM again, compare `securityRules` by name as an unordered set of (direction, priority, access, protocol, source/destination prefixes as sets, ports as sets); equal for every supported rule, and every unsupported rule appears in the blocking message.

## Acceptance matrix

Tests the implementation must add. File names are proposals; semantic assertions are on parsed output, not snapshots. All fixtures are plain graph documents built in the test (pattern: `lib/generators/security.test.ts`, `lib/generators/*.test.ts`) except the importer rows, which build a small ARM object and call `parseArmTemplate(JSON.stringify(template))` (pattern: `lib/graph/arm-import-expressions.test.ts`). Generators under test: `generateArm`, `generateBicep`, `generateTerraform`, `generateAzCli`, `generatePowerShell`.

Commands:

```sh
pnpm exec vitest run lib/generators/shared/nsg.test.ts            # normalisation and validation
pnpm exec vitest run lib/generators/nsg-export.test.ts            # five-format output
pnpm exec vitest run lib/graph/arm-import-nsg.test.ts             # importer fidelity
pnpm exec vitest run lib/generators/security.test.ts lib/graph/migrate.test.ts lib/catalogue/introspect.test.ts
pnpm test && pnpm typecheck && pnpm lint && pnpm rules:verify
```

| ID | Fixture | Expected (machine-checkable) |
| --- | --- | --- |
| N01 | NSG, `defaultDeny:false`, no rules, no edges | All five generate `ok:true`. ARM `securityRules` is `[]` (as today); Terraform has no `security_rule`; az CLI has no `nsg rule create`; PowerShell has no `-SecurityRules`. |
| N02 | NSG, `defaultDeny:false`, one Inbound Allow Tcp 443 from `10.0.0.0/24`, priority 100 | ARM rule `properties` equal `{protocol:"Tcp", sourcePortRange:"*", sourceAddressPrefix:"10.0.0.0/24", destinationAddressPrefix:"*", destinationPortRange:"443", access:"Allow", priority:100, direction:"Inbound"}`; no plural keys. Bicep text contains the same eight pairs. Terraform has exactly one `security_rule` with `priority = 100`. az CLI has one `nsg rule create` with `--priority 100 --direction Inbound --access Allow --protocol Tcp`. PowerShell has one `New-AzNetworkSecurityRuleConfig` with `-Priority 100`. |
| N03 | Inbound Allow 100 + Inbound Deny 200 + Outbound Allow 100 + Outbound Deny 4000 | Output order in every format: Inbound 100, Inbound 200, Outbound 100, Outbound 4000. Same set of four rules in all five. |
| N04 | Rules supplied in priority order 300, 100, 200 | Emitted ascending 100, 200, 300 in every format. |
| N05 | Two Inbound rules both priority 100 | All five `ok:false`, reason names the NSG, the direction and priority 100. |
| N06 | Inbound 100 and Outbound 100 | `ok:true` (priority is unique per direction). |
| N07 | Two rules named `Web` and `web` | `ok:false` naming both (case-insensitive uniqueness). |
| N08 | `defaultDeny:true`, no rules | `ok:true`; every format contains exactly one extra rule named `bunya-deny-all-inbound`, Inbound, Deny, priority 4096, all `*`. No Outbound rule appears. |
| N09 | `defaultDeny:true` plus a user Inbound rule at 4096, or a user rule named `bunya-deny-all-inbound` | All five `ok:false`, reason names the collision. |
| N10 | Comma lists: ports `"80, 443"`, prefixes `"10.0.0.0/24,10.0.1.0/24"` | ARM uses `destinationPortRanges:["80","443"]` and `sourceAddressPrefixes:[...]`, with no singular sibling key. Terraform uses `destination_port_ranges`/`source_address_prefixes`. az CLI passes `--destination-port-ranges 80 443`. PowerShell passes `'80','443'`. |
| N11 | Prefix list mixing a service tag and a CIDR (`"Internet,10.0.0.0/24"`) | `ok:false`. |
| N12 | Port `70000`, range `500-100`, empty list element | `ok:false` each. |
| N13 | One subnet to one NSG (edge subnet to NSG, `network`) | ARM: the subnet resource has `properties.networkSecurityGroup.id` equal to the string `armResourceId(nsg)` produces, and `dependsOn` contains it and the VNet id; the NSG resource appears in the template. Bicep: `networkSecurityGroup: { id: <nsg symbol>.id }` inside the subnet. Terraform: one `azurerm_subnet_network_security_group_association` referencing both ids. az CLI: `az network vnet subnet update ... --network-security-group "<nsg>"` appears after the `subnet create` line and after the NSG's `rule create` lines. PowerShell: per Format mapping hazard note; either the NSG id is applied without losing `-PrivateEndpointNetworkPoliciesFlag`, or the generator returns `ok:false` with a reason (assert whichever the implementation chose, never silent omission). |
| N14 | Two subnets to one NSG | Two association references in every format; one NSG resource. |
| N15 | One subnet to two NSGs | All five `ok:false`, reason names the subnet and both NSGs. |
| N16 | NSG to subnet `depends_on` edge only | All five `ok:false`, reason says to draw it from the subnet. |
| N17 | VMSS to NSG edge | All five `ok:false` (NIC-level association not supported). |
| N18 | Unattached NSG with a rule | `ok:true`; no subnet references it; rule emitted. |
| N19 | `unrepresentedRules` non-empty | All five `ok:false`; reason lists every entry's name and reason. |
| N20 | Rule value containing a quote, newline or template syntax (benign literal such as `a"b`) | `ok:false` (existing `assertExportLiterals` behaviour), same message family as other nodes. |
| N21 | Terraform/Bicep/az/PowerShell quoting of a rule name with `.` and `-` | Appears verbatim and unescaped inside the correct quote style (assert the exact emitted line). |
| N22 | Zero-rule `defaultDeny:false` NSG associated to a subnet | `ok:true`, association emitted in every format. |
| N23 | Two resource groups, each with its own VNet/subnet and NSG | Terraform retains each pair's owning resource group via `resourceGroupOf`; no pair is moved to the first group. Other formats retain their existing multi-group support or explicit rejection. |
| N24 | A subnet and its associated NSG belong to different resource groups | Export is blocked with a named cross-group-association limitation; neither resource is silently relocated. |
| I01 | ARM with inline rule `protocol:"TCP"` | Imported `protocol` is `Tcp`, not `*`. (Fails on today's code: it yields `*`.) |
| I02 | ARM with protocol `Esp` | Rule not in `inboundRules`; present in `unrepresentedRules` with a reason; the import warning names it; the diagram NSG exports blocked. |
| I03 | ARM with `sourceAddressPrefixes` of two CIDRs | Imported prefix is `"a,b"` (not only the first). |
| I04 | ARM with `sourceAddressPrefixes: ["Internet","10.0.0.0/24"]` | `unrepresentedRules` entry; not truncated. |
| I05 | ARM with `sourcePortRange:"1024-2000"` | `unrepresentedRules` entry. |
| I06 | ARM rule with an application security group | `unrepresentedRules` entry. |
| I07 | ARM rules as child resources `Microsoft.Network/networkSecurityGroups/securityRules` | Same rules appear in the NSG node as if inline. |
| I08 | ARM rule missing `priority` | In `unrepresentedRules`; not dropped, not named `rule-<n>`. |
| I09 | ARM subnet `properties.networkSecurityGroup.id` referencing the NSG | `subnet -> NSG` `network` edge (already exists, keep passing). |
| I10 | Round trip: supported ARM template, import, generate ARM | `securityRules` equal as sets (rule fields in the Import fidelity paragraph); subnet `networkSecurityGroup.id` equal; nothing lost or widened. |
| I11 | Saved diagram from before this change (NSG node with no `unrepresentedRules`) | Parses; `unrepresentedRules` defaults to `[]`; `lib/graph/migrate.ts` unchanged; existing share links load. |
| E01 | `lib/generators/security.test.ts` "blocks NSG deployments" | Rewritten to assert the new, narrower blocks (N05, N15, N16, N17, N19); the old catch-all message must not appear for supported subsets. |

## Rollout

1. **Importer first** (matrix I01–I11): stop coercing and truncating, add `unrepresentedRules`, add the schema field and caps. No export behaviour changes yet, so every existing diagram still exports exactly as before (blocked where blocked today).
2. **Shared normalisation and validation** in `lib/generators/shared/nsg.ts` with its unit tests (N04–N07, N09, N11, N12, N15, N16). Not yet wired to the block.
3. **Emission in each exporter behind the existing block**, one format at a time, with tests (N01–N03, N10, N13, N14, N18, N21, N22). Ship in this order of lowest risk: ARM, Bicep, Terraform, az CLI, PowerShell. The `validate.ts:44-47` block stays in force throughout, so nothing reaches users until all five emit and are reviewed together by independent generated-output review (as the maintenance note requires).
4. **Replace the block last**: swap the catch-all check for the specific validations above and update `security.test.ts` (E01), the README limitation entry, the importer warning text and the Mermaid/README generators if they describe the block. Only lift for cases a test proves; leave the rest blocked.
5. **Default deny** (N08, N09) is decided and landed with step 4, not before, because it changes what a fresh NSG exports.

Remaining gaps after rollout, and why each stays blocked: ASG references (need an ASG node and scope rules, not in the catalogue); source port ranges (model has no field); Esp/Ah (not in the model enum); IPv6 and expressions (literal guard); NIC-level association (VMSS NIC emission is a separate exporter concern); flow logs (separate resource and storage dependency); more than one NSG per subnet (Azure forbids it).

## Open questions

1. **Per-NSG rule limit.** The Microsoft NSG limits page read for this design says 2,000 including default rules; I recall older guidance of 1,000 but did not retrieve a source for it. Not resolved; the 100-per-direction Bunya cap avoids depending on either. Confirm against the current [Azure limits](https://learn.microsoft.com/azure/azure-resource-manager/management/azure-subscription-service-limits) page before documenting a figure.
2. **Is a comma list accepted in the singular `destinationPortRange`?** Microsoft's portal text shows comma separation for ranges; the ARM examples use the plural array. This design splits into the plural arrays everywhere (safest). Verify with `az deployment group validate` / `what-if` and Terraform `validate`/`plan` during implementation; do not call Azure for this spike.
3. **Service tag validation.** The pattern accepts any identifier-like tag. Azure's tag set changes; decide whether to ship a list (and refresh it with `scripts/upstream-check.ts`) or keep the permissive pattern and rely on Azure to reject unknown tags.
4. **`Add-AzVirtualNetworkSubnetConfig` and an NSG.** Whether it exposes `-NetworkSecurityGroup`/`-NetworkSecurityGroupId` was not confirmed from the cmdlet documentation read (only `New-` and `Set-AzVirtualNetworkSubnetConfig` were). Resolve before enabling PowerShell associations.
5. **NSG and subnet region rule.** Confirm Azure's same-region requirement for associations; the single-region document model likely makes it moot.
6. **Terraform provider version.** Bunya's generated `required_providers` block pins `azurerm` to `~> 4.35` (`lib/generators/terraform.ts:949-953`), so any 4.x from 4.35 may run. Argument names above come from the v4.80.0 pages; confirm none of the used arguments were added after 4.35 (all are long-standing arguments, but this was not checked against the changelog).
7. **Default deny scope.** Inbound-only deny at 4096 follows `PSRULE.NSG.DENYALLINBOUND`; the owner should confirm that is the intended meaning of `defaultDeny` and accept that it shadows the built-in VNet and load-balancer allows. The alternative is to keep `defaultDeny: true` blocked and require explicit rules (smaller change, less convenient).
8. **Authoring path.** The inspector cannot edit rule arrays (Finding 4). Decide whether rule editing UI belongs in the same release, or whether v1 is import, JSON and MCP only.
9. **Reverse-direction edges.** Whether to migrate existing `nsg -> subnet` `depends_on` edges to `subnet -> nsg` on load, rather than blocking them.
10. **Older readers and loss markers.** Current schemas strip unknown properties. A new `unrepresentedRules` marker therefore does not survive an old reader/exporter merely because parsing succeeds. Before release, define a version gate or another proven compatibility mechanism so an old client cannot discard that marker and emit an empty NSG. A round-trip test through the previous reader is required; do not claim safe bidirectional compatibility from the additive schema alone.

## References

- NSG overview: https://github.com/microsoftdocs/azure-docs/blob/main/articles/virtual-network/network-security-groups-overview.md
- NSG limits and quotas: https://github.com/microsoftdocs/azure-docs/blob/main/articles/networking/design-guide/network-application-security-groups.md
- ARM securityRules shape (relocation guide): https://github.com/microsoftdocs/azure-docs/blob/main/articles/azure-resource-manager/management/relocation/relocation-virtual-network-nsg.md
- azurerm v4.80.0 `azurerm_network_security_group`: https://github.com/hashicorp/terraform-provider-azurerm/blob/v4.80.0/website/docs/r/network_security_group.html.markdown
- azurerm v4.80.0 `azurerm_subnet_network_security_group_association`: https://github.com/hashicorp/terraform-provider-azurerm/blob/v4.80.0/website/docs/r/subnet_network_security_group_association.html.markdown
- azurerm v4.80.0 `azurerm_network_security_rule` (standalone, conflicts with inline): https://github.com/hashicorp/terraform-provider-azurerm/blob/v4.80.0/website/docs/r/network_security_rule.html.markdown
- Azure CLI `az network nsg rule`: https://github.com/microsoftdocs/azure-docs-cli/blob/main/docs-ref-autogen/Latest-version/latest/network/nsg/rule.yml
- Azure CLI `az network vnet subnet update`: https://github.com/microsoftdocs/azure-docs-cli/blob/main/docs-ref-autogen/Latest-version/latest/network/vnet/subnet.yml
- Azure PowerShell `New-AzNetworkSecurityRuleConfig`: https://github.com/azure/azure-powershell/blob/main/src/Network/Network/help/New-AzNetworkSecurityRuleConfig.md
- Azure PowerShell `Set-AzVirtualNetworkSubnetConfig`: https://github.com/azure/azure-powershell/blob/main/src/Network/Network/help/Set-AzVirtualNetworkSubnetConfig.md
- Documentation was read through Context7 on 2026-11-17 (library snapshots: azurerm v4.80.0, Azure CLI "latest" docs, Azure PowerShell main, Microsoft Azure docs main). The Context7 snapshots are not dated Azure releases; re-check the pages above at implementation time.
