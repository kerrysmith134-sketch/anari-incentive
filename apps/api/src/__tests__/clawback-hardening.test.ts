/*
 * Clawback hardening: the recovery chain must never leave money moving after a
 * case is closed, and a recovery must only ever attach to the debtor's own,
 * positive, same-cycle ledger entry.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MATE = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";
const CYCLE = "00000000-0000-4000-8000-000000000020";
const OTHER_CYCLE = "00000000-0000-4000-8000-000000000021";
const TENANT = "tenant-demo";

let app: FastifyInstance;
let appStore: Store;
let platformStore: MemoryPlatformStore;
let seedCounter = 0;

async function call(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await app.inject({ method, url, payload } as never);
  return {
    status: response.statusCode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get body(): any {
      return response.json();
    },
  };
}

function seedLockedEntry(input: {
  personId: string;
  amount: string;
  cycleId?: string;
  currency?: string;
}) {
  seedCounter += 1;
  const entry = appStore.ledger.append({
    tenantId: TENANT,
    personId: input.personId,
    cycleId: input.cycleId ?? CYCLE,
    calculationRunId: `00000000-0000-4000-8000-00000000${String(seedCounter).padStart(4, "0")}`,
    calculationLineId: `seed-line-${seedCounter}`,
    entryType: "INCENTIVE",
    amount: input.amount,
    currency: input.currency ?? "CNY",
    idempotencyKey: `seed-ledger-${seedCounter}`,
  });
  return appStore.ledger.lock(entry.id);
}

async function createClawback(
  overrides: Partial<{
    personId: string;
    amount: string;
    currency: string;
    installmentMonths: number;
  }> = {},
) {
  return call("POST", "/api/v1/clawback-cases", {
    personId: overrides.personId ?? OWNER,
    amount: overrides.amount ?? "500",
    currency: overrides.currency ?? "CNY",
    reasonCode: "OVERPAYMENT",
    explanation: "Incentive was overpaid for the same delivery",
    consentSignatureRef: "ESIGN-CLAWBACK-HARDENING",
    installmentMonths: overrides.installmentMonths ?? 1,
    hardshipWaiver: false,
    requestedBy: OWNER,
  });
}

async function approvedCaseId(overrides?: Parameters<typeof createClawback>[0]) {
  const created = await createClawback(overrides);
  expect(created.status).toBe(201);
  const caseId = created.body.data.id;
  const approved = await call(
    "POST",
    `/api/v1/clawback-cases/${caseId}/approve`,
    { approvedBy: ADMIN },
  );
  expect(approved.status).toBe(200);
  return caseId;
}

function waive(caseId: string) {
  return call("POST", `/api/v1/clawback-cases/${caseId}/waive`, {
    reason: "Reviewed and waived",
    actorPersonId: ADMIN,
  });
}

beforeEach(() => {
  seedCounter = 0;
  appStore = new Store();
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: TENANT,
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "Sales Lead" },
        { id: MATE, employeeCode: "E002", displayName: "Teammate" },
        { id: ADMIN, employeeCode: "E003", displayName: "Finance" },
      ],
    },
  });
  app = buildApp(appStore, undefined, undefined, platformStore);
});

describe("clawback waiver settlement hygiene", () => {
  it("excludes both legs of the waived pair so a later sweep cannot pay the reversal", async () => {
    const incentive = seedLockedEntry({ personId: OWNER, amount: "3000" });
    const caseId = await approvedCaseId();
    const generated = await call(
      "POST",
      `/api/v1/clawback-cases/${caseId}/generate-recovery`,
      { cycleId: CYCLE, ledgerEntryId: incentive.id, createBatch: false },
    );
    expect(generated.status).toBe(200);

    const waived = await waive(caseId);
    expect(waived.status).toBe(200);
    expect(waived.body.data.reversalEntryId).toBeTruthy();

    // The recovery (-500) and its waiver reversal (+500) must both be kept out
    // of the next sweep; otherwise the employee is paid the waived amount.
    const batch = await call("POST", "/api/v1/settlement-batches", {
      cycleId: CYCLE,
    });
    expect(batch.status).toBe(201);
    const lines = await call(
      "GET",
      `/api/v1/settlement-batches/${batch.body.data.id}`,
    );
    expect(
      lines.body.data.lines.map((line: { amount: string }) => line.amount),
    ).toEqual(["3000"]);
    expect(batch.body.data.totalAmount).toBe("3000");

    // Re-waiving must not post a second reversal.
    const again = await waive(caseId);
    expect(again.status).toBe(409);
    const reversals = (await appStore.listLedger()).filter(
      (entry) => entry.idempotencyKey === `clawback-waive:${caseId}`,
    );
    expect(reversals).toHaveLength(1);
  });

  it("never lets a clawback recovery ride a standard settlement batch", async () => {
    const incentive = seedLockedEntry({ personId: OWNER, amount: "3000" });
    const caseId = await approvedCaseId();
    await call("POST", `/api/v1/clawback-cases/${caseId}/generate-recovery`, {
      cycleId: CYCLE,
      ledgerEntryId: incentive.id,
      createBatch: false,
    });

    // A standard sweep must skip the recovery: settling it there would bypass
    // the per-person confirmation gate that RECOVERY batches enforce.
    const standard = await call("POST", "/api/v1/settlement-batches", {
      cycleId: CYCLE,
    });
    expect(standard.status).toBe(201);
    const standardLines = await call(
      "GET",
      `/api/v1/settlement-batches/${standard.body.data.id}`,
    );
    expect(
      standardLines.body.data.lines.map(
        (line: { amount: string }) => line.amount,
      ),
    ).toEqual(["3000"]);

    const recovery = await call("POST", "/api/v1/settlement-batches", {
      cycleId: CYCLE,
      kind: "RECOVERY",
    });
    expect(recovery.status).toBe(201);
    expect(recovery.body.data.totalAmount).toBe("-500");
    expect(recovery.body.data.kind).toBe("RECOVERY");
  });
});

describe("clawback cancellation cannot orphan a recovery", () => {
  it("refuses to cancel after the recovery was generated", async () => {
    const incentive = seedLockedEntry({ personId: OWNER, amount: "3000" });
    const caseId = await approvedCaseId();
    await call("POST", `/api/v1/clawback-cases/${caseId}/generate-recovery`, {
      cycleId: CYCLE,
      ledgerEntryId: incentive.id,
      createBatch: false,
    });

    const cancelled = await call(
      "POST",
      `/api/v1/clawback-cases/${caseId}/cancel`,
      { reason: "Mistaken case", actorPersonId: ADMIN },
    );
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.error.message).toContain(
      "CLAWBACK_RECOVERY_ALREADY_GENERATED",
    );
    const listed = await call("GET", "/api/v1/clawback-cases");
    const current = listed.body.data.find(
      (candidate: { id: string }) => candidate.id === caseId,
    );
    expect(current.status).toBe("RECOVERY_GENERATED");
    expect((await appStore.listLedger()).filter((e) => e.amount === "-500")).toHaveLength(1);
  });
});

describe("clawback recovery source entry validation", () => {
  it("rejects a ledger entry that belongs to someone else", async () => {
    const foreign = seedLockedEntry({ personId: MATE, amount: "2000" });
    const caseId = await approvedCaseId();
    const generated = await call(
      "POST",
      `/api/v1/clawback-cases/${caseId}/generate-recovery`,
      { cycleId: CYCLE, ledgerEntryId: foreign.id, createBatch: false },
    );
    expect(generated.status).toBe(409);
    expect(generated.body.error.message).toContain(
      "CLAWBACK_ENTRY_PERSON_MISMATCH",
    );
    expect(
      (await appStore.listLedger()).some(
        (entry) => entry.idempotencyKey === `clawback-recovery:${caseId}`,
      ),
    ).toBe(false);
  });

  it("rejects a negative source entry", async () => {
    const incentive = seedLockedEntry({ personId: OWNER, amount: "3000" });
    const reversal = await appStore.reverseLedgerEntry(incentive.id, {
      idempotencyKey: "seed-reversal-for-sign",
      reason: "Order corrected",
      approvedBy: ADMIN,
    });
    const caseId = await approvedCaseId();
    const generated = await call(
      "POST",
      `/api/v1/clawback-cases/${caseId}/generate-recovery`,
      { cycleId: CYCLE, ledgerEntryId: reversal.id, createBatch: false },
    );
    expect(generated.status).toBe(409);
    expect(generated.body.error.message).toContain(
      "CLAWBACK_ENTRY_NOT_POSITIVE",
    );
  });

  it("rejects a currency mismatch between case and source entry", async () => {
    const usd = seedLockedEntry({
      personId: OWNER,
      amount: "3000",
      currency: "USD",
    });
    const caseId = await approvedCaseId({ currency: "CNY" });
    const generated = await call(
      "POST",
      `/api/v1/clawback-cases/${caseId}/generate-recovery`,
      { cycleId: CYCLE, ledgerEntryId: usd.id, createBatch: false },
    );
    expect(generated.status).toBe(409);
    expect(generated.body.error.message).toContain(
      "CLAWBACK_CURRENCY_MISMATCH",
    );
  });

  it("rejects a source entry from another cycle", async () => {
    const otherCycle = seedLockedEntry({
      personId: OWNER,
      amount: "3000",
      cycleId: OTHER_CYCLE,
    });
    const caseId = await approvedCaseId();
    const generated = await call(
      "POST",
      `/api/v1/clawback-cases/${caseId}/generate-recovery`,
      { cycleId: CYCLE, ledgerEntryId: otherCycle.id, createBatch: false },
    );
    expect(generated.status).toBe(409);
    expect(generated.body.error.message).toContain(
      "CLAWBACK_CYCLE_MISMATCH",
    );
  });
});

describe("recovery adjustment idempotency", () => {
  it("returns the original record when a RECOVERY adjustment is retried", async () => {
    const incentive = seedLockedEntry({ personId: OWNER, amount: "3000" });
    const input = {
      amount: "-500",
      reasonCode: "CLAWBACK_RECOVERY",
      explanation: "Retry safety",
      approvedBy: ADMIN,
      idempotencyKey: "recovery-retry-key",
      entryType: "RECOVERY" as const,
    };
    const first = await appStore.adjustLedgerEntry(incentive.id, input);
    const second = await appStore.adjustLedgerEntry(incentive.id, input);
    expect(second.entry.id).toBe(first.entry.id);
    expect(second.record.id).toBe(first.record.id);
    expect(
      (await appStore.listAdjustmentRecords()).filter(
        (record) => record.adjustmentLedgerId === first.entry.id,
      ),
    ).toHaveLength(1);
  });
});

describe("clawback actor validation", () => {
  it("refuses an approval from a person outside the tenant", async () => {
    const created = await createClawback();
    const approved = await call(
      "POST",
      `/api/v1/clawback-cases/${created.body.data.id}/approve`,
      { approvedBy: "00000000-0000-4000-8000-0000000000ff" },
    );
    expect(approved.status).toBe(404);
    const listed = await call("GET", "/api/v1/clawback-cases");
    const current = listed.body.data.find(
      (candidate: { id: string }) => candidate.id === created.body.data.id,
    );
    expect(current.status).toBe("DRAFT");
  });

  it("refuses a waiver whose actor does not exist before posting a reversal", async () => {
    const incentive = seedLockedEntry({ personId: OWNER, amount: "3000" });
    const caseId = await approvedCaseId();
    await call("POST", `/api/v1/clawback-cases/${caseId}/generate-recovery`, {
      cycleId: CYCLE,
      ledgerEntryId: incentive.id,
      createBatch: false,
    });
    const waived = await call(
      "POST",
      `/api/v1/clawback-cases/${caseId}/waive`,
      {
        reason: "Invalid actor",
        actorPersonId: "00000000-0000-4000-8000-0000000000ff",
      },
    );
    expect(waived.status).toBe(404);
    expect(
      (await appStore.listLedger()).some(
        (entry) => entry.idempotencyKey === `clawback-waive:${caseId}`,
      ),
    ).toBe(false);
  });
});

describe("clawback installments across cycles", () => {
  it("posts one recovery per cycle and reverses all of them on waiver", async () => {
    const incentive = seedLockedEntry({ personId: OWNER, amount: "3000" });
    const secondCycle = await appStore.createEvaluationCycle({
      name: "2026-11",
      cycleType: "MONTHLY",
      startsAt: "2026-11-01T00:00:00.000Z",
      endsAt: "2026-11-30T23:59:59.000Z",
      timezone: "Asia/Shanghai",
    });
    const caseId = await approvedCaseId({
      amount: "1000",
      installmentMonths: 2,
    });
    const generated = await call(
      "POST",
      `/api/v1/clawback-cases/${caseId}/generate-recovery`,
      {
        cycleId: CYCLE,
        ledgerEntryId: incentive.id,
        createBatch: false,
        installmentCycles: [CYCLE, secondCycle.id],
      },
    );
    expect(generated.status).toBe(200);
    expect(generated.body.data.installments).toHaveLength(2);
    expect(
      generated.body.data.installments.map(
        (row: { amount: string }) => row.amount,
      ),
    ).toEqual(["500", "500"]);

    const recoveries = (await appStore.listLedger()).filter(
      (entry) => entry.entryType === "RECOVERY",
    );
    expect(recoveries).toHaveLength(2);
    expect(new Set(recoveries.map((entry) => entry.cycleId))).toEqual(
      new Set([CYCLE, secondCycle.id]),
    );

    const waived = await waive(caseId);
    expect(waived.status).toBe(200);
    expect(waived.body.data.reversalEntryIds).toHaveLength(2);
    expect(
      (await appStore.listLedger()).filter(
        (entry) => entry.entryType === "REVERSAL",
      ),
    ).toHaveLength(2);

    // Both installments and both reversals are excluded from later sweeps.
    const sweep = await call("POST", "/api/v1/settlement-batches", {
      cycleId: secondCycle.id,
    });
    expect(sweep.status).toBe(409);
    expect(sweep.body.error.message).toContain(
      "NO_SETTLEMENT_ELIGIBLE_LEDGER",
    );
  });

  it("rejects a cycle list that does not match the case term", async () => {
    const incentive = seedLockedEntry({ personId: OWNER, amount: "3000" });
    const created = await call("POST", "/api/v1/clawback-cases", {
      personId: OWNER,
      amount: "1000",
      currency: "CNY",
      reasonCode: "OVERPAYMENT",
      explanation: "Two installments",
      consentSignatureRef: "ESIGN-INSTALLMENTS-2",
      installmentMonths: 2,
      requestedBy: OWNER,
    });
    const caseId = created.body.data.id;
    await call("POST", `/api/v1/clawback-cases/${caseId}/approve`, {
      approvedBy: ADMIN,
    });
    const generated = await call(
      "POST",
      `/api/v1/clawback-cases/${caseId}/generate-recovery`,
      {
        cycleId: CYCLE,
        ledgerEntryId: incentive.id,
        createBatch: false,
        installmentCycles: [CYCLE],
      },
    );
    expect(generated.status).toBe(400);
    expect(generated.body.error.code).toBe(
      "CLAWBACK_INSTALLMENT_COUNT_MISMATCH",
    );
  });
});

describe("malformed identifiers never surface as 500", () => {
  it("maps a PostgreSQL invalid-uuid error to 404 on batch lookup", async () => {
    const failing = Object.assign(appStore, {
      async getSettlementBatch(): Promise<never> {
        throw Object.assign(
          new Error('invalid input syntax for type uuid: "not-a-uuid"'),
          { code: "22P02" },
        );
      },
    });
    app = buildApp(failing, undefined, undefined, platformStore);
    const response = await call(
      "GET",
      "/api/v1/settlement-batches/not-a-uuid",
    );
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});
