/**
 * Cycle Readiness 审计缺陷回归（NPV2-026 加固）。
 *
 * 覆盖三处门禁收紧：
 * - 评价门禁：DRAFT 未提交草案同样阻断（不只是 SUBMITTED）；
 * - 申诉门禁：open appeal = BLOCKED（不再 WARN）；
 * - 计算门禁：周期内**所有** FORMAL run 均 APPROVED/LOCKED 且至少一个
 *   LOCKED 才 PASS（不再"存在一个已审批 run"就放行）。
 *
 * 这些门禁直接决定周期能否进入锁账/结算，故必须有定向回归。（本工作流
 * 本身仍是只读：测试断言 note 声明不锁账、不结算。）
 */
import { describe, expect, it } from "vitest";
import { CycleReadinessWorkflow } from "../cycle-readiness.js";
import type { AgentContext } from "../types.js";

const CYCLE = "cycle-t";

interface FakeRun {
  id: string;
  cycleId: string;
  policyVersionId?: string;
  mode: "FORMAL" | "SHADOW";
  status: string;
  blockers: string[];
}

interface FakeDraft {
  id: string;
  status: string;
}

interface FakeAppeal {
  id: string;
  status: string;
}

function formalRun(overrides: Partial<FakeRun> = {}): FakeRun {
  return {
    id: "run-1",
    cycleId: CYCLE,
    policyVersionId: "pv-1",
    mode: "FORMAL",
    status: "LOCKED",
    blockers: [],
    ...overrides,
  };
}

function makeContext(
  input: {
    runs?: FakeRun[];
    drafts?: FakeDraft[];
    appeals?: FakeAppeal[];
  } = {},
): AgentContext {
  const runs = input.runs ?? [formalRun()];
  const drafts = input.drafts ?? [
    { id: "draft-1", status: "APPROVED" as const },
  ];
  const appeals = input.appeals ?? [];

  const context = {
    async listRuns() {
      return runs;
    },
    async listDataQualityIssues() {
      return [];
    },
    async getPolicy(policyVersionId: string) {
      if (policyVersionId !== "pv-1") {
        throw new Error(`policy ${policyVersionId} not published`);
      }
      return { code: "TEST_POLICY", version: 1 };
    },
    async getLegalGate(policyVersionId: string) {
      return policyVersionId === "pv-1"
        ? {
            policyVersionId,
            democraticProcedureRef: "dp-1",
            employeeNoticeRef: "notice-1",
            dataProtectionAssessmentRef: "dpia-1",
            minimumWageChecked: true,
            policyApproved: true,
            recordedBy: "reviewer",
            recordedAt: "2026-01-01T00:00:00.000Z",
          }
        : undefined;
    },
    async listEvaluationDrafts() {
      return drafts;
    },
    async listAppeals() {
      return appeals;
    },
  };

  return context as unknown as AgentContext;
}

function checkFor(
  report: Awaited<ReturnType<CycleReadinessWorkflow["run"]>>,
  gate: string,
) {
  const check = report.checks.find((entry) => entry.gate === gate);
  if (!check) throw new Error(`missing gate ${gate}`);
  return check;
}

