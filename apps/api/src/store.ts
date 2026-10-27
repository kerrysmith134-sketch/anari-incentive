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
  workPackageTransitions,
  type AmountLedgerEntry,
  type AppealCase,
  type AttributionDecision,
  type CalculationInput,
  type CalculationRun,
  type CommitmentSnapshot,
  type ContributionClaim,
  type EmployeeConfirmation,
  type LegalGateRecord,
  type PolicyDefinition,
  type WorkPackage,
} from "@anari/domain";
import type {
  CreateAttributionDecisionInput,
  CreateCalculationRunInput,
  CreateContributionClaimInput,
  CreateWorkPackageInput,
} from "@anari/contracts";
import { InMemoryLedger } from "@anari/ledger";
import { calculateOrderContribution, sha256 } from "@anari/policy-dsl";
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

  async getPolicy(policyVersionId: string): Promise<PolicyDefinition> {
    const policy = policies.get(policyVersionId);
    if (!policy) notFound("Policy", policyVersionId);
    return policy;
  }

  async createWorkPackage(
    input: CreateWorkPackageInput,
  ): Promise<WorkPackage> {
    const timestamp = now();
    const workPackage: WorkPackage = {
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
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
      tenantId: DEFAULT_TENANT_ID,
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
      tenantId: DEFAULT_TENANT_ID,
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
      tenantId: DEFAULT_TENANT_ID,
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
      tenantId: DEFAULT_TENANT_ID,
      cycleId: input.cycleId,
      policyVersionId: input.policyVersionId,
      mode: input.mode,
      order: input.order,
      participants: input.participants,
      legalGate: gate,
    };

    const result = calculateOrderContribution(policy, calculationInput);
    const run: CalculationRun = {
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
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
      tenantId: DEFAULT_TENANT_ID,
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
    targetType: "ATTRIBUTION" | "EVALUATION" | "LEDGER";
    targetId: string;
    reasonCode: string;
    statement: string;
  }): Promise<AppealCase> {
    const appeal: AppealCase = {
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
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

  async listLedger(tenantId = DEFAULT_TENANT_ID): Promise<AmountLedgerEntry[]> {
    return this.ledger.list(tenantId);
  }

  async verifyLedger(tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
    return this.ledger.verifyChain(tenantId);
  }
}
