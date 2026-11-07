import { describe, expect, it } from "vitest";
import { generateAzurePolicy } from "./azure-policy";
import { firstCutGraph } from "@/lib/graph/__fixtures__/firstCut";
import { fullStackGraph } from "@/lib/graph/__fixtures__/fullStack";
import { emptyGraph } from "@/lib/graph/schema";
import { POLICY_ALIGNMENTS, POLICY_METADATA } from "@/lib/rules/compliance";

function files(result: ReturnType<typeof generateAzurePolicy>) {
  if (!result.ok) throw new Error(result.reason);
  return Object.fromEntries(result.files.map((file) => [file.path, file.content]));
}

describe("generateAzurePolicy", () => {
  it("snapshots the first-cut fixture output", () => {
    const out = files(generateAzurePolicy(firstCutGraph));
    expect(Object.keys(out)).toEqual([
      "POLICY.md",
      "initiative.definitions.json",
      "policy.bicep",
      "policy-assignment.bicep",
      "deploy-policy.sh",
    ]);
    expect(out["initiative.definitions.json"]).toMatchSnapshot();
    expect(out["policy.bicep"]).toMatchSnapshot();
    expect(out["deploy-policy.sh"]).toMatchSnapshot();
  });

  it("uses only audit effects and built-in definition IDs", () => {
    const references = JSON.parse(files(generateAzurePolicy(fullStackGraph))["initiative.definitions.json"]) as {
      policyDefinitionReferenceId: string;
      policyDefinitionId: string;
      parameters: Record<string, { value: unknown }>;
    }[];
    expect(references.length).toBeGreaterThan(20);
    expect(new Set(references.map((r) => r.policyDefinitionReferenceId)).size).toBe(references.length);
    for (const reference of references) {
      expect(reference.policyDefinitionId).toMatch(/^\/providers\/Microsoft\.Authorization\/policyDefinitions\/[0-9a-z-]{36}$/);
      expect(reference.policyDefinitionReferenceId.length).toBeLessThanOrEqual(64);
      if (reference.parameters.effect) expect(["Audit", "AuditIfNotExists"]).toContain(reference.parameters.effect.value);
    }
  });

  it("only exports policies relevant to the services in the diagram", () => {
    const references = JSON.parse(files(generateAzurePolicy(emptyGraph("empty")))["initiative.definitions.json"]) as {
      policyDefinitionId: string;
      parameters: Record<string, { value: unknown }>;
    }[];
    // Only the allowed-locations guardrail applies to an empty diagram.
    expect(references.map((r) => r.policyDefinitionId.split("/").pop())).toEqual([
      "e56962a6-4747-49cd-b67b-bf8b01975c4c",
    ]);
    expect(references[0].parameters.listOfAllowedLocations).toEqual({
      value: ["australiacentral", "australiacentral2", "australiaeast", "australiasoutheast"],
    });
  });

  it("assigns the initiative to every resource group in the diagram", () => {
    const out = files(generateAzurePolicy(fullStackGraph));
    expect(out["policy.bicep"]).toContain("targetScope = 'subscription'");
    expect(out["policy.bicep"]).toContain("loadJsonContent('initiative.definitions.json')");
    expect(out["policy.bicep"]).toContain("module assignments 'policy-assignment.bicep'");
    expect(out["deploy-policy.sh"]).toContain("set -euo pipefail");
    expect(out["POLICY.md"]).toContain("does not make the workload compliant");
  });

  it("assigns only the resource group every exporter creates, and lets the script skip missing ones", () => {
    const second = { ...fullStackGraph.nodes.find((n) => n.type === "resourceGroup")!, id: "rg2", name: "Second", resourceName: "rg-second" };
    const out = files(generateAzurePolicy({ ...fullStackGraph, nodes: [...fullStackGraph.nodes, second] }));
    expect(out["policy.bicep"]).toContain("  'rg-full-stack'\n  // Only Terraform creates");
    expect(out["policy.bicep"]).toContain("  // 'rg-second'");
    expect(out["deploy-policy.sh"]).toContain('for rg in "rg-full-stack" "rg-second"; do');
    expect(out["deploy-policy.sh"]).toContain('az group exists --name "$rg"');
  });

  it("lists subscription-level policies instead of assigning them to resource groups", () => {
    const out = files(generateAzurePolicy(fullStackGraph));
    expect(out["initiative.definitions.json"]).not.toContain("640d2586-54d2-465f-877f-9ffc1d2109f4");
    expect(out["POLICY.md"]).toContain("## Subscription-level policies (not included)");
    expect(out["POLICY.md"]).toContain("Microsoft Defender for Storage should be enabled");
  });

  it("has metadata for every curated policy and values for required parameters", () => {
    for (const alignment of POLICY_ALIGNMENTS) {
      const metadata = POLICY_METADATA[alignment.policyDefinitionId];
      expect(metadata, alignment.policyDefinitionId).toBeDefined();
      expect(metadata.deprecated, metadata.displayName).toBe(false);
      for (const [name, param] of Object.entries(metadata.parameters)) {
        if (param.defaultValue === undefined) expect(alignment.parameters?.[name], `${metadata.displayName}.${name}`).toBeDefined();
      }
    }
  });
});
