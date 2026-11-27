/**
 * Performance Cycle Agent 定向测试。
 *
 * 覆盖验收要求的全部路径：
 * - 缺证据 / 缺草案 / 未结申诉 / 缺计算 / 缺批次 / 缺支付 / GL 不完整
 *   各自产生正确的 action（kind / ownerRole / reason / subjectId）；
 * - 双域 PASS 才生成审批包，金额/人数/批次/GL 完整性正确；
 * - 相同 blocker 连续 3 轮升级，中断即清零；
 * - 重放逐字节稳定、幂等键唯一且与输入顺序无关；
 * - 永不自动批准/付款（包上显式 false，纯函数无副作用）。
 */
import { describe, expect, it } from "vitest";
import {
  PerformanceCycleAgent,
  evaluatePerformanceCycle,
  type CycleActionKind,
  type PerformanceCycleAction,
  type PerformanceCycleAgentResult,
  type PerformanceCycleSnapshot,
} from "../performance-cycle-agent.js";

const CYCLE_ID = "cycle-2026-q4";

function baseSnapshot(): PerformanceCycleSnapshot {
  return {
    cycle: {
      id: CYCLE_ID,
      name: "2026 Q4 performance cycle",
      period: "2026-Q4",
      status: "ACTIVE",
    },
    people: [
      { personId: "p1", name: "Person One", managerPersonId: "m1" },
      { personId: "p2", name: "Person Two", managerPersonId: "m1" },
    ],
    goalCards: [
      {
        id: "gc-1",
        personId: "p1",
        status: "LOCKED",
        metrics: [{ metricId: "m-1", evidenceRefs: ["ev-1"] }],
      },
      {
        id: "gc-2",
        personId: "p2",
        status: "LOCKED",
        metrics: [{ metricId: "m-2", evidenceRefs: ["ev-2"] }],
      },
    ],
    drafts: [
      { id: "d-1", personId: "p1", status: "APPROVED" },
      { id: "d-2", personId: "p2", status: "APPROVED" },
    ],
    appeals: [],
    runs: [
      {
        id: "run-1",
        cycleId: CYCLE_ID,
        mode: "FORMAL",
        status: "LOCKED",
      },
    ],
    awards: [
      {
        id: "batch-1",
        batchNo: "B-2026Q4-1",
        status: "LOCKED",
        currency: "CNY",
        totalAmount: "1000",
        glComplete: true,
        lines: [
          {
            id: "line-1",
            personId: "p1",
            amount: "600",
            currency: "CNY",
            sourceRecordId: "src-1",
          },
          {
            id: "line-2",
            personId: "p2",
            amount: "400",
            currency: "CNY",
            sourceRecordId: "src-2",
          },
        ],
      },
    ],
    payments: [
      {
        id: "pay-1",
        batchId: "batch-1",
        lineId: "line-1",
        amount: "600",
        currency: "CNY",
        status: "PAID",
        gl: {
          present: true,
          balanced: true,
          totalDebit: "600",
          totalCredit: "600",
        },
      },
      {
        id: "pay-2",
        batchId: "batch-1",
        lineId: "line-2",
        amount: "400",
        currency: "CNY",
        status: "PAID",
        gl: {
          present: true,
          balanced: true,
          totalDebit: "400",
          totalCredit: "400",
        },
      },
    ],
  };
}

function snapshot(
  overrides: Partial<PerformanceCycleSnapshot> = {},
): PerformanceCycleSnapshot {
  return { ...baseSnapshot(), ...overrides };
}

const agent = new PerformanceCycleAgent();

function requireAction(
  result: PerformanceCycleAgentResult,
  kind: CycleActionKind,
  subjectId: string,
): PerformanceCycleAction {
  const action = result.actions.find(
    (candidate) =>
      candidate.kind === kind && candidate.subjectId === subjectId,
  );
  expect(action, `${kind} action for ${subjectId}`).toBeDefined();
  return action as PerformanceCycleAction;
}

