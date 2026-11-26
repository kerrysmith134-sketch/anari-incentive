/**
 * 迁移 117：奖励批次支付回执 / 对账 / GL 闭环。
 *
 * 覆盖：
 * - 部分支付 → PARTIAL，全部支付 → RECONCILED，重复支付 → VARIANCE；
 * - 多付/少付/错行/错币种 → 409；重复 payment_ref 幂等（不重复累计、不重复记账）；
 * - 每笔 PAID 生成借贷平衡的 GL 凭证（借 INCENTIVE_EXPENSE / 贷 CASH|PAYABLE），
 *   FAILED / RETURNED 不生成；
 * - ACKNOWLEDGE 前置条件：所有行 PAID 且已付合计 = total_amount，否则 409；
 * - 跨租户批次 → 404。
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Authenticator } from "@anari/auth";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";
const TENANT = "tenant-demo";

let app: FastifyInstance;
let platformStore: MemoryPlatformStore;

async function call(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
  target: FastifyInstance = app,
) {
  const response = await target.inject({ method, url, payload } as never);
  return {
    status: response.statusCode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get body(): any {
      return response.json();
    },
  };
}

/** 默认 DevHeaderAuthenticator：OWNER + admin（可创建/审批/导出/回执）。 */
beforeEach(() => {
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: TENANT,
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "Finance" },
        { id: MEMBER, employeeCode: "E002", displayName: "Contributor" },
        { id: ADMIN, employeeCode: "E003", displayName: "Admin" },
      ],
    },
  });
  app = buildApp(new Store(), undefined, undefined, platformStore);
});

function otherTenantApp(): FastifyInstance {
  const authenticator: Authenticator = {
    async authenticate() {
      return {
        tenantId: "tenant-other",
        userId: "user-other",
        roles: ["finance"],
        personId: OWNER,
      };
    },
  };
  return buildApp(new Store(), undefined, authenticator, platformStore);
}

async function createBatch(
  batchNo: string,
  lines: Array<{ personId: string; amount: string }>,
  options: { createdBy?: string; currency?: string } = {},
): Promise<{ id: string; lines: Array<{ id: string; personId: string; amount: string }> }> {
  const created = await call("POST", "/api/v1/incentive-award-batches", {
    batchNo,
    awardType: "MONTHLY_STAR",
    period: "2026-11",
    currency: options.currency ?? "CNY",
    createdBy: options.createdBy ?? ADMIN,
    lines,
  });
  expect(created.status).toBe(201);
  return {
    id: created.body.data.id,
    lines: created.body.data.lines.map(
      (line: { id: string; personId: string; amount: string }) => ({
        id: line.id,
        personId: line.personId,
        amount: line.amount,
      }),
    ),
  };
}

async function promote(batchId: string, to: "LOCKED" | "EXPORTED" = "EXPORTED") {
  const commands =
    to === "LOCKED"
      ? ["SUBMIT", "APPROVE", "LOCK"]
      : ["SUBMIT", "APPROVE", "LOCK", "EXPORT"];
  for (const command of commands) {
    const response = await call(
      "POST",
      `/api/v1/incentive-award-batches/${batchId}/commands`,
      { command },
    );
    expect(response.status).toBe(200);
  }
}

function payment(
  lineId: string,
  paymentRef: string,
  amount: string,
  overrides: Partial<{
    status: "PAID" | "FAILED" | "RETURNED";
    currency: string;
    creditAccount: "CASH" | "PAYABLE";
    failureCode: string;
  }> = {},
) {
  return {
    lineId,
    paymentRef,
    status: overrides.status ?? "PAID",
    amount,
    currency: overrides.currency ?? "CNY",
    ...(overrides.creditAccount
      ? { creditAccount: overrides.creditAccount }
      : {}),
    ...(overrides.failureCode ? { failureCode: overrides.failureCode } : {}),
  };
}

