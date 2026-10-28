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
  evaluationDraftTransitions,
  legalGateBlockers,
  settlementBatchTransitions,
  workPackageTransitions,
  type AmountLedgerEntry,
  type AppealCase,
  type AuditEvent,
  type AttributionDecision,
  type CalculationInput,
  type CalculationRun,
  type CommitmentSnapshot,
  type ContributionClaim,
  type EmployeeConfirmation,
  type EvaluationDecision,
  type EvaluationDraft,
  type EvidenceLink,
  type EvidenceNode,
  type IngestionBatch,
  type IngestionResult,
  type LegalGateRecord,
  type PolicyDefinition,
  type PolicyVersionSummary,
  type PublishPolicyInput,
  type PublishedPolicy,
  type Rubric,
  type SettlementBatch,
  type SettlementCommandInput,
  type SettlementCommandResult,
  type SettlementLine,
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
  calculateByPolicy,
  parseDecimal,
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
  settlementCsv,
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

  async ping(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  }

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

  async listPolicyVersions(): Promise<PolicyVersionSummary[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT id, policy_code, version, status, effective_from,
                effective_to, content_hash, published_at
           FROM policy_versions
          WHERE tenant_id = $1
          ORDER BY policy_code, version DESC`,
        [this.tenantId],
      );
      return rows.map((row) => ({
        policyVersionId: row.id,
        code: row.policy_code,
        version: asNumber(row.version),
        status: row.status,
        effectiveFrom: iso(row.effective_from),
        effectiveTo: iso(row.effective_to),
        contentHash: row.content_hash,
        publishedAt: iso(row.published_at),
      }));
    });
  }

  async publishPolicy(input: PublishPolicyInput): Promise<PublishedPolicy> {
    return this.tx(async (client) => {
      const policyVersionId = input.policyVersionId ?? randomUUID();
      const contentHash = sha256(input.policy);
      try {
        const { rows: open } = await client.query(
          `SELECT id, effective_from
             FROM policy_versions
            WHERE tenant_id = $1 AND policy_code = $2
              AND effective_to IS NULL AND id <> $3
            ORDER BY effective_from DESC
            LIMIT 1
            FOR UPDATE`,
          [this.tenantId, input.policy.code, policyVersionId],
        );
        if (open[0]) {
          if (
            new Date(input.effectiveFrom).getTime() <=
            new Date(open[0].effective_from).getTime()
          ) {
            throw new ConflictError(
              `effectiveFrom must be after the open version (${iso(open[0].effective_from)})`,
            );
          }
          await client.query(
            `UPDATE policy_versions
                SET effective_to = $1
              WHERE tenant_id = $2 AND id = $3`,
            [input.effectiveFrom, this.tenantId, open[0].id],
          );
        }

        const { rows } = await client.query(
          `INSERT INTO policy_versions
            (id, tenant_id, policy_code, version, scope, status,
             effective_from, rule_ast, rule_schema_version, content_hash,
             approved_by, approved_at, published_at)
           VALUES ($1,$2,$3,$4,$5,'PUBLISHED',$6,$7,'policy-definition/v1',$8,$9,now(),now())
           RETURNING published_at`,
          [
            policyVersionId,
            this.tenantId,
            input.policy.code,
            input.policy.version,
            JSON.stringify(input.scope ?? {}),
            input.effectiveFrom,
            JSON.stringify(input.policy),
            contentHash,
            input.approvedBy,
          ],
        );
        await this.appendAudit(client, {
          action: "POLICY_PUBLISHED",
          objectType: "POLICY_VERSION",
          objectId: policyVersionId,
          actorType: "USER",
          actorId: input.approvedBy,
          afterHash: contentHash,
          reason: `${input.policy.code}:${input.policy.version}`,
        });
        return {
          policyVersionId,
          policy: input.policy,
          contentHash,
          effectiveFrom: input.effectiveFrom,
          publishedAt: iso(rows[0]?.published_at) ?? new Date().toISOString(),
          approvedBy: input.approvedBy,
        };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            `Policy ${input.policy.code}:${input.policy.version} already exists`,
          );
        }
        throw error;
      }
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
      const packages: WorkPackage[] = [];
      for (const row of rows) {
        packages.push(await this.loadWorkPackage(client, row.id));
      }
      return packages;
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

  async listClaims(): Promise<ContributionClaim[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT id FROM contribution_claims WHERE tenant_id=$1 ORDER BY created_at DESC",
        [this.tenantId],
      );
      const claims = [];
      for (const row of rows) {
        claims.push(await this.loadClaim(client, row.id));
      }
      return claims;
    });
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

  async ingestEvents(batch: IngestionBatch): Promise<IngestionResult> {
    return this.tx(async (client) => {
      let accepted = 0;
      let duplicates = 0;
      const evidenceIds: string[] = [];
      for (const event of batch.events) {
        const version = event.sourceEventVersion ?? "1";
        const rawId = randomUUID();
        const inserted = await client.query(
          `INSERT INTO raw_events
            (id, tenant_id, source_system, source_record_id, source_event_version,
             event_type, occurred_at, payload, payload_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id, source_system, source_record_id, source_event_version)
           DO NOTHING
           RETURNING id`,
          [
            rawId,
            this.tenantId,
            batch.sourceSystem,
            event.sourceRecordId,
            version,
            event.eventType,
            event.occurredAt ?? null,
            JSON.stringify(event.payload),
            sha256(event.payload),
          ],
        );
        if (inserted.rowCount === 0) {
          duplicates += 1;
          continue;
        }
        const evidenceId = randomUUID();
        await client.query(
          `INSERT INTO evidence_nodes
            (id, tenant_id, raw_event_id, evidence_type, subject_type, subject_id,
             source_system, source_uri, observed_at, quality_status,
             normalized_payload, payload_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, now()),$10,$11,$12)`,
          [
            evidenceId,
            this.tenantId,
            rawId,
            event.evidenceType,
            event.subjectType,
            event.subjectId,
            batch.sourceSystem,
            event.sourceUri ?? null,
            event.occurredAt ?? null,
            event.qualityStatus ?? "UNVERIFIED",
            JSON.stringify(event.payload),
            sha256(event.payload),
          ],
        );
        accepted += 1;
        evidenceIds.push(evidenceId);
      }
      return { accepted, duplicates, evidenceIds };
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
      const appeals = [];
      for (const row of rows) {
        appeals.push(await this.loadAppeal(client, row.id));
      }
      return appeals;
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

  async createRubric(input: {
    code: string;
    name: string;
    dimensions: string[];
    scoringAnchors: Record<string, unknown>;
    scope?: Record<string, unknown>;
    effectiveFrom: string;
  }): Promise<Rubric> {
    return this.tx(async (client) => {
      const { rows: versionRows } = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS version
           FROM rubrics WHERE tenant_id=$1 AND code=$2`,
        [this.tenantId, input.code],
      );
      const id = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO rubrics
          (id, tenant_id, code, name, dimensions, scoring_anchors, scope,
           status, version, effective_from)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8,$9)
         RETURNING *`,
        [
          id,
          this.tenantId,
          input.code,
          input.name,
          JSON.stringify(input.dimensions),
          JSON.stringify(input.scoringAnchors),
          JSON.stringify(input.scope ?? {}),
          asNumber(versionRows[0]?.version),
          input.effectiveFrom,
        ],
      );
      return this.mapRubric(rows[0]);
    });
  }

  async listRubrics(): Promise<Rubric[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM rubrics WHERE tenant_id=$1 ORDER BY created_at DESC`,
        [this.tenantId],
      );
      return rows.map((row) => this.mapRubric(row));
    });
  }

  async createEvaluationDraft(input: {
    cycleId: string;
    personId: string;
    generatedByType: "AGENT" | "USER" | "SYSTEM";
    generatedById?: string;
    modelProvider?: string;
    modelName?: string;
    promptVersion?: string;
    agentTaskId?: string;
    evidenceSnapshotHash: string;
    draftPayload: Record<string, unknown>;
    strengths?: string[];
    counterEvidence?: string[];
    missingInformation?: string[];
    uncertainty?: Record<string, unknown>;
  }): Promise<EvaluationDraft> {
    return this.tx(async (client) => {
      const id = randomUUID();
      try {
        const { rows } = await client.query(
          `INSERT INTO evaluation_drafts
            (id, tenant_id, cycle_id, person_id, generated_by_type,
             generated_by_id, model_provider, model_name, prompt_version,
             agent_task_id, evidence_snapshot_hash, draft_payload, strengths,
             counter_evidence, missing_information, uncertainty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           RETURNING *`,
          [
            id,
            this.tenantId,
            input.cycleId,
            input.personId,
            input.generatedByType,
            input.generatedById ?? null,
            input.modelProvider ?? null,
            input.modelName ?? null,
            input.promptVersion ?? null,
            input.agentTaskId ?? null,
            input.evidenceSnapshotHash,
            JSON.stringify(input.draftPayload),
            JSON.stringify(input.strengths ?? []),
            JSON.stringify(input.counterEvidence ?? []),
            JSON.stringify(input.missingInformation ?? []),
            JSON.stringify(input.uncertainty ?? {}),
          ],
        );
        return this.mapEvaluationDraft(rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23503") {
          throw new ConflictError("EVALUATION_REFERENCE_NOT_FOUND");
        }
        throw error;
      }
    });
  }

  async getEvaluationDraft(id: string): Promise<EvaluationDraft> {
    return this.tx((client) => this.loadEvaluationDraft(client, id));
  }

  async listEvaluationDrafts(filter?: {
    cycleId?: string;
    personId?: string;
  }): Promise<EvaluationDraft[]> {
    return this.tx(async (client) => {
      const conditions = ["tenant_id=$1"];
      const values: unknown[] = [this.tenantId];
      if (filter?.cycleId) {
        values.push(filter.cycleId);
        conditions.push(`cycle_id=$${values.length}`);
      }
      if (filter?.personId) {
        values.push(filter.personId);
        conditions.push(`person_id=$${values.length}`);
      }
      const { rows } = await client.query(
        `SELECT * FROM evaluation_drafts
          WHERE ${conditions.join(" AND ")}
          ORDER BY created_at DESC`,
        values,
      );
      return rows.map((row) => this.mapEvaluationDraft(row));
    });
  }

  async submitEvaluationDraft(id: string): Promise<EvaluationDraft> {
    return this.tx(async (client) => {
      const draft = await this.loadEvaluationDraft(client, id);
      assertTransition(
        evaluationDraftTransitions,
        "EvaluationDraft",
        draft.status,
        "SUBMITTED",
      );
      await client.query(
        `UPDATE evaluation_drafts
            SET status='SUBMITTED', updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, id],
      );
      return this.loadEvaluationDraft(client, id);
    });
  }

  async decideEvaluationDraft(
    id: string,
    input: {
      reviewerPersonId: string;
      rubricVersionId: string;
      decision: "APPROVE" | "REJECT";
      scores: Record<string, number>;
      rationale: string;
    },
  ): Promise<{ draft: EvaluationDraft; decision?: EvaluationDecision }> {
    return this.tx(async (client) => {
      const draft = await this.loadEvaluationDraft(client, id);
      assertTransition(
        evaluationDraftTransitions,
        "EvaluationDraft",
        draft.status,
        input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      );
      if (input.reviewerPersonId === draft.personId) {
        throw new ConflictError("SELF_REVIEW_FORBIDDEN");
      }
      const rubric = await this.loadRubric(client, input.rubricVersionId);
      if (input.decision === "REJECT") {
        await client.query(
          `UPDATE evaluation_drafts
              SET status='REJECTED', updated_at=now()
            WHERE tenant_id=$1 AND id=$2`,
          [this.tenantId, id],
        );
        return { draft: await this.loadEvaluationDraft(client, id) };
      }
      if (Object.keys(input.scores).length === 0) {
        throw new ConflictError("EVALUATION_SCORES_REQUIRED");
      }
      for (const dimension of rubric.dimensions) {
        if (!(dimension in input.scores)) {
          throw new ConflictError(`EVALUATION_DIMENSION_MISSING: ${dimension}`);
        }
      }

      const { rows: priorRows } = await client.query(
        `SELECT * FROM evaluation_decisions
          WHERE tenant_id=$1 AND cycle_id=$2 AND person_id=$3
          ORDER BY decision_version DESC
          FOR UPDATE`,
        [this.tenantId, draft.cycleId, draft.personId],
      );
      const latest = priorRows[0];
      await client.query(
        `UPDATE evaluation_decisions
            SET status='SUPERSEDED'
          WHERE tenant_id=$1 AND cycle_id=$2 AND person_id=$3
            AND status='APPROVED'`,
        [this.tenantId, draft.cycleId, draft.personId],
      );
      const decisionId = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO evaluation_decisions
          (id, tenant_id, cycle_id, person_id, decision_version, status,
           rubric_version_id, evidence_snapshot_hash, scores, rationale,
           reviewer_person_id, approved_at, supersedes_id)
         VALUES ($1,$2,$3,$4,$5,'APPROVED',$6,$7,$8,$9,$10,now(),$11)
         RETURNING *`,
        [
          decisionId,
          this.tenantId,
          draft.cycleId,
          draft.personId,
          latest ? asNumber(latest.decision_version) + 1 : 1,
          input.rubricVersionId,
          draft.evidenceSnapshotHash,
          JSON.stringify(input.scores),
          input.rationale,
          input.reviewerPersonId,
          latest?.id ?? null,
        ],
      );
      await client.query(
        `UPDATE evaluation_drafts
            SET status='APPROVED', updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, id],
      );
      await this.appendAudit(client, {
        action: "EVALUATION_DECISION_RECORDED",
        objectType: "EVALUATION_DECISION",
        objectId: decisionId,
        actorType: "USER",
        actorId: input.reviewerPersonId,
        afterHash: sha256({
          cycleId: draft.cycleId,
          personId: draft.personId,
          scores: input.scores,
          version: rows[0]?.decision_version,
        }),
        reason: `cycle ${draft.cycleId}`,
      });
      return {
        draft: await this.loadEvaluationDraft(client, id),
        decision: this.mapEvaluationDecision(rows[0]),
      };
    });
  }

  async listEvaluationDecisions(filter?: {
    cycleId?: string;
    personId?: string;
  }): Promise<EvaluationDecision[]> {
    return this.tx(async (client) => {
      const conditions = ["tenant_id=$1"];
      const values: unknown[] = [this.tenantId];
      if (filter?.cycleId) {
        values.push(filter.cycleId);
        conditions.push(`cycle_id=$${values.length}`);
      }
      if (filter?.personId) {
        values.push(filter.personId);
        conditions.push(`person_id=$${values.length}`);
      }
      const { rows } = await client.query(
        `SELECT * FROM evaluation_decisions
          WHERE ${conditions.join(" AND ")}
          ORDER BY created_at DESC`,
        values,
      );
      return rows.map((row) => this.mapEvaluationDecision(row));
    });
  }

  async getEvaluationDecision(id: string): Promise<EvaluationDecision> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM evaluation_decisions WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, id],
      );
      if (!rows[0]) notFound("EvaluationDecision", id);
      return this.mapEvaluationDecision(rows[0]);
    });
  }

  private async loadRubric(client: PoolClient, id: string): Promise<Rubric> {
    const { rows } = await client.query(
      `SELECT * FROM rubrics WHERE tenant_id=$1 AND id=$2`,
      [this.tenantId, id],
    );
    if (!rows[0]) notFound("Rubric", id);
    return this.mapRubric(rows[0]);
  }

  private async loadEvaluationDraft(
    client: PoolClient,
    id: string,
  ): Promise<EvaluationDraft> {
    const { rows } = await client.query(
      `SELECT * FROM evaluation_drafts WHERE tenant_id=$1 AND id=$2`,
      [this.tenantId, id],
    );
    if (!rows[0]) notFound("EvaluationDraft", id);
    return this.mapEvaluationDraft(rows[0]);
  }

  private mapRubric(row: QueryResultRow): Rubric {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      name: row.name,
      dimensions: asJson<string[]>(row.dimensions, []),
      scoringAnchors: asJson<Record<string, unknown>>(row.scoring_anchors, {}),
      scope: asJson<Record<string, unknown>>(row.scope, {}),
      status: row.status,
      version: asNumber(row.version),
      effectiveFrom: String(row.effective_from),
      effectiveTo: row.effective_to ? String(row.effective_to) : undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapEvaluationDraft(row: QueryResultRow): EvaluationDraft {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      personId: row.person_id,
      generatedByType: row.generated_by_type,
      generatedById: row.generated_by_id ?? undefined,
      modelProvider: row.model_provider ?? undefined,
      modelName: row.model_name ?? undefined,
      promptVersion: row.prompt_version ?? undefined,
      agentTaskId: row.agent_task_id ?? undefined,
      evidenceSnapshotHash: row.evidence_snapshot_hash,
      draftPayload: asJson<Record<string, unknown>>(row.draft_payload, {}),
      strengths: asJson<string[]>(row.strengths, []),
      counterEvidence: asJson<string[]>(row.counter_evidence, []),
      missingInformation: asJson<string[]>(row.missing_information, []),
      uncertainty: asJson<Record<string, unknown>>(row.uncertainty, {}),
      status: row.status,
      version: asNumber(row.version),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapEvaluationDecision(row: QueryResultRow): EvaluationDecision {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      cycleId: row.cycle_id,
      personId: row.person_id,
      decisionVersion: asNumber(row.decision_version),
      status: row.status,
      rubricVersionId: row.rubric_version_id,
      evidenceSnapshotHash: row.evidence_snapshot_hash,
      scores: asJson<Record<string, number>>(row.scores, {}),
      rationale: row.rationale,
      reviewerPersonId: row.reviewer_person_id,
      approvedAt: iso(row.approved_at),
      supersedesId: row.supersedes_id ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  async createSettlementBatch(input: {
    cycleId: string;
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
              SELECT 1
                FROM settlement_lines sl
               WHERE sl.tenant_id = $1
                 AND sl.ledger_id = al.id
                 AND sl.active
            )
          ORDER BY al.ledger_seq`,
        [this.tenantId, input.cycleId],
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
      try {
        await client.query(
          `INSERT INTO settlement_batches
            (id, tenant_id, cycle_id, batch_no, status, currency)
           VALUES ($1,$2,$3,$4,'DRAFT',$5)`,
          [id, this.tenantId, input.cycleId, batchNo, currency],
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
      const batch = await this.loadSettlementBatch(client, id);
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
        case "SUBMIT":
          transition("PENDING_APPROVAL");
          if (parseDecimal(batch.totalAmount) <= 0n) {
            throw new ConflictError(
              "EMPTY_SETTLEMENT: batch total must be positive",
            );
          }
          await this.setSettlementStatus(client, id, "PENDING_APPROVAL");
          break;
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
        case "LOCK":
          transition("LOCKED");
          await client.query(
            `UPDATE settlement_batches
                SET status='LOCKED', locked_at=now(), updated_at=now()
              WHERE tenant_id=$1 AND id=$2`,
            [this.tenantId, id],
          );
          break;
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
        reason: input.externalReference ?? input.command,
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
  ): Promise<SettlementBatch> {
    const { rows } = await client.query(
      `SELECT * FROM settlement_batches WHERE tenant_id=$1 AND id=$2`,
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
      `SELECT * FROM settlement_lines
        WHERE tenant_id=$1 AND batch_id=$2
        ORDER BY created_at, id`,
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
      amount: trimAmount(normalizeAmount(String(row.amount))),
      currency: String(row.currency).trim(),
      status: row.status,
      active: Boolean(row.active),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private async appendAudit(
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

  async listAuditEvents(limit = 100): Promise<AuditEvent[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM audit_events
          WHERE tenant_id = $1
          ORDER BY sequence DESC
          LIMIT $2`,
        [this.tenantId, Math.max(1, Math.min(limit, 500))],
      );
      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        sequence: Number(row.sequence),
        actorType: row.actor_type,
        actorId: row.actor_id ?? undefined,
        action: row.action,
        objectType: row.object_type,
        objectId: row.object_id ?? undefined,
        beforeHash: row.before_hash ?? undefined,
        afterHash: row.after_hash ?? undefined,
        reason: row.reason ?? undefined,
        correlationId: row.correlation_id,
        occurredAt: iso(row.occurred_at) ?? new Date().toISOString(),
        prevHash: row.prev_hash,
        eventHash: row.event_hash,
      }));
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
