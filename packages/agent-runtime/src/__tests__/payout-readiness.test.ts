/**
 * Payout Readiness 定向回归（NP-PAY-READY）。
 *
 * 本工作流只读：七项检查全部 PASS 才 ready。测试覆盖验收要求的八类
 * 场景（全通过、未决人员、漏批次、少付、无 GL、退回、ACK 后又支付、
 * 空批次），并补充 source record 重复与“合计相等但行级 PARTIAL”两类
 * 金额陷阱。
 */
import { describe, expect, it } from "vitest";
import {
  evaluatePayoutReadiness,
  type PayoutPayment,
  type PayoutReadinessCheck,
  type PayoutReadinessCheckCode,
  type PayoutReadinessInput,
  type PayoutReadinessReport,
} from "../payout-readiness.js";

function paymentFor(
  lineId: string,
  id: string,
  amount: string,
  overrides: Partial<PayoutPayment> = {},
): PayoutPayment {
  return {
    id,
    lineId,
    amount,
    currency: "CNY",
    paymentRef: `REF-${id}`,
    status: "PAID",
    createdAt: "2026-01-10T00:00:00.000Z",
    paidAt: "2026-01-11T00:00:00.000Z",
    gl: {
      voucherId: `GL-${id}`,
      present: true,
      totalDebit: amount,
      totalCredit: amount,
      balanced: true,
    },
    ...overrides,
  };
}

function baseInput(): PayoutReadinessInput {
  return {
    people: [
      { personId: "p-1", decisionStatus: "FORMAL", eligibility: true },
      { personId: "p-2", decisionStatus: "DECIDED", eligibility: true },
      { personId: "p-3", decisionStatus: "EXCLUDED", eligibility: false },
    ],
    dueAwards: [
      {
        sourceRecordId: "src-1",
        personId: "p-1",
        amount: "100",
        currency: "CNY",
      },
      {
        sourceRecordId: "src-2",
        personId: "p-2",
        amount: "200",
        currency: "CNY",
      },
    ],
    batches: [
      {
        id: "batch-1",
        batchNo: "B-1",
        status: "ACKNOWLEDGED",
        currency: "CNY",
        totalAmount: "300",
        glComplete: true,
        acknowledgedAt: "2026-02-01T00:00:00.000Z",
        lines: [
          {
            id: "line-1",
            personId: "p-1",
            amount: "100",
            currency: "CNY",
            sourceRecordId: "src-1",
          },
          {
            id: "line-2",
            personId: "p-2",
            amount: "200",
            currency: "CNY",
            sourceRecordId: "src-2",
          },
        ],
        payments: [
          paymentFor("line-1", "pay-1", "100"),
          paymentFor("line-2", "pay-2", "200"),
        ],
      },
    ],
    appeals: [],
    returns: [],
  };
}

function checkFor(
  report: PayoutReadinessReport,
  code: PayoutReadinessCheckCode,
): PayoutReadinessCheck {
  const found = report.checks.find((entry) => entry.check === code);
  if (!found) throw new Error(`missing check ${code}`);
  return found;
}

function blockerCodes(report: PayoutReadinessReport): string[] {
  return report.blockers.map((issue) => issue.code);
}

