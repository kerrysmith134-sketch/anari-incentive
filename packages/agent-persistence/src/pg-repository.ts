import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  AgentTaskCasError,
  type AgentAuditEntry,
  type AgentTask,
  type AgentTaskRepository,
} from "@anari/agent-runtime";

function iso(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asJson<T>(value: unknown, fallback: T): T {
  return (value ?? fallback) as T;
}

/**
 * PostgreSQL adapter for the agent runtime. Every operation runs in a
 * transaction with `app.tenant_id` set so RLS applies as defense in depth.
 */
export class PgAgentTaskRepository implements AgentTaskRepository {
  constructor(
    private readonly pool: Pool,
    private readonly tenantId: string,
  ) {}

  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        this.tenantId,
      ]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async load(): Promise<{ tasks: AgentTask[]; audit: AgentAuditEntry[] }> {
    return this.tx(async (client) => {
      const { rows: taskRows } = await client.query(
        `SELECT * FROM agent_tasks
          WHERE tenant_id = $1
          ORDER BY created_at, id`,
        [this.tenantId],
      );
      const { rows: auditRows } = await client.query(
        `SELECT * FROM agent_task_audit
          WHERE tenant_id = $1
          ORDER BY occurred_at, id`,
        [this.tenantId],
      );
      return {
        tasks: taskRows.map((row) => this.mapTask(row)),
        audit: auditRows.map((row) => this.mapAudit(row)),
      };
    });
  }

  async saveTask(task: AgentTask): Promise<void> {
    if (task.tenantId !== this.tenantId) {
      throw new Error(
        `agent task ${task.id} belongs to ${task.tenantId}, repository is ${this.tenantId}`,
      );
    }
    await this.tx(async (client) => {
      const { rowCount } = await client.query(
        `INSERT INTO agent_tasks
          (id, tenant_id, agent_type, trigger_type, trigger_ref, status,
           risk_tier, actor_role, requested_by_type, input_ref, output_ref,
           attempt_count, idempotency_key, correlation_id, findings, actions,
           results, approved_by, approved_at, created_at, updated_at,
           version, lease_owner, lease_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'AGENT',$9,$10,$11,$12,
                 $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         ON CONFLICT (tenant_id, id) DO UPDATE
           SET status = EXCLUDED.status,
               trigger_ref = EXCLUDED.trigger_ref,
               risk_tier = EXCLUDED.risk_tier,
               actor_role = EXCLUDED.actor_role,
               output_ref = EXCLUDED.output_ref,
               attempt_count = EXCLUDED.attempt_count,
               findings = EXCLUDED.findings,
               actions = EXCLUDED.actions,
               results = EXCLUDED.results,
               approved_by = EXCLUDED.approved_by,
               approved_at = EXCLUDED.approved_at,
               updated_at = EXCLUDED.updated_at,
               version = agent_tasks.version + 1,
               lease_owner = EXCLUDED.lease_owner,
               lease_until = EXCLUDED.lease_until
           WHERE agent_tasks.tenant_id = EXCLUDED.tenant_id
             AND agent_tasks.version = EXCLUDED.version`,
        [
          task.id,
          this.tenantId,
          task.agentType,
          task.triggerType,
          task.triggerRef ?? null,
          task.status,
          task.riskTier,
          task.actorRole ?? null,
          JSON.stringify(task.input),
          task.output ? JSON.stringify(task.output) : null,
          task.attempts,
          task.idempotencyKey,
          task.correlationId,
          JSON.stringify(task.findings),
          JSON.stringify(task.actions),
          JSON.stringify(task.results),
          task.approvedBy ?? null,
          task.approvedAt ?? null,
          task.createdAt,
          task.updatedAt,
          task.version,
          task.leaseOwner ?? null,
          task.leaseUntil ?? null,
        ],
      );
      // NPV2-018：CAS 版本冲突——任务已被其他持有者修改。
      if (rowCount === 0) {
        throw new AgentTaskCasError(task.id);
      }
      const { rows } = await client.query(
        "SELECT version FROM agent_tasks WHERE tenant_id = $1 AND id = $2",
        [this.tenantId, task.id],
      );
      task.version = Number(rows[0].version);
    });
  }

  /**
   * NPV2-018：原子领取——FOR UPDATE SKIP LOCKED + 无有效租约的 READY 任务。
   * 两个 worker 竞争同一任务时，后到者要么拿到另一条，要么拿到 undefined。
   */
  async claimNextReadyTask(
    input: { workerId: string; leaseMs: number },
  ): Promise<AgentTask | undefined> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM agent_tasks
          WHERE tenant_id = $1
            AND status IN ('QUEUED','RETRY_PENDING')
            AND (lease_until IS NULL OR lease_until < now())
          ORDER BY created_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [this.tenantId],
      );
      if (!rows[0]) return undefined;
      const { rows: updated } = await client.query(
        `UPDATE agent_tasks
            SET lease_owner = $3, lease_until = $4, version = version + 1,
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING *`,
        [
          this.tenantId,
          rows[0].id,
          input.workerId,
          new Date(Date.now() + input.leaseMs).toISOString(),
        ],
      );
      return this.mapTask(updated[0]);
    });
  }

  async renewTaskLease(input: {
    taskId: string;
    workerId: string;
    leaseMs: number;
  }): Promise<boolean> {
    return this.tx(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE agent_tasks
            SET lease_until = $4, version = version + 1, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND lease_owner = $3`,
        [
          this.tenantId,
          input.taskId,
          input.workerId,
          new Date(Date.now() + input.leaseMs).toISOString(),
        ],
      );
      return rowCount === 1;
    });
  }

  async releaseTaskLease(input: {
    taskId: string;
    workerId: string;
  }): Promise<boolean> {
    return this.tx(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE agent_tasks
            SET lease_owner = NULL, lease_until = NULL,
                version = version + 1, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND lease_owner = $3`,
        [this.tenantId, input.taskId, input.workerId],
      );
      return rowCount === 1;
    });
  }

  /** 过期租约复位：RUNNING → QUEUED，清租约，可被重新领取。 */
  async recoverExpiredLeases(): Promise<number> {
    return this.tx(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE agent_tasks
            SET lease_owner = NULL, lease_until = NULL,
                status = CASE WHEN status = 'RUNNING' THEN 'QUEUED' ELSE status END,
                version = version + 1, updated_at = now()
          WHERE tenant_id = $1
            AND lease_until IS NOT NULL AND lease_until < now()
            AND status IN ('RUNNING','QUEUED','RETRY_PENDING')`,
        [this.tenantId],
      );
      return rowCount ?? 0;
    });
  }

  async appendAudit(entry: AgentAuditEntry): Promise<void> {
    await this.tx(async (client) => {
      await client.query(
        `INSERT INTO agent_task_audit
          (id, tenant_id, task_id, action_id, tool, actor, detail, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          this.tenantId,
          entry.taskId,
          entry.actionId ?? null,
          entry.tool ?? null,
          entry.actor,
          entry.detail,
          entry.at,
        ],
      );
    });
  }

  private mapTask(row: QueryResultRow): AgentTask {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      agentType: row.agent_type,
      triggerType: row.trigger_type,
      triggerRef: row.trigger_ref ?? undefined,
      status: row.status,
      riskTier: row.risk_tier,
      actorRole: row.actor_role ?? undefined,
      input: asJson<Record<string, unknown>>(row.input_ref, {}),
      output:
        row.output_ref === null || row.output_ref === undefined
          ? undefined
          : asJson<Record<string, unknown>>(row.output_ref, {}),
      findings: asJson<AgentTask["findings"]>(row.findings, []),
      actions: asJson<AgentTask["actions"]>(row.actions, []),
      results: asJson<AgentTask["results"]>(row.results, []),
      attempts: Number(row.attempt_count),
      version: Number(row.version ?? 1),
      leaseOwner: row.lease_owner ?? undefined,
      leaseUntil: iso(row.lease_until),
      idempotencyKey: row.idempotency_key,
      correlationId: row.correlation_id,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: iso(row.approved_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapAudit(row: QueryResultRow): AgentAuditEntry {
    return {
      taskId: row.task_id,
      actionId: row.action_id ?? undefined,
      tool: row.tool ?? undefined,
      actor: row.actor,
      at: iso(row.occurred_at) ?? new Date().toISOString(),
      detail: row.detail,
    };
  }
}
