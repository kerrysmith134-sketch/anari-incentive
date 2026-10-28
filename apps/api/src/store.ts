import { randomUUID } from "node:crypto";
import {
  appealCaseTransitions,
  assertAdjudicatorIsNotClaimant,
  assertTransition,
  attributionDecisionTransitions,
  calculationRunTransitions,
  confirmationBlockers,
  contributionClaimTransitions,
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
  type EvidenceLink,
  type EvidenceNode,
  type IngestionBatch,
  type IngestionResult,
  type LegalGateRecord,
  type PolicyDefinition,
  type PublishPolicyInput,
  type PublishedPolicy,
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

export function settlementCsv(
  batch: SettlementBatch,
  lines: SettlementLine[],
): string {
  const header = "batch_no,person_id,ledger_id,amount,currency";
  const rows = lines
    .filter((line) => line.active)
    .map((line) =>
      [
        batch.batchNo,
        line.personId,
        line.ledgerId,
        line.amount,
        line.currency,
      ].join(","),
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
  private readonly claims = new Map<string, ContributionClaim>();
  private readonly decisions = new Map<string, AttributionDecision>();
  private readonly runs = new Map<string, CalculationRun>();
  private readonly appeals = new Map<string, AppealCase>();
  private readonly legalGates = new Map<string, LegalGateRecord>();
  private readonly confirmations = new Map<string, EmployeeConfirmation>();
  private readonly evidence = new Map<string, EvidenceNode>();
  private readonly evidenceLinks = new Map<string, EvidenceLink>();
  private readonly ingestedKeys = new Set<string>();
  private readonly publishedPolicies = new Map<string, PolicyDefinition>();
  private readonly publishedPolicyKeys = new Set<string>();
  private readonly settlementBatches = new Map<string, SettlementBatch>();
  private readonly settlementLines = new Map<string, SettlementLine[]>();

  constructor(private readonly tenantId: string = DEFAULT_TENANT_ID) {}

  async ping(): Promise<void> {
    return;
  }

  async getPolicy(policyVersionId: string): Promise<PolicyDefinition> {
    const policy =
      this.publishedPolicies.get(policyVersionId) ??
      policies.get(policyVersionId);
    if (!policy) notFound("Policy", policyVersionId);
    return policy;
  }

  async publishPolicy(input: PublishPolicyInput): Promise<PublishedPolicy> {
    const policyVersionId = input.policyVersionId ?? randomUUID();
    if (
      this.publishedPolicies.has(policyVersionId) ||
      policies.has(policyVersionId)
    ) {
      throw new ConflictError(`Policy ${policyVersionId} already exists`);
    }
    const policyKey = `${input.policy.code}:${input.policy.version}`;
    if (this.publishedPolicyKeys.has(policyKey)) {
      throw new ConflictError(`Policy ${policyKey} already exists`);
    }

    const publishedAt = now();
    const contentHash = sha256(input.policy);
    this.publishedPolicies.set(policyVersionId, input.policy);
    this.publishedPolicyKeys.add(policyKey);
    return {
      policyVersionId,
      policy: input.policy,
      contentHash,
      effectiveFrom: input.effectiveFrom,
      publishedAt,
      approvedBy: input.approvedBy,
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
    return workPackage;
  }

  async startWorkPackage(id: string): Promise<WorkPackage> {
    const workPackage = await this.getWorkPackage(id);
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

  async submitWorkPackage(id: string): Promise<WorkPackage> {
    const workPackage = await this.getWorkPackage(id);
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
  ): Promise<WorkPackage> {
    const workPackage = await this.getWorkPackage(id);
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

  async rejectWorkPackage(
    id: string,
    reviewerPersonId: string,
    reason: string,
  ): Promise<WorkPackage> {
    const workPackage = await this.getWorkPackage(id);
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
    }
  }

  async createAppeal(input: {
    appellantPersonId: string;
    targetType: "ATTRIBUTION" | "EVALUATION" | "LEDGER" | "CALCULATION";
    targetId: string;
    reasonCode: string;
    statement: string;
  }): Promise<AppealCase> {
    const appeal: AppealCase = {
      id: randomUUID(),
      tenantId: this.tenantId,
      appellantPersonId: input.appellantPersonId,
      targetType: input.targetType,
      targetId: input.targetId,
      reasonCode: input.reasonCode,
      statement: input.statement,
      status: "OPEN",
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

  async createSettlementBatch(input: {
    cycleId: string;
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
    const batch: SettlementBatch = {
      id,
      tenantId: this.tenantId,
      cycleId: input.cycleId,
      batchNo,
      status: "DRAFT",
      currency,
      totalAmount: formatDecimal(
        sum(lines.map((line) => parseDecimal(line.amount))),
      ),
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
        if (parseDecimal(batch.totalAmount) <= 0n) {
          throw new ConflictError(
            "EMPTY_SETTLEMENT: batch total must be positive",
          );
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

  async listLedger(tenantId = this.tenantId): Promise<AmountLedgerEntry[]> {
    return this.ledger.list(tenantId);
  }

  async verifyLedger(tenantId = this.tenantId): Promise<boolean> {
    return this.ledger.verifyChain(tenantId);
  }
}