describe("Cycle Readiness — 评价门禁（DRAFT 未决草案同样阻断）", () => {
  it("DRAFT（未提交）草案 → EVALUATION BLOCKED，周期不可就绪", async () => {
    const report = await new CycleReadinessWorkflow(
      makeContext({ drafts: [{ id: "draft-d", status: "DRAFT" }] }),
    ).run({ cycleId: CYCLE });

    const evaluation = checkFor(report, "EVALUATION");
    expect(evaluation.status).toBe("BLOCKED");
    expect(evaluation.detail).toContain("DRAFT");
    expect(evaluation.sources).toEqual([
      { type: "EVALUATION_DRAFT", id: "draft-d" },
    ]);
    expect(report.ready).toBe(false);
  });

  it("SUBMITTED 草案 → EVALUATION BLOCKED，周期不可就绪", async () => {
    const report = await new CycleReadinessWorkflow(
      makeContext({ drafts: [{ id: "draft-s", status: "SUBMITTED" }] }),
    ).run({ cycleId: CYCLE });

    const evaluation = checkFor(report, "EVALUATION");
    expect(evaluation.status).toBe("BLOCKED");
    expect(evaluation.detail).toContain("SUBMITTED");
    expect(report.ready).toBe(false);
  });

  it("全部议案已决（APPROVED/REJECTED）→ EVALUATION PASS，周期可就绪", async () => {
    const report = await new CycleReadinessWorkflow(
      makeContext({
        drafts: [
          { id: "draft-a", status: "APPROVED" },
          { id: "draft-r", status: "REJECTED" },
        ],
      }),
    ).run({ cycleId: CYCLE });

    expect(checkFor(report, "EVALUATION").status).toBe("PASS");
    expect(report.ready).toBe(true);
  });

  it("未识别状态按未决处理（fail-closed），不静默放行", async () => {
    const report = await new CycleReadinessWorkflow(
      makeContext({ drafts: [{ id: "draft-x", status: "RECALCULATION_REQUIRED" }] }),
    ).run({ cycleId: CYCLE });

    const evaluation = checkFor(report, "EVALUATION");
    expect(evaluation.status).toBe("BLOCKED");
    expect(evaluation.detail).toContain("RECALCULATION_REQUIRED");
    expect(report.ready).toBe(false);
  });

  it("无草案仍为 NOT_MEASURABLE（既有策略不变）", async () => {
    const report = await new CycleReadinessWorkflow(
      makeContext({ drafts: [] }),
    ).run({ cycleId: CYCLE });

    expect(checkFor(report, "EVALUATION").status).toBe("NOT_MEASURABLE");
    expect(report.ready).toBe(false);
  });
});

describe("Cycle Readiness — 申诉门禁（open appeal 阻断）", () => {
  it("存在 open appeal → APPEAL BLOCKED 并说明影响最终金额结算", async () => {
    const report = await new CycleReadinessWorkflow(
      makeContext({
        appeals: [
          { id: "appeal-open", status: "OPEN" },
          { id: "appeal-review", status: "UNDER_REVIEW" },
        ],
      }),
    ).run({ cycleId: CYCLE });

    const appeal = checkFor(report, "APPEAL");
    expect(appeal.status).toBe("BLOCKED");
    expect(appeal.detail).toContain("settlement");
    expect(appeal.sources).toEqual([
      { type: "APPEAL", id: "appeal-open" },
      { type: "APPEAL", id: "appeal-review" },
    ]);
    expect(report.ready).toBe(false);
  });

  it("申诉全部 DECIDED/CLOSED → APPEAL PASS，周期可就绪", async () => {
    const report = await new CycleReadinessWorkflow(
      makeContext({
        appeals: [
          { id: "appeal-decided", status: "DECIDED" },
          { id: "appeal-closed", status: "CLOSED" },
        ],
      }),
    ).run({ cycleId: CYCLE });

    expect(checkFor(report, "APPEAL").status).toBe("PASS");
    expect(report.ready).toBe(true);
  });
});

