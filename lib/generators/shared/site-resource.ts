// Microsoft.Web/serverfarms and Microsoft.Web/sites bodies shared by the
// Bicep and ARM exporters. Values are plain data; expressions are wrapped in
// `expr()` so each exporter renders them in its own syntax.
import { planFamily, planKind, planSkuTier } from "@/lib/catalogue/app-service-plans";
import type { GraphNode } from "@/lib/graph/schema";
import { GeneratorContext } from "./context";
import { contentShareName, needsContentShare, siteHosting, type SiteHosting } from "./hosting";

// A deployment-language expression. `bicep` and `arm` are the same value in
// each syntax; ARM strings are wrapped in [ ] by the exporter.
export type Expr = { __expr: true; bicep: string; arm: string };
// An object keyed by resource IDs, e.g. identity.userAssignedIdentities.
export type IdMap = { __idmap: true; ids: Expr[] };
export type Value = string | number | boolean | null | Expr | IdMap | Value[] | { [key: string]: Value | undefined };

function isIdMap(value: unknown): value is IdMap {
  return typeof value === "object" && value !== null && (value as IdMap).__idmap === true;
}

export function expr(bicep: string, arm: string): Expr {
  return { __expr: true, bicep, arm };
}

export function isExpr(value: unknown): value is Expr {
  return typeof value === "object" && value !== null && (value as Expr).__expr === true;
}

// How each exporter names other resources.
export type Refs = {
  id(node: GraphNode): Expr;
  name(node: GraphNode): string;
  // Expression for a storage account connection string with its account key.
  storageConnectionString(storage: GraphNode | null): Expr;
  blobEndpoint(storage: GraphNode | null): Expr;
  appInsightsConnectionString(component: GraphNode): Expr;
  userIdentityClientId(identity: GraphNode): Expr;
};

export function planBody(node: GraphNode): { kind: string; sku: Record<string, Value>; properties: Record<string, Value> } {
  const sku = String(node.properties.sku ?? "B1");
  const os = String(node.properties.os ?? "Linux");
  const family = planFamily(sku);
  const skuBlock: Record<string, Value> = { name: sku, tier: planSkuTier(sku) };
  if (family === "dedicated" || family === "elastic") skuBlock.capacity = Number(node.properties.capacity ?? 1);
  const properties: Record<string, Value> = { reserved: os === "Linux" };
  if (family === "elastic") properties.maximumElasticWorkerCount = Math.max(1, Number(node.properties.capacity ?? 1)) * 20;
  return { kind: planKind(sku, os), sku: skuBlock, properties };
}

function siteKind(node: GraphNode, hosting: SiteHosting): string {
  const base = node.type === "functionApp" ? "functionapp,linux" : "app,linux";
  return hosting.image ? `${base},container` : base;
}

function identityBlock(hosting: SiteHosting, refs: Refs): Record<string, Value> {
  if (hosting.userIdentities.length === 0) return { type: "SystemAssigned" };
  return {
    type: "SystemAssigned, UserAssigned",
    userAssignedIdentities: { __idmap: true, ids: hosting.userIdentities.map((identity) => refs.id(identity)) },
  };
}

function linuxFxVersion(node: GraphNode, hosting: SiteHosting): string {
  if (hosting.image) return `DOCKER|${hosting.image.reference}`;
  const runtime = String(node.properties.runtime ?? "node");
  const version = String(node.properties.runtimeVersion ?? (node.type === "functionApp" ? "22" : "22-lts"));
  const stack = runtime === "dotnet" ? (node.type === "functionApp" ? "DOTNET-ISOLATED" : "DOTNETCORE") : runtime.toUpperCase();
  return `${stack}|${version}`;
}

function registrySettings(hosting: SiteHosting, refs: Refs): Record<string, Value> {
  if (!hosting.image || !hosting.pullIdentity) return {};
  return {
    acrUseManagedIdentityCreds: true,
    ...(hosting.pullIdentity.kind === "user" ? { acrUserManagedIdentityID: refs.userIdentityClientId(hosting.pullIdentity.node) } : {}),
  };
}

export type SiteBody = {
  kind: string;
  identity: Record<string, Value>;
  properties: Record<string, Value>;
  dependsOn: GraphNode[];
  hosting: SiteHosting;
};

