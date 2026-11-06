import { checkImportText, checkObjectDepth } from "./limits";
import { isExportLiteral, toExportLiteral } from "@/lib/generators/shared/validate";
import { getServiceDefinition } from "@/lib/catalogue/services";
import type {
  EdgeKind,
  GraphDocument,
  GraphEdge,
  GraphNode,
  ServiceType,
} from "@/lib/graph/schema";
import { AZURE_REGIONS, DEFAULT_CONTAINER_SIZE, isContainerType } from "@/lib/graph/schema";
import { serviceTypeOf } from "@/lib/rules/mapping";
import { APP_SERVICE_PLAN_SKUS, CONTAINER_IMAGE_PATTERN, parseContainerImage, planFamily } from "@/lib/catalogue/app-service-plans";
import { sitePlan } from "@/lib/graph/topology";

type ArmResource = {
  type?: unknown;
  apiVersion?: unknown;
  name?: unknown;
  location?: unknown;
  kind?: unknown;
  sku?: unknown;
  identity?: unknown;
  properties?: unknown;
  dependsOn?: unknown;
  resources?: unknown;
  tags?: unknown;
};

type FlatArmResource = {
  raw: ArmResource;
  type: string;
  name: string;
  fullName: string;
  parentType?: string;
  parentName?: string;
};

type ImportedResource = { flat: FlatArmResource; node: GraphNode };

const SERVICE_NODE_SIZE = { width: 220, height: 50 };

