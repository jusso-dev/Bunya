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
// App Service Plan and Functions rows were refreshed separately.
export const APP_SERVICE_PRICE_SNAPSHOT_DATE = "2026-11-06";
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
  // App Service Plans: Linux pay-as-you-go, Australia East, per instance at 730h.
  // Retail Prices API snapshot 2026-11-06 (`pnpm prices:refresh` checks drift).
  "appServicePlan.B1": { monthlyUsd: 13.87, note: "Basic B1, Linux, per instance" },
  "appServicePlan.B2": { monthlyUsd: 27.01, note: "Basic B2, Linux, per instance" },
  "appServicePlan.B3": { monthlyUsd: 53.29, note: "Basic B3, Linux, per instance" },
  "appServicePlan.S1": { monthlyUsd: 87.6, note: "Standard S1, Linux, per instance" },
  "appServicePlan.S2": { monthlyUsd: 175.2, note: "Standard S2, Linux, per instance" },
  "appServicePlan.S3": { monthlyUsd: 350.4, note: "Standard S3, Linux, per instance" },
  "appServicePlan.P1v2": { monthlyUsd: 89.79, note: "Premium v2 P1, Linux, per instance" },
  "appServicePlan.P2v2": { monthlyUsd: 178.85, note: "Premium v2 P2, Linux, per instance" },
  "appServicePlan.P3v2": { monthlyUsd: 358.43, note: "Premium v2 P3, Linux, per instance" },
  "appServicePlan.P0v3": { monthlyUsd: 67.16, note: "Premium v3 P0, Linux, per instance" },
  "appServicePlan.P1v3": { monthlyUsd: 134.32, note: "Premium v3 P1, Linux, per instance" },
  "appServicePlan.P2v3": { monthlyUsd: 268.64, note: "Premium v3 P2, Linux, per instance" },
  "appServicePlan.P3v3": { monthlyUsd: 537.28, note: "Premium v3 P3, Linux, per instance" },
  // Functions Premium bills vCPU ($0.182/h) and memory ($0.013/GiB-h) per
  // always-ready instance: EP1 1 vCPU 3.5 GiB, EP2 2 vCPU 7 GiB, EP3 4 vCPU 14 GiB.
  "appServicePlan.EP1": { monthlyUsd: 166.08, note: "Functions Premium EP1, per always-ready instance" },
  "appServicePlan.EP2": { monthlyUsd: 332.15, note: "Functions Premium EP2, per always-ready instance" },
  "appServicePlan.EP3": { monthlyUsd: 664.3, note: "Functions Premium EP3, per always-ready instance" },
  // Serverless plans have no fixed charge; executions are billed per use.
  "appServicePlan.Y1": { monthlyUsd: 0, note: "Consumption: 1M executions and 400,000 GB-s free per month, then per use" },
  "appServicePlan.FC1": { monthlyUsd: 0, note: "Flex Consumption on demand: 250,000 executions and 100,000 GB-s free per month, then per use" },

  // App Service / Function App: billing rolls up to the plan.
  "appService.base": { monthlyUsd: 0, note: "Compute billed via App Service Plan" },
  "functionApp.consumption": { monthlyUsd: 0, note: "Billed per execution on a Consumption or Flex Consumption plan" },
  "functionApp.premium": { monthlyUsd: 0, note: "Billed via the App Service Plan" },
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

  "cosmosDb.Free": { monthlyUsd: 0, note: "Free tier: 1000 RU/s and 25GB free" },
  "cosmosDb.Provisioned400": { monthlyUsd: 24.0, note: "Provisioned 400 RU/s" },
  "cosmosDb.Serverless": { monthlyUsd: 7.0, note: "Serverless baseline: ~1M reads + writes/month" },

  "keyVault.standard": { monthlyUsd: 1.0, note: "Baseline operations (~10k/month)" },
  "keyVault.premium": { monthlyUsd: 5.0, note: "Premium HSM-backed keys" },

  "applicationInsights.workspace": {
    monthlyUsd: 0,
    note: "Workspace-based: billed via the Log Analytics workspace",
  },
  "logAnalytics.PerGB2018": { monthlyUsd: 11.5, note: "Pay-as-you-go, ~5GB ingested per month" },
  "logAnalytics.Free": { monthlyUsd: 0, note: "Free tier (legacy)" },

  "containerRegistry.Basic": { monthlyUsd: 5.0, note: "Basic SKU" },
  "containerRegistry.Standard": { monthlyUsd: 20.0, note: "Standard SKU" },
  "containerRegistry.Premium": { monthlyUsd: 50.0, note: "Premium SKU" },

  "frontDoor.Standard_AzureFrontDoor": {
    monthlyUsd: 35.0,
    note: "Standard baseline + 10GB egress; traffic billed separately",
  },
  "frontDoor.Premium_AzureFrontDoor": {
    monthlyUsd: 165.0,
    note: "Premium baseline + 10GB egress; traffic billed separately",
  },

  "applicationGateway.Standard_v2": {
    monthlyUsd: 150.0,
    note: "Standard_v2, 2 capacity units, fixed price + capacity",
  },
  "applicationGateway.WAF_v2": {
    monthlyUsd: 260.0,
    note: "WAF_v2, 2 capacity units, fixed price + capacity",
  },

  "apiManagement.Consumption": { monthlyUsd: 3.0, note: "Consumption beyond 1M free calls" },
  "apiManagement.Developer": { monthlyUsd: 48.0, note: "Developer (non-prod)" },
  "apiManagement.Basic": { monthlyUsd: 147.0, note: "Basic 1 unit" },

  "userAssignedIdentity.base": { monthlyUsd: 0, note: "No direct cost" },
  "resourceGroup.base": { monthlyUsd: 0, note: "No direct cost" },
  "virtualNetwork.base": { monthlyUsd: 0, note: "No direct cost for VNet itself" },
  "subnet.base": { monthlyUsd: 0, note: "No direct cost for the subnet" },
  "networkSecurityGroup.base": { monthlyUsd: 0, note: "No direct cost" },

  "privateEndpoint.base": { monthlyUsd: 7.3, note: "Per-endpoint fixed cost + data processing" },
};
