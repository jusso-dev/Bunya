import type { GraphDocument } from "@/lib/graph/schema";
import { estimateCost, formatMoney } from "@/lib/pricing/estimate";
import type { GeneratedFile, GeneratorResult } from "./types";

export function generateCostEstimate(document: GraphDocument): GeneratorResult {
  const estimate = estimateCost(document, "AUD");
  const lines: string[] = [
    `# Cost estimate — ${document.metadata.name}`,
    ``,
    `**Currency:** ${estimate.symbol} (${estimate.currency})  `,
    `**Snapshot date:** ${estimate.snapshotDate}  `,
    `**Source:** ${estimate.sourceUrl}`,
    ``,
    `## Caveats`,
    ``,
    ...estimate.caveats.map((c) => `- ${c}`),
    ``,
    `## Line items`,
    ``,
    `| Resource | Service | SKU | Monthly | Note |`,
    `| --- | --- | --- | ---: | --- |`,
  ];

  for (const item of estimate.lineItems) {
    lines.push(
      `| \`${item.resourceName}\` | ${item.serviceLabel} | ${item.sku} | ${formatMoney(item.monthly, estimate.currency)} | ${
        item.unmodelled ? "_unmodelled_" : item.note ?? ""
      } |`,
    );
  }

  lines.push(``, `**Total (indicative):** ${formatMoney(estimate.total, estimate.currency)} per month`, ``);

  const file: GeneratedFile = {
    path: "cost-estimate.md",
    language: "markdown",
    content: lines.join("\n"),
  };
  return { ok: true, files: [file] };
}