describe("Cycle Readiness — 计算门禁（全部 FORMAL run 必须定稿且至少一个 LOCKED）", () => {
  it("LOCKED + NEEDS_REVIEW 混合 → CALCULATION BLOCKED，周期不可就绪", async () => {
    const report = await new CycleReadinessWorkflow(
      makeContext({
        runs: [
          formalRun({ id: "run-locked", status: "LOCKED" }),
          formalRun({ id: "run-review", status: "NEEDS_REVIEW" }),
        ],
      }),
    ).run({ cycleId: CYCLE });

    const calculation = checkFor(report, "CALCULATION");
    expect(calculation.status).toBe("BLOCKED");
    expect(calculation.detail).toContain("NEEDS_REVIEW");
    expect(report.ready).toBe(false);
  });

  it("BLOCKED / REVIEW / REJECTED / DRAFT 类未定稿 run 任一存在 → BLOCKED", async () => {
    for (const status of [
      "BLOCKED",
      "REJECTED",
      "DRAFT",
      "REVERSED",
      "CREATED",
      "CALCULATED",
    ]) {
      const report = await new CycleReadinessWorkflow(
        makeContext({
          runs: [
            formalRun({ id: "run-locked", status: "LOCKED" }),
            formalRun({ id: "run-bad", status }),
          ],
        }),
      ).run({ cycleId: CYCLE });

      expect(checkFor(report, "CALCULATION").status).toBe("BLOCKED");
      expect(report.ready).toBe(false);
    }
  });

  it("全部 FORMAL run 均 LOCKED → CALCULATION PASS，周期可就绪", async () => {
    const report = await new CycleReadinessWorkflow(
      makeContext({
        runs: [
          formalRun({ id: "run-1", status: "LOCKED" }),
          formalRun({ id: "run-2", status: "LOCKED" }),
        ],
      }),
    ).run({ cycleId: CYCLE });

    expect(checkFor(report, "CALCULATION").status).toBe("PASS");
    expect(report.ready).toBe(true);
  });

  it("全部 APPROVED 但无一 LOCKED → BLOCKED（要求至少一个 LOCKED）", async () => {
    const report = await new CycleReadinessWorkflow(
      makeContext({
        runs: [formalRun({ id: "run-approved", status: "APPROVED" })],
      }),
    ).run({ cycleId: CYCLE });

    const calculation = checkFor(report, "CALCULATION");
    expect(calculation.status).toBe("BLOCKED");
    expect(calculation.detail).toContain("none locked");
    expect(report.ready).toBe(false);
  });

  it("APPROVED + LOCKED 组合 → PASS（两者都算定稿）", async () => {
    const report = await new CycleReadinessWorkflow(
      makeContext({
        runs: [
          formalRun({ id: "run-approved", status: "APPROVED" }),
          formalRun({ id: "run-locked", status: "LOCKED" }),
        ],
      }),
    ).run({ cycleId: CYCLE });

    expect(checkFor(report, "CALCULATION").status).toBe("PASS");
    expect(report.ready).toBe(true);
  });

  it("只有 SHADOW run → NOT_MEASURABLE（影子运行不充当计算门禁）", async () => {
    const report = await new CycleReadinessWorkflow(
      makeContext({
        runs: [formalRun({ id: "run-shadow", mode: "SHADOW", status: "LOCKED" })],
      }),
    ).run({ cycleId: CYCLE });

    expect(checkFor(report, "CALCULATION").status).toBe("NOT_MEASURABLE");
    expect(report.ready).toBe(false);
  });
});

describe("Cycle Readiness — ready 语义与只读红线", () => {
  it("单门禁 BLOCKED 即不可就绪（即使其余门禁 PASS）", async () => {
    const report = await new CycleReadinessWorkflow(
      makeContext({ appeals: [{ id: "appeal-x", status: "TRIAGED" }] }),
    ).run({ cycleId: CYCLE });

    expect(report.checks.filter((check) => check.status !== "PASS")).toEqual([
      expect.objectContaining({ gate: "APPEAL", status: "BLOCKED" }),
    ]);
    expect(report.ready).toBe(false);
  });

  it("全部 PASS → ready，且报告声明不锁账/不结算", async () => {
    const report = await new CycleReadinessWorkflow(makeContext()).run({
      cycleId: CYCLE,
    });

    expect(report.checks.every((check) => check.status === "PASS")).toBe(true);
    expect(report.ready).toBe(true);
    expect(report.note).toContain("does not lock");
  });

  it("不再产出 WARN 状态（申诉门禁已改为阻断）", async () => {
    const report = await new CycleReadinessWorkflow(
      makeContext({ appeals: [{ id: "appeal-open", status: "OPEN" }] }),
    ).run({ cycleId: CYCLE });

    expect(report.checks.some((check) => check.status === "WARN")).toBe(false);
  });
});