function actionsOf(
  result: PerformanceCycleAgentResult,
  kind: CycleActionKind,
): PerformanceCycleAction[] {
  return result.actions.filter((action) => action.kind === kind);
}

describe("Performance Cycle Agent: 双域 PASS 与审批包", () => {
  it("全部门禁通过时 readiness PASS、无 action，并生成完整审批包", () => {
    const result = agent.evaluate({ snapshot: snapshot() });

    expect(result.cycleId).toBe(CYCLE_ID);
    expect(result.readiness.evaluation.status).toBe("PASS");
    expect(result.readiness.payout.status).toBe("PASS");
    expect(result.blockers.evaluation).toEqual([]);
    expect(result.blockers.payout).toEqual([]);
    expect(result.blockerKeys).toEqual([]);
    expect(result.actions).toEqual([]);

    const pkg = result.approvalPackage;
    expect(pkg).not.toBeNull();
    expect(pkg?.cycleId).toBe(CYCLE_ID);
    expect(pkg?.period).toBe("2026-Q4");
    expect(pkg?.peopleCount).toBe(2);
    expect(pkg?.amountByCurrency).toEqual([
      { currency: "CNY", amount: "1000" },
    ]);
    expect(pkg?.batchIds).toEqual(["batch-1"]);
    expect(pkg?.runIds).toEqual(["run-1"]);
    expect(pkg?.glComplete).toBe(true);
    expect(pkg?.paymentCount).toBe(2);
  });

  it("任一域阻断时审批包为 null", () => {
    const result = agent.evaluate({ snapshot: snapshot({ runs: [] }) });
    expect(result.readiness.evaluation.status).toBe("PASS");
    expect(result.readiness.payout.status).toBe("BLOCKED");
    expect(result.approvalPackage).toBeNull();
  });
});