async function pay(
  batchId: string,
  payments: Array<Record<string, unknown>>,
  target: FastifyInstance = app,
) {
  return call(
    "POST",
    `/api/v1/incentive-award-batches/${batchId}/payments`,
    { payments },
    target,
  );
}

async function reconcile(batchId: string, target: FastifyInstance = app) {
  const response = await call(
    "GET",
    `/api/v1/incentive-award-batches/${batchId}/reconciliation`,
    undefined,
    target,
  );
  expect(response.status).toBe(200);
  return response.body.data;
}

async function journalsFor(paymentId: string) {
  const response = await call(
    "GET",
    `/api/v1/financial-journals?documentId=${paymentId}`,
  );
  expect(response.status).toBe(200);
  return response.body.data.journals as Array<{
    documentType: string;
    documentId: string;
    totalDebit: string;
    totalCredit: string;
    lines: Array<{ accountCode: string; debit: string; credit: string }>;
  }>;
}

async function acknowledge(batchId: string) {
  return call(
    "POST",
    `/api/v1/incentive-award-batches/${batchId}/commands`,
    { command: "ACKNOWLEDGE", paymentRef: "BANK-ACK" },
  );
}

describe("incentive award payments: partial → reconciled", () => {
  it("reconciles line by line and only acknowledges when every line is paid", async () => {
    const batch = await createBatch("PAY-001", [
      { personId: MEMBER, amount: "500" },
      { personId: ADMIN, amount: "300" },
    ]);
    await promote(batch.id);
    const [first, second] = batch.lines;

    // 回执前：EXPORTED 但零支付 → PARTIAL，ACK 409。
    const before = await reconcile(batch.id);
    expect(before.status).toBe("PARTIAL");
    expect(before.paidAmount).toBe("0");
    expect(before.unpaidAmount).toBe("800");
    expect(before.variance).toBe("-800");
    expect((await acknowledge(batch.id)).status).toBe(409);

    // 部分支付 → PARTIAL。
    const partial = await pay(batch.id, [payment(first!.id, "BANK-001", "500")]);
    expect(partial.status).toBe(201);
    expect(partial.body.data.createdPaymentIds).toHaveLength(1);
    const partialReconciliation = partial.body.data.reconciliation;
    expect(partialReconciliation.status).toBe("PARTIAL");
    expect(partialReconciliation.paidAmount).toBe("500");
    expect(partialReconciliation.unpaidAmount).toBe("300");
    expect(partialReconciliation.variance).toBe("-300");
    expect(partialReconciliation.paidLines).toBe(1);
    expect(partialReconciliation.unpaidLines).toBe(1);
    expect(partialReconciliation.lines[0]).toMatchObject({
      lineId: first!.id,
      personId: MEMBER,
      amount: "500",
      paidAmount: "500",
      unpaidAmount: "0",
      variance: "0",
      status: "PAID",
      paymentRefs: ["BANK-001"],
    });
    expect(partialReconciliation.lines[1]).toMatchObject({
      lineId: second!.id,
      paidAmount: "0",
      unpaidAmount: "300",
      variance: "-300",
      status: "UNPAID",
    });
    expect((await acknowledge(batch.id)).status).toBe(409);

    // 批量补齐剩余行 → RECONCILED。
    const rest = await pay(batch.id, [payment(second!.id, "BANK-002", "300")]);
    expect(rest.status).toBe(201);
    expect(rest.body.data.reconciliation.status).toBe("RECONCILED");
    expect(rest.body.data.reconciliation.paidAmount).toBe("800");
    expect(rest.body.data.reconciliation.unpaidAmount).toBe("0");
    expect(rest.body.data.reconciliation.variance).toBe("0");
    expect(rest.body.data.reconciliation.paidLines).toBe(2);
    const current = await reconcile(batch.id);
    expect(current.status).toBe("RECONCILED");
    expect(current.totalAmount).toBe("800");

    // 全部足额 → ACK 成功。
    const acknowledged = await acknowledge(batch.id);
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.data.status).toBe("ACKNOWLEDGED");
  });

  it("accepts a batched payment payload for multiple lines", async () => {
    const batch = await createBatch("PAY-002", [
      { personId: MEMBER, amount: "100" },
      { personId: ADMIN, amount: "200" },
    ]);
    await promote(batch.id);
    const response = await pay(batch.id, [
      payment(batch.lines[0]!.id, "BULK-1", "100"),
      payment(batch.lines[1]!.id, "BULK-2", "200"),
    ]);
    expect(response.status).toBe(201);
    expect(response.body.data.createdPaymentIds).toHaveLength(2);
    expect(response.body.data.reconciliation.status).toBe("RECONCILED");
    expect((await acknowledge(batch.id)).status).toBe(200);
  });
});

