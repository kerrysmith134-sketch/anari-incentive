/**
 * NPV2-009 / AUD-022：试点影子周期验收指标（纯函数）。
 *
 * 覆盖：五项指标 PASS/FAIL/N/A 三态、口径边界（角色小样本 N/A、无运行
 * FAIL、精度微单位、窗口外申报不计）。
 */
import { describe, expect, it } from "vitest";
import {
  amountToMicros,
  computePilotMetrics,
  type PilotMetricInputs,
} from "../scripts/pilot-metrics.js";

const CYCLE = {
  id: "cycle-1",
  startsAt: "2026-10-01T00:00:00.000Z",
  endsAt: "2026-10-31T23:59:59.999Z",
};

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const WP = "00000000-0000-4000-8000-000000000010";

function baseInputs(overrides: Partial<PilotMetricInputs> = {}): PilotMetricInputs {
  return {
    cycle: CYCLE,
    facts: [
      {
        amount: "100000.00",
        currency: "CNY",
        qualityStatus: "VALID",
        factType: "GROSS_PROFIT",
        postingStatus: "POSTED",
        orderId: "SO-001",
        payload: { cycleId: CYCLE.id },
      },
    ],
    benchmarkRun: {
      id: "run-1",
      mode: "FORMAL",
      status: "LOCKED",
      orderGrossProfit: "100000",
      currency: "CNY",
    },
    claims: [
      {
        id: "c1",
        workPackageId: WP,
        claimantPersonId: OWNER,
        status: "CONFIRMED",
        createdAt: "2026-10-05T00:00:00.000Z",
        submittedAt: "2026-10-05T00:00:00.000Z",
        evidenceRefs: ["ev-1"],
      },
      {
        id: "c2",
        workPackageId: WP,
        claimantPersonId: MEMBER,
        status: "CONFIRMED",
        createdAt: "2026-10-06T00:00:00.000Z",
        submittedAt: "2026-10-06T00:00:00.000Z",
        evidenceRefs: ["ev-2"],
      },
    ],
    workPackages: [
      {
        id: WP,
        members: [
          { personId: OWNER, responsibilityCode: "OWNER" },
          { personId: MEMBER, responsibilityCode: "CONTRIBUTOR" },
        ],
      },
    ],
    evidence: [
      {
        id: "ev-1",
        subjectType: "WORK_PACKAGE",
        subjectId: WP,
        createdAt: "2026-10-05T00:10:00.000Z",
      },
      {
        id: "ev-2",
        subjectType: "WORK_PACKAGE",
        subjectId: WP,
        createdAt: "2026-10-06T00:20:00.000Z",
      },
    ],
    drafts: [
      { id: "d1", personId: OWNER, cycleId: CYCLE.id, createdAt: "2026-10-10T09:00:00.000Z" },
      { id: "d2", personId: MEMBER, cycleId: CYCLE.id, createdAt: "2026-10-10T09:00:00.000Z" },
    ],
    decisions: [
      { id: "dec1", personId: OWNER, cycleId: CYCLE.id, createdAt: "2026-10-10T09:30:00.000Z" },
      { id: "dec2", personId: MEMBER, cycleId: CYCLE.id, createdAt: "2026-10-10T10:00:00.000Z" },
    ],
    ...overrides,
  };
}

