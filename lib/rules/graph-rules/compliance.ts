import { graphRule, nodeRule, nodesOfType } from "@/lib/rules/builders";
import type { RuleEntry } from "@/lib/rules/schema";

const ISM_SOURCE = {
  name: "ACSC Information Security Manual",
  url: "https://www.cyber.gov.au/resources-business-and-government/essential-cybersecurity/ism",
  license: "CC-BY-4.0",
} as const;

const MCSB_SOURCE = {
  name: "Microsoft Cloud Security Benchmark v3",
  url: "https://learn.microsoft.com/en-us/security/benchmark/azure/",
  license: "CC-BY-4.0",
} as const;

const DEFAULT_SQL_ADMINS = new Set(["sa", "admin", "sqladmin", "bunyaadmin"]);

export const complianceRules: RuleEntry[] = [
  nodeRule({
    id: "BUNYA.COMP.001",
    source: { ...ISM_SOURCE, ruleId: "ISM-0974" },
    category: "compliance",
    severity: "error",
    serviceTypes: ["appService", "functionApp", "staticWebApp"],
    message: "Web workload must enforce HTTPS-only (httpsOnly = true).",
    longExplanation:
      "ISM-0974 requires that data in transit to internet-facing services is protected using TLS. Setting httpsOnly redirects plain HTTP traffic at the platform layer and blocks downgrade attempts, which is a baseline control for any App Service, Function App or Static Web App exposed to the public internet.",
    tags: ["bunya", "compliance", "ism-0974", "essential-eight", "tls"],
    predicate: (n) => {
      const props = n.properties as { httpsOnly?: boolean };
      // staticWebApp always serves over HTTPS by default — only flag explicit false.
      if (n.type === "staticWebApp") return props.httpsOnly === false;
      return props.httpsOnly !== true;
    },
  }),

  nodeRule({
    id: "BUNYA.COMP.002",
    source: { ...ISM_SOURCE, ruleId: "ISM-1552" },
    category: "compliance",
    severity: "error",
    serviceTypes: ["storageAccount"],
    message: "Storage Account minimum TLS version must be 1.2 or higher.",
    longExplanation:
      "ISM-1552 directs that TLS versions earlier than 1.2 are not used to protect data in transit. Storage accounts default to accepting 1.0 and 1.1 connections unless minTlsVersion is explicitly set to 1.2, which is required to meet the ACSC baseline.",
    tags: ["bunya", "compliance", "ism-1552", "tls", "storage"],
    predicate: (n) => {
      const v = (n.properties as { minTlsVersion?: string }).minTlsVersion;
      return v !== "1.2";
    },
  }),

  nodeRule({
    id: "BUNYA.COMP.003",
    source: { ...ISM_SOURCE, ruleId: "ISM-1297" },
    category: "compliance",
    severity: "warning",
    serviceTypes: ["sqlDatabase"],
    message:
      "SQL Database adminLogin uses a default-ish value (sa/admin/sqladmin/bunyaadmin) — choose a non-guessable account name.",
    longExplanation:
      "ISM-1297 covers protection of privileged credentials. Default or scaffolded admin names like 'sa' or 'admin' are the first targets of credential-stuffing and brute-force attempts against Azure SQL public endpoints, so the administrator login should be a non-obvious value scoped to the workload.",
    tags: ["bunya", "compliance", "ism-1297", "sql", "privileged-access"],
    predicate: (n) => {
      const login = (n.properties as { adminLogin?: string }).adminLogin;
      if (!login) return false;
      return DEFAULT_SQL_ADMINS.has(login.toLowerCase());
    },
  }),

  nodeRule({
    id: "BUNYA.COMP.004",
    source: MCSB_SOURCE,
    category: "compliance",
    severity: "info",
    serviceTypes: ["resourceGroup"],
    message: "Resource Group has no tags — required for inventory and ownership tracking.",
    longExplanation:
      "Microsoft Cloud Security Benchmark control GR-1 (governance and resource accountability) expects every resource group to carry tags identifying owner, cost centre and data classification. Untagged groups make ownership, expiry, and incident triage substantially harder once the subscription has more than a handful of workloads.",
    tags: ["bunya", "compliance", "mcsb", "tagging", "governance"],
    predicate: (n) => {
      const tags = (n.properties as { tags?: Record<string, string> }).tags;
      if (!tags) return true;
      return Object.keys(tags).length === 0;
    },
  }),

  graphRule({
    id: "BUNYA.COMP.005",
    source: { ...ISM_SOURCE, ruleId: "ISM-1233" },
    category: "compliance",
    severity: "warning",
    message:
      "No Log Analytics workspace defined — Essential Eight ML2 requires centralised logging.",
    longExplanation:
      "ISM-1233 requires event logs to be centrally stored and protected against unauthorised modification. Essential Eight Maturity Level 2 expands this to include security-relevant events from cloud workloads. Without a Log Analytics workspace there is no sink for diagnostic settings, Sentinel, or longer-term retention, which leaves the deployment unable to demonstrate the control.",
    tags: ["bunya", "compliance", "ism-1233", "essential-eight", "logging"],
    predicate: (graph) => {
      const workspaces = nodesOfType(graph, "logAnalytics");
      if (workspaces.length > 0) return [];
      return [
        {
          message:
            "Add a Log Analytics workspace and wire diagnostic settings from each resource into it.",
        },
      ];
    },
  }),
];
