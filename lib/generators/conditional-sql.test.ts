import { describe, expect, it } from "vitest";
import { generateTerraform } from "./terraform";
import { generateBicep } from "./bicep";
import { generateArm } from "./arm";
import { generateAzCli } from "./azcli";
import { generatePowerShell } from "./powershell";
import { noSqlGraph } from "@/lib/graph/__fixtures__/noSql";
import { firstCutGraph } from "@/lib/graph/__fixtures__/firstCut";

describe("conditional SQL admin password", () => {
  it.each([
    { format: "Terraform", generate: generateTerraform, secret: "sql_admin_password", paths: ["variables.tf"] },
    { format: "Bicep", generate: generateBicep, secret: "sqlAdminPassword", paths: ["main.bicep", "main.parameters.json"] },
    { format: "ARM", generate: generateArm, secret: "sqlAdminPassword", paths: ["azuredeploy.json", "azuredeploy.parameters.json"] },
    { format: "az CLI", generate: generateAzCli, secret: "SQL_ADMIN_PASSWORD", paths: ["deploy.sh"] },
    { format: "PowerShell", generate: generatePowerShell, secret: "SqlAdminPassword", paths: ["Deploy-Infrastructure.ps1"] },
  ])("$format omits $secret when no sqlDatabase", ({ generate, secret, paths }) => {
    const result = generate(noSqlGraph);
    if (!result.ok) throw new Error("expected ok");
    for (const path of paths) {
      const file = result.files.find((f) => f.path === path);
      expect(file, path).toBeDefined();
      expect(file!.content).not.toContain(secret);
    }
  });

  it("Terraform still emits sql_admin_password when a sqlDatabase exists", () => {
    const withSql = {
      ...firstCutGraph,
      nodes: [
        ...firstCutGraph.nodes,
        {
          id: "sql",
          type: "sqlDatabase" as const,
          name: "AppDB",
          resourceName: "sqldb-test",
          position: { x: 1000, y: 0 },
          parentId: "rg",
          properties: { sku: "S0", collation: "SQL_Latin1_General_CP1_CI_AS", adminLogin: "bunyaadmin", zoneRedundant: false },
        },
      ],
    };
    const result = generateTerraform(withSql);
    if (!result.ok) throw new Error("expected ok");
    const vars = result.files.find((f) => f.path === "variables.tf")?.content ?? "";
    expect(vars).toContain("sql_admin_password");
  });
});
