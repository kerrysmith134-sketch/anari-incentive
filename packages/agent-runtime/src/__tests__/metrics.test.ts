import { describe, expect, it } from "vitest";
import { summarizeAgentMetrics } from "../metrics.js";

function task(overrides: Partial<{
  status: string;
  createdAt: string;
  updatedAt: string;
  requiresApproval: boolean;
  results: Array<{ status: string }>;
  attempts: number;
}> = {}) {
  return {
    status: overrides.status ?? "SUCCEEDED",
    createdAt: overrides.createdAt ?? "2026-10-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-10-01T02:00:00.000Z",
    findings: [],
    actions: [{ requiresApproval: overrides.requiresApproval ?? false }],
    results: overrides.results ?? [{ status: "EXECUTED" }],
    attempts: overrides.attempts ?? 1,
  };
}

describe("agent acceptance metrics", () => {
  it("reports median close time, auto resolution and escalation", () => {
    const report = summarizeAgentMetrics(
      [
        task({ updatedAt: "2026-10-01T01:00:00.000Z" }),
        task({ updatedAt: "2026-10-01T03:00:00.000Z" }),
        task({
          status: "SUCCEEDED",
          updatedAt: "2026-10-01T05:00:00.000Z",
          requiresApproval: true,
        }),
        task({ status: "ESCALATED" }),
      ],
      "2026-10-02T00:00:00.000Z",
    );
    expect(report.totalTasks).toBe(4);
    expect(report.closedTasks).toBe(3);
    expect(report.medianCloseHours).toBe(3);
    expect(report.autoResolvedRate).toBe(0.6667);
    expect(report.escalationRate).toBe(0.25);
  });

  it("computes the human override rate from executed and rejected results", () => {
    const report = summarizeAgentMetrics([
      task({ results: [{ status: "EXECUTED" }] }),
      task({ results: [{ status: "REJECTED" }] }),
      task({ results: [{ status: "EXECUTED" }, { status: "REJECTED" }] }),
    ]);
    expect(report.humanOverrideRate).toBe(0.5);
    expect(report.averageAttempts).toBe(1);
  });

  it("returns null rates when there is no data and flags external metrics", () => {
    const report = summarizeAgentMetrics([]);
    expect(report.medianCloseHours).toBeNull();
    expect(report.autoResolvedRate).toBeNull();
    expect(report.escalationRate).toBeNull();
    expect(report.humanOverrideRate).toBeNull();
    expect(report.falsePositiveRate).toBeNull();
    expect(report.costPerClosedLoop).toBeNull();
    expect(report.aiOffFloor).toBeNull();
    expect(report.note).toContain("external");
  });
});
