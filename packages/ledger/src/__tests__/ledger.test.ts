import { describe, expect, it } from "vitest";
import { InMemoryLedger, LedgerError } from "../index.js";

const base = {
  tenantId: "tenant-1",
  personId: "person-1",
  cycleId: "cycle-1",
  calculationRunId: "run-1",
  calculationLineId: "line-1",
  entryType: "INCENTIVE" as const,
  amount: "100.00",
  currency: "CNY",
  idempotencyKey: "run-1:line-1:INCENTIVE",
};

describe("InMemoryLedger", () => {
  it("appends entries and maintains a valid hash chain", () => {
    const ledger = new InMemoryLedger();
    ledger.append(base);
    ledger.append({ ...base, calculationLineId: "line-2", idempotencyKey: "run-1:line-2:INCENTIVE" });
    expect(ledger.list("tenant-1")).toHaveLength(2);
    expect(ledger.verifyChain("tenant-1")).toBe(true);
  });

  it("is idempotent for the same key and payload", () => {
    const ledger = new InMemoryLedger();
    const first = ledger.append(base);
    const second = ledger.append(base);
    expect(second.id).toBe(first.id);
    expect(ledger.list()).toHaveLength(1);
  });

  it("rejects the same idempotency key with a different payload", () => {
    const ledger = new InMemoryLedger();
    ledger.append(base);
    expect(() => ledger.append({ ...base, amount: "101.00" })).toThrow(LedgerError);
  });

  it("rejects a second entry for the same calculation line", () => {
    const ledger = new InMemoryLedger();
    ledger.append(base);
    expect(() =>
      ledger.append({ ...base, idempotencyKey: "another-key" }),
    ).toThrow(/already exists/i);
  });

  it("prevents mutation after lock", () => {
    const ledger = new InMemoryLedger();
    const entry = ledger.append(base);
    ledger.lock(entry.id);
    expect(() => ledger.setStatus(entry.id, "APPROVED")).toThrow(/immutable/i);
    expect(ledger.verifyChain("tenant-1")).toBe(true);
  });

  it("rejects reversing the same source entry twice (any idempotency key)", () => {
    const ledger = new InMemoryLedger();
    const original = ledger.append(base);
    ledger.reverse(original.id, {
      tenantId: base.tenantId,
      personId: base.personId,
      cycleId: base.cycleId,
      calculationRunId: base.calculationRunId,
      currency: "CNY",
      idempotencyKey: "reversal-1",
    });
    expect(() =>
      ledger.reverse(original.id, {
        tenantId: base.tenantId,
        personId: base.personId,
        cycleId: base.cycleId,
        calculationRunId: base.calculationRunId,
        currency: "CNY",
        idempotencyKey: "reversal-2",
      }),
    ).toThrow(/already been reversed/i);
  });

  it("balance is exact (bigint, no float drift)", () => {
    const ledger = new InMemoryLedger();
    ledger.append({ ...base, amount: "0.10", idempotencyKey: "k-1" });
    ledger.append({
      ...base,
      calculationLineId: "line-2",
      amount: "0.20",
      idempotencyKey: "k-2",
    });
    // 浮点 0.1+0.2 会是 0.30000000000000004；bigint 必须是 0.30。
    expect(ledger.balance(base.personId, "CNY")).toBe("0.3");
  });

  it("supports reversal as a new linked entry", () => {
    const ledger = new InMemoryLedger();
    const original = ledger.append(base);
    const reversal = ledger.reverse(original.id, {
      tenantId: base.tenantId,
      personId: base.personId,
      cycleId: base.cycleId,
      calculationRunId: base.calculationRunId,
      currency: base.currency,
      idempotencyKey: "reversal-1",
    });
    expect(reversal.amount).toBe("-100.00");
    expect(reversal.sourceEntryId).toBe(original.id);
    expect(ledger.balance("person-1", "CNY")).toBe("0");
    expect(ledger.verifyChain("tenant-1")).toBe(true);
  });

  it("requires a source entry for adjustments/reversals", () => {
    const ledger = new InMemoryLedger();
    expect(() =>
      ledger.append({ ...base, entryType: "ADJUSTMENT" }),
    ).toThrow(/source/i);
  });
});
