import { describe, expect, it } from "vitest";
import { getServiceDefinition } from "@/lib/catalogue/services";
import type { GraphDocument, GraphEdge, GraphNode, ServiceType } from "@/lib/graph/schema";
import {
  buildOrganisationRulesEnvelope,
  parseOrganisationRulesText,
  runOrganisationRules,
  translateAzurePolicy,
  type OrganisationRule,
} from "./organisation";

function testNode(id: string, type: ServiceType, overrides: Record<string, unknown> = {}): GraphNode {
  const def = getServiceDefinition(type);
  return {
    id,
    type,
    name: def.label,
    resourceName: id,
    position: { x: 0, y: 0 },
    properties: { ...def.defaultProperties, ...overrides },
  };
}

function graphFixture(nodes: GraphNode[], edges: GraphEdge[] = []): GraphDocument {
  return {
    schemaVersion: 1,
    metadata: {
      name: "organisation-rule-fixture",
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      region: "australiaeast",
      environment: "prod",
      resourceGroupName: "rg-organisation-rule-fixture",
    },
    nodes,
    edges,
  };
}

describe("organisation rule engine", () => {
  it("flags resources that match a custom property violation", () => {
    const graph = graphFixture([
      testNode("app", "appService", { publicNetworkAccess: true }),
      testNode("fn", "functionApp", { publicNetworkAccess: false }),
    ]);
    const rule: OrganisationRule = {
      id: "ORG.NO.PUBLIC.INGRESS",
      name: "No public ingress",
      description: "Public ingress is not allowed.",
      severity: "error",
      enabled: true,
      serviceTypes: ["appService", "functionApp"],
      property: { key: "publicNetworkAccess", operator: "equals", value: true },
      message: "Public ingress is not allowed.",
    };

    const findings = runOrganisationRules(graph, [rule]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.nodeIds).toEqual(["app"]);
  });

  it("flags missing required relationships and clears when the edge exists", () => {
    const vmss = testNode("vmss", "virtualMachineScaleSet");
    const workspace = testNode("log", "logAnalytics");
    const rule: OrganisationRule = {
      id: "ORG.VMSS.DIAGNOSTICS",
      name: "VMSS diagnostics",
      description: "VMSS must send diagnostics to Log Analytics.",
      severity: "warning",
      enabled: true,
      serviceTypes: ["virtualMachineScaleSet"],
      edge: {
        direction: "outgoing",
        kind: "diagnostic",
        targetType: "logAnalytics",
        mode: "must_exist",
      },
      message: "VMSS must send diagnostics to Log Analytics.",
    };

    expect(runOrganisationRules(graphFixture([vmss, workspace]), [rule])).toHaveLength(1);
    expect(
      runOrganisationRules(
        graphFixture([vmss, workspace], [{ id: "edge-1", source: "vmss", target: "log", kind: "diagnostic" }]),
        [rule],
      ),
    ).toHaveLength(0);
  });

  it("round-trips exported Bunya organisation rules", () => {
    const envelope = buildOrganisationRulesEnvelope([
      {
        id: "ORG.STORAGE.NO.PUBLIC.BLOBS",
        name: "No public blobs",
        description: "Anonymous blob access is not allowed.",
        severity: "error",
        enabled: true,
        serviceTypes: ["storageAccount"],
        property: { key: "allowPublicAccess", operator: "equals", value: true },
        message: "Anonymous blob access is not allowed.",
      },
    ]);

    const parsed = parseOrganisationRulesText(JSON.stringify(envelope));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.rules[0]?.id).toBe("ORG.STORAGE.NO.PUBLIC.BLOBS");
  });

  it("translates Azure Policy publicNetworkAccess checks into custom rules", () => {
    const policy = {
      name: "deny-public-web",
      properties: {
        displayName: "Deny public App Service ingress",
        description: "App Services must disable public network access.",
        policyRule: {
          if: {
            allOf: [
              { field: "type", equals: "Microsoft.Web/sites" },
              { field: "Microsoft.Web/sites/publicNetworkAccess", notEquals: "Disabled" },
            ],
          },
          then: { effect: "deny" },
        },
      },
    };

    const [rule] = translateAzurePolicy(policy);

    expect(rule?.serviceTypes).toEqual(["appService"]);
    expect(rule?.property).toMatchObject({
      key: "publicNetworkAccess",
      operator: "not_equals",
      value: "Disabled",
    });
    expect(runOrganisationRules(graphFixture([testNode("private-app", "appService", { publicNetworkAccess: false })]), [rule!])).toHaveLength(0);
    expect(runOrganisationRules(graphFixture([testNode("public-app", "appService", { publicNetworkAccess: true })]), [rule!])).toHaveLength(1);
  });
});
