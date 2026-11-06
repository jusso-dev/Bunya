import { describe, expect, it } from "vitest";
import { hostingGraph } from "./__fixtures__/hosting";
import { generateArm } from "./arm";
import { generateAzCli } from "./azcli";
import { generateBicep } from "./bicep";
import { generatePowerShell } from "./powershell";
import { generateTerraform } from "./terraform";
import { topologyProblems } from "@/lib/graph/topology";
import { runRules } from "@/lib/rules/runtime";
import type { GeneratorResult } from "./types";

function file(result: GeneratorResult, path: string): string {
  if (!result.ok) throw new Error(result.reason);
  const found = result.files.find((candidate) => candidate.path === path);
  if (!found) throw new Error(`missing ${path}`);
  return found.content;
}

// Parsed template JSON; tests read nested fields directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Arm = { type: string; name: string; kind?: string; sku?: Record<string, unknown>; properties?: Json; identity?: Json; dependsOn?: string[] };

function armResources(): Arm[] {
  return JSON.parse(file(generateArm(hostingGraph), "azuredeploy.json")).resources as Arm[];
}

const site = (name: string) => armResources().find((r) => r.type === "Microsoft.Web/sites" && r.name === name)!;
const settings = (resource: Arm) => (resource.properties?.siteConfig?.appSettings ?? []).map((s: { name: string }) => s.name) as string[];

