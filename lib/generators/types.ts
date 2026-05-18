export type GeneratedFile = {
  path: string;
  content: string;
  language: string;
};

export type GeneratorResult =
  | { ok: true; files: GeneratedFile[] }
  | { ok: false; reason: string; cycle?: string[] };
