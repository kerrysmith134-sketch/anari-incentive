/**
 * POLICY ACCEPTANCE GATE — 绩效周期上限（单一来源）
 *
 * 这不是普通单元测试，而是政策验收门禁：
 * - 代码常量（packages/policy-dsl/src/policy-caps.ts）
 * - 机器可读基线（fixtures/policy/performance-caps.json）
 * - 制度依据（docs/POLICY_CAPABILITY_MATRIX_2026.md）
 * - 验收文档（docs/acceptance/policy-caps.md）
 * - 运行时行为（scorePerformance 的实际封顶值）
 *
 * 任一来源被单独修改，门禁即失败。2026-11-25 业务确认按季度 150 /
 * 年度 105 执行；审计提议的 130/150 作为历史提案保留，本门禁断言其未被应用。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  PerformanceMetricSpec,
  PerformancePeriod,
} from "@anari/domain";
import {
  PERFORMANCE_CYCLE_CAPS,
  PERFORMANCE_CYCLE_CAP_APPROVAL,
  div,
  formatDecimal,
  parseDecimal,
  scorePerformance,
} from "../index.js";

interface CapEntry {
  score: string;
  multiplier: string;
}

interface PolicyCapsBaseline {
  $comment: string;
  policyFamily: string;
  unit: string;
  approvedSource: string;
  approvedClauses: string[];
  caps: Record<string, CapEntry>;
  pendingConflicts: Array<{
    id: string;
    raisedBy: string;
    proposal: Record<string, CapEntry>;
    status: string;
    notAppliedReason: string;
    resolvedAt?: string;
    resolution?: string;
  }>;
}

const REPO_ROOT = new URL("../../../../", import.meta.url);
const baselinePath = fileURLToPath(
  new URL("fixtures/policy/performance-caps.json", REPO_ROOT),
);
const matrixPath = fileURLToPath(
  new URL("docs/POLICY_CAPABILITY_MATRIX_2026.md", REPO_ROOT),
);
const acceptanceDocPath = fileURLToPath(
  new URL("docs/acceptance/policy-caps.md", REPO_ROOT),
);

const baseline = JSON.parse(
  readFileSync(baselinePath, "utf8"),
) as PolicyCapsBaseline;

const PERIODS: PerformancePeriod[] = ["MONTHLY", "QUARTERLY", "ANNUAL"];

/** 现行仓库批准口径（不得在无书面确认时变更）。 */
const REPOSITORY_CURRENT_CAPS: Record<PerformancePeriod, CapEntry> = {
  MONTHLY: { score: "110", multiplier: "1.10" },
  QUARTERLY: { score: "150", multiplier: "1.50" },
  ANNUAL: { score: "105", multiplier: "1.05" },
};

const AUDIT_PROPOSAL = baseline.pendingConflicts.find(
  (conflict) => conflict.id === "CAP-AUDIT-2026-11-21",
);

function capProbeMetric(period: PerformancePeriod): PerformanceMetricSpec {
  return {
    metricId: `CAP-PROBE-${period}`,
    name: "周期上限探针",
    period,
    applicableRoles: ["*"],
    weight: "100",
    metricType: "POSITIVE_LINEAR",
    dataSource: "policy acceptance test",
    sourceFields: [],
    calculationRule: "",
    target: "100",
    maxScore: "200",
    ownerRole: "HR",
    evidenceRule: "",
    applicabilityRule: "",
    exceptionRule: "",
    approvalRule: "",
    version: 1,
  };
}

