/**
 * Calculation：核算批次、锁定与员工确认
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * `loadRun` / `assertConfirmationTarget` 仅本领域使用；`loadConfirmationsForRun` 在基类（lockRun 使用）。
 *
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { randomUUID } from "node:crypto";
import { type PoolClient } from "pg";
import {
  assertTransition,
  calculationRunTransitions,
  confirmationBlockers,
  legalGateBlockers,
  type AttributionDecision,
  type CalculationInput,
  type CalculationRun,
  type EmployeeConfirmation,
  type PolicyDefinition,
  type SettlementBatch,
} from "@anari/domain";
import { type CreateCalculationRunInput } from "@anari/contracts";
import { hashLedgerEntry } from "@anari/ledger";
import {
  PolicyGateError,
  calculateByPolicy,
  deriveEvaluationMultiplier,
} from "@anari/policy-dsl";
import { type RecordConfirmationInput } from "../store-interface.js";
import { CalculationBlockedError, ConflictError } from "../store.js";
import { PgStoreAssessment } from "./assessment.js";
import { DEMO_REQUESTER_ID, iso, notFound, asJson, normalizeAmount, trimAmount } from "../pg-store-support.js";

export class PgStoreCalculation extends PgStoreAssessment {
  async createCalculationRun(
    input: CreateCalculationRunInput,
  ): Promise<CalculationRun> {
    return this.tx((client) => this.createCalculationRunInTx(client, input));
  }

  async createCalculationRunsBatch(
    inputs: CreateCalculationRunInput[],
  ): Promise<CalculationRun[]> {
    return this.tx(async (client) => {
      const runs: CalculationRun[] = [];
      for (const input of inputs) {
        runs.push(await this.createCalculationRunInTx(client, input));
      }
      return runs;
    });
  }

  private async createCalculationRunInTx(
    client: PoolClient,
    input: CreateCalculationRunInput,
  ): Promise<CalculationRun> {
      const policyResult = await client.query(
        "SELECT rule_ast FROM policy_versions WHERE tenant_id=$1 AND id=$2",
        [this.tenantId, input.policyVersionId],
      );
      if (!policyResult.rows[0]) {
        notFound("Policy", input.policyVersionId);
      }
      const policy = policyResult.rows[0].rule_ast as PolicyDefinition;

      const gateResult = await client.query(
        `SELECT * FROM legal_gate_records
          WHERE tenant_id=$1 AND policy_version_id=$2`,
        [this.tenantId, input.policyVersionId],
      );
      const gate = gateResult.rows[0]
        ? this.mapLegalGate(gateResult.rows[0])
        : undefined;
      const blockers = legalGateBlockers(input.mode, gate);
      const effectiveParticipants: CalculationInput["participants"] =
        input.participants.map((participant) => ({ ...participant }));

      if (policy.evaluation) {
        for (const participant of effectiveParticipants) {
          const decisionId = participant.evaluationDecisionId;
          if (!decisionId) {
            blockers.push(
              `EVALUATION_DECISION_MISSING:${participant.personId}`,
            );
            continue;
          }
          const { rows } = await client.query(
            `SELECT * FROM evaluation_decisions
              WHERE tenant_id=$1 AND id=$2`,
            [this.tenantId, decisionId],
          );
          const decision = rows[0];
          if (!decision) {
            blockers.push(
              `EVALUATION_DECISION_NOT_FOUND:${participant.personId}`,
            );
            continue;
          }
          if (decision.status !== "APPROVED") {
            blockers.push(
              `EVALUATION_DECISION_NOT_APPROVED:${participant.personId}`,
            );
            continue;
          }
          if (decision.person_id !== participant.personId) {
            blockers.push(
              `EVALUATION_DECISION_PERSON_MISMATCH:${participant.personId}`,
            );
            continue;
          }
          if (decision.cycle_id !== input.cycleId) {
            blockers.push(
              `EVALUATION_DECISION_CYCLE_MISMATCH:${participant.personId}`,
            );
            continue;
          }
          const derived = deriveEvaluationMultiplier(
            policy.evaluation,
            asJson<Record<string, number>>(decision.scores, {}),
            participant.personId,
          );
          if (derived.blockers.length > 0 || !derived.multiplier) {
            blockers.push(...derived.blockers);
            continue;
          }
          participant.evaluationMultiplier = derived.multiplier;
        }
      }

      if (input.mode === "FORMAL") {
        for (const participant of input.participants) {
          const confirmed = await client.query(
            `SELECT 1
               FROM contribution_claims c
               JOIN attribution_decisions d
                 ON d.tenant_id = c.tenant_id AND d.claim_id = c.id
              WHERE c.tenant_id = $1
                AND c.work_package_id = $2
                AND c.claimant_person_id = $3
                AND d.status IN ('CONFIRMED','PARTIALLY_CONFIRMED')
              LIMIT 1`,
            [
              this.tenantId,
              participant.workPackageId,
              participant.personId,
            ],
          );
          if (confirmed.rowCount === 0) {
            blockers.push(
              `MISSING_CONFIRMED_ATTRIBUTION:${participant.personId}`,
            );
          }
        }
        const workPackageIds = input.participants.map(
          (participant) => participant.workPackageId,
        );
        const { rows: blockingIssues } = await client.query(
          `SELECT id FROM data_quality_issues
            WHERE tenant_id = $1
              AND object_type = 'WORK_PACKAGE'
              AND object_id = ANY($2::uuid[])
              AND severity = 'BLOCKING'
              AND status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED')`,
          [this.tenantId, workPackageIds],
        );
        for (const issue of blockingIssues) {
          blockers.push(`BLOCKING_DATA_QUALITY_ISSUE:${issue.id}`);
        }
      }

      if (blockers.length > 0) {
        throw new CalculationBlockedError(blockers);
      }

      const calculationInput: CalculationInput = {
        tenantId: this.tenantId,
        cycleId: input.cycleId,
        policyVersionId: input.policyVersionId,
        mode: input.mode,
        order: input.order,
        participants: effectiveParticipants,
        legalGate: gate,
      };
      let result;
      try {
        result = calculateByPolicy(policy, calculationInput);
      } catch (error) {
        if (error instanceof PolicyGateError) {
          throw new CalculationBlockedError(error.blockers);
        }
        throw error;
      }
      const runId = randomUUID();
      const warnings =
        input.mode === "FORMAL"
          ? []
          : ["SHADOW run: no payment effect and no ledger entries were created"];

      await client.query(
        `INSERT INTO calculation_runs
          (id, tenant_id, cycle_id, policy_version_id, mode, engine_version,
           input_snapshot_hash, input_snapshot, status, result_hash,
           blockers, warnings, requested_by, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CALCULATED',$9,$10,$11,$12,now())`,
        [
          runId,
          this.tenantId,
          input.cycleId,
          input.policyVersionId,
          input.mode,
          result.engineVersion,
          result.inputSnapshotHash,
          JSON.stringify(calculationInput),
          result.resultHash,
          JSON.stringify([]),
          JSON.stringify(warnings),
          input.requestedBy ?? DEMO_REQUESTER_ID,
        ],
      );

      const lineIds = new Map<string, string>();
      for (const line of result.lines) {
        const lineId = randomUUID();
        lineIds.set(line.lineKey, lineId);
        await client.query(
          `INSERT INTO calculation_lines
            (id, tenant_id, calculation_run_id, line_key, person_id,
             work_package_id, incentive_type, base_amount, multiplier,
             raw_amount, rounded_amount, currency, trace, result_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            lineId,
            this.tenantId,
            runId,
            line.lineKey,
            line.personId,
            line.workPackageId,
            line.incentiveType,
            line.baseAmount,
            line.multiplier,
            line.rawAmount,
            line.roundedAmount,
            line.currency,
            JSON.stringify(line.trace),
            result.resultHash,
          ],
        );
      }

      if (input.mode === "FORMAL") {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
          [this.tenantId],
        );
        const lastResult = await client.query(
          `SELECT entry_hash FROM amount_ledger
            WHERE tenant_id = $1
            ORDER BY ledger_seq DESC
            LIMIT 1`,
          [this.tenantId],
        );
        let prevHash = lastResult.rows[0]?.entry_hash ?? "GENESIS";

        for (const line of result.lines) {
          const lineId = lineIds.get(line.lineKey)!;
          const ledgerId = randomUUID();
          const createdAt = new Date().toISOString();
          const idempotencyKey = `${runId}:${line.lineKey}:INCENTIVE`;
          const amount = normalizeAmount(line.roundedAmount);
          const entryHash = hashLedgerEntry({
            id: ledgerId,
            tenantId: this.tenantId,
            personId: line.personId,
            cycleId: input.cycleId,
            calculationRunId: runId,
            calculationLineId: lineId,
            entryType: "INCENTIVE",
            amount,
            currency: line.currency,
            idempotencyKey,
            prevHash,
            createdAt,
          });
          await client.query(
            `INSERT INTO amount_ledger
              (id, tenant_id, person_id, cycle_id, calculation_run_id,
               calculation_line_id, entry_type, amount, currency, status,
               idempotency_key, entry_hash, prev_hash, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,'INCENTIVE',$7,$8,'PROVISIONAL',$9,$10,$11,$12)`,
            [
              ledgerId,
              this.tenantId,
              line.personId,
              input.cycleId,
              runId,
              lineId,
              amount,
              line.currency,
              idempotencyKey,
              entryHash,
              prevHash,
              createdAt,
            ],
          );
          prevHash = entryHash;
        }
      }

      return this.loadRun(client, runId);
  }

  async getRun(id: string): Promise<CalculationRun> {
    return this.tx((client) => this.loadRun(client, id));
  }

  async listRuns(): Promise<CalculationRun[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT id FROM calculation_runs WHERE tenant_id=$1 ORDER BY created_at DESC",
        [this.tenantId],
      );
      const runs = [];
      for (const row of rows) {
        runs.push(await this.loadRun(client, row.id));
      }
      return runs;
    });
  }

  async approveRun(id: string): Promise<CalculationRun> {
    return this.tx(async (client) => {
      const run = await this.loadRun(client, id);
      assertTransition(
        calculationRunTransitions,
        "CalculationRun",
        run.status,
        "APPROVED",
      );
      await client.query(
        "UPDATE calculation_runs SET status='APPROVED' WHERE tenant_id=$1 AND id=$2",
        [this.tenantId, id],
      );
      return this.loadRun(client, id);
    });
  }

  async lockRun(id: string, confirmation: string): Promise<CalculationRun> {
    if (confirmation !== "LOCK_CALCULATION") {
      throw new ConflictError("invalid lock confirmation");
    }
    return this.tx(async (client) => {
      const run = await this.loadRun(client, id);
      const confirmations = await this.loadConfirmationsForRun(client, id);
      const blockers = confirmationBlockers(run, confirmations);
      if (blockers.length > 0) {
        throw new CalculationBlockedError(blockers);
      }
      assertTransition(
        calculationRunTransitions,
        "CalculationRun",
        run.status,
        "LOCKED",
      );
      await client.query(
        "UPDATE calculation_runs SET status='LOCKED', locked_at=now() WHERE tenant_id=$1 AND id=$2",
        [this.tenantId, id],
      );
      await client.query(
        "UPDATE amount_ledger SET status='LOCKED', locked_at=now() WHERE tenant_id=$1 AND calculation_run_id=$2",
        [this.tenantId, id],
      );
      await this.appendAudit(client, {
        action: "CALCULATION_LOCKED",
        objectType: "CALCULATION_RUN",
        objectId: id,
        actorType: "SYSTEM",
        afterHash: run.resultHash,
        reason: confirmation,
      });
      return this.loadRun(client, id);
    });
  }

  async recordConfirmation(
    input: RecordConfirmationInput,
  ): Promise<EmployeeConfirmation> {
    return this.tx(async (client) => {
      await this.assertConfirmationTarget(client, input);
      const { rows } = await client.query(
        `INSERT INTO employee_confirmations
          (id, tenant_id, person_id, target_type, target_id, decision,
           viewed_at, confirmed_at, objection_at, objection_reason)
         VALUES ($1,$2,$3,$4,$5,$6,
           CASE WHEN $6 = 'VIEWED' THEN now() END,
           CASE WHEN $6 = 'CONFIRMED' THEN now() END,
           CASE WHEN $6 = 'OBJECTED' THEN now() END,
           $7)
         ON CONFLICT (tenant_id, person_id, target_type, target_id)
         DO UPDATE SET decision = EXCLUDED.decision,
                       viewed_at = COALESCE(EXCLUDED.viewed_at, employee_confirmations.viewed_at),
                       confirmed_at = COALESCE(EXCLUDED.confirmed_at, employee_confirmations.confirmed_at),
                       objection_at = COALESCE(EXCLUDED.objection_at, employee_confirmations.objection_at),
                       objection_reason = COALESCE(EXCLUDED.objection_reason, employee_confirmations.objection_reason)
         RETURNING *`,
        [
          randomUUID(),
          this.tenantId,
          input.personId,
          input.targetType,
          input.targetId,
          input.decision,
          input.reason ?? null,
        ],
      );
      return this.mapConfirmation(rows[0]);
    });
  }

  async listConfirmations(
    personId?: string,
  ): Promise<EmployeeConfirmation[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        personId
          ? "SELECT * FROM employee_confirmations WHERE tenant_id=$1 AND person_id=$2 ORDER BY created_at DESC"
          : "SELECT * FROM employee_confirmations WHERE tenant_id=$1 ORDER BY created_at DESC",
        personId ? [this.tenantId, personId] : [this.tenantId],
      );
      return rows.map((row) => this.mapConfirmation(row));
    });
  }

  private async assertConfirmationTarget(
    client: PoolClient,
    input: RecordConfirmationInput,
  ): Promise<void> {
    if (input.targetType === "CALCULATION") {
      const { rowCount } = await client.query(
        "SELECT 1 FROM calculation_runs WHERE tenant_id=$1 AND id=$2",
        [this.tenantId, input.targetId],
      );
      if (rowCount === 0) notFound("CalculationRun", input.targetId);
    } else if (input.targetType === "ATTRIBUTION") {
      const { rowCount } = await client.query(
        "SELECT 1 FROM attribution_decisions WHERE tenant_id=$1 AND id=$2",
        [this.tenantId, input.targetId],
      );
      if (rowCount === 0) notFound("AttributionDecision", input.targetId);
    } else if (input.targetType === "LEDGER") {
      const { rowCount } = await client.query(
        "SELECT 1 FROM amount_ledger WHERE tenant_id=$1 AND id=$2",
        [this.tenantId, input.targetId],
      );
      if (rowCount === 0) notFound("AmountLedger", input.targetId);
    } else if (input.targetType === "SETTLEMENT") {
      const { rowCount } = await client.query(
        "SELECT 1 FROM settlement_batches WHERE tenant_id=$1 AND id=$2",
        [this.tenantId, input.targetId],
      );
      if (rowCount === 0) notFound("SettlementBatch", input.targetId);
    }
  }

  private async loadRun(
    client: PoolClient,
    id: string,
  ): Promise<CalculationRun> {
    const { rows } = await client.query(
      "SELECT * FROM calculation_runs WHERE tenant_id=$1 AND id=$2",
      [this.tenantId, id],
    );
    const row = rows[0];
    if (!row) notFound("CalculationRun", id);
    const lineResult = await client.query(
      `SELECT * FROM calculation_lines
        WHERE tenant_id=$1 AND calculation_run_id=$2
        ORDER BY line_key`,
      [this.tenantId, id],
    );
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      mode: row.mode,
      policyVersionId: row.policy_version_id,
      engineVersion: row.engine_version,
      inputSnapshotHash: row.input_snapshot_hash,
      inputSnapshot: row.input_snapshot,
      status: row.status,
      lines: lineResult.rows.map((line) => ({
        lineKey: line.line_key,
        personId: line.person_id,
        workPackageId: line.work_package_id,
        incentiveType: line.incentive_type,
        baseAmount: trimAmount(line.base_amount),
        multiplier: trimAmount(line.multiplier),
        rawAmount: trimAmount(line.raw_amount),
        roundedAmount: trimAmount(line.rounded_amount),
        currency: line.currency,
        trace: line.trace,
      })),
      resultHash: row.result_hash ?? undefined,
      blockers: asJson(row.blockers, []),
      warnings: asJson(row.warnings, []),
      createdAt: iso(row.created_at)!,
      calculatedAt: iso(row.finished_at),
      lockedAt: iso(row.locked_at),
    };
  }
}
