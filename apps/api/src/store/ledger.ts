import { randomUUID } from "node:crypto";
import {
  type AmountLedgerEntry,
  type AdjustmentRecord,
} from "@anari/domain";
import {
  formatDecimal,
  parseDecimal,
} from "@anari/policy-dsl";
import {
  ConflictError,
  now,
  notFound,
} from "../store-support.js";
import type { IncentiveStore } from "../store-interface.js";
import { StoreBase, type StoreCtor } from "./base.js";

export type LedgerApi = Pick<
  IncentiveStore,
  | "reverseLedgerEntry"
  | "adjustLedgerEntry"
  | "listAdjustmentRecords"
  | "listLedger"
  | "verifyLedger"
>;

/**
 * Mixes the ledger domain into the store chain. Methods keep the exact
 * behaviour of the former monolithic Store implementation.
 */
export function withLedger<TBase extends StoreCtor<StoreBase>>(Base: TBase) {
  const Mixin = class LedgerMixin extends Base implements LedgerApi {

  async reverseLedgerEntry(
    id: string,
    input: {
      idempotencyKey: string;
      reason: string;
      approvedBy: string;
    },
  ): Promise<AmountLedgerEntry> {
    const original = (await this.listLedger()).find((entry) => entry.id === id);
    if (!original) notFound("LedgerEntry", id);
    if (original.status !== "LOCKED") {
      throw new ConflictError(
        `LEDGER_NOT_LOCKED: ${id} is ${original.status}`,
      );
    }
    const reversal = this.ledger.reverse(original.id, {
      tenantId: original.tenantId,
      personId: original.personId,
      cycleId: original.cycleId,
      calculationRunId: original.calculationRunId,
      calculationLineId: original.calculationLineId,
      currency: original.currency,
      idempotencyKey: input.idempotencyKey,
    });
    return this.ledger.lock(reversal.id);
  }

  async adjustLedgerEntry(
    id: string,
    input: {
      amount: string;
      reasonCode: string;
      explanation: string;
      approvedBy: string;
      idempotencyKey: string;
      entryType?: "ADJUSTMENT" | "REVERSAL" | "RECOVERY";
      /** Post the adjustment into another cycle (cross-cycle clawback). */
      cycleId?: string;
    },
  ): Promise<{ entry: AmountLedgerEntry; record: AdjustmentRecord }> {
    const original = (await this.listLedger()).find((entry) => entry.id === id);
    if (!original) notFound("LedgerEntry", id);
    if (original.status !== "LOCKED") {
      throw new ConflictError(
        `LEDGER_NOT_LOCKED: ${id} is ${original.status}`,
      );
    }
    let amount: bigint;
    try {
      amount = parseDecimal(input.amount);
    } catch {
      throw new ConflictError(`invalid adjustment amount ${input.amount}`);
    }
    if (amount === 0n) {
      throw new ConflictError("adjustment amount must not be zero");
    }
    const existing = (await this.listLedger()).find(
      (entry) => entry.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      const record = [...this.adjustmentRecords.values()].find(
        (candidate) => candidate.adjustmentLedgerId === existing.id,
      );
      if (record) return { entry: existing, record };
    }
    const cycleId = input.cycleId ?? original.cycleId;
    // A cross-cycle installment must not reuse the source calculation line:
    // the ledger forbids two entries for one line + type.
    const calculationLineId =
      cycleId === original.cycleId ? original.calculationLineId : undefined;
    const adjustment = this.ledger.append({
      tenantId: original.tenantId,
      personId: original.personId,
      cycleId,
      calculationRunId: original.calculationRunId,
      calculationLineId,
      entryType: input.entryType ?? "ADJUSTMENT",
      amount: formatDecimal(amount),
      currency: original.currency,
      sourceEntryId: id,
      idempotencyKey: input.idempotencyKey,
    });
    const entry = this.ledger.lock(adjustment.id);
    const timestamp = now();
    const record: AdjustmentRecord = {
      id: randomUUID(),
      tenantId: original.tenantId,
      originalLedgerId: id,
      adjustmentLedgerId: entry.id,
      reasonCode: input.reasonCode,
      explanation: input.explanation,
      approvedBy: input.approvedBy,
      approvedAt: timestamp,
      createdAt: timestamp,
    };
    this.adjustmentRecords.set(record.id, record);
    return { entry, record };
  }

  async listAdjustmentRecords(): Promise<AdjustmentRecord[]> {
    return [...this.adjustmentRecords.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async listLedger(tenantId = this.tenantId): Promise<AmountLedgerEntry[]> {
    return this.ledger.list(tenantId);
  }

  async verifyLedger(tenantId = this.tenantId): Promise<boolean> {
    return this.ledger.verifyChain(tenantId);
  }
  };
  return Mixin as unknown as TBase & StoreCtor<LedgerApi>;
}
