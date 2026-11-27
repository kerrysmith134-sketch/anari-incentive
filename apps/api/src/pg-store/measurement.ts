/**
 * Evaluation：指标度量快照
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * 快照创建依赖 `getEvaluationCycle`（来自 evaluation 层，故本层在其之后）。
 *
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { type QueryResultRow } from "pg";
import {
  type EvaluationDecision,
  type MetricMeasurementSnapshot,
  type MetricMeasurementSnapshotFilter,
  type CreateMetricMeasurementSnapshotInput,
} from "@anari/domain";
import { sha256 } from "@anari/policy-dsl";
import { ConflictError, NotFoundError } from "../store.js";
import type {
  ConsumedMetricMeasurementSnapshot,
  MetricSnapshotConsumptionPort,
} from "../store-ports.js";
import { PgStoreEvaluation } from "./evaluation.js";
import { notFound } from "../pg-store-support.js";

export class PgStoreMeasurement
  extends PgStoreEvaluation
  implements MetricSnapshotConsumptionPort
{
  /** 服务端计算冻结哈希（与 Memory 实现同序同算法）。 */
  private computeSnapshotHash(
    measurements: MetricMeasurementSnapshot["measurements"],
  ): string {
    const ordered = [...measurements].sort((a, b) => {
      const left = `${a.metricId}|${a.observedAt}`;
      const right = `${b.metricId}|${b.observedAt}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    return sha256(ordered);
  }

  async createMetricMeasurementSnapshot(
    input: CreateMetricMeasurementSnapshotInput,
  ): Promise<MetricMeasurementSnapshot> {
    await this.getEvaluationCycle(input.cycleId);
    const { rows } = await this.tx(async (client) =>
      client.query(
        `INSERT INTO metric_measurement_snapshots
          (tenant_id, cycle_id, person_id, rubric_version_id, measurements,
           content_hash, frozen_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          this.tenantId,
          input.cycleId,
          input.personId,
          input.rubricVersionId,
          JSON.stringify(input.measurements),
          this.computeSnapshotHash(input.measurements),
          input.frozenBy,
        ],
      ),
    );
    return this.mapMetricSnapshot(rows[0]);
  }

  async listMetricMeasurementSnapshots(
    filter?: MetricMeasurementSnapshotFilter,
  ): Promise<MetricMeasurementSnapshot[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.cycleId) {
      params.push(filter.cycleId);
      conditions.push(`cycle_id = $${params.length}`);
    }
    if (filter?.personId) {
      params.push(filter.personId);
      conditions.push(`person_id = $${params.length}`);
    }
    if (filter?.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.tx(async (client) =>
      client.query(
        `SELECT * FROM metric_measurement_snapshots ${where}
          ORDER BY created_at DESC`,
        params,
      ),
    );
    return rows.map((row: QueryResultRow) => this.mapMetricSnapshot(row));
  }

  async getMetricMeasurementSnapshot(
    id: string,
  ): Promise<MetricMeasurementSnapshot> {
    const { rows } = await this.tx(async (client) =>
      client.query(
        "SELECT * FROM metric_measurement_snapshots WHERE tenant_id = $1 AND id = $2",
        [this.tenantId, id],
      ),
    );
    if (!rows[0]) notFound("MetricMeasurementSnapshot", id);
    return this.mapMetricSnapshot(rows[0]);
  }

  async verifyMetricMeasurementSnapshot(id: string) {
    const snapshot = await this.getMetricMeasurementSnapshot(id);
    const actualHash = this.computeSnapshotHash(snapshot.measurements);
    return {
      snapshotId: snapshot.id,
      valid: actualHash === snapshot.contentHash,
      expectedHash: snapshot.contentHash,
      actualHash,
    };
  }

  async linkMetricMeasurementSnapshotToDecision(
    id: string,
    input: { evaluationDecisionId: string; linkedBy: string },
  ): Promise<MetricMeasurementSnapshot> {
    return this.tx(async (client) => {
      const { rows: snapRows } = await client.query(
        `SELECT * FROM metric_measurement_snapshots
          WHERE tenant_id = $1 AND id = $2
          FOR UPDATE`,
        [this.tenantId, id],
      );
      if (!snapRows[0]) notFound("MetricMeasurementSnapshot", id);
      const snapshot = this.mapMetricSnapshot(snapRows[0]);
      if (snapshot.status !== "FROZEN") {
        throw new ConflictError(
          `SNAPSHOT_NOT_FROZEN: snapshot is ${snapshot.status}`,
        );
      }
      const { rows: decisionRows } = await client.query(
        "SELECT id, person_id, cycle_id, rubric_version_id FROM evaluation_decisions WHERE tenant_id = $1 AND id = $2",
        [this.tenantId, input.evaluationDecisionId],
      );
      if (!decisionRows[0]) {
        throw new NotFoundError(
          `EvaluationDecision ${input.evaluationDecisionId} not found`,
        );
      }
      if (
        decisionRows[0].person_id !== snapshot.personId ||
        decisionRows[0].cycle_id !== snapshot.cycleId ||
        decisionRows[0].rubric_version_id !== snapshot.rubricVersionId
      ) {
        throw new ConflictError(
          "SNAPSHOT_DECISION_MISMATCH: decision belongs to a different person, cycle or rubric version",
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE metric_measurement_snapshots
            SET status = 'CONSUMED', evaluation_decision_id = $3, linked_by_person_id = $4
          WHERE tenant_id = $1 AND id = $2
          RETURNING *`,
        [this.tenantId, id, input.evaluationDecisionId, input.linkedBy],
      );
      return this.mapMetricSnapshot(updated[0]);
    });
  }

  /**
   * 评分消费快照：事务内锁行 → 校验仍为 FROZEN → 写入消费列。
   * 同一快照只能被消费一次；已 CONSUMED（评价决定或评分记录）一律 409。
   */
  async consumeMetricMeasurementSnapshotForScore(input: {
    snapshotId: string;
    consumedByRecordId: string;
    consumedByPersonId: string;
  }): Promise<ConsumedMetricMeasurementSnapshot> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM metric_measurement_snapshots
          WHERE tenant_id = $1 AND id = $2
          FOR UPDATE`,
        [this.tenantId, input.snapshotId],
      );
      if (!rows[0]) notFound("MetricMeasurementSnapshot", input.snapshotId);
      const snapshot = this.mapMetricSnapshot(rows[0]);
      if (snapshot.status === "CONSUMED") {
        throw new ConflictError(
          `SNAPSHOT_ALREADY_CONSUMED: snapshot ${input.snapshotId} 已被${
            snapshot.consumedByRecordId
              ? `评分记录 ${snapshot.consumedByRecordId}`
              : "正式评价决定"
          }消费，不能再次评分`,
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE metric_measurement_snapshots
            SET status = 'CONSUMED',
                consumed_by_record_id = $3,
                consumed_by_person_id = $4,
                consumed_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING *`,
        [
          this.tenantId,
          input.snapshotId,
          input.consumedByRecordId,
          input.consumedByPersonId,
        ],
      );
      return this.mapMetricSnapshot(updated[0]);
    });
  }

  /** 评分记录落库失败时的补偿：只回滚同一记录消费、且未绑定评价决定的快照。 */
  async releaseMetricMeasurementSnapshotConsumption(input: {
    snapshotId: string;
    consumedByRecordId: string;
  }): Promise<ConsumedMetricMeasurementSnapshot> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM metric_measurement_snapshots
          WHERE tenant_id = $1 AND id = $2
          FOR UPDATE`,
        [this.tenantId, input.snapshotId],
      );
      if (!rows[0]) notFound("MetricMeasurementSnapshot", input.snapshotId);
      const snapshot = this.mapMetricSnapshot(rows[0]);
      if (
        snapshot.status !== "CONSUMED" ||
        snapshot.consumedByRecordId !== input.consumedByRecordId ||
        snapshot.evaluationDecisionId !== undefined
      ) {
        throw new ConflictError(
          `SNAPSHOT_CONSUMPTION_MISMATCH: snapshot ${input.snapshotId} 当前不是由记录 ${input.consumedByRecordId} 消费的评分快照`,
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE metric_measurement_snapshots
            SET status = 'FROZEN',
                consumed_by_record_id = NULL,
                consumed_by_person_id = NULL,
                consumed_at = NULL
          WHERE tenant_id = $1 AND id = $2
          RETURNING *`,
        [this.tenantId, input.snapshotId],
      );
      return this.mapMetricSnapshot(updated[0]);
    });
  }

  private mapMetricSnapshot(
    row: QueryResultRow,
  ): ConsumedMetricMeasurementSnapshot {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      personId: row.person_id,
      rubricVersionId: row.rubric_version_id,
      measurements: row.measurements ?? [],
      contentHash: row.content_hash,
      frozenAt: new Date(row.frozen_at).toISOString(),
      frozenBy: row.frozen_by,
      status: row.status,
      evaluationDecisionId: row.evaluation_decision_id ?? undefined,
      linkedByPersonId: row.linked_by_person_id ?? undefined,
      legacyLinkedActorUnknown: row.legacy_linked_actor_unknown === true,
      consumedByRecordId: row.consumed_by_record_id ?? undefined,
      consumedByPersonId: row.consumed_by_person_id ?? undefined,
      consumedAt: row.consumed_at
        ? new Date(row.consumed_at).toISOString()
        : undefined,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}
