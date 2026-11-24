import { randomUUID } from "node:crypto";
import {
  assertAdjudicatorIsNotClaimant,
  assertTransition,
  attributionDecisionTransitions,
  contributionClaimTransitions,
  type AttributionDecision,
  type ContributionAttestation,
  type ContributionClaim,
  type EvidenceNode,
  type ContributionAssessmentDraft,
  type ContributionAssessmentDraftFilter,
  type CreateContributionAssessmentDraftInput,
  type ContributionEvent,
  type ContributionEventFilter,
  type ContributionEventIngestResult,
  type CreateContributionEventInput,
} from "@anari/domain";
import type {
  CreateAttributionDecisionInput,
  CreateContributionAttestationBody,
  CreateContributionClaimInput,
} from "@anari/contracts";
import {
  NotFoundError,
  ConflictError,
  now,
  notFound,
} from "../store-support.js";
import type { IncentiveStore } from "../store-interface.js";
import type { WorkPackageApi } from "./work-package.js";
import { StoreBase, type StoreCtor } from "./base.js";

export type ContributionApi = Pick<
  IncentiveStore,
  | "createClaim"
  | "getClaim"
  | "listClaims"
  | "submitClaim"
  | "createAttributionDecision"
  | "createAttributionDecisionsBatch"
  | "listDecisions"
  | "createContributionAttestation"
  | "listContributionAttestations"
  | "withdrawContributionAttestation"
  | "createContributionAssessmentDraft"
  | "listContributionAssessmentDrafts"
  | "getContributionAssessmentDraft"
  | "submitContributionAssessmentDraft"
  | "discardContributionAssessmentDraft"
  | "linkContributionAssessmentDecision"
  | "ingestContributionEvents"
  | "listContributionEvents"
  | "getContributionEvent"
>;

/**
 * Mixes the contribution domain into the store chain. Methods keep the exact
 * behaviour of the former monolithic Store implementation.
 */
