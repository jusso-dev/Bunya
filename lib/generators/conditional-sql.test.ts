import { describe, expect, it } from "vitest";
import { generateTerraform } from "./terraform";
import { generateBicep } from "./bicep";
import { generateArm } from "./arm";
import { generateAzCli } from "./azcli";
import { generatePowerShell } from "./powershell";
import { noSqlGraph } from "./__fixtures__/noSql";
import { firstCutGraph } from "./__fixtures__/firstCut";

describe("conditional SQL admin password", () => {
  it("Terraform omits sql_admin_password variable when no sqlDatabase nodes", () => {
    const result = generateTerraform(noSqlGraph);
    if (!result.ok) throw new Error("expected ok");
    const vars = result.files.find((f) => f.path === "variables.tf")?.content ?? "";
    expect(vars).not.toContain("sql_admin_password");
  });

  it("Bicep omits @secure() sqlAdminPassword param when no sqlDatabase", () => {
    const result = generateBicep(noSqlGraph);
    if (!result.ok) throw new Error("expected ok");
    const main = result.files.find((f) => f.path === "main.bicep")?.content ?? "";
    expect(main).not.toContain("sqlAdminPassword");
    const params = result.files.find((f) => f.path === "main.parameters.json")?.content ?? "";
    expect(params).not.toContain("sqlAdminPassword");
  });

  it("ARM omits sqlAdminPassword parameter when no sqlDatabase", () => {
    const result = generateArm(noSqlGraph);
    if (!result.ok) throw new Error("expected ok");
    const main = result.files.find((f) => f.path === "azuredeploy.json")?.content ?? "";
    expect(main).not.toContain("sqlAdminPassword");
    const params = result.files.find((f) => f.path === "azuredeploy.parameters.json")?.content ?? "";
    expect(params).not.toContain("sqlAdminPassword");
  });

  it("az CLI omits SQL_ADMIN_PASSWORD guard when no sqlDatabase", () => {
    const result = generateAzCli(noSqlGraph);
    if (!result.ok) throw new Error("expected ok");
    const script = result.files[0].content;
    expect(script).not.toContain("SQL_ADMIN_PASSWORD");
  });

  it("PowerShell omits Mandatory SqlAdminPassword param when no sqlDatabase", () => {
    const result = generatePowerShell(noSqlGraph);
    if (!result.ok) throw new Error("expected ok");
    const script = result.files[0].content;
    expect(script).not.toContain("SqlAdminPassword");
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
