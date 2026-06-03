/**
 * Hand-curated subset of Azure Retail Prices for the services Bunya models.
 *
 * Source: https://prices.azure.com/api/retail/prices (Retail Prices API).
 * Indicative monthly figures for Australia East. These are deliberately
 * conservative estimates that ignore egress, advanced features, and per-call
 * billing for services that meter by transaction volume. Refresh via
 * `pnpm prices:refresh`.
 *
 * Currency conversion uses a static AUD/USD ratio. Cost predictions are
 * **estimates**, never invoices.
 */

export type Currency = "USD" | "AUD";

export const DEFAULT_FX_AUD_PER_USD = 1.5;
export const PRICE_SNAPSHOT_DATE = "2026-05-19";
export const PRICE_SOURCE_URL = "https://prices.azure.com/api/retail/prices";

export type PriceEntry = {
  monthlyUsd: number;
  note?: string;
};

export type PriceBook = Record<string, PriceEntry>;

export function fxFor(currency: Currency, audPerUsd: number = DEFAULT_FX_AUD_PER_USD): number {
  return currency === "AUD" ? audPerUsd : 1;
}

export function symbol(currency: Currency): string {
  return currency === "AUD" ? "A$" : "$";
}

export function clampFxRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return DEFAULT_FX_AUD_PER_USD;
  return Math.min(Math.max(rate, 0.5), 10);
}

