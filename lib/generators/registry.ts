import type { GraphDocument } from "@/lib/graph/schema";
import { generateArm } from "./arm";
import { generateAzCli } from "./azcli";
import { generateAzurePolicy } from "./azure-policy";
import { generateBicep } from "./bicep";
import { generateCostEstimate } from "./cost";
import { generateMermaid } from "./mermaid";
import { generatePowerShell } from "./powershell";
import { generateReadme } from "./readme";
import { generateTerraform } from "./terraform";
import type { GeneratedFile, GeneratorResult } from "./types";

export type OutputOptions = { audPerUsd?: number };

export type Output = {
  id: string;
  label: string;
  // Folder inside a bundle of every output; "" puts the files at the root.
  folder: string;
  generate: (document: GraphDocument, options: OutputOptions) => GeneratorResult;
};

// Every output Bunya generates, in display order. The editor tabs, the ZIP
// download and the MCP export all read this list.
export const OUTPUTS = [
  { id: "terraform", label: "Terraform", folder: "terraform", generate: generateTerraform },
  { id: "bicep", label: "Bicep", folder: "bicep", generate: generateBicep },
  { id: "arm", label: "ARM", folder: "arm", generate: generateArm },
  { id: "azcli", label: "az CLI", folder: "azcli", generate: generateAzCli },
  { id: "powershell", label: "PowerShell", folder: "powershell", generate: generatePowerShell },
  { id: "azurePolicy", label: "Azure Policy", folder: "azure-policy", generate: generateAzurePolicy },
  { id: "mermaid", label: "Mermaid", folder: "mermaid", generate: generateMermaid },
  { id: "readme", label: "README", folder: "", generate: generateReadme },
  { id: "cost", label: "Cost", folder: "cost", generate: (document, options) => generateCostEstimate(document, options) },
] as const satisfies readonly Output[];

export type OutputId = (typeof OUTPUTS)[number]["id"];

export const OUTPUT_IDS = OUTPUTS.map((output) => output.id) as [OutputId, ...OutputId[]];

export function getOutput(id: OutputId): Output {
  return OUTPUTS.find((output) => output.id === id)!;
}

export function bundlePath(output: Output, file: GeneratedFile): string {
  return output.folder ? `${output.folder}/${file.path}` : file.path;
}