describe("incentive award payments: GL vouchers", () => {
  it("posts a balanced INCENTIVE_EXPENSE / CASH voucher per PAID payment", async () => {
    const batch = await createBatch("PAY-GL-1", [
      { personId: MEMBER, amount: "500.25" },
    ]);
    await promote(batch.id);
    const recorded = await pay(batch.id, [
      payment(batch.lines[0]!.id, "GL-REF-1", "500.25"),
    ]);
    expect(recorded.status).toBe(201);
    const paymentId = recorded.body.data.payments[0].id as string;

    const journals = await journalsFor(paymentId);
    expect(journals).toHaveLength(1);
    const journal = journals[0]!;
    expect(journal.documentType).toBe("PAYMENT");
    expect(journal.documentId).toBe(paymentId);
    expect(journal.totalDebit).toBe("500.25");
    expect(journal.totalCredit).toBe("500.25");
    expect(journal.lines).toHaveLength(2);
    const debit = journal.lines.find((line) => line.accountCode === "INCENTIVE_EXPENSE");
    const credit = journal.lines.find((line) => line.accountCode === "CASH");
    expect(debit?.debit).toBe("500.25");
    expect(debit?.credit).toBe("0");
    expect(credit?.credit).toBe("500.25");
    expect(credit?.debit).toBe("0");
    // 借贷平衡（1e6 定点，字符串比较即可）。
    expect(journal.totalDebit).toBe(journal.totalCredit);

    // 科目表包含新增科目。
    const accounts = await call("GET", "/api/v1/financial-gl-accounts");
    const codes = (accounts.body.data as Array<{ code: string }>).map(
      (account) => account.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining(["INCENTIVE_EXPENSE", "PAYABLE", "CASH"]),
    );
  });

  it("uses PAYABLE when the payment is an accrued liability", async () => {
    const batch = await createBatch("PAY-GL-2", [
      { personId: MEMBER, amount: "120" },
    ]);
    await promote(batch.id);
    const recorded = await pay(batch.id, [
      payment(batch.lines[0]!.id, "GL-REF-2", "120", {
        creditAccount: "PAYABLE",
      }),
    ]);
    const journals = await journalsFor(recorded.body.data.payments[0].id);
    expect(journals).toHaveLength(1);
    expect(
      journals[0]!.lines.map((line) => line.accountCode).sort(),
    ).toEqual(["INCENTIVE_EXPENSE", "PAYABLE"]);
  });

  it("does not post vouchers for FAILED or RETURNED receipts", async () => {
    const batch = await createBatch("PAY-GL-3", [
      { personId: MEMBER, amount: "90" },
    ]);
    await promote(batch.id);
    const failed = await pay(batch.id, [
      payment(batch.lines[0]!.id, "FAIL-1", "90", {
        status: "FAILED",
        failureCode: "R01",
      }),
    ]);
    expect(failed.status).toBe(201);
    const returned = await pay(batch.id, [
      payment(batch.lines[0]!.id, "RET-1", "90", { status: "RETURNED" }),
    ]);
    expect(returned.status).toBe(201);
    expect(
      await journalsFor(failed.body.data.payments[0].id),
    ).toHaveLength(0);
    expect(
      await journalsFor(returned.body.data.payments[0].id),
    ).toHaveLength(0);

    const reconciliation = await reconcile(batch.id);
    expect(reconciliation.paidAmount).toBe("0");
    expect(reconciliation.status).toBe("PARTIAL");
    expect((await acknowledge(batch.id)).status).toBe(409);

    // 真正 PAID 后才生成凭证并可回执。
    const paid = await pay(batch.id, [
      payment(batch.lines[0]!.id, "PAID-1", "90"),
    ]);
    expect(paid.status).toBe(201);
    expect(
      await journalsFor(paid.body.data.payments[0].id),
    ).toHaveLength(1);
    expect((await acknowledge(batch.id)).status).toBe(200);
  });
});

