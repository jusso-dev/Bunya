// Microsoft.Web/serverfarms and Microsoft.Web/sites bodies shared by the
// Bicep and ARM exporters. Values are plain data; references to other
// resources come from the exporter's Refs as expressions in its own syntax.
import { planFamily, planKind, planSkuTier } from "@/lib/catalogue/app-service-plans";
import type { GraphNode } from "@/lib/graph/schema";
import { GeneratorContext } from "./context";
import { contentShareName, needsContentShare, siteHosting, type SiteHosting } from "./hosting";
import { quote } from "./quote";

// A deployment-language expression, written by one exporter's Refs.
export type Expr = { __expr: true; code: string };
// An object keyed by resource IDs, e.g. identity.userAssignedIdentities.
type IdMap = { __idmap: true; ids: Expr[] };
export type Value = string | number | boolean | null | Expr | IdMap | Value[] | { [key: string]: Value | undefined };

export function expr(code: string): Expr {
  return { __expr: true, code };
}

function isExpr(value: unknown): value is Expr {
  return typeof value === "object" && value !== null && (value as Expr).__expr === true;
}

function isIdMap(value: unknown): value is IdMap {
  return typeof value === "object" && value !== null && (value as IdMap).__idmap === true;
}

export type Refs = {
  id(node: GraphNode): Expr;
  // Connection string for a storage account, with its account key.
  storageConnectionString(storage: GraphNode): Expr;
  // Blob URL of a Flex app's deployment container.
  deploymentContainerUrl(storage: GraphNode, site: GraphNode): Expr;
  appInsightsConnectionString(component: GraphNode): Expr;
  userIdentityClientId(identity: GraphNode): Expr;
};

export function planBody(node: GraphNode): { kind: string; sku: Record<string, Value>; properties: Record<string, Value> } {
  const sku = String(node.properties.sku);
  const os = String(node.properties.os);
  const family = planFamily(sku);
  const skuBlock: Record<string, Value> = { name: sku, tier: planSkuTier(sku) };
  if (family === "dedicated" || family === "elastic") skuBlock.capacity = Number(node.properties.capacity);
  const properties: Record<string, Value> = { reserved: os === "Linux" };
  if (family === "elastic") properties.maximumElasticWorkerCount = Math.max(1, Number(node.properties.capacity)) * 20;
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
  const runtime = String(node.properties.runtime);
  const stack = runtime === "dotnet" ? (node.type === "functionApp" ? "DOTNET-ISOLATED" : "DOTNETCORE") : runtime.toUpperCase();
  return `${stack}|${String(node.properties.runtimeVersion)}`;
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
  // Resources the body references, which ARM must deploy first.
  dependsOn: GraphNode[];
  hosting: SiteHosting;
};

export function siteBody(ctx: GeneratorContext, node: GraphNode, refs: Refs): SiteBody {
  const hosting = siteHosting(ctx, node);
  const dependsOn = [hosting.plan, node.type === "functionApp" ? hosting.storage : null, hosting.subnet, hosting.appInsights, ...hosting.userIdentities]
    .filter((dep): dep is GraphNode => !!dep);
  const properties: Record<string, Value> = {
    serverFarmId: refs.id(hosting.plan),
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

  const storageAccount = hosting.storage!;
  const storage = refs.storageConnectionString(storageAccount);
  if (hosting.flex) {
    // Flex rejects linuxFxVersion, FUNCTIONS_WORKER_RUNTIME and
    // FUNCTIONS_EXTENSION_VERSION; the stack lives in functionAppConfig.
    properties.functionAppConfig = {
      deployment: {
        storage: {
          type: "blobContainer",
          value: refs.deploymentContainerUrl(storageAccount, node),
          authentication: { type: "StorageAccountConnectionString", storageAccountConnectionStringName: "DEPLOYMENT_STORAGE_CONNECTION_STRING" },
        },
      },
      scaleAndConcurrency: {
        maximumInstanceCount: Number(node.properties.maximumInstanceCount),
        instanceMemoryMB: Number(node.properties.instanceMemoryMB),
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
  if (needsContentShare(hosting.family)) {
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

export function toBicep(value: Value | undefined, indent = 0): string {
  const pad = "  ".repeat(indent);
  const inner = "  ".repeat(indent + 1);
  if (value === undefined || value === null) return "null";
  if (isExpr(value)) return value.code;
  if (isIdMap(value)) return `{\n${value.ids.map((id) => `${inner}'\${${id.code}}': {}`).join("\n")}\n${pad}}`;
  if (typeof value === "string") return quote.bicep(value);
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

export function toArm(value: Value | undefined): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (isExpr(value)) return `[${value.code}]`;
  if (isIdMap(value)) return Object.fromEntries(value.ids.map((id) => [`[${id.code}]`, {}]));
  if (Array.isArray(value)) return value.map(toArm);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, toArm(item)]));
  }
  return value;
}
