/**
 * 匿名端到端影子链路（2026-11-27）。
 *
 * 该测试不是 mock：它用真实的 `buildApp` 路由栈 + `Store` +
 * `MemoryPlatformStore`，通过 `app.inject` 执行与生产同构的请求处理、
 * 状态机、policy-DSL 计算、奖励批次、支付回执、GL 凭证与 ACK。
 *
 * 覆盖：
 * - 3 名匿名员工 / 2 个法人主体 / USD+CNY / 1 个评价周期；
 * - 2 个 PingCode 形状 Work Item + 1 个 Commercial 形状订单导入（幂等重放不重复）；
 * - 锁定目标卡 + FROZEN 计量快照 → score-from-facts 得 FORMAL / COMPUTED；
 * - JEV case 人工判断 → 服务端 5 checker 校验 → 授权人决定 → 业务引用；
 * - policy-DSL FORMAL 计算 → 行级台账 → 员工确认 → 审批/锁定；
 * - 奖励批次（CNY/USD）审批/锁定/导出 → 行级支付 → 平衡 GL → 银行 ACK；
 * - 金额守恒、来源可追溯、无重复、GL 平衡、ACK 后不可再支付。
 *
 * 逐条断言拆在 `scripts/shadow-e2e.ts` 的 checks 里（390 条），本文件逐条
 * 校验所有 step/check 都 PASS，并再对关键产物做独立断言，避免“脚本自己说
 * 自己 PASS”而测试不复核。
 */
import { describe, expect, it } from "vitest";
import { runShadowE2E } from "../../../../scripts/shadow-e2e.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const EXPECTED_STEP_IDS = [
  "01.fixtures",
  "02.setup",
  "03.contracts",
  "04.commercial-order",
  "05.work-items",
  "06.attribution",
  "07.policy",
  "08.performance",
  "09.jev",
  "10.calculation",
  "11.award-batches",
  "12.payments-gl",
  "13.ack",
  "14.invariants",
];

function evidenceOf(
  result: Awaited<ReturnType<typeof runShadowE2E>>,
  stepId: string,
): Record<string, any> {
  const step = result.steps.find((entry) => entry.id === stepId);
  expect(step, `missing step ${stepId}`).toBeTruthy();
  expect(step!.status, `step ${stepId} is FAIL: ${step!.error ?? ""}`).toBe(
    "PASS",
  );
  return step!.evidence as Record<string, any>;
}