export type ArmImportResult =
  | { ok: true; document: GraphDocument; warning?: string }
  | { ok: false; reason: string };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cleanName(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  const param = trimmed.match(/^\[parameters\('([^']+)'\)\]$/i)?.[1];
  if (param) return param.replace(/[^A-Za-z0-9-]/g, "-");
  const variable = trimmed.match(/^\[variables\('([^']+)'\)\]$/i)?.[1];
  if (variable) return variable.replace(/[^A-Za-z0-9-]/g, "-");
  if (trimmed.startsWith("[")) return fallback;
  return trimmed.split("/").filter(Boolean).at(-1) ?? fallback;
}

function resolveString(
  value: unknown,
  parameters: Record<string, unknown>,
  variables: Record<string, unknown>,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const exactParam = value.match(/^\[parameters\('([^']+)'\)\]$/i)?.[1];
  if (exactParam) {
    const def = asRecord(parameters[exactParam]).defaultValue;
    return typeof def === "string" ? def : exactParam;
  }
  const exactVariable = value.match(/^\[variables\('([^']+)'\)\]$/i)?.[1];
  if (exactVariable) {
    const def = variables[exactVariable];
    return typeof def === "string" ? def : exactVariable;
  }
  const concat = value.match(/^\[concat\((.*)\)\]$/i)?.[1];
  if (concat) {
    const parts = concat
      .split(/,(?=(?:[^']*'[^']*')*[^']*$)/)
      .map((part) => part.trim())
      .map((part) => {
        const literal = part.match(/^'([^']*)'$/)?.[1];
        if (literal !== undefined) return literal;
        const param = part.match(/^parameters\('([^']+)'\)$/i)?.[1];
        if (param) return resolveString(`[parameters('${param}')]`, parameters, variables) ?? param;
        const variable = part.match(/^variables\('([^']+)'\)$/i)?.[1];
        if (variable) return resolveString(`[variables('${variable}')]`, parameters, variables) ?? variable;
        return "";
      });
    const joined = parts.join("");
    return joined || undefined;
  }
  return value;
}

// Portal exports reference resources through parameter names, e.g.
// resourceId('Microsoft.Web/serverfarms', parameters('serverfarms_x_name')).
// Swap each reference for its default value so edge matching sees real names.
function expandReferences(
  value: unknown,
  parameters: Record<string, unknown>,
  variables: Record<string, unknown>,
): unknown {
  if (typeof value === "string") {
    return value.replace(/\b(parameters|variables)\('([^']+)'\)/gi, (match, kind: string, key: string) => {
      const resolved = kind.toLowerCase() === "parameters" ? asRecord(parameters[key]).defaultValue : variables[key];
      return typeof resolved === "string" ? `'${resolved.replace(/'/g, "''")}'` : match;
    });
  }
  if (Array.isArray(value)) return value.map((item) => expandReferences(item, parameters, variables));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, expandReferences(item, parameters, variables)]),
    );
  }
  return value;
}

// Exporters accept only letters, numbers, dots, underscores and hyphens.
function safeResourceName(name: string, fallback: string): string {
  const safe = name.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return safe || fallback;
}

function flattenResources(
  resources: unknown[],
  parameters: Record<string, unknown>,
  variables: Record<string, unknown>,
  warnings: string[],
  parent?: FlatArmResource,
): FlatArmResource[] {
  const out: FlatArmResource[] = [];
  resources.forEach((value, index) => {
    const raw = asRecord(value) as ArmResource;
    const rawType = resolveString(raw.type, parameters, variables);
    const rawName = resolveString(raw.name, parameters, variables);
    if (!rawType || !rawName) {
      warnings.push("An ARM resource with a missing type or name and its nested resources were skipped.");
      return;
    }
    const type = parent && !rawType.includes(".") ? `${parent.type}/${rawType}` : rawType;
    const fullName = parent && !rawName.includes("/") ? `${parent.fullName}/${rawName}` : rawName;
    const flat: FlatArmResource = {
      raw,
      type,
      name: cleanName(rawName, `resource-${index + 1}`),
      fullName,
      parentType: parent?.type,
      parentName: parent?.fullName,
    };
    out.push(flat);
    out.push(
      ...flattenResources(asArray(raw.resources), parameters, variables, warnings, flat),
    );
  });
  return out;
}

function serviceTypeFor(resource: FlatArmResource): ServiceType | null {
  const lower = resource.type.toLowerCase();
  // Individual functions inside a Function App are app content, not resources.
  if (lower === "microsoft.web/sites/functions") return null;
  if (lower === "microsoft.web/sites") {
    const kind = asString(resource.raw.kind)?.toLowerCase() ?? "";
    return kind.includes("functionapp") ? "functionApp" : "appService";
  }
  return serviceTypeOf(resource.type);
}

const LINUX_FX_RUNTIMES: Record<string, string> = {
  NODE: "node",
  PYTHON: "python",
  DOTNETCORE: "dotnet",
  DOTNET: "dotnet",
  "DOTNET-ISOLATED": "dotnet",
  JAVA: "java",
  POWERSHELL: "powershell",
};

// `siteConfig.linuxFxVersion` is "<RUNTIME>|<VERSION>", e.g. "NODE|18-lts".
// Keeping the exported runtime lets lifecycle rules see what is deployed.
function linuxRuntime(
  siteConfig: Record<string, unknown>,
  resourceKind: "app" | "functionapp",
  resourceName: string,
  parameters: Record<string, unknown>,
  variables: Record<string, unknown>,
  warnings: string[],
): Record<string, string> {
  const fx = resolveString(siteConfig.linuxFxVersion, parameters, variables);
  if (!fx) return {};
  const match = /^([A-Za-z-]+)\|(.+)$/.exec(fx.trim());
  const runtime = match ? LINUX_FX_RUNTIMES[match[1].toUpperCase()] : undefined;
  if (match?.[1].toUpperCase() === "DOCKER") {
    const image = match[2].trim();
    if (CONTAINER_IMAGE_PATTERN.test(image) && image.length <= 512) return { containerImage: image };
    warnings.push(`${resourceName}: container image "${image}" could not be read (digests and expressions are not modelled); set the image in the inspector.`);
    return {};
  }
  if (!match || !runtime) {
    warnings.push(`${resourceName}: runtime "${fx}" is not modelled; Bunya defaults were used.`);
    return {};
  }
  if (match[1].toUpperCase().startsWith("DOTNET") && match[1].toUpperCase() !== "DOTNET-ISOLATED" && resourceKind === "functionapp") {
    warnings.push(`${resourceName}: .NET Function Apps are exported on the isolated worker model; the in-process model ends support on 10 November 2026, so migrate the code before deploying.`);
  }
  return { runtime, runtimeVersion: match[2].trim() };
}

const FLEX_RUNTIMES: Record<string, string> = {
  node: "node",
  python: "python",
  java: "java",
  powershell: "powershell",
  "dotnet-isolated": "dotnet",
};

// Flex Consumption apps carry their stack in functionAppConfig, not siteConfig.
function flexSettings(props: Record<string, unknown>, resourceName: string, warnings: string[]): Record<string, unknown> {
  const config = asRecord(props.functionAppConfig);
  if (Object.keys(config).length === 0) return {};
  const runtime = asRecord(config.runtime);
  const scale = asRecord(config.scaleAndConcurrency);
  const name = asString(runtime.name)?.toLowerCase();
  const out: Record<string, unknown> = {};
  if (name && FLEX_RUNTIMES[name]) {
    out.runtime = FLEX_RUNTIMES[name];
    const version = asString(runtime.version);
    if (version) out.runtimeVersion = version;
  } else if (name) {
    warnings.push(`${resourceName}: runtime "${name}" is not modelled; Bunya defaults were used.`);
  }
  const memory = asNumber(scale.instanceMemoryMB);
  if (memory !== undefined) out.instanceMemoryMB = memory;
  const maximum = asNumber(scale.maximumInstanceCount);
  if (maximum !== undefined) out.maximumInstanceCount = maximum;
  return out;
}

// Plans are Linux when `reserved` is true or the kind says so. Portal
// exports of Windows plans set reserved to false.
function planOs(resource: FlatArmResource, defaultOs: unknown): unknown {
  const props = asRecord(resource.raw.properties);
  const kind = asString(resource.raw.kind)?.toLowerCase() ?? "";
  if (props.reserved === true || kind.includes("linux")) return "Linux";
  if (props.reserved === false) return "Windows";
  return defaultOs;
}

// ARM accepts SKU names in any case ("p1v3", "P1V3"); match the catalogue spelling.
function planSku(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const compact = name.replace(/\s+/g, "");
  return APP_SERVICE_PLAN_SKUS.find((sku) => sku.toLowerCase() === compact.toLowerCase()) ?? name;
}

function sqlDatabaseSku(sku: Record<string, unknown>): string | undefined {
  const name = asString(sku.name);
  const capacity = asNumber(sku.capacity);
  if (!name) return undefined;
  // Exports split vCore SKUs into name + capacity, e.g. GP_S_Gen5 + 2.
  if (/_Gen\d+$/i.test(name) && capacity !== undefined) return `${name}_${capacity}`;
  // DTU Standard tiers are exported as name "Standard" + DTU capacity.
  if (name === "Standard" && capacity !== undefined) return ({ 10: "S0", 20: "S1" } as Record<number, string>)[capacity] ?? name;
  return name;
}

function baseProperties(type: ServiceType, resource: FlatArmResource, allResources: FlatArmResource[], parameters: Record<string, unknown>, variables: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const def = getServiceDefinition(type);
  const props = asRecord(resource.raw.properties);
  const sku = asRecord(resource.raw.sku);
  const identity = asRecord(resource.raw.identity);
  const defaults = { ...def.defaultProperties };
  switch (type) {
    case "resourceGroup":
      return { ...defaults, tags: asRecord(resource.raw.tags) };
    case "virtualNetwork": {
      const addressSpace = asRecord(props.addressSpace);
      const prefixes = asArray(addressSpace.addressPrefixes).filter((v): v is string => typeof v === "string");
      const dnsServers = asArray(asRecord(props.dhcpOptions).dnsServers)
        .map((server) => resolveString(server, parameters, variables))
        .filter((server): server is string => !!server && /^\d+\.\d+\.\d+\.\d+$/.test(server));
      return {
        ...defaults,
        addressSpace: prefixes[0] ?? defaults.addressSpace,
        // Further ranges are kept so subnets in them still validate.
        ...(prefixes.length > 1 ? { additionalAddressSpaces: prefixes.slice(1) } : {}),
        dnsServers,
      };
    }
    case "subnet":
      return {
        ...defaults,
        addressPrefix: asString(props.addressPrefix) ?? asString(asArray(props.addressPrefixes)[0]) ?? defaults.addressPrefix,
        privateEndpointNetworkPolicies:
          asString(props.privateEndpointNetworkPolicies) ?? defaults.privateEndpointNetworkPolicies,
      };
    case "appServicePlan": {
      const skuName = planSku(asString(sku.name));
      const family = planFamily(skuName);
      const capacity = asNumber(sku.capacity);
      return {
        ...defaults,
        sku: skuName ?? defaults.sku,
        os: planOs(resource, defaults.os),
        // Consumption and Flex plans have no fixed workers. A dedicated or
        // Elastic Premium plan reports 0 while stopped; it deploys with 1.
        capacity: family === "consumption" || family === "flex" ? capacity ?? 0 : Math.max(1, capacity ?? Number(defaults.capacity ?? 1)),
      };
    }
    case "appService":
      return {
        ...defaults,
        ...linuxRuntime(asRecord(props.siteConfig), "app", resource.name, parameters, variables, warnings),
        httpsOnly: props.httpsOnly !== false,
        alwaysOn: asRecord(props.siteConfig).alwaysOn !== false,
        publicNetworkAccess: asString(props.publicNetworkAccess) !== "Disabled",
        vnetIntegration: !!asString(props.virtualNetworkSubnetId),
      };
    case "functionApp":
      return {
        ...defaults,
        ...linuxRuntime(asRecord(props.siteConfig), "functionapp", resource.name, parameters, variables, warnings),
        ...flexSettings(props, resource.name, warnings),
        httpsOnly: props.httpsOnly !== false,
        publicNetworkAccess: asString(props.publicNetworkAccess) !== "Disabled",
        vnetIntegration: !!asString(props.virtualNetworkSubnetId),
      };
    case "staticWebApp":
      return { ...defaults, sku: asString(sku.name) ?? defaults.sku };
    case "aksCluster": {
      const pool = asRecord(asArray(props.agentPoolProfiles)[0]);
      const network = asRecord(props.networkProfile);
      const api = asRecord(props.apiServerAccessProfile);
      return {
        ...defaults,
        kubernetesVersion: asString(props.kubernetesVersion) ?? "",
        dnsPrefix: asString(props.dnsPrefix) ?? defaults.dnsPrefix,
        nodeVmSize: asString(pool.vmSize) ?? defaults.nodeVmSize,
        nodeCount: asNumber(pool.count) ?? defaults.nodeCount,
        networkPlugin: asString(network.networkPlugin) ?? defaults.networkPlugin,
        networkPolicy: asString(network.networkPolicy) ?? defaults.networkPolicy,
        privateCluster: api.enablePrivateCluster === true,
        authorizedIpRanges: asArray(api.authorizedIPRanges).filter((v): v is string => typeof v === "string"),
        managedIdentity: asString(identity.type) !== "None",
        availabilityZones: asArray(pool.availabilityZones ?? pool.zones).filter((v): v is string => typeof v === "string"),
        azureRbac: props.enableRBAC !== false,
        oidcIssuer: asRecord(props.oidcIssuerProfile).enabled === true,
      };
    }
    case "virtualMachineScaleSet": {
      const profile = asRecord(props.virtualMachineProfile);
      const storage = asRecord(profile.storageProfile);
      const image = asRecord(storage.imageReference);
      const os = asRecord(profile.osProfile);
      return {
        ...defaults,
        sku: asString(sku.name) ?? defaults.sku,
        capacity: asNumber(sku.capacity) ?? defaults.capacity,
        orchestrationMode: asString(props.orchestrationMode) ?? defaults.orchestrationMode,
        upgradeMode: asString(asRecord(props.upgradePolicy).mode) ?? defaults.upgradeMode,
        adminUsername: asString(os.adminUsername) ?? defaults.adminUsername,
        imagePublisher: asString(image.publisher) ?? defaults.imagePublisher,
        imageOffer: asString(image.offer) ?? defaults.imageOffer,
        imageSku: asString(image.sku) ?? defaults.imageSku,
        automaticRepairs: asRecord(props.automaticRepairsPolicy).enabled !== false,
        availabilityZones: asArray((resource.raw as { zones?: unknown }).zones).filter((v): v is string => typeof v === "string"),
        managedIdentity: asString(identity.type) !== "None",
        azureMonitorAgent: JSON.stringify(props).toLowerCase().includes("azuremonitorlinuxagent"),
        trustedLaunch:
          asString(asRecord(profile.securityProfile).securityType) === "TrustedLaunch",
      };
    }
    case "storageAccount":
      return {
        ...defaults,
        sku: asString(sku.name) ?? defaults.sku,
        kind: asString(resource.raw.kind) ?? defaults.kind,
        allowPublicAccess: props.allowBlobPublicAccess === true,
        // Azure leaves the public endpoint open unless it is disabled.
        publicNetworkAccess: asString(props.publicNetworkAccess) !== "Disabled",
        minTlsVersion: asString(props.minimumTlsVersion)?.replace("TLS1_", "1.") ?? defaults.minTlsVersion,
        hierarchicalNamespace: props.isHnsEnabled === true,
      };
    case "keyVault": {
      const rawSku = asRecord(props.sku).name;
      const skuName = resolveString(rawSku, parameters, variables)?.trim().toLowerCase();
      if (rawSku !== undefined && skuName !== "standard" && skuName !== "premium") {
        warnings.push(`Key Vault ${resource.name} has an unrecognized or unresolved SKU; defaulted to standard.`);
      }
      return {
        ...defaults,
        sku: skuName === "standard" || skuName === "premium" ? skuName : defaults.sku,
        purgeProtection: props.enablePurgeProtection !== false,
        softDeleteRetentionDays: asNumber(props.softDeleteRetentionInDays) ?? defaults.softDeleteRetentionDays,
        rbacAuthorization: props.enableRbacAuthorization !== false,
        publicNetworkAccess: asString(props.publicNetworkAccess) !== "Disabled",
      };
    }
    case "applicationInsights":
      return { ...defaults, type: asString(props.Application_Type) ?? defaults.type };
    case "logAnalytics":
      return {
        ...defaults,
        sku: asString(asRecord(props.sku).name) ?? defaults.sku,
        retentionDays: asNumber(props.retentionInDays) ?? defaults.retentionDays,
      };
    case "privateDnsZone":
      return { ...defaults, zoneName: resource.name };
    case "monitorAlert":
      return {
        ...defaults,
        enabled: props.enabled !== false,
        condition: asString(asArray(asRecord(props.criteria).allOf)[0]) ?? defaults.condition,
      };
    case "actionGroup":
      return {
        ...defaults,
        shortName: asString(props.groupShortName) ?? defaults.shortName,
        email:
          asString(asRecord(asArray(props.emailReceivers)[0]).emailAddress) ??
          defaults.email,
      };
    case "roleAssignment": {
      const roleId = asString(props.roleDefinitionId)?.toLowerCase() ?? "";
      const roleDefinitionName =
        roleId.includes("7f951dda-4ed3-4680-a7ca-43fe172d538d")
          ? "AcrPull"
          : roleId.includes("4633458b-17de-408a-b874-0445c86b69e6")
            ? "Key Vault Secrets User"
            : roleId.includes("ba92f5b4-2d11-453d-a403-e96b0029c9fe")
              ? "Storage Blob Data Contributor"
              : defaults.roleDefinitionName;
      return {
        ...defaults,
        roleDefinitionName,
        principalType: asString(props.principalType) ?? defaults.principalType,
        // The scope is drawn as an identity edge; keep only a literal label
        // here, never a template expression such as [resourceId(...)].
        scope: ((value) => (value && !value.trim().startsWith("[") ? value : defaults.scope))(asString((resource.raw as { scope?: unknown }).scope)),
      };
    }
    case "containerRegistry":
      return {
        ...defaults,
        sku: asString(sku.name) ?? defaults.sku,
        adminUserEnabled: props.adminUserEnabled === true,
        publicNetworkAccess: asString(props.publicNetworkAccess) !== "Disabled",
      };
    case "sqlDatabase": {
      const serverName = resource.parentName ?? resource.fullName.split("/").slice(0, -1).join("/");
      const server = allResources.find(
        (candidate) => candidate.type.toLowerCase() === "microsoft.sql/servers" && candidate.fullName.toLowerCase() === serverName.toLowerCase(),
      );
      return {
        ...defaults,
        sku: sqlDatabaseSku(sku) ?? defaults.sku,
        collation: asString(props.collation) ?? defaults.collation,
        zoneRedundant: props.zoneRedundant === true,
        adminLogin: asString(asRecord(server?.raw.properties).administratorLogin) ?? defaults.adminLogin,
      };
    }
    case "cosmosDb":
      return {
        ...defaults,
        consistency: asString(asRecord(props.consistencyPolicy).defaultConsistencyLevel) ?? defaults.consistency,
        freeTier: props.enableFreeTier === true,
        multiRegionWrites: props.enableMultipleWriteLocations === true,
        capabilities: asArray(props.capabilities)
          .map((capability) => asString(asRecord(capability).name))
          .filter((name): name is string => !!name),
      };
    case "privateEndpoint": {
      const connection = asRecord(asArray(props.privateLinkServiceConnections ?? props.manualPrivateLinkServiceConnections)[0]);
      const groupId = asString(asArray(asRecord(connection.properties).groupIds)[0]);
      return {
        ...defaults,
        ...(groupId ? { groupId } : {}),
        manualApproval: asArray(props.manualPrivateLinkServiceConnections).length > 0,
      };
    }
    case "networkSecurityGroup": {
      const PROTOCOLS = new Set(["Tcp", "Udp", "Icmp", "*"]);
      const rules = asArray(props.securityRules).flatMap((value) => {
        const rule = asRecord(value);
        const p = asRecord(rule.properties);
        const direction = asString(p.direction);
        const access = asString(p.access);
        const priority = asNumber(p.priority);
        if ((direction !== "Inbound" && direction !== "Outbound") || (access !== "Allow" && access !== "Deny") || priority === undefined) return [];
        const protocol = asString(p.protocol) ?? "*";
        return [{
          name: asString(rule.name) ?? `rule-${priority}`,
          priority: Math.min(4096, Math.max(100, Math.round(priority))),
          direction,
          access,
          protocol: PROTOCOLS.has(protocol) ? protocol : "*",
          sourceAddressPrefix: asString(p.sourceAddressPrefix) ?? asString(asArray(p.sourceAddressPrefixes)[0]) ?? "*",
          destinationAddressPrefix: asString(p.destinationAddressPrefix) ?? asString(asArray(p.destinationAddressPrefixes)[0]) ?? "*",
          destinationPortRange: asString(p.destinationPortRange) ?? asString(asArray(p.destinationPortRanges)[0]) ?? "*",
        }];
      });
      if (rules.length > 0) {
        warnings.push(`Network Security Group ${resource.name}: its ${rules.length} rule${rules.length === 1 ? " is" : "s are"} shown in the inspector, but deployment exports do not emit NSG rules yet, so they stay blocked while the NSG has rules or subnets.`);
      }
      return {
        ...defaults,
        // Azure's built-in default rules always apply; Bunya's "defaultDeny"
        // means extra deny-all rules, which a portal export does not contain.
        defaultDeny: false,
        inboundRules: rules.filter((rule) => rule.direction === "Inbound"),
        outboundRules: rules.filter((rule) => rule.direction === "Outbound"),
      };
    }
    case "frontDoor":
    case "applicationGateway":
    case "apiManagement":
    case "userAssignedIdentity":
    default:
      warnings.push(`${def.label} ${resource.name}: ARM configuration is not mapped; Bunya defaults were used.`);
      return defaults;
  }
}

// Exporters only emit plain literal strings (no quotes, ampersands or
// expressions). Replace other characters at import and say so, instead of
// letting every export fail later.
function exportableStrings(value: unknown, path: string, changes: string[]): unknown {
  if (typeof value === "string") {
    if (isExportLiteral(value)) return value;
    const next = toExportLiteral(value);
    changes.push(`${path} "${value.slice(0, 60)}" became "${next.slice(0, 60)}"`);
    return next;
  }
  if (Array.isArray(value)) return value.map((item, index) => exportableStrings(item, `${path}[${index}]`, changes));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if ((key === "email" || key === "publisherEmail") && typeof item === "string") return [key, item];
        const safeKey = isExportLiteral(key) ? key : toExportLiteral(key);
        if (safeKey !== key) changes.push(`${path} key "${key.slice(0, 60)}" became "${safeKey.slice(0, 60)}"`);
        return [safeKey, exportableStrings(item, `${path}.${safeKey}`, changes)];
      }),
    );
  }
  return value;
}