describe("incentive award payments: validation", () => {
  it("rejects over/under payment, foreign line and currency mismatch with 409", async () => {
    const batch = await createBatch("PAY-V-1", [
      { personId: MEMBER, amount: "500" },
    ]);
    const foreign = await createBatch("PAY-V-2", [
      { personId: ADMIN, amount: "200" },
    ]);
    await promote(batch.id);
    await promote(foreign.id);
    const lineId = batch.lines[0]!.id;

    const over = await pay(batch.id, [payment(lineId, "V-OVER", "500.01")]);
    expect(over.status).toBe(409);
    expect(over.body.error.message).toMatch(/AWARD_PAYMENT_AMOUNT_MISMATCH/);

    const under = await pay(batch.id, [payment(lineId, "V-UNDER", "499.99")]);
    expect(under.status).toBe(409);
    expect(under.body.error.message).toMatch(/AWARD_PAYMENT_AMOUNT_MISMATCH/);

    const wrongLine = await pay(batch.id, [
      payment(foreign.lines[0]!.id, "V-LINE", "200"),
    ]);
    expect(wrongLine.status).toBe(409);
    expect(wrongLine.body.error.message).toMatch(
      /AWARD_PAYMENT_LINE_NOT_IN_BATCH/,
    );

    const wrongCurrency = await pay(batch.id, [
      payment(lineId, "V-CCY", "500", { currency: "USD" }),
    ]);
    expect(wrongCurrency.status).toBe(409);
    expect(wrongCurrency.body.error.message).toMatch(
      /AWARD_PAYMENT_CURRENCY_MISMATCH/,
    );

    // 一次都没落库。
    const reconciliation = await reconcile(batch.id);
    expect(reconciliation.paidAmount).toBe("0");
    expect(reconciliation.status).toBe("PARTIAL");
  });

  it("refuses payments before the batch is locked", async () => {
    const batch = await createBatch("PAY-V-3", [
      { personId: MEMBER, amount: "50" },
    ]);
    const response = await pay(batch.id, [
      payment(batch.lines[0]!.id, "EARLY-1", "50"),
    ]);
    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/AWARD_BATCH_NOT_PAYABLE/);

    await promote(batch.id, "LOCKED");
    const afterLock = await pay(batch.id, [
      payment(batch.lines[0]!.id, "EARLY-1", "50"),
    ]);
    expect(afterLock.status).toBe(201);
  });

  it("rejects malformed payloads at the protocol layer", async () => {
    const batch = await createBatch("PAY-V-4", [
      { personId: MEMBER, amount: "10" },
    ]);
    await promote(batch.id);

    expect((await pay(batch.id, [])).status).toBe(400);
    expect(
      (
        await pay(batch.id, [
          {
            ...payment(batch.lines[0]!.id, "BAD-1", "10"),
            status: "MAYBE",
          },
        ])
      ).status,
    ).toBe(400);
    expect(
      (
        await pay(batch.id, [
          payment(batch.lines[0]!.id, "BAD-2", "10", { currency: "CN" }),
        ])
      ).status,
    ).toBe(400);
    expect(
      (
        await pay(batch.id, [
          payment(batch.lines[0]!.id, "BAD-3", "-10"),
        ])
      ).status,
    ).toBe(400);
  });
});