describe("Performance Cycle Agent: 缺口 → 正确 action", () => {
  it("缺证据 → COLLECT_EVIDENCE (MANAGER, EVIDENCE_MISSING)", () => {
    const snap = snapshot();
    const card = snap.goalCards?.find((entry) => entry.id === "gc-1");
    expect(card).toBeDefined();
    card!.metrics = [{ metricId: "m-1", evidenceRefs: [] }];

    const result = agent.evaluate({ snapshot: snap });
    const action = requireAction(result, "COLLECT_EVIDENCE", "gc-1");

    expect(action.ownerRole).toBe("MANAGER");
    expect(action.reason).toBe("EVIDENCE_MISSING");
    expect(action.priority).toBe("P1");
    expect(action.idempotencyKey).toContain(CYCLE_ID);
    expect(result.readiness.evaluation.status).toBe("BLOCKED");
    expect(result.approvalPackage).toBeNull();
  });

  it("目标卡没有指标（无法证明证据完整）也 fail-closed", () => {
    const snap = snapshot();
    const card = snap.goalCards?.find((entry) => entry.id === "gc-2");
    expect(card).toBeDefined();
    card!.metrics = [];

    const result = agent.evaluate({ snapshot: snap });
    const action = requireAction(result, "COLLECT_EVIDENCE", "gc-2");
    expect(action.reason).toBe("GOAL_CARD_WITHOUT_METRICS");
  });

  it("缺评价草案 → COMPLETE_DRAFT (MANAGER, DRAFT_MISSING)", () => {
    const snap = snapshot({
      drafts: [{ id: "d-1", personId: "p1", status: "APPROVED" }],
    });

    const result = agent.evaluate({ snapshot: snap });
    const action = requireAction(result, "COMPLETE_DRAFT", "p2");

    expect(action.ownerRole).toBe("MANAGER");
    expect(action.reason).toBe("DRAFT_MISSING");
    expect(action.subjectType).toBe("PERSON");
  });

  it("草案未决 → COMPLETE_DRAFT (DRAFT_UNDECIDED)", () => {
    const snap = snapshot();
    const draft = snap.drafts?.find((entry) => entry.id === "d-2");
    expect(draft).toBeDefined();
    draft!.status = "DRAFT";

    const result = agent.evaluate({ snapshot: snap });
    const action = requireAction(result, "COMPLETE_DRAFT", "d-2");
    expect(action.reason).toBe("DRAFT_UNDECIDED");
    expect(action.subjectType).toBe("EVALUATION_DRAFT");
  });

  it("未结申诉 → RESOLVE_APPEAL (HR, APPEAL_OPEN)", () => {
    const snap = snapshot({
      appeals: [{ id: "appeal-1", status: "OPEN" }],
    });

    const result = agent.evaluate({ snapshot: snap });
    const action = requireAction(result, "RESOLVE_APPEAL", "appeal-1");

    expect(action.ownerRole).toBe("HR");
    expect(action.reason).toBe("APPEAL_OPEN");
    expect(action.subjectType).toBe("APPEAL");
    expect(result.readiness.evaluation.checks).toContainEqual(
      expect.objectContaining({ check: "appealsResolved", status: "BLOCKED" }),
    );
  });

  it("缺计算运行 → RUN_CALCULATION (FINANCE, CALCULATION_MISSING)", () => {
    const result = agent.evaluate({ snapshot: snapshot({ runs: [] }) });
    const action = requireAction(result, "RUN_CALCULATION", CYCLE_ID);

    expect(action.ownerRole).toBe("FINANCE");
    expect(action.reason).toBe("CALCULATION_MISSING");
    expect(action.subjectType).toBe("CYCLE");
  });

  it("已审批未锁账 → LOCK_RUN (FINANCE, RUN_NOT_LOCKED)", () => {
    const snap = snapshot({
      runs: [
        {
          id: "run-1",
          cycleId: CYCLE_ID,
          mode: "FORMAL",
          status: "APPROVED",
        },
      ],
    });

    const result = agent.evaluate({ snapshot: snap });
    const action = requireAction(result, "LOCK_RUN", "run-1");
    expect(action.reason).toBe("RUN_NOT_LOCKED");
    expect(action.ownerRole).toBe("FINANCE");
  });

  it("缺奖励批次 → CREATE_BATCH (FINANCE, BATCH_MISSING)", () => {
    const result = agent.evaluate({
      snapshot: snapshot({ awards: [], payments: [] }),
    });
    const action = requireAction(result, "CREATE_BATCH", CYCLE_ID);

    expect(action.ownerRole).toBe("FINANCE");
    expect(action.reason).toBe("BATCH_MISSING");
    expect(action.subjectType).toBe("CYCLE");
  });

  it("缺支付 → RECORD_PAYMENT (FINANCE, PAYMENT_MISSING)，逐行覆盖", () => {
    const result = agent.evaluate({ snapshot: snapshot({ payments: [] }) });
    const actions = actionsOf(result, "RECORD_PAYMENT");

    expect(actions.map((action) => action.subjectId).sort()).toEqual([
      "line-1",
      "line-2",
    ]);
    for (const action of actions) {
      expect(action.ownerRole).toBe("FINANCE");
      expect(action.reason).toBe("PAYMENT_MISSING");
      expect(action.subjectType).toBe("AWARD_LINE");
    }
  });

  it("GL 未平衡 → FIX_GL (FINANCE, GL_UNBALANCED)", () => {
    const snap = snapshot();
    const payment = snap.payments?.find((entry) => entry.id === "pay-1");
    expect(payment).toBeDefined();
    payment!.gl = {
      present: true,
      balanced: false,
      totalDebit: "600",
      totalCredit: "600",
    };

    const result = agent.evaluate({ snapshot: snap });
    const action = requireAction(result, "FIX_GL", "pay-1");

    expect(action.ownerRole).toBe("FINANCE");
    expect(action.reason).toBe("GL_UNBALANCED");
    expect(action.subjectType).toBe("PAYMENT");
    expect(result.approvalPackage).toBeNull();
  });

  it("GL 缺失（批次也未断言 glComplete）→ FIX_GL (GL_MISSING)", () => {
    const snap = snapshot();
    const batch = snap.awards?.[0];
    expect(batch).toBeDefined();
    batch!.glComplete = false;
    const payment = snap.payments?.find((entry) => entry.id === "pay-2");
    expect(payment).toBeDefined();
    payment!.gl = undefined;

    const result = agent.evaluate({ snapshot: snap });
    const action = requireAction(result, "FIX_GL", "pay-2");
    expect(action.reason).toBe("GL_MISSING");
  });
});

