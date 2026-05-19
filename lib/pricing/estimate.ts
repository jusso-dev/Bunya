import type { GraphDocument, GraphNode, ServiceType } from "@/lib/graph/schema";
import {
  Currency,
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
};

const SERVICE_LABELS: Record<ServiceType, string> = {
  resourceGroup: "Resource Group",
  virtualNetwork: "Virtual Network",
  subnet: "Subnet",
  networkSecurityGroup: "Network Security Group",
  privateEndpoint: "Private Endpoint",
  appServicePlan: "App Service Plan",
  appService: "App Service",
  functionApp: "Function App",
  staticWebApp: "Static Web App",
  storageAccount: "Storage Account",
  sqlDatabase: "Azure SQL Database",
  cosmosDb: "Cosmos DB",
  keyVault: "Key Vault",
  applicationInsights: "Application Insights",
  logAnalytics: "Log Analytics Workspace",
  frontDoor: "Front Door",
  applicationGateway: "Application Gateway",
  apiManagement: "API Management",
  containerRegistry: "Container Registry",
  userAssignedIdentity: "User-Assigned Identity",
};

function priceKeyFor(node: GraphNode): { key: string; sku: string } {
  const props = node.properties as Record<string, unknown>;
  switch (node.type) {
    case "appServicePlan": {
      const sku = String(props.sku ?? "B1");
      return { key: `appServicePlan.${sku}`, sku };
    }
    case "appService":
      return { key: "appService.base", sku: "(plan)" };
    case "functionApp":
      return {
        key: props.consumptionPlan === false ? "functionApp.premium" : "functionApp.consumption",
        sku: props.consumptionPlan === false ? "Premium" : "Consumption",
      };
    case "staticWebApp": {
      const sku = String(props.sku ?? "Standard");
      return { key: `staticWebApp.${sku}`, sku };
    }
    case "storageAccount": {
      const sku = String(props.sku ?? "Standard_LRS");
      return { key: `storageAccount.${sku}`, sku };
    }
    case "sqlDatabase": {
      const sku = String(props.sku ?? "S0");
      return { key: `sqlDatabase.${sku}`, sku };
    }
    case "cosmosDb": {
      if (props.freeTier === true) return { key: "cosmosDb.Free", sku: "Free tier" };
      const sku = "Provisioned400";
      return { key: `cosmosDb.${sku}`, sku: "Provisioned 400 RU/s" };
    }
    case "keyVault": {
      const sku = String(props.sku ?? "standard");
      return { key: `keyVault.${sku}`, sku };
    }
    case "applicationInsights":
      return { key: "applicationInsights.workspace", sku: "workspace-based" };
    case "logAnalytics": {
      const sku = String(props.sku ?? "PerGB2018");
      return { key: `logAnalytics.${sku}`, sku };
    }
    case "containerRegistry": {
      const sku = String(props.sku ?? "Basic");
      return { key: `containerRegistry.${sku}`, sku };
    }
    case "frontDoor": {
      const sku = String(props.sku ?? "Standard_AzureFrontDoor");
      return { key: `frontDoor.${sku}`, sku };
    }
    case "applicationGateway": {
      const sku = String(props.sku ?? "WAF_v2");
      return { key: `applicationGateway.${sku}`, sku };
    }
    case "apiManagement": {
      const sku = String(props.sku ?? "Consumption");
      return { key: `apiManagement.${sku}`, sku };
    }
    case "privateEndpoint":
      return { key: "privateEndpoint.base", sku: "per-endpoint" };
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
  }
}

export function estimateCost(document: GraphDocument, currency: Currency = "AUD"): CostEstimate {
  const fx = fxFor(currency);
  const lineItems: CostLineItem[] = [];
  let total = 0;

  for (const node of document.nodes) {
    const { key, sku } = priceKeyFor(node);
    const entry = PRICE_BOOK[key];
    const unmodelled = entry === undefined;
    const monthlyBase = entry?.monthlyUsd ?? 0;
    const monthly = monthlyBase * fx;
    if (node.type === "appServicePlan") {
      const capacity = Number((node.properties as Record<string, unknown>).capacity ?? 1);
      const scaled = monthly * Math.max(1, capacity);
      total += scaled;
      lineItems.push({
        nodeId: node.id,
        serviceType: node.type,
        serviceLabel: SERVICE_LABELS[node.type],
        resourceName: node.resourceName,
        sku: `${sku} x ${capacity}`,
        monthly: scaled,
        note: entry?.note,
      });
      continue;
    }
    total += monthly;
    lineItems.push({
      nodeId: node.id,
      serviceType: node.type,
      serviceLabel: SERVICE_LABELS[node.type],
      resourceName: node.resourceName,
      sku,
      monthly,
      note: entry?.note,
      unmodelled,
    });
  }

  const caveats = [
    `Indicative monthly figures. Real bills depend on traffic, region, reservations, and tier features Bunya does not model.`,
    `Currency: ${symbol(currency)} (${currency}). AUD figures use a static 1.5 AUD/USD ratio; refresh with \`pnpm prices:refresh\`.`,
    `Snapshot date: ${PRICE_SNAPSHOT_DATE}. Source: ${PRICE_SOURCE_URL}.`,
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
  };
}

export function formatMoney(value: number, currency: Currency): string {
  const sym = symbol(currency);
  return `${sym}${value.toFixed(2)}`;
}
