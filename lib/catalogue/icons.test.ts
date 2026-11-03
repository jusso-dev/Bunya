import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICE_TYPES } from "@/lib/graph/schema";
import manifest from "./icon-manifest.json";
import { SERVICE_ICONS } from "./icons";

const ICON_DIR = path.resolve(__dirname, "..", "..", "public", "azure-icons");

describe("Azure icon assets", () => {
  it("maps every service type to its own official icon", () => {
    for (const type of SERVICE_TYPES) {
      expect(SERVICE_ICONS[type].src, type).toBe(`/azure-icons/${type}.svg`);
      expect(manifest.icons[type as keyof typeof manifest.icons], type).toBeDefined();
    }
  });

  it("ships the exact bytes recorded in the manifest", () => {
    for (const [type, icon] of Object.entries(manifest.icons)) {
      const data = readFileSync(path.join(ICON_DIR, `${type}.svg`));
      expect(createHash("sha256").update(data).digest("hex"), type).toBe(icon.sha256);
    }
  });
});