function validatedProperties(type: ServiceType, resource: FlatArmResource, properties: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const changes: string[] = [];
  const safe = exportableStrings(properties, "setting", changes) as Record<string, unknown>;
  if (changes.length > 0) {
    warnings.push(`${getServiceDefinition(type).label} ${resource.name}: replaced characters exports cannot write (such as & ' ! #) with "-": ${changes.slice(0, 5).join("; ")}${changes.length > 5 ? `; and ${changes.length - 5} more` : ""}.`);
  }
  return validatedPropertiesInner(type, resource, safe, warnings);
}

function validatedPropertiesInner(type: ServiceType, resource: FlatArmResource, properties: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const definition = getServiceDefinition(type);
  const result = definition.propertiesSchema.safeParse(properties);
  if (result.success) return result.data as Record<string, unknown>;

  const invalidKeys = new Set(result.error.issues.map((issue) => issue.path[0]).filter((key): key is string => typeof key === "string"));
  if (invalidKeys.size === 0 || [...invalidKeys].some((key) => !(key in definition.defaultProperties))) {
    throw result.error;
  }
  const adjusted = { ...properties };
  for (const key of invalidKeys) adjusted[key] = definition.defaultProperties[key];
  const validated = definition.propertiesSchema.parse(adjusted) as Record<string, unknown>;
  const details = [...invalidKeys].map((key) => `${key} ${JSON.stringify(properties[key])}`).join(", ");
  warnings.push(`${definition.label} ${resource.name}: unsupported ${details}; used Bunya defaults for these properties.`);
  return validated;
}