describe("App Service hosting exports", () => {
  it("is a deployable diagram", () => {
    expect(topologyProblems(hostingGraph)).toEqual([]);
  });

  describe("ARM and Bicep", () => {
    it("emits plan SKUs, tiers and kinds per family", () => {
      const plans = Object.fromEntries(armResources().filter((r) => r.type === "Microsoft.Web/serverfarms").map((r) => [r.name, r]));
      expect(plans["plan-flex"]).toMatchObject({ kind: "functionapp", sku: { name: "FC1", tier: "FlexConsumption" } });
      expect(plans["plan-flex"].sku).not.toHaveProperty("capacity");
      expect(plans["plan-y1"]).toMatchObject({ kind: "functionapp", sku: { name: "Y1", tier: "Dynamic" } });
      expect(plans["plan-ep"]).toMatchObject({ kind: "elastic", sku: { name: "EP1", tier: "ElasticPremium", capacity: 1 }, properties: { reserved: true, maximumElasticWorkerCount: 20 } });
      expect(plans["plan-web"]).toMatchObject({ kind: "linux", sku: { name: "P0v3", tier: "Premium0V3", capacity: 2 } });
    });

    it("configures Flex through functionAppConfig without the settings Flex rejects", () => {
      const flex = site("fn-flex");
      expect(flex.properties?.functionAppConfig).toMatchObject({
        deployment: { storage: { type: "blobContainer", authentication: { type: "StorageAccountConnectionString", storageAccountConnectionStringName: "DEPLOYMENT_STORAGE_CONNECTION_STRING" } } },
        scaleAndConcurrency: { instanceMemoryMB: 4096, maximumInstanceCount: 40 },
        runtime: { name: "python", version: "3.11" },
      });
      expect(flex.properties?.siteConfig).not.toHaveProperty("linuxFxVersion");
      expect(settings(flex)).not.toContain("FUNCTIONS_WORKER_RUNTIME");
      expect(settings(flex)).not.toContain("FUNCTIONS_EXTENSION_VERSION");
      expect(settings(flex)).toEqual(expect.arrayContaining(["AzureWebJobsStorage", "DEPLOYMENT_STORAGE_CONNECTION_STRING", "APPLICATIONINSIGHTS_CONNECTION_STRING"]));
      expect(flex.properties?.virtualNetworkSubnetId).toContain("'snet-flex'");
      const container = armResources().find((r) => r.type === "Microsoft.Storage/storageAccounts/blobServices/containers");
      expect(container?.name).toMatch(/\/default\/app-package-fn-flex$/);
      expect(flex.dependsOn?.some((dep) => dep.includes("blobServices/containers"))).toBe(true);
    });

    it("adds content share settings for Consumption and Elastic Premium only", () => {
      expect(settings(site("fn-y1"))).toEqual(expect.arrayContaining(["WEBSITE_CONTENTAZUREFILECONNECTIONSTRING", "WEBSITE_CONTENTSHARE", "FUNCTIONS_WORKER_RUNTIME"]));
      expect(settings(site("fn-ep"))).toContain("WEBSITE_CONTENTSHARE");
      expect(settings(site("fn-flex"))).not.toContain("WEBSITE_CONTENTSHARE");
    });

    it("runs container images and pulls them with managed identity", () => {
      const web = site("app-hosting");
      expect(web.kind).toBe("app,linux,container");
      expect(web.properties?.siteConfig).toMatchObject({ linuxFxVersion: "DOCKER|acrhosting.azurecr.io/api:1.4", acrUseManagedIdentityCreds: true });
      const worker = site("fn-ep");
      expect(worker.kind).toBe("functionapp,linux,container");
      expect(worker.properties?.siteConfig.linuxFxVersion).toBe("DOCKER|acrhosting.azurecr.io/worker:2.0");
      expect(worker.properties?.siteConfig.acrUserManagedIdentityID).toContain("'id-pull'");
      expect(worker.identity?.type).toBe("SystemAssigned, UserAssigned");
      expect(Object.keys(worker.identity?.userAssignedIdentities ?? {})[0]).toContain("Microsoft.ManagedIdentity/userAssignedIdentities");
      expect(settings(worker)).not.toContain("FUNCTIONS_WORKER_RUNTIME");
    });

    it("grants AcrPull to the identity that pulls the image", () => {
      const pulls = armResources().filter((r) => r.type === "Microsoft.Authorization/roleAssignments" && String(r.properties?.roleDefinitionId).includes("7f951dda-4ed3-4680-a7ca-43fe172d538d"));
      const principals = pulls.map((r) => String(r.properties?.principalId));
      expect(principals.some((p) => p.includes("'app-hosting'"))).toBe(true);
      expect(principals.some((p) => p.includes("'id-pull'"))).toBe(true);

      const bicep = file(generateBicep(hostingGraph), "main.bicep");
      expect(bicep.match(/7f951dda-4ed3-4680-a7ca-43fe172d538d/g)).toHaveLength(2);
    });

    it("delegates integration subnets to the right service", () => {
      const subnets = Object.fromEntries(armResources().filter((r) => r.type === "Microsoft.Network/virtualNetworks/subnets").map((r) => [r.name.split("/")[1], r.properties?.delegations]));
      expect(subnets["snet-flex"]).toEqual([{ name: "environments", properties: { serviceName: "Microsoft.App/environments" } }]);
      expect(subnets["snet-web"]).toEqual([{ name: "serverFarms", properties: { serviceName: "Microsoft.Web/serverFarms" } }]);
      const bicep = file(generateBicep(hostingGraph), "main.bicep");
      expect(bicep).toContain("serviceName: 'Microsoft.App/environments'");
      expect(bicep).toContain("serviceName: 'Microsoft.Web/serverFarms'");
    });
  });

  describe("Terraform", () => {
    const main = () => file(generateTerraform(hostingGraph), "main.tf");

    it("uses the Flex resource with a deployment container", () => {
      expect(main()).toContain('resource "azurerm_function_app_flex_consumption" "fn_flex"');
      expect(main()).toContain('resource "azurerm_storage_container" "fn_flex_deployment"');
      expect(main()).toMatch(/runtime_name\s+= "python"/);
      expect(main()).toMatch(/instance_memory_in_mb\s+= 4096/);
      expect(main()).toMatch(/maximum_instance_count\s+= 40/);
      expect(main()).toContain("virtual_network_subnet_id     = azurerm_subnet.snet_flex.id");
    });

    it("runs containers on web and function apps", () => {
      expect(main()).toContain('docker_image_name   = "api:1.4"');
      expect(main()).toContain('docker_registry_url = "https://acrhosting.azurecr.io"');
      expect(main()).toContain('image_name   = "worker"');
      expect(main()).toContain("container_registry_managed_identity_client_id = azurerm_user_assigned_identity.id_pull.client_id");
    });

    it("grants AcrPull and delegates subnets", () => {
      expect(main()).toContain('role_definition_name = "AcrPull"');
      expect(main()).toContain("principal_id         = azurerm_user_assigned_identity.id_pull.principal_id");
      expect(main()).toContain("principal_id         = azurerm_linux_web_app.app_hosting.identity[0].principal_id");
      expect(main()).toContain('name    = "Microsoft.App/environments"');
      expect(main()).toContain('name    = "Microsoft.Web/serverFarms"');
    });

    it("leaves worker_count off serverless plans", () => {
      const plan = (ident: string) => main().split(`resource "azurerm_service_plan" "${ident}"`)[1].split("\n}")[0];
      expect(plan("plan_flex")).not.toContain("worker_count");
      expect(plan("plan_y1")).not.toContain("worker_count");
      expect(plan("plan_web")).toContain("worker_count        = 2");
    });
  });

  it("shell exports deploy the ARM template in one step", () => {
    for (const result of [generateAzCli(hostingGraph), generatePowerShell(hostingGraph)]) {
      if (!result.ok) throw new Error(result.reason);
      expect(result.files.map((f) => f.path)).toContain("azuredeploy.json");
      expect(result.files[0].content).toContain('App Service Plan "plan-flex" uses FC1');
    }
  });

  describe("council review regressions", () => {
    const without = (edgeId: string) => ({ ...hostingGraph, edges: hostingGraph.edges.filter((edge) => edge.id !== edgeId) });
    const withProps = (nodeId: string, properties: Record<string, unknown>) => ({
      ...hostingGraph,
      nodes: hostingGraph.nodes.map((node) => (node.id === nodeId ? { ...node, properties: { ...node.properties, ...properties } } : node)),
    });

    it("blocks a registry image that has no pull identity", () => {
      for (const generate of [generateTerraform, generateBicep, generateArm]) {
        const result = generate(without("web-acr"));
        expect(result.ok ? "ok" : result.reason).toContain('"app-hosting" pulls its image from Container Registry "acrhosting" without a managed identity');
      }
    });

    it("orders a user-assigned pull after its AcrPull grant", () => {
      const worker = site("fn-ep");
      expect(worker.dependsOn?.some((dep) => dep.includes("Microsoft.Authorization/roleAssignments") && dep.includes("'id-pull', 'AcrPull'"))).toBe(true);
      const grants = armResources().filter((r) => r.type === "Microsoft.Authorization/roleAssignments");
      const name = grants.find((r) => String(r.properties?.principalId).includes("'id-pull'"))?.name;
      expect(name).toContain("'id-pull', 'AcrPull'");

      const main = file(generateTerraform(hostingGraph), "main.tf");
      const fnEp = main.split('resource "azurerm_linux_function_app" "fn_ep"')[1].split("\n}")[0];
      expect(fnEp).toContain("depends_on = [azurerm_role_assignment.id_pull_acrhosting_acrpull]");
      expect(main).toContain('resource "azurerm_role_assignment" "id_pull_acrhosting_acrpull"');

      const bicep = file(generateBicep(hostingGraph), "main.bicep");
      const ref = bicep.match(/resource (\S+_acrpull) 'Microsoft.Authorization\/roleAssignments/g) ?? [];
      expect(ref.length).toBe(2);
      expect(bicep).toMatch(/dependsOn: \[\n\s+node_\d+_id_pull_resource_node_\d+_acrhosting_resource_acrpull\n/);
    });

    it("grants the same roles in ARM, Bicep and Terraform", () => {
      const arm = armResources().filter((r) => r.type === "Microsoft.Authorization/roleAssignments");
      expect(arm.some((r) => String(r.name).includes("'Reader'"))).toBe(false);
      expect(arm).toHaveLength(2);
      expect(file(generateBicep(hostingGraph), "main.bicep").match(/Microsoft.Authorization\/roleAssignments@/g)).toHaveLength(2);
      expect(file(generateTerraform(hostingGraph), "main.tf").match(/resource "azurerm_role_assignment"/g)).toHaveLength(2);
    });

    it("requires a drawn storage account for Flex deployment packages", () => {
      const result = generateArm(without("flex-stg"));
      expect(result.ok ? "ok" : result.reason).toContain('"fn-flex" runs on Flex Consumption, which deploys packages from a storage account');
    });

    it("only allows Flex runtime versions Azure supports", () => {
      const result = generateBicep(withProps("fn-flex", { runtimeVersion: "3.9" }));
      expect(result.ok ? "ok" : result.reason).toContain("uses python 3.9, which Flex Consumption does not run; use python 3.10, 3.11, 3.12, 3.13, 3.14");
      // Aliases are accepted and exported in the form Flex expects.
      const dotnet = withProps("fn-flex", { runtime: "dotnet", runtimeVersion: "8" });
      const arm = JSON.parse(file(generateArm(dotnet), "azuredeploy.json")).resources.find((r: Arm) => r.name === "fn-flex");
      expect(arm.properties.functionAppConfig.runtime).toEqual({ name: "dotnet-isolated", version: "8.0" });
      expect(file(generateBicep(dotnet), "main.bicep")).toContain("version: '8.0'");
      const node = withProps("fn-flex", { runtime: "node", runtimeVersion: "22-lts" });
      expect(file(generateTerraform(node), "main.tf")).toMatch(/runtime_version\s+= "22"\n/);
    });
  });

  it("warns about first pulls with a system-assigned identity, not a user-assigned one", () => {
    const findings = runRules(hostingGraph).filter((finding) => finding.ruleId === "BUNYA.IDN.PULL-SYSTEM-IDENTITY-FIRST-DEPLOY");
    const ids = findings.flatMap((finding) => finding.nodeIds ?? []);
    expect(ids).toContain("web");
    expect(ids).not.toContain("fn-ep");
    const linuxConsumption = runRules(hostingGraph).filter((finding) => finding.ruleId === "BUNYA.COST.PLAN-LINUX-CONSUMPTION-RETIRING");
    expect(linuxConsumption.flatMap((finding) => finding.nodeIds ?? [])).toEqual(["plan-y1"]);
  });

  describe("storage reachability", () => {
    const withStorage = (properties: Record<string, unknown>) => ({
      ...hostingGraph,
      nodes: hostingGraph.nodes.map((node) => (node.id === "stg" ? { ...node, properties: { ...node.properties, ...properties } } : node)),
    });

    it("blocks Function Apps whose storage has no public endpoint and no private path", () => {
      const result = generateArm(withStorage({ publicNetworkAccess: false }));
      expect(result.ok ? "ok" : result.reason).toContain('"fn-y1" cannot reach Storage Account "sthosting"');
    });

    it("accepts a private account reached through VNet integration and a blob Private Endpoint", () => {
      const flexStorage = armResources().find((r) => r.type === "Microsoft.Storage/storageAccounts" && r.name.startsWith("stflexpriv"));
      expect(flexStorage?.properties).toMatchObject({ publicNetworkAccess: "Disabled", allowBlobPublicAccess: false });
      const without = { ...hostingGraph, edges: hostingGraph.edges.filter((edge) => edge.id !== "pe-stg") };
      const result = generateArm(without);
      expect(result.ok ? "ok" : result.reason).toContain('"fn-flex" cannot reach Storage Account "stflexpriv"');
    });

    it("keeps anonymous blob access off when the public endpoint is open", () => {
      const shared = armResources().find((r) => r.type === "Microsoft.Storage/storageAccounts" && r.name.startsWith("sthosting"));
      expect(shared?.properties).toMatchObject({ publicNetworkAccess: "Enabled", allowBlobPublicAccess: false });
      expect(file(generateTerraform(hostingGraph), "main.tf")).toMatch(/allow_nested_items_to_be_public = false\n\s+public_network_access_enabled\s+= true/);
    });
  });

  describe("secured storage for Elastic Premium", () => {
    // fn-ep moves onto a private storage account reached through the VNet.
    const secured = (groupIds: string[]) => ({
      ...hostingGraph,
      nodes: [
        ...hostingGraph.nodes.map((node) => (node.id === "fn-ep" ? { ...node, properties: { ...node.properties, vnetIntegration: true } } : node)),
        { ...hostingGraph.nodes.find((node) => node.id === "stg-flex")!, id: "stg-ep", resourceName: "stepprivate" },
        { ...hostingGraph.nodes.find((node) => node.id === "snet-web")!, id: "snet-ep", resourceName: "snet-ep", properties: { ...hostingGraph.nodes.find((node) => node.id === "snet-web")!.properties, addressPrefix: "10.20.4.0/24" } },
        ...groupIds.map((groupId) => ({ ...hostingGraph.nodes.find((node) => node.id === "pe-blob")!, id: `pe-ep-${groupId}`, resourceName: `pe-ep-${groupId}`, properties: { groupId, manualApproval: false } })),
      ],
      edges: [
        ...hostingGraph.edges.filter((edge) => edge.id !== "ep-stg"),
        { id: "ep-stg", source: "fn-ep", target: "stg-ep", kind: "data" as const },
        { id: "ep-snet", source: "fn-ep", target: "snet-ep", kind: "network" as const },
        ...groupIds.flatMap((groupId) => [
          { id: `pe-ep-${groupId}-snet`, source: `pe-ep-${groupId}`, target: "snet-pe", kind: "network" as const },
          { id: `pe-ep-${groupId}-stg`, source: `pe-ep-${groupId}`, target: "stg-ep", kind: "network" as const },
        ]),
      ],
    });

    it("requires file, blob and table Private Endpoints", () => {
      const result = generateArm(secured(["blob"]));
      expect(result.ok ? "ok" : result.reason).toContain('"fn-ep" cannot reach Storage Account "stepprivate": its public network access is off, so add file, table Private Endpoints');
      expect(result.ok ? "" : result.reason).toContain("Durable Functions also need a queue Private Endpoint");
    });

    it("creates the content share and reaches it over the VNet", () => {
      const graph = secured(["blob", "file", "table"]);
      const resources = JSON.parse(file(generateArm(graph), "azuredeploy.json")).resources as Arm[];
      const worker = resources.find((r) => r.type === "Microsoft.Web/sites" && r.name === "fn-ep")!;
      expect(worker.properties.vnetContentShareEnabled).toBe(true);
      const share = resources.find((r) => r.type === "Microsoft.Storage/storageAccounts/fileServices/shares");
      expect(share?.name).toMatch(/^stepprivate.*\/default\/fn-ep$/);
      expect(worker.dependsOn?.some((dep) => dep.includes("fileServices/shares"))).toBe(true);
      const contentShare = worker.properties.siteConfig.appSettings.find((s: { name: string }) => s.name === "WEBSITE_CONTENTSHARE");
      expect(contentShare.value).toBe("fn-ep");

      const bicep = file(generateBicep(graph), "main.bicep");
      expect(bicep).toContain("vnetContentShareEnabled: true");
      expect(bicep).toMatch(/_contentshare 'Microsoft.Storage\/storageAccounts\/fileServices\/shares@2023-05-01'/);

      const main = file(generateTerraform(graph), "main.tf");
      expect(main).toContain('resource "azurerm_storage_share" "fn_ep_content"');
      expect(main).toContain('WEBSITE_CONTENTOVERVNET = "1"');
      expect(main).toContain("WEBSITE_CONTENTSHARE    = azurerm_storage_share.fn_ep_content.name");
    });

    it("leaves public storage on the default content share", () => {
      const worker = site("fn-ep");
      expect(worker.properties).not.toHaveProperty("vnetContentShareEnabled");
      expect(armResources().some((r) => r.type === "Microsoft.Storage/storageAccounts/fileServices/shares")).toBe(false);
    });
  });
});
