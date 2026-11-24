import { randomUUID } from "node:crypto";
import {
  assertTransition,
  settlementBatchTransitions,
  type SettlementBatch,
  type SettlementCommandInput,
  type SettlementCommandResult,
  type SettlementLine,
} from "@anari/domain";
import {
  formatDecimal,
  parseDecimal,
  sum,
} from "@anari/policy-dsl";
import {
  ConflictError,
  now,
  notFound,
  settlementCsv,
} from "../store-support.js";
import type { IncentiveStore } from "../store-interface.js";
import type { LedgerApi } from "./ledger.js";
import { StoreBase, type StoreCtor } from "./base.js";

export type SettlementApi = Pick<
  IncentiveStore,
  | "createSettlementBatch"
  | "getSettlementBatch"
  | "listSettlementBatches"
  | "listSettlementLines"
  | "commandSettlementBatch"
> & {
  excludeFromSettlement(ledgerIds: string[]): Promise<number>;
};

/**
 * Mixes the settlement domain into the store chain. Methods keep the exact
 * behaviour of the former monolithic Store implementation.
 */
export function withSettlement<TBase extends StoreCtor<StoreBase & LedgerApi>>(Base: TBase) {
  const Mixin = class SettlementMixin extends Base implements SettlementApi {

  async excludeFromSettlement(ledgerIds: string[]): Promise<number> {
    let added = 0;
    for (const id of ledgerIds) {
      if (this.settlementExclusions.has(id)) continue;
      this.settlementExclusions.add(id);
      added += 1;
    }
    return added;
  }

  async createSettlementBatch(input: {
    cycleId: string;
    kind?: "STANDARD" | "RECOVERY";
    currency?: string;
    batchNo?: string;
  }): Promise<SettlementBatch> {
    const ledger = await this.listLedger();
    const alreadyBatched = new Set(
      [...this.settlementLines.values()]
        .flat()
        .filter((line) => line.active)
        .map((line) => line.ledgerId),
    );
    const eligible = ledger.filter(
      (entry) =>
        entry.cycleId === input.cycleId &&
        entry.status === "LOCKED" &&
        !alreadyBatched.has(entry.id) &&
        // A waived clawback leaves a -X/+X pair behind; the ledger is
        // append-only, so the pair is excluded rather than deleted.
        !this.settlementExclusions.has(entry.id) &&
        // Recovery batches only carry clawback (negative) adjustments, and a
        // clawback must never ride a standard batch: that would skip the
        // per-person confirmation gate RECOVERY batches enforce.
        (input.kind === "RECOVERY"
          ? parseDecimal(entry.amount) < 0n
          : entry.entryType !== "RECOVERY"),
    );
    if (eligible.length === 0) {
      throw new ConflictError(
        "NO_SETTLEMENT_ELIGIBLE_LEDGER: no unbatched locked ledger entries for this cycle",
      );
    }
    const currencies = new Set(eligible.map((entry) => entry.currency));
    if (currencies.size > 1) {
      throw new ConflictError(
        `MIXED_CURRENCIES: ${[...currencies].join(", ")}`,
      );
    }
    const currency = input.currency ?? [...currencies][0]!;
    if ([...currencies][0] !== currency) {
      throw new ConflictError(
        `CURRENCY_MISMATCH: ledger is ${[...currencies][0]}, batch is ${currency}`,
      );
    }

    const timestamp = now();
    const id = randomUUID();
    const batchNo = input.batchNo ?? `SB-${Date.now()}-${id.slice(0, 8)}`;
    if ([...this.settlementBatches.values()].some((b) => b.batchNo === batchNo)) {
      throw new ConflictError(`Settlement batch ${batchNo} already exists`);
    }
    const lines: SettlementLine[] = eligible.map((entry) => ({
      id: randomUUID(),
      tenantId: this.tenantId,
      batchId: id,
      ledgerId: entry.id,
      personId: entry.personId,
      amount: formatDecimal(parseDecimal(entry.amount)),
      currency: entry.currency,
      status: "PENDING",
      active: true,
      createdAt: timestamp,
    }));
    const kind = input.kind ?? "STANDARD";
    const total = sum(lines.map((line) => parseDecimal(line.amount)));
    if (total < 0n && kind !== "RECOVERY") {
      throw new ConflictError(
        "NEGATIVE_SETTLEMENT_REQUIRES_RECOVERY",
      );
    }
    const batch: SettlementBatch = {
      id,
      tenantId: this.tenantId,
      cycleId: input.cycleId,
      batchNo,
      status: "DRAFT",
      kind,
      currency,
      totalAmount: formatDecimal(total),
      lineCount: lines.length,
      createdAt: timestamp,
      updatedAt: timestamp,
      lines,
    };
    this.settlementBatches.set(id, batch);
    this.settlementLines.set(id, lines);
    return { ...batch, lines: lines.map((line) => ({ ...line })) };
  }

  async getSettlementBatch(id: string): Promise<SettlementBatch> {
    const batch = this.settlementBatches.get(id);
    if (!batch) notFound("SettlementBatch", id);
    const lines = this.settlementLines.get(id) ?? [];
    return { ...batch, lines: lines.map((line) => ({ ...line })) };
  }

  async listSettlementBatches(): Promise<SettlementBatch[]> {
    return [...this.settlementBatches.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((batch) => ({
        ...batch,
        lines: (this.settlementLines.get(batch.id) ?? []).map((line) => ({
          ...line,
        })),
      }));
  }

  async listSettlementLines(batchId: string): Promise<SettlementLine[]> {
    if (!this.settlementBatches.has(batchId)) {
      notFound("SettlementBatch", batchId);
    }
    return (this.settlementLines.get(batchId) ?? []).map((line) => ({
      ...line,
    }));
  }

  private async withCommandLock<T>(
    key: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const previous = this.commandLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => gate);
    this.commandLocks.set(key, chained);
    await previous;
    try {
      return await run();
    } finally {
      release();
      if (this.commandLocks.get(key) === chained) {
        this.commandLocks.delete(key);
      }
    }
  }

  async commandSettlementBatch(
    id: string,
    input: SettlementCommandInput,
  ): Promise<SettlementCommandResult> {
    return this.withCommandLock(`settlement:${this.tenantId}:${id}`, () =>
      this.commandSettlementBatchUnlocked(id, input),
    );
  }

  private async commandSettlementBatchUnlocked(
    id: string,
    input: SettlementCommandInput,
  ): Promise<SettlementCommandResult> {
    const batch = await this.getSettlementBatch(id);
    const lines = this.settlementLines.get(id) ?? [];
    const transition = (to: SettlementBatch["status"]) =>
      assertTransition(
        settlementBatchTransitions,
        "SettlementBatch",
        batch.status,
        to,
      );

    switch (input.command) {
      case "RECONCILE": {
        transition("RECONCILING");
        await this.validateSettlementLines(batch, lines);
        batch.status = "RECONCILING";
        break;
      }
      case "SUBMIT": {
        transition("PENDING_APPROVAL");
        const total = parseDecimal(batch.totalAmount);
        if (total === 0n) {
          throw new ConflictError("EMPTY_SETTLEMENT");
        }
        if (total < 0n && batch.kind !== "RECOVERY") {
          throw new ConflictError("NEGATIVE_SETTLEMENT_REQUIRES_RECOVERY");
        }
        batch.status = "PENDING_APPROVAL";
        break;
      }
      case "APPROVE": {
        transition("APPROVED");
        if (!input.actorPersonId) {
          throw new ConflictError(
            "APPROVER_REQUIRED: settlement approval requires a person",
          );
        }
        batch.status = "APPROVED";
        batch.approvedBy = input.actorPersonId;
        batch.approvedAt = now();
        break;
      }
      case "LOCK": {
        transition("LOCKED");
        if (batch.kind === "RECOVERY") {
          const affected = [
            ...new Set(
              lines
                .filter(
                  (line) => line.active && parseDecimal(line.amount) < 0n,
                )
                .map((line) => line.personId),
            ),
          ];
          const blockers: string[] = [];
          for (const personId of affected) {
            const confirmation = this.confirmations.get(
              `${personId}:SETTLEMENT:${batch.id}`,
            );
            if (!confirmation) {
              blockers.push(`RECOVERY_CONFIRMATION_MISSING:${personId}`);
            } else if (confirmation.decision === "OBJECTED") {
              blockers.push(`RECOVERY_OBJECTION:${personId}`);
            } else if (confirmation.decision !== "CONFIRMED") {
              blockers.push(`RECOVERY_CONFIRMATION_MISSING:${personId}`);
            }
          }
          if (blockers.length > 0) {
            throw new ConflictError(blockers.join(","));
          }
        }
        batch.status = "LOCKED";
        batch.lockedAt = now();
        break;
      }
      case "EXPORT": {
        transition("EXPORTED");
        batch.status = "EXPORTED";
        batch.exportedAt = now();
        break;
      }
      case "ACKNOWLEDGE": {
        transition("ACKNOWLEDGED");
        batch.status = "ACKNOWLEDGED";
        batch.acknowledgedAt = now();
        batch.externalReference = input.externalReference;
        break;
      }
      case "REQUIRE_ADJUSTMENT": {
        transition("ADJUSTMENT_REQUIRED");
        batch.status = "ADJUSTMENT_REQUIRED";
        break;
      }
      case "CANCEL": {
        transition("CANCELLED");
        batch.status = "CANCELLED";
        for (const line of lines) {
          line.active = false;
          line.status = "CANCELLED";
        }
        batch.totalAmount = "0";
        batch.lineCount = 0;
        break;
      }
    }
    batch.updatedAt = now();
    this.settlementBatches.set(id, batch);
    const csv =
      input.command === "EXPORT" ? settlementCsv(batch, lines) : undefined;
    return {
      batch: { ...batch, lines: lines.map((line) => ({ ...line })) },
      csv,
    };
  }

  private async validateSettlementLines(
    batch: SettlementBatch,
    lines: SettlementLine[],
  ): Promise<void> {
    const ledger = new Map(
      (await this.listLedger()).map((entry) => [entry.id, entry]),
    );
    const seen = new Set<string>();
    for (const line of lines.filter((candidate) => candidate.active)) {
      if (seen.has(line.ledgerId)) {
        throw new ConflictError(
          `DUPLICATE_LEDGER_LINE: ${line.ledgerId}`,
        );
      }
      seen.add(line.ledgerId);
      const entry = ledger.get(line.ledgerId);
      if (!entry) {
        throw new ConflictError(`LEDGER_NOT_FOUND: ${line.ledgerId}`);
      }
      if (entry.status !== "LOCKED") {
        throw new ConflictError(
          `LEDGER_NOT_LOCKED: ${line.ledgerId} is ${entry.status}`,
        );
      }
      if (
        entry.personId !== line.personId ||
        entry.currency !== line.currency ||
        parseDecimal(entry.amount) !== parseDecimal(line.amount)
      ) {
        throw new ConflictError(
          `LEDGER_MISMATCH: settlement line ${line.id} does not match ledger ${entry.id}`,
        );
      }
    }
    const active = lines.filter((line) => line.active);
    const total = formatDecimal(
      sum(active.map((line) => parseDecimal(line.amount))),
    );
    if (formatDecimal(parseDecimal(batch.totalAmount)) !== total) {
      throw new ConflictError(
        `SETTLEMENT_TOTAL_MISMATCH: batch ${batch.totalAmount}, lines ${total}`,
      );
    }
    if (batch.lineCount !== active.length) {
      throw new ConflictError(
        `SETTLEMENT_LINE_COUNT_MISMATCH: batch ${batch.lineCount}, lines ${active.length}`,
      );
    }
  }
  };
  return Mixin as unknown as TBase & StoreCtor<SettlementApi>;
}