describe("POLICY ACCEPTANCE GATE: performance cycle caps (绩效周期上限单一来源)", () => {
  it("GATE-01 代码上限与机器可读基线完全一致（改一侧不改另一侧即失败）", () => {
    expect(Object.keys(baseline.caps).sort()).toEqual([...PERIODS].sort());
    for (const period of PERIODS) {
      expect(
        PERFORMANCE_CYCLE_CAPS[period],
        `${period} 代码上限 ${PERFORMANCE_CYCLE_CAPS[period]} 与基线 ${baseline.caps[period]?.score} 不一致`,
      ).toBe(baseline.caps[period]?.score);
    }
  });

  it("GATE-02 系数与分数数学一致，且现行口径固定为 110/150/105", () => {
    for (const period of PERIODS) {
      const entry = baseline.caps[period]!;
      expect(parseDecimal(entry.multiplier) * 100n).toBe(
        parseDecimal(entry.score),
      );
      expect(PERFORMANCE_CYCLE_CAPS[period]).toBe(
        REPOSITORY_CURRENT_CAPS[period].score,
      );
      expect(entry).toEqual(REPOSITORY_CURRENT_CAPS[period]);
    }
    expect(baseline.policyFamily).toContain("017/018");
    expect(baseline.unit).toBe(PERFORMANCE_CYCLE_CAP_APPROVAL.unit);
    expect(baseline.approvedSource).toBe(
      PERFORMANCE_CYCLE_CAP_APPROVAL.source,
    );
    expect(baseline.approvedSource).toBe(
      "docs/POLICY_CAPABILITY_MATRIX_2026.md",
    );
  });

  it("GATE-03 审计 1.30/1.50 已决议不采用，未被代码或基线应用", () => {
    expect(AUDIT_PROPOSAL).toBeDefined();
    expect(AUDIT_PROPOSAL!.status).toBe("RESOLVED_KEEP_CURRENT");
    expect(AUDIT_PROPOSAL!.proposal.QUARTERLY?.score).toBe("130");
    expect(AUDIT_PROPOSAL!.proposal.QUARTERLY?.multiplier).toBe("1.30");
    expect(AUDIT_PROPOSAL!.proposal.ANNUAL?.score).toBe("150");
    expect(AUDIT_PROPOSAL!.proposal.ANNUAL?.multiplier).toBe("1.50");
    // 代码与基线必须仍是仓库现行口径，不能静默采用审计值。
    expect(PERFORMANCE_CYCLE_CAPS.QUARTERLY).not.toBe(
      AUDIT_PROPOSAL!.proposal.QUARTERLY?.score,
    );
    expect(PERFORMANCE_CYCLE_CAPS.ANNUAL).not.toBe(
      AUDIT_PROPOSAL!.proposal.ANNUAL?.score,
    );
    expect(baseline.caps.QUARTERLY?.score).not.toBe(
      AUDIT_PROPOSAL!.proposal.QUARTERLY?.score,
    );
    expect(baseline.caps.ANNUAL?.score).not.toBe(
      AUDIT_PROPOSAL!.proposal.ANNUAL?.score,
    );
    expect(PERFORMANCE_CYCLE_CAP_APPROVAL.resolvedConflictId).toBe(
      AUDIT_PROPOSAL!.id,
    );
    expect(AUDIT_PROPOSAL!.resolution).toMatch(/150/);
  });

  it("GATE-04 制度矩阵与验收文档记录同一现行口径", () => {
    const matrix = readFileSync(matrixPath, "utf8");
    expect(matrix).toMatch(/周期上限\s*110\/150\/105/);

    const acceptanceDoc = readFileSync(acceptanceDocPath, "utf8");
    for (const period of PERIODS) {
      const entry = REPOSITORY_CURRENT_CAPS[period];
      expect(acceptanceDoc).toContain(period);
      expect(acceptanceDoc).toContain(entry.score);
      expect(acceptanceDoc).toContain(entry.multiplier);
    }
    expect(acceptanceDoc).toContain("CAP-AUDIT-2026-11-21");
    // PR#3 已按 2026-11-27 审计把冲突状态从 PENDING 改为已决议（消除文档矛盾）：
    // 现行口径保留 110/150/105，外部审计提议（130/150）决议不采纳。
    expect(acceptanceDoc).toContain("DECIDED_NOT_ADOPTED");
    expect(acceptanceDoc).not.toContain("PENDING_BUSINESS_WRITTEN_CONFIRMATION");
    expect(acceptanceDoc).toContain("1.30");
    expect(acceptanceDoc).toContain("2026-11-25 业务确认");
  });

  it("GATE-05 scorePerformance 实际封顶值与基线一致（政策不是文档里的死数字）", () => {
    for (const period of PERIODS) {
      const result = scorePerformance({
        personId: "00000000-0000-4000-8000-000000000001",
        period,
        metrics: [capProbeMetric(period)],
        measurements: [
          {
            metricId: `CAP-PROBE-${period}`,
            rawValue: "200",
            applicable: true,
          },
        ],
      });
      // 200 分的加权总分必须被周期上限截断。
      expect(result.scoreBeforeCap).toBe("200");
      expect(result.cycleCap).toBe(
        formatDecimal(parseDecimal(PERFORMANCE_CYCLE_CAPS[period])),
      );
      expect(result.finalScore).toBe(
        formatDecimal(parseDecimal(baseline.caps[period]!.score)),
      );
      expect(result.kp).toBe(
        formatDecimal(
          div(parseDecimal(PERFORMANCE_CYCLE_CAPS[period]), parseDecimal("100")),
        ),
      );
    }
  });
});
