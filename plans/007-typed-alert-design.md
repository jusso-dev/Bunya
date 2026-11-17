# Design 007: One typed metric-alert slice (Web App HTTP 5xx count)

Status: design only. No runtime code was changed.
Planned against `c870765371b6e10cf9968659c568f368afe920f9`; written 2026-11-17 on top of plans 001–005 (line numbers in `lib/graph/arm-import.ts` are those of the branch after plan 002, which added about 55 lines near the top).

Goal: replace the free-text, placeholder Monitor Alert node with one narrow, executable alert that exports to all five
formats from model fields: *"the number of HTTP 5xx responses from this Web App, summed over a window, crosses a threshold"*.
Everything else stays an explicit, non-exported scaffold. Log-query alerts, dynamic thresholds, dimensions and other services are out of scope.

The README already says alert generation is "intentionally scaffolded" (Limitations list). This design does not treat that as a newly found defect; it specifies the first slice that removes the scaffold for one case.

## What exists today (verified in code)

| Path | Reference | Behaviour |
| --- | --- | --- |
| Schema | `lib/catalogue/services.ts:213-217` | `severity` (`Sev0`–`Sev4`, default `Sev2`), `condition` (free text, default `"Platform metric or log query threshold"`), `enabled`. |
| Edges | `services.ts:560` (`allowedEdgeTargets`: logAnalytics, actionGroup, appService, functionApp, aksCluster, virtualMachineScaleSet), `services.ts:737-742` | alert to monitored resource is a `diagnostic` edge; alert to Action Group is `depends_on`. |
| ARM | `lib/generators/arm.ts:557-581` | `description` = condition text; **`severity: 2` hardcoded**, so the `severity` property is ignored; `evaluationFrequency`/`windowSize` `PT5M`; `criteria.allOf: []` under `SingleResourceMultipleMetricCriteria`; scopes from `diagnostic` edges (excluding Action Groups) else `[resourceGroup().id]`; actions from `depends_on` edges to Action Groups. |
| Bicep | `lib/generators/bicep.ts:727-754` | Same shell, but **`scopes: [resourceGroup().id]` always** (edges ignored, unlike ARM), `severity: 2`, `allOf: []`; `description` interpolates the condition into single quotes. |
| Terraform | `lib/generators/terraform.ts:820-853` | `scopes = [resource group id]` (edges ignored), `severity = 2`, `criteria { metric_namespace = "Microsoft.Resources/subscriptions/resourceGroups"  metric_name = "AllMetrics"  aggregation = "Total"  operator = "GreaterThan"  threshold = 0 }`, `action` from the Action Group edge. The namespace/metric pair is not a metric I could find in any supported-metrics reference read for this design, so treat it as a placeholder, not a working signal. |
| az CLI | `lib/generators/azcli.ts:144-149` | Emits a comment and `echo "Skipping alert rule ..."`. |
| PowerShell | `lib/generators/powershell.ts:260-264` | `Write-Information 'Skipping alert ...'`. |
| Importer | `lib/graph/arm-import.ts:449-453`, `inferAlertEdges` at `738-747` | Reads `enabled`; `condition` is `asString(asArray(criteria.allOf)[0])`, and `allOf[0]` is an object, so it is always undefined and the default text is kept (verified by reading `asString`'s string-only contract at the top of the file, not by running a template). **Severity is not imported** (always `Sev2` default). `scopes` become `diagnostic` edges to any matched node; `actions.actionGroups[].actionGroupId` become `depends_on` edges. |
| Rule | `lib/rules/graph-rules/observability.ts:185-200` | Production graphs need an alert with an edge to an Action Group; it inspects edges only, not criteria. |
| Inspector | `lib/catalogue/introspect.ts` (`fieldKind`) | Flat enum, number, boolean and string fields get real controls; nested objects and object arrays become a JSON `record` editor. A flat field layout therefore needs no UI work. |
| Migration | `lib/graph/migrate.ts` | Schema version 1 only; node properties are re-parsed by the catalogue schema, so new optional fields with no default read old documents unchanged. |

## Metric contract

Chosen pair, confirmed from current Microsoft documentation:

| Item | Value | Reference |
| --- | --- | --- |
| Resource type / namespace | `Microsoft.Web/sites` | [Supported metrics for Microsoft.Web/sites](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-metrics/microsoft-web-sites-metrics) (page dated 2026-11-03) |
| Metric identifier (REST/ARM `metricName`) | `Http5xx` | same page, row "Http Server Errors", "Name in REST API" column |
| Display name | Http Server Errors | same row |
| Meaning | "The count of requests resulting in an HTTP status code >= 500 but < 600. For WebApps and FunctionApps." | same row |
| Unit | Count | same row |
| Default aggregation | Total (Sum) | same row (the only aggregation listed) |
| Time grain | PT1M | same row |
| Dimensions | `Instance` (not modelled) | same row |
| Caveat | Counts only requests that reach the back-end workers; failures at the front end are not recorded. | [App Service metrics](https://github.com/microsoftdocs/azure-docs/blob/main/articles/app-service/web-sites-monitor.md) |
| Caveat | The `Microsoft.Web/sites` metrics are not available for Linux Consumption function apps. | [Functions metrics reference](https://github.com/microsoftdocs/azure-docs/blob/main/articles/azure-functions/monitor-functions-reference.md) |
| Alert API | `Microsoft.Insights/metricAlerts`; `SingleResourceMultipleMetricCriteria` with one `StaticThresholdCriterion`. Bunya's existing API version is `2018-03-01` (`lib/generators/shared/api-versions.ts:15`); the latest reference page lists `2026-01-01`. Keep `2018-03-01` for the slice (every property used below exists in the sample for that version). | [metricAlerts reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.insights/metricalerts) |
| Scope | exactly one resource id: the Web App | same page: `scopes` is "the list of resource id's"; `targetResourceType`/`targetResourceRegion` are "mandatory if the scope contains a subscription, resource group, or more than one resource", so a single resource scope needs neither |

Only the **App Service** node type (`appService`, ARM type `Microsoft.Web/sites`, Terraform `azurerm_linux_web_app`) is a valid target in v1. `functionApp` shares the namespace and the metric, but Linux Consumption exclusion means Bunya would have to know the plan type; it stays out of v1 (listed in Open questions).

Allowed values (every one is from the references above or the Terraform provider page; the generated provider pin is `~> 4.35`, `lib/generators/terraform.ts:949-953`, and the pages cited are v4.80.0, so check no used argument post-dates 4.35):

- `timeAggregation`: `Total` only (documented default; the API enum also allows Average, Count, Maximum, Minimum, but the metric page lists only Total, so v1 does not offer others).
- `operator`: `GreaterThan`, `GreaterThanOrEqual` (API enum also has Equals, LessThan, LessThanOrEqual; those make little sense for an error count and are left out).
- `threshold`: integer 0 to 1,000,000 (the API table types it `int`). No default.
- `evaluationFrequency` (ISO 8601): `PT1M`, `PT5M`, `PT15M`, `PT30M`, `PT1H` ([azurerm `frequency`](https://github.com/hashicorp/terraform-provider-azurerm/blob/v4.80.0/website/docs/r/monitor_metric_alert.html.markdown)).
- `windowSize`: `PT5M`, `PT15M`, `PT30M`, `PT1H`, `PT6H`, `PT12H`, `P1D` (azurerm `window_size` list minus `PT1M`, because the window must be greater than the frequency and the smallest frequency is `PT1M`; azurerm says "This value must be greater than `frequency`"). Rule: window strictly greater than frequency in v1. Equality is deliberately rejected until verified (see Open questions); the current scaffold's `PT5M`/`PT5M` pair is not carried over.
- `severity`: existing `Sev0`..`Sev4` maps to integers 0..4 (ARM `severity` "{0, 1, 2, 3, 4}"; CLI "0 (critical) to 4 (verbose)"). The model value is always the source; no exporter may hardcode it.
- `enabled`: boolean from the model.
- `autoMitigate`: not modelled; left unset so Azure's default (`true`) applies. Not a choice Bunya makes for the user.

No query language, no dimensions, no dynamic thresholds, no custom metrics (`skipMetricValidation` stays `false`).

## Graph and UI schema

Add flat optional fields to `monitorAlertSchema` (flat so `describeObjectSchema` renders enums as selects and numbers as number inputs with no new UI code):

```ts
export const monitorAlertSchema = z.object({
  severity: z.enum(["Sev0","Sev1","Sev2","Sev3","Sev4"]).default("Sev2"),   // unchanged
  condition: z.string().default("Platform metric or log query threshold"), // unchanged: free text, now a note
  enabled: z.boolean().default(true),                                      // unchanged
  metricKind: z.enum(["appServiceHttp5xx"]).optional(),                    // absent = legacy / scaffold
  operator: z.enum(["GreaterThan","GreaterThanOrEqual"]).optional(),
  threshold: z.number().int().min(0).max(1_000_000).optional(),
  evaluationFrequency: z.enum(["PT1M","PT5M","PT15M","PT30M","PT1H"]).optional(),
  windowSize: z.enum(["PT5M","PT15M","PT30M","PT1H","PT6H","PT12H","P1D"]).optional(),
});
```

No default for `metricKind`, `operator`, `threshold`, `evaluationFrequency` or `windowSize`. A new alert starts as a scaffold; Bunya does not guess a threshold for the user's workload.

Edges (no catalogue change): exactly one `diagnostic` edge from the alert to an `appService` node is the target; zero or more `depends_on` edges to Action Group nodes are the notification routes.

States, evaluated by one pure function `alertState(node, document)` in a new `lib/generators/shared/alerts.ts` and reused by the inspector note, the rules and the exporters:

| State | Condition | Export behaviour |
| --- | --- | --- |
| `scaffold` | `metricKind` is absent (every existing alert) | Not exported as a resource in any format; a visible note instead (see Legacy diagrams). |
| `incomplete` | `metricKind` set but a required field (`operator`, `threshold`, `evaluationFrequency`, `windowSize`) is missing | Deployment export blocked, message names the alert and the missing fields. Typing an alert's `metricKind` is a statement of intent, so a half-filled one must not silently vanish. |
| `invalid` | typed and complete, but window is not greater than frequency, or the target rule fails | Deployment export blocked with a specific message. |
| `ready` | typed, complete, valid | Exported as a real alert in all five formats. |

Target rules for typed alerts (all produce a blocking message naming the alert and the nodes):

- no `diagnostic` edge to an `appService`: "needs a Web App to monitor";
- an edge to anything other than one `appService` (including a second `appService`, Function App, AKS, VMSS, Log Analytics): "this alert type monitors exactly one Web App";
- more than one `diagnostic` edge in total: rejected for the same reason (multiple targets need the multi-resource criteria type and `targetResourceType`/`targetResourceRegion`, out of scope).

Action Groups: zero or more are allowed. An alert with no Action Group is valid Azure (`actions: []`) but notifies nobody, so the export succeeds and an advisory is emitted (generated README note and the existing production rule at `observability.ts:185`); it is not a block.

Inspector copy: when `metricKind` is set show the fields; the `condition` field is relabelled "Notes" in the inspector and is exported as the alert `description` only if the user changed it from the placeholder default. When absent, show a one-line "Not exported until a metric type is chosen" hint.

## Legacy diagrams

- Every existing alert has no `metricKind`: it parses unchanged (all new fields are optional, `schemaVersion` stays 1, `lib/graph/migrate.ts` needs no step). Its `condition` text and `severity` stay as they are and are shown as before.
- Bunya must not infer a metric, threshold or window from the free text.
- Exporters: a `scaffold` alert is **not emitted as a resource**. Today ARM/Bicep/Terraform emit resources whose criteria are empty or invented (`allOf: []`; `AllMetrics` over the resource group namespace); az CLI and PowerShell already skip. Skipping is the consistent, honest behaviour. Each format leaves a visible marker so the omission is never silent:
  - Bicep and Terraform: the existing `// Monitor Alert <name>: ...` comment, reworded to "not exported: choose a metric type in Bunya";
  - ARM (JSON has no comments): a top-level `metadata` entry `bunyaNotExported: ["<alert name>: choose a metric type in Bunya", ...]` (ARM allows a free-form top-level `metadata` object; confirm the deployment engine accepts the key during implementation, see Open questions);
  - az CLI and PowerShell: keep the existing skip comment/`Write-Information`, reworded the same way.
  The generated `README.md` output (`lib/generators/readme.ts`) lists every skipped alert by name.
- This is a deliberate behaviour change for users who currently receive an ARM/Bicep/Terraform alert shell. Whether such a shell ever deployed was not verified (it is not possible to deploy for this design); the empty `allOf` and the invented Terraform metric are the reasons to stop emitting them. Flagged in Open questions for the owner.
- Imported alerts: see Format mapping (Importer) below; an imported alert that matches the slice becomes `ready`; any other becomes `scaffold` with its criteria described in `condition` and an import warning.

## Format mapping

All five formats consume one normalised object from `alertEmission(node, document)`:

```ts
// Sketch only.
type AlertEmission = {
  name: string; enabled: boolean; severity: 0|1|2|3|4;
  description?: string;
  target: GraphNode;                 // the appService
  actionGroups: GraphNode[];         // may be empty
  metric: { namespace: "Microsoft.Web/sites"; name: "Http5xx"; aggregation: "Total"; operator: "GreaterThan"|"GreaterThanOrEqual"; threshold: number };
  frequency: string; window: string; // ISO 8601
};
```

`severity` is `Number(severity.slice(3))` from the model. The same function is used by validation, so a block and an emission can never disagree.

### ARM (`lib/generators/arm.ts`, `emitMonitorAlert`)

```json
{ "type": "Microsoft.Insights/metricAlerts", "apiVersion": "2018-03-01", "name": "<ctx.name>", "location": "global", "tags": {...},
  "dependsOn": [ "<target id>", "<each action group id>" ],
  "properties": {
    "description": "<notes, only if changed from default>",
    "severity": <0..4 from model>, "enabled": <model>,
    "scopes": [ "[resourceId('Microsoft.Web/sites', '<app name>')]" ],
    "evaluationFrequency": "PT5M", "windowSize": "PT15M",
    "criteria": { "odata.type": "Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria",
      "allOf": [ { "criterionType": "StaticThresholdCriterion", "name": "http5xx", "metricNamespace": "Microsoft.Web/sites",
                   "metricName": "Http5xx", "operator": "GreaterThan", "threshold": 5, "timeAggregation": "Total",
                   "dimensions": [], "skipMetricValidation": false } ] },
    "actions": [ { "actionGroupId": "[resourceId('Microsoft.Insights/actionGroups', '<ag name>')]" } ] } }
```

Property names and the `odata.type` value are from the [metricAlerts reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.insights/metricalerts) (the `SingleResourceMultipleMetricCriteria` object and its `allOf` items). Use the existing `armResourceId` helper for the ids (the same expression style the file already uses) and add the target and Action Group ids to `dependsOn` so the alert deploys after both. `threshold` is a JSON number. Scopes come from the validated target and `severity` from the model (today ARM ignores the severity property and Bicep and Terraform ignore edge targets; these are the scaffold's known limits, now removed for the typed case).

### Bicep (`lib/generators/bicep.ts`, `emitMonitorAlert`)

Same body as ARM, with `scopes: [ <appSymbol>.id ]` and `actions: [ { actionGroupId: <agSymbol>.id }, ... ]` via `nodeRef`; implicit dependencies replace `dependsOn`. Resource type string `Microsoft.Insights/metricAlerts@2018-03-01` via the existing `typed(...)` helper. `description` goes through the existing quoting helper (`quote.bicep`), never raw interpolation (the current code interpolates the condition inside single quotes). Bicep and ARM now agree on scopes (today they differ).

### Terraform (`lib/generators/terraform.ts`, `emitMonitorAlert`)

```hcl
resource "azurerm_monitor_metric_alert" "<ident>" {
  name                = "<ctx.name>"
  resource_group_name = <rg>.name
  scopes              = [azurerm_linux_web_app.<app ident>.id]
  description         = "..."            # only when set
  enabled             = true
  frequency           = "PT5M"
  window_size         = "PT15M"
  severity            = 2

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "Http5xx"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = 5
  }
  action { action_group_id = azurerm_monitor_action_group.<ag ident>.id }   # one block per group
}
```

Arguments and allowed values from the azurerm v4.80.0 [`azurerm_monitor_metric_alert`](https://github.com/hashicorp/terraform-provider-azurerm/blob/v4.80.0/website/docs/r/monitor_metric_alert.html.markdown) page (`scopes`, `frequency`, `window_size`, `severity` 0–4, `criteria` block fields, `aggregation` Average/Count/Minimum/Maximum/Total, `operator` list, `action.action_group_id`). Use `ref(ctx, target)` / `ref(ctx, group)` for the references. `target_resource_type`/`target_resource_location` are not emitted (single-resource scope). Note: the azurerm `severity` default is 3, so always emit the value from the model.

### az CLI (`lib/generators/azcli.ts`)

```sh
alert_scope=$(az resource show <COMMON> --name "<app name>" --resource-type "Microsoft.Web/sites" --query id -o tsv)
az monitor metrics alert create <COMMON> --name "<alert>" --scopes "$alert_scope" \
  --condition "total Http5xx > 5" --window-size 15m --evaluation-frequency 5m --severity 2 \
  [--action "<ag id>" ...] [--description "..."] [--disabled true] >/dev/null
```

Uses the existing `az resource show ... --query id -o tsv` pattern (`azcli.ts:52`). Flags and the `--condition` grammar (`{avg,min,max,total,count} [NAMESPACE.]METRIC [{=,!=,>,>=,<,<=} THRESHOLD]`, `##h##m##s` durations, `--severity` 0–4, `--action ACTION_GROUP_NAME_OR_ID`, `--disabled`) are from the [`az monitor metrics alert create` reference](https://learn.microsoft.com/en-us/cli/azure/monitor/metrics/alert#az-monitor-metrics-alert-create). The condition omits the namespace prefix (the documented VM example is `avg Percentage CPU > 90`); the `GreaterThanOrEqual` operator maps to `>=`, `GreaterThan` to `>`. Duration mapping: PT1M `1m`, PT5M `5m`, PT15M `15m`, PT30M `30m`, PT1H `1h`, PT6H `6h`, PT12H `12h`, P1D `24h`. `--disabled` is emitted only when the model has `enabled: false` (default is false). Action group ids come from the same `az resource show --query id` pattern with type `Microsoft.Insights/actionGroups`; emit one `--action` per group (the flag may repeat).

### PowerShell (`lib/generators/powershell.ts`)

```powershell
$alertCriteria_<ident> = New-AzMetricAlertRuleV2Criteria -MetricName 'Http5xx' -MetricNamespace 'Microsoft.Web/sites' `
    -TimeAggregation Total -Operator GreaterThan -Threshold 5
Add-AzMetricAlertRuleV2 -Name '<alert>' -ResourceGroupName $ResourceGroupName -WindowSize 00:15:00 -Frequency 00:05:00 `
    -TargetResourceId $alertScope_<ident> -Condition $alertCriteria_<ident> -ActionGroupId $alertGroups_<ident> `
    -Severity 2 [-DisableRule] [-Description '...'] | Out-Null
```

Cmdlets and parameters from [`New-AzMetricAlertRuleV2Criteria`](https://github.com/azure/azure-powershell/blob/main/src/Monitor/Monitor/help/New-AzMetricAlertRuleV2Criteria.md) and [`Add-AzMetricAlertRuleV2`](https://github.com/azure/azure-powershell/blob/main/src/Monitor/Monitor/help/Add-AzMetricAlertRuleV2.md) (`-WindowSize`/`-Frequency` are TimeSpans, `-Severity` required, `-DisableRule` switch, `-ActionGroupId` string array). Operator names (`GreaterThan`, `GreaterThanOrEqual`) follow the criteria cmdlet's operator parameter; confirm the accepted spellings at implementation time (the doc excerpt lists GreaterThan, LessThan, EqualTo as examples, which differs from the API enum). TimeSpan mapping: PT1M `00:01:00`, PT5M `00:05:00`, PT15M `00:15:00`, PT30M `00:30:00`, PT1H `01:00:00`, PT6H `06:00:00`, PT12H `12:00:00`, P1D `1.00:00:00`. The Web App id and Action Group ids must be resolved at run time (for example `(Get-AzResource -ResourceGroupName ... -Name ... -ResourceType 'Microsoft.Web/sites').ResourceId`); the exact cmdlets for the existing PowerShell flow were not confirmed from documentation for this design (Open questions). If they cannot be confirmed, PowerShell keeps `scaffold` behaviour for typed alerts and says so, rather than emitting guesses.

### Importer (`lib/graph/arm-import.ts`, `monitorAlert` case at 449 and `inferAlertEdges`)

Read `severity` (integer 0–4 to `Sev0`..`Sev4`; currently ignored). An alert becomes typed (`metricKind: "appServiceHttp5xx"`) only when all hold: `criteria['odata.type']` is `Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria` (a `MultipleResourceMultipleMetricCriteria` with one scope may be accepted later, not in v1); exactly one entry in `allOf`; `criterionType` is `StaticThresholdCriterion`; `metricName` is `Http5xx` (case-insensitive) with `metricNamespace` `Microsoft.Web/sites` or absent; `timeAggregation` `Total`; `operator` in the two allowed values; `threshold` a non-negative integer; no dimensions (or an empty list); exactly one scope resolving to an imported `appService`; `evaluationFrequency` and `windowSize` in the allowed lists and window greater than frequency. Anything else imports as `scaffold`, with `condition` set to a readable description built from the criteria (for example `Http5xx > 5 over PT15M (not modelled: dimensions)`), not left at the placeholder, and a warning naming the alert and which rule failed. `description` from ARM goes to `condition` only when no criteria text applies.

## Acceptance matrix

Fixtures are plain graph documents built in the test (pattern: `lib/generators/*.test.ts` and `lib/generators/security.test.ts`) except importer rows, which build a small ARM object and call `parseArmTemplate(JSON.stringify(template))` (pattern: `lib/graph/arm-import-expressions.test.ts`). Assertions are on parsed output fields, not snapshots.

Commands:

```sh
pnpm exec vitest run lib/generators/shared/alerts.test.ts        # alertState / alertEmission
pnpm exec vitest run lib/generators/alert-export.test.ts         # five-format output
pnpm exec vitest run lib/graph/arm-import-alerts.test.ts         # importer
pnpm exec vitest run lib/catalogue/introspect.test.ts lib/graph/migrate.test.ts lib/graph/arm-import.test.ts
pnpm test && pnpm typecheck && pnpm lint && pnpm rules:verify
```

Base fixture `webAlert`: resource group, App Service Plan, App Service `app-web`, Action Group `ag-ops`, alert with `{ severity:"Sev1", enabled:true, metricKind:"appServiceHttp5xx", operator:"GreaterThan", threshold:5, evaluationFrequency:"PT5M", windowSize:"PT15M" }`, edges alert to app (`diagnostic`) and alert to Action Group (`depends_on`).

| ID | Change to the base fixture | Expected |
| --- | --- | --- |
| A01 | none (valid) | ARM resource of type `Microsoft.Insights/metricAlerts` has `properties.severity === 1`, `enabled === true`, `evaluationFrequency === "PT5M"`, `windowSize === "PT15M"`, `scopes` equal to `[armResourceId(app)]` and no `resourceGroup().id`, `criteria["odata.type"]` equals the single-resource type, `criteria.allOf` has length 1 with `metricName "Http5xx"`, `metricNamespace "Microsoft.Web/sites"`, `operator "GreaterThan"`, `threshold 5`, `timeAggregation "Total"`, `criterionType "StaticThresholdCriterion"`, `dimensions []`; `actions` has one entry with the Action Group id; `dependsOn` contains the app and the group. |
| A02 | A01, parse Bicep text | Contains `Microsoft.Insights/metricAlerts@2018-03-01`, `severity: 1`, `metricName: 'Http5xx'`, `scopes: [` with the app symbol and `.id`, `actionGroupId:` with the group symbol; does not contain `resourceGroup().id` in the alert. |
| A03 | A01, parse Terraform text | One `azurerm_monitor_metric_alert` with `severity            = 1`, `frequency           = "PT5M"`, `window_size         = "PT15M"`, `metric_namespace = "Microsoft.Web/sites"`, `metric_name      = "Http5xx"`, `aggregation      = "Total"`, `threshold        = 5`, `scopes` referencing the Web App resource, one `action` block; contains neither `AllMetrics` nor the resource-group namespace. |
| A04 | A01, az CLI text | Contains `az monitor metrics alert create`, `--condition "total Http5xx > 5"`, `--window-size 15m`, `--evaluation-frequency 5m`, `--severity 1`, one `--action`; no `--disabled`. |
| A05 | A01, PowerShell text | Contains `New-AzMetricAlertRuleV2Criteria`, `-MetricName 'Http5xx'`, `-TimeAggregation Total`, `-Threshold 5`, `Add-AzMetricAlertRuleV2`, `-Severity 1`, `-WindowSize 00:15:00`, `-Frequency 00:05:00`; no `-DisableRule`. (If the PowerShell id-resolution question stays open, assert instead that the output states the alert is not exported and why.) |
| A06 | severity `Sev4` | All formats carry 4 (ARM `severity: 4`, Terraform `severity            = 4`, CLI `--severity 4`, PS `-Severity 4`, Bicep `severity: 4`). Regression for today's hardcoded 2. |
| A07 | `enabled: false` | ARM and Bicep `enabled` false; Terraform `enabled             = false`; CLI `--disabled true`; PS `-DisableRule`. |
| A08 | operator `GreaterThanOrEqual` | ARM/Bicep/Terraform use `GreaterThanOrEqual`; CLI `>=`; PS `GreaterThanOrEqual` (spelling per Open question 5). |
| A09 | `threshold` 0 | Exported with threshold 0 (zero is valid). |
| A10 | frequency `PT1M`, window `P1D` | ARM `windowSize "P1D"`; CLI `--window-size 24h`; PS `1.00:00:00`; CLI frequency `1m`. |
| A11 | no edge from the alert to any resource | All five `ok:false`; message contains the alert name and "needs a Web App". |
| A12 | edge to a Function App instead of the Web App | All five `ok:false`; message says exactly one Web App. |
| A13 | two `diagnostic` edges (two Web Apps) | All five `ok:false`; message says exactly one Web App. |
| A14 | edge to the Web App plus an edge to Log Analytics | `ok:false` (second `diagnostic` edge). |
| A15 | no Action Group edge | `ok:true`; ARM `actions` is `[]`; generated README output contains the "notifies nobody" advisory naming the alert. |
| A16 | two Action Groups | ARM `actions` length 2, Terraform two `action` blocks, CLI two `--action`. |
| A17 | window equal to frequency (`PT5M`/`PT5M`) | `ok:false`; message states the window must be greater than the evaluation frequency. |
| A18 | window `PT5M`, frequency `PT15M` | `ok:false` (same message). |
| A19 | `metricKind` set, `threshold` missing | `ok:false`; message lists `threshold`. Likewise missing `operator`, `evaluationFrequency`, `windowSize` (one case each). |
| A20 | `threshold` negative or fractional | Rejected by schema parse (`DocumentSchema`/property parse), not by an exporter. |
| L01 | legacy alert: free-text `condition`, no `metricKind`, with an Action Group edge | `ok:true` in all five; ARM has no `Microsoft.Insights/metricAlerts` resource and `metadata.bunyaNotExported` names the alert; Bicep and Terraform contain the "not exported" comment and no `metricAlerts`/`azurerm_monitor_metric_alert` resource for it; az CLI and PowerShell contain the skip note; the generated README lists it. |
| L02 | Legacy document JSON saved before this change | Parses through `migrate()` unchanged (`schemaVersion` 1); alert node has `metricKind === undefined`; `condition` text preserved byte-for-byte. |
| L03 | Legacy alert plus a typed alert in one document | Typed one is exported; legacy one is listed as not exported; both still appear in Mermaid and README outputs. |
| I01 | ARM metric alert matching the slice (single-resource criteria, `Http5xx`, `Total`, `GreaterThan` 5, `PT5M`/`PT15M`, severity 1, one scope = imported `appService`, one action group) | Node has `metricKind "appServiceHttp5xx"`, `severity "Sev1"`, `operator`, `threshold 5`, `evaluationFrequency`, `windowSize`; edges: alert to app `diagnostic`, alert to group `depends_on`; no import warning for the alert. |
| I02 | Same, but `severity: 3` | Imported `Sev3` (today: `Sev2`, severity ignored). |
| I03 | Different metric (`Http4xx`, or `CpuTime`) | Imported as scaffold (`metricKind` absent); `condition` contains the metric name, operator and threshold; warning names the alert and "metric not modelled". |
| I04 | `Http5xx` with a dimension | Scaffold; warning mentions dimensions. |
| I05 | Scope is a resource group (`[resourceGroup().id]`) or two resources | Scaffold; warning mentions the scope. |
| I06 | `timeAggregation: "Average"` | Scaffold. |
| I07 | Round trip: I01 template, import, generate ARM | Generated alert equals the source on `severity`, `scopes` (resolving to the same Web App), `evaluationFrequency`, `windowSize`, and the single criterion's `metricName`, `operator`, `threshold`, `timeAggregation`. |
| I08 | Existing test "imports Private DNS, role assignment, and monitor alert relationships" (`arm-import.test.ts:299`) | Still passes; its alert targets an AKS cluster so it stays a scaffold with the same edges. |
| U01 | Inspector (`describeObjectSchema(monitorAlertSchema)`) | `metricKind`, `operator`, `evaluationFrequency`, `windowSize` are `enum` fields with the listed options; `threshold` is a `number` field with `integer: true`, `min: 0`, `max: 1000000`. |
| U02 | New alert from the palette (`newNode`) | `metricKind`, `threshold`, `operator`, `evaluationFrequency`, `windowSize` are all `undefined`; the node is a scaffold. |

## Rollout

1. Schema and `alertState`/`alertEmission` with unit tests (A06, A09, A17–A20, L02, U01, U02). No exporter change yet.
2. Importer changes (I01–I08), including severity import. These change imported nodes but not exports of legacy alerts.
3. Exporters, one at a time behind a single switch in `alerts.ts`, lowest risk first: ARM, Bicep, Terraform, az CLI, PowerShell (A01–A05, A07, A08, A10, A15, A16). Replace the scaffold shells with the "not exported" markers in the same change as each exporter (L01).
4. Blocking validation in `lib/generators/shared/validate.ts` for `incomplete`/`invalid` states and target rules (A11–A14, A17–A19).
5. Update README (the "intentionally scaffolded" bullet becomes "one typed alert is exported; other alerts are not"), the generated README writer, and `PSRULE`/Bunya observability rules only if they should treat a scaffold alert as not satisfying "alert exists" (Open questions).
6. Independent review of generated output across all five formats before merging, as for any generator change.

Files a later implementation should modify: `lib/catalogue/services.ts` (schema), `lib/generators/shared/alerts.ts` (new), `lib/generators/shared/validate.ts`, `lib/generators/arm.ts`, `bicep.ts`, `terraform.ts`, `azcli.ts`, `powershell.ts`, `lib/generators/readme.ts`, `lib/graph/arm-import.ts` (the `monitorAlert` case and `inferAlertEdges`), `components/properties/PropertiesPanel.tsx` only if the hint text is added, `README.md`; tests under `lib/generators/`, `lib/graph/` and `lib/catalogue/`. `lib/graph/migrate.ts` should not need a change (matrix L02 proves it).

Out of scope, and stays that way: log-query and activity-log alerts, dynamic thresholds, arbitrary dimensions, multi-resource and subscription/resource-group scopes, custom metrics, other services (Function App, AKS, VMSS, storage, SQL), autoMitigate and mute settings, alert processing rules, and any live Azure access.

## Open questions

1. **Function Apps.** `Http5xx` also exists for Function Apps but not for Linux Consumption plans. Add `functionApp` later only if Bunya can tell the plan type; for now blocked by target rule A12.
2. **Window equal to frequency.** azurerm says the window "must be greater than `frequency`"; the ARM reference does not state a rule. v1 rejects equality. Verify against Azure (a `what-if`/`validate` at implementation time) and relax if Azure accepts equal values.
3. **Skip versus emit for legacy alerts.** This design stops emitting the existing ARM/Bicep/Terraform placeholder shells. If the owner prefers to keep emitting an inert, disabled shell, the alternative is to emit it with `enabled: false`; I did not choose that because a disabled alert with invented criteria still looks deployable. The owner should confirm the behaviour change.
4. **ARM `metadata` key for omitted alerts.** A top-level `metadata.bunyaNotExported` is proposed because JSON has no comments; confirm `az deployment group validate` accepts an unknown metadata key (the schema describes `metadata` as free-form, but this was not verified).
5. **PowerShell specifics.** Not confirmed from the documentation read: the accepted spellings of `-Operator` (the doc excerpt shows `GreaterThan`, `LessThan`, `EqualTo`, which differs from the API enum), and which cmdlet the existing flow should use to resolve the Web App and Action Group ids. If unresolved, PowerShell keeps scaffold behaviour for typed alerts and states so.
6. **az CLI namespace prefix.** The grammar allows `NAMESPACE.METRIC`; the slice omits the namespace (as the VM example does). `Http5xx` is unique within `Microsoft.Web/sites`, but a dry check with `az monitor metrics list-definitions` is a sensible implementation-time test.
7. **API version.** Keep `2018-03-01` or move all five to the current `2026-01-01`? Property names used here are present in the `2018-03-01` sample; a bump should be its own change.
8. **Observability rule.** `observability.ts:185` counts any alert with an Action Group edge as sufficient. Decide whether a scaffold alert should still satisfy it, or only a `ready` alert.
9. **Description text.** Whether `condition` should be renamed in the model (it keeps its name here to avoid a migration) now that it is a note for typed alerts.

## References

- Supported metrics for `Microsoft.Web/sites` (row `Http5xx`): https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-metrics/microsoft-web-sites-metrics
- App Service metrics and the HTTP Server Errors caveat: https://github.com/microsoftdocs/azure-docs/blob/main/articles/app-service/web-sites-monitor.md
- Functions metrics note (Linux Consumption): https://github.com/microsoftdocs/azure-docs/blob/main/articles/azure-functions/monitor-functions-reference.md
- `Microsoft.Insights/metricAlerts` reference (properties, `StaticThresholdCriterion`, enums, Bicep sample at 2018-03-01): https://learn.microsoft.com/en-us/azure/templates/microsoft.insights/metricalerts
- azurerm v4.80.0 `azurerm_monitor_metric_alert`: https://github.com/hashicorp/terraform-provider-azurerm/blob/v4.80.0/website/docs/r/monitor_metric_alert.html.markdown
- `az monitor metrics alert create`: https://learn.microsoft.com/en-us/cli/azure/monitor/metrics/alert#az-monitor-metrics-alert-create
- `New-AzMetricAlertRuleV2Criteria`: https://github.com/azure/azure-powershell/blob/main/src/Monitor/Monitor/help/New-AzMetricAlertRuleV2Criteria.md
- `Add-AzMetricAlertRuleV2`: https://github.com/azure/azure-powershell/blob/main/src/Monitor/Monitor/help/Add-AzMetricAlertRuleV2.md
- Documentation was read on 2026-11-17 through Context7 and direct fetches of the Microsoft Learn pages above; the two Learn pages state their own update dates (metrics page 2026-11-03, CLI page 2026-11-06). Re-check before implementing.
