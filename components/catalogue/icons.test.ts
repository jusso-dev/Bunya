import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICE_TYPES } from "@/lib/graph/schema";
import manifest from "@/lib/catalogue/icon-manifest.json";
import { serviceIconPath } from "./icons";

const PUBLIC_DIR = path.resolve(__dirname, "..", "..", "public");
const ICON_DIR = path.join(PUBLIC_DIR, "azure-icons");

describe("Azure icon assets", () => {
  it("ships an official icon for every service type", () => {
    for (const type of SERVICE_TYPES) {
      expect(existsSync(path.join(PUBLIC_DIR, serviceIconPath(type))), type).toBe(true);
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
