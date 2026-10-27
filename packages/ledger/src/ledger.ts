import { randomUUID } from "node:crypto";
import type {
  AmountLedgerEntry,
  LedgerEntryType,
  LedgerStatus,
} from "@anari/domain";
import { sha256 } from "@anari/policy-dsl";

export class LedgerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

export interface AppendLedgerInput {
  tenantId: string;
  personId: string;
  cycleId: string;
  calculationRunId: string;
  calculationLineId?: string;
  entryType: LedgerEntryType;
  amount: string;
  currency: string;
  idempotencyKey: string;
  sourceEntryId?: string;
}

/**
 * Append-only in-memory ledger for the first vertical slice.
 *
 * Invariants implemented here (and mirrored in the PostgreSQL migration):
 * - a locked entry cannot be mutated;
 * - the same idempotency key + payload returns the existing entry;
 * - the same idempotency key + a different payload is rejected;
 * - the same calculation line + entry type cannot be posted twice with a
 *   different idempotency key;
 * - corrections are new entries linked to the original;
 * - every entry participates in a per-tenant hash chain.
 */
export class InMemoryLedger {
  private readonly entries: AmountLedgerEntry[] = [];
  private readonly byIdempotencyKey = new Map<string, AmountLedgerEntry>();
  private readonly byCalculationLine = new Map<string, AmountLedgerEntry>();

  append(input: AppendLedgerInput): AmountLedgerEntry {
    const idempotencyKey = `${input.tenantId}:${input.idempotencyKey}`;
    const existing = this.byIdempotencyKey.get(idempotencyKey);
    if (existing) {
      if (this.payloadFingerprint(existing) !== this.payloadFingerprint(input)) {
        throw new LedgerError(
          "IDEMPOTENCY_KEY_REUSED",
          "the same idempotency key was used with a different payload",
        );
      }
      return existing;
    }

    if (input.entryType !== "INCENTIVE" && !input.sourceEntryId) {
      throw new LedgerError(
        "SOURCE_ENTRY_REQUIRED",
        `${input.entryType} entries must reference the source entry`,
      );
    }

    const lineKey = input.calculationLineId
      ? `${input.tenantId}:${input.calculationLineId}:${input.entryType}`
      : undefined;
    if (lineKey && this.byCalculationLine.has(lineKey)) {
      throw new LedgerError(
        "DUPLICATE_CALCULATION_LINE",
        `ledger entry already exists for calculation line ${input.calculationLineId}`,
      );
    }

    const prev = this.lastForTenant(input.tenantId);
    const entry: AmountLedgerEntry = {
      id: randomUUID(),
      tenantId: input.tenantId,
      personId: input.personId,
      cycleId: input.cycleId,
      calculationRunId: input.calculationRunId,
      calculationLineId: input.calculationLineId,
      entryType: input.entryType,
      amount: input.amount,
      currency: input.currency,
      status: "PROVISIONAL",
      sourceEntryId: input.sourceEntryId,
      idempotencyKey: input.idempotencyKey,
      prevHash: prev?.entryHash ?? "GENESIS",
      entryHash: "",
      createdAt: new Date().toISOString(),
    };
    entry.entryHash = this.hashEntry(entry);
    this.entries.push(entry);
    this.byIdempotencyKey.set(idempotencyKey, entry);
    if (lineKey) this.byCalculationLine.set(lineKey, entry);
    return entry;
  }

  lock(entryId: string): AmountLedgerEntry {
    const entry = this.get(entryId);
    if (entry.status === "LOCKED") return entry;
    if (entry.status === "REVERSED") {
      throw new LedgerError("ENTRY_REVERSED", "cannot lock a reversed entry");
    }
    entry.status = "LOCKED";
    entry.lockedAt = new Date().toISOString();
    return entry;
  }

  setStatus(entryId: string, status: LedgerStatus): AmountLedgerEntry {
    const entry = this.get(entryId);
    if (entry.status === "LOCKED") {
      throw new LedgerError(
        "LEDGER_IMMUTABLE",
        "locked ledger entries are immutable; append an adjustment or reversal",
      );
    }
    entry.status = status;
    return entry;
  }

  reverse(
    originalEntryId: string,
    input: Omit<AppendLedgerInput, "entryType" | "amount" | "sourceEntryId"> & {
      reason?: string;
    },
  ): AmountLedgerEntry {
    const original = this.get(originalEntryId);
    return this.append({
      ...input,
      entryType: "REVERSAL",
      amount: negate(original.amount),
      sourceEntryId: original.id,
    });
  }

  list(tenantId?: string): AmountLedgerEntry[] {
    return tenantId
      ? this.entries.filter((entry) => entry.tenantId === tenantId)
      : [...this.entries];
  }

  get(entryId: string): AmountLedgerEntry {
    const entry = this.entries.find((candidate) => candidate.id === entryId);
    if (!entry) throw new LedgerError("NOT_FOUND", `ledger entry ${entryId} not found`);
    return entry;
  }

  verifyChain(tenantId: string): boolean {
    const tenantEntries = this.list(tenantId);
    let prevHash = "GENESIS";
    for (const entry of tenantEntries) {
      if (entry.prevHash !== prevHash) return false;
      if (entry.entryHash !== this.hashEntry(entry)) return false;
      prevHash = entry.entryHash;
    }
    return true;
  }

  balance(personId: string, currency: string): number {
    return this.entries
      .filter(
        (entry) => entry.personId === personId && entry.currency === currency,
      )
      .reduce((acc, entry) => acc + Number(entry.amount), 0);
  }

  private lastForTenant(tenantId: string): AmountLedgerEntry | undefined {
    const tenantEntries = this.entries.filter(
      (entry) => entry.tenantId === tenantId,
    );
    return tenantEntries[tenantEntries.length - 1];
  }

  private payloadFingerprint(
    input: Pick<
      AppendLedgerInput,
      | "tenantId"
      | "personId"
      | "cycleId"
      | "calculationRunId"
      | "calculationLineId"
      | "entryType"
      | "amount"
      | "currency"
      | "sourceEntryId"
    >,
  ): string {
    return [
      input.tenantId,
      input.personId,
      input.cycleId,
      input.calculationRunId,
      input.calculationLineId ?? "",
      input.entryType,
      input.amount,
      input.currency,
      input.sourceEntryId ?? "",
    ].join("|");
  }

  /**
   * The hash covers the immutable economic content, not mutable workflow
   * status. Locking therefore does not invalidate the chain; corrections are
   * new entries.
   */
  private hashEntry(entry: AmountLedgerEntry): string {
    return sha256({
      id: entry.id,
      tenantId: entry.tenantId,
      personId: entry.personId,
      cycleId: entry.cycleId,
      calculationRunId: entry.calculationRunId,
      calculationLineId: entry.calculationLineId,
      entryType: entry.entryType,
      amount: entry.amount,
      currency: entry.currency,
      sourceEntryId: entry.sourceEntryId,
      idempotencyKey: entry.idempotencyKey,
      prevHash: entry.prevHash,
      createdAt: entry.createdAt,
    });
  }
}

function negate(value: string): string {
  return value.startsWith("-") ? value.slice(1) : `-${value}`;
}