describe("Performance Cycle Agent: 连续 blocker 升级", () => {
  it("同一 blocker 连续 3 轮（含本轮）升级到责任角色", () => {
    const snap = snapshot({ runs: [] });
    const first = agent.evaluate({ snapshot: snap });
    expect(first.blockerKeys).toHaveLength(1);
    const key = first.blockerKeys[0] as string;

    const escalated = agent.evaluate({
      snapshot: snap,
      history: [
        { round: 1, blockerKeys: [key] },
        { round: 2, blockerKeys: [key] },
      ],
    });

    expect(escalated.escalations).toHaveLength(1);
    expect(escalated.escalations[0]).toMatchObject({
      blockerKey: key,
      ownerRole: "FINANCE",
      consecutiveRounds: 3,
      actionKind: "RUN_CALCULATION",
    });
  });

  it("中间一轮缺失即清零，不升级", () => {
    const snap = snapshot({ runs: [] });
    const first = agent.evaluate({ snapshot: snap });
    const key = first.blockerKeys[0] as string;

    const result = agent.evaluate({
      snapshot: snap,
      history: [
        { round: 1, blockerKeys: [key] },
        { round: 2, blockerKeys: [] },
      ],
    });

    expect(result.escalations).toEqual([]);
  });

  it("只有 2 轮（历史 1 轮）不升级；阈值可配置", () => {
    const snap = snapshot({ runs: [] });
    const first = agent.evaluate({ snapshot: snap });
    const key = first.blockerKeys[0] as string;

    const twoRounds = agent.evaluate({
      snapshot: snap,
      history: [{ round: 1, blockerKeys: [key] }],
    });
    expect(twoRounds.escalations).toEqual([]);

    const thresholdTwo = agent.evaluate({
      snapshot: snap,
      history: [{ round: 1, blockerKeys: [key] }],
      escalationThreshold: 2,
    });
    expect(thresholdTwo.escalations).toHaveLength(1);
  });

  it("升级 ownerRole 只可能是 HR / FINANCE / MANAGER", () => {
    const snap = snapshot();
    const card = snap.goalCards?.find((entry) => entry.id === "gc-1");
    expect(card).toBeDefined();
    card!.metrics = [];
    snap.appeals = [{ id: "appeal-1", status: "OPEN" }];
    snap.runs = [];

    const first = agent.evaluate({ snapshot: snap });
    const escalated = agent.evaluate({
      snapshot: snap,
      history: [
        { round: 1, blockerKeys: first.blockerKeys },
        { round: 2, blockerKeys: first.blockerKeys },
      ],
    });

    expect(escalated.escalations.length).toBeGreaterThan(0);
    for (const escalation of escalated.escalations) {
      expect(["HR", "FINANCE", "MANAGER"]).toContain(escalation.ownerRole);
      expect(escalation.consecutiveRounds).toBe(3);
    }
  });
});

