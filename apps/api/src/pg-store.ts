import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  appealCaseTransitions,
  assertAdjudicatorIsNotClaimant,
  assertTransition,
  attributionDecisionTransitions,
  calculationRunTransitions,
  confirmationBlockers,
  contributionClaimTransitions,
  legalGateBlockers,
  workPackageTransitions,
  type AmountLedgerEntry,
  type AppealCase,
  type AttributionDecision,
  type CalculationInput,
  type CalculationRun,
  type CommitmentSnapshot,
  type ContributionClaim,
  type EmployeeConfirmation,
  type EvidenceLink,
  type EvidenceNode,
  type LegalGateRecord,
  type PolicyDefinition,
  type WorkPackage,
} from "@anari/domain";
import type {
  CreateAttributionDecisionInput,
  CreateCalculationRunInput,
  CreateContributionClaimInput,
  CreateEvidenceInput,
  CreateEvidenceLinkInput,
  CreateWorkPackageInput,
} from "@anari/contracts";
import { hashLedgerEntry } from "@anari/ledger";
import {
  PolicyGateError,
  calculateChargingEquipmentSales,
  calculateChargingProjectContribution,
  calculateOrderContribution,
  sha256,
} from "@anari/policy-dsl";
import type {
  IncentiveStore,
  RecordConfirmationInput,
  RecordLegalGateInput,
  ResolveAppealInput,
} from "./store-interface.js";
import {
  CalculationBlockedError,
  ConflictError,
  NotFoundError,
} from "./store.js";

export const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_REQUESTER_ID = "00000000-0000-4000-8000-000000000003";