function findReferencedNode(
  ref: unknown,
  resources: ImportedResource[],
  allowed?: ServiceType[],
  // Require the reference to name the resource. Without this, a reference to
  // a resource outside the template can match the only candidate of its type.
  exact = false,
): GraphNode | undefined {
  if (typeof ref !== "string") return undefined;
  const lower = ref.toLowerCase();
  const quotedTokens = [...lower.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const candidates = allowed
    ? resources.filter((r) => allowed.includes(r.node.type))
    : resources;

  const hasQuotedSequence = (parts: string[]) => {
    let cursor = 0;
    for (const part of parts) {
      const next = quotedTokens.findIndex((token, index) => index >= cursor && token === part);
      if (next === -1) return false;
      cursor = next + 1;
    }
    return true;
  };

  const hasPathSequence = (parts: string[]) => {
    let cursor = 0;
    for (const part of parts) {
      const next = lower.indexOf(`/${part}`, cursor);
      if (next === -1) return false;
      cursor = next + part.length + 1;
    }
    return true;
  };

  const scored = candidates
    .map(({ flat, node }) => {
      const full = flat.fullName.toLowerCase();
      const parts = full.split("/").filter(Boolean);
      const name = flat.name.toLowerCase();
      const type = flat.type.toLowerCase();
      let score = 0;
      if (lower.includes(full)) score = Math.max(score, 120 + parts.length);
      if (parts.length > 1 && hasQuotedSequence(parts)) score = Math.max(score, 110 + parts.length);
      if (parts.length > 1 && hasPathSequence(parts)) score = Math.max(score, 100 + parts.length);
      if (lower.includes(`'${name}'`) && lower.includes(type)) score = Math.max(score, 80);
      if (lower.includes(`/${name}`) && lower.includes(type.split("/")[0])) score = Math.max(score, 75);
      if (lower.includes(`accountname=${name}`)) score = Math.max(score, 70);
      if (lower.includes(`'${name}'`) || lower.includes(`/${name}`)) score = Math.max(score, 60);
      if (!exact && candidates.length === 1 && lower.includes(type)) score = Math.max(score, 10);
      return { node, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return undefined;
  if (scored.length > 1 && scored[0].score === scored[1].score) return undefined;
  if (exact) {
    // The name must be a whole token: quoted ('id-pull') or a complete path
    // segment (/id-pull, then end, quote or slash), never a prefix of id-pull-external.
    const winner = candidates.find((candidate) => candidate.node === scored[0].node);
    const name = winner?.flat.name.toLowerCase() ?? "";
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`(^|[/'])${escaped}($|['/,)\\]])`).test(lower)) return undefined;
  }
  return scored[0].node;
}

function nodeSize(node: GraphNode): { width: number; height: number } {
  if (node.size) return node.size;
  if (isContainerType(node.type)) return DEFAULT_CONTAINER_SIZE[node.type];
  return SERVICE_NODE_SIZE;
}

function addEdge(
  edges: GraphEdge[],
  source: GraphNode,
  target: GraphNode | undefined,
  kind: EdgeKind,
): void {
  if (!target || source.id === target.id) return;
  if (edges.some((e) => e.source === source.id && e.target === target.id && e.kind === kind)) return;
  edges.push({
    id: `arm-edge-${edges.length + 1}`,
    source: source.id,
    target: target.id,
    kind,
  });
}

function childResourceText(parent: FlatArmResource, allResources: FlatArmResource[]): string {
  const prefix = `${parent.fullName}/`.toLowerCase();
  return allResources
    .filter((resource) => {
      const fullName = resource.fullName.toLowerCase();
      return (
        resource.parentName === parent.fullName ||
        fullName.startsWith(prefix) ||
        fullName.includes(`/${parent.fullName.toLowerCase()}/`)
      );
    })
    .map((resource) => JSON.stringify(resource.raw))
    .join(" ");
}

function inferFunctionStorageEdge(
  edges: GraphEdge[],
  item: ImportedResource,
  resources: ImportedResource[],
  allResources: FlatArmResource[],
): void {
  const text = `${JSON.stringify(item.flat.raw)} ${childResourceText(item.flat, allResources)}`;
  const storageFromSettings = findReferencedNode(text, resources, ["storageAccount"]);
  addEdge(edges, item.node, storageFromSettings, "data");

  for (const dep of asArray(item.flat.raw.dependsOn)) {
    addEdge(edges, item.node, findReferencedNode(dep, resources, ["storageAccount"]), "data");
  }
}

function inferPrivateDnsEdges(
  edges: GraphEdge[],
  item: ImportedResource,
  resources: ImportedResource[],
  allResources: FlatArmResource[],
): void {
  if (item.node.type === "privateEndpoint") {
    const text = childResourceText(item.flat, allResources);
    addEdge(edges, item.node, findReferencedNode(text, resources, ["privateDnsZone"]), "network");
  }
  if (item.node.type === "privateDnsZone") {
    const text = childResourceText(item.flat, allResources);
    addEdge(edges, item.node, findReferencedNode(text, resources, ["virtualNetwork"]), "network");
  }
}

function inferRoleAssignmentEdges(
  edges: GraphEdge[],
  item: ImportedResource,
  resources: ImportedResource[],
): void {
  if (item.node.type !== "roleAssignment") return;
  const props = asRecord(item.flat.raw.properties);
  const scope = (item.flat.raw as { scope?: unknown }).scope ?? props.scope;
  const scopeNode = findReferencedNode(scope, resources);
  addEdge(edges, item.node, scopeNode, "identity");
  for (const dep of asArray(item.flat.raw.dependsOn)) {
    // dependsOn also lists the scope; that resource is the target, not the
    // principal (treating it as both would form a cycle).
    const principal = findReferencedNode(dep, resources, [
      "appService",
      "functionApp",
      "aksCluster",
      "virtualMachineScaleSet",
      "userAssignedIdentity",
    ]);
    if (principal && principal !== scopeNode) addEdge(edges, principal, item.node, "identity");
  }
}

function inferAlertEdges(
  edges: GraphEdge[],
  item: ImportedResource,
  resources: ImportedResource[],
): void {
  if (item.node.type !== "monitorAlert") return;
  const props = asRecord(item.flat.raw.properties);
  for (const scope of asArray(props.scopes)) {
    addEdge(edges, item.node, findReferencedNode(scope, resources), "diagnostic");
  }
  for (const action of asArray(asRecord(props.actions).actionGroups)) {
    addEdge(edges, item.node, findReferencedNode(asRecord(action).actionGroupId, resources, ["actionGroup"]), "depends_on");
  }
}

function childResources(parent: FlatArmResource, allResources: FlatArmResource[], typeSuffix: string): FlatArmResource[] {
  const type = `${parent.type}/${typeSuffix}`.toLowerCase();
  const prefix = `${parent.fullName}/`.toLowerCase();
  return allResources.filter(
    (resource) => resource.type.toLowerCase() === type && resource.fullName.toLowerCase().startsWith(prefix),
  );
}

// Regional VNet integration: `virtualNetworkSubnetId` on the site, or the
// older `sites/virtualNetworkConnections` child.
function inferSiteSubnetEdge(
  edges: GraphEdge[],
  item: ImportedResource,
  resources: ImportedResource[],
  allResources: FlatArmResource[],
): void {
  const props = asRecord(item.flat.raw.properties);
  const refs = [
    props.virtualNetworkSubnetId,
    ...childResources(item.flat, allResources, "virtualNetworkConnections").map(
      (child) => asRecord(child.raw.properties).vnetResourceId,
    ),
  ];
  for (const ref of refs) {
    const subnet = findReferencedNode(ref, resources, ["subnet"]);
    if (!subnet) continue;
    addEdge(edges, item.node, subnet, "network");
    item.node.properties = { ...item.node.properties, vnetIntegration: true };
  }
}

// Exporters grant these roles from a principal -> scope identity edge, so an
// imported assignment of one of them is drawn as that edge, not as a node.
const EDGE_GRANTED_ROLES: Record<string, ServiceType> = {
  AcrPull: "containerRegistry",
  "Key Vault Secrets User": "keyVault",
  "Storage Blob Data Contributor": "storageAccount",
};

// Replaces principal -> Role Assignment -> scope with principal -> scope when
// the role is exactly the one exporters grant for that edge, so re-importing
// an export does not grant the role twice.
function collapseEdgeGrantedRoles(
  resources: ImportedResource[],
  edges: GraphEdge[],
): { resources: ImportedResource[]; edges: GraphEdge[] } {
  const byId = new Map(resources.map((item) => [item.node.id, item.node]));
  const removed = new Set<string>();
  const extra: GraphEdge[] = [];
  for (const { node } of resources) {
    if (node.type !== "roleAssignment") continue;
    const principals = edges.filter((edge) => edge.target === node.id && edge.kind === "identity").map((edge) => byId.get(edge.source));
    const scopes = edges.filter((edge) => edge.source === node.id && edge.kind === "identity").map((edge) => byId.get(edge.target));
    const scopeType = EDGE_GRANTED_ROLES[String(node.properties.roleDefinitionName)];
    if (principals.length !== 1 || scopes.length !== 1 || !principals[0] || !scopes[0] || scopes[0].type !== scopeType) continue;
    // Only principals whose identity edges the exporters turn into grants
    // (lib/generators/shared/roles.ts); AKS and VMSS keep the explicit node.
    if (!["appService", "functionApp", "userAssignedIdentity"].includes(principals[0].type)) continue;
    removed.add(node.id);
    extra.push({ id: `${node.id}-grant`, source: principals[0].id, target: scopes[0].id, kind: "identity" });
  }
  if (removed.size === 0) return { resources, edges };
  const kept = edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target));
  for (const edge of extra) {
    if (!kept.some((e) => e.source === edge.source && e.target === edge.target && e.kind === "identity")) kept.push(edge);
  }
  return { resources: resources.filter((item) => !removed.has(item.node.id)), edges: kept };
}