describe("AUD-022 pilot metrics", () => {
  it("干净试点：五项全 PASS（财务差异 0、覆盖 100%、补证 10/20min、复核 30/60min、0 争议）", () => {
    const report = computePilotMetrics(baseInputs());
    expect(report.financial.verdict).toBe("PASS");
    expect(report.financial.deltaMicros).toBe("0");
    expect(report.evidenceCoverage.overall.rate).toBe(1);
    // 两个角色各 1 单（<3 样本）→ 角色层 N/A，总体 PASS
    expect(report.evidenceCoverage.byRole.OWNER?.verdict).toBe("N/A");
    expect(report.evidenceCoverage.overall.verdict).toBe("PASS");
    expect(report.supplement.medianMinutes).toBe(15); // (10+20)/2
    expect(report.supplement.verdict).toBe("PASS");
    expect(report.review.medianMinutes).toBe(45); // (30+60)/2
    expect(report.review.verdict).toBe("PASS");
    expect(report.dispute.verdict).toBe("PASS");
    expect(report.pass).toBe(true);
  });

  it("无正式运行 → 财务 FAIL；差异非零 → FAIL（微单位整数判定）", () => {
    const noRun = computePilotMetrics(baseInputs({ benchmarkRun: undefined }));
    expect(noRun.financial.verdict).toBe("FAIL");
    expect(noRun.financial.detail).toContain("no FORMAL");
    expect(noRun.pass).toBe(false);

    const variant = computePilotMetrics(
      baseInputs({
        benchmarkRun: {
          id: "run-1",
          mode: "FORMAL",
          status: "LOCKED",
          orderGrossProfit: "99999.999999",
          currency: "CNY",
        },
      }),
    );
    expect(variant.financial.deltaMicros).toBe("1"); // 0.000001 也被抓住
    expect(variant.financial.verdict).toBe("FAIL");
  });

  it("SHADOW/未锁定运行不能当基准 → FAIL", () => {
    const shadow = computePilotMetrics(
      baseInputs({
        benchmarkRun: {
          id: "run-shadow",
          mode: "SHADOW",
          status: "LOCKED",
          orderGrossProfit: "100000",
        },
      }),
    );
    expect(shadow.financial.verdict).toBe("FAIL");
  });

  it("证据覆盖按角色分层：角色样本 ≥3 且低于 70% → FAIL", () => {
    const claims = Array.from({ length: 4 }, (_, index) => ({
      id: `c${index}`,
      workPackageId: WP,
      claimantPersonId: MEMBER,
      status: "CONFIRMED",
      createdAt: "2026-10-05T00:00:00.000Z",
      submittedAt: "2026-10-05T00:00:00.000Z",
      evidenceRefs: index === 0 ? ["ev-2"] : [],
    }));
    const report = computePilotMetrics(
      baseInputs({
        claims,
        evidence: [
          { id: "ev-2", subjectType: "WORK_PACKAGE", subjectId: WP, createdAt: "2026-10-05T00:20:00.000Z" },
        ],
      }),
    );
    // WP 有证据节点 → 4 单全部计覆盖；换一个没有证据的 WP 验证真 FAIL
    const report2 = computePilotMetrics(
      baseInputs({
        claims: claims.map((claim) => ({ ...claim, workPackageId: "wp-empty" })),
        workPackages: [
          ...baseInputs().workPackages,
          { id: "wp-empty", members: [{ personId: MEMBER, responsibilityCode: "CONTRIBUTOR" }] },
        ],
        evidence: [],
      }),
    );
    // NP-016：WP 级证据不再覆盖所有 claim——4 单只有 1 单带 refs。
    expect(report.evidenceCoverage.overall.rate).toBe(0.25);
    expect(report2.evidenceCoverage.byRole.CONTRIBUTOR?.verdict).toBe("FAIL");
    expect(report2.evidenceCoverage.overall.verdict).toBe("FAIL");
    // 4 单里仅 1 单带 evidenceRefs（其余依赖 WP 证据，但该 WP 无证据）→ 25%
    expect(report2.evidenceCoverage.byRole.CONTRIBUTOR?.rate).toBe(0.25);
  });

  it("争议率 ≥10% → FAIL；窗口外申报不计入分母", () => {
    const base = baseInputs();
    const disputed = {
      ...base.claims[0]!,
      id: "c-dispute",
      status: "APPEALED",
    };
    const report = computePilotMetrics(
      baseInputs({ claims: [...base.claims, disputed] }),
    );
    // 1/3 ≈ 0.3333 ≥ 0.1 → FAIL
    expect(report.dispute.verdict).toBe("FAIL");
    expect(report.dispute.rate).toBeCloseTo(0.3333, 4);

    const outside = computePilotMetrics(
      baseInputs({
        claims: [
          ...base.claims,
          { ...disputed, id: "c-out", createdAt: "2026-11-15T00:00:00.000Z" },
        ],
      }),
    );
    expect(outside.dispute.total).toBe(2); // 窗口外不计入分母
    expect(outside.dispute.disputed).toBe(0); // 窗口外的争议也不计入
    expect(outside.dispute.verdict).toBe("PASS");
  });

  it("补证时长超 30min / 复核超 2h → FAIL；无样本 → N/A", () => {
    const slow = computePilotMetrics(
      baseInputs({
        evidence: [
          { id: "ev-1", subjectType: "WORK_PACKAGE", subjectId: WP, createdAt: "2026-10-05T01:00:00.000Z" },
          { id: "ev-2", subjectType: "WORK_PACKAGE", subjectId: WP, createdAt: "2026-10-06T01:00:00.000Z" },
        ],
        decisions: [
          { id: "dec1", personId: OWNER, cycleId: CYCLE.id, createdAt: "2026-10-10T15:00:00.000Z" }, // 6h
          { id: "dec2", personId: MEMBER, cycleId: CYCLE.id, createdAt: "2026-10-10T15:00:00.000Z" },
        ],
      }),
    );
    expect(slow.supplement.medianMinutes).toBe(60);
    expect(slow.supplement.verdict).toBe("FAIL");
    expect(slow.review.medianMinutes).toBe(360);
    expect(slow.review.verdict).toBe("FAIL");
    expect(slow.pass).toBe(false);

    const noSamples = computePilotMetrics(
      baseInputs({
        evidence: [],
        claims: baseInputs().claims.map((claim) => ({ ...claim, evidenceRefs: [] })),
        decisions: [],
      }),
    );
    expect(noSamples.supplement.verdict).toBe("N/A");
    expect(noSamples.review.verdict).toBe("N/A");
    // 证据覆盖为 0 且样本 2（总体 <70%）→ FAIL，整体不通过
    expect(noSamples.evidenceCoverage.overall.verdict).toBe("FAIL");
  });

  it("NP-008：无财务事实不得 PASS；混币种不得相加", () => {
    const noFacts = computePilotMetrics(baseInputs({ facts: [] }));
    expect(noFacts.financial.verdict).toBe("FAIL");
    expect(noFacts.financial.detail).toContain("no financial facts");
    expect(noFacts.pass).toBe(false);

    const mixed = computePilotMetrics(
      baseInputs({
        facts: [
          { amount: "100000", currency: "CNY", qualityStatus: "VALID", factType: "GROSS_PROFIT", postingStatus: "POSTED", orderId: "SO-001", payload: { cycleId: CYCLE.id } },
          { amount: "10", currency: "USD", qualityStatus: "VALID", factType: "GROSS_PROFIT", postingStatus: "POSTED", orderId: "SO-002", payload: { cycleId: CYCLE.id } },
        ],
      }),
    );
    expect(mixed.financial.verdict).toBe("FAIL");
    expect(mixed.financial.detail).toContain("mixed");
  });

  it("NP-018：复核时长优先使用 reviewStartedAt", () => {
    const report = computePilotMetrics(
      baseInputs({
        decisions: [
          {
            id: "dec1",
            personId: OWNER,
            cycleId: CYCLE.id,
            createdAt: "2026-10-10T09:30:00.000Z",
            reviewStartedAt: "2026-10-10T09:10:00.000Z",
          },
          {
            id: "dec2",
            personId: MEMBER,
            cycleId: CYCLE.id,
            createdAt: "2026-10-10T10:00:00.000Z",
            reviewStartedAt: "2026-10-10T09:30:00.000Z",
          },
        ],
      }),
    );
    // 20min 与 30min → 中位 25（使用 reviewStartedAt 而非草案创建时间）
    expect(report.review.medianMinutes).toBe(25);
    expect(report.review.verdict).toBe("PASS");
  });

  it("NP-ALGO-001: COST/REFUND 桥接披露不参与毛利对比；DRAFT 排除并计入", () => {
    const report = computePilotMetrics(
      baseInputs({
        facts: [
          { amount: "100000", currency: "CNY", qualityStatus: "VALID", factType: "GROSS_PROFIT", postingStatus: "POSTED", orderId: "SO-001", payload: { cycleId: CYCLE.id } },
          { amount: "5000", currency: "CNY", qualityStatus: "VALID", factType: "COST", postingStatus: "POSTED", orderId: "SO-001", payload: { cycleId: CYCLE.id } },
          { amount: "2000", currency: "CNY", qualityStatus: "VALID", factType: "REFUND", postingStatus: "POSTED", orderId: "SO-001", payload: { cycleId: CYCLE.id } },
        ],
        benchmarkRun: {
          id: "run-1", mode: "FORMAL", status: "LOCKED", orderGrossProfit: "100000", currency: "CNY",
        },
      }),
    );
    // COST/REFUND 不再被错误计入毛利对比（此前 107000 ≠ 100000 会 FAIL）
    expect(report.financial.verdict).toBe("PASS");
    expect(report.financial.deltaMicros).toBe("0");
    expect(report.financial.bridgeByType.COST?.count).toBe(1);
    expect(report.financial.bridgeByType.REFUND?.count).toBe(1);
  });

  it("NP-ALGO-001: DRAFT 过账状态的事实不参与对账并计入排除数", () => {
    const report = computePilotMetrics(
      baseInputs({
        facts: [
          { amount: "100000", currency: "CNY", qualityStatus: "VALID", factType: "GROSS_PROFIT", postingStatus: "POSTED", orderId: "SO-001", payload: { cycleId: CYCLE.id } },
          { amount: "999999", currency: "CNY", qualityStatus: "VALID", factType: "GROSS_PROFIT", postingStatus: "DRAFT", orderId: "SO-001", payload: { cycleId: CYCLE.id } },
        ],
      }),
    );
    expect(report.financial.verdict).toBe("PASS");
    expect(report.financial.draftExcluded).toBe(1);
  });

  it("does not infer cycle attribution from an overlapping accounting period", () => {
    const report = computePilotMetrics(
      baseInputs({
        facts: [
          {
            amount: "100000",
            currency: "CNY",
            qualityStatus: "VALID",
            factType: "GROSS_PROFIT",
            postingStatus: "POSTED",
            orderId: "SO-001",
            periodStart: "2026-10-01",
            periodEnd: "2026-10-31",
            payload: {},
          },
        ],
      }),
    );
    expect(report.financial.verdict).toBe("FAIL");
    expect(report.financial.detail).toContain("explicitly attributed");
  });

  it("a cycle containing only DRAFT gross-profit facts cannot pass the financial gate", () => {
    const report = computePilotMetrics(
      baseInputs({
        facts: [
          {
            amount: "100000",
            currency: "CNY",
            qualityStatus: "VALID",
            factType: "GROSS_PROFIT",
            postingStatus: "DRAFT",
            orderId: "SO-001",
            payload: { cycleId: CYCLE.id },
          },
        ],
      }),
    );
    expect(report.financial.verdict).toBe("FAIL");
    expect(report.financial.declaredMicros).toBe("0");
    expect(report.financial.detail).toContain("no POSTED");
    expect(report.financial.draftExcluded).toBe(1);
  });

  it("金额严格解析：>6 位小数/非数字直接报错（不静默丢精度）", () => {
    expect(amountToMicros("100000.00")).toBe(100_000_000_000n);
    expect(amountToMicros("-0.000001")).toBe(-1n);
    expect(() => amountToMicros("0.0000001")).toThrow("more than 6");
    expect(() => amountToMicros("12,34")).toThrow("invalid amount");
  });
});
