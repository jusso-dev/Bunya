// Hand-curated equivalence map between Bunya rules and Azure Policy built-in
// definitions. Each entry says "these Bunya rules check the same control as
// this built-in policy". Two things are derived from it:
//
//   1. Framework alignment tags. Microsoft's regulatory-compliance initiatives
//      in Azure/azure-policy (MIT) group built-in policies under framework
//      control IDs. `pnpm compliance:sync` copies those control IDs (never any
//      framework prose) into policy-metadata.generated.ts. A rule mapped to a
//      policy in the CIS Azure Foundations initiative is therefore "aligned
//      with" that CIS control. It is never "compliant".
//   2. The Azure Policy export (lib/generators/azure-policy.ts), which turns
//      the design-time rules relevant to a diagram into an audit initiative
//      that can be assigned to the deployed resource groups.
//
// Only map a rule when the policy checks the same setting. Approximate
// matches overstate alignment; leave them out instead.
import type { ServiceType } from "@/lib/graph/schema";

export type PolicyParameterValue = string | number | boolean | string[];

export type PolicyAlignment = {
  /** Built-in policy definition name (GUID) under /providers/Microsoft.Authorization/policyDefinitions. */
  policyDefinitionId: string;
  /** Service types whose presence in a diagram makes this policy relevant to the export. */
  serviceTypes: ServiceType[];
  /** Bunya rule IDs that check the same control. */
  ruleIds: string[];
  /**
   * Scope the policy must be assigned at to evaluate anything. Defaults to
   * "resourceGroup". Subscription-level policies (for example Defender plans)
   * never evaluate under a resource-group assignment, so the export lists
   * them separately instead of including them in the initiative.
   */
  scope?: "resourceGroup" | "subscription";
  /**
   * Parameter values for non-effect parameters without an upstream default.
   * `"$australianRegions"` is replaced by the Australian Azure regions the
   * sovereignty rules allow.
   */
  parameters?: Record<string, PolicyParameterValue | "$australianRegions">;
};

