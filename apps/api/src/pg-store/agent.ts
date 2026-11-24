/**
 * Agent：待办、反馈标注、模型用量与 AI-off 基线
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { type QueryResultRow } from "pg";
import {
  type AgentTodo,
  type AgentTodoFilter,
  type UpsertAgentTodoInput,
  type AgentFeedbackLabel,
  type AgentFeedbackLabelKind,
  type AgentModelUsage,
  type AgentAiOffBaseline,
} from "@anari/domain";
import { ConflictError } from "../store.js";
import { PgStoreDataQuality } from "./data-quality.js";
import { iso, isoDate, notFound } from "../pg-store-support.js";

export class PgStoreAgent extends PgStoreDataQuality {
  /** NPV2-020：Agent 待办 upsert（幂等键唯一索引，冲突返回既有）。 */
  async upsertAgentTodo(input: UpsertAgentTodoInput): Promise<AgentTodo> {
    const { rows: existing } = await this.tx(async (client) =>
      client.query(
        "SELECT * FROM agent_todos WHERE tenant_id = $1 AND idempotency_key = $2",
        [this.tenantId, input.idempotencyKey],
      ),
    );
    if (existing[0]) return this.mapAgentTodo(existing[0]);
    const { rows } = await this.tx(async (client) =>
      client.query(
        `INSERT INTO agent_todos
          (tenant_id, title, detail, assignee_person_id, due_at, target_type,
           target_id, source_type, source_id, idempotency_key,
           created_by_agent_task_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
           SET updated_at = now()
         RETURNING *`,
        [
          this.tenantId,
          input.title,
          input.detail ?? null,
          input.assigneePersonId,
          input.dueAt ?? null,
          input.targetType ?? null,
          input.targetId ?? null,
          input.sourceType,
          input.sourceId,
          input.idempotencyKey,
          input.createdByAgentTaskId ?? null,
        ],
      ),
    );
    return this.mapAgentTodo(rows[0]);
  }

  async listAgentTodos(filter?: AgentTodoFilter): Promise<AgentTodo[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.assigneePersonId) {
      params.push(filter.assigneePersonId);
      conditions.push(`assignee_person_id = $${params.length}`);
    }
    if (filter?.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter?.sourceType) {
      params.push(filter.sourceType);
      conditions.push(`source_type = $${params.length}`);
    }
    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.tx(async (client) =>
      client.query(
        `SELECT * FROM agent_todos ${where} ORDER BY created_at DESC`,
        params,
      ),
    );
    return rows.map((row: QueryResultRow) => this.mapAgentTodo(row));
  }

  // ------------------------------------------------------------------
  // AUD-023：Agent 可观测性持久化事实（标注/模型用量/AI-off 基线）。
  // ------------------------------------------------------------------
  async recordAgentFeedbackLabel(input: {
    taskId?: string;
    findingRef?: string;
    label: AgentFeedbackLabelKind;
    labeledBy: string;
    model?: string;
    promptVersion?: string;
    comment?: string;
  }): Promise<AgentFeedbackLabel> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO agent_feedback_labels
          (tenant_id, task_id, finding_ref, label, labeled_by, model,
           prompt_version, comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, task_id, labeled_by, label) DO NOTHING
         RETURNING *`,
        [
          this.tenantId,
          input.taskId ?? null,
          input.findingRef ?? null,
          input.label,
          input.labeledBy,
          input.model ?? null,
          input.promptVersion ?? null,
          input.comment ?? null,
        ],
      );
      if (rows[0]) return this.mapAgentFeedbackLabel(rows[0]);
      // 幂等命中：回查既有标注（NULL task_id 不受唯一约束保护，
      // 但 memory/PG 契约一致：仍以 (labeledBy,label) 回查最新一条）。
      const { rows: existing } = await client.query(
        `SELECT * FROM agent_feedback_labels
          WHERE tenant_id = $1 AND labeled_by = $2 AND label = $3
            AND (($4::uuid IS NULL AND task_id IS NULL) OR task_id = $4::uuid)
          ORDER BY created_at DESC LIMIT 1`,
        [this.tenantId, input.labeledBy, input.label, input.taskId ?? null],
      );
      return this.mapAgentFeedbackLabel(existing[0]);
    });
  }

  async listAgentFeedbackLabels(): Promise<AgentFeedbackLabel[]> {
    const { rows } = await this.tx(async (client) =>
      client.query(
        "SELECT * FROM agent_feedback_labels WHERE tenant_id = $1 ORDER BY created_at DESC",
        [this.tenantId],
      ),
    );
    return rows.map((row: QueryResultRow) => this.mapAgentFeedbackLabel(row));
  }

  async upsertAgentModelUsage(input: {
    provider: string;
    model: string;
    requests: number;
    promptTokens: number;
    completionTokens: number;
  }): Promise<AgentModelUsage> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO agent_model_usage
          (tenant_id, provider, model, requests, prompt_tokens, completion_tokens)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, provider, model) DO UPDATE
           SET requests = agent_model_usage.requests + EXCLUDED.requests,
               prompt_tokens = agent_model_usage.prompt_tokens + EXCLUDED.prompt_tokens,
               completion_tokens = agent_model_usage.completion_tokens + EXCLUDED.completion_tokens,
               updated_at = now()
         RETURNING *`,
        [
          this.tenantId,
          input.provider,
          input.model,
          input.requests,
          input.promptTokens,
          input.completionTokens,
        ],
      );
      return this.mapAgentModelUsage(rows[0]);
    });
  }

  async listAgentModelUsage(): Promise<AgentModelUsage[]> {
    const { rows } = await this.tx(async (client) =>
      client.query(
        "SELECT * FROM agent_model_usage WHERE tenant_id = $1 ORDER BY provider, model",
        [this.tenantId],
      ),
    );
    return rows.map((row: QueryResultRow) => this.mapAgentModelUsage(row));
  }

  async recordAgentAiOffBaseline(input: {
    windowStart: string;
    windowEnd: string;
    completionRate: string;
    sampleSize: number;
    recordedBy: string;
  }): Promise<AgentAiOffBaseline> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO agent_ai_off_baseline
          (tenant_id, window_start, window_end, completion_rate, sample_size, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          this.tenantId,
          input.windowStart,
          input.windowEnd,
          input.completionRate,
          input.sampleSize,
          input.recordedBy,
        ],
      );
      return this.mapAgentAiOffBaseline(rows[0]);
    });
  }

  async latestAgentAiOffBaseline(): Promise<AgentAiOffBaseline | undefined> {
    const { rows } = await this.tx(async (client) =>
      client.query(
        "SELECT * FROM agent_ai_off_baseline WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1",
        [this.tenantId],
      ),
    );
    return rows[0] ? this.mapAgentAiOffBaseline(rows[0]) : undefined;
  }

  private mapAgentFeedbackLabel(row: QueryResultRow): AgentFeedbackLabel {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      taskId: row.task_id ?? undefined,
      findingRef: row.finding_ref ?? undefined,
      label: row.label,
      labeledBy: row.labeled_by,
      model: row.model ?? undefined,
      promptVersion: row.prompt_version ?? undefined,
      comment: row.comment ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapAgentModelUsage(row: QueryResultRow): AgentModelUsage {
    return {
      tenantId: row.tenant_id,
      provider: row.provider,
      model: row.model,
      requests: Number(row.requests ?? 0),
      promptTokens: Number(row.prompt_tokens ?? 0),
      completionTokens: Number(row.completion_tokens ?? 0),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapAgentAiOffBaseline(row: QueryResultRow): AgentAiOffBaseline {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      windowStart: isoDate(row.window_start) ?? String(row.window_start),
      windowEnd: isoDate(row.window_end) ?? String(row.window_end),
      completionRate: String(row.completion_rate),
      sampleSize: Number(row.sample_size ?? 0),
      recordedBy: row.recorded_by,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  async getAgentTodo(id: string): Promise<AgentTodo> {
    const { rows } = await this.tx(async (client) =>
      client.query(
        "SELECT * FROM agent_todos WHERE tenant_id = $1 AND id = $2",
        [this.tenantId, id],
      ),
    );
    if (!rows[0]) notFound("AgentTodo", id);
    return this.mapAgentTodo(rows[0]);
  }

  async completeAgentTodo(
    id: string,
    completedByPersonId?: string,
  ): Promise<AgentTodo> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE agent_todos
            SET status = 'DONE', completed_by_person_id = $3,
                completed_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'
          RETURNING *`,
        [this.tenantId, id, completedByPersonId ?? null],
      );
      if (!rows[0]) {
        const current = await this.getAgentTodo(id);
        throw new ConflictError(`AGENT_TODO_NOT_OPEN: todo is ${current.status}`);
      }
      return this.mapAgentTodo(rows[0]);
    });
  }

  async cancelAgentTodo(id: string, reason?: string): Promise<AgentTodo> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE agent_todos
            SET status = 'CANCELLED', cancel_reason = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'OPEN'
          RETURNING *`,
        [this.tenantId, id, reason ?? null],
      );
      if (!rows[0]) {
        const current = await this.getAgentTodo(id);
        throw new ConflictError(`AGENT_TODO_NOT_OPEN: todo is ${current.status}`);
      }
      return this.mapAgentTodo(rows[0]);
    });
  }

  private mapAgentTodo(row: QueryResultRow): AgentTodo {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      title: row.title,
      detail: row.detail ?? undefined,
      assigneePersonId: row.assignee_person_id,
      dueAt: iso(row.due_at),
      targetType: row.target_type ?? undefined,
      targetId: row.target_id ?? undefined,
      sourceType: row.source_type,
      sourceId: row.source_id,
      idempotencyKey: row.idempotency_key,
      createdByAgentTaskId: row.created_by_agent_task_id ?? undefined,
      status: row.status,
      completedByPersonId: row.completed_by_person_id ?? undefined,
      completedAt: iso(row.completed_at),
      cancelReason: row.cancel_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }
}
