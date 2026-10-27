import { describe, expect, it } from "vitest";
import { reconcileLines } from "@anari/policy-dsl";

const actual = [
  { personId: "a", roundedAmount: "100.00" },
  { personId: "b", roundedAmount: "50.00" },
] as never[];

describe("reconcileLines", () => {
  it("returns no differences for matching lines", () => {
    expect(
      reconcileLines(
        [
          { personId: "a", amount: "100" },
          { personId: "b", amount: "50" },
        ],
        actual,
      ),
    ).toEqual([]);
  });

  it("reports amount differences and missing/extra lines", () => {
    const differences = reconcileLines(
      [
        { personId: "a", amount: "99" },
        { personId: "c", amount: "10" },
      ],
      actual,
    );
    expect(differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ personId: "a", delta: "1" }),
        expect.objectContaining({ personId: "c", actual: null }),
        expect.objectContaining({ personId: "b", expected: "0" }),
      ]),
    );
  });
});