describe("Payout Readiness", () => {
  it("all checks PASS: people decided, awards batched, paid in full with GL and no open items", () => {
    const report = evaluatePayoutReadiness(baseInput());

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.checks.map((entry) => entry.check)).toEqual([
      "allPeopleDecided",
      "allAwardsBatched",
      "batchApprovedLocked",
      "paidMatchesDue",
      "everyPaidHasGl",
      "noOpenReturnsAppeals",
      "ackImmutable",
    ]);
    expect(report.checks.every((entry) => entry.status === "PASS")).toBe(true);
    expect(report.amounts).toMatchObject({
      currency: "CNY",
      due: "300",
      paid: "300",
      outstanding: "0",
      variance: "0",
    });
    expect(report.amounts.byCurrency).toEqual([
      {
        currency: "CNY",
        due: "300",
        paid: "300",
        outstanding: "0",
        variance: "0",
      },
    ]);
    expect(report.note).toContain("does not create batches");
  });

  it("undecided participant blocks allPeopleDecided", () => {
    const input = baseInput();
    input.people[1] = {
      personId: "p-2",
      decisionStatus: "DRAFT",
      eligibility: true,
    };

    const report = evaluatePayoutReadiness(input);

    const check = checkFor(report, "allPeopleDecided");
    expect(check.status).toBe("BLOCKED");
    expect(check.detail).toContain("DRAFT");
    expect(blockerCodes(report)).toContain("UNDECIDED_PERSON");
    expect(report.ready).toBe(false);
  });

  it("awards missing from every batch block allAwardsBatched", () => {
    const input = baseInput();
    input.dueAwards?.push({
      sourceRecordId: "src-3",
      personId: "p-1",
      amount: "50",
      currency: "CNY",
    });

    const report = evaluatePayoutReadiness(input);

    expect(checkFor(report, "allAwardsBatched").status).toBe("BLOCKED");
    expect(blockerCodes(report)).toContain("DUE_AWARD_NOT_BATCHED");
    expect(report.ready).toBe(false);
  });

  it("a decided participant without an award line blocks allAwardsBatched", () => {
    const input = baseInput();
    input.people.push({
      personId: "p-4",
      decisionStatus: "DECIDED",
      eligibility: true,
    });

    const report = evaluatePayoutReadiness(input);

    expect(checkFor(report, "allAwardsBatched").status).toBe("BLOCKED");
    expect(blockerCodes(report)).toContain("MISSING_AWARD_BATCH");
    expect(report.ready).toBe(false);
  });

  it("underpayment blocks paidMatchesDue with outstanding amount", () => {
    const input = baseInput();
    const batch = input.batches[0]!;
    batch.payments[1] = paymentFor("line-2", "pay-2", "150");

    const report = evaluatePayoutReadiness(input);

    expect(checkFor(report, "paidMatchesDue").status).toBe("BLOCKED");
    expect(blockerCodes(report)).toEqual(
      expect.arrayContaining(["PARTIAL_AWARD_LINE", "PAYMENT_MISMATCH"]),
    );
    expect(report.amounts).toMatchObject({
      currency: "CNY",
      due: "300",
      paid: "250",
      outstanding: "50",
      variance: "-50",
    });
    expect(report.ready).toBe(false);
  });

  it("equal totals with a line-level PARTIAL still block paidMatchesDue", () => {
    const input = baseInput();
    const batch = input.batches[0]!;
    batch.payments[0] = paymentFor("line-1", "pay-1", "150");
    batch.payments[1] = paymentFor("line-2", "pay-2", "150");

    const report = evaluatePayoutReadiness(input);

    expect(checkFor(report, "paidMatchesDue").status).toBe("BLOCKED");
    expect(blockerCodes(report)).toEqual(
      expect.arrayContaining([
        "OVERPAID_AWARD_LINE",
        "PARTIAL_AWARD_LINE",
      ]),
    );
    expect(report.amounts.paid).toBe("300");
    expect(report.amounts.variance).toBe("0");
    expect(report.ready).toBe(false);
  });

  it("missing GL coverage blocks everyPaidHasGl", () => {
    const input = baseInput();
    const batch = input.batches[0]!;
    batch.glComplete = false;
    for (const payment of batch.payments) {
      delete payment.gl;
    }

    const report = evaluatePayoutReadiness(input);

    expect(checkFor(report, "everyPaidHasGl").status).toBe("BLOCKED");
    expect(blockerCodes(report)).toContain("GL_NOT_COMPLETE");
    expect(report.ready).toBe(false);
  });

  it("an unbalanced per-payment GL voucher blocks everyPaidHasGl", () => {
    const input = baseInput();
    const batch = input.batches[0]!;
    batch.payments[0] = paymentFor("line-1", "pay-1", "100", {
      gl: {
        voucherId: "GL-BAD",
        present: true,
        totalDebit: "100",
        totalCredit: "90",
        balanced: false,
      },
    });

    const report = evaluatePayoutReadiness(input);

    expect(checkFor(report, "everyPaidHasGl").status).toBe("BLOCKED");
    expect(blockerCodes(report)).toEqual(
      expect.arrayContaining(["GL_UNBALANCED"]),
    );
    expect(report.ready).toBe(false);
  });

  it("a RETURNED payment blocks noOpenReturnsAppeals even when a replacement PAID exists", () => {
    const input = baseInput();
    const batch = input.batches[0]!;
    batch.payments.push(
      paymentFor("line-2", "pay-2-returned", "200", {
        status: "RETURNED",
        paymentRef: "RET-1",
      }),
    );

    const report = evaluatePayoutReadiness(input);

    expect(checkFor(report, "noOpenReturnsAppeals").status).toBe("BLOCKED");
    expect(blockerCodes(report)).toContain("PAYMENT_RETURNED");
    expect(checkFor(report, "paidMatchesDue").status).toBe("PASS");
    expect(report.ready).toBe(false);
  });

  it("an open appeal blocks noOpenReturnsAppeals", () => {
    const input = baseInput();
    input.appeals = [{ id: "appeal-1", status: "UNDER_REVIEW" }];

    const report = evaluatePayoutReadiness(input);

    expect(checkFor(report, "noOpenReturnsAppeals").status).toBe("BLOCKED");
    expect(blockerCodes(report)).toContain("OPEN_APPEAL");
    expect(report.ready).toBe(false);
  });

  it("an ordinary payment recorded after ACK blocks ackImmutable", () => {
    const input = baseInput();
    const batch = input.batches[0]!;
    batch.payments[1] = paymentFor("line-2", "pay-2", "200", {
      createdAt: "2026-02-02T00:00:00.000Z",
      paidAt: "2026-02-02T00:00:00.000Z",
    });

    const report = evaluatePayoutReadiness(input);

    expect(checkFor(report, "ackImmutable").status).toBe("BLOCKED");
    expect(blockerCodes(report)).toContain("PAYMENT_AFTER_ACK");
    expect(checkFor(report, "paidMatchesDue").status).toBe("PASS");
    expect(report.ready).toBe(false);
  });

  it("an empty batch blocks allAwardsBatched", () => {
    const input = baseInput();
    input.batches = [
      {
        id: "batch-empty",
        batchNo: "B-EMPTY",
        status: "APPROVED",
        currency: "CNY",
        totalAmount: "0",
        glComplete: true,
        lines: [],
        payments: [],
      },
    ];

    const report = evaluatePayoutReadiness(input);

    expect(checkFor(report, "allAwardsBatched").status).toBe("BLOCKED");
    expect(blockerCodes(report)).toContain("EMPTY_BATCH");
    expect(report.ready).toBe(false);
  });

  it("no active batches at all blocks allAwardsBatched when awards are due", () => {
    const input = baseInput();
    input.batches = [];

    const report = evaluatePayoutReadiness(input);

    expect(checkFor(report, "allAwardsBatched").status).toBe("BLOCKED");
    expect(blockerCodes(report)).toContain("MISSING_AWARD_BATCHES");
    expect(report.ready).toBe(false);
  });

  it("duplicate source records across batches block allAwardsBatched", () => {
    const input = baseInput();
    input.batches.push({
      id: "batch-2",
      batchNo: "B-2",
      status: "APPROVED",
      currency: "CNY",
      totalAmount: "50",
      glComplete: true,
      lines: [
        {
          id: "line-3",
          personId: "p-1",
          amount: "50",
          currency: "CNY",
          sourceRecordId: "src-1",
        },
      ],
      payments: [paymentFor("line-3", "pay-3", "50")],
    });

    const report = evaluatePayoutReadiness(input);

    expect(checkFor(report, "allAwardsBatched").status).toBe("BLOCKED");
    expect(blockerCodes(report)).toContain("DUPLICATE_SOURCE_RECORD");
    expect(report.ready).toBe(false);
  });
});