export function siteBody(ctx: GeneratorContext, node: GraphNode, refs: Refs): SiteBody {
  const hosting = siteHosting(ctx, node);
  const dependsOn = [hosting.plan, node.type === "functionApp" ? hosting.storage : null, hosting.subnet, hosting.appInsights, ...hosting.userIdentities]
    .filter((dep): dep is GraphNode => !!dep);
  const properties: Record<string, Value> = {
    serverFarmId: hosting.plan ? refs.id(hosting.plan) : null,
    publicNetworkAccess: node.properties.publicNetworkAccess === false ? "Disabled" : "Enabled",
    httpsOnly: node.properties.httpsOnly !== false,
  };
  if (hosting.subnet) {
    properties.virtualNetworkSubnetId = refs.id(hosting.subnet);
    properties.vnetRouteAllEnabled = true;
  }
  const appInsights = hosting.appInsights
    ? [{ name: "APPLICATIONINSIGHTS_CONNECTION_STRING", value: refs.appInsightsConnectionString(hosting.appInsights) }]
    : [];

  if (node.type === "appService") {
    properties.siteConfig = {
      minTlsVersion: "1.2",
      alwaysOn: node.properties.alwaysOn !== false,
      linuxFxVersion: linuxFxVersion(node, hosting),
      ...registrySettings(hosting, refs),
      ...(appInsights.length > 0 ? { appSettings: appInsights } : {}),
    };
    return { kind: siteKind(node, hosting), identity: identityBlock(hosting, refs), properties, dependsOn, hosting };
  }

  const storage = refs.storageConnectionString(hosting.storage);
  if (hosting.family === "flex") {
    // Flex rejects linuxFxVersion, FUNCTIONS_WORKER_RUNTIME and
    // FUNCTIONS_EXTENSION_VERSION; the stack lives in functionAppConfig.
    properties.functionAppConfig = {
      deployment: {
        storage: {
          type: "blobContainer",
          value: refs.blobEndpoint(hosting.storage),
          authentication: { type: "StorageAccountConnectionString", storageAccountConnectionStringName: "DEPLOYMENT_STORAGE_CONNECTION_STRING" },
        },
      },
      scaleAndConcurrency: {
        maximumInstanceCount: Number(node.properties.maximumInstanceCount ?? 100),
        instanceMemoryMB: Number(node.properties.instanceMemoryMB ?? 2048),
      },
      runtime: { name: hosting.workerRuntime, version: hosting.flexVersion },
    };
    properties.siteConfig = {
      minTlsVersion: "1.2",
      appSettings: [
        { name: "AzureWebJobsStorage", value: storage },
        { name: "DEPLOYMENT_STORAGE_CONNECTION_STRING", value: storage },
        ...appInsights,
      ],
    };
    return { kind: "functionapp,linux", identity: identityBlock(hosting, refs), properties, dependsOn, hosting };
  }

  const appSettings: Value[] = [
    { name: "AzureWebJobsStorage", value: storage },
    { name: "FUNCTIONS_EXTENSION_VERSION", value: "~4" },
  ];
  if (!hosting.image) appSettings.push({ name: "FUNCTIONS_WORKER_RUNTIME", value: hosting.workerRuntime });
  if (needsContentShare(hosting)) {
    appSettings.push(
      { name: "WEBSITE_CONTENTAZUREFILECONNECTIONSTRING", value: storage },
      { name: "WEBSITE_CONTENTSHARE", value: contentShareName(ctx, node) },
    );
  }
  appSettings.push(...appInsights);
  // Secured storage: the content share is reached over the VNet and must
  // already exist (Microsoft Learn, "Secured deployments").
  if (hosting.privateContentShare) properties.vnetContentShareEnabled = true;
  properties.siteConfig = {
    minTlsVersion: "1.2",
    linuxFxVersion: linuxFxVersion(node, hosting),
    ...(hosting.family === "dedicated" ? { alwaysOn: true } : {}),
    ...registrySettings(hosting, refs),
    appSettings,
  };
  return { kind: siteKind(node, hosting), identity: identityBlock(hosting, refs), properties, dependsOn, hosting };
}

// Renders a Value as a Bicep literal at the given indent.
export function toBicep(value: Value | undefined, indent = 0): string {
  const pad = "  ".repeat(indent);
  const inner = "  ".repeat(indent + 1);
  if (value === undefined || value === null) return "null";
  if (isExpr(value)) return value.bicep;
  if (isIdMap(value)) return `{\n${value.ids.map((id) => `${inner}'\${${id.bicep}}': {}`).join("\n")}\n${pad}}`;
  if (typeof value === "string") return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((item) => `${inner}${toBicep(item, indent + 1)}`).join("\n")}\n${pad}]`;
  }
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  if (entries.length === 0) return "{}";
  return `{\n${entries
    .map(([key, item]) => `${inner}${/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `'${key}'`}: ${toBicep(item, indent + 1)}`)
    .join("\n")}\n${pad}}`;
}

// Converts a Value to ARM JSON, rendering expressions as "[...]" strings.
export function toArm(value: Value | undefined): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (isExpr(value)) return `[${value.arm}]`;
  if (isIdMap(value)) return Object.fromEntries(value.ids.map((id) => [`[${id.arm}]`, {}]));
  if (Array.isArray(value)) return value.map(toArm);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, toArm(item)]));
  }
  return value;
}
