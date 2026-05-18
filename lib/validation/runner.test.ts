import { describe, expect, it } from "vitest";
import { runValidation, applyAutofix } from "./runner";
import { RULES } from "./rules";
import { firstCutGraph } from "@/lib/generators/__fixtures__/firstCut";
import { fullStackGraph } from "@/lib/generators/__fixtures__/fullStack";
import { GraphDocument } from "@/lib/graph/schema";

describe("validation rules", () => {
  it("exposes all 11 rules", () => {
    expect(RULES.map((r) => r.id).sort()).toEqual([
      "COST-1",
      "E8-S1",
      "E8-S2",
      "GEN-1",
      "GEN-2",
      "GEN-3",
      "GEN-4",
      "GEN-5",
      "ISM-0974",
      "ISM-1552",
      "NAMING-1",
    ]);
  });

  it("produces zero findings for a healthy first-cut graph", () => {
    const findings = runValidation(firstCutGraph);
    const errors = findings.filter((f) => f.severity === "error");
    expect(errors).toEqual([]);
  });

  it("detects a forced HTTP App Service and autofixes it", () => {
    const broken: GraphDocument = {
      ...firstCutGraph,
      nodes: firstCutGraph.nodes.map((n) =>
        n.type === "appService"
          ? { ...n, properties: { ...n.properties, httpsOnly: false } }
          : n,
      ),
    };
    const findings = runValidation(broken);
    const ism = findings.find((f) => f.ruleId === "ISM-0974");
    expect(ism?.severity).toBe("error");
    expect(ism?.autofixId).toBe("enable-https");

    const fixed = applyAutofix(broken, ism!);
    const after = runValidation(fixed).filter((f) => f.ruleId === "ISM-0974");
    expect(after).toEqual([]);
  });

  it("flags TLS 1.0 on Storage and autofixes to 1.2", () => {
    const broken: GraphDocument = {
      ...firstCutGraph,
      nodes: firstCutGraph.nodes.map((n) =>
        n.type === "storageAccount"
          ? { ...n, properties: { ...n.properties, minTlsVersion: "1.0" } }
          : n,
      ),
    };
    const finding = runValidation(broken).find((f) => f.ruleId === "ISM-1552");
    expect(finding).toBeTruthy();
    const fixed = applyAutofix(broken, finding!);
    expect(runValidation(fixed).find((f) => f.ruleId === "ISM-1552")).toBeUndefined();
  });

  it("detects cycles", () => {
    const cyclic: GraphDocument = {
      ...firstCutGraph,
      edges: [
        ...firstCutGraph.edges,
        { id: "loop", source: "kv", target: "app", kind: "depends_on" },
      ],
    };
    const cycle = runValidation(cyclic).find((f) => f.ruleId === "GEN-1");
    expect(cycle?.severity).toBe("error");
  });

  it("auto-fixes a Function App without storage by adding one", () => {
    const fnGraph: GraphDocument = {
      ...firstCutGraph,
      nodes: [
        ...firstCutGraph.nodes.filter((n) => n.type === "resourceGroup"),
        {
          id: "fn",
          type: "functionApp",
          name: "Worker",
          resourceName: "fn-test",
          position: { x: 0, y: 0 },
          properties: { runtime: "node", runtimeVersion: "20", consumptionPlan: true, httpsOnly: true, publicNetworkAccess: true },
        },
      ],
      edges: [],
    };
    const finding = runValidation(fnGraph).find((f) => f.ruleId === "GEN-4");
    expect(finding?.autofixId).toBe("add-storage");
    const fixed = applyAutofix(fnGraph, finding!);
    expect(fixed.nodes.some((n) => n.type === "storageAccount")).toBe(true);
  });

  it("flags orphan nodes", () => {
    const lonely: GraphDocument = {
      ...firstCutGraph,
      nodes: [
        ...firstCutGraph.nodes,
        {
          id: "orphan",
          type: "applicationInsights",
          name: "Stray",
          resourceName: "ai-orphan",
          position: { x: 999, y: 999 },
          properties: { type: "web", sampling: 100 },
        },
      ],
    };
    const finding = runValidation(lonely).find((f) => f.ruleId === "GEN-2");
    expect(finding?.severity).toBe("info");
  });

  it("flags Storage with public access + no Private Endpoint", () => {
    const exposed: GraphDocument = {
      ...firstCutGraph,
      nodes: firstCutGraph.nodes.map((n) =>
        n.type === "storageAccount"
          ? { ...n, properties: { ...n.properties, allowPublicAccess: true } }
          : n,
      ),
    };
    const finding = runValidation(exposed).find((f) => f.ruleId === "E8-S1");
    expect(finding?.severity).toBe("warning");
  });

  it("flags non-identity edges into Key Vault", () => {
    const bad: GraphDocument = {
      ...firstCutGraph,
      edges: firstCutGraph.edges.map((e) =>
        e.target === "kv" && e.kind === "identity" ? { ...e, kind: "data" } : e,
      ),
    };
    const finding = runValidation(bad).find((f) => f.ruleId === "GEN-3");
    expect(finding?.severity).toBe("warning");
  });

  it("flags an invalid Storage account resource name", () => {
    const bad: GraphDocument = {
      ...firstCutGraph,
      nodes: firstCutGraph.nodes.map((n) =>
        n.type === "storageAccount" ? { ...n, resourceName: "INVALID-NAME!" } : n,
      ),
    };
    const finding = runValidation(bad).find((f) => f.ruleId === "NAMING-1");
    expect(finding?.severity).toBe("error");
  });

  it("flags Premium App Service Plan with no attached compute", () => {
    const idle: GraphDocument = {
      ...firstCutGraph,
      nodes: firstCutGraph.nodes.map((n) =>
        n.type === "appServicePlan"
          ? { ...n, properties: { ...n.properties, sku: "P1v3" } }
          : n,
      ),
      edges: firstCutGraph.edges.filter((e) => !(e.target === "plan")),
    };
    const finding = runValidation(idle).find((f) => f.ruleId === "COST-1");
    expect(finding?.severity).toBe("info");
  });

  it("runs all rules against the full stack without errors", () => {
    const findings = runValidation(fullStackGraph);
    const errors = findings.filter((f) => f.severity === "error");
    expect(errors.map((f) => f.ruleId)).toEqual([]);
  });
});
