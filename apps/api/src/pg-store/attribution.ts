/**
 * Attribution：归属决定与法务闸门
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * `loadDecision` 仅本领域使用；`mapLegalGate` 被 Calculation 复用，放在基类。
 *
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { randomUUID } from "node:crypto";
import { type PoolClient } from "pg";
import {
  assertAdjudicatorIsNotClaimant,
  assertTransition,
  attributionDecisionTransitions,
  contributionClaimTransitions,
  type AttributionDecision,
  type ContributionClaim,
  type LegalGateRecord,
} from "@anari/domain";
import { type CreateAttributionDecisionInput } from "@anari/contracts";
import { sha256 } from "@anari/policy-dsl";
import { type RecordLegalGateInput } from "../store-interface.js";
import { ConflictError } from "../store.js";
import { PgStoreClaims } from "./claims.js";
import { iso, notFound, asNumber, asJson } from "../pg-store-support.js";

export class PgStoreAttribution extends PgStoreClaims {
  async createAttributionDecision(
    input: CreateAttributionDecisionInput,
  ): Promise<AttributionDecision> {
    return this.tx((client) =>
      this.createAttributionDecisionInTx(client, input),
    );
  }

  async createAttributionDecisionsBatch(
    inputs: CreateAttributionDecisionInput[],
  ): Promise<AttributionDecision[]> {
    return this.tx(async (client) => {
      const decisions: AttributionDecision[] = [];
      for (const input of inputs) {
        decisions.push(
          await this.createAttributionDecisionInTx(client, input),
        );
      }
      return decisions;
    });
  }

  private async createAttributionDecisionInTx(
    client: PoolClient,
    input: CreateAttributionDecisionInput,
  ): Promise<AttributionDecision> {
      const claim = await this.loadClaim(client, input.claimId);
      if (claim.status === "SUBMITTED") {
        assertTransition(
          contributionClaimTransitions,
          "ContributionClaim",
          claim.status,
          "UNDER_REVIEW",
        );
        await client.query(
          `UPDATE contribution_claims
              SET status = 'UNDER_REVIEW', version = version + 1
            WHERE tenant_id = $1 AND id = $2`,
          [this.tenantId, input.claimId],
        );
      } else if (claim.status !== "UNDER_REVIEW") {
        throw new ConflictError(
          `claim must be SUBMITTED or UNDER_REVIEW, got ${claim.status}`,
        );
      }

      assertAdjudicatorIsNotClaimant(claim, {
        adjudicatorPersonId: input.adjudicatorPersonId,
      });

      const previousResult = await client.query(
        `SELECT id, decision_version, status
           FROM attribution_decisions
          WHERE tenant_id = $1 AND claim_id = $2
          ORDER BY decision_version DESC
          LIMIT 1`,
        [this.tenantId, input.claimId],
      );
      const previous = previousResult.rows[0];
      if (previous) {
        assertTransition(
          attributionDecisionTransitions,
          "AttributionDecision",
          previous.status,
          "SUPERSEDED",
        );
        await client.query(
          `UPDATE attribution_decisions SET status = 'SUPERSEDED'
            WHERE tenant_id = $1 AND id = $2`,
          [this.tenantId, previous.id],
        );
      }

      const id = randomUUID();
      const decisionVersion = asNumber(previous?.decision_version ?? 0) + 1;
      await client.query(
        `INSERT INTO attribution_decisions
          (id, tenant_id, claim_id, decision_version, status,
           adjudicator_person_id, accepted_facts, rejected_facts,
           contribution_dimensions, rationale, confidence_band,
           effective_at, supersedes_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12)`,
        [
          id,
          this.tenantId,
          input.claimId,
          decisionVersion,
          input.status,
          input.adjudicatorPersonId,
          JSON.stringify(input.acceptedFacts ?? []),
          JSON.stringify(input.rejectedFacts ?? []),
          JSON.stringify(input.contributionDimensions),
          input.rationale,
          input.confidenceBand ?? null,
          previous?.id ?? null,
        ],
      );

      const nextClaimStatus =
        input.status === "CONFIRMED"
          ? "ACCEPTED"
          : input.status === "PARTIALLY_CONFIRMED"
            ? "PARTIALLY_ACCEPTED"
            : "REJECTED";
      assertTransition(
        contributionClaimTransitions,
        "ContributionClaim",
        "UNDER_REVIEW",
        nextClaimStatus,
      );
      await client.query(
        `UPDATE contribution_claims
            SET status = $3, version = version + 1
          WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, input.claimId, nextClaimStatus],
      );
      return this.loadDecision(client, id);
  }

  async listDecisions(claimId?: string): Promise<AttributionDecision[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        claimId
          ? "SELECT id FROM attribution_decisions WHERE tenant_id=$1 AND claim_id=$2 ORDER BY decision_version DESC"
          : "SELECT id FROM attribution_decisions WHERE tenant_id=$1 ORDER BY created_at DESC",
        claimId ? [this.tenantId, claimId] : [this.tenantId],
      );
      const decisions = [];
      for (const row of rows) {
        decisions.push(await this.loadDecision(client, row.id));
      }
      return decisions;
    });
  }

  async recordLegalGate(
    input: RecordLegalGateInput,
  ): Promise<LegalGateRecord> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO legal_gate_records
          (id, tenant_id, policy_version_id, democratic_procedure_ref,
           employee_notice_ref, data_protection_assessment_ref,
           minimum_wage_checked, policy_approved, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_id, policy_version_id)
         DO UPDATE SET democratic_procedure_ref = EXCLUDED.democratic_procedure_ref,
                       employee_notice_ref = EXCLUDED.employee_notice_ref,
                       data_protection_assessment_ref = EXCLUDED.data_protection_assessment_ref,
                       minimum_wage_checked = EXCLUDED.minimum_wage_checked,
                       policy_approved = EXCLUDED.policy_approved,
                       recorded_by = EXCLUDED.recorded_by,
                       recorded_at = now()
         RETURNING *`,
        [
          randomUUID(),
          this.tenantId,
          input.policyVersionId,
          input.democraticProcedureRef ?? null,
          input.employeeNoticeRef ?? null,
          input.dataProtectionAssessmentRef ?? null,
          input.minimumWageChecked,
          input.policyApproved,
          input.recordedBy,
        ],
      );
      await this.appendAudit(client, {
        action: "LEGAL_GATE_RECORDED",
        objectType: "POLICY_VERSION",
        objectId: input.policyVersionId,
        actorType: "USER",
        actorId: input.recordedBy,
        afterHash: sha256({
          policyVersionId: input.policyVersionId,
          policyApproved: input.policyApproved,
          minimumWageChecked: input.minimumWageChecked,
        }),
        reason: input.policyApproved ? "policy approved" : "policy not approved",
      });
      return this.mapLegalGate(rows[0]);
    });
  }

  async getLegalGate(
    policyVersionId: string,
  ): Promise<LegalGateRecord | undefined> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM legal_gate_records
          WHERE tenant_id = $1 AND policy_version_id = $2`,
        [this.tenantId, policyVersionId],
      );
      return rows[0] ? this.mapLegalGate(rows[0]) : undefined;
    });
  }

  private async loadDecision(
    client: PoolClient,
    id: string,
  ): Promise<AttributionDecision> {
    const { rows } = await client.query(
      "SELECT * FROM attribution_decisions WHERE tenant_id=$1 AND id=$2",
      [this.tenantId, id],
    );
    const row = rows[0];
    if (!row) notFound("AttributionDecision", id);
    return {
      id: row.id,
      tenantId: row.tenant_id,
      claimId: row.claim_id,
      decisionVersion: asNumber(row.decision_version),
      status: row.status,
      adjudicatorPersonId: row.adjudicator_person_id,
      acceptedFacts: asJson(row.accepted_facts, []),
      rejectedFacts: asJson(row.rejected_facts, []),
      contributionDimensions: asJson(row.contribution_dimensions, {}),
      rationale: row.rationale,
      confidenceBand: row.confidence_band ?? undefined,
      effectiveAt: iso(row.effective_at)!,
      supersedesId: row.supersedes_id ?? undefined,
      createdAt: iso(row.created_at)!,
    };
  }
}
