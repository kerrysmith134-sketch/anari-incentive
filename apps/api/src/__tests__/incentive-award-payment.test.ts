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
import type { Pool } from "pg";
import { buildApp } from "../app.js";
import { MemoryPlatformStore, PgPlatformStore } from "../platform-store.js";
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
  return createBatchOn(app, batchNo, lines, options);
}

async function createBatchOn(
  target: FastifyInstance,
  batchNo: string,
  lines: Array<{ personId: string; amount: string }>,
  options: { createdBy?: string; currency?: string } = {},
): Promise<{ id: string; lines: Array<{ id: string; personId: string; amount: string }> }> {
  const created = await call(
    "POST",
    "/api/v1/incentive-award-batches",
    {
      batchNo,
      awardType: "MONTHLY_STAR",
      period: "2026-11",
      currency: options.currency ?? "CNY",
      createdBy: options.createdBy ?? ADMIN,
      lines,
    },
    target,
  );
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
  return promoteOn(app, batchId, to);
}

async function promoteOn(
  target: FastifyInstance,
  batchId: string,
  to: "LOCKED" | "EXPORTED" = "EXPORTED",
) {
  const commands =
    to === "LOCKED"
      ? ["SUBMIT", "APPROVE", "LOCK"]
      : ["SUBMIT", "APPROVE", "LOCK", "EXPORT"];
  for (const command of commands) {
    const response = await call(
      "POST",
      `/api/v1/incentive-award-batches/${batchId}/commands`,
      { command },
      target,
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
    legalEntityId: string;
    accountingPeriod: string;
    paidAt: string;
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
    ...(overrides.legalEntityId
      ? { legalEntityId: overrides.legalEntityId }
      : {}),
    ...(overrides.accountingPeriod
      ? { accountingPeriod: overrides.accountingPeriod }
      : {}),
    ...(overrides.paidAt ? { paidAt: overrides.paidAt } : {}),
  };
}

async function pay(
  batchId: string,
  payments: Array<Record<string, unknown>>,
  target: FastifyInstance = app,
) {
  return payOn(target, batchId, payments);
}

async function payOn(
  target: FastifyInstance,
  batchId: string,
  payments: Array<Record<string, unknown>>,
) {
  return call(
    "POST",
    `/api/v1/incentive-award-batches/${batchId}/payments`,
    { payments },
    target,
  );
}

async function reconcile(batchId: string, target: FastifyInstance = app) {
  return reconcileOn(target, batchId);
}

async function reconcileOn(target: FastifyInstance, batchId: string) {
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

// ---------------------------------------------------------------------
// 迁移 119：支付 / GL / 审计的原子执行契约。
//
// 这些子类只覆盖受保护的写入钩子，用来在 Memory adapter 中模拟
// “GL 写失败”或“审计写失败”，验证支付不会被半截提交。
// ---------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArgs = any[];

class FailingGlMemoryStore extends MemoryPlatformStore {
  private journalCalls = 0;

  // 第一条凭证正常写入，第二条才失败：用来证明回滚不仅撤销当前一条，
  // 也撤销同一请求里已经写出的支付与凭证。
  protected async postAwardPaymentJournal(
    ...args: AnyArgs
  ): Promise<any> {
    this.journalCalls += 1;
    if (this.journalCalls >= 2) throw new Error("GL_WRITE_FAILED");
    return this.createJournalEntry(args[0]);
  }
}

class MissingGlMemoryStore extends MemoryPlatformStore {
  protected async postAwardPaymentJournal(
    ..._args: AnyArgs
  ): Promise<never> {
    // 迁移 119 兼容路径：历史 PAID 回执可能没有凭证；此处模拟这种脏数据。
    return undefined as never;
  }
}

class FailingAuditMemoryStore extends MemoryPlatformStore {
  protected async recordAwardPaymentAudit(
    ..._args: AnyArgs
  ): Promise<never> {
    throw new Error("AUDIT_WRITE_FAILED");
  }
}

function memoryApp(store: MemoryPlatformStore): FastifyInstance {
  return buildApp(new Store(), undefined, undefined, store);
}

function storeWith<T extends MemoryPlatformStore>(
  StoreClass: new (options: ConstructorParameters<typeof MemoryPlatformStore>[0]) => T,
): T {
  return new StoreClass({
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
}

async function journalsByType(
  documentType: "PAYMENT",
  target: FastifyInstance = app,
): Promise<Array<{ documentId: string; documentType: string }>> {
  const response = await call(
    "GET",
    `/api/v1/financial-journals?documentType=${documentType}`,
    undefined,
    target,
  );
  expect(response.status).toBe(200);
  return response.body.data.journals;
}

describe("migration 119: payment + GL + audit are atomic", () => {
  it("rolls the payment back when the GL voucher cannot be written", async () => {
    const store = storeWith(FailingGlMemoryStore);
    const custom = memoryApp(store);
    const batch = await createBatchOn(custom, "ATOMIC-GL", [
      { personId: MEMBER, amount: "100" },
      { personId: ADMIN, amount: "200" },
    ]);
    expect(batch.id).toBeTruthy();
    await promoteOn(custom, batch.id);

    const failed = await payOn(custom, batch.id, [
      payment(batch.lines[0]!.id, "GL-FAIL-1", "100"),
      payment(batch.lines[1]!.id, "GL-FAIL-2", "200"),
    ]);
    expect(failed.status).toBe(500);

    const reconciliation = await reconcileOn(custom, batch.id);
    expect(reconciliation.paidAmount).toBe("0");
    expect(reconciliation.glComplete).toBe(true);
    expect(await store.listIncentiveAwardPaymentAudits(TENANT, batch.id)).toEqual([]);
    expect(await journalsByType("PAYMENT", custom)).toEqual([]);
  });

  it("rolls the payment back when the audit event cannot be written", async () => {
    const store = storeWith(FailingAuditMemoryStore);
    const custom = memoryApp(store);
    const batch = await createBatchOn(custom, "ATOMIC-AUDIT", [
      { personId: MEMBER, amount: "80" },
    ]);
    await promoteOn(custom, batch.id);

    const failed = await payOn(custom, batch.id, [
      payment(batch.lines[0]!.id, "AUDIT-FAIL-1", "80"),
    ]);
    expect(failed.status).toBe(500);

    const reconciliation = await reconcileOn(custom, batch.id);
    expect(reconciliation.paidAmount).toBe("0");
    expect(await store.listIncentiveAwardPaymentAudits(TENANT, batch.id)).toEqual([]);
    // GL 也必须跟着回滚，不能留下无支付的孤儿凭证。
    expect(await journalsByType("PAYMENT", custom)).toEqual([]);
  });

  it("appends the payment audit event in the same successful write", async () => {
    const batch = await createBatch("ATOMIC-OK", [
      { personId: MEMBER, amount: "60" },
    ]);
    await promote(batch.id);
    const recorded = await pay(batch.id, [
      payment(batch.lines[0]!.id, "AUDIT-OK-1", "60"),
    ]);
    expect(recorded.status).toBe(201);
    const paymentId = recorded.body.data.payments[0].id as string;

    const audits = await platformStore.listIncentiveAwardPaymentAudits(
      TENANT,
      batch.id,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      batchId: batch.id,
      paymentId,
      action: "INCENTIVE_AWARD_PAYMENT_RECORDED",
      actorType: "USER",
      actorId: OWNER,
    });
    expect(audits[0]!.reason).toContain("AUDIT-OK-1");
  });
});

describe("migration 119: acknowledgement gate", () => {
  it("rejects ordinary payments after ACK but accepts an independent RETURNED record", async () => {
    const batch = await createBatch("ACK-GATE", [
      { personId: MEMBER, amount: "250" },
    ]);
    await promote(batch.id);
    await pay(batch.id, [payment(batch.lines[0]!.id, "ACK-1", "250")]);
    const ack = await acknowledge(batch.id);
    expect(ack.status).toBe(200);
    expect(ack.body.data.status).toBe("ACKNOWLEDGED");

    const afterAckPaid = await pay(batch.id, [
      payment(batch.lines[0]!.id, "ACK-2", "250"),
    ]);
    expect(afterAckPaid.status).toBe(409);
    expect(afterAckPaid.body.error.message).toMatch(
      /AWARD_BATCH_ALREADY_ACKNOWLEDGED/,
    );

    const afterAckFailed = await pay(batch.id, [
      payment(batch.lines[0]!.id, "ACK-3", "250", { status: "FAILED" }),
    ]);
    expect(afterAckFailed.status).toBe(409);

    const returned = await pay(batch.id, [
      payment(batch.lines[0]!.id, "ACK-RET-1", "250", {
        status: "RETURNED",
      }),
    ]);
    expect(returned.status).toBe(201);
    expect(returned.body.data.createdPaymentIds).toHaveLength(1);

    // 历史 PAID 不被修改：对账仍是足额，ref 仍是原始回执。
    const reconciliation = await reconcile(batch.id);
    expect(reconciliation.status).toBe("RECONCILED");
    expect(reconciliation.paidAmount).toBe("250");
    expect(reconciliation.lines[0]!.paymentRefs).toEqual(["ACK-1"]);

    const audits = await platformStore.listIncentiveAwardPaymentAudits(
      TENANT,
      batch.id,
    );
    expect(audits).toHaveLength(2);
    expect(audits.map((event) => event.paymentId)).toContain(
      returned.body.data.payments[0].id,
    );
  });

  it("refuses ACK when a PAID receipt has no balanced GL voucher", async () => {
    const store = storeWith(MissingGlMemoryStore);
    const custom = memoryApp(store);
    const batch = await createBatchOn(custom, "ACK-NO-GL", [
      { personId: MEMBER, amount: "40" },
    ]);
    await promoteOn(custom, batch.id);
    const recorded = await payOn(custom, batch.id, [
      payment(batch.lines[0]!.id, "NO-GL-1", "40"),
    ]);
    expect(recorded.status).toBe(201);

    const reconciliation = await reconcileOn(custom, batch.id);
    expect(reconciliation.glComplete).toBe(false);
    expect(reconciliation.missingJournalLineIds).toEqual([
      batch.lines[0]!.id,
    ]);
    expect(reconciliation.status).toBe("GL_INCOMPLETE");

    const ack = await call(
      "POST",
      `/api/v1/incentive-award-batches/${batch.id}/commands`,
      { command: "ACKNOWLEDGE", paymentRef: "BANK-ACK" },
      custom,
    );
    expect(ack.status).toBe(409);
    expect(ack.body.error.message).toMatch(/AWARD_GL_MISSING/);
  });

  it("lets only one of two concurrent ACK commands win", async () => {
    const batch = await createBatch("ACK-RACE", [
      { personId: MEMBER, amount: "70" },
    ]);
    await promote(batch.id);
    await pay(batch.id, [payment(batch.lines[0]!.id, "RACE-1", "70")]);

    const [first, second] = await Promise.all([
      acknowledge(batch.id),
      acknowledge(batch.id),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const current = await call(
      "GET",
      `/api/v1/incentive-award-batches/${batch.id}`,
    );
    expect(current.body.data.status).toBe("ACKNOWLEDGED");
  });
});

describe("migration 119: idempotency includes ledger dimensions", () => {
  it("replays identical dimensions but rejects any changed dimension", async () => {
    const batch = await createBatch("IDEM-DIMS", [
      { personId: MEMBER, amount: "125" },
    ]);
    await promote(batch.id);
    const lineId = batch.lines[0]!.id;
    const original = payment(lineId, "DIMS-1", "125", {
      legalEntityId: "LE-CN-01",
      accountingPeriod: "2026-11",
      creditAccount: "PAYABLE",
    });

    const created = await pay(batch.id, [original]);
    expect(created.status).toBe(201);
    const paymentId = created.body.data.payments[0].id as string;
    expect(created.body.data.payments[0]).toMatchObject({
      legalEntityId: "LE-CN-01",
      accountingPeriod: "2026-11",
      creditAccount: "PAYABLE",
    });

    const replay = await pay(batch.id, [original]);
    expect(replay.status).toBe(200);
    expect(replay.body.data.payments[0].id).toBe(paymentId);

    for (const changed of [
      payment(lineId, "DIMS-1", "125", {
        legalEntityId: "LE-CN-02",
        accountingPeriod: "2026-11",
        creditAccount: "PAYABLE",
      }),
      payment(lineId, "DIMS-1", "125", {
        legalEntityId: "LE-CN-01",
        accountingPeriod: "2026-12",
        creditAccount: "PAYABLE",
      }),
      payment(lineId, "DIMS-1", "125", {
        legalEntityId: "LE-CN-01",
        accountingPeriod: "2026-11",
        creditAccount: "CASH",
      }),
    ]) {
      const conflict = await pay(batch.id, [changed]);
      expect(conflict.status).toBe(409);
      expect(conflict.body.error.message).toMatch(
        /AWARD_PAYMENT_IDEMPOTENCY_CONFLICT/,
      );
    }

    // 冲突不会产生额外支付或凭证。
    const reconciliation = await reconcile(batch.id);
    expect(reconciliation.paidAmount).toBe("125");
    expect(await journalsByType("PAYMENT")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------
// 迁移 119：PG 事务边界的 fake/mock 覆盖。
//
// 不依赖本地 Postgres：一个小型 fake pool 记录 SQL、模拟 BEGIN/COMMIT/
// ROLLBACK 与批次行锁；用 K 操作日志验证支付、GL、审计是否使用同一个
// client 并在失败时整体回滚。真实 PG 的行为由 test:pg 覆盖。
// ---------------------------------------------------------------------
type FakeRow = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function fakeResult(rows: FakeRow[] = []) {
  return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] };
}

class FakePgDatabase {
  readonly batches: FakeRow[] = [];
  readonly lines: FakeRow[] = [];
  readonly payments: FakeRow[] = [];
  readonly journals: FakeRow[] = [];
  readonly journalLines: FakeRow[] = [];
  readonly audits: FakeRow[] = [];
  readonly glAccounts = new Set<string>();
  readonly queryLog: string[] = [];
  readonly locks = new Map<string, Promise<void>>();
  failOn?: "gl_journal" | "audit";

  async acquireLock(key: string): Promise<() => void> {
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, gate);
    return () => {
      if (this.locks.get(key) === gate) this.locks.delete(key);
      release();
    };
  }
}

class FakePgClient {
  private readonly undo: Array<() => void> = [];
  private readonly releases: Array<() => void> = [];

  constructor(
    private readonly db: FakePgDatabase,
    private readonly log: string[],
  ) {}

  async query(sql: string, params: unknown[] = []): Promise<ReturnType<typeof fakeResult>> {
    const q = sql.replace(/\s+/g, " ").trim().toLowerCase();
    this.log.push(q);
    if (q === "begin") return fakeResult();
    if (q === "commit" || q === "rollback") {
      if (q === "rollback") {
        for (const undo of this.undo.reverse()) undo();
      }
      this.undo.length = 0;
      for (const release of this.releases.reverse()) release();
      this.releases.length = 0;
      return fakeResult();
    }
    if (q.startsWith("select set_config")) return fakeResult();

    if (q.includes("from incentive_award_batches") && q.includes("for update")) {
      const release = await this.db.acquireLock(`${String(params[0])}:${String(params[1])}`);
      this.releases.push(release);
      const row = this.db.batches.find(
        (batch) => batch.tenant_id === params[0] && batch.id === params[1],
      );
      return fakeResult(row ? [row] : []);
    }

    if (q.includes("from incentive_award_lines")) {
      return fakeResult(
        this.db.lines
          .filter(
            (line) =>
              line.tenant_id === params[0] && line.batch_id === params[1],
          )
          .sort((left, right) =>
            String(left.created_at).localeCompare(String(right.created_at)),
          ),
      );
    }

    if (q.includes("insert into incentive_award_payments")) {
      const row: FakeRow = {
        id: params[0],
        tenant_id: params[1],
        batch_id: params[2],
        line_id: params[3],
        person_id: params[4],
        amount: params[5],
        currency: params[6],
        payment_ref: params[7],
        status: params[8],
        paid_at: params[9],
        failure_code: params[10],
        legal_entity_id: params[11],
        accounting_period: params[12],
        credit_account: params[13],
        created_at: new Date().toISOString(),
      };
      const conflict = this.db.payments.some(
        (payment) =>
          payment.tenant_id === row.tenant_id &&
          payment.batch_id === row.batch_id &&
          payment.line_id === row.line_id &&
          payment.payment_ref === row.payment_ref,
      );
      if (conflict) return fakeResult();
      this.db.payments.push(row);
      this.undo.push(() => {
        const index = this.db.payments.indexOf(row);
        if (index >= 0) this.db.payments.splice(index, 1);
      });
      return fakeResult([row]);
    }

    if (q.includes("insert into gl_accounts")) {
      this.db.glAccounts.add(`${String(params[0])}:${String(params[1])}`);
      return fakeResult();
    }

    if (q.includes("insert into gl_journals")) {
      if (this.db.failOn === "gl_journal") {
        throw new Error("FAKE_GL_WRITE_FAILED");
      }
      const existing = this.db.journals.find(
        (journal) =>
          journal.tenant_id === params[0] &&
          journal.document_type === params[2] &&
          journal.document_id === params[3],
      );
      if (existing) return fakeResult();
      const row: FakeRow = {
        id: `journal-${this.db.journals.length + 1}`,
        tenant_id: params[0],
        journal_no: params[1],
        document_type: params[2],
        document_id: params[3],
        legal_entity_id: params[4],
        accounting_period: params[5],
        currency: params[6],
        description: params[7],
        source_fact_id: params[8],
        total_debit: params[9],
        total_credit: params[10],
        created_at: new Date().toISOString(),
      };
      this.db.journals.push(row);
      this.undo.push(() => {
        const index = this.db.journals.indexOf(row);
        if (index >= 0) this.db.journals.splice(index, 1);
      });
      return fakeResult([row]);
    }

    if (q.includes("insert into gl_journal_lines")) {
      const row: FakeRow = {
        id: `journal-line-${this.db.journalLines.length + 1}`,
        tenant_id: params[0],
        journal_id: params[1],
        line_no: params[2],
        account_code: params[3],
        debit: params[4],
        credit: params[5],
        currency: params[6],
      };
      this.db.journalLines.push(row);
      this.undo.push(() => {
        const index = this.db.journalLines.indexOf(row);
        if (index >= 0) this.db.journalLines.splice(index, 1);
      });
      return fakeResult([row]);
    }

    if (q.includes("insert into audit_events")) {
      if (this.db.failOn === "audit") {
        throw new Error("FAKE_AUDIT_WRITE_FAILED");
      }
      const row: FakeRow = {
        id: `audit-${this.db.audits.length + 1}`,
        tenant_id: params[0],
        sequence: this.db.audits.length + 1,
        actor_type: params[1],
        actor_id: params[2],
        action: "INCENTIVE_AWARD_PAYMENT_RECORDED",
        object_type: "INCENTIVE_AWARD_PAYMENT",
        object_id: params[3],
        reason: params[4],
        correlation_id: params[5],
        occurred_at: new Date().toISOString(),
      };
      this.db.audits.push(row);
      this.undo.push(() => {
        const index = this.db.audits.indexOf(row);
        if (index >= 0) this.db.audits.splice(index, 1);
      });
      return fakeResult([row]);
    }

    if (q.includes("from gl_journals") && q.includes("select document_id")) {
      const documentIds = (params[1] as string[]) ?? [];
      return fakeResult(
        this.db.journals.filter(
          (journal) =>
            journal.tenant_id === params[0] &&
            journal.document_type === "PAYMENT" &&
            documentIds.includes(journal.document_id),
        ),
      );
    }

    if (q.includes("from gl_journals")) {
      return fakeResult(
        this.db.journals.filter(
          (journal) =>
            journal.tenant_id === params[0] &&
            journal.document_type === params[1] &&
            journal.document_id === params[2],
        ),
      );
    }

    if (q.includes("from incentive_award_payments")) {
      if (params.length === 4) {
        return fakeResult(
          this.db.payments.filter(
            (payment) =>
              payment.tenant_id === params[0] &&
              payment.batch_id === params[1] &&
              payment.line_id === params[2] &&
              payment.payment_ref === params[3],
          ),
        );
      }
      return fakeResult(
        this.db.payments
          .filter(
            (payment) =>
              payment.tenant_id === params[0] &&
              payment.batch_id === params[1],
          )
          .sort((left, right) =>
            String(left.created_at).localeCompare(String(right.created_at)),
          ),
      );
    }

    if (q.includes("update incentive_award_batches")) {
      const batch = this.db.batches.find(
        (candidate) =>
          candidate.tenant_id === params[0] &&
          candidate.id === params[1] &&
          candidate.status === params[6],
      );
      if (!batch) return fakeResult();
      const before = { ...batch };
      this.undo.push(() => Object.assign(batch, before));
      batch.status = params[2];
      batch.updated_at = new Date().toISOString();
      batch.version = Number(batch.version) + 1;
      if (params[3] === "APPROVE") {
        batch.approved_by = params[4];
        batch.approved_at = new Date().toISOString();
      }
      if (params[3] === "LOCK") batch.locked_at = new Date().toISOString();
      if (params[3] === "EXPORT") batch.exported_at = new Date().toISOString();
      if (params[3] === "ACKNOWLEDGE") {
        batch.acknowledged_at = new Date().toISOString();
        batch.payment_ref = params[5];
      }
      return fakeResult([batch]);
    }

    if (q.includes("from audit_events") && q.includes("join incentive_award_payments")) {
      return fakeResult(
        this.db.audits.filter((audit) => {
          const payment = this.db.payments.find(
            (candidate) =>
              candidate.tenant_id === audit.tenant_id &&
              candidate.id === audit.object_id,
          );
          return (
            audit.tenant_id === params[0] &&
            audit.object_type === "INCENTIVE_AWARD_PAYMENT" &&
            payment?.batch_id === params[1]
          );
        }),
      );
    }

    throw new Error(`FAKE_PG_UNHANDLED: ${q}`);
  }

  release(): void {
    for (const release of this.releases.reverse()) release();
    this.releases.length = 0;
  }
}

class FakePgPool {
  constructor(private readonly db: FakePgDatabase) {}

  async connect(): Promise<FakePgClient> {
    return new FakePgClient(this.db, this.db.queryLog);
  }
}

const PG_TENANT = "00000000-0000-4000-8000-0000000000aa";
const PG_BATCH = "00000000-0000-4000-8000-0000000000b1";
const PG_LINE = "00000000-0000-4000-8000-0000000000c1";
const PG_PERSON = "00000000-0000-4000-8000-000000000001";

function seedPgBatch(
  db: FakePgDatabase,
  options: { status?: string; amount?: string } = {},
): void {
  const nowIso = new Date().toISOString();
  const amount = options.amount ?? "100";
  db.batches.push({
    id: PG_BATCH,
    tenant_id: PG_TENANT,
    batch_no: "PG-ATOMIC-1",
    award_type: "MONTHLY_STAR",
    period: "2026-11",
    cycle_id: null,
    currency: "CNY",
    status: options.status ?? "EXPORTED",
    total_amount: amount,
    line_count: 1,
    source_record_ids: [],
    created_by: PG_PERSON,
    approved_by: null,
    approved_at: null,
    locked_at: nowIso,
    exported_at: nowIso,
    acknowledged_at: null,
    payment_ref: null,
    created_at: nowIso,
    updated_at: nowIso,
    version: 1,
  });
  db.lines.push({
    id: PG_LINE,
    tenant_id: PG_TENANT,
    batch_id: PG_BATCH,
    person_id: PG_PERSON,
    amount,
    currency: "CNY",
    source_record_id: null,
    source_line_ref: null,
    note: null,
    created_at: nowIso,
  });
}

function pgStore(db: FakePgDatabase) {
  return new PgPlatformStore(new FakePgPool(db) as unknown as Pool);
}

function pgPayment(overrides: Record<string, unknown> = {}) {
  return {
    lineId: PG_LINE,
    paymentRef: "PG-PAY-1",
    status: "PAID" as const,
    amount: "100",
    currency: "CNY",
    ...overrides,
  };
}

describe("migration 119: PG transaction boundary (fake pool)", () => {
  it("uses one client for BEGIN, payment, GL and audit, then COMMIT", async () => {
    const db = new FakePgDatabase();
    seedPgBatch(db);
    const store = pgStore(db);

    const result = await store.recordIncentiveAwardPayments({
      tenantId: PG_TENANT,
      batchId: PG_BATCH,
      actorPersonId: PG_PERSON,
      payments: [pgPayment()],
    });
    expect(result.createdPaymentIds).toHaveLength(1);
    expect(result.reconciliation.glComplete).toBe(true);
    expect(result.reconciliation.status).toBe("RECONCILED");
    expect(db.payments).toHaveLength(1);
    expect(db.journals).toHaveLength(1);
    expect(db.journalLines).toHaveLength(2);
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]!.object_id).toBe(db.payments[0]!.id);

    const log = db.queryLog;
    expect(log[0]).toBe("begin");
    expect(log.at(-1)).toBe("commit");
    expect(log).not.toContain("rollback");
    expect(
      log.findIndex((entry) => entry.includes("insert into incentive_award_payments")),
    ).toBeLessThan(log.findIndex((entry) => entry.includes("insert into gl_journals")));
    expect(
      log.findIndex((entry) => entry.includes("insert into gl_journals")),
    ).toBeLessThan(log.findIndex((entry) => entry.includes("insert into audit_events")));
  });

  it("rolls back the payment when the GL insert fails", async () => {
    const db = new FakePgDatabase();
    seedPgBatch(db);
    db.failOn = "gl_journal";
    const store = pgStore(db);

    await expect(
      store.recordIncentiveAwardPayments({
        tenantId: PG_TENANT,
        batchId: PG_BATCH,
        actorPersonId: PG_PERSON,
        payments: [pgPayment()],
      }),
    ).rejects.toThrow(/FAKE_GL_WRITE_FAILED/);

    expect(db.payments).toHaveLength(0);
    expect(db.journals).toHaveLength(0);
    expect(db.audits).toHaveLength(0);
    expect(db.queryLog).toContain("rollback");
    const current = db.batches[0]!;
    expect(current.status).toBe("EXPORTED");
  });

  it("rolls back the payment and GL when the audit insert fails", async () => {
    const db = new FakePgDatabase();
    seedPgBatch(db);
    db.failOn = "audit";
    const store = pgStore(db);

    await expect(
      store.recordIncentiveAwardPayments({
        tenantId: PG_TENANT,
        batchId: PG_BATCH,
        actorPersonId: PG_PERSON,
        payments: [pgPayment()],
      }),
    ).rejects.toThrow(/FAKE_AUDIT_WRITE_FAILED/);

    expect(db.payments).toHaveLength(0);
    expect(db.journals).toHaveLength(0);
    expect(db.journalLines).toHaveLength(0);
    expect(db.audits).toHaveLength(0);
    expect(db.queryLog).toContain("rollback");
  });

  it("rejects ACK when a PAID payment has no balanced journal", async () => {
    const db = new FakePgDatabase();
    seedPgBatch(db);
    db.payments.push({
      id: "00000000-0000-4000-8000-0000000000d1",
      tenant_id: PG_TENANT,
      batch_id: PG_BATCH,
      line_id: PG_LINE,
      person_id: PG_PERSON,
      amount: "100",
      currency: "CNY",
      payment_ref: "PG-ORPHAN",
      status: "PAID",
      paid_at: new Date().toISOString(),
      failure_code: null,
      legal_entity_id: "DEFAULT",
      accounting_period: "2026-11",
      credit_account: "CASH",
      created_at: new Date().toISOString(),
    });
    const store = pgStore(db);

    await expect(
      store.commandIncentiveAwardBatch({
        tenantId: PG_TENANT,
        batchId: PG_BATCH,
        command: "ACKNOWLEDGE",
        actorPersonId: PG_PERSON,
        paymentRef: "BANK-ACK",
      }),
    ).rejects.toThrow(/AWARD_GL_MISSING/);
    expect(db.batches[0]!.status).toBe("EXPORTED");
  });

  it("allows only one of two concurrent ACK transactions", async () => {
    const db = new FakePgDatabase();
    seedPgBatch(db);
    const paidAt = new Date().toISOString();
    const paymentId = "00000000-0000-4000-8000-0000000000d2";
    db.payments.push({
      id: paymentId,
      tenant_id: PG_TENANT,
      batch_id: PG_BATCH,
      line_id: PG_LINE,
      person_id: PG_PERSON,
      amount: "100",
      currency: "CNY",
      payment_ref: "PG-PAID",
      status: "PAID",
      paid_at: paidAt,
      failure_code: null,
      legal_entity_id: "DEFAULT",
      accounting_period: "2026-11",
      credit_account: "CASH",
      created_at: paidAt,
    });
    db.journals.push({
      id: "00000000-0000-4000-8000-0000000000e1",
      tenant_id: PG_TENANT,
      journal_no: `JE-PAYMENT-${paymentId}`,
      document_type: "PAYMENT",
      document_id: paymentId,
      legal_entity_id: "DEFAULT",
      accounting_period: "2026-11",
      currency: "CNY",
      description: null,
      source_fact_id: null,
      total_debit: "100",
      total_credit: "100",
      created_at: paidAt,
    });
    const store = pgStore(db);

    const results = await Promise.allSettled([
      store.commandIncentiveAwardBatch({
        tenantId: PG_TENANT,
        batchId: PG_BATCH,
        command: "ACKNOWLEDGE",
        actorPersonId: PG_PERSON,
        paymentRef: "BANK-ACK-1",
      }),
      store.commandIncentiveAwardBatch({
        tenantId: PG_TENANT,
        batchId: PG_BATCH,
        command: "ACKNOWLEDGE",
        actorPersonId: PG_PERSON,
        paymentRef: "BANK-ACK-2",
      }),
    ]);
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (entry): entry is PromiseRejectedResult => entry.status === "rejected",
    );
    expect(String(rejected?.reason)).toMatch(/ACKNOWLEDGE|status/);
    expect(db.batches[0]!.status).toBe("ACKNOWLEDGED");
  });

  it("includes ledger dimensions in the PG idempotency payload", async () => {
    const db = new FakePgDatabase();
    seedPgBatch(db, { amount: "100" });
    const store = pgStore(db);
    const base = {
      tenantId: PG_TENANT,
      batchId: PG_BATCH,
      actorPersonId: PG_PERSON,
    };
    const first = await store.recordIncentiveAwardPayments({
      ...base,
      payments: [
        pgPayment({
          legalEntityId: "LE-PG-1",
          accountingPeriod: "2026-11",
          creditAccount: "PAYABLE",
        }),
      ],
    });
    expect(first.createdPaymentIds).toHaveLength(1);

    const replay = await store.recordIncentiveAwardPayments({
      ...base,
      payments: [
        pgPayment({
          legalEntityId: "LE-PG-1",
          accountingPeriod: "2026-11",
          creditAccount: "PAYABLE",
        }),
      ],
    });
    expect(replay.createdPaymentIds).toHaveLength(0);

    await expect(
      store.recordIncentiveAwardPayments({
        ...base,
        payments: [
          pgPayment({
            legalEntityId: "LE-PG-2",
            accountingPeriod: "2026-11",
            creditAccount: "PAYABLE",
          }),
        ],
      }),
    ).rejects.toThrow(/AWARD_PAYMENT_IDEMPOTENCY_CONFLICT/);
    expect(db.payments).toHaveLength(1);
  });
});
