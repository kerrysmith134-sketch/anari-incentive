import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { policyPackManifestSchema } from "@anari/contracts";

const root = join(process.cwd(), "examples", "verticals");
const packs = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(root, entry.name, "pack.json"));

describe("policy pack manifest contract", () => {
  it("declares applicability, roles, templates, evidence requirements and simulation/seed metadata", () => {
    expect(packs.length).toBeGreaterThanOrEqual(3);
    for (const path of packs) {
      const parsed = policyPackManifestSchema.safeParse(
        JSON.parse(readFileSync(path, "utf8")),
      );
      expect(parsed.success, path).toBe(true);
    }
  });
});
