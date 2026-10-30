import { randomUUID } from "node:crypto";
import {
  appealCaseTransitions,
  assertAdjudicatorIsNotClaimant,
  assertPolicyApplicability,
  assertTransition,
  attributionDecisionTransitions,
  calculationRunTransitions,
  confirmationBlockers,
  contributionClaimTransitions,
  dataQualityIssueTransitions,
  evaluationDraftTransitions,
  legalGateBlockers,
  settlementBatchTransitions,
  workPackageTransitions,
  type AmountLedgerEntry,
  type AdjustmentRecord,
  type AppealCase,
  type AuditEvent,
  type AttributionDecision,
  type CalculationInput,
  type CalculationRun,
  type CommitmentSnapshot,
  type ContributionClaim,
  type DataQualityIssue,
  type EmployeeConfirmation,
  type EvaluationCycle,
  type EvaluationDecision,
  type EvaluationDraft,
  type EvidenceLink,
  type EvidenceNode,
  type InAppNotification,
  type IngestionBatch,
  type IngestionResult,
  type LegalGateRecord,
  type PolicyDefinition,
  type PolicyVersionDetail,
  type PolicyVersionSummary,
  type PublishPolicyInput,
  type PublishedPolicy,
  type RecalculationRequest,
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
import { InMemoryLedger } from "@anari/ledger";
import {
  PolicyGateError,
  calculateByPolicy,
  deriveEvaluationMultiplier,
  formatDecimal,
  parseDecimal,
  sha256,
  sum,
} from "@anari/policy-dsl";
import type {
  IncentiveStore,
  RecordConfirmationInput,
  RecordLegalGateInput,
  ResolveAppealInput,
} from "./store-interface.js";
import { policies } from "./policy-registry.js";

export const DEFAULT_TENANT_ID = "tenant-demo";
export const DEMO_CYCLE_ID = "00000000-0000-4000-8000-000000000020";

export class NotFoundError extends Error {
  readonly code = "RESOURCE_NOT_FOUND";
  constructor(message: string) {
    super(message);
  }
}

export class ConflictError extends Error {
  readonly code = "CONFLICT";
  constructor(message: string) {
    super(message);
  }
}

export class CalculationBlockedError extends Error {
  readonly code = "CALCULATION_BLOCKED";
  constructor(readonly blockers: string[]) {
    super(`Calculation blocked: ${blockers.join(", ")}`);
  }
}

function now(): string {
  return new Date().toISOString();
}

function notFound(kind: string, id: string): never {
  throw new NotFoundError(`${kind} ${id} not found`);
}

function csvField(value: unknown, protectFormula = true): string {
  let text = value === undefined || value === null ? "" : String(value);
  if (protectFormula && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function settlementCsv(
  batch: SettlementBatch,
  lines: SettlementLine[],
): string {
  const header =
    "batch_no,person_id,employee_code,person_name,ledger_id,amount,currency";
  const rows = lines
    .filter((line) => line.active)
    .map((line) =>
      [
        batch.batchNo,
        line.personId,
        line.personCode,
        line.personName,
        line.ledgerId,
        line.amount,
        line.currency,
      ]
        .map((value, index) => csvField(value, index !== 5))
        .join(","),
    );
  return [header, ...rows].join("\n") + "\n";
}

/**
 * In-memory implementation used by the API tests and local demos. The
 * PostgreSQL implementation (`PgStore`) must expose the same behaviour.
 */
export class Store implements IncentiveStore {
  readonly ledger = new InMemoryLedger();
  private readonly workPackages = new Map<string, WorkPackage>();
  private readonly workPackageSnapshots = new Map<
    string,
    CommitmentSnapshot[]
  >();
  private readonly claims = new Map<string, ContributionClaim>();
  private readonly decisions = new Map<string, AttributionDecision>();
  private readonly runs = new Map<string, CalculationRun>();
  private readonly appeals = new Map<string, AppealCase>();
  private readonly recalculations = new Map<string, RecalculationRequest>();
  private readonly adjustmentRecords = new Map<string, AdjustmentRecord>();
  private readonly legalGates = new Map<string, LegalGateRecord>();
  private readonly confirmations = new Map<string, EmployeeConfirmation>();
  private readonly evidence = new Map<string, EvidenceNode>();
  private readonly evidenceLinks = new Map<string, EvidenceLink>();
  private readonly ingestedKeys = new Set<string>();
  private readonly publishedPolicies = new Map<string, PolicyDefinition>();
  private readonly publishedPolicyKeys = new Set<string>();
  private readonly publishedPolicyScopes = new Map<
    string,
    Record<string, unknown>
  >();
  private readonly policyWindows = new Map<
    string,
    { effectiveFrom?: string; effectiveTo?: string }
  >();
  private readonly publishedPolicySummaries = new Map<
    string,
    PolicyVersionSummary
  >();
  private readonly settlementBatches = new Map<string, SettlementBatch>();
  private readonly settlementLines = new Map<string, SettlementLine[]>();
  private readonly rubrics = new Map<string, Rubric>();
  private readonly evaluationCycles = new Map<string, EvaluationCycle>();
  private readonly dataQualityIssues = new Map<string, DataQualityIssue>();
  private readonly notifications = new Map<string, InAppNotification>();
  private readonly evaluationDrafts = new Map<string, EvaluationDraft>();
  private readonly evaluationDecisions = new Map<string, EvaluationDecision>();

  constructor(private readonly tenantId: string = DEFAULT_TENANT_ID) {
    const timestamp = now();
    this.evaluationCycles.set(DEMO_CYCLE_ID, {
      id: DEMO_CYCLE_ID,
      tenantId: this.tenantId,
      name: "2026 Q4 demo cycle",
      cycleType: "MONTHLY",
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-10-31T23:59:59.000Z",
      timezone: "Asia/Shanghai",
      status: "COLLECTING",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async ping(): Promise<void> {
    return;
  }

  private fixturePolicySummary(
    id: string,
    policy: PolicyDefinition,
  ): PolicyVersionSummary {
    const window = this.policyWindows.get(id);
    return {
      policyVersionId: id,
      code: policy.code,
      version: policy.version,
      status: "PUBLISHED",
      effectiveFrom: window?.effectiveFrom,
      effectiveTo: window?.effectiveTo,
    };
  }

  private openPolicyVersion(code: string): PolicyVersionSummary | undefined {
    const candidates = [
      ...[...this.publishedPolicySummaries.values()].filter(
        (summary) => summary.code === code && !summary.effectiveTo,
      ),
      ...[...policies.entries()]
        .filter(
          ([id, policy]) =>
            policy.code === code &&
            !this.publishedPolicySummaries.has(id) &&
            !this.policyWindows.get(id)?.effectiveTo,
        )
        .map(([id, policy]) => this.fixturePolicySummary(id, policy)),
    ];
    return candidates.sort((a, b) =>
      (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? ""),
    )[0];
  }

  async getPolicy(policyVersionId: string): Promise<PolicyDefinition> {
    const policy =
      this.publishedPolicies.get(policyVersionId) ??
      policies.get(policyVersionId);
    if (!policy) notFound("Policy", policyVersionId);
    return policy;
  }

  async getPolicyVersion(
    policyVersionId: string,
  ): Promise<PolicyVersionDetail> {
    const policy =
      this.publishedPolicies.get(policyVersionId) ??
      policies.get(policyVersionId);
    if (!policy) notFound("Policy", policyVersionId);
    const summary =
      this.publishedPolicySummaries.get(policyVersionId) ??
      this.fixturePolicySummary(policyVersionId, policy);
    return {
      ...summary,
      policy,
      scope: structuredClone(
        this.publishedPolicyScopes.get(policyVersionId) ?? {},
      ),
    };
  }

  async listPolicyVersions(): Promise<PolicyVersionSummary[]> {
    const summaries = new Map<string, PolicyVersionSummary>();
    for (const [id, policy] of policies) {
      summaries.set(id, this.fixturePolicySummary(id, policy));
    }
    for (const [id, summary] of this.publishedPolicySummaries) {
      summaries.set(id, summary);
    }
    return [...summaries.values()].sort(
      (a, b) => a.code.localeCompare(b.code) || b.version - a.version,
    );
  }

  async publishPolicy(input: PublishPolicyInput): Promise<PublishedPolicy> {
    assertPolicyApplicability(input.applicability);
    const policyVersionId = input.policyVersionId ?? randomUUID();
    if (
      this.publishedPolicies.has(policyVersionId) ||
      policies.has(policyVersionId)
    ) {
      throw new ConflictError(`Policy ${policyVersionId} already exists`);
    }
    const policyKey = `${input.policy.code}:${input.policy.version}`;
    if (
      this.publishedPolicyKeys.has(policyKey) ||
      [...policies.values()].some(
        (policy) =>
          `${policy.code}:${policy.version}` === policyKey,
      )
    ) {
      throw new ConflictError(`Policy ${policyKey} already exists`);
    }

    const open = this.openPolicyVersion(input.policy.code);
    if (
      open?.effectiveFrom &&
      new Date(input.effectiveFrom).getTime() <=
        new Date(open.effectiveFrom).getTime()
    ) {
      throw new ConflictError(
        `effectiveFrom must be after the open version (${open.effectiveFrom})`,
      );
    }
    if (open) {
      const published = this.publishedPolicySummaries.get(
        open.policyVersionId,
      );
      if (published) {
        published.effectiveTo = input.effectiveFrom;
      } else {
        this.policyWindows.set(open.policyVersionId, {
          effectiveFrom: open.effectiveFrom,
          effectiveTo: input.effectiveFrom,
        });
      }
    }

    const publishedAt = now();
    const contentHash = sha256(input.policy);
    this.publishedPolicies.set(policyVersionId, input.policy);
    this.publishedPolicyKeys.add(policyKey);
    this.publishedPolicyScopes.set(
      policyVersionId,
      structuredClone(input.scope ?? {}),
    );
    const applicability = structuredClone(input.applicability);
    this.publishedPolicySummaries.set(policyVersionId, {
      policyVersionId,
      code: input.policy.code,
      version: input.policy.version,
      status: "PUBLISHED",
      effectiveFrom: input.effectiveFrom,
      contentHash,
      publishedAt,
      applicability,
    });
    return {
      policyVersionId,
      policy: input.policy,
      contentHash,
      effectiveFrom: input.effectiveFrom,
      publishedAt,
      approvedBy: input.approvedBy,
      applicability,
    };
  }

  async createWorkPackage(
    input: CreateWorkPackageInput,
  ): Promise<WorkPackage> {
    const timestamp = now();
    const workPackage: WorkPackage = {
      id: randomUUID(),
      tenantId: this.tenantId,
      title: input.title,
      objective: input.objective,
      ownerPersonId: input.ownerPersonId,
      status: "DRAFT",
      acceptanceCriteria: input.acceptanceCriteria,
      members: input.members,
      dueAt: input.dueAt,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.workPackages.set(workPackage.id, workPackage);
    return workPackage;
  }

  async getWorkPackage(id: string): Promise<WorkPackage> {
    return this.workPackages.get(id) ?? notFound("WorkPackage", id);
  }

  async listWorkPackages(): Promise<WorkPackage[]> {
    return [...this.workPackages.values()];
  }

  async commitWorkPackage(
    id: string,
    expectedVersion: number,
  ): Promise<WorkPackage> {
    const workPackage = await this.getWorkPackage(id);
    if (workPackage.version !== expectedVersion) {
      throw new ConflictError(
        `expected version ${expectedVersion}, actual ${workPackage.version}`,
      );
    }
    assertTransition(
      workPackageTransitions,
      "WorkPackage",
      workPackage.status,
      "COMMITTED",
    );
    const snapshot: CommitmentSnapshot = {
      snapshotId: randomUUID(),
      workPackageId: workPackage.id,
      capturedAt: now(),
      title: workPackage.title,
      objective: workPackage.objective,
      ownerPersonId: workPackage.ownerPersonId,
      members: structuredClone(workPackage.members),
      acceptanceCriteria: [...workPackage.acceptanceCriteria],
      dueAt: workPackage.dueAt,
      contentHash: sha256({
        title: workPackage.title,
        objective: workPackage.objective,
        ownerPersonId: workPackage.ownerPersonId,
        members: workPackage.members,
        acceptanceCriteria: workPackage.acceptanceCriteria,
        dueAt: workPackage.dueAt,
      }),
    };
    workPackage.commitmentSnapshot = snapshot;
    workPackage.status = "COMMITTED";
    workPackage.version += 1;
    workPackage.updatedAt = now();
    const snapshots = this.workPackageSnapshots.get(id) ?? [];
    snapshots.push(structuredClone(snapshot));
    this.workPackageSnapshots.set(id, snapshots);
    return workPackage;
  }

  async listWorkPackageVersions(id: string): Promise<CommitmentSnapshot[]> {
    await this.getWorkPackage(id);
    return (this.workPackageSnapshots.get(id) ?? []).map((snapshot) =>
      structuredClone(snapshot),
    );
  }

  private assertWorkPackageVersion(
    workPackage: WorkPackage,
    expectedVersion?: number,
  ): void {
    if (
      expectedVersion !== undefined &&
      workPackage.version !== expectedVersion
    ) {
      throw new ConflictError(
        `expected version ${expectedVersion}, actual ${workPackage.version}`,
      );
    }
  }

  async startWorkPackage(
    id: string,
    expectedVersion?: number,
  ): Promise<WorkPackage> {
    const workPackage = await this.getWorkPackage(id);
    this.assertWorkPackageVersion(workPackage, expectedVersion);
    assertTransition(
      workPackageTransitions,
      "WorkPackage",
      workPackage.status,
      "IN_PROGRESS",
    );
    workPackage.status = "IN_PROGRESS";
    workPackage.version += 1;
    workPackage.updatedAt = now();
    return workPackage;
  }

  async submitWorkPackage(
    id: string,
    expectedVersion?: number,
  ): Promise<WorkPackage> {
    const workPackage = await this.getWorkPackage(id);
    this.assertWorkPackageVersion(workPackage, expectedVersion);
    assertTransition(
      workPackageTransitions,
      "WorkPackage",
      workPackage.status,
      "SUBMITTED",
    );
    workPackage.status = "SUBMITTED";
    workPackage.version += 1;
    workPackage.updatedAt = now();
    return workPackage;
  }

  async acceptWorkPackage(
    id: string,
    reviewerPersonId: string,
    expectedVersion?: number,
  ): Promise<WorkPackage> {
    const workPackage = await this.getWorkPackage(id);
    this.assertWorkPackageVersion(workPackage, expectedVersion);
    if (reviewerPersonId === workPackage.ownerPersonId) {
      throw new ConflictError(
        "the work-package owner cannot accept their own delivery",
      );
    }
    assertTransition(
      workPackageTransitions,
      "WorkPackage",
      workPackage.status,
      "ACCEPTED",
    );
    workPackage.status = "ACCEPTED";
    workPackage.version += 1;
    workPackage.updatedAt = now();
    return workPackage;
  }

  async acceptWorkPackagesBatch(
    items: Array<{ id: string; reviewerPersonId: string }>,
  ): Promise<WorkPackage[]> {
    const snapshot = new Map(
      [...this.workPackages].map(([id, workPackage]) => [
        id,
        structuredClone(workPackage),
      ]),
    );
    try {
      const accepted: WorkPackage[] = [];
      for (const item of items) {
        accepted.push(
          await this.acceptWorkPackage(item.id, item.reviewerPersonId),
        );
      }
      return accepted;
    } catch (error) {
      this.workPackages.clear();
      for (const [id, workPackage] of snapshot) {
        this.workPackages.set(id, workPackage);
      }
      throw error;
    }
  }

  async rejectWorkPackage(
    id: string,
    reviewerPersonId: string,
    reason: string,
    expectedVersion?: number,
  ): Promise<WorkPackage> {
    const workPackage = await this.getWorkPackage(id);
    this.assertWorkPackageVersion(workPackage, expectedVersion);
    if (reviewerPersonId === workPackage.ownerPersonId) {
      throw new ConflictError(
        "the work-package owner cannot reject their own delivery",
      );
    }
    assertTransition(
      workPackageTransitions,
      "WorkPackage",
      workPackage.status,
      "REJECTED",
    );
    workPackage.status = "REJECTED";
    workPackage.version += 1;
    workPackage.updatedAt = now();
    void reason;
    return workPackage;
  }

  async createClaim(
    input: CreateContributionClaimInput,
  ): Promise<ContributionClaim> {
    const workPackage = await this.getWorkPackage(input.workPackageId);
    if (workPackage.status !== "ACCEPTED") {
      throw new ConflictError(
        "a contribution claim requires an accepted work package",
      );
    }
    if (!workPackage.commitmentSnapshot) {
      throw new ConflictError(
        "a contribution claim requires a frozen commitment snapshot",
      );
    }
    const timestamp = now();
    const claim: ContributionClaim = {
      id: randomUUID(),
      tenantId: this.tenantId,
      workPackageId: input.workPackageId,
      claimantPersonId: input.claimantPersonId,
      claimType: input.claimType,
      claimedContribution: input.claimedContribution,
      evidenceRefs: input.evidenceRefs ?? [],
      rationale: input.rationale,
      status: "DRAFT",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.claims.set(claim.id, claim);
    return claim;
  }

  async getClaim(id: string): Promise<ContributionClaim> {
    return this.claims.get(id) ?? notFound("ContributionClaim", id);
  }

  async listClaims(): Promise<ContributionClaim[]> {
    return [...this.claims.values()];
  }

  async submitClaim(id: string): Promise<ContributionClaim> {
    const claim = await this.getClaim(id);
    assertTransition(
      contributionClaimTransitions,
      "ContributionClaim",
      claim.status,
      "SUBMITTED",
    );
    claim.status = "SUBMITTED";
    claim.submittedAt = now();
    claim.version += 1;
    claim.updatedAt = now();
    return claim;
  }

  async createAttributionDecision(
    input: CreateAttributionDecisionInput,
  ): Promise<AttributionDecision> {
    const claim = await this.getClaim(input.claimId);
    if (claim.status === "SUBMITTED") {
      assertTransition(
        contributionClaimTransitions,
        "ContributionClaim",
        claim.status,
        "UNDER_REVIEW",
      );
      claim.status = "UNDER_REVIEW";
      claim.version += 1;
      claim.updatedAt = now();
    } else if (claim.status !== "UNDER_REVIEW") {
      throw new ConflictError(
        `claim must be SUBMITTED or UNDER_REVIEW, got ${claim.status}`,
      );
    }

    const previous = [...this.decisions.values()]
      .filter((decision) => decision.claimId === claim.id)
      .sort((a, b) => b.decisionVersion - a.decisionVersion)[0];

    assertAdjudicatorIsNotClaimant(claim, {
      adjudicatorPersonId: input.adjudicatorPersonId,
    });

    if (previous) {
      assertTransition(
        attributionDecisionTransitions,
        "AttributionDecision",
        previous.status,
        "SUPERSEDED",
      );
      previous.status = "SUPERSEDED";
    }

    const decision: AttributionDecision = {
      id: randomUUID(),
      tenantId: this.tenantId,
      claimId: claim.id,
      decisionVersion: (previous?.decisionVersion ?? 0) + 1,
      status: input.status,
      adjudicatorPersonId: input.adjudicatorPersonId,
      acceptedFacts: input.acceptedFacts ?? [],
      rejectedFacts: input.rejectedFacts ?? [],
      contributionDimensions: input.contributionDimensions,
      rationale: input.rationale,
      confidenceBand: input.confidenceBand,
      effectiveAt: now(),
      supersedesId: previous?.id,
      createdAt: now(),
    };
    this.decisions.set(decision.id, decision);

    const nextClaimStatus =
      input.status === "CONFIRMED"
        ? "ACCEPTED"
        : input.status === "PARTIALLY_CONFIRMED"
          ? "PARTIALLY_ACCEPTED"
          : "REJECTED";
    assertTransition(
      contributionClaimTransitions,
      "ContributionClaim",
      claim.status,
      nextClaimStatus,
    );
    claim.status = nextClaimStatus;
    claim.version += 1;
    claim.updatedAt = now();
    return decision;
  }

  async createAttributionDecisionsBatch(
    inputs: CreateAttributionDecisionInput[],
  ): Promise<AttributionDecision[]> {
    const claimSnapshot = new Map(
      [...this.claims].map(([id, claim]) => [id, structuredClone(claim)]),
    );
    const decisionSnapshot = new Map(
      [...this.decisions].map(([id, decision]) => [
        id,
        structuredClone(decision),
      ]),
    );
    try {
      const decisions: AttributionDecision[] = [];
      for (const input of inputs) {
        decisions.push(await this.createAttributionDecision(input));
      }
      return decisions;
    } catch (error) {
      this.claims.clear();
      for (const [id, claim] of claimSnapshot) this.claims.set(id, claim);
      this.decisions.clear();
      for (const [id, decision] of decisionSnapshot) {
        this.decisions.set(id, decision);
      }
      throw error;
    }
  }

  async listDecisions(claimId?: string): Promise<AttributionDecision[]> {
    return [...this.decisions.values()].filter(
      (decision) => !claimId || decision.claimId === claimId,
    );
  }

  private hasConfirmedAttribution(
    workPackageId: string,
    personId: string,
  ): boolean {
    const claimIds = new Set(
      [...this.claims.values()]
        .filter(
          (claim) =>
            claim.workPackageId === workPackageId &&
            claim.claimantPersonId === personId,
        )
        .map((claim) => claim.id),
    );
    return [...this.decisions.values()].some(
      (decision) =>
        claimIds.has(decision.claimId) &&
        (decision.status === "CONFIRMED" ||
          decision.status === "PARTIALLY_CONFIRMED"),
    );
  }

  async recordLegalGate(
    input: RecordLegalGateInput,
  ): Promise<LegalGateRecord> {
    const existing = this.legalGates.get(input.policyVersionId);
    const record: LegalGateRecord = {
      id: existing?.id ?? randomUUID(),
      tenantId: this.tenantId,
      policyVersionId: input.policyVersionId,
      democraticProcedureRef: input.democraticProcedureRef,
      employeeNoticeRef: input.employeeNoticeRef,
      dataProtectionAssessmentRef: input.dataProtectionAssessmentRef,
      minimumWageChecked: input.minimumWageChecked,
      policyApproved: input.policyApproved,
      recordedBy: input.recordedBy,
      recordedAt: now(),
    };
    this.legalGates.set(input.policyVersionId, record);
    return record;
  }

  async getLegalGate(
    policyVersionId: string,
  ): Promise<LegalGateRecord | undefined> {
    return this.legalGates.get(policyVersionId);
  }

  async createEvidence(input: CreateEvidenceInput): Promise<EvidenceNode> {
    if (input.supersedesId && !this.evidence.has(input.supersedesId)) {
      notFound("EvidenceNode", input.supersedesId);
    }
    const node: EvidenceNode = {
      id: randomUUID(),
      tenantId: this.tenantId,
      evidenceType: input.evidenceType,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      sourceSystem: input.sourceSystem,
      sourceUri: input.sourceUri,
      observedAt: input.observedAt ?? now(),
      qualityStatus: input.qualityStatus ?? "UNVERIFIED",
      normalizedPayload: input.normalizedPayload,
      payloadHash: sha256(input.normalizedPayload),
      supersedesId: input.supersedesId,
      submittedBy: input.submittedBy,
      createdAt: now(),
    };
    this.evidence.set(node.id, node);
    return node;
  }

  async ingestEvents(batch: IngestionBatch): Promise<IngestionResult> {
    let accepted = 0;
    let duplicates = 0;
    const evidenceIds: string[] = [];
    for (const event of batch.events) {
      const version = event.sourceEventVersion ?? "1";
      const key = `${batch.sourceSystem}:${event.sourceRecordId}:${version}`;
      if (this.ingestedKeys.has(key)) {
        duplicates += 1;
        continue;
      }
      this.ingestedKeys.add(key);
      const node = await this.createEvidence({
        evidenceType: event.evidenceType,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        sourceSystem: batch.sourceSystem,
        sourceUri: event.sourceUri,
        observedAt: event.occurredAt,
        qualityStatus: event.qualityStatus,
        normalizedPayload: event.payload,
      });
      accepted += 1;
      evidenceIds.push(node.id);
    }
    return { accepted, duplicates, evidenceIds };
  }

  async listEvidence(
    subjectType?: string,
    subjectId?: string,
  ): Promise<EvidenceNode[]> {
    return [...this.evidence.values()].filter(
      (node) =>
        (!subjectType || node.subjectType === subjectType) &&
        (!subjectId || node.subjectId === subjectId),
    );
  }

  async linkEvidence(
    fromEvidenceId: string,
    input: CreateEvidenceLinkInput,
  ): Promise<EvidenceLink> {
    if (!this.evidence.has(fromEvidenceId)) {
      notFound("EvidenceNode", fromEvidenceId);
    }
    if (!this.evidence.has(input.toEvidenceId)) {
      notFound("EvidenceNode", input.toEvidenceId);
    }
    const existing = [...this.evidenceLinks.values()].find(
      (link) =>
        link.fromEvidenceId === fromEvidenceId &&
        link.toEvidenceId === input.toEvidenceId &&
        link.relationType === input.relationType,
    );
    if (existing) return existing;
    const link: EvidenceLink = {
      id: randomUUID(),
      tenantId: this.tenantId,
      fromEvidenceId,
      toEvidenceId: input.toEvidenceId,
      relationType: input.relationType,
      rationale: input.rationale,
      createdAt: now(),
    };
    this.evidenceLinks.set(link.id, link);
    return link;
  }

  async listEvidenceLinks(evidenceId: string): Promise<EvidenceLink[]> {
    return [...this.evidenceLinks.values()].filter(
      (link) =>
        link.fromEvidenceId === evidenceId ||
        link.toEvidenceId === evidenceId,
    );
  }

  async createCalculationRun(
    input: CreateCalculationRunInput,
  ): Promise<CalculationRun> {
    const policy = await this.getPolicy(input.policyVersionId);
    const gate = await this.getLegalGate(input.policyVersionId);
    const blockers = legalGateBlockers(input.mode, gate);
    const effectiveParticipants: CalculationInput["participants"] =
      input.participants.map((participant) => ({ ...participant }));

    if (policy.evaluation) {
      for (const participant of effectiveParticipants) {
        const decisionId = participant.evaluationDecisionId;
        if (!decisionId) {
          blockers.push(`EVALUATION_DECISION_MISSING:${participant.personId}`);
          continue;
        }
        const decision = this.evaluationDecisions.get(decisionId);
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
        if (decision.personId !== participant.personId) {
          blockers.push(
            `EVALUATION_DECISION_PERSON_MISMATCH:${participant.personId}`,
          );
          continue;
        }
        if (decision.cycleId !== input.cycleId) {
          blockers.push(
            `EVALUATION_DECISION_CYCLE_MISMATCH:${participant.personId}`,
          );
          continue;
        }
        const derived = deriveEvaluationMultiplier(
          policy.evaluation,
          decision.scores,
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
        if (
          !this.hasConfirmedAttribution(
            participant.workPackageId,
            participant.personId,
          )
        ) {
          blockers.push(
            `MISSING_CONFIRMED_ATTRIBUTION:${participant.personId}`,
          );
        }
      }
      const workPackageIds = new Set(
        input.participants.map((participant) => participant.workPackageId),
      );
      for (const issue of this.dataQualityIssues.values()) {
        if (
          issue.severity === "BLOCKING" &&
          issue.objectType === "WORK_PACKAGE" &&
          workPackageIds.has(issue.objectId) &&
          ["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"].includes(
            issue.status,
          )
        ) {
          blockers.push(`BLOCKING_DATA_QUALITY_ISSUE:${issue.id}`);
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
    const run: CalculationRun = {
      id: randomUUID(),
      tenantId: this.tenantId,
      cycleId: input.cycleId,
      mode: input.mode,
      policyVersionId: input.policyVersionId,
      engineVersion: result.engineVersion,
      inputSnapshotHash: result.inputSnapshotHash,
      inputSnapshot: calculationInput,
      status: "CALCULATED",
      lines: result.lines,
      resultHash: result.resultHash,
      blockers: [],
      warnings:
        input.mode === "FORMAL"
          ? []
          : [
              "SHADOW run: no payment effect and no ledger entries were created",
            ],
      createdAt: now(),
      calculatedAt: now(),
    };

    if (input.mode === "FORMAL") {
      for (const line of result.lines) {
        this.ledger.append({
          tenantId: run.tenantId,
          personId: line.personId,
          cycleId: run.cycleId,
          calculationRunId: run.id,
          calculationLineId: `${run.id}:${line.lineKey}`,
          entryType: "INCENTIVE",
          amount: line.roundedAmount,
          currency: line.currency,
          idempotencyKey: `${run.id}:${line.lineKey}:INCENTIVE`,
        });
      }
    }

    this.runs.set(run.id, run);
    return run;
  }

  async createCalculationRunsBatch(
    inputs: CreateCalculationRunInput[],
  ): Promise<CalculationRun[]> {
    const runSnapshot = new Map(this.runs);
    const ledgerSnapshot = this.ledger.snapshot();
    try {
      const runs: CalculationRun[] = [];
      for (const input of inputs) {
        runs.push(await this.createCalculationRun(input));
      }
      return runs;
    } catch (error) {
      this.runs.clear();
      for (const [id, run] of runSnapshot) this.runs.set(id, run);
      this.ledger.restore(ledgerSnapshot);
      throw error;
    }
  }

  async getRun(id: string): Promise<CalculationRun> {
    return this.runs.get(id) ?? notFound("CalculationRun", id);
  }

  async listRuns(): Promise<CalculationRun[]> {
    return [...this.runs.values()];
  }

  async approveRun(id: string): Promise<CalculationRun> {
    const run = await this.getRun(id);
    assertTransition(
      calculationRunTransitions,
      "CalculationRun",
      run.status,
      "APPROVED",
    );
    run.status = "APPROVED";
    return run;
  }

  async lockRun(id: string, confirmation: string): Promise<CalculationRun> {
    if (confirmation !== "LOCK_CALCULATION") {
      throw new ConflictError("invalid lock confirmation");
    }
    const run = await this.getRun(id);
    const blockers = confirmationBlockers(run, [
      ...this.confirmations.values(),
    ]);
    if (blockers.length > 0) {
      throw new CalculationBlockedError(blockers);
    }
    assertTransition(
      calculationRunTransitions,
      "CalculationRun",
      run.status,
      "LOCKED",
    );
    for (const entry of this.ledger
      .list(run.tenantId)
      .filter((candidate) => candidate.calculationRunId === run.id)) {
      this.ledger.lock(entry.id);
    }
    run.status = "LOCKED";
    run.lockedAt = now();
    return run;
  }

  async recordConfirmation(
    input: RecordConfirmationInput,
  ): Promise<EmployeeConfirmation> {
    await this.assertConfirmationTarget(input);
    const key = `${input.personId}:${input.targetType}:${input.targetId}`;
    const existing = this.confirmations.get(key);
    const timestamp = now();
    const record: EmployeeConfirmation = existing ?? {
      id: randomUUID(),
      tenantId: this.tenantId,
      personId: input.personId,
      targetType: input.targetType,
      targetId: input.targetId,
      decision: "VIEWED",
      createdAt: timestamp,
    };
    record.decision = input.decision;
    if (input.decision === "VIEWED") record.viewedAt = timestamp;
    if (input.decision === "CONFIRMED") record.confirmedAt = timestamp;
    if (input.decision === "OBJECTED") {
      record.objectedAt = timestamp;
      record.reason = input.reason;
    }
    this.confirmations.set(key, record);
    return record;
  }

  async listConfirmations(
    personId?: string,
  ): Promise<EmployeeConfirmation[]> {
    return [...this.confirmations.values()].filter(
      (confirmation) => !personId || confirmation.personId === personId,
    );
  }

  private async assertConfirmationTarget(
    input: RecordConfirmationInput,
  ): Promise<void> {
    if (input.targetType === "CALCULATION") {
      await this.getRun(input.targetId);
    } else if (input.targetType === "ATTRIBUTION") {
      if (!this.decisions.has(input.targetId)) {
        notFound("AttributionDecision", input.targetId);
      }
    } else if (input.targetType === "LEDGER") {
      this.ledger.get(input.targetId);
    } else if (input.targetType === "SETTLEMENT") {
      await this.getSettlementBatch(input.targetId);
    }
  }

  async createAppeal(input: {
    appellantPersonId: string;
    targetType: "ATTRIBUTION" | "EVALUATION" | "LEDGER" | "CALCULATION";
    targetId: string;
    reasonCode: string;
    statement: string;
    evidenceRefs?: string[];
    dueAt?: string;
  }): Promise<AppealCase> {
    const appeal: AppealCase = {
      id: randomUUID(),
      tenantId: this.tenantId,
      appellantPersonId: input.appellantPersonId,
      targetType: input.targetType,
      targetId: input.targetId,
      reasonCode: input.reasonCode,
      statement: input.statement,
      evidenceRefs: input.evidenceRefs ?? [],
      status: "OPEN",
      dueAt: input.dueAt,
      createdAt: now(),
    };
    this.appeals.set(appeal.id, appeal);
    return appeal;
  }

  async getAppeal(id: string): Promise<AppealCase> {
    return this.appeals.get(id) ?? notFound("AppealCase", id);
  }

  async listAppeals(): Promise<AppealCase[]> {
    return [...this.appeals.values()];
  }

  async triageAppeal(
    id: string,
    reviewerPersonId: string,
  ): Promise<AppealCase> {
    const appeal = await this.getAppeal(id);
    if (reviewerPersonId === appeal.appellantPersonId) {
      throw new ConflictError("the appellant cannot triage their own appeal");
    }
    assertTransition(
      appealCaseTransitions,
      "AppealCase",
      appeal.status,
      "TRIAGED",
    );
    appeal.status = "TRIAGED";
    appeal.reviewerPersonId = reviewerPersonId;
    return appeal;
  }

  async reviewAppeal(id: string): Promise<AppealCase> {
    const appeal = await this.getAppeal(id);
    assertTransition(
      appealCaseTransitions,
      "AppealCase",
      appeal.status,
      "UNDER_REVIEW",
    );
    appeal.status = "UNDER_REVIEW";
    return appeal;
  }

  async resolveAppeal(
    id: string,
    input: ResolveAppealInput,
  ): Promise<AppealCase> {
    const appeal = await this.getAppeal(id);
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
    appeal.status = "DECIDED";
    appeal.resolution = `${input.resolution}: ${input.rationale}`;
    appeal.resolvedAt = now();
    if (input.resolution === "CHANGE") {
      assertTransition(
        appealCaseTransitions,
        "AppealCase",
        appeal.status,
        "RECALCULATION_REQUIRED",
      );
      appeal.status = "RECALCULATION_REQUIRED";
    } else {
      assertTransition(
        appealCaseTransitions,
        "AppealCase",
        appeal.status,
        "CLOSED",
      );
      appeal.status = "CLOSED";
    }
    return appeal;
  }

  async createRecalculationRequest(input: {
    targetType: "EVIDENCE" | "ATTRIBUTION" | "EVALUATION" | "LEDGER";
    targetId: string;
    reasonCode: string;
    explanation: string;
    requestedBy: string;
  }): Promise<RecalculationRequest> {
    const request: RecalculationRequest = {
      id: randomUUID(),
      tenantId: this.tenantId,
      targetType: input.targetType,
      targetId: input.targetId,
      reasonCode: input.reasonCode,
      explanation: input.explanation,
      requestedBy: input.requestedBy,
      status: "OPEN",
      createdAt: now(),
    };
    this.recalculations.set(request.id, request);
    return request;
  }

  async getRecalculationRequest(id: string): Promise<RecalculationRequest> {
    const request = this.recalculations.get(id);
    if (!request) notFound("RecalculationRequest", id);
    return request;
  }

  async listRecalculationRequests(filter?: {
    status?: "OPEN" | "APPROVED" | "REJECTED" | "COMPLETED";
    targetType?: "EVIDENCE" | "ATTRIBUTION" | "EVALUATION" | "LEDGER";
  }): Promise<RecalculationRequest[]> {
    return [...this.recalculations.values()]
      .filter(
        (request) =>
          (!filter?.status || request.status === filter.status) &&
          (!filter?.targetType || request.targetType === filter.targetType),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async approveRecalculationRequest(
    id: string,
    approvedBy: string,
  ): Promise<RecalculationRequest> {
    const request = await this.getRecalculationRequest(id);
    if (request.status !== "OPEN") {
      throw new ConflictError(
        `recalculation request ${id} is ${request.status}`,
      );
    }
    request.status = "APPROVED";
    request.approvedBy = approvedBy;
    request.approvedAt = now();
    return request;
  }

  async rejectRecalculationRequest(
    id: string,
    reviewedBy: string,
  ): Promise<RecalculationRequest> {
    const request = await this.getRecalculationRequest(id);
    if (request.status !== "OPEN") {
      throw new ConflictError(
        `recalculation request ${id} is ${request.status}`,
      );
    }
    request.status = "REJECTED";
    request.approvedBy = reviewedBy;
    request.approvedAt = now();
    return request;
  }

  async completeRecalculationRequest(
    id: string,
    newCalculationRunId: string,
  ): Promise<RecalculationRequest> {
    const request = await this.getRecalculationRequest(id);
    if (request.status !== "APPROVED") {
      throw new ConflictError(
        `recalculation request ${id} is ${request.status}`,
      );
    }
    request.status = "COMPLETED";
    request.newCalculationRunId = newCalculationRunId;
    return request;
  }

  async createNotification(input: {
    recipientPersonId?: string;
    audience: "PERSON" | "MANAGER" | "FINANCE" | "ADMIN";
    title: string;
    body: string;
    sourceType?: string;
    sourceId?: string;
  }): Promise<InAppNotification> {
    const notification: InAppNotification = {
      id: randomUUID(),
      tenantId: this.tenantId,
      recipientPersonId: input.recipientPersonId,
      audience: input.audience,
      title: input.title,
      body: input.body,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      status: "UNREAD",
      createdAt: now(),
    };
    this.notifications.set(notification.id, notification);
    return notification;
  }

  async listNotifications(filter?: {
    recipientPersonId?: string;
    audience?: string;
    status?: string;
  }): Promise<InAppNotification[]> {
    return [...this.notifications.values()]
      .filter(
        (notification) =>
          (!filter?.recipientPersonId ||
            notification.recipientPersonId === filter.recipientPersonId) &&
          (!filter?.audience || notification.audience === filter.audience) &&
          (!filter?.status || notification.status === filter.status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async markNotificationRead(id: string): Promise<InAppNotification> {
    const notification = this.notifications.get(id);
    if (!notification) notFound("Notification", id);
    if (notification.status !== "READ") {
      notification.status = "READ";
      notification.readAt = now();
    }
    return notification;
  }

  async createDataQualityIssue(input: {
    objectType: string;
    objectId: string;
    issueCode: string;
    severity: "INFO" | "WARNING" | "BLOCKING";
    details?: Record<string, unknown>;
    assignedTo?: string;
    dueAt?: string;
  }): Promise<DataQualityIssue> {
    const timestamp = now();
    const issue: DataQualityIssue = {
      id: randomUUID(),
      tenantId: this.tenantId,
      objectType: input.objectType,
      objectId: input.objectId,
      issueCode: input.issueCode,
      severity: input.severity,
      status: input.assignedTo ? "ASSIGNED" : "OPEN",
      assignedTo: input.assignedTo,
      details: input.details ?? {},
      dueAt: input.dueAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.dataQualityIssues.set(issue.id, issue);
    return issue;
  }

  async getDataQualityIssue(id: string): Promise<DataQualityIssue> {
    const issue = this.dataQualityIssues.get(id);
    if (!issue) notFound("DataQualityIssue", id);
    return issue;
  }

  async listDataQualityIssues(filter?: {
    status?: string;
  }): Promise<DataQualityIssue[]> {
    return [...this.dataQualityIssues.values()]
      .filter((issue) => !filter?.status || issue.status === filter.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async commandDataQualityIssue(
    id: string,
    input: {
      command:
        | "ASSIGN"
        | "START"
        | "RESOLVE"
        | "WAIVE"
        | "REOPEN"
        | "ESCALATE";
      assignedTo?: string;
      actorPersonId?: string;
      reason?: string;
    },
  ): Promise<DataQualityIssue> {
    const issue = await this.getDataQualityIssue(id);
    const target = {
      ASSIGN: "ASSIGNED",
      START: "IN_PROGRESS",
      RESOLVE: "RESOLVED",
      WAIVE: "WAIVED_WITH_APPROVAL",
      REOPEN: "REOPENED",
    } as const;
    if (input.command !== "ESCALATE") {
      assertTransition(
        dataQualityIssueTransitions,
        "DataQualityIssue",
        issue.status,
        target[input.command],
      );
    }
    const timestamp = now();
    switch (input.command) {
      case "ASSIGN":
        if (!input.assignedTo) {
          throw new ConflictError("DQ_ASSIGNEE_REQUIRED");
        }
        issue.assignedTo = input.assignedTo;
        issue.status = "ASSIGNED";
        break;
      case "START":
        issue.status = "IN_PROGRESS";
        break;
      case "RESOLVE":
        issue.status = "RESOLVED";
        issue.resolvedAt = timestamp;
        break;
      case "WAIVE":
        if (!input.actorPersonId || !input.reason) {
          throw new ConflictError("DQ_WAIVER_REQUIRES_APPROVER_AND_REASON");
        }
        issue.status = "WAIVED_WITH_APPROVAL";
        issue.waivedBy = input.actorPersonId;
        issue.waiverReason = input.reason;
        break;
      case "REOPEN":
        issue.status = "REOPENED";
        issue.resolvedAt = undefined;
        break;
      case "ESCALATE":
        if (
          issue.status === "RESOLVED" ||
          issue.status === "WAIVED_WITH_APPROVAL"
        ) {
          throw new ConflictError("DQ_ISSUE_CLOSED");
        }
        issue.escalatedAt = timestamp;
        issue.escalationReason = input.reason ?? "ESCALATED";
        break;
    }
    issue.updatedAt = timestamp;
    return issue;
  }

  async createEvaluationCycle(input: {
    name: string;
    cycleType: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    policyVersionId?: string;
    rubricVersionId?: string;
  }): Promise<EvaluationCycle> {
    if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) {
      throw new ConflictError("CYCLE_DATES_INVALID");
    }
    const timestamp = now();
    const cycle: EvaluationCycle = {
      id: randomUUID(),
      tenantId: this.tenantId,
      name: input.name,
      cycleType: input.cycleType,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
      status: "DRAFT",
      policyVersionId: input.policyVersionId,
      rubricVersionId: input.rubricVersionId,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.evaluationCycles.set(cycle.id, cycle);
    return cycle;
  }

  async getEvaluationCycle(id: string): Promise<EvaluationCycle> {
    const cycle = this.evaluationCycles.get(id);
    if (!cycle) notFound("EvaluationCycle", id);
    return cycle;
  }

  async listEvaluationCycles(): Promise<EvaluationCycle[]> {
    return [...this.evaluationCycles.values()].sort((a, b) =>
      b.startsAt.localeCompare(a.startsAt),
    );
  }

  async createRubric(input: {
    code: string;
    name: string;
    dimensions: string[];
    scoringAnchors: Record<string, unknown>;
    scope?: Record<string, unknown>;
    effectiveFrom: string;
  }): Promise<Rubric> {
    const version =
      Math.max(
        0,
        ...[...this.rubrics.values()]
          .filter((rubric) => rubric.code === input.code)
          .map((rubric) => rubric.version),
      ) + 1;
    const rubric: Rubric = {
      id: randomUUID(),
      tenantId: this.tenantId,
      code: input.code,
      name: input.name,
      dimensions: input.dimensions,
      scoringAnchors: input.scoringAnchors,
      scope: input.scope ?? {},
      status: "ACTIVE",
      version,
      effectiveFrom: input.effectiveFrom,
      createdAt: now(),
    };
    this.rubrics.set(rubric.id, rubric);
    return rubric;
  }

  async listRubrics(): Promise<Rubric[]> {
    return [...this.rubrics.values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt),
    );
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
    const timestamp = now();
    const draft: EvaluationDraft = {
      id: randomUUID(),
      tenantId: this.tenantId,
      cycleId: input.cycleId,
      personId: input.personId,
      generatedByType: input.generatedByType,
      generatedById: input.generatedById,
      modelProvider: input.modelProvider,
      modelName: input.modelName,
      promptVersion: input.promptVersion,
      agentTaskId: input.agentTaskId,
      evidenceSnapshotHash: input.evidenceSnapshotHash,
      draftPayload: input.draftPayload,
      strengths: input.strengths ?? [],
      counterEvidence: input.counterEvidence ?? [],
      missingInformation: input.missingInformation ?? [],
      uncertainty: input.uncertainty ?? {},
      status: "DRAFT",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.evaluationDrafts.set(draft.id, draft);
    return draft;
  }

  async getEvaluationDraft(id: string): Promise<EvaluationDraft> {
    const draft = this.evaluationDrafts.get(id);
    if (!draft) notFound("EvaluationDraft", id);
    return draft;
  }

  async listEvaluationDrafts(filter?: {
    cycleId?: string;
    personId?: string;
  }): Promise<EvaluationDraft[]> {
    return [...this.evaluationDrafts.values()]
      .filter(
        (draft) =>
          (!filter?.cycleId || draft.cycleId === filter.cycleId) &&
          (!filter?.personId || draft.personId === filter.personId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async submitEvaluationDraft(id: string): Promise<EvaluationDraft> {
    const draft = await this.getEvaluationDraft(id);
    assertTransition(
      evaluationDraftTransitions,
      "EvaluationDraft",
      draft.status,
      "SUBMITTED",
    );
    draft.status = "SUBMITTED";
    draft.updatedAt = now();
    return draft;
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
    const draft = await this.getEvaluationDraft(id);
    assertTransition(
      evaluationDraftTransitions,
      "EvaluationDraft",
      draft.status,
      input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
    );
    if (input.reviewerPersonId === draft.personId) {
      throw new ConflictError("SELF_REVIEW_FORBIDDEN");
    }
    const rubric = this.rubrics.get(input.rubricVersionId);
    if (!rubric) notFound("Rubric", input.rubricVersionId);

    const timestamp = now();
    if (input.decision === "REJECT") {
      draft.status = "REJECTED";
      draft.updatedAt = timestamp;
      return { draft };
    }
    if (Object.keys(input.scores).length === 0) {
      throw new ConflictError("EVALUATION_SCORES_REQUIRED");
    }
    for (const dimension of rubric.dimensions) {
      if (!(dimension in input.scores)) {
        throw new ConflictError(`EVALUATION_DIMENSION_MISSING: ${dimension}`);
      }
    }

    const prior = [...this.evaluationDecisions.values()]
      .filter(
        (candidate) =>
          candidate.cycleId === draft.cycleId &&
          candidate.personId === draft.personId,
      )
      .sort((a, b) => b.decisionVersion - a.decisionVersion);
    const latest = prior[0];
    for (const candidate of prior) {
      if (candidate.status === "APPROVED") candidate.status = "SUPERSEDED";
    }
    const decision: EvaluationDecision = {
      id: randomUUID(),
      tenantId: this.tenantId,
      cycleId: draft.cycleId,
      personId: draft.personId,
      decisionVersion: (latest?.decisionVersion ?? 0) + 1,
      status: "APPROVED",
      rubricVersionId: input.rubricVersionId,
      evidenceSnapshotHash: draft.evidenceSnapshotHash,
      scores: input.scores,
      rationale: input.rationale,
      reviewerPersonId: input.reviewerPersonId,
      approvedAt: timestamp,
      supersedesId: latest?.id,
      createdAt: timestamp,
    };
    this.evaluationDecisions.set(decision.id, decision);
    draft.status = "APPROVED";
    draft.updatedAt = timestamp;
    return { draft, decision };
  }

  async listEvaluationDecisions(filter?: {
    cycleId?: string;
    personId?: string;
  }): Promise<EvaluationDecision[]> {
    return [...this.evaluationDecisions.values()]
      .filter(
        (decision) =>
          (!filter?.cycleId || decision.cycleId === filter.cycleId) &&
          (!filter?.personId || decision.personId === filter.personId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getEvaluationDecision(id: string): Promise<EvaluationDecision> {
    const decision = this.evaluationDecisions.get(id);
    if (!decision) notFound("EvaluationDecision", id);
    return decision;
  }

  async createSettlementBatch(input: {
    cycleId: string;
    kind?: "STANDARD" | "RECOVERY";
    currency?: string;
    batchNo?: string;
  }): Promise<SettlementBatch> {
    const ledger = await this.listLedger();
    const alreadyBatched = new Set(
      [...this.settlementLines.values()]
        .flat()
        .filter((line) => line.active)
        .map((line) => line.ledgerId),
    );
    const eligible = ledger.filter(
      (entry) =>
        entry.cycleId === input.cycleId &&
        entry.status === "LOCKED" &&
        !alreadyBatched.has(entry.id),
    );
    if (eligible.length === 0) {
      throw new ConflictError(
        "NO_SETTLEMENT_ELIGIBLE_LEDGER: no unbatched locked ledger entries for this cycle",
      );
    }
    const currencies = new Set(eligible.map((entry) => entry.currency));
    if (currencies.size > 1) {
      throw new ConflictError(
        `MIXED_CURRENCIES: ${[...currencies].join(", ")}`,
      );
    }
    const currency = input.currency ?? [...currencies][0]!;
    if ([...currencies][0] !== currency) {
      throw new ConflictError(
        `CURRENCY_MISMATCH: ledger is ${[...currencies][0]}, batch is ${currency}`,
      );
    }

    const timestamp = now();
    const id = randomUUID();
    const batchNo = input.batchNo ?? `SB-${Date.now()}-${id.slice(0, 8)}`;
    if ([...this.settlementBatches.values()].some((b) => b.batchNo === batchNo)) {
      throw new ConflictError(`Settlement batch ${batchNo} already exists`);
    }
    const lines: SettlementLine[] = eligible.map((entry) => ({
      id: randomUUID(),
      tenantId: this.tenantId,
      batchId: id,
      ledgerId: entry.id,
      personId: entry.personId,
      amount: formatDecimal(parseDecimal(entry.amount)),
      currency: entry.currency,
      status: "PENDING",
      active: true,
      createdAt: timestamp,
    }));
    const kind = input.kind ?? "STANDARD";
    const total = sum(lines.map((line) => parseDecimal(line.amount)));
    if (total < 0n && kind !== "RECOVERY") {
      throw new ConflictError(
        "NEGATIVE_SETTLEMENT_REQUIRES_RECOVERY",
      );
    }
    const batch: SettlementBatch = {
      id,
      tenantId: this.tenantId,
      cycleId: input.cycleId,
      batchNo,
      status: "DRAFT",
      kind,
      currency,
      totalAmount: formatDecimal(total),
      lineCount: lines.length,
      createdAt: timestamp,
      updatedAt: timestamp,
      lines,
    };
    this.settlementBatches.set(id, batch);
    this.settlementLines.set(id, lines);
    return { ...batch, lines: lines.map((line) => ({ ...line })) };
  }

  async getSettlementBatch(id: string): Promise<SettlementBatch> {
    const batch = this.settlementBatches.get(id);
    if (!batch) notFound("SettlementBatch", id);
    const lines = this.settlementLines.get(id) ?? [];
    return { ...batch, lines: lines.map((line) => ({ ...line })) };
  }

  async listSettlementBatches(): Promise<SettlementBatch[]> {
    return [...this.settlementBatches.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((batch) => ({
        ...batch,
        lines: (this.settlementLines.get(batch.id) ?? []).map((line) => ({
          ...line,
        })),
      }));
  }

  async listSettlementLines(batchId: string): Promise<SettlementLine[]> {
    if (!this.settlementBatches.has(batchId)) {
      notFound("SettlementBatch", batchId);
    }
    return (this.settlementLines.get(batchId) ?? []).map((line) => ({
      ...line,
    }));
  }

  async commandSettlementBatch(
    id: string,
    input: SettlementCommandInput,
  ): Promise<SettlementCommandResult> {
    const batch = await this.getSettlementBatch(id);
    const lines = this.settlementLines.get(id) ?? [];
    const transition = (to: SettlementBatch["status"]) =>
      assertTransition(
        settlementBatchTransitions,
        "SettlementBatch",
        batch.status,
        to,
      );

    switch (input.command) {
      case "RECONCILE": {
        transition("RECONCILING");
        await this.validateSettlementLines(batch, lines);
        batch.status = "RECONCILING";
        break;
      }
      case "SUBMIT": {
        transition("PENDING_APPROVAL");
        const total = parseDecimal(batch.totalAmount);
        if (total === 0n) {
          throw new ConflictError("EMPTY_SETTLEMENT");
        }
        if (total < 0n && batch.kind !== "RECOVERY") {
          throw new ConflictError("NEGATIVE_SETTLEMENT_REQUIRES_RECOVERY");
        }
        batch.status = "PENDING_APPROVAL";
        break;
      }
      case "APPROVE": {
        transition("APPROVED");
        if (!input.actorPersonId) {
          throw new ConflictError(
            "APPROVER_REQUIRED: settlement approval requires a person",
          );
        }
        batch.status = "APPROVED";
        batch.approvedBy = input.actorPersonId;
        batch.approvedAt = now();
        break;
      }
      case "LOCK": {
        transition("LOCKED");
        if (batch.kind === "RECOVERY") {
          const affected = [
            ...new Set(
              lines
                .filter(
                  (line) => line.active && parseDecimal(line.amount) < 0n,
                )
                .map((line) => line.personId),
            ),
          ];
          const blockers: string[] = [];
          for (const personId of affected) {
            const confirmation = this.confirmations.get(
              `${personId}:SETTLEMENT:${batch.id}`,
            );
            if (!confirmation) {
              blockers.push(`RECOVERY_CONFIRMATION_MISSING:${personId}`);
            } else if (confirmation.decision === "OBJECTED") {
              blockers.push(`RECOVERY_OBJECTION:${personId}`);
            } else if (confirmation.decision !== "CONFIRMED") {
              blockers.push(`RECOVERY_CONFIRMATION_MISSING:${personId}`);
            }
          }
          if (blockers.length > 0) {
            throw new ConflictError(blockers.join(","));
          }
        }
        batch.status = "LOCKED";
        batch.lockedAt = now();
        break;
      }
      case "EXPORT": {
        transition("EXPORTED");
        batch.status = "EXPORTED";
        batch.exportedAt = now();
        break;
      }
      case "ACKNOWLEDGE": {
        transition("ACKNOWLEDGED");
        batch.status = "ACKNOWLEDGED";
        batch.acknowledgedAt = now();
        batch.externalReference = input.externalReference;
        break;
      }
      case "REQUIRE_ADJUSTMENT": {
        transition("ADJUSTMENT_REQUIRED");
        batch.status = "ADJUSTMENT_REQUIRED";
        break;
      }
      case "CANCEL": {
        transition("CANCELLED");
        batch.status = "CANCELLED";
        for (const line of lines) {
          line.active = false;
          line.status = "CANCELLED";
        }
        batch.totalAmount = "0";
        batch.lineCount = 0;
        break;
      }
    }
    batch.updatedAt = now();
    this.settlementBatches.set(id, batch);
    const csv =
      input.command === "EXPORT" ? settlementCsv(batch, lines) : undefined;
    return {
      batch: { ...batch, lines: lines.map((line) => ({ ...line })) },
      csv,
    };
  }

  private async validateSettlementLines(
    batch: SettlementBatch,
    lines: SettlementLine[],
  ): Promise<void> {
    const ledger = new Map(
      (await this.listLedger()).map((entry) => [entry.id, entry]),
    );
    const seen = new Set<string>();
    for (const line of lines.filter((candidate) => candidate.active)) {
      if (seen.has(line.ledgerId)) {
        throw new ConflictError(
          `DUPLICATE_LEDGER_LINE: ${line.ledgerId}`,
        );
      }
      seen.add(line.ledgerId);
      const entry = ledger.get(line.ledgerId);
      if (!entry) {
        throw new ConflictError(`LEDGER_NOT_FOUND: ${line.ledgerId}`);
      }
      if (entry.status !== "LOCKED") {
        throw new ConflictError(
          `LEDGER_NOT_LOCKED: ${line.ledgerId} is ${entry.status}`,
        );
      }
      if (
        entry.personId !== line.personId ||
        entry.currency !== line.currency ||
        parseDecimal(entry.amount) !== parseDecimal(line.amount)
      ) {
        throw new ConflictError(
          `LEDGER_MISMATCH: settlement line ${line.id} does not match ledger ${entry.id}`,
        );
      }
    }
    const active = lines.filter((line) => line.active);
    const total = formatDecimal(
      sum(active.map((line) => parseDecimal(line.amount))),
    );
    if (formatDecimal(parseDecimal(batch.totalAmount)) !== total) {
      throw new ConflictError(
        `SETTLEMENT_TOTAL_MISMATCH: batch ${batch.totalAmount}, lines ${total}`,
      );
    }
    if (batch.lineCount !== active.length) {
      throw new ConflictError(
        `SETTLEMENT_LINE_COUNT_MISMATCH: batch ${batch.lineCount}, lines ${active.length}`,
      );
    }
  }

  async listAuditEvents(): Promise<AuditEvent[]> {
    return [];
  }

  async verifyAuditChain(): Promise<boolean> {
    return true;
  }

  async reverseLedgerEntry(
    id: string,
    input: {
      idempotencyKey: string;
      reason: string;
      approvedBy: string;
    },
  ): Promise<AmountLedgerEntry> {
    const original = (await this.listLedger()).find((entry) => entry.id === id);
    if (!original) notFound("LedgerEntry", id);
    if (original.status !== "LOCKED") {
      throw new ConflictError(
        `LEDGER_NOT_LOCKED: ${id} is ${original.status}`,
      );
    }
    const reversal = this.ledger.reverse(original.id, {
      tenantId: original.tenantId,
      personId: original.personId,
      cycleId: original.cycleId,
      calculationRunId: original.calculationRunId,
      calculationLineId: original.calculationLineId,
      currency: original.currency,
      idempotencyKey: input.idempotencyKey,
    });
    return this.ledger.lock(reversal.id);
  }

  async adjustLedgerEntry(
    id: string,
    input: {
      amount: string;
      reasonCode: string;
      explanation: string;
      approvedBy: string;
      idempotencyKey: string;
    },
  ): Promise<{ entry: AmountLedgerEntry; record: AdjustmentRecord }> {
    const original = (await this.listLedger()).find((entry) => entry.id === id);
    if (!original) notFound("LedgerEntry", id);
    if (original.status !== "LOCKED") {
      throw new ConflictError(
        `LEDGER_NOT_LOCKED: ${id} is ${original.status}`,
      );
    }
    let amount: bigint;
    try {
      amount = parseDecimal(input.amount);
    } catch {
      throw new ConflictError(`invalid adjustment amount ${input.amount}`);
    }
    if (amount === 0n) {
      throw new ConflictError("adjustment amount must not be zero");
    }
    const existing = (await this.listLedger()).find(
      (entry) =>
        entry.idempotencyKey === input.idempotencyKey &&
        entry.entryType === "ADJUSTMENT",
    );
    if (existing) {
      const record = [...this.adjustmentRecords.values()].find(
        (candidate) => candidate.adjustmentLedgerId === existing.id,
      );
      if (record) return { entry: existing, record };
    }
    const adjustment = this.ledger.append({
      tenantId: original.tenantId,
      personId: original.personId,
      cycleId: original.cycleId,
      calculationRunId: original.calculationRunId,
      calculationLineId: original.calculationLineId,
      entryType: "ADJUSTMENT",
      amount: formatDecimal(amount),
      currency: original.currency,
      sourceEntryId: id,
      idempotencyKey: input.idempotencyKey,
    });
    const entry = this.ledger.lock(adjustment.id);
    const timestamp = now();
    const record: AdjustmentRecord = {
      id: randomUUID(),
      tenantId: original.tenantId,
      originalLedgerId: id,
      adjustmentLedgerId: entry.id,
      reasonCode: input.reasonCode,
      explanation: input.explanation,
      approvedBy: input.approvedBy,
      approvedAt: timestamp,
      createdAt: timestamp,
    };
    this.adjustmentRecords.set(record.id, record);
    return { entry, record };
  }

  async listAdjustmentRecords(): Promise<AdjustmentRecord[]> {
    return [...this.adjustmentRecords.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async listLedger(tenantId = this.tenantId): Promise<AmountLedgerEntry[]> {
    return this.ledger.list(tenantId);
  }

  async verifyLedger(tenantId = this.tenantId): Promise<boolean> {
    return this.ledger.verifyChain(tenantId);
  }
}