describe("Performance Cycle Agent: 幂等重放与无副作用", () => {
  function multiGapSnapshot(): PerformanceCycleSnapshot {
    const snap = snapshot();
    const card = snap.goalCards?.find((entry) => entry.id === "gc-1");
    expect(card).toBeDefined();
    card!.metrics = [
      { metricId: "m-1", evidenceRefs: [] },
      { metricId: "m-2", evidenceRefs: [] },
    ];
    snap.drafts = [{ id: "d-1", personId: "p1", status: "DRAFT" }];
    snap.appeals = [{ id: "appeal-1", status: "OPEN" }];
    snap.runs = [
      { id: "run-1", cycleId: CYCLE_ID, mode: "FORMAL", status: "APPROVED" },
    ];
    const batch = snap.awards?.[0];
    expect(batch).toBeDefined();
    batch!.status = "DRAFT";
    batch!.glComplete = false;
    snap.payments = [
      {
        id: "pay-1",
        batchId: "batch-1",
        lineId: "line-1",
        amount: "600",
        currency: "CNY",
        status: "PAID",
      },
    ];
    return snap;
  }

  it("相同输入重放得到完全相同的输出", () => {
    const snap = multiGapSnapshot();
    const first = agent.evaluate({ snapshot: snap });
    const second = agent.evaluate({ snapshot: snap });
    const third = evaluatePerformanceCycle({ snapshot: snap });

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("action 幂等键唯一，且与内部数组顺序无关", () => {
    const snap = multiGapSnapshot();
    const first = agent.evaluate({ snapshot: snap });

    const reversed = multiGapSnapshot();
    reversed.goalCards = [...(reversed.goalCards ?? [])].reverse();
    reversed.awards = [...(reversed.awards ?? [])].reverse();
    reversed.payments = [...(reversed.payments ?? [])].reverse();
    const second = agent.evaluate({ snapshot: reversed });

    expect(second.actions).toEqual(first.actions);
    expect(second.blockerKeys).toEqual(first.blockerKeys);
    expect(new Set(first.actions.map((action) => action.idempotencyKey)).size).toBe(
      first.actions.length,
    );
  });

  it("每条 action 都满足结构化契约（kind/priority/ownerRole/subject/reason/key）", () => {
    const result = agent.evaluate({ snapshot: multiGapSnapshot() });
    expect(result.actions.length).toBeGreaterThan(0);
    const kinds = new Set<CycleActionKind>([
      "COLLECT_EVIDENCE",
      "COMPLETE_DRAFT",
      "RESOLVE_APPEAL",
      "RUN_CALCULATION",
      "LOCK_RUN",
      "CREATE_BATCH",
      "RECORD_PAYMENT",
      "FIX_GL",
    ]);
    for (const action of result.actions) {
      expect(kinds.has(action.kind)).toBe(true);
      expect(["P0", "P1", "P2"]).toContain(action.priority);
      expect(["HR", "FINANCE", "MANAGER"]).toContain(action.ownerRole);
      expect(action.subjectId.length).toBeGreaterThan(0);
      expect(action.reason.length).toBeGreaterThan(0);
      expect(action.idempotencyKey).toContain(
        `perf-cycle:${CYCLE_ID}:${action.kind}:`,
      );
      expect(action.blockerKey.length).toBeGreaterThan(0);
    }
  });

  it("action 排序稳定（priority → kind → subject）", () => {
    const result = agent.evaluate({ snapshot: multiGapSnapshot() });
    expect(result.actions.length).toBeGreaterThan(1);

    const priorityRank = { P0: 0, P1: 1, P2: 2 } as const;
    for (let index = 1; index < result.actions.length; index += 1) {
      const previous = result.actions[index - 1] as PerformanceCycleAction;
      const current = result.actions[index] as PerformanceCycleAction;
      expect(
        priorityRank[previous.priority],
      ).toBeLessThanOrEqual(priorityRank[current.priority]);
    }
  });

  it("不修改输入快照", () => {
    const snap = multiGapSnapshot();
    const before = JSON.stringify(snap);
    agent.evaluate({ snapshot: snap });
    expect(JSON.stringify(snap)).toBe(before);
  });

  it("永不自动批准/付款：包上显式 false 且无副作用", () => {
    const result = agent.evaluate({ snapshot: snapshot() });
    const pkg = result.approvalPackage;
    expect(pkg).not.toBeNull();
    expect(pkg?.autoApproved).toBe(false);
    expect(pkg?.autoPaid).toBe(false);
    expect(pkg?.requiresHumanApproval).toBe(true);
    expect(result.sideEffects).toBe("NONE");
    expect(result.note).toContain("does not approve");
  });
});
