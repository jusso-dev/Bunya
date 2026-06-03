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

function flattenResources(
  resources: unknown[],
  parameters: Record<string, unknown>,
  variables: Record<string, unknown>,
  parent?: FlatArmResource,
): FlatArmResource[] {
  const out: FlatArmResource[] = [];
  resources.forEach((value, index) => {
    const raw = asRecord(value) as ArmResource;
    const rawType = resolveString(raw.type, parameters, variables);
    const rawName = resolveString(raw.name, parameters, variables);
    if (!rawType || !rawName) return;
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
      ...flattenResources(asArray(raw.resources), parameters, variables, flat),
    );
  });
  return out;
}

function serviceTypeFor(resource: FlatArmResource): ServiceType | null {
  const lower = resource.type.toLowerCase();
  if (lower === "microsoft.web/sites") {
    const kind = asString(resource.raw.kind)?.toLowerCase() ?? "";
    return kind.includes("functionapp") ? "functionApp" : "appService";
  }
  return serviceTypeOf(resource.type);
}

function baseProperties(type: ServiceType, resource: FlatArmResource): Record<string, unknown> {
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
      return { ...defaults, addressSpace: prefixes[0] ?? defaults.addressSpace };
    }
    case "subnet":
      return {
        ...defaults,
        addressPrefix: asString(props.addressPrefix) ?? defaults.addressPrefix,
        privateEndpointNetworkPolicies:
          asString(props.privateEndpointNetworkPolicies) ?? defaults.privateEndpointNetworkPolicies,
      };
    case "appServicePlan":
      return {
        ...defaults,
        sku: asString(sku.name) ?? defaults.sku,
        os: asString(resource.raw.kind)?.toLowerCase().includes("linux") ? "Linux" : defaults.os,
        capacity: asNumber(sku.capacity) ?? defaults.capacity,
      };
    case "appService":
      return {
        ...defaults,
        httpsOnly: props.httpsOnly !== false,
        alwaysOn: asRecord(props.siteConfig).alwaysOn !== false,
        publicNetworkAccess: asString(props.publicNetworkAccess) !== "Disabled",
      };
    case "functionApp":
      return {
        ...defaults,
        httpsOnly: props.httpsOnly !== false,
        publicNetworkAccess: asString(props.publicNetworkAccess) !== "Disabled",
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
        minTlsVersion: asString(props.minimumTlsVersion)?.replace("TLS1_", "1.") ?? defaults.minTlsVersion,
      };
    case "keyVault":
      return {
        ...defaults,
        sku: asString(asRecord(props.sku).name) ?? defaults.sku,
        purgeProtection: props.enablePurgeProtection !== false,
        rbacAuthorization: props.enableRbacAuthorization !== false,
        publicNetworkAccess: asString(props.publicNetworkAccess) !== "Disabled",
      };
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
        scope: asString((resource.raw as { scope?: unknown }).scope) ?? defaults.scope,
      };
    }
    case "frontDoor":
    case "applicationGateway":
    case "apiManagement":
    case "containerRegistry":
    case "cosmosDb":
    case "sqlDatabase":
    case "networkSecurityGroup":
    case "privateEndpoint":
    case "userAssignedIdentity":
    default:
      return defaults;
  }
}

function findReferencedNode(
  ref: unknown,
  resources: ImportedResource[],
  allowed?: ServiceType[],
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
      const name = node.resourceName.toLowerCase();
      const type = flat.type.toLowerCase();
      let score = 0;
      if (lower.includes(full)) score = Math.max(score, 120 + parts.length);
      if (parts.length > 1 && hasQuotedSequence(parts)) score = Math.max(score, 110 + parts.length);
      if (parts.length > 1 && hasPathSequence(parts)) score = Math.max(score, 100 + parts.length);
      if (lower.includes(`'${name}'`) && lower.includes(type)) score = Math.max(score, 80);
      if (lower.includes(`/${name}`) && lower.includes(type.split("/")[0])) score = Math.max(score, 75);
      if (lower.includes(`accountname=${name}`)) score = Math.max(score, 70);
      if (lower.includes(`'${name}'`) || lower.includes(`/${name}`)) score = Math.max(score, 60);
      if (candidates.length === 1 && lower.includes(type)) score = Math.max(score, 10);
      return { node, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return undefined;
  if (scored.length > 1 && scored[0].score === scored[1].score) return undefined;
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
  addEdge(edges, item.node, findReferencedNode(scope, resources), "identity");
  for (const dep of asArray(item.flat.raw.dependsOn)) {
    const principal = findReferencedNode(dep, resources, [
      "appService",
      "functionApp",
      "aksCluster",
      "virtualMachineScaleSet",
      "userAssignedIdentity",
    ]);
    if (principal) addEdge(edges, principal, item.node, "identity");
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

function inferEdges(resources: ImportedResource[], allResources: FlatArmResource[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const item of resources) {
    const { flat, node } = item;
    inferPrivateDnsEdges(edges, item, resources, allResources);
    inferRoleAssignmentEdges(edges, item, resources);
    inferAlertEdges(edges, item, resources);
    for (const dep of asArray(flat.raw.dependsOn)) {
      addEdge(edges, node, findReferencedNode(dep, resources), "depends_on");
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
        node.resourceName.toLowerCase() === cleanName(parentName, parentName).toLowerCase()),
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
      const planId = edges.find((edge) => edge.source === item.node.id && edge.kind === "depends_on")?.target;
      const plan = planId ? nodeById.get(planId) : undefined;
      if (plan?.type === "appServicePlan") {
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
    parsed = JSON.parse(text);
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
  const flat = flattenResources(resourcesRaw, parameters, variables);
  const known = flat
    .map((resource, index) => {
      const type = serviceTypeFor(resource);
      if (!type) return null;
      const def = getServiceDefinition(type);
      const node: GraphNode = {
        id: `arm-node-${index + 1}`,
        type,
        name: def.label,
        resourceName: cleanName(resource.name, `${type}-${index + 1}`),
        position: { x: 0, y: 0 },
        properties: baseProperties(type, resource),
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

  const edges = inferEdges(known, flat);
  const nodes = layoutImportedNodes(known, edges, resourceGroup);

  const location = known
    .map((r) => asString(r.flat.raw.location))
    .find((value): value is string => !!value && AZURE_REGIONS.includes(value as never));
  const now = new Date().toISOString();
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
  const skipped = flat.length - known.length;
  return {
    ok: true,
    document,
    warning: skipped > 0 ? `${skipped} unsupported ARM resources were skipped.` : undefined,
  };
}