export const PRICE_BOOK: PriceBook = {
  // App Service Plans (Linux, Australia East, monthly assuming 1 instance @ 730h)
  "appServicePlan.B1": { monthlyUsd: 54.75, note: "Basic B1, 1 instance, Linux" },
  "appServicePlan.B2": { monthlyUsd: 109.5, note: "Basic B2, 1 instance, Linux" },
  "appServicePlan.S1": { monthlyUsd: 73.0, note: "Standard S1, 1 instance, Linux" },
  "appServicePlan.P1v3": { monthlyUsd: 226.3, note: "Premium v3 P1, 1 instance, Linux" },
  "appServicePlan.P2v3": { monthlyUsd: 452.6, note: "Premium v3 P2, 1 instance, Linux" },

  // App Service / Function App — billing rolls up to the plan; compute itself is $0
  "appService.base": { monthlyUsd: 0, note: "Compute billed via App Service Plan" },
  "functionApp.consumption": { monthlyUsd: 0, note: "Consumption plan: first 1M executions/month free" },
  "functionApp.premium": { monthlyUsd: 0, note: "Premium plan billed via App Service Plan" },
  "staticWebApp.Free": { monthlyUsd: 0, note: "Static Web Apps Free tier" },
  "staticWebApp.Standard": { monthlyUsd: 9.0, note: "Static Web Apps Standard tier baseline" },

  // AKS and VMSS node compute baselines, Australia East, monthly assuming 730h.
  "aksCluster.Standard_B2s": { monthlyUsd: 31.39, note: "AKS control plane is free; estimate is per B2s node" },
  "aksCluster.Standard_D2s_v5": { monthlyUsd: 70.08, note: "AKS control plane is free; estimate is per D2s v5 node" },
  "aksCluster.Standard_D4s_v5": { monthlyUsd: 140.16, note: "AKS control plane is free; estimate is per D4s v5 node" },
  "virtualMachineScaleSet.Standard_B2s": { monthlyUsd: 31.39, note: "Linux VMSS, per B2s instance" },
  "virtualMachineScaleSet.Standard_D2s_v5": { monthlyUsd: 70.08, note: "Linux VMSS, per D2s v5 instance" },
  "virtualMachineScaleSet.Standard_D4s_v5": { monthlyUsd: 140.16, note: "Linux VMSS, per D4s v5 instance" },

  // Storage Account (Standard hot blob, 100GB baseline + 10k operations)
  "storageAccount.Standard_LRS": { monthlyUsd: 2.4, note: "100GB hot blob + 10k ops, LRS" },
  "storageAccount.Standard_ZRS": { monthlyUsd: 3.0, note: "100GB hot blob + 10k ops, ZRS" },
  "storageAccount.Standard_GRS": { monthlyUsd: 4.8, note: "100GB hot blob + 10k ops, GRS" },
  "storageAccount.Standard_RAGRS": { monthlyUsd: 6.0, note: "100GB hot blob + 10k ops, RA-GRS" },
  "storageAccount.Premium_LRS": { monthlyUsd: 20.0, note: "100GB hot blob, Premium LRS" },

  // SQL Database (single database, vCore-less DTU SKUs)
  "sqlDatabase.Basic": { monthlyUsd: 5.0, note: "Basic 5 DTU" },
  "sqlDatabase.S0": { monthlyUsd: 15.0, note: "Standard S0 (10 DTU)" },
  "sqlDatabase.S1": { monthlyUsd: 30.0, note: "Standard S1 (20 DTU)" },
  "sqlDatabase.GP_S_Gen5_2": {
    monthlyUsd: 73.0,
    note: "General Purpose Serverless, 2 vCores, ~half utilised",
  },
  "sqlDatabase.GP_Gen5_2": {
    monthlyUsd: 365.0,
    note: "General Purpose Provisioned, 2 vCores, always-on",
  },

  // Cosmos DB
  "cosmosDb.Free": { monthlyUsd: 0, note: "Free tier: 1000 RU/s and 25GB free" },
  "cosmosDb.Provisioned400": { monthlyUsd: 24.0, note: "Provisioned 400 RU/s" },
  "cosmosDb.Serverless": { monthlyUsd: 7.0, note: "Serverless baseline: ~1M reads + writes/month" },

  // Key Vault
  "keyVault.standard": { monthlyUsd: 1.0, note: "Baseline operations (~10k/month)" },
  "keyVault.premium": { monthlyUsd: 5.0, note: "Premium HSM-backed keys" },

  // Application Insights / Log Analytics
  "applicationInsights.workspace": {
    monthlyUsd: 0,
    note: "Workspace-based: billed via the Log Analytics workspace",
  },
  "logAnalytics.PerGB2018": { monthlyUsd: 11.5, note: "Pay-as-you-go, ~5GB ingested per month" },
  "logAnalytics.Free": { monthlyUsd: 0, note: "Free tier (legacy)" },

  // Container Registry
  "containerRegistry.Basic": { monthlyUsd: 5.0, note: "Basic SKU" },
  "containerRegistry.Standard": { monthlyUsd: 20.0, note: "Standard SKU" },
  "containerRegistry.Premium": { monthlyUsd: 50.0, note: "Premium SKU" },

  // Front Door
  "frontDoor.Standard_AzureFrontDoor": {
    monthlyUsd: 35.0,
    note: "Standard baseline + 10GB egress; traffic billed separately",
  },
  "frontDoor.Premium_AzureFrontDoor": {
    monthlyUsd: 165.0,
    note: "Premium baseline + 10GB egress; traffic billed separately",
  },

  // Application Gateway
  "applicationGateway.Standard_v2": {
    monthlyUsd: 150.0,
    note: "Standard_v2, 2 capacity units, fixed price + capacity",
  },
  "applicationGateway.WAF_v2": {
    monthlyUsd: 260.0,
    note: "WAF_v2, 2 capacity units, fixed price + capacity",
  },

  // API Management
  "apiManagement.Consumption": { monthlyUsd: 3.0, note: "Consumption beyond 1M free calls" },
  "apiManagement.Developer": { monthlyUsd: 48.0, note: "Developer (non-prod)" },
  "apiManagement.Basic": { monthlyUsd: 147.0, note: "Basic 1 unit" },

  // User-Assigned Managed Identity, Resource Group, VNet, NSG, Subnet
  "userAssignedIdentity.base": { monthlyUsd: 0, note: "No direct cost" },
  "resourceGroup.base": { monthlyUsd: 0, note: "No direct cost" },
  "virtualNetwork.base": { monthlyUsd: 0, note: "No direct cost for VNet itself" },
  "subnet.base": { monthlyUsd: 0, note: "No direct cost for the subnet" },
  "networkSecurityGroup.base": { monthlyUsd: 0, note: "No direct cost" },

  // Private Endpoint
  "privateEndpoint.base": { monthlyUsd: 7.3, note: "Per-endpoint fixed cost + data processing" },
};
