import { randomUUID } from "node:crypto";
import {
  assertAdjudicatorIsNotClaimant,
  assertTransition,
  attributionDecisionTransitions,
  calculationRunTransitions,
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
  type LegalGate,
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

export const DEFAULT_TENANT_ID = "tenant-demo";
export const DEFAULT_ENGINE_VERSION = "policy-dsl/0.1.0";

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

const policies = new Map<string, PolicyDefinition>([
  [
    "policy-v1",
    {
      code: "ORDER_CONTRIBUTION_V1",
      version: 1,
      currency: "CNY",
      poolRate: "0.05",
      poolCap: "100000",
      rounding: "HALF_UP",
      minimumWage: { monthlyMinimum: "2690", checked: false },
    },
  ],
]);

function now(): string {
  return new Date().toISOString();
}

function notFound(kind: string, id: string): never {
  throw new NotFoundError(`${kind} ${id} not found`);
}

export class Store {
  readonly ledger = new InMemoryLedger();
  private readonly workPackages = new Map<string, WorkPackage>();
  private readonly claims = new Map<string, ContributionClaim>();
  private readonly decisions = new Map<string, AttributionDecision>();
  private readonly runs = new Map<string, CalculationRun>();
  private readonly appeals = new Map<string, AppealCase>();

  getPolicy(policyVersionId: string): PolicyDefinition {
    const policy = policies.get(policyVersionId);
    if (!policy) notFound("Policy", policyVersionId);
    return policy;
  }

  createWorkPackage(input: CreateWorkPackageInput): WorkPackage {
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

  getWorkPackage(id: string): WorkPackage {
    return this.workPackages.get(id) ?? notFound("WorkPackage", id);
  }

  listWorkPackages(): WorkPackage[] {
    return [...this.workPackages.values()];
  }

  commitWorkPackage(id: string, expectedVersion: number): WorkPackage {
    const workPackage = this.getWorkPackage(id);
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

  startWorkPackage(id: string): WorkPackage {
    const workPackage = this.getWorkPackage(id);
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

  submitWorkPackage(id: string): WorkPackage {
    const workPackage = this.getWorkPackage(id);
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

  acceptWorkPackage(
    id: string,
    reviewerPersonId: string,
  ): WorkPackage {
    const workPackage = this.getWorkPackage(id);
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

  rejectWorkPackage(
    id: string,
    reviewerPersonId: string,
    reason: string,
  ): WorkPackage {
    const workPackage = this.getWorkPackage(id);
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

  createClaim(input: CreateContributionClaimInput): ContributionClaim {
    const workPackage = this.getWorkPackage(input.workPackageId);
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

  getClaim(id: string): ContributionClaim {
    return this.claims.get(id) ?? notFound("ContributionClaim", id);
  }

  submitClaim(id: string): ContributionClaim {
    const claim = this.getClaim(id);
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

  createAttributionDecision(
    input: CreateAttributionDecisionInput,
  ): AttributionDecision {
    const claim = this.getClaim(input.claimId);
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

  listDecisions(claimId?: string): AttributionDecision[] {
    return [...this.decisions.values()].filter(
      (decision) => !claimId || decision.claimId === claimId,
    );
  }

  hasConfirmedAttribution(
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

  createCalculationRun(
    input: CreateCalculationRunInput,
  ): CalculationRun {
    const policy = this.getPolicy(input.policyVersionId);
    const blockers = legalGateBlockers(
      input.mode,
      input.legalGate as LegalGate | undefined,
    );

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
      legalGate: input.legalGate,
    };

    const result = calculateOrderContribution(policy, calculationInput);
    const run: CalculationRun = {
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      cycleId: input.cycleId,
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

  getRun(id: string): CalculationRun {
    return this.runs.get(id) ?? notFound("CalculationRun", id);
  }

  listRuns(): CalculationRun[] {
    return [...this.runs.values()];
  }

  approveRun(id: string): CalculationRun {
    const run = this.getRun(id);
    assertTransition(
      calculationRunTransitions,
      "CalculationRun",
      run.status,
      "APPROVED",
    );
    run.status = "APPROVED";
    return run;
  }

  lockRun(id: string, confirmation: string): CalculationRun {
    if (confirmation !== "LOCK_CALCULATION") {
      throw new ConflictError("invalid lock confirmation");
    }
    const run = this.getRun(id);
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

  createAppeal(input: {
    appellantPersonId: string;
    targetType: "ATTRIBUTION" | "EVALUATION" | "LEDGER";
    targetId: string;
    reasonCode: string;
    statement: string;
  }): AppealCase {
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

  listAppeals(): AppealCase[] {
    return [...this.appeals.values()];
  }

  listLedger(tenantId = DEFAULT_TENANT_ID): AmountLedgerEntry[] {
    return this.ledger.list(tenantId);
  }

  verifyLedger(tenantId = DEFAULT_TENANT_ID): boolean {
    return this.ledger.verifyChain(tenantId);
  }
}
