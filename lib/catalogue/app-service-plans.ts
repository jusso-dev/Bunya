// App Service Plan SKU families and container image parsing, shared by the
// catalogue, importer, topology checks, exporters and pricing.

export const APP_SERVICE_PLAN_SKUS = [
  "B1", "B2", "B3",
  "S1", "S2", "S3",
  "P1v2", "P2v2", "P3v2",
  "P0v3", "P1v3", "P2v3", "P3v3",
  "EP1", "EP2", "EP3",
  "Y1",
  "FC1",
] as const;

export type AppServicePlanSku = (typeof APP_SERVICE_PLAN_SKUS)[number];

// dedicated: Basic/Standard/Premium workers that host web and function apps.
// elastic: Functions Premium (EP*), Function Apps only.
// consumption: Linux Consumption (Y1), Function Apps only.
// flex: Flex Consumption (FC1), one Linux Function App per plan.
export type PlanFamily = "dedicated" | "elastic" | "consumption" | "flex";

export function planFamily(sku: unknown): PlanFamily {
  if (sku === "FC1") return "flex";
  if (sku === "Y1") return "consumption";
  if (typeof sku === "string" && /^EP\d$/.test(sku)) return "elastic";
  return "dedicated";
}

export function isFunctionsOnlyPlan(sku: unknown): boolean {
  return planFamily(sku) !== "dedicated";
}

// ARM `sku.tier` for each family; Basic/Standard/Premium tiers come from the name.
export function planSkuTier(sku: string): string {
  switch (planFamily(sku)) {
    case "flex":
      return "FlexConsumption";
    case "consumption":
      return "Dynamic";
    case "elastic":
      return "ElasticPremium";
    default:
      if (sku.startsWith("B")) return "Basic";
      if (sku.startsWith("S")) return "Standard";
      if (sku.endsWith("v2")) return "PremiumV2";
      if (sku === "P0v3") return "Premium0V3";
      return "PremiumV3";
  }
}

// ARM `kind` for a Linux plan of this family.
export function planKind(sku: string, os: string): string {
  const family = planFamily(sku);
  if (family === "elastic") return "elastic";
  if (family === "consumption" || family === "flex") return "functionapp";
  return os === "Linux" ? "linux" : "app";
}

// Lowercase registry host and repository, optional port, optional tag.
// Digests are not modelled; pin with a tag instead.
export const CONTAINER_IMAGE_PATTERN =
  /^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::\d{1,5})?\/)?[a-z0-9]+(?:[._/-][a-z0-9]+)*(?::[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?$/;

export type ContainerImage = {
  registryHost: string;
  registryUrl: string;
  repository: string;
  tag: string;
  // Repository and tag without the registry host, e.g. "api:1.2".
  imageAndTag: string;
  // Full reference with an explicit tag, e.g. "myacr.azurecr.io/api:1.2".
  reference: string;
};

export function parseContainerImage(image: string): ContainerImage | null {
  const trimmed = image.trim();
  if (!trimmed || !CONTAINER_IMAGE_PATTERN.test(trimmed)) return null;
  const firstSlash = trimmed.indexOf("/");
  const head = firstSlash >= 0 ? trimmed.slice(0, firstSlash) : "";
  // Docker treats the first segment as a host only when it has a dot or port.
  const hasHost = head.includes(".") || head.includes(":") || head === "localhost";
  const registryHost = hasHost ? head : "index.docker.io";
  const rest = hasHost ? trimmed.slice(firstSlash + 1) : trimmed;
  const colon = rest.lastIndexOf(":");
  const repository = colon > rest.lastIndexOf("/") && colon >= 0 ? rest.slice(0, colon) : rest;
  const tag = colon > rest.lastIndexOf("/") && colon >= 0 ? rest.slice(colon + 1) : "latest";
  return {
    registryHost,
    registryUrl: `https://${registryHost}`,
    repository,
    tag,
    imageAndTag: `${repository}:${tag}`,
    reference: `${registryHost}/${repository}:${tag}`,
  };
}

const WORKER_SIZES = ["ExtraSmall", "Small", "Medium", "Large"] as const;

// New-AzAppServicePlan takes a tier and a worker size, not a SKU name:
// Basic + Small is B1, PremiumV3 + Large is P3v3, Premium0V3 + ExtraSmall is P0v3.
export function powerShellPlanSku(sku: string): { tier: string; workerSize: string } | null {
  if (planFamily(sku) !== "dedicated") return null;
  const size = Number(/\d/.exec(sku)?.[0]);
  const workerSize = WORKER_SIZES[size];
  if (!workerSize) return null;
  return { tier: planSkuTier(sku), workerSize };
}
