/**
 * Settlement：结算批次、校验与命令
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { randomUUID } from "node:crypto";
import { type PoolClient, type QueryResultRow } from "pg";
import {
  assertTransition,
  settlementBatchTransitions,
  type SettlementBatch,
  type SettlementCommandInput,
  type SettlementCommandResult,
  type SettlementLine,
} from "@anari/domain";
import { parseDecimal, sha256 } from "@anari/policy-dsl";
import { ConflictError, settlementCsv } from "../store.js";
import { PgStoreCalculation } from "./calculation.js";
import { iso, notFound, asNumber, normalizeAmount, trimAmount } from "../pg-store-support.js";

export class PgStoreSettlement extends PgStoreCalculation {
  async createSettlementBatch(input: {
    cycleId: string;
    kind?: "STANDARD" | "RECOVERY";
    currency?: string;
    batchNo?: string;
  }): Promise<SettlementBatch> {
    return this.tx(async (client) => {
      const { rows: entries } = await client.query(
        `SELECT al.*
           FROM amount_ledger al
          WHERE al.tenant_id = $1
            AND al.cycle_id = $2
            AND al.status = 'LOCKED'
            AND NOT EXISTS (
              SELECT 1 FROM ledger_exclusions ex
               WHERE ex.tenant_id = $1 AND ex.ledger_id = al.id
            )
            AND ($3::text IS DISTINCT FROM 'RECOVERY' OR al.amount < 0)
            -- A recovery must never ride a standard batch: that would skip
            -- the per-person confirmation gate RECOVERY batches enforce.
            AND ($3::text = 'RECOVERY' OR al.entry_type <> 'RECOVERY')
            AND NOT EXISTS (
              SELECT 1
                FROM settlement_lines sl
               WHERE sl.tenant_id = $1
                 AND sl.ledger_id = al.id
                 AND sl.active
            )
          ORDER BY al.ledger_seq
          FOR UPDATE OF al`,
        [this.tenantId, input.cycleId, input.kind ?? "STANDARD"],
      );
      if (entries.length === 0) {
        throw new ConflictError(
          "NO_SETTLEMENT_ELIGIBLE_LEDGER: no unbatched locked ledger entries for this cycle",
        );
      }
      const currencies = new Set(
        entries.map((entry) => String(entry.currency).trim()),
      );
      if (currencies.size > 1) {
        throw new ConflictError(
          `MIXED_CURRENCIES: ${[...currencies].join(", ")}`,
        );
      }
      const ledgerCurrency = [...currencies][0]!;
      const currency = (input.currency ?? ledgerCurrency).toUpperCase();
      if (currency !== ledgerCurrency) {
        throw new ConflictError(
          `CURRENCY_MISMATCH: ledger is ${ledgerCurrency}, batch is ${currency}`,
        );
      }

      const id = randomUUID();
      const batchNo = input.batchNo ?? `SB-${Date.now()}-${id.slice(0, 8)}`;
      const kind = input.kind ?? "STANDARD";
      const netTotal = entries.reduce(
        (total, entry) => total + parseDecimal(String(entry.amount)),
        0n,
      );
      if (netTotal < 0n && kind !== "RECOVERY") {
        throw new ConflictError("NEGATIVE_SETTLEMENT_REQUIRES_RECOVERY");
      }
      try {
        await client.query(
          `INSERT INTO settlement_batches
            (id, tenant_id, cycle_id, batch_no, status, kind, currency)
           VALUES ($1,$2,$3,$4,'DRAFT',$5,$6)`,
          [id, this.tenantId, input.cycleId, batchNo, kind, currency],
        );
        for (const entry of entries) {
          await client.query(
            `INSERT INTO settlement_lines
              (id, tenant_id, batch_id, ledger_id, person_id, amount, currency)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              randomUUID(),
              this.tenantId,
              id,
              entry.id,
              entry.person_id,
              entry.amount,
              String(entry.currency).trim(),
            ],
          );
        }
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            `Settlement batch conflict: ${batchNo}`,
          );
        }
        throw error;
      }
      await this.appendAudit(client, {
        action: "SETTLEMENT_CREATED",
        objectType: "SETTLEMENT_BATCH",
        objectId: id,
        actorType: "SYSTEM",
        afterHash: sha256({ batchNo, cycleId: input.cycleId, entries: entries.length }),
        reason: batchNo,
      });
      return this.loadSettlementBatch(client, id);
    });
  }

  async getSettlementBatch(id: string): Promise<SettlementBatch> {
    return this.tx((client) => this.loadSettlementBatch(client, id));
  }

  async listSettlementBatches(): Promise<SettlementBatch[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM settlement_batches
          WHERE tenant_id = $1
          ORDER BY created_at DESC`,
        [this.tenantId],
      );
      const batches: SettlementBatch[] = [];
      for (const row of rows) {
        batches.push({
          ...this.mapSettlementBatch(row),
          lines: await this.loadSettlementLines(client, row.id),
        });
      }
      return batches;
    });
  }

  async listSettlementLines(batchId: string): Promise<SettlementLine[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM settlement_batches WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, batchId],
      );
      if (!rows[0]) notFound("SettlementBatch", batchId);
      return this.loadSettlementLines(client, batchId);
    });
  }

  async commandSettlementBatch(
    id: string,
    input: SettlementCommandInput,
  ): Promise<SettlementCommandResult> {
    return this.tx(async (client) => {
      // Serialise commands on the batch row so two concurrent transitions
      // cannot both validate against the same stale status.
      const batch = await this.loadSettlementBatch(client, id, true);
      const transition = (to: SettlementBatch["status"]) =>
        assertTransition(
          settlementBatchTransitions,
          "SettlementBatch",
          batch.status,
          to,
        );

      switch (input.command) {
        case "RECONCILE":
          transition("RECONCILING");
          await this.validateSettlementBatch(client, batch);
          await this.setSettlementStatus(client, id, "RECONCILING");
          break;
        case "SUBMIT": {
          transition("PENDING_APPROVAL");
          const total = parseDecimal(batch.totalAmount);
          if (total === 0n) {
            throw new ConflictError("EMPTY_SETTLEMENT");
          }
          if (total < 0n && batch.kind !== "RECOVERY") {
            throw new ConflictError("NEGATIVE_SETTLEMENT_REQUIRES_RECOVERY");
          }
          await this.setSettlementStatus(client, id, "PENDING_APPROVAL");
          break;
        }
        case "APPROVE":
          transition("APPROVED");
          if (!input.actorPersonId) {
            throw new ConflictError(
              "APPROVER_REQUIRED: settlement approval requires a person",
            );
          }
          await client.query(
            `UPDATE settlement_batches
                SET status='APPROVED', approved_by=$1, approved_at=now(), updated_at=now()
              WHERE tenant_id=$2 AND id=$3`,
            [input.actorPersonId, this.tenantId, id],
          );
          break;
        case "LOCK": {
          transition("LOCKED");
          if (batch.kind === "RECOVERY") {
            const affected = [
              ...new Set(
                (batch.lines ?? [])
                  .filter(
                    (line) => line.active && parseDecimal(line.amount) < 0n,
                  )
                  .map((line) => line.personId),
              ),
            ];
            const blockers: string[] = [];
            for (const personId of affected) {
              const { rows: confirmations } = await client.query(
                `SELECT decision FROM employee_confirmations
                  WHERE tenant_id=$1 AND person_id=$2
                    AND target_type='SETTLEMENT' AND target_id=$3`,
                [this.tenantId, personId, id],
              );
              const decision = confirmations[0]?.decision;
              if (!decision) {
                blockers.push(`RECOVERY_CONFIRMATION_MISSING:${personId}`);
              } else if (decision === "OBJECTED") {
                blockers.push(`RECOVERY_OBJECTION:${personId}`);
              } else if (decision !== "CONFIRMED") {
                blockers.push(`RECOVERY_CONFIRMATION_MISSING:${personId}`);
              }
            }
            if (blockers.length > 0) {
              throw new ConflictError(blockers.join(","));
            }
          }
          await client.query(
            `UPDATE settlement_batches
                SET status='LOCKED', locked_at=now(), updated_at=now()
              WHERE tenant_id=$1 AND id=$2`,
            [this.tenantId, id],
          );
          break;
        }
        case "EXPORT":
          transition("EXPORTED");
          await client.query(
            `UPDATE settlement_batches
                SET status='EXPORTED', exported_at=now(), updated_at=now()
              WHERE tenant_id=$1 AND id=$2`,
            [this.tenantId, id],
          );
          break;
        case "ACKNOWLEDGE":
          transition("ACKNOWLEDGED");
          await client.query(
            `UPDATE settlement_batches
                SET status='ACKNOWLEDGED', acknowledged_at=now(),
                    external_reference=$1, updated_at=now()
              WHERE tenant_id=$2 AND id=$3`,
            [input.externalReference ?? null, this.tenantId, id],
          );
          break;
        case "REQUIRE_ADJUSTMENT":
          transition("ADJUSTMENT_REQUIRED");
          await this.setSettlementStatus(client, id, "ADJUSTMENT_REQUIRED");
          break;
        case "CANCEL":
          transition("CANCELLED");
          await client.query(
            `UPDATE settlement_lines
                SET active=false, status='CANCELLED'
              WHERE tenant_id=$1 AND batch_id=$2`,
            [this.tenantId, id],
          );
          await this.setSettlementStatus(client, id, "CANCELLED");
          break;
      }

      const updated = await this.loadSettlementBatch(client, id);
      await this.appendAudit(client, {
        action: `SETTLEMENT_${input.command}`,
        objectType: "SETTLEMENT_BATCH",
        objectId: id,
        actorType: input.actorPersonId ? "USER" : "SYSTEM",
        actorId: input.actorPersonId,
        afterHash: sha256({
          status: updated.status,
          totalAmount: updated.totalAmount,
          lineCount: updated.lineCount,
        }),
        reason: input.reason ?? input.externalReference ?? input.command,
      });
      return {
        batch: updated,
        csv:
          input.command === "EXPORT"
            ? settlementCsv(updated, updated.lines ?? [])
            : undefined,
      };
    });
  }

  private async setSettlementStatus(
    client: PoolClient,
    id: string,
    status: SettlementBatch["status"],
  ): Promise<void> {
    await client.query(
      `UPDATE settlement_batches
          SET status=$1, updated_at=now()
        WHERE tenant_id=$2 AND id=$3`,
      [status, this.tenantId, id],
    );
  }

  private async validateSettlementBatch(
    client: PoolClient,
    batch: SettlementBatch,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT sl.id,
              sl.person_id,
              sl.amount,
              sl.currency,
              al.id AS ledger_id,
              al.status AS ledger_status,
              al.person_id AS ledger_person_id,
              al.amount AS ledger_amount,
              al.currency AS ledger_currency
         FROM settlement_lines sl
         LEFT JOIN amount_ledger al
           ON al.tenant_id = sl.tenant_id AND al.id = sl.ledger_id
        WHERE sl.tenant_id = $1 AND sl.batch_id = $2 AND sl.active`,
      [this.tenantId, batch.id],
    );
    for (const row of rows) {
      if (!row.ledger_id) {
        throw new ConflictError(`LEDGER_NOT_FOUND: ${row.id}`);
      }
      if (row.ledger_status !== "LOCKED") {
        throw new ConflictError(
          `LEDGER_NOT_LOCKED: ${row.ledger_id} is ${row.ledger_status}`,
        );
      }
      if (
        row.person_id !== row.ledger_person_id ||
        String(row.currency).trim() !== String(row.ledger_currency).trim() ||
        normalizeAmount(String(row.amount)) !==
          normalizeAmount(String(row.ledger_amount))
      ) {
        throw new ConflictError(
          `LEDGER_MISMATCH: settlement line ${row.id} does not match ledger ${row.ledger_id}`,
        );
      }
    }
    const { rows: totals } = await client.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(amount), 0)::text AS total
         FROM settlement_lines
        WHERE tenant_id = $1 AND batch_id = $2 AND active`,
      [this.tenantId, batch.id],
    );
    const count = asNumber(totals[0]?.count);
    const total = trimAmount(
      normalizeAmount(String(totals[0]?.total ?? "0")),
    );
    if (count !== batch.lineCount || total !== batch.totalAmount) {
      throw new ConflictError(
        `SETTLEMENT_TOTAL_MISMATCH: batch ${batch.totalAmount}/${batch.lineCount}, lines ${total}/${count}`,
      );
    }
  }

  private async loadSettlementBatch(
    client: PoolClient,
    id: string,
    forUpdate = false,
  ): Promise<SettlementBatch> {
    const { rows } = await client.query(
      `SELECT * FROM settlement_batches WHERE tenant_id=$1 AND id=$2${
        forUpdate ? " FOR UPDATE" : ""
      }`,
      [this.tenantId, id],
    );
    if (!rows[0]) notFound("SettlementBatch", id);
    return {
      ...this.mapSettlementBatch(rows[0]),
      lines: await this.loadSettlementLines(client, id),
    };
  }

  private async loadSettlementLines(
    client: PoolClient,
    batchId: string,
  ): Promise<SettlementLine[]> {
    const { rows } = await client.query(
      `SELECT sl.*, p.employee_code AS person_code,
              p.display_name AS person_name
         FROM settlement_lines sl
         LEFT JOIN people p
           ON p.tenant_id = sl.tenant_id AND p.id = sl.person_id
        WHERE sl.tenant_id=$1 AND sl.batch_id=$2
        ORDER BY sl.created_at, sl.id`,
      [this.tenantId, batchId],
    );
    return rows.map((row) => this.mapSettlementLine(row));
  }

  private mapSettlementBatch(row: QueryResultRow): SettlementBatch {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      batchNo: row.batch_no,
      status: row.status,
      kind: row.kind,
      currency: String(row.currency).trim(),
      totalAmount: trimAmount(normalizeAmount(String(row.total_amount))),
      lineCount: asNumber(row.line_count),
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      lockedAt: iso(row.locked_at),
      exportedAt: iso(row.exported_at),
      acknowledgedAt: iso(row.acknowledged_at),
      externalReference: row.external_reference ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapSettlementLine(row: QueryResultRow): SettlementLine {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      batchId: row.batch_id,
      ledgerId: row.ledger_id,
      personId: row.person_id,
      personCode: row.person_code ?? undefined,
      personName: row.person_name ?? undefined,
      amount: trimAmount(normalizeAmount(String(row.amount))),
      currency: String(row.currency).trim(),
      status: row.status,
      active: Boolean(row.active),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
}
