/**
 * 共享内核：连接/租户状态、事务、审计追加与跨领域 loader
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * 这里是原先 `PgStore` 的跨领域共享部分：
 * - `tx()` 是所有领域共用的事务包装，负责 BEGIN / set_config('app.tenant_id') / COMMIT / ROLLBACK；
 * - `appendAudit()` 被 policy、legal gate、calculation、evaluation、settlement、DQ、ledger 调用；
 * - 其余 loader / mapper 被两个以上领域引用（WorkPackage↔Claim/Attestation/Calculation、
 *   Claim↔Assessment/Attribution、Confirmation↔Calculation、LegalGate↔Calculation）。
 * 放在基类是为了让各领域层以 `protected` 方式共享，不改变任何 SQL 与事务边界。
 *
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { randomUUID } from "node:crypto";
import { type Pool, type PoolClient, type QueryResultRow } from "pg";
import {
  type CommitmentSnapshot,
  type ContributionClaim,
  type EmployeeConfirmation,
  type LegalGateRecord,
  type WorkPackage,
} from "@anari/domain";
import { DEMO_TENANT_ID, iso, notFound, asNumber, asJson } from "../pg-store-support.js";

export class PgStoreBase {
  constructor(
    protected readonly pool: Pool,
    protected readonly tenantId: string = DEMO_TENANT_ID,
  ) {}

  async ping(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  }

  protected async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
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

  protected async appendAudit(
    client: PoolClient,
    entry: {
      action: string;
      objectType: string;
      objectId?: string;
      actorType: "USER" | "AGENT" | "SYSTEM" | "INTEGRATION";
      actorId?: string;
      beforeHash?: string;
      afterHash?: string;
      reason?: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_events
        (tenant_id, sequence, actor_type, actor_id, action, object_type,
         object_id, before_hash, after_hash, reason, correlation_id,
         prev_hash, event_hash)
       VALUES ($1,0,$2,$3,$4,$5,$6,$7,$8,$9,$10,'','')`,
      [
        this.tenantId,
        entry.actorType,
        entry.actorId ?? null,
        entry.action,
        entry.objectType,
        entry.objectId ?? null,
        entry.beforeHash ?? null,
        entry.afterHash ?? null,
        entry.reason ?? null,
        randomUUID(),
      ],
    );
  }

  protected async loadWorkPackage(
    client: PoolClient,
    id: string,
  ): Promise<WorkPackage> {
    const { rows } = await client.query(
      "SELECT * FROM work_packages WHERE tenant_id=$1 AND id=$2",
      [this.tenantId, id],
    );
    const row = rows[0];
    if (!row) notFound("WorkPackage", id);
    const membersResult = await client.query(
      `SELECT person_id, responsibility_code, expected_output
         FROM work_package_members
        WHERE tenant_id=$1 AND work_package_id=$2
        ORDER BY active_from`,
      [this.tenantId, id],
    );
    let snapshot: CommitmentSnapshot | undefined;
    if (row.current_snapshot_id) {
      const snapshotResult = await client.query(
        "SELECT snapshot FROM work_package_versions WHERE tenant_id=$1 AND id=$2",
        [this.tenantId, row.current_snapshot_id],
      );
      snapshot = snapshotResult.rows[0]?.snapshot as
        | CommitmentSnapshot
        | undefined;
    }
    return {
      id: row.id,
      tenantId: row.tenant_id,
      title: row.title,
      objective: row.objective,
      packageType: row.package_type ?? "ORDER_DELIVERY",
      ownerPersonId: row.owner_person_id,
      status: row.status,
      acceptanceCriteria: asJson(row.acceptance_criteria, []),
      members: membersResult.rows.map((member) => ({
        personId: member.person_id,
        responsibilityCode: member.responsibility_code,
        expectedOutput: member.expected_output,
      })),
      dueAt: iso(row.due_at),
      commitmentSnapshot: snapshot,
      version: asNumber(row.version),
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at)!,
    };
  }

  protected async loadClaim(
    client: PoolClient,
    id: string,
  ): Promise<ContributionClaim> {
    const { rows } = await client.query(
      "SELECT * FROM contribution_claims WHERE tenant_id=$1 AND id=$2",
      [this.tenantId, id],
    );
    const row = rows[0];
    if (!row) notFound("ContributionClaim", id);
    const evidence = await client.query(
      "SELECT evidence_ref FROM claim_evidence_links WHERE tenant_id=$1 AND claim_id=$2 ORDER BY created_at",
      [this.tenantId, id],
    );
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workPackageId: row.work_package_id,
      claimantPersonId: row.claimant_person_id,
      claimType: row.claim_type,
      claimMode: row.claim_mode ?? "STANDARD",
      exceptionReason: row.exception_reason ?? undefined,
      claimedContribution: row.claimed_contribution,
      evidenceRefs: evidence.rows.map((item) => item.evidence_ref),
      rationale: row.rationale,
      status: row.status,
      submittedAt: iso(row.submitted_at),
      version: asNumber(row.version),
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at)!,
    };
  }

  protected async loadConfirmationsForRun(
    client: PoolClient,
    runId: string,
  ): Promise<EmployeeConfirmation[]> {
    const { rows } = await client.query(
      `SELECT * FROM employee_confirmations
        WHERE tenant_id=$1 AND target_type='CALCULATION' AND target_id=$2`,
      [this.tenantId, runId],
    );
    return rows.map((row) => this.mapConfirmation(row));
  }

  protected mapConfirmation(row: QueryResultRow): EmployeeConfirmation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      targetType: row.target_type,
      targetId: row.target_id,
      decision: row.decision,
      reason: row.objection_reason ?? undefined,
      viewedAt: iso(row.viewed_at),
      confirmedAt: iso(row.confirmed_at),
      objectedAt: iso(row.objection_at),
      createdAt: iso(row.created_at)!,
    };
  }

  protected mapLegalGate(row: QueryResultRow): LegalGateRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      policyVersionId: row.policy_version_id,
      democraticProcedureRef: row.democratic_procedure_ref ?? undefined,
      employeeNoticeRef: row.employee_notice_ref ?? undefined,
      dataProtectionAssessmentRef:
        row.data_protection_assessment_ref ?? undefined,
      minimumWageChecked: row.minimum_wage_checked,
      policyApproved: row.policy_approved,
      recordedBy: row.recorded_by,
      recordedAt: iso(row.recorded_at)!,
    };
  }
}
