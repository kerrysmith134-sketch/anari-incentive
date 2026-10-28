import { describe, expect, it } from "vitest";
import type { PolicyDefinition } from "@anari/domain";
import { diffPolicyDefinitions } from "../index.js";

const base: PolicyDefinition = {
  code: "GENERIC_CONTRIBUTION_V1",
  version: 1,
  currency: "CNY",
  poolRate: "0.05",
  poolCap: "100000",
  rounding: "HALF_UP",
  calculator: "SIMPLE_POOL",
};

describe("policy diff", () => {
  it("reports changed and added paths", () => {
    const target: PolicyDefinition = {
      ...base,
      version: 2,
      poolRate: "0.06",
      evaluation: {
        dimensionWeights: { QUALITY: "1" },
        floor: "0.8",
        ceiling: "1.2",
      },
    };
    const changes = diffPolicyDefinitions(base, target);
    expect(changes).toEqual(
      expect.arrayContaining([
        { path: "poolRate", before: "0.05", after: "0.06" },
        { path: "version", before: 1, after: 2 },
        {
          path: "evaluation.dimensionWeights.QUALITY",
          before: undefined,
          after: "1",
        },
      ]),
    );
  });

  it("returns no changes for identical policies", () => {
    expect(diffPolicyDefinitions(base, structuredClone(base))).toEqual([]);
  });
});