// A site pulling from a registry with managed identity needs AcrPull, which
// exporters generate from an identity edge.
function inferRegistryEdge(
  edges: GraphEdge[],
  item: ImportedResource,
  resources: ImportedResource[],
  warnings: string[],
): void {
  const image = parseContainerImage(String(item.node.properties.containerImage ?? ""));
  if (!image) return;
  const host = image.registryHost.toLowerCase();
  const registry = resources.find(
    (candidate) =>
      candidate.node.type === "containerRegistry" &&
      host === `${candidate.flat.name.toLowerCase()}.azurecr.io`,
  )?.node;
  if (!registry) return;
  const siteConfig = asRecord(asRecord(item.flat.raw.properties).siteConfig);
  if (siteConfig.acrUseManagedIdentityCreds !== true) {
    addEdge(edges, item.node, registry, "depends_on");
    warnings.push(`${item.flat.name}: pulls ${image.reference} with registry credentials; turn on managed identity pulls and draw an identity edge to ${registry.resourceName} so exports grant AcrPull.`);
    return;
  }
  const clientId = asString(siteConfig.acrUserManagedIdentityID);
  if (!clientId) {
    addEdge(edges, item.node, registry, "identity");
    return;
  }
  // acrUserManagedIdentityID is the identity's client ID (a GUID, or an
  // expression reading clientId). Match it to an identity attached to the site.
  const attached = Object.keys(asRecord(asRecord(item.flat.raw.identity).userAssignedIdentities))
    .map((ref) => findReferencedNode(ref, resources, ["userAssignedIdentity"], true))
    .filter((node): node is GraphNode => !!node);
  const referenced = findReferencedNode(clientId, resources, ["userAssignedIdentity"], true);
  // Identities attached to the app but defined outside this template.
  const external = Object.keys(asRecord(asRecord(item.flat.raw.identity).userAssignedIdentities)).length - attached.length;
  // A bare client ID can only be pinned to an identity when it is the only
  // one on the app; with external identities it may be any of them.
  const userIdentity = referenced ?? (attached.length === 1 && external === 0 ? attached[0] : undefined);
  if (userIdentity && !referenced) {
    warnings.push(`${item.flat.name}: pulls with user-assigned identity client ID ${clientId}; assumed it is ${userIdentity.resourceName}, the only user-assigned identity on the app.`);
  }
  if (userIdentity) {
    addEdge(edges, item.node, userIdentity, "identity");
    addEdge(edges, userIdentity, registry, "identity");
    return;
  }
  // Never fall back to the system identity: that would grant AcrPull to a
  // different principal than the one Azure uses to pull.
  addEdge(edges, item.node, registry, "depends_on");
  warnings.push(`${item.flat.name}: pulls ${image.reference} with user-assigned identity ${clientId}, which is not in this template; add the identity and draw identity edges app to identity to ${registry.resourceName} so exports grant AcrPull to it.`);
}

