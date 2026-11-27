import { describe, expect, it, vi } from "vitest";
import {
  runCycleReadinessSweep,
  selectCycleReadinessTargets,
} from "../cycle-readiness-scheduler.js";

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

describe("runCycleReadinessSweep", () => {
  it("continues after one cycle fails and records a cycle-scoped failure", async () => {
    const calls: string[] = [];
    const failures: string[] = [];
    const outcomes = await runCycleReadinessSweep(
      [
        { id: "later", status: "OPEN", startsAt: "2026-04-01T00:00:00.000Z" },
        { id: "broken", status: "OPEN", startsAt: "2026-02-01T00:00:00.000Z" },
        { id: "first", status: "OPEN", startsAt: "2026-01-01T00:00:00.000Z" },
      ],
      async (cycle) => {
        calls.push(cycle.id);
        if (cycle.id === "broken") throw new Error("malformed cycle");
        return { ready: cycle.id === "first" };
      },
      (cycle) => failures.push(cycle.id),
    );

    expect(calls).toEqual(["first", "broken", "later"]);
    expect(failures).toEqual(["broken"]);
    expect(outcomes).toEqual([
      "readiness:first:READY",
      "readiness:broken:FAILED",
      "readiness:later:NOT_READY",
    ]);
  });

  it("reports no open cycle instead of falling back to a settled cycle", async () => {
    const run = vi.fn(async () => ({ ready: true }));
    const outcomes = await runCycleReadinessSweep(
      [{ id: "settled", status: "SETTLED", startsAt: "2025-01-01T00:00:00.000Z" }],
      run,
    );
    expect(outcomes).toEqual(["readiness:NO_OPEN_CYCLE"]);
    expect(run).not.toHaveBeenCalled();
  });
});