export const POLICY_ALIGNMENTS: PolicyAlignment[] = [
  // Storage
  {
    policyDefinitionId: "fe83a0eb-a853-422d-aac2-1bffd182c5d0",
    serviceTypes: ["storageAccount"],
    ruleIds: [
      "PSRULE.STORAGE.MINTLS",
      "CHECKOV.AZURE.2",
      "CHECKOV.AZURE.44",
      "AZPOL.STG.MIN-TLS",
      "BUNYA.COMP.002",
      "ISM.1552",
      "ISM.1546",
    ],
    parameters: { minimumTlsVersion: "TLS1_2" },
  },
  {
    policyDefinitionId: "404c3081-a854-4457-ae30-26a93ef643f9",
    serviceTypes: ["storageAccount"],
    ruleIds: ["PSRULE.STORAGE.SECURETRANSFER", "CHECKOV.AZURE.3", "AZPOL.STG.SECURE-TRANSFER"],
  },
  {
    policyDefinitionId: "4fa4b6c0-31ca-4c0d-b10d-24b96f62a751",
    serviceTypes: ["storageAccount"],
    ruleIds: ["PSRULE.STORAGE.BLOBPUBLICACCESS"],
  },
  {
    policyDefinitionId: "b2982f36-99f2-4db5-8eff-283140c09693",
    serviceTypes: ["storageAccount"],
    // Bunya's public network setting is emitted as publicNetworkAccess; the
    // generators do not emit networkAcls.defaultAction, so the "restrict
    // network access" built-in (CIS 4.7) is deliberately not mapped.
    ruleIds: ["AZPOL.STG.PUBLIC-ACCESS", "PSRULE.STORAGE.FIREWALL", "CHECKOV.AZURE.4", "CHECKOV.AZURE.35"],
  },
  {
    policyDefinitionId: "c9d007d0-c057-4772-b18c-01e546713bcd",
    serviceTypes: ["storageAccount"],
    ruleIds: ["CHECKOV.AZURE.36"],
  },
  {
    policyDefinitionId: "640d2586-54d2-465f-877f-9ffc1d2109f4",
    serviceTypes: ["storageAccount"],
    ruleIds: ["PSRULE.STORAGE.DEFENDER"],
    scope: "subscription",
  },

  // App Service (web apps; the built-ins exclude function apps)
  {
    policyDefinitionId: "a4af4a39-4135-47fb-b175-47fbdf85311d",
    serviceTypes: ["appService"],
    ruleIds: [
      "AZPOL.WEB.HTTPS-ONLY",
      "PSRULE.APPSERVICE.USEHTTPS",
      "CHECKOV.AZURE.14",
      "BUNYA.COMP.001",
      "ISM.0974",
    ],
  },
  {
    policyDefinitionId: "f0e6e85b-9b9f-4a4b-b67b-f730d42f1b0b",
    serviceTypes: ["appService"],
    ruleIds: ["AZPOL.WEB.LATEST-TLS", "PSRULE.APPSERVICE.MINTLS", "CHECKOV.AZURE.15"],
  },
  {
    policyDefinitionId: "2b9ad585-36bc-4615-b300-fd4435808332",
    serviceTypes: ["appService"],
    ruleIds: ["AZPOL.WEB.MANAGED-IDENTITY", "PSRULE.APPSERVICE.MANAGEDIDENTITY", "CHECKOV.AZURE.71"],
  },
  {
    policyDefinitionId: "95bccee9-a7f8-4bec-9ee9-62c3473701fc",
    serviceTypes: ["appService"],
    ruleIds: ["CHECKOV.AZURE.1", "CHECKOV.AZURE.13"],
  },
  {
    policyDefinitionId: "cb510bfd-1cba-4d9f-a230-cb0976f4bb71",
    serviceTypes: ["appService"],
    ruleIds: ["PSRULE.APPSERVICE.REMOTEDEBUG"],
  },
  {
    policyDefinitionId: "8c122334-9d20-4eb8-89ea-ac9a705b74ae",
    serviceTypes: ["appService"],
    ruleIds: ["PSRULE.APPSERVICE.HTTP2", "CHECKOV.AZURE.18"],
  },

  // Function Apps
  {
    policyDefinitionId: "6d555dd1-86f2-4f1c-8ed7-5abae7c6cbab",
    serviceTypes: ["functionApp"],
    ruleIds: [
      "AZPOL.FN.HTTPS-ONLY",
      "PSRULE.FUNCTION.USEHTTPS",
      "CHECKOV.AZURE.28",
      "BUNYA.COMP.001",
      "ISM.0974",
    ],
  },
  {
    policyDefinitionId: "f9d614c5-c173-4d56-95a7-b4437057d193",
    serviceTypes: ["functionApp"],
    ruleIds: ["AZPOL.FN.LATEST-TLS", "PSRULE.FUNCTION.MINTLS"],
  },
  {
    policyDefinitionId: "c75248c1-ea1d-4a9c-8fc9-29a6aabd5da8",
    serviceTypes: ["functionApp"],
    ruleIds: ["CHECKOV.AZURE.50"],
  },
  {
    policyDefinitionId: "e2c1c086-2d84-4019-bff3-c44ccd95113c",
    serviceTypes: ["functionApp"],
    ruleIds: ["CHECKOV.AZURE.56"],
  },

  // Azure SQL
  {
    policyDefinitionId: "b3a22bc9-66de-45fb-98fa-00f5df42f41a",
    serviceTypes: ["sqlDatabase"],
    ruleIds: ["AZPOL.SQL.AAD-AUTH"],
  },
  {
    policyDefinitionId: "1b8ca024-1d5c-4dec-8995-b1a932b41780",
    serviceTypes: ["sqlDatabase"],
    ruleIds: ["AZPOL.SQL.PUBLIC-ACCESS", "CHECKOV.AZURE.23", "ISM.1418.sub"],
  },
  {
    policyDefinitionId: "17k78e20-9358-41c9-923c-fb736d382a12",
    serviceTypes: ["sqlDatabase"],
    ruleIds: ["PSRULE.SQL.TDE", "AZPOL.SQL.TDE"],
  },
  {
    policyDefinitionId: "a6fb4358-5bf4-4ad7-ba82-2cd2f41ce5e9",
    serviceTypes: ["sqlDatabase"],
    ruleIds: ["CHECKOV.AZURE.9"],
  },
  {
    policyDefinitionId: "89099bee-89e0-4b26-a5f4-165451757743",
    serviceTypes: ["sqlDatabase"],
    ruleIds: ["CHECKOV.AZURE.10"],
  },
  {
    policyDefinitionId: "32e6bbec-16b6-44c2-be37-c5b672d103cf",
    serviceTypes: ["sqlDatabase"],
    ruleIds: ["PSRULE.SQL.MINTLS"],
  },
  {
    policyDefinitionId: "abfb4388-5bf4-4ad7-ba82-2cd2f41ceae9",
    serviceTypes: ["sqlDatabase"],
    ruleIds: ["CHECKOV.AZURE.5"],
  },

  // Cosmos DB
  {
    policyDefinitionId: "797b37f7-06b8-444c-b1ad-fc62867f335a",
    serviceTypes: ["cosmosDb"],
    ruleIds: ["AZPOL.COS.PUBLIC-ACCESS", "CHECKOV.AZURE.140"],
  },
  {
    policyDefinitionId: "58440f8a-10c5-4151-bdce-dfbaad4a20b7",
    serviceTypes: ["cosmosDb"],
    ruleIds: ["CHECKOV.AZURE.140"],
  },

  // Key Vault
  {
    policyDefinitionId: "0b60c0b2-2dc2-4e1c-b5c9-abbed971de53",
    serviceTypes: ["keyVault"],
    ruleIds: [
      "PSRULE.KEYVAULT.PURGEPROTECT",
      "CHECKOV.AZURE.42",
      "CHECKOV.AZURE.110",
      "AZPOL.KV.PURGE-PROTECT",
    ],
  },
  {
    policyDefinitionId: "55615ac9-af46-4a59-874e-391cc3dfb490",
    serviceTypes: ["keyVault"],
    ruleIds: ["AZPOL.KV.FIREWALL", "PSRULE.KEYVAULT.FIREWALL"],
  },
  {
    policyDefinitionId: "405c5871-3e91-4644-8a63-58e19d68ff5b",
    serviceTypes: ["keyVault"],
    ruleIds: ["CHECKOV.AZURE.109"],
  },
  {
    policyDefinitionId: "12d4fa5e-1f9f-4c21-97a9-b99b3c6611b5",
    serviceTypes: ["keyVault"],
    ruleIds: ["PSRULE.KEYVAULT.RBAC", "E8.RESTRICT-ADMIN"],
  },
  {
    policyDefinitionId: "cf820ca0-f99e-4f3e-84fb-66e913812d21",
    serviceTypes: ["keyVault"],
    ruleIds: ["PSRULE.KEYVAULT.LOGS", "PATTERN.KEYVAULT-WITHOUT-LOGGING"],
  },

  // Container Registry
  {
    policyDefinitionId: "dc921057-6b28-4fbe-9b83-f7bec05db6c2",
    serviceTypes: ["containerRegistry"],
    ruleIds: ["PSRULE.ACR.ADMINUSER", "CHECKOV.AZURE.137"],
  },
  {
    policyDefinitionId: "0fdf0491-d080-4575-b627-ad0e843cba0f",
    serviceTypes: ["containerRegistry"],
    ruleIds: ["CHECKOV.AZURE.139", "AZPOL.ACR.PRIVATE-LINK"],
  },

  // Network
  {
    policyDefinitionId: "e71308d3-144b-4262-b144-efdc3cc90517",
    serviceTypes: ["subnet"],
    ruleIds: ["AZPOL.SNET.NSG", "PSRULE.VNET.USENSGS", "BUNYA.NET.006"],
  },
  {
    policyDefinitionId: "564feb30-bf6a-4854-b4bb-0d2d2d1e6c66",
    serviceTypes: ["applicationGateway"],
    ruleIds: ["AZPOL.AGW.WAF", "PSRULE.APPGW.WAFENABLED", "PATTERN.WAF-MISSING"],
  },
  // Bunya models Front Door Standard/Premium (Microsoft.Cdn/profiles), not
  // classic Front Door, so the classic-only WAF built-in is not used.
  {
    policyDefinitionId: "dfc212af-17ea-423a-9dcb-91e2cb2caa6b",
    serviceTypes: ["frontDoor"],
    ruleIds: ["PSRULE.FRONTDOOR.USEWAF"],
  },
  {
    policyDefinitionId: "679da822-78a7-4eff-8fff-a899454a9970",
    serviceTypes: ["frontDoor"],
    ruleIds: ["PSRULE.FRONTDOOR.USETLS12"],
  },
  {
    policyDefinitionId: "4c3c6c5f-0d47-4402-99b8-aa543dd8bcee",
    serviceTypes: ["virtualNetwork"],
    ruleIds: ["AZPOL.NSG.FLOW-LOGS"],
  },

  // Sovereignty
  {
    policyDefinitionId: "e56962a6-4747-49cd-b67b-bf8b01975c4c",
    serviceTypes: ["resourceGroup"],
    ruleIds: ["PSRULE.RESOURCE.ALLOWEDREGIONS", "BUNYA.SOV.001"],
    parameters: { listOfAllowedLocations: "$australianRegions" },
  },
  {
    policyDefinitionId: "e765b5de-1225-4ba3-bd56-1ac6695af988",
    serviceTypes: ["resourceGroup"],
    ruleIds: ["PSRULE.RESOURCE.ALLOWEDREGIONS"],
    parameters: { listOfAllowedLocations: "$australianRegions" },
    scope: "subscription",
  },

  // Observability
  {
    policyDefinitionId: "d550e854-df1a-4de9-bf44-cd894b39a95e",
    serviceTypes: ["applicationInsights"],
    ruleIds: ["PSRULE.APPINSIGHTS.WORKSPACE", "PSRULE.APPINSIGHTS.WORKSPACE-V2", "BUNYA.IMP.005"],
  },
  {
    policyDefinitionId: "199d5677-e4d9-4264-9465-efe1839c06bd",
    serviceTypes: ["applicationInsights"],
    ruleIds: ["AZPOL.APPINSIGHTS.LOCAL-AUTH"],
  },

  // AKS
  {
    policyDefinitionId: "0e246bcf-5f6f-4f87-bc6f-775d4712c7ea",
    serviceTypes: ["aksCluster"],
    ruleIds: ["BUNYA.COMP.013"],
  },

  // API Management
  {
    policyDefinitionId: "ee7495e7-3ba7-40b6-bfee-c29e22cc75d4",
    serviceTypes: ["apiManagement"],
    ruleIds: ["PSRULE.APIM.HTTPSONLY"],
  },
];
