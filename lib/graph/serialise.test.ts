import { describe, expect, it } from "vitest";
import { firstCutGraph } from "@/lib/generators/__fixtures__/firstCut";
import { serialiseToFragment, deserialiseFromFragment } from "./serialise";

describe("serialise", () => {
  it("round-trips a graph through gzip+base64url", async () => {
    const fragment = await serialiseToFragment(firstCutGraph);
    expect(fragment).toMatch(/^bunya1:/);
    const restored = await deserialiseFromFragment(fragment);
    expect(restored).toEqual(firstCutGraph);
  });

  it("returns null for malformed fragments", async () => {
    expect(await deserialiseFromFragment("bunya1:not-real")).toBeNull();
    expect(await deserialiseFromFragment("ignore")).toBeNull();
  });
});