export function withContribution<TBase extends StoreCtor<StoreBase & WorkPackageApi>>(Base: TBase) {
  const Mixin = class ContributionMixin extends Base implements ContributionApi {

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
    const claimMode = input.claimMode ?? "STANDARD";
    if (claimMode !== "STANDARD" && !input.exceptionReason?.trim()) {
      throw new ConflictError(
        "CLAIM_EXCEPTION_REASON_REQUIRED: exception and backfill claims need a reason",
      );
    }
    const timestamp = now();
    const claim: ContributionClaim = {
      id: randomUUID(),
      tenantId: this.tenantId,
      workPackageId: input.workPackageId,
      claimantPersonId: input.claimantPersonId,
      claimType: input.claimType,
      claimMode,
      exceptionReason:
        claimMode === "STANDARD" ? undefined : input.exceptionReason?.trim(),
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

  async createContributionAttestation(
    input: CreateContributionAttestationBody,
  ): Promise<ContributionAttestation> {
    const workPackage = await this.getWorkPackage(input.workPackageId);
    const participants = new Set([
      workPackage.ownerPersonId,
      ...workPackage.members.map((member) => member.personId),
    ]);
    if (!participants.has(input.subjectPersonId)) {
      throw new ConflictError(
        "ATTESTATION_SUBJECT_NOT_PARTICIPANT: subject is not on the work package",
      );
    }
    if (input.subjectPersonId === input.attesterPersonId) {
      throw new ConflictError(
        "ATTESTATION_SELF: a person cannot attest their own contribution",
      );
    }
    const timestamp = now();
    const attestation: ContributionAttestation = {
      id: randomUUID(),
      tenantId: this.tenantId,
      workPackageId: input.workPackageId,
      subjectPersonId: input.subjectPersonId,
      attesterPersonId: input.attesterPersonId,
      attestationType: input.attestationType,
      statement: input.statement,
      evidenceRefs: [...(input.evidenceRefs ?? [])],
      status: "SUBMITTED",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.attestations.set(attestation.id, attestation);
    return attestation;
  }

  async listContributionAttestations(filter?: {
    workPackageId?: string;
    subjectPersonId?: string;
  }): Promise<ContributionAttestation[]> {
    return [...this.attestations.values()]
      .filter(
        (attestation) =>
          (!filter?.workPackageId ||
            attestation.workPackageId === filter.workPackageId) &&
          (!filter?.subjectPersonId ||
            attestation.subjectPersonId === filter.subjectPersonId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async withdrawContributionAttestation(
    id: string,
    requesterPersonId: string,
  ): Promise<ContributionAttestation> {
    const attestation = this.attestations.get(id);
    if (!attestation) notFound("ContributionAttestation", id);
    if (attestation.attesterPersonId !== requesterPersonId) {
      throw new ConflictError(
        "ATTESTATION_WITHDRAWAL_FORBIDDEN: only the attester can withdraw",
      );
    }
    if (attestation.status === "WITHDRAWN") {
      throw new ConflictError(
        `contribution attestation ${id} is already withdrawn`,
      );
    }
    attestation.status = "WITHDRAWN";
    attestation.withdrawnAt = now();
    attestation.updatedAt = attestation.withdrawnAt;
    return attestation;
  }

  async createContributionAssessmentDraft(
    input: CreateContributionAssessmentDraftInput,
  ): Promise<ContributionAssessmentDraft> {
    const claim = this.claims.get(input.claimId);
    if (!claim) {
      throw new NotFoundError(`ContributionClaim ${input.claimId} not found`);
    }
    this.assertAssessmentDraftUsable(input, claim);
    const timestamp = now();
    const draft: ContributionAssessmentDraft = {
      id: randomUUID(),
      tenantId: this.tenantId,
      claimId: input.claimId,
      subjectPersonId: claim.claimantPersonId,
      generatedByType: input.generatedByType,
      generatedById: input.generatedById,
      modelProvider: input.modelProvider,
      modelName: input.modelName,
      promptVersion: input.promptVersion,
      supporting: input.supporting,
      counter: input.counter,
      missingInformation: input.missingInformation,
      alternativeExplanations: input.alternativeExplanations,
      uncertainty: input.uncertainty,
      basedOnEventIds: input.basedOnEventIds,
      activityEventsExcluded: true,
      status: "DRAFT",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.contributionAssessmentDrafts.set(draft.id, draft);
    return draft;
  }

  async listContributionAssessmentDrafts(
    filter?: ContributionAssessmentDraftFilter,
  ): Promise<ContributionAssessmentDraft[]> {
    let drafts = [...this.contributionAssessmentDrafts.values()];
    if (filter?.claimId) {
      drafts = drafts.filter((draft) => draft.claimId === filter.claimId);
    }
    if (filter?.subjectPersonId) {
      drafts = drafts.filter(
        (draft) => draft.subjectPersonId === filter.subjectPersonId,
      );
    }
    if (filter?.status) {
      drafts = drafts.filter((draft) => draft.status === filter.status);
    }
    return drafts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async getContributionAssessmentDraft(
    id: string,
  ): Promise<ContributionAssessmentDraft> {
    const draft = this.contributionAssessmentDrafts.get(id);
    if (!draft) {
      throw new NotFoundError(`ContributionAssessmentDraft ${id} not found`);
    }
    return draft;
  }

  async submitContributionAssessmentDraft(
    id: string,
  ): Promise<ContributionAssessmentDraft> {
    const draft = await this.getContributionAssessmentDraft(id);
    if (draft.status !== "DRAFT") {
      throw new ConflictError(
        `ASSESSMENT_DRAFT_NOT_DRAFT: draft is ${draft.status}`,
      );
    }
    draft.status = "SUBMITTED";
    draft.updatedAt = now();
    return draft;
  }

  async discardContributionAssessmentDraft(
    id: string,
  ): Promise<ContributionAssessmentDraft> {
    const draft = await this.getContributionAssessmentDraft(id);
    if (draft.status === "DECIDED" || draft.status === "DISCARDED") {
      throw new ConflictError(
        `ASSESSMENT_DRAFT_NOT_DISCARDABLE: draft is ${draft.status}`,
      );
    }
    draft.status = "DISCARDED";
    draft.updatedAt = now();
    return draft;
  }

  /** 硬规则：SUBMITTED 后链接已存在的人工归属决定才转 DECIDED。 */
  async linkContributionAssessmentDecision(
    id: string,
    input: { attributionDecisionId: string; linkedBy: string },
  ): Promise<ContributionAssessmentDraft> {
    const draft = await this.getContributionAssessmentDraft(id);
    if (draft.status !== "SUBMITTED") {
      throw new ConflictError(
        `ASSESSMENT_DRAFT_NOT_SUBMITTED: ${draft.status} drafts cannot be linked to a decision; submit first`,
      );
    }
    const decision = this.decisions.get(input.attributionDecisionId);
    if (!decision) {
      throw new NotFoundError(
        `AttributionDecision ${input.attributionDecisionId} not found; a human attribution decision must exist first`,
      );
    }
    if (decision.claimId !== draft.claimId) {
      throw new ConflictError(
        "ASSESSMENT_DECISION_CLAIM_MISMATCH: decision belongs to a different claim",
      );
    }
    draft.status = "DECIDED";
    draft.attributionDecisionId = decision.id;
    draft.updatedAt = now();
    return draft;
  }

  /** NPV2-016 校验：断言必须有证据引用；依据事件不得含 ACTIVITY 事件。 */
  private assertAssessmentDraftUsable(
    input: CreateContributionAssessmentDraftInput,
    claim: ContributionClaim,
  ): void {
    const assertions = [
      ...input.supporting,
      ...input.counter,
      ...input.alternativeExplanations,
    ];
    if (assertions.some((a) => a.evidenceRefs.length === 0)) {
      throw new ConflictError(
        "ASSESSMENT_ASSERTION_REQUIRES_EVIDENCE: every assertion must cite evidence",
      );
    }
    // AUD-008：证据引用必须真实可解析且与 claim 主体相关——
    // 不存在 → NotFound；跨主体（非 claim 本身、非申报人）→ 拒绝。
    const refs = new Set(assertions.flatMap((a) => a.evidenceRefs));
    for (const ref of refs) {
      const node = this.evidence.get(ref);
      if (!node) {
        throw new NotFoundError(`EvidenceNode ${ref} not found`);
      }
      const claimScoped = node.subjectId === claim.id;
      const subjectScoped =
        node.subjectType === "PERSON" && node.subjectId === claim.claimantPersonId;
      if (!claimScoped && !subjectScoped) {
        throw new ConflictError(
          `ASSESSMENT_EVIDENCE_CROSS_SUBJECT: ${ref} does not belong to claim ${claim.id} or its subject`,
        );
      }
    }
    for (const eventId of input.basedOnEventIds) {
      const event = this.contributionEvents.get(eventId);
      if (!event) {
        throw new NotFoundError(`ContributionEvent ${eventId} not found`);
      }
      if (event.kind === "ACTIVITY") {
        throw new ConflictError(
          `ACTIVITY_EVENT_NOT_USABLE_AS_CONTRIBUTION: ${eventId} is an activity record and may not back a contribution assertion`,
        );
      }
    }
  }

  /**
   * NPV2-015：贡献事件批量录入（幂等）。重复 (source, externalId) 命中
   * 既有事件放入 duplicates；ACTIVITY 事件仅记录活动量事实。
   */
  async ingestContributionEvents(
    inputs: CreateContributionEventInput[],
  ): Promise<ContributionEventIngestResult> {
    const inserted: ContributionEvent[] = [];
    const duplicates: ContributionEvent[] = [];
    for (const input of inputs) {
      // NPV2-015：更正链必须指向已存在的事件（与 PG 实现一致）。
      if (input.correctionOfEventId && !this.contributionEvents.has(input.correctionOfEventId)) {
        throw new NotFoundError(
          `ContributionEvent ${input.correctionOfEventId} not found (correction target)`,
        );
      }
      const key =
        input.source && input.externalId
          ? `${input.source}:${input.externalId}`
          : null;
      if (key) {
        const existing = [...this.contributionEvents.values()].find(
          (event) =>
            event.source === input.source &&
            event.externalId === input.externalId,
        );
        if (existing) {
          duplicates.push(existing);
          continue;
        }
      }
      const event: ContributionEvent = {
        id: randomUUID(),
        tenantId: this.tenantId,
        ...input,
        createdAt: now(),
      };
      this.contributionEvents.set(event.id, event);
      inserted.push(event);
    }
    return { inserted, duplicates };
  }

  async listContributionEvents(
    filter?: ContributionEventFilter,
  ): Promise<ContributionEvent[]> {
    let events = [...this.contributionEvents.values()];
    if (filter?.subjectPersonId) {
      events = events.filter(
        (event) => event.subjectPersonId === filter.subjectPersonId,
      );
    }
    if (filter?.kind) {
      events = events.filter((event) => event.kind === filter.kind);
    }
    if (filter?.source) {
      events = events.filter((event) => event.source === filter.source);
    }
    if (filter?.occurredFrom) {
      events = events.filter((event) => event.occurredAt >= filter.occurredFrom!);
    }
    if (filter?.occurredTo) {
      events = events.filter((event) => event.occurredAt <= filter.occurredTo!);
    }
    return events.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  }

  async getContributionEvent(id: string): Promise<ContributionEvent> {
    const event = this.contributionEvents.get(id);
    if (!event) throw new NotFoundError(`ContributionEvent ${id} not found`);
    return event;
  }
  };
  return Mixin as unknown as TBase & StoreCtor<ContributionApi>;
}
