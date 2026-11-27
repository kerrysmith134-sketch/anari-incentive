import { describe, expect, it } from "vitest";
import { selectCycleReadinessTargets } from "../cycle-readiness-scheduler.js";

describe("selectCycleReadinessTargets", () => {
  it("returns every unsettled monthly/quarterly/annual cycle oldest first", () => {
    const cycles = [
      { id: "annual", status: "OPEN", startsAt: "2026-01-01T00:00:00.000Z" },
      { id: "settled", status: "SETTLED", startsAt: "2025-01-01T00:00:00.000Z" },
      { id: "month", status: "OPEN", startsAt: "2026-03-01T00:00:00.000Z" },
      { id: "quarter", status: "IN_REVIEW", startsAt: "2026-04-01T00:00:00.000Z" },
    ];

    const targets = selectCycleReadinessTargets(cycles);

    expect(targets.map((cycle) => cycle.id)).toEqual([
      "annual",
      "month",
      "quarter",
    ]);
    expect(cycles.map((cycle) => cycle.id)).toEqual([
      "annual",
      "settled",
      "month",
      "quarter",
    ]);
  });

  it("uses cycle id as a deterministic tie-breaker", () => {
    const targets = selectCycleReadinessTargets([
      { id: "z-cycle", status: "OPEN", startsAt: "2026-01-01T00:00:00.000Z" },
      { id: "a-cycle", status: "OPEN", startsAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(targets.map((cycle) => cycle.id)).toEqual(["a-cycle", "z-cycle"]);
  });

  it("returns an empty target list when every cycle is settled", () => {
    expect(
      selectCycleReadinessTargets([
        { id: "old", status: "SETTLED", startsAt: "2025-01-01T00:00:00.000Z" },
      ]),
    ).toEqual([]);
  });
});