describe("anonymized shadow E2E on real API routes", () => {
  it("walks fixtures → performance → JEV → policy-DSL → award → payment → GL → ACK", async () => {
    const result = await runShadowE2E();

    // Every step and every check must pass; no silent skipped assertion.
    expect(result.steps.map((step) => step.id)).toEqual(EXPECTED_STEP_IDS);
    for (const step of result.steps) {
      expect(
        step.status,
        `step ${step.id} failed: ${step.error ?? ""}`,
      ).toBe("PASS");
    }
    for (const check of result.checks) {
      expect(
        check.ok,
        `${check.id} expected=${JSON.stringify(check.expected)} ` +
          `actual=${JSON.stringify(check.actual)}` +
          (check.source ? ` source=${check.source}` : ""),
      ).toBe(true);
    }
    expect(result.verdict).toBe("PASS");
    expect(result.checks.length).toBeGreaterThanOrEqual(350);
    expect(new Set(result.checks.map((check) => check.id)).size).toBe(
      result.checks.length,
    );

    /* 01 — fixtures are anonymized and internally consistent. */
    const fixtures = evidenceOf(result, "01.fixtures");
    expect(fixtures.employeeCodes).toEqual(["E001", "E002", "E003"]);
    expect(fixtures.legalEntities).toEqual(["ENTITY-CN-01", "ENTITY-US-01"]);
    expect(fixtures.currencies).toEqual(["CNY", "USD"]);
    expect(fixtures.workItemRefs).toEqual(["SCR-101", "SCR-102"]);
    expect(fixtures.orderNumber).toBe("AN-O-2026-0101");
    expect(fixtures.orderTotalUsd).toBe("400000.00");
    expect(fixtures.grossProfitUsd).toBe("100000.00");
    expect(fixtures.fx).toBe("USD/CNY@7.10");
    expect(Object.keys(fixtures.fixtureHashes)).toHaveLength(7);

    /* 03/04/05 — imports are real and idempotent. */
    const contracts = evidenceOf(result, "03.contracts");
    expect(contracts.created).toBe(3);
    expect(contracts.legalEntities).toEqual(["ENTITY-CN-01", "ENTITY-US-01"]);
    expect(contracts.currencies).toEqual(["CNY", "USD"]);

    const commercial = evidenceOf(result, "04.commercial-order");
    expect(commercial.orderNumber).toBe("AN-O-2026-0101");
    expect(commercial.lineSum).toBe("400000.00");
    expect(commercial.replayCreated).toBe(false);
    expect(commercial.orderCount).toBe(1);

    const workItems = evidenceOf(result, "05.work-items");
    expect(Object.keys(workItems.workItemIds).sort()).toEqual([
      "SCR-101",
      "SCR-102",
    ]);
    expect(workItems.imported).toBe(2);
    expect(workItems.replayCreated).toBe(false);
    expect(workItems.contributions).toHaveLength(2);
    expect(workItems.source).toBe(
      "fixtures/reconciliation/anonymized-e2e/pingcode-work-items.json",
    );

    /* 06 — accepted work packages and non-self adjudication. */
    const attribution = evidenceOf(result, "06.attribution");
    expect(Object.keys(attribution.workPackages)).toHaveLength(3);
    expect(Object.keys(attribution.claims)).toHaveLength(3);
    expect(Object.keys(attribution.decisions)).toHaveLength(3);

    /* 07 — one cycle bound to a published policy + legal gate. */
    const policy = evidenceOf(result, "07.policy");
    expect(policy.policyVersionId).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(policy.legalGateRecorded).toBe(true);
    expect(policy.cycleStartsAt).toBe("2026-11-01T00:00:00.000Z");
    expect(policy.cyclePolicyVersionId).toBe(policy.policyVersionId);

    /* 08 — the score is FORMAL and every fact traces to a fixture. */
    const performance = evidenceOf(result, "08.performance");
    const goalCards = performance.goalCards as Record<
      string,
      Record<string, any>
    >;
    expect(Object.keys(goalCards).sort()).toEqual(["E001", "E003"]);
    expect(goalCards.E001!.finalScore).toBe("99.55");
    expect(goalCards.E003!.finalScore).toBe("99.1");
    for (const card of Object.values(goalCards)) {
      expect(card.cardId).toBeTruthy();
      expect(card.snapshotId).toBeTruthy();
      expect(card.scoreRecordId).toBeTruthy();
      expect(card.snapshotContentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(card.factsHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }

    /* 09 — human judgment + server verification + authorized decision. */
    const jev = evidenceOf(result, "09.jev");
    expect(jev.verificationPassed).toBe(true);
    expect(jev.decider).toBe("E003");
    expect(jev.humanJudge).toBe("E002");
    expect(jev.subjectId).toBe(goalCards.E001!.scoreRecordId);
    expect(jev.evidenceSourceTypes.sort()).toEqual([
      "SYSTEM_METRIC",
      "WORK_ITEM",
    ]);
    expect(jev.link).toBe("PERFORMANCE_EVALUATION");

    /* 10 — policy-DSL FORMAL calculation and locked ledger. */
    const calculation = evidenceOf(result, "10.calculation");
    expect(calculation.mode).toBe("FORMAL");
    expect(calculation.status).toBe("LOCKED");
    expect(calculation.lineSum).toBe("5000");
    expect(calculation.lines).toHaveLength(3);
    expect(calculation.ledgerEntries).toHaveLength(3);
    expect(calculation.ledgerChainValid).toBe(true);
    expect(
      (calculation.ledgerEntries as Array<Record<string, any>>).map(
        (entry) => entry.amount,
      ).sort(),
    ).toEqual(["1000", "1750", "2250"]);
    expect(
      new Set(
        (calculation.ledgerEntries as Array<Record<string, any>>).map(
          (entry) => entry.idempotencyKey,
        ),
      ).size,
    ).toBe(3);

    /* 11 — two batches, correct currencies/totals, exported after approval. */
    const batches = evidenceOf(result, "11.award-batches");
    expect(batches.duplicateSourceRejected).toBe(true);
    expect(batches.fxRate).toBe("7.10");
    const batchEvidence = batches.batches as Record<
      string,
      Record<string, any>
    >;
    const cnyBatch = batchEvidence.CNY!;
    const usdBatch = batchEvidence.USD!;
    expect(cnyBatch.totalAmount).toBe("28400");
    expect(cnyBatch.currency).toBe("CNY");
    expect(cnyBatch.lineCount).toBe(2);
    expect(cnyBatch.status).toBe("EXPORTED");
    expect(usdBatch.totalAmount).toBe("1000");
    expect(usdBatch.currency).toBe("USD");
    expect(usdBatch.lineCount).toBe(1);
    expect(usdBatch.status).toBe("EXPORTED");

    /* 12 — line-level payments feed balanced GL vouchers. */
    const payments = evidenceOf(result, "12.payments-gl");
    expect(payments.payments).toHaveLength(3);
    expect(
      (payments.payments as Array<Record<string, any>>)
        .map((payment) => payment.currency)
        .sort(),
    ).toEqual(["CNY", "CNY", "USD"]);
    expect(payments.gl.allBalanced).toBe(true);
    expect(payments.gl.journalCount).toBe(3);
    expect(payments.gl.cnyDebit).toBe("28400.00");
    expect(payments.gl.usdDebit).toBe("1000.00");
    expect(payments.cnyReconciliation.status).toBe("RECONCILED");
    expect(payments.cnyReconciliation.paidAmount).toBe("28400");
    expect(payments.usdReconciliation.status).toBe("RECONCILED");
    expect(payments.usdReconciliation.paidAmount).toBe("1000");

    /* 13 — ACK closes the batch and blocks any further payment. */
    const ack = evidenceOf(result, "13.ack");
    expect(ack.cny.status).toBe("ACKNOWLEDGED");
    expect(ack.usd.status).toBe("ACKNOWLEDGED");
    expect(ack.cny.reconciliation).toBe("RECONCILED");
    expect(ack.usd.reconciliation).toBe("RECONCILED");
    expect(ack.reAck.status).toBe(409);
    expect(ack.rePay.status).toBe(409);
    expect(ack.rePay.message).toContain("AWARD_BATCH_ALREADY_ACKNOWLEDGED");
    expect(ack.replayPaid.status).toBe(409);
    expect(ack.batchCount).toBe(2);

    /* 14 — final cross-step invariants. */
    const invariants = evidenceOf(result, "14.invariants");
    expect(invariants.workItems).toBe(2);
    expect(invariants.commercialOrders).toBe(1);
    expect(invariants.legalEntities).toBe(2);
    expect(invariants.calculationTotalUsd).toBe("5000");
    expect(invariants.ledgerEntries).toBe(3);
    expect(invariants.payments).toBe(3);
    expect(invariants.glJournals).toBe(3);
    expect(invariants.glBalanced).toBe(true);
    expect(invariants.ack).toEqual({
      cny: "ACKNOWLEDGED",
      usd: "ACKNOWLEDGED",
    });
    expect(invariants.awardBatches).toEqual([
      expect.objectContaining({ currency: "CNY", total: "28400" }),
      expect.objectContaining({ currency: "USD", total: "1000" }),
    ]);
    expect(invariants.performance.E001.eligibility).toBe("FORMAL");
    expect(invariants.performance.E003.eligibility).toBe("FORMAL");

    /* Explicit source traceability / conservation / duplicate / GL oracles. */
    expect(invariants.trace).toHaveLength(3);
    const traceByCode = new Map<string, Record<string, any>>(
      (invariants.trace as Array<Record<string, any>>).map((entry) => [
        entry.employeeCode,
        entry,
      ]),
    );
    for (const code of ["E001", "E002", "E003"]) {
      const entry = traceByCode.get(code)!;
      expect(entry.personId).toBeTruthy();
      expect(entry.calculationLineKey).toBeTruthy();
      expect(entry.sourceRecordId).toContain(invariants.calculationRunId);
      expect(entry.sourceLineRef).toBeTruthy();
      expect(entry.fixtureRefs.length).toBeGreaterThan(0);
      expect(entry.fixtureRefs[0]).toContain(
        "fixtures/reconciliation/anonymized-e2e/",
      );
    }
    expect(traceByCode.get("E001")!.sourceLineRef).toBe("SCR-101");
    expect(traceByCode.get("E002")!.sourceLineRef).toBe("SCR-102");
    expect(traceByCode.get("E003")!.sourceLineRef).toBe("AN-O-2026-0101");

    expect(invariants.amountConservation).toEqual({
      calculationUsd: "5000",
      ledgerUsd: "5000",
      cnyPaid: "28400",
      usdPaid: "1000",
      usdEquivalent: "5000",
    });
    expect(invariants.duplicates).toEqual({
      batchNos: 2,
      paymentRefs: 3,
      ledgerIdempotency: 3,
      workItems: 2,
    });
    expect(invariants.gl).toEqual({
      journalCount: 3,
      cnyDebit: "28400.00",
      usdDebit: "1000.00",
      balanced: true,
    });
  }, 120_000);
});