function iso(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function notFound(kind: string, id: string): never {
  throw new NotFoundError(`${kind} ${id} not found`);
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function asJson<T>(value: unknown, fallback: T): T {
  return (value ?? fallback) as T;
}

/** Canonical 6-decimal money string, matching PostgreSQL numeric(20,6). */
function normalizeAmount(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const normalized = `${whole}.${(fraction + "000000").slice(0, 6)}`;
  return negative ? `-${normalized}` : normalized;
}

/** Human/API-facing amount: drop trailing zeros, e.g. 20520.000000 -> 20520. */
function trimAmount(value: string): string {
  const [whole, fraction] = value.split(".");
  if (!fraction) return value;
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole!;
}

export class PgStore implements IncentiveStore {
  constructor(
    private readonly pool: Pool,
    private readonly tenantId: string = DEMO_TENANT_ID,
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

  async getPolicy(policyVersionId: string): Promise<PolicyDefinition> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT rule_ast FROM policy_versions WHERE tenant_id = $1 AND id = $2",
        [this.tenantId, policyVersionId],
      );
      if (!rows[0]) notFound("Policy", policyVersionId);
      return rows[0].rule_ast as PolicyDefinition;
    });
  }

  async createWorkPackage(
    input: CreateWorkPackageInput,
  ): Promise<WorkPackage> {
    return this.tx(async (client) => {
      const id = randomUUID();
      await client.query(
        `INSERT INTO work_packages
          (id, tenant_id, source_object_type, source_object_id, title, objective,
           owner_person_id, status, acceptance_criteria, due_at)
         VALUES ($1,$2,'ORDER',$3,$4,$5,$6,'DRAFT',$7,$8)`,
        [
          id,
          this.tenantId,
          randomUUID(),
          input.title,
          input.objective,
          input.ownerPersonId,
          JSON.stringify(input.acceptanceCriteria),
          input.dueAt ?? null,
        ],
      );
      for (const member of input.members) {
        await client.query(
          `INSERT INTO work_package_members
            (tenant_id, work_package_id, person_id, responsibility_code,
             expected_output, active_from)
           VALUES ($1,$2,$3,$4,$5,now())`,
          [
            this.tenantId,
            id,
            member.personId,
            member.responsibilityCode,
            member.expectedOutput,
          ],
        );
      }
      return this.loadWorkPackage(client, id);
    });
  }

  async getWorkPackage(id: string): Promise<WorkPackage> {
    return this.tx((client) => this.loadWorkPackage(client, id));
  }

  async listWorkPackages(): Promise<WorkPackage[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT id FROM work_packages WHERE tenant_id = $1 ORDER BY created_at DESC",
        [this.tenantId],
      );
      return Promise.all(rows.map((row) => this.loadWorkPackage(client, row.id)));
    });
  }

  async commitWorkPackage(
    id: string,
    expectedVersion: number,
  ): Promise<WorkPackage> {
    return this.tx(async (client) => {
      const current = await this.loadWorkPackage(client, id);
      if (current.version !== expectedVersion) {
        throw new ConflictError(
          `expected version ${expectedVersion}, actual ${current.version}`,
        );
      }
      assertTransition(
        workPackageTransitions,
        "WorkPackage",
        current.status,
        "COMMITTED",
      );
      const snapshot: CommitmentSnapshot = {
        snapshotId: randomUUID(),
        workPackageId: current.id,
        capturedAt: new Date().toISOString(),
        title: current.title,
        objective: current.objective,
        ownerPersonId: current.ownerPersonId,
        members: structuredClone(current.members),
        acceptanceCriteria: [...current.acceptanceCriteria],
        dueAt: current.dueAt,
        contentHash: sha256({
          title: current.title,
          objective: current.objective,
          ownerPersonId: current.ownerPersonId,
          members: current.members,
          acceptanceCriteria: current.acceptanceCriteria,
          dueAt: current.dueAt,
        }),
      };
      const nextVersion = current.version + 1;
      await client.query(
        `INSERT INTO work_package_versions
          (id, tenant_id, work_package_id, version, snapshot, content_hash,
           captured_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          snapshot.snapshotId,
          this.tenantId,
          current.id,
          nextVersion,
          JSON.stringify(snapshot),
          snapshot.contentHash,
          current.ownerPersonId,
        ],
      );
      await client.query(
        `UPDATE work_packages
            SET status = 'COMMITTED', current_snapshot_id = $3, version = $4
          WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, id, snapshot.snapshotId, nextVersion],
      );
      return this.loadWorkPackage(client, id);
    });
  }

  async startWorkPackage(id: string): Promise<WorkPackage> {
    return this.transitionWorkPackage(id, "IN_PROGRESS");
  }

  async submitWorkPackage(id: string): Promise<WorkPackage> {
    return this.transitionWorkPackage(id, "SUBMITTED");
  }

  async acceptWorkPackage(
    id: string,
    reviewerPersonId: string,
  ): Promise<WorkPackage> {
    return this.tx(async (client) => {
      const current = await this.loadWorkPackage(client, id);
      if (reviewerPersonId === current.ownerPersonId) {
        throw new ConflictError(
          "the work-package owner cannot accept their own delivery",
        );
      }
      assertTransition(
        workPackageTransitions,
        "WorkPackage",
        current.status,
        "ACCEPTED",
      );
      await client.query(
        `UPDATE work_packages
            SET status = 'ACCEPTED', version = version + 1
          WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, id],
      );
      return this.loadWorkPackage(client, id);
    });
  }

  async rejectWorkPackage(
    id: string,
    reviewerPersonId: string,
    reason: string,
  ): Promise<WorkPackage> {
    return this.tx(async (client) => {
      const current = await this.loadWorkPackage(client, id);
      if (reviewerPersonId === current.ownerPersonId) {
        throw new ConflictError(
          "the work-package owner cannot reject their own delivery",
        );
      }
      assertTransition(
        workPackageTransitions,
        "WorkPackage",
        current.status,
        "REJECTED",
      );
      await client.query(
        `UPDATE work_packages
            SET status = 'REJECTED', version = version + 1
          WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, id],
      );
      void reason;
      return this.loadWorkPackage(client, id);
    });
  }

  async createClaim(
    input: CreateContributionClaimInput,
  ): Promise<ContributionClaim> {
    return this.tx(async (client) => {
      const wp = await this.loadWorkPackage(client, input.workPackageId);
      if (wp.status !== "ACCEPTED") {
        throw new ConflictError(
          "a contribution claim requires an accepted work package",
        );
      }
      if (!wp.commitmentSnapshot) {
        throw new ConflictError(
          "a contribution claim requires a frozen commitment snapshot",
        );
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO contribution_claims
          (id, tenant_id, work_package_id, claimant_person_id, claim_type,
           claimed_contribution, rationale, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT')`,
        [
          id,
          this.tenantId,
          input.workPackageId,
          input.claimantPersonId,
          input.claimType,
          JSON.stringify(input.claimedContribution),
          input.rationale,
        ],
      );
      for (const evidenceRef of input.evidenceRefs ?? []) {
        await client.query(
          `INSERT INTO claim_evidence_links
            (tenant_id, claim_id, evidence_ref, link_role)
           VALUES ($1,$2,$3,'SUPPORTING')`,
          [this.tenantId, id, evidenceRef],
        );
      }
      return this.loadClaim(client, id);
    });
  }

  async getClaim(id: string): Promise<ContributionClaim> {
    return this.tx((client) => this.loadClaim(client, id));
  }

  async submitClaim(id: string): Promise<ContributionClaim> {
    return this.tx(async (client) => {
      const claim = await this.loadClaim(client, id);
      assertTransition(
        contributionClaimTransitions,
        "ContributionClaim",
        claim.status,
        "SUBMITTED",
      );
      await client.query(
        `UPDATE contribution_claims
            SET status = 'SUBMITTED', submitted_at = now(), version = version + 1
          WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, id],
      );
      return this.loadClaim(client, id);
    });
  }

  async createAttributionDecision(
    input: CreateAttributionDecisionInput,
  ): Promise<AttributionDecision> {
    return this.tx(async (client) => {
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
    });
  }

  async listDecisions(claimId?: string): Promise<AttributionDecision[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        claimId
          ? "SELECT id FROM attribution_decisions WHERE tenant_id=$1 AND claim_id=$2 ORDER BY decision_version DESC"
          : "SELECT id FROM attribution_decisions WHERE tenant_id=$1 ORDER BY created_at DESC",
        claimId ? [this.tenantId, claimId] : [this.tenantId],
      );
      return Promise.all(rows.map((row) => this.loadDecision(client, row.id)));
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

  async createEvidence(input: CreateEvidenceInput): Promise<EvidenceNode> {
    return this.tx(async (client) => {
      const id = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO evidence_nodes
          (id, tenant_id, evidence_type, subject_type, subject_id,
           source_system, source_uri, observed_at, quality_status,
           normalized_payload, payload_hash, supersedes_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, now()),$9,$10,$11,$12)
         RETURNING *`,
        [
          id,
          this.tenantId,
          input.evidenceType,
          input.subjectType,
          input.subjectId,
          input.sourceSystem,
          input.sourceUri ?? null,
          input.observedAt ?? null,
          input.qualityStatus ?? "UNVERIFIED",
          JSON.stringify(input.normalizedPayload),
          sha256(input.normalizedPayload),
          input.supersedesId ?? null,
        ],
      );
      return this.mapEvidence(rows[0]);
    });
  }

  async listEvidence(
    subjectType?: string,
    subjectId?: string,
  ): Promise<EvidenceNode[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM evidence_nodes
          WHERE tenant_id=$1
            AND ($2::text IS NULL OR subject_type=$2)
            AND ($3::uuid IS NULL OR subject_id=$3)
          ORDER BY observed_at DESC`,
        [this.tenantId, subjectType ?? null, subjectId ?? null],
      );
      return rows.map((row) => this.mapEvidence(row));
    });
  }

  async linkEvidence(
    fromEvidenceId: string,
    input: CreateEvidenceLinkInput,
  ): Promise<EvidenceLink> {
    return this.tx(async (client) => {
      const id = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO evidence_links
          (id, tenant_id, from_evidence_id, to_evidence_id, relation_type, rationale)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, from_evidence_id, to_evidence_id, relation_type)
         DO UPDATE SET rationale = COALESCE(EXCLUDED.rationale, evidence_links.rationale)
         RETURNING *`,
        [
          id,
          this.tenantId,
          fromEvidenceId,
          input.toEvidenceId,
          input.relationType,
          input.rationale ?? null,
        ],
      );
      return this.mapEvidenceLink(rows[0]);
    });
  }

  async listEvidenceLinks(evidenceId: string): Promise<EvidenceLink[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM evidence_links
          WHERE tenant_id=$1
            AND (from_evidence_id=$2 OR to_evidence_id=$2)
          ORDER BY created_at`,
        [this.tenantId, evidenceId],
      );
      return rows.map((row) => this.mapEvidenceLink(row));
    });
  }

  async createCalculationRun(
    input: CreateCalculationRunInput,
  ): Promise<CalculationRun> {
    return this.tx(async (client) => {
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
        participants: input.participants,
        legalGate: gate,
      };
      let result;
      try {
        result =
          policy.code === "CHARGING_EQUIPMENT_SALES_V1"
            ? calculateChargingEquipmentSales(policy, calculationInput)
            : policy.code === "CHARGING_PROJECT_CONTRIBUTION_V1"
              ? calculateChargingProjectContribution(policy, calculationInput)
              : calculateOrderContribution(policy, calculationInput);
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
          DEMO_REQUESTER_ID,
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
            ORDER BY created_at DESC, id DESC
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
    });
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
      return Promise.all(rows.map((row) => this.loadRun(client, row.id)));
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

  async createAppeal(input: {
    appellantPersonId: string;
    targetType: "ATTRIBUTION" | "EVALUATION" | "LEDGER" | "CALCULATION";
    targetId: string;
    reasonCode: string;
    statement: string;
  }): Promise<AppealCase> {
    return this.tx(async (client) => {
      const id = randomUUID();
      await client.query(
        `INSERT INTO appeal_cases
          (id, tenant_id, appellant_person_id, target_type, target_id,
           appeal_reason_code, statement, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN')`,
        [
          id,
          this.tenantId,
          input.appellantPersonId,
          input.targetType,
          input.targetId,
          input.reasonCode,
          input.statement,
        ],
      );
      return this.loadAppeal(client, id);
    });
  }

  async getAppeal(id: string): Promise<AppealCase> {
    return this.tx((client) => this.loadAppeal(client, id));
  }

  async listAppeals(): Promise<AppealCase[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT id FROM appeal_cases WHERE tenant_id=$1 ORDER BY created_at DESC",
        [this.tenantId],
      );
      return Promise.all(rows.map((row) => this.loadAppeal(client, row.id)));
    });
  }

  async triageAppeal(
    id: string,
    reviewerPersonId: string,
  ): Promise<AppealCase> {
    return this.tx(async (client) => {
      const appeal = await this.loadAppeal(client, id);
      if (reviewerPersonId === appeal.appellantPersonId) {
        throw new ConflictError("the appellant cannot triage their own appeal");
      }
      assertTransition(
        appealCaseTransitions,
        "AppealCase",
        appeal.status,
        "TRIAGED",
      );
      await client.query(
        "UPDATE appeal_cases SET status='TRIAGED', reviewer_person_id=$3 WHERE tenant_id=$1 AND id=$2",
        [this.tenantId, id, reviewerPersonId],
      );
      return this.loadAppeal(client, id);
    });
  }

  async reviewAppeal(id: string): Promise<AppealCase> {
    return this.tx(async (client) => {
      const appeal = await this.loadAppeal(client, id);
      assertTransition(
        appealCaseTransitions,
        "AppealCase",
        appeal.status,
        "UNDER_REVIEW",
      );
      await client.query(
        "UPDATE appeal_cases SET status='UNDER_REVIEW' WHERE tenant_id=$1 AND id=$2",
        [this.tenantId, id],
      );
      return this.loadAppeal(client, id);
    });
  }

  async resolveAppeal(
    id: string,
    input: ResolveAppealInput,
  ): Promise<AppealCase> {
    return this.tx(async (client) => {
      const appeal = await this.loadAppeal(client, id);
      if (
        input.reviewerPersonId === appeal.appellantPersonId ||
        (appeal.reviewerPersonId &&
          input.reviewerPersonId !== appeal.reviewerPersonId)
      ) {
        throw new ConflictError(
          "the appellant or a different reviewer cannot resolve this appeal",
        );
      }
      assertTransition(
        appealCaseTransitions,
        "AppealCase",
        appeal.status,
        "DECIDED",
      );
      const nextStatus =
        input.resolution === "CHANGE" ? "RECALCULATION_REQUIRED" : "CLOSED";
      assertTransition(
        appealCaseTransitions,
        "AppealCase",
        "DECIDED",
        nextStatus,
      );
      await client.query(
        `UPDATE appeal_cases
            SET status=$3, resolution=$4, resolved_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [
          this.tenantId,
          id,
          nextStatus,
          `${input.resolution}: ${input.rationale}`,
        ],
      );
      return this.loadAppeal(client, id);
    });
  }

  async listLedger(tenantId = this.tenantId): Promise<AmountLedgerEntry[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM amount_ledger WHERE tenant_id=$1 ORDER BY created_at, id",
        [tenantId],
      );
      return rows.map((row) => this.mapLedger(row));
    });
  }

  async verifyLedger(tenantId = this.tenantId): Promise<boolean> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM amount_ledger WHERE tenant_id=$1 ORDER BY created_at, id",
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

  private async loadWorkPackage(
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

  private async loadClaim(
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

  private async loadConfirmationsForRun(
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
    }
  }

  private async loadAppeal(
    client: PoolClient,
    id: string,
  ): Promise<AppealCase> {
    const { rows } = await client.query(
      "SELECT * FROM appeal_cases WHERE tenant_id=$1 AND id=$2",
      [this.tenantId, id],
    );
    const row = rows[0];
    if (!row) notFound("AppealCase", id);
    return {
      id: row.id,
      tenantId: row.tenant_id,
      appellantPersonId: row.appellant_person_id,
      targetType: row.target_type,
      targetId: row.target_id,
      reasonCode: row.appeal_reason_code,
      statement: row.statement,
      status: row.status,
      reviewerPersonId: row.reviewer_person_id ?? undefined,
      resolution: row.resolution ?? undefined,
      createdAt: iso(row.created_at)!,
      resolvedAt: iso(row.resolved_at),
    };
  }

  private mapEvidence(row: QueryResultRow): EvidenceNode {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      evidenceType: row.evidence_type,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      sourceSystem: row.source_system,
      sourceUri: row.source_uri ?? undefined,
      observedAt: iso(row.observed_at)!,
      qualityStatus: row.quality_status,
      normalizedPayload: asJson(row.normalized_payload, {}),
      payloadHash: row.payload_hash,
      supersedesId: row.supersedes_id ?? undefined,
      createdAt: iso(row.created_at)!,
    };
  }

  private mapEvidenceLink(row: QueryResultRow): EvidenceLink {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      fromEvidenceId: row.from_evidence_id,
      toEvidenceId: row.to_evidence_id,
      relationType: row.relation_type,
      rationale: row.rationale ?? undefined,
      createdAt: iso(row.created_at)!,
    };
  }

  private mapLegalGate(row: QueryResultRow): LegalGateRecord {
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

  private mapConfirmation(row: QueryResultRow): EmployeeConfirmation {
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

  private async transitionWorkPackage(
    id: string,
    target: "IN_PROGRESS" | "SUBMITTED",
  ): Promise<WorkPackage> {
    return this.tx(async (client) => {
      const current = await this.loadWorkPackage(client, id);
      assertTransition(
        workPackageTransitions,
        "WorkPackage",
        current.status,
        target,
      );
      await client.query(
        `UPDATE work_packages SET status=$3, version=version+1
          WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, id, target],
      );
      return this.loadWorkPackage(client, id);
    });
  }
}
