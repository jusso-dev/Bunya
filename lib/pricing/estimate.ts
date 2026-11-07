import type { GraphDocument, GraphNode, ServiceType } from "@/lib/graph/schema";
import { isServerlessPlan, planFamily } from "@/lib/catalogue/app-service-plans";
import { getServiceDefinition } from "@/lib/catalogue/services";
import { sitePlan } from "@/lib/graph/topology";
import {
  APP_SERVICE_PRICE_SNAPSHOT_DATE,
  Currency,
  DEFAULT_FX_AUD_PER_USD,
  PRICE_BOOK,
  PRICE_SNAPSHOT_DATE,
  PRICE_SOURCE_URL,
  fxFor,
  symbol,
} from "./data";

export type CostLineItem = {
  nodeId: string;
  serviceType: ServiceType;
  serviceLabel: string;
  resourceName: string;
  sku: string;
  monthly: number;
  note?: string;
  unmodelled?: boolean;
};

export type CostEstimate = {
  currency: Currency;
  symbol: string;
  snapshotDate: string;
  sourceUrl: string;
  lineItems: CostLineItem[];
  total: number;
  caveats: string[];
  fxAudPerUsd: number;
};

export type EstimateOptions = {
  currency?: Currency;
  audPerUsd?: number;
};

// Cost tables use shorter names than the catalogue for these services.
const COST_LABELS: Partial<Record<ServiceType, string>> = {
  appService: "App Service",
  frontDoor: "Front Door",
  userAssignedIdentity: "User-Assigned Identity",
};

// Services billed per instance, and the property holding the instance count.
const QUANTITY_PROPERTY: Partial<Record<ServiceType, string>> = {
  appServicePlan: "capacity",
  aksCluster: "nodeCount",
  virtualMachineScaleSet: "capacity",
};

function bySku(type: ServiceType, sku: unknown): { key: string; sku: string } {
  return { key: `${type}.${String(sku)}`, sku: String(sku) };
}

function priceKeyFor(node: GraphNode, props: Record<string, unknown>, document: GraphDocument): { key: string; sku: string } {
  switch (node.type) {
    case "appServicePlan":
    case "staticWebApp":
    case "virtualMachineScaleSet":
    case "storageAccount":
    case "sqlDatabase":
    case "keyVault":
    case "logAnalytics":
    case "containerRegistry":
    case "frontDoor":
    case "applicationGateway":
    case "apiManagement":
      return bySku(node.type, props.sku);
    case "aksCluster":
      return bySku(node.type, props.nodeVmSize);
    case "appService":
      return { key: "appService.base", sku: "(plan)" };
    case "functionApp": {
      // The plan decides billing; the flag only matters when no plan is drawn.
      const plan = sitePlan(document, node);
      if (plan ? isServerlessPlan(plan.properties.sku) : props.consumptionPlan !== false) {
        return { key: "functionApp.consumption", sku: planFamily(plan?.properties.sku) === "flex" ? "Flex Consumption" : "Consumption" };
      }
      return { key: "functionApp.premium", sku: "(plan)" };
    }
    case "cosmosDb":
      return props.freeTier === true
        ? { key: "cosmosDb.Free", sku: "Free tier" }
        : { key: "cosmosDb.Provisioned400", sku: "Provisioned 400 RU/s" };
    case "applicationInsights":
      return { key: "applicationInsights.workspace", sku: "workspace-based" };
    case "privateEndpoint":
      return { key: "privateEndpoint.base", sku: "per-endpoint" };
    case "privateDnsZone":
      return { key: "privateDnsZone.base", sku: "zone" };
    case "monitorAlert":
      return { key: "monitorAlert.base", sku: String(props.severity) };
    case "actionGroup":
      return { key: "actionGroup.base", sku: "notification routing" };
    case "resourceGroup":
      return { key: "resourceGroup.base", sku: "container" };
    case "virtualNetwork":
      return { key: "virtualNetwork.base", sku: "container" };
    case "subnet":
      return { key: "subnet.base", sku: "child" };
    case "networkSecurityGroup":
      return { key: "networkSecurityGroup.base", sku: "ruleset" };
    case "userAssignedIdentity":
      return { key: "userAssignedIdentity.base", sku: "identity" };
    case "roleAssignment":
      return { key: "roleAssignment.base", sku: String(props.roleDefinitionName) };
  }
}

export function estimateCost(
  document: GraphDocument,
  options: Currency | EstimateOptions = "AUD",
): CostEstimate {
  const opts: EstimateOptions =
    typeof options === "string" ? { currency: options } : options;
  const currency: Currency = opts.currency ?? "AUD";
  const audPerUsd = opts.audPerUsd ?? DEFAULT_FX_AUD_PER_USD;
  const fx = fxFor(currency, audPerUsd);
  const lineItems: CostLineItem[] = [];
  let total = 0;

  for (const node of document.nodes) {
    const definition = getServiceDefinition(node.type);
    const props = { ...definition.defaultProperties, ...node.properties };
    const { key, sku } = priceKeyFor(node, props, document);
    const entry = PRICE_BOOK[key];
    const quantityProperty = QUANTITY_PROPERTY[node.type];
    const quantity = quantityProperty ? Number(props[quantityProperty]) : undefined;
    const monthly = (entry?.monthlyUsd ?? 0) * fx * Math.max(1, quantity ?? 1);
    total += monthly;
    lineItems.push({
      nodeId: node.id,
      serviceType: node.type,
      serviceLabel: COST_LABELS[node.type] ?? definition.label,
      resourceName: node.resourceName,
      sku: quantity === undefined ? sku : `${sku} x ${quantity}`,
      monthly,
      note: entry?.note,
      unmodelled: entry === undefined,
    });
  }

  const fxNote =
    currency === "AUD"
      ? `AUD figures use ${audPerUsd.toFixed(4)} AUD/USD. Override the rate in the Cost panel for accuracy.`
      : `USD figures map 1:1 from the source. FX override active for AUD only.`;

  const caveats = [
    `Indicative monthly figures. Real bills depend on traffic, region, reservations, and tier features Bunya does not model.`,
    `Currency: ${symbol(currency)} (${currency}). ${fxNote}`,
    `Snapshot date: ${PRICE_SNAPSHOT_DATE} (App Service and Functions: ${APP_SERVICE_PRICE_SNAPSHOT_DATE}, Linux rates). Source: ${PRICE_SOURCE_URL}.`,
    `Egress, premium-feature add-ons, backup retention, and per-call billing are excluded.`,
  ];

  return {
    currency,
    symbol: symbol(currency),
    snapshotDate: PRICE_SNAPSHOT_DATE,
    sourceUrl: PRICE_SOURCE_URL,
    lineItems,
    total,
    caveats,
    fxAudPerUsd: audPerUsd,
  };
}

export function formatMoney(value: number, currency: Currency): string {
  const sym = symbol(currency);
  return `${sym}${value.toFixed(2)}`;
}