const APP_INSIGHTS_SETTINGS = new Set(["applicationinsights_connection_string", "appinsights_instrumentationkey"]);

// Values of the App Insights settings, from siteConfig.appSettings (name/value
// pairs) or a sites/config "appsettings" child (a key/value map).
function appInsightsSettingValues(site: FlatArmResource, allResources: FlatArmResource[]): unknown[] {
  const values: unknown[] = [];
  for (const entry of asArray(asRecord(asRecord(site.raw.properties).siteConfig).appSettings)) {
    const pair = asRecord(entry);
    if (APP_INSIGHTS_SETTINGS.has(String(pair.name ?? "").toLowerCase())) values.push(pair.value);
  }
  for (const child of childResources(site, allResources, "config")) {
    for (const [key, value] of Object.entries(asRecord(child.raw.properties))) {
      if (APP_INSIGHTS_SETTINGS.has(key.toLowerCase())) values.push(value);
    }
  }
  return values;
}

// Portal exports tag App Insights components with a hidden-link to their app;
// app settings may also reference the component directly.
function inferAppInsightsEdges(
  edges: GraphEdge[],
  item: ImportedResource,
  resources: ImportedResource[],
  allResources: FlatArmResource[],
): void {
  if (item.node.type !== "applicationInsights") return;
  const props = asRecord(item.flat.raw.properties);
  addEdge(edges, item.node, findReferencedNode(props.WorkspaceResourceId, resources, ["logAnalytics"]), "depends_on");
  const sites = resources.filter((candidate) => candidate.node.type === "appService" || candidate.node.type === "functionApp");
  for (const tag of Object.keys(asRecord(item.flat.raw.tags))) {
    if (!/^hidden-link:/i.test(tag) || !/\/providers\/microsoft\.web\/sites\//i.test(tag)) continue;
    const name = tag.split("/").filter(Boolean).at(-1)?.toLowerCase();
    const site = sites.find((candidate) => candidate.flat.name.toLowerCase() === name)?.node;
    if (site) addEdge(edges, site, item.node, "diagnostic");
  }
  const components = resources.filter((candidate) => candidate.node.type === "applicationInsights");
  for (const site of sites) {
    for (const value of appInsightsSettingValues(site.flat, allResources)) {
      // The resolver handles resourceId(...) with any whitespace and paths.
      const target = findReferencedNode(value, components, ["applicationInsights"]);
      if (target === item.node) addEdge(edges, site.node, item.node, "diagnostic");
    }
  }
}

function inferEdges(resources: ImportedResource[], allResources: FlatArmResource[], warnings: string[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const item of resources) {
    const { flat, node } = item;
    inferPrivateDnsEdges(edges, item, resources, allResources);
    inferRoleAssignmentEdges(edges, item, resources);
    inferAlertEdges(edges, item, resources);
    inferAppInsightsEdges(edges, item, resources, allResources);
    // A role assignment's dependsOn is deployment ordering for the principal
    // and scope, already drawn as identity edges; a depends_on edge back to
    // the principal would form a cycle.
    if (node.type !== "roleAssignment") {
      for (const dep of asArray(flat.raw.dependsOn)) {
        addEdge(edges, node, findReferencedNode(dep, resources), "depends_on");
      }
    }
    if (node.type === "subnet" && flat.fullName.includes("/")) {
      const parentName = flat.fullName.split("/")[0];
      const vnet = resources.find((r) => r.node.type === "virtualNetwork" && r.flat.fullName === parentName)?.node;
      addEdge(edges, node, vnet, "depends_on");
      const nsgId = asRecord(asRecord(flat.raw.properties).networkSecurityGroup).id;
      addEdge(edges, node, findReferencedNode(nsgId, resources, ["networkSecurityGroup"]), "network");
    }
    if (node.type === "appService" || node.type === "functionApp") {
      const props = asRecord(flat.raw.properties);
      addEdge(edges, node, findReferencedNode(props.serverFarmId, resources, ["appServicePlan"]), "depends_on");
      if (node.type === "functionApp") {
        inferFunctionStorageEdge(edges, item, resources, allResources);
      }
      inferSiteSubnetEdge(edges, item, resources, allResources);
      inferRegistryEdge(edges, item, resources, warnings);
    }
    if (node.type === "aksCluster") {
      const props = asRecord(flat.raw.properties);
      const pool = asRecord(asArray(props.agentPoolProfiles)[0]);
      addEdge(edges, node, findReferencedNode(pool.vnetSubnetID, resources, ["subnet"]), "network");
      const oms = asRecord(asRecord(asRecord(props.addonProfiles).omsagent).config);
      addEdge(
        edges,
        node,
        findReferencedNode(oms.logAnalyticsWorkspaceResourceID, resources, ["logAnalytics"]),
        "diagnostic",
      );
    }
    if (node.type === "virtualMachineScaleSet") {
      if (childResourceText(flat, allResources).toLowerCase().includes("azuremonitorlinuxagent")) {
        node.properties = { ...node.properties, azureMonitorAgent: true };
      }
      const profile = asRecord(asRecord(flat.raw.properties).virtualMachineProfile);
      const network = asRecord(profile.networkProfile);
      const nic = asRecord(asArray(network.networkInterfaceConfigurations)[0]);
      const ip = asRecord(asArray(asRecord(nic.properties).ipConfigurations)[0]);
      const subnetId = asRecord(asRecord(ip.properties).subnet).id;
      addEdge(edges, node, findReferencedNode(subnetId, resources, ["subnet"]), "network");
    }
    if (node.type === "privateEndpoint") {
      const props = asRecord(flat.raw.properties);
      addEdge(edges, node, findReferencedNode(asRecord(props.subnet).id, resources, ["subnet"]), "network");
      const connection = asRecord(asArray(props.privateLinkServiceConnections)[0]);
      const connectionProps = asRecord(connection.properties);
      addEdge(edges, node, findReferencedNode(connectionProps.privateLinkServiceId, resources), "network");
    }
  }
  return edges;
}

function findVirtualNetworkParent(resources: ImportedResource[], item: ImportedResource): GraphNode | undefined {
  const parentName = item.flat.parentName ?? item.flat.fullName.split("/").slice(0, -1).join("/");
  if (!parentName) return undefined;
  return resources.find(
    ({ flat, node }) =>
      node.type === "virtualNetwork" &&
      (flat.fullName.toLowerCase() === parentName.toLowerCase() ||
        flat.name.toLowerCase() === cleanName(parentName, parentName).toLowerCase()),
  )?.node;
}

function layoutChildren(
  children: GraphNode[],
  options: { x: number; y: number; gapX: number; columns: number; rowHeight: number },
): number {
  let maxBottom = options.y;
  children.forEach((child, index) => {
    const column = index % options.columns;
    const row = Math.floor(index / options.columns);
    child.position = {
      x: options.x + column * options.gapX,
      y: options.y + row * options.rowHeight,
    };
    maxBottom = Math.max(maxBottom, child.position.y + nodeSize(child).height);
  });
  return maxBottom;
}

function packRows(
  nodes: GraphNode[],
  startY: number,
  options: { x: number; maxWidth: number; gapX: number; gapY: number },
): number {
  let x = options.x;
  let y = startY;
  let rowHeight = 0;
  let bottom = startY;
  nodes.forEach((node) => {
    const size = nodeSize(node);
    if (x > options.x && x + size.width > options.x + options.maxWidth) {
      x = options.x;
      y += rowHeight + options.gapY;
      rowHeight = 0;
    }
    node.position = { x, y };
    x += size.width + options.gapX;
    rowHeight = Math.max(rowHeight, size.height);
    bottom = Math.max(bottom, y + size.height);
  });
  return nodes.length > 0 ? bottom + options.gapY : startY;
}

function layoutImportedNodes(
  resources: ImportedResource[],
  edges: GraphEdge[],
  resourceGroup: GraphNode,
): GraphNode[] {
  const nodeById = new Map(resources.map(({ node }) => [node.id, node]));
  const parentById = new Map<string, string>();

  for (const item of resources) {
    if (item.node.type === "resourceGroup") continue;
    if (item.node.type === "subnet") {
      const parent = findVirtualNetworkParent(resources, item);
      if (parent) {
        parentById.set(item.node.id, parent.id);
        continue;
      }
    }
    if (item.node.type === "appService" || item.node.type === "functionApp") {
      const plan = edges
        .filter((edge) => edge.source === item.node.id && edge.kind === "depends_on")
        .map((edge) => nodeById.get(edge.target))
        .find((target) => target?.type === "appServicePlan");
      if (plan) {
        parentById.set(item.node.id, plan.id);
        continue;
      }
    }
    parentById.set(item.node.id, resourceGroup.id);
  }

  const childrenByParent = new Map<string, GraphNode[]>();
  for (const item of resources) {
    const parentId = parentById.get(item.node.id);
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(item.node);
    childrenByParent.set(parentId, children);
  }

  for (const item of resources) {
    if (item.node.type !== "virtualNetwork") continue;
    const children = childrenByParent.get(item.node.id) ?? [];
    if (children.length === 0) {
      item.node.size = DEFAULT_CONTAINER_SIZE.virtualNetwork;
      continue;
    }
    const columns = Math.min(3, Math.max(1, children.length));
    const bottom = layoutChildren(children, {
      x: 36,
      y: 58,
      gapX: 250,
      columns,
      rowHeight: 86,
    });
    item.node.size = {
      width: Math.max(DEFAULT_CONTAINER_SIZE.virtualNetwork.width, 72 + columns * 250 - 30),
      height: Math.max(DEFAULT_CONTAINER_SIZE.virtualNetwork.height, bottom + 48),
    };
  }

  for (const item of resources) {
    if (item.node.type !== "appServicePlan") continue;
    const children = childrenByParent.get(item.node.id) ?? [];
    if (children.length === 0) {
      item.node.size = DEFAULT_CONTAINER_SIZE.appServicePlan;
      continue;
    }
    const columns = Math.min(2, Math.max(1, children.length));
    const bottom = layoutChildren(children, {
      x: 36,
      y: 62,
      gapX: 240,
      columns,
      rowHeight: 88,
    });
    item.node.size = {
      width: Math.max(DEFAULT_CONTAINER_SIZE.appServicePlan.width, 72 + columns * 240 - 20),
      height: Math.max(DEFAULT_CONTAINER_SIZE.appServicePlan.height, bottom + 48),
    };
  }

  resourceGroup.position = { x: -40, y: -40 };
  resourceGroup.size = DEFAULT_CONTAINER_SIZE.resourceGroup;

  const topLevel = (childrenByParent.get(resourceGroup.id) ?? []).filter((node) => node.id !== resourceGroup.id);
  const virtualNetworks = topLevel.filter((node) => node.type === "virtualNetwork");
  const plans = topLevel.filter((node) => node.type === "appServicePlan");
  const services = topLevel.filter((node) => node.type !== "virtualNetwork" && node.type !== "appServicePlan");

  let y = 56;
  y = packRows(virtualNetworks, y, { x: 40, maxWidth: 1260, gapX: 36, gapY: 36 });
  y = packRows(plans, y, { x: 40, maxWidth: 1260, gapX: 36, gapY: 36 });
  if (services.length > 0) {
    y = layoutChildren(services, {
      x: 40,
      y,
      gapX: 260,
      columns: 4,
      rowHeight: 96,
    }) + 56;
  }

  let maxRight = DEFAULT_CONTAINER_SIZE.resourceGroup.width;
  let maxBottom = DEFAULT_CONTAINER_SIZE.resourceGroup.height;
  for (const node of topLevel) {
    const size = nodeSize(node);
    maxRight = Math.max(maxRight, node.position.x + size.width + 56);
    maxBottom = Math.max(maxBottom, node.position.y + size.height + 56);
  }
  resourceGroup.size = { width: maxRight, height: Math.max(maxBottom, y) };

  const nodes = resources.map(({ node }) =>
    node.type === "resourceGroup"
      ? node
      : { ...node, parentId: parentById.get(node.id) ?? resourceGroup.id },
  );
  if (!nodes.some((node) => node.id === resourceGroup.id)) nodes.unshift(resourceGroup);
  return nodes;
}

export function parseArmTemplate(text: string): ArmImportResult {
  let parsed: unknown;
  try {
    checkImportText(text);
    parsed = JSON.parse(text);
    checkObjectDepth(parsed);
  } catch (err) {
    return {
      ok: false,
      reason: `ARM template is not valid JSON: ${err instanceof Error ? err.message : String(err)}.`,
    };
  }
  const root = asRecord(parsed);
  const resourcesRaw = asArray(root.resources);
  if (resourcesRaw.length === 0) {
    return { ok: false, reason: "ARM template has no resources array." };
  }
  const parameters = asRecord(root.parameters);
  const variables = asRecord(root.variables);
  const warnings: string[] = [];
  const flat = flattenResources(resourcesRaw, parameters, variables, warnings);
  const known = flat
    .map((resource, index) => {
      const type = serviceTypeFor(resource);
      if (!type) return null;
      const def = getServiceDefinition(type);
      const armName = cleanName(resource.name, `${type}-${index + 1}`);
      const resourceName = safeResourceName(armName, `${type}-${index + 1}`);
      if (resourceName !== armName) {
        warnings.push(`${def.label}: renamed "${armName}" to "${resourceName}" because exports allow only letters, numbers, dots, underscores and hyphens; check the name before deploying.`);
      }
      const node: GraphNode = {
        id: `arm-node-${index + 1}`,
        type,
        name: def.label,
        resourceName,
        // Names that exports suffix for global uniqueness are already unique
        // Azure names here; keep them unless the import had to rename them.
        ...(resourceName === armName && (type === "storageAccount" || type === "keyVault") ? { exactName: true } : {}),
        position: { x: 0, y: 0 },
        properties: validatedProperties(type, resource, baseProperties(type, resource, flat, parameters, variables, warnings), warnings),
      };
      return { flat: resource, node };
    })
    .filter((v): v is ImportedResource => v !== null);

  if (known.length === 0) {
    return { ok: false, reason: "ARM template did not contain any Bunya-supported Azure resource types." };
  }

  let resourceGroup = known.find((r) => r.node.type === "resourceGroup")?.node;
  if (!resourceGroup) {
    resourceGroup = {
      id: "arm-node-rg",
      type: "resourceGroup",
      name: "Resource Group",
      resourceName: "rg-imported-template",
      position: { x: -40, y: -40 },
      size: { width: 980, height: 620 },
      properties: { ...getServiceDefinition("resourceGroup").defaultProperties },
    };
  }

  for (const resource of flat) resource.raw = expandReferences(resource.raw, parameters, variables) as ArmResource;
  const inferred = inferEdges(known, flat, warnings);
  const { resources: kept, edges } = collapseEdgeGrantedRoles(known, inferred);
  const nodes = layoutImportedNodes(kept, edges, resourceGroup);
  if (nodes.length > 200 || edges.length > 1000) {
    return { ok: false, reason: `ARM template produces ${nodes.length} nodes and ${edges.length} edges; Bunya supports up to 200 nodes and 1,000 edges.` };
  }

  // Portal exports write regions as display names, e.g. "Australia East".
  // expandReferences has already turned [parameters('location')] into
  // ['australiaeast']; strip the expression wrapper and quotes.
  const locations = known
    .map((r) => resolveString(r.flat.raw.location, parameters, variables)?.toLowerCase().replace(/^\[\s*'(.*)'\s*\]$/, "$1").replace(/\s+/g, ""))
    .filter((value): value is string => !!value && value !== "global");
  const location = locations.find((value) => AZURE_REGIONS.includes(value as never));
  const otherLocations = [...new Set(locations.filter((value) => value !== location))];
  if (otherLocations.length > 0) {
    warnings.push(`Resources in ${otherLocations.join(", ")} are drawn in the diagram region ${location ?? "australiaeast"}.`);
  }
  const now = new Date().toISOString();
  const draft = { nodes, edges } as unknown as GraphDocument;
  for (const node of nodes) {
    if (node.type !== "functionApp") continue;
    const family = planFamily(sitePlan(draft, node)?.properties.sku);
    node.properties = { ...node.properties, consumptionPlan: family === "consumption" || family === "flex" };
  }
  const document: GraphDocument = {
    schemaVersion: 1,
    metadata: {
      name: "imported-arm-template",
      description: "Imported from Azure Export Template ARM JSON.",
      createdAt: now,
      updatedAt: now,
      region: (location as GraphDocument["metadata"]["region"]) ?? "australiaeast",
      environment: "dev",
      resourceGroupName: resourceGroup.resourceName,
    },
    nodes,
    edges,
  };
  if (known.some((r) => r.node.exactName)) {
    warnings.push("Storage Account and Key Vault names are kept exactly, so exports update the same resources; rename them in the inspector to deploy a separate copy.");
  }
  const importedTypes = new Set(known.map((r) => r.flat.type.toLowerCase()));
  const skippedCounts = new Map<string, number>();
  for (const resource of flat) {
    if (known.some((r) => r.flat === resource)) continue;
    skippedCounts.set(resource.type, (skippedCounts.get(resource.type) ?? 0) + 1);
  }
  const skipped = [...skippedCounts.values()].reduce((sum, count) => sum + count, 0);
  // Child settings (site config, host name bindings) belong to imported resources.
  const isChildSetting = (type: string) =>
    [...importedTypes].some((parent) => type.toLowerCase().startsWith(`${parent}/`));
  const describe = (entries: [string, number][]) =>
    entries.sort((a, b) => b[1] - a[1]).map(([type, count]) => `${type} x${count}`).join(", ");
  const childEntries = [...skippedCounts].filter(([type]) => isChildSetting(type));
  const otherEntries = [...skippedCounts].filter(([type]) => !isChildSetting(type));
  const skippedNotes = [
    childEntries.length > 0 ? `Skipped child settings of imported resources: ${describe(childEntries)}.` : "",
    otherEntries.length > 0 ? `Skipped resource types Bunya does not model: ${describe(otherEntries)}.` : "",
  ];
  return {
    ok: true,
    document,
    warning: [skipped > 0 ? `${skipped} unsupported ARM resources were skipped.` : "", ...skippedNotes, ...warnings].filter(Boolean).join("\n") || undefined,
  };
}
