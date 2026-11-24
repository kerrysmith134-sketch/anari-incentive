/**
 * Calculation / Ledger：金额账本、冲销与调整
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * 金额规范化（numeric(20,6)）、哈希链前后顺序与审计调用顺序均未改动。
 *
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { randomUUID } from "node:crypto";
import { type QueryResultRow } from "pg";
import { type AdjustmentRecord, type AmountLedgerEntry } from "@anari/domain";
import { hashLedgerEntry } from "@anari/ledger";
import { parseDecimal } from "@anari/policy-dsl";
import { ConflictError, NotFoundError } from "../store.js";
import { PgStoreAudit } from "./audit.js";
import { iso, notFound, normalizeAmount, negateAmount, trimAmount } from "../pg-store-support.js";

export class PgStoreLedger extends PgStoreAudit {
  async reverseLedgerEntry(
    id: string,
    input: {
      idempotencyKey: string;
      reason: string;
      approvedBy: string;
    },
  ): Promise<AmountLedgerEntry> {
    return this.tx(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        [this.tenantId],
      );
      const { rows } = await client.query(
        `SELECT * FROM amount_ledger
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [this.tenantId, id],
      );
      const original = rows[0];
      if (!original) notFound("LedgerEntry", id);
      if (original.status !== "LOCKED") {
        throw new ConflictError(
          `LEDGER_NOT_LOCKED: ${id} is ${original.status}`,
        );
      }
      const existing = await client.query(
        `SELECT * FROM amount_ledger
          WHERE tenant_id=$1 AND idempotency_key=$2`,
        [this.tenantId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        const replay = existing.rows[0];
        // A reused key that points at a different entry (or is not a reversal
        // of this one) must fail, not masquerade as a successful reversal.
        if (
          replay.entry_type !== "REVERSAL" ||
          replay.source_entry_id !== id
        ) {
          throw new ConflictError(
            "IDEMPOTENCY_KEY_REUSED: the idempotency key belongs to a different ledger entry",
          );
        }
        return this.mapLedger(replay);
      }

      const last = await client.query(
        `SELECT entry_hash FROM amount_ledger
          WHERE tenant_id=$1
          ORDER BY ledger_seq DESC
          LIMIT 1`,
        [this.tenantId],
      );
      const prevHash = last.rows[0]?.entry_hash ?? "GENESIS";
      const reversalId = randomUUID();
      const createdAt = new Date().toISOString();
      const amount = normalizeAmount(
        negateAmount(String(original.amount)),
      );
      const currency = String(original.currency).trim();
      const entryHash = hashLedgerEntry({
        id: reversalId,
        tenantId: this.tenantId,
        personId: original.person_id,
        cycleId: original.cycle_id,
        calculationRunId: original.calculation_run_id,
        calculationLineId: original.calculation_line_id ?? undefined,
        entryType: "REVERSAL",
        amount,
        currency,
        sourceEntryId: id,
        idempotencyKey: input.idempotencyKey,
        prevHash,
        createdAt,
      });
      const inserted = await client.query(
        `INSERT INTO amount_ledger
          (id, tenant_id, person_id, cycle_id, calculation_run_id,
           calculation_line_id, entry_type, amount, currency, status,
           source_entry_id, idempotency_key, entry_hash, prev_hash,
           created_at, locked_at)
         VALUES ($1,$2,$3,$4,$5,$6,'REVERSAL',$7,$8,'LOCKED',$9,$10,$11,$12,$13,$13)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          reversalId,
          this.tenantId,
          original.person_id,
          original.cycle_id,
          original.calculation_run_id,
          original.calculation_line_id,
          amount,
          currency,
          id,
          input.idempotencyKey,
          entryHash,
          prevHash,
          createdAt,
        ],
      );
      if (!inserted.rows[0]) {
        // 同一源分录已被反冲（部分唯一索引挡住重复反冲）。
        throw new ConflictError(
          `LEDGER_ALREADY_REVERSED: ledger entry ${id} has already been reversed`,
        );
      }
      await this.appendAudit(client, {
        action: "LEDGER_REVERSAL",
        objectType: "AMOUNT_LEDGER",
        objectId: reversalId,
        actorType: "USER",
        actorId: input.approvedBy,
        afterHash: entryHash,
        reason: input.reason,
      });
      return this.mapLedger(inserted.rows[0]);
    });
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
      cycleId?: string;
    },
  ): Promise<{ entry: AmountLedgerEntry; record: AdjustmentRecord }> {
    return this.tx(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        [this.tenantId],
      );
      const { rows } = await client.query(
        `SELECT * FROM amount_ledger
          WHERE tenant_id=$1 AND id=$2
          FOR UPDATE`,
        [this.tenantId, id],
      );
      if (!rows[0]) notFound("LedgerEntry", id);
      const original = rows[0];
      if (original.status !== "LOCKED") {
        throw new ConflictError(
          `LEDGER_NOT_LOCKED: ${id} is ${original.status}`,
        );
      }
      const existing = await client.query(
        `SELECT * FROM amount_ledger
          WHERE tenant_id=$1 AND idempotency_key=$2`,
        [this.tenantId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        // 幂等重放必须指向同一源分录，否则是键复用（不是成功）。
        if (existing.rows[0].source_entry_id !== id) {
          throw new ConflictError(
            "IDEMPOTENCY_KEY_REUSED: the idempotency key belongs to another ledger entry",
          );
        }
        const existingRecord = await client.query(
          `SELECT * FROM adjustment_records
            WHERE tenant_id=$1 AND adjustment_ledger_id=$2`,
          [this.tenantId, existing.rows[0].id],
        );
        if (existingRecord.rows[0]) {
          return {
            entry: this.mapLedger(existing.rows[0]),
            record: this.mapAdjustmentRecord(existingRecord.rows[0]),
          };
        }
      }
      const amount = normalizeAmount(input.amount);
      let amountValue: bigint;
      try {
        amountValue = parseDecimal(input.amount);
      } catch {
        throw new ConflictError(
          `invalid adjustment amount ${input.amount}`,
        );
      }
      if (amountValue === 0n) {
        throw new ConflictError("adjustment amount must not be zero");
      }
      const last = await client.query(
        `SELECT entry_hash FROM amount_ledger
          WHERE tenant_id=$1
          ORDER BY ledger_seq DESC
          LIMIT 1`,
        [this.tenantId],
      );
      const prevHash = last.rows[0]?.entry_hash ?? "GENESIS";
      const adjustmentId = randomUUID();
      const recordId = randomUUID();
      const createdAt = new Date().toISOString();
      const currency = String(original.currency).trim();
      const cycleId = input.cycleId ?? original.cycle_id;
      const calculationLineId =
        cycleId === original.cycle_id
          ? original.calculation_line_id
          : null;
      const entryHash = hashLedgerEntry({
        id: adjustmentId,
        tenantId: this.tenantId,
        personId: original.person_id,
        cycleId,
        calculationRunId: original.calculation_run_id,
        calculationLineId: calculationLineId ?? undefined,
        entryType: input.entryType ?? "ADJUSTMENT",
        amount,
        currency,
        sourceEntryId: id,
        idempotencyKey: input.idempotencyKey,
        prevHash,
        createdAt,
      });
      try {
        const inserted = await client.query(
          `INSERT INTO amount_ledger
            (id, tenant_id, person_id, cycle_id, calculation_run_id,
             calculation_line_id, entry_type, amount, currency, status,
             source_entry_id, idempotency_key, entry_hash, prev_hash,
             created_at, locked_at)
           VALUES ($1,$2,$3,$4,$5,$6,$14,$7,$8,'LOCKED',$9,$10,$11,$12,$13,$13)
           RETURNING *`,
          [
            adjustmentId,
            this.tenantId,
            original.person_id,
            cycleId,
            original.calculation_run_id,
            calculationLineId,
            amount,
            currency,
            id,
            input.idempotencyKey,
            entryHash,
            prevHash,
            createdAt,
            input.entryType ?? "ADJUSTMENT",
          ],
        );
        const recordRows = await client.query(
          `INSERT INTO adjustment_records
            (id, tenant_id, original_ledger_id, adjustment_ledger_id,
             reason_code, explanation, approved_by, approved_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING *`,
          [
            recordId,
            this.tenantId,
            id,
            adjustmentId,
            input.reasonCode,
            input.explanation,
            input.approvedBy,
            createdAt,
          ],
        );
        await this.appendAudit(client, {
          action: "LEDGER_ADJUSTMENT",
          objectType: "AMOUNT_LEDGER",
          objectId: adjustmentId,
          actorType: "USER",
          actorId: input.approvedBy,
          afterHash: entryHash,
          reason: input.reasonCode,
        });
        return {
          entry: this.mapLedger(inserted.rows[0]),
          record: this.mapAdjustmentRecord(recordRows.rows[0]),
        };
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23503") {
          throw new NotFoundError(
            "approving person or ledger entry not found",
          );
        }
        if (code === "23505") {
          throw new ConflictError(
            `adjustment already exists for ledger entry ${id}`,
          );
        }
        throw error;
      }
    });
  }

  async listAdjustmentRecords(): Promise<AdjustmentRecord[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM adjustment_records
          WHERE tenant_id=$1
          ORDER BY created_at DESC`,
        [this.tenantId],
      );
      return rows.map((row) => this.mapAdjustmentRecord(row));
    });
  }

  async listLedger(tenantId = this.tenantId): Promise<AmountLedgerEntry[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM amount_ledger WHERE tenant_id=$1 ORDER BY ledger_seq",
        [tenantId],
      );
      return rows.map((row) => this.mapLedger(row));
    });
  }

  async verifyLedger(tenantId = this.tenantId): Promise<boolean> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM amount_ledger WHERE tenant_id=$1 ORDER BY ledger_seq",
        [tenantId],
      );
      let prevHash = "GENESIS";
      for (const row of rows) {
        if (row.prev_hash !== prevHash) return false;
        const entry = this.mapLedger(row);
        const recomputed = hashLedgerEntry({
          id: entry.id,
          tenantId: entry.tenantId,
          personId: entry.personId,
          cycleId: entry.cycleId,
          calculationRunId: entry.calculationRunId,
          calculationLineId: entry.calculationLineId,
          entryType: entry.entryType,
          amount: normalizeAmount(entry.amount),
          currency: entry.currency,
          sourceEntryId: entry.sourceEntryId,
          idempotencyKey: entry.idempotencyKey,
          prevHash: entry.prevHash,
          createdAt: entry.createdAt,
        });
        if (recomputed !== entry.entryHash) return false;
        prevHash = entry.entryHash;
      }
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // Loaders / mappers
  // -------------------------------------------------------------------------

  private mapLedger(row: QueryResultRow): AmountLedgerEntry {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      cycleId: row.cycle_id,
      calculationRunId: row.calculation_run_id,
      calculationLineId: row.calculation_line_id ?? undefined,
      entryType: row.entry_type,
      amount: trimAmount(row.amount),
      currency: row.currency,
      status: row.status,
      sourceEntryId: row.source_entry_id ?? undefined,
      idempotencyKey: row.idempotency_key,
      entryHash: row.entry_hash,
      prevHash: row.prev_hash,
      createdAt: iso(row.created_at)!,
      lockedAt: iso(row.locked_at),
    };
  }

  private mapAdjustmentRecord(row: QueryResultRow): AdjustmentRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      originalLedgerId: row.original_ledger_id,
      adjustmentLedgerId: row.adjustment_ledger_id,
      reasonCode: row.reason_code,
      explanation: row.explanation,
      approvedBy: row.approved_by,
      approvedAt: iso(row.approved_at) ?? new Date().toISOString(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
}
