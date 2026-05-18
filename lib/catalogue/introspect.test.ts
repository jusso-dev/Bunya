import { describe, expect, it } from "vitest";
import { describeObjectSchema } from "./introspect";
import { storageAccountSchema, keyVaultSchema, appServiceSchema, virtualNetworkSchema } from "./services";

describe("describeObjectSchema", () => {
  it("describes enum, string, boolean and number fields on storageAccount", () => {
    const fields = describeObjectSchema(storageAccountSchema);
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.sku.kind).toBe("enum");
    expect(byName.sku.options).toContain("Standard_LRS");
    expect(byName.allowPublicAccess.kind).toBe("boolean");
    expect(byName.minTlsVersion.kind).toBe("enum");
    expect(byName.containers.kind).toBe("stringArray");
  });

  it("captures Key Vault numeric retention with min/max", () => {
    const fields = describeObjectSchema(keyVaultSchema);
    const retention = fields.find((f) => f.name === "softDeleteRetentionDays");
    expect(retention?.kind).toBe("number");
    expect(retention?.min).toBe(7);
    expect(retention?.max).toBe(90);
  });

  it("handles enum + boolean mixes for App Service", () => {
    const fields = describeObjectSchema(appServiceSchema);
    expect(fields.find((f) => f.name === "runtime")?.kind).toBe("enum");
    expect(fields.find((f) => f.name === "httpsOnly")?.kind).toBe("boolean");
  });

  it("handles plain string fields on VirtualNetwork", () => {
    const fields = describeObjectSchema(virtualNetworkSchema);
    expect(fields.find((f) => f.name === "addressSpace")?.kind).toBe("string");
  });
});
