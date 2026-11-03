export type PolicyParameterMetadata = {
  type: string;
  defaultValue?: unknown;
  allowedValues?: unknown[];
};

export type PolicyMetadata = {
  displayName: string;
  version: string;
  category: string;
  deprecated: boolean;
  preview: boolean;
  /** Effect parameter, when the definition exposes one. */
  effect: { defaultValue?: string; allowedValues: string[] } | null;
  /** Non-effect parameters. */
  parameters: Record<string, PolicyParameterMetadata>;
  /** Framework ID -> control IDs taken from Microsoft's regulatory-compliance initiatives. */
  controls: Record<string, string[]>;
};

export type ComplianceFramework = {
  id: string;
  name: string;
  shortName: string;
  version: string;
  initiativeId: string;
  initiativeVersion: string;
};

export type PolicyMetadataSource = {
  repository: string;
  commit: string;
  syncedAt: string;
};