describe("incentive award payments: idempotency", () => {
  it("replays the same payment_ref without double counting or double posting", async () => {
    const batch = await createBatch("PAY-I-1", [
      { personId: MEMBER, amount: "300" },
    ]);
    await promote(batch.id);
    const lineId = batch.lines[0]!.id;
    const payload = [payment(lineId, "IDEM-1", "300")];

    const first = await pay(batch.id, payload);
    expect(first.status).toBe(201);
    const firstId = first.body.data.payments[0].id as string;
    const replay = await pay(batch.id, payload);
    // 纯幂等重放不新落库 → 200，且返回同一条回执。
    expect(replay.status).toBe(200);
    expect(replay.body.data.createdPaymentIds).toHaveLength(0);
    expect(replay.body.data.payments[0].id).toBe(firstId);
    expect(replay.body.data.reconciliation.paidAmount).toBe("300");
    expect(replay.body.data.reconciliation.status).toBe("RECONCILED");

    // 同一请求内重复提交同一 ref 也幂等。
    const duplicatedInRequest = await pay(batch.id, [
      payment(lineId, "IDEM-1", "300"),
      payment(lineId, "IDEM-1", "300"),
    ]);
    expect(duplicatedInRequest.status).toBe(200);
    expect(duplicatedInRequest.body.data.reconciliation.paidAmount).toBe("300");

    // 只有一张 GL 凭证。
    const journals = await journalsFor(firstId);
    expect(journals).toHaveLength(1);

    // 同 ref 不同状态 → 幂等冲突 409（不能静默覆盖）。
    const conflict = await pay(batch.id, [
      payment(lineId, "IDEM-1", "300", { status: "FAILED" }),
    ]);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.message).toMatch(
      /AWARD_PAYMENT_IDEMPOTENCY_CONFLICT/,
    );
    expect((await reconcile(batch.id)).paidAmount).toBe("300");
  });

  it("reports VARIANCE when the same line is paid twice with different refs", async () => {
    const batch = await createBatch("PAY-I-2", [
      { personId: MEMBER, amount: "300" },
    ]);
    await promote(batch.id);
    const lineId = batch.lines[0]!.id;
    const first = await pay(batch.id, [payment(lineId, "DUP-A", "300")]);
    const second = await pay(batch.id, [payment(lineId, "DUP-B", "300")]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const reconciliation = await reconcile(batch.id);
    expect(reconciliation.status).toBe("VARIANCE");
    expect(reconciliation.paidAmount).toBe("600");
    expect(reconciliation.variance).toBe("300");
    expect(reconciliation.overpaidLines).toBe(1);
    expect(reconciliation.lines[0]!.status).toBe("OVERPAID");
    expect(reconciliation.lines[0]!.variance).toBe("300");
    expect(reconciliation.lines[0]!.paymentRefs).toEqual(["DUP-A", "DUP-B"]);

    const ack = await acknowledge(batch.id);
    expect(ack.status).toBe(409);
    expect(ack.body.error.message).toMatch(/AWARD_BATCH_NOT_RECONCILED/);
  });
});

describe("incentive award payments: tenant isolation", () => {
  it("returns 404 for another tenant's batch on record and reconciliation", async () => {
    const batch = await createBatch("PAY-T-1", [
      { personId: MEMBER, amount: "70" },
    ]);
    await promote(batch.id);
    const other = otherTenantApp();

    const record = await pay(
      batch.id,
      [payment(batch.lines[0]!.id, "CROSS-1", "70")],
      other,
    );
    expect(record.status).toBe(404);

    const reconciliation = await call(
      "GET",
      `/api/v1/incentive-award-batches/${batch.id}/reconciliation`,
      undefined,
      other,
    );
    expect(reconciliation.status).toBe(404);

    // 原租户不受影响。
    expect((await reconcile(batch.id)).paidAmount).toBe("0");
  });
});
