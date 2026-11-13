/**
 * NPV2-013：激励运营 Adapter（IncentivePort，方法体逐字平移）。
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  divRound,
  formatDecimal,
  parseDecimal,
  sha256,
} from "@anari/policy-dsl";
import type {
  Acceptance,
  AdverseActionCase,
  AiScoreProposal,
  AiSuggestionLog,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRiskTier,
  ApprovalStatus,
  AuditRedaction,
  BudgetAllocation,
  BudgetPool,
  Bounty,
  BreakGlassGrant,
  CashGateInput,
  ClawbackCase,
  CompensationTemplate,
  ConsultationOutcome,
  ConflictDeclaration,
  ConsultationType,
  DataSource,
  DataSourceField,
  Deliverable,
  DpiaAssessmentType,
  DiscretionaryPoolReview,
  DpiaRecord,
  DsarRequest,
  DsarRequestType,
  EmployeeNotice,
  EmployeeRepresentation,
  EmploymentContract,
  ESignEnvelope,
  EmploymentContractAmendment,
  EquityExercise,
  EquityGrant,
  EquityVesting,
  ExternalIdentity,
  FairnessCommitment,
  FinancialFact,
  CalibrationSession,
  ManagerTrainingRecord,
  IntegrationConnection,
  IntegrationMapping,
  InboxMessage,
  MetricDefinition,
  ModelCanaryRun,
  ModelEvaluationDataset,
  ModelEvaluationRun,
  ModelRedTeamRun,
  ModelPrompt,
  ModelProviderPolicy,
  PolicyEngineRecord,
  IncentiveAwardBatch,
  IncentiveAwardType,
  NoticeAcknowledgementOverview,
  NoticeType,
  PlatformIdentity,
  PlatformMembership,
  PlatformOrgAssignment,
  PlatformOrgNode,
  PlatformPerson,
  PlatformTenant,
  PlatformUser,
  SubscriptionPlan,
  TenantInvoice,
  TenantInvoiceLineItem,
  TenantInvoiceStatus,
  TenantSubscription,
  TenantSubscriptionStatus,
  PayrollLine,
  PayrollRun,
  PilotEnrollment,
  PolicyAcknowledgement,
  PolicyConsultation,
  PolicyNotice,
  PolicyTestCase,
  PolicyTestRun,
  RepresentationBodyType,
  AppealEvidenceDisclosure,
  RetentionDisposalRequest,
  RetentionPolicy,
  WorkforceSubgroupAttribute,
  WorkforceSubgroupDimension,
  RuleChangeOrder,
  SettlementAcknowledgement,
  SettlementExport,
  SyncSchedule,
  StrategicPoolCase,
  SyncRun,
  TrustSurveyQuestion,
  TrustSurveyReport,
  TrustSurveyResponse,
  TrustSurveyRun,
  WebhookInboxMessage,
  WorkflowRun,
} from "@anari/domain";
import { adverseActionTransitions, assertTransition } from "@anari/domain";
import { ConflictError, NotFoundError } from "../../store.js";
import type { PlatformStore } from "../../platform-store.js";
import { formatInvoiceAmount, now, notFound, surveyAverage, aggregateSurveyReport, iso, isoDate, decimalText, addUtcMonths, computeEquityVesting, money } from "../shared.js";
import type { IncentivePort } from "../../store-ports.js";
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

export function MemoryIncentiveMixin(Base: abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape) {
  return class extends Base implements IncentivePort {
    
    async createStrategicPoolCase(input: {
      tenantId: string;
      cycleId: string;
      poolAmount: string;
      capAmount: string;
      currency: string;
      budgetPoolId?: string;
      rationale: string;
      requestedBy: string;
    }): Promise<StrategicPoolCase> {
      const record: StrategicPoolCase = {
        id: randomUUID(),
        tenantId: input.tenantId,
        cycleId: input.cycleId,
        poolAmount: input.poolAmount,
        capAmount: input.capAmount,
        currency: input.currency,
        budgetPoolId: input.budgetPoolId,
        rationale: input.rationale,
        requestedBy: input.requestedBy,
        deferredInstallmentMonths: 0,
        status: "DRAFT",
        createdAt: now(),
        updatedAt: now(),
      };
      this.strategicPoolCases.set(record.id, record);
      return record;
    }
    
    async listStrategicPoolCases(
      tenantId: string,
    ): Promise<StrategicPoolCase[]> {
      return [...this.strategicPoolCases.values()]
        .filter((record) => record.tenantId === tenantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async updateStrategicPoolCase(input: {
      tenantId: string;
      caseId: string;
      patch: Partial<Omit<StrategicPoolCase, "id" | "tenantId">>;
    }): Promise<StrategicPoolCase> {
      const record = this.strategicPoolCases.get(input.caseId);
      if (!record || record.tenantId !== input.tenantId) {
        notFound("StrategicPoolCase", input.caseId);
      }
      const updated: StrategicPoolCase = {
        ...record,
        ...input.patch,
        updatedAt: now(),
      };
      this.strategicPoolCases.set(record.id, updated);
      return updated;
    }
    
    async createClawbackCase(input: {
      tenantId: string;
      personId: string;
      amount: string;
      currency: string;
      reasonCode: string;
      explanation: string;
      consentSignatureRef: string;
      installmentMonths: number;
      hardshipWaiver: boolean;
      hardshipReason?: string;
      requestedBy: string;
    }): Promise<ClawbackCase> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      for (const personId of [input.personId, input.requestedBy]) {
        const person = this.persons.get(personId);
        if (!person || person.tenantId !== input.tenantId) {
          notFound("Person", personId);
        }
      }
      if (parseDecimal(input.amount) <= 0n) {
        throw new ConflictError("CLAWBACK_AMOUNT_MUST_BE_POSITIVE");
      }
      if (!input.consentSignatureRef.trim()) {
        throw new ConflictError("CLAWBACK_CONSENT_REQUIRED");
      }
      if (input.installmentMonths < 1 || input.installmentMonths > 12) {
        throw new ConflictError("CLAWBACK_INSTALLMENTS_OUT_OF_RANGE");
      }
      if (input.hardshipWaiver && !input.hardshipReason?.trim()) {
        throw new ConflictError("CLAWBACK_HARDSHIP_REASON_REQUIRED");
      }
      const timestamp = now();
      const clawback: ClawbackCase = {
        id: randomUUID(),
        tenantId: input.tenantId,
        personId: input.personId,
        amount: formatDecimal(parseDecimal(input.amount)),
        currency: input.currency,
        reasonCode: input.reasonCode,
        explanation: input.explanation,
        consentSignatureRef: input.consentSignatureRef,
        installmentMonths: input.installmentMonths,
        hardshipWaiver: input.hardshipWaiver,
        hardshipReason: input.hardshipReason,
        status: "DRAFT",
        requestedBy: input.requestedBy,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.clawbackCases.set(clawback.id, clawback);
      return clawback;
    }
    
    async listClawbackCases(
      tenantId: string,
      personId?: string,
    ): Promise<ClawbackCase[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.clawbackCases.values()]
        .filter(
          (clawback) =>
            clawback.tenantId === tenantId &&
            (!personId || clawback.personId === personId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async approveClawbackCase(input: {
      tenantId: string;
      caseId: string;
      approvedBy: string;
    }): Promise<ClawbackCase> {
      const clawback = this.clawbackCases.get(input.caseId);
      if (!clawback || clawback.tenantId !== input.tenantId) {
        notFound("ClawbackCase", input.caseId);
      }
      if (clawback.status !== "DRAFT") {
        throw new ConflictError(`clawback case is ${clawback.status}`);
      }
      const approver = this.persons.get(input.approvedBy);
      if (!approver || approver.tenantId !== input.tenantId) {
        notFound("Person", input.approvedBy);
      }
      if (input.approvedBy === clawback.requestedBy) {
        throw new ConflictError(
          "CLAWBACK_SELF_APPROVAL: requester cannot approve the case",
        );
      }
      clawback.status = "APPROVED";
      clawback.approvedBy = input.approvedBy;
      clawback.approvedAt = now();
      clawback.updatedAt = clawback.approvedAt;
      return clawback;
    }
    
    async excludeLedgerFromSettlement(input: {
      tenantId: string;
      ledgerIds: string[];
      reason: string;
      actorPersonId: string;
    }): Promise<number> {
      // Memory store: no settlement sweep runs, so nothing to exclude.
      void input;
      return 0;
    }
    
    async markClawbackRecoveryGenerated(input: {
      tenantId: string;
      caseId: string;
    }): Promise<ClawbackCase> {
      const clawback = this.clawbackCases.get(input.caseId);
      if (!clawback || clawback.tenantId !== input.tenantId) {
        notFound("ClawbackCase", input.caseId);
      }
      if (clawback.status !== "APPROVED") {
        throw new ConflictError(`clawback case is ${clawback.status}`);
      }
      clawback.status = "RECOVERY_GENERATED";
      clawback.updatedAt = now();
      return clawback;
    }
    
    async closeClawbackCase(input: {
      tenantId: string;
      caseId: string;
      action: "WAIVE" | "CANCEL";
      reason: string;
      actorPersonId: string;
    }): Promise<ClawbackCase> {
      const clawback = this.clawbackCases.get(input.caseId);
      if (!clawback || clawback.tenantId !== input.tenantId) {
        notFound("ClawbackCase", input.caseId);
      }
      if (!["DRAFT", "APPROVED", "RECOVERY_GENERATED"].includes(clawback.status)) {
        throw new ConflictError(`clawback case is ${clawback.status}`);
      }
      const actor = this.persons.get(input.actorPersonId);
      if (!actor || actor.tenantId !== input.tenantId) {
        notFound("Person", input.actorPersonId);
      }
      if (input.action === "WAIVE") {
        clawback.status = "WAIVED";
        clawback.waivedAt = now();
        clawback.waiverReason = input.reason;
        clawback.updatedAt = clawback.waivedAt;
      } else {
        clawback.status = "CANCELLED";
        clawback.cancelledAt = now();
        clawback.cancelReason = input.reason;
        clawback.updatedAt = clawback.cancelledAt;
      }
      return clawback;
    }
    
    async createEquityGrant(input: {
      tenantId: string;
      personId: string;
      grantCode: string;
      grantType: EquityGrant["grantType"];
      totalUnits: string;
      strikePrice: string;
      currency: string;
      grantDate: string;
      vestingStart: string;
      cliffMonths: number;
      vestingMonths: number;
    }): Promise<EquityGrant> {
      if (!this.tenants.has(input.tenantId)) {
        notFound("Tenant", input.tenantId);
      }
      const person = this.persons.get(input.personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.personId);
      }
      if (
        [...this.equityGrants.values()].some(
          (grant) =>
            grant.tenantId === input.tenantId &&
            grant.grantCode === input.grantCode,
        )
      ) {
        throw new ConflictError(
          `equity grant ${input.grantCode} already exists`,
        );
      }
      if (parseDecimal(input.totalUnits) <= 0n) {
        throw new ConflictError("EQ_TOTAL_UNITS_MUST_BE_POSITIVE");
      }
      if (parseDecimal(input.strikePrice) < 0n) {
        throw new ConflictError("EQ_STRIKE_PRICE_MUST_BE_NON_NEGATIVE");
      }
      if (input.cliffMonths > input.vestingMonths) {
        throw new ConflictError("EQ_CLIFF_EXCEEDS_VESTING");
      }
      const timestamp = now();
      const grant: EquityGrant = {
        id: randomUUID(),
        tenantId: input.tenantId,
        personId: input.personId,
        grantCode: input.grantCode,
        grantType: input.grantType,
        totalUnits: formatDecimal(parseDecimal(input.totalUnits)),
        strikePrice: formatDecimal(parseDecimal(input.strikePrice)),
        currency: input.currency,
        grantDate: input.grantDate,
        vestingStart: input.vestingStart,
        cliffMonths: input.cliffMonths,
        vestingMonths: input.vestingMonths,
        status: "ACTIVE",
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      this.equityGrants.set(grant.id, grant);
      return grant;
    }
    
    async listEquityGrants(
      tenantId: string,
      personId?: string,
    ): Promise<EquityGrant[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.equityGrants.values()]
        .filter(
          (grant) =>
            grant.tenantId === tenantId &&
            (!personId || grant.personId === personId),
        )
        .sort((a, b) => b.grantDate.localeCompare(a.grantDate));
    }
    
    async updateEquityGrant(input: {
      tenantId: string;
      grantId: string;
      patch: {
        totalUnits?: string;
        strikePrice?: string;
        grantDate?: string;
        vestingStart?: string;
        cliffMonths?: number;
        vestingMonths?: number;
      };
      reason: string;
      actorPersonId?: string;
    }): Promise<EquityGrant> {
      if (!input.reason.trim()) {
        throw new ConflictError("EQ_ADJUST_REASON_REQUIRED");
      }
      const grant = this.equityGrants.get(input.grantId);
      if (!grant || grant.tenantId !== input.tenantId) {
        notFound("EquityGrant", input.grantId);
      }
      if (grant.status !== "ACTIVE") {
        throw new ConflictError(
          `EQ_GRANT_NOT_EDITABLE: grant is ${grant.status}`,
        );
      }
      const activeUnits = [...this.equityExercises.values()]
        .filter(
          (exercise) =>
            exercise.grantId === grant.id &&
            exercise.status !== "CANCELLED",
        )
        .reduce((sum, exercise) => sum + parseDecimal(exercise.units), 0n);
      const nextTotal = input.patch.totalUnits
        ? parseDecimal(input.patch.totalUnits)
        : parseDecimal(grant.totalUnits);
      if (nextTotal <= 0n) {
        throw new ConflictError("EQ_TOTAL_UNITS_MUST_BE_POSITIVE");
      }
      if (nextTotal < activeUnits) {
        throw new ConflictError(
          `EQ_UNITS_BELOW_EXERCISED: ${formatDecimal(activeUnits)} units are already exercised or pending`,
        );
      }
      const nextStrike = input.patch.strikePrice
        ? parseDecimal(input.patch.strikePrice)
        : parseDecimal(grant.strikePrice);
      if (nextStrike < 0n) {
        throw new ConflictError("EQ_STRIKE_PRICE_MUST_BE_NON_NEGATIVE");
      }
      const nextCliff = input.patch.cliffMonths ?? grant.cliffMonths;
      const nextVesting = input.patch.vestingMonths ?? grant.vestingMonths;
      if (nextCliff > nextVesting) {
        throw new ConflictError("EQ_CLIFF_EXCEEDS_VESTING");
      }
      const updated: EquityGrant = {
        ...grant,
        totalUnits: input.patch.totalUnits
          ? formatDecimal(nextTotal)
          : grant.totalUnits,
        strikePrice: input.patch.strikePrice
          ? formatDecimal(nextStrike)
          : grant.strikePrice,
        grantDate: input.patch.grantDate ?? grant.grantDate,
        vestingStart: input.patch.vestingStart ?? grant.vestingStart,
        cliffMonths: nextCliff,
        vestingMonths: nextVesting,
        updatedAt: now(),
        version: grant.version + 1,
      };
      this.equityGrants.set(updated.id, updated);
      return updated;
    }
    
    async getEquityGrant(
      tenantId: string,
      grantId: string,
    ): Promise<EquityGrant> {
      const grant = this.equityGrants.get(grantId);
      if (!grant || grant.tenantId !== tenantId) {
        notFound("EquityGrant", grantId);
      }
      return grant;
    }
    
    async getEquityVesting(
      tenantId: string,
      grantId: string,
      asOf = new Date().toISOString(),
    ): Promise<EquityVesting> {
      const grant = await this.getEquityGrant(tenantId, grantId);
      const exercises = [...this.equityExercises.values()].filter(
        (exercise) =>
          exercise.tenantId === tenantId &&
          exercise.grantId === grant.id,
      );
      return computeEquityVesting(grant, exercises, asOf);
    }
    
    async createEquityExercise(input: {
      tenantId: string;
      grantId: string;
      units: string;
      requestedBy: string;
    }): Promise<EquityExercise> {
      const grant = await this.getEquityGrant(
        input.tenantId,
        input.grantId,
      );
      if (grant.status !== "ACTIVE") {
        throw new ConflictError(`equity grant is ${grant.status}`);
      }
      const requester = this.persons.get(input.requestedBy);
      if (!requester || requester.tenantId !== input.tenantId) {
        notFound("Person", input.requestedBy);
      }
      const units = parseDecimal(input.units);
      if (units <= 0n) {
        throw new ConflictError("EQ_UNITS_MUST_BE_POSITIVE");
      }
      const vesting = await this.getEquityVesting(
        input.tenantId,
        grant.id,
      );
      if (units > parseDecimal(vesting.availableUnits)) {
        throw new ConflictError(
          `EQ_UNITS_EXCEED_AVAILABLE: ${vesting.availableUnits}`,
        );
      }
      const totalCost = (units * parseDecimal(grant.strikePrice)) / 1_000_000n;
      const timestamp = now();
      const exercise: EquityExercise = {
        id: randomUUID(),
        tenantId: input.tenantId,
        grantId: grant.id,
        personId: grant.personId,
        units: formatDecimal(units),
        strikePrice: grant.strikePrice,
        totalCost: formatDecimal(totalCost),
        currency: grant.currency,
        status: "PENDING",
        requestedBy: input.requestedBy,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      this.equityExercises.set(exercise.id, exercise);
      return exercise;
    }
    
    async listEquityExercises(
      tenantId: string,
      grantId?: string,
    ): Promise<EquityExercise[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.equityExercises.values()]
        .filter(
          (exercise) =>
            exercise.tenantId === tenantId &&
            (!grantId || exercise.grantId === grantId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async approveEquityExercise(input: {
      tenantId: string;
      exerciseId: string;
      approvedBy: string;
    }): Promise<EquityExercise> {
      const exercise = this.equityExercises.get(input.exerciseId);
      if (!exercise || exercise.tenantId !== input.tenantId) {
        notFound("EquityExercise", input.exerciseId);
      }
      if (exercise.status !== "PENDING") {
        throw new ConflictError(
          `equity exercise is ${exercise.status}`,
        );
      }
      if (exercise.requestedBy === input.approvedBy) {
        throw new ConflictError(
          "EQ_SELF_APPROVAL: the requester cannot approve the exercise",
        );
      }
      const approver = this.persons.get(input.approvedBy);
      if (!approver || approver.tenantId !== input.tenantId) {
        notFound("Person", input.approvedBy);
      }
      exercise.status = "APPROVED";
      exercise.approvedBy = input.approvedBy;
      exercise.approvedAt = now();
      exercise.updatedAt = exercise.approvedAt;
      exercise.version += 1;
      return exercise;
    }
    
    async settleEquityExercise(input: {
      tenantId: string;
      exerciseId: string;
    }): Promise<EquityExercise> {
      const exercise = this.equityExercises.get(input.exerciseId);
      if (!exercise || exercise.tenantId !== input.tenantId) {
        notFound("EquityExercise", input.exerciseId);
      }
      if (exercise.status !== "APPROVED") {
        throw new ConflictError(
          `equity exercise is ${exercise.status}`,
        );
      }
      exercise.status = "SETTLED";
      exercise.settledAt = now();
      exercise.updatedAt = exercise.settledAt;
      exercise.version += 1;
      const grant = await this.getEquityGrant(
        input.tenantId,
        exercise.grantId,
      );
      const settled = [...this.equityExercises.values()]
        .filter(
          (candidate) =>
            candidate.tenantId === input.tenantId &&
            candidate.grantId === grant.id &&
            candidate.status !== "CANCELLED",
        )
        .reduce((sum, candidate) => sum + parseDecimal(candidate.units), 0n);
      if (settled >= parseDecimal(grant.totalUnits)) {
        grant.status = "EXHAUSTED";
        grant.updatedAt = now();
        grant.version += 1;
      }
      return exercise;
    }
    
    async createBounty(input: {
      tenantId: string;
      title: string;
      description: string;
      rewardAmount: string;
      currency: string;
      createdBy: string;
      dueAt?: string;
    }): Promise<Bounty> {
      if (!this.tenants.has(input.tenantId)) {
        notFound("Tenant", input.tenantId);
      }
      const creator = this.persons.get(input.createdBy);
      if (!creator || creator.tenantId !== input.tenantId) {
        notFound("Person", input.createdBy);
      }
      if (parseDecimal(input.rewardAmount) <= 0n) {
        throw new ConflictError("BOUNTY_REWARD_MUST_BE_POSITIVE");
      }
      const timestamp = now();
      const bounty: Bounty = {
        id: randomUUID(),
        tenantId: input.tenantId,
        title: input.title,
        description: input.description,
        rewardAmount: formatDecimal(parseDecimal(input.rewardAmount)),
        currency: input.currency,
        status: "OPEN",
        createdBy: input.createdBy,
        dueAt: input.dueAt,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      this.bounties.set(bounty.id, bounty);
      return bounty;
    }
    
    async listBounties(
      tenantId: string,
      status?: Bounty["status"],
    ): Promise<Bounty[]> {
      if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
      return [...this.bounties.values()]
        .filter(
          (bounty) =>
            bounty.tenantId === tenantId &&
            (!status || bounty.status === status),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async getBounty(tenantId: string, bountyId: string): Promise<Bounty> {
      const bounty = this.bounties.get(bountyId);
      if (!bounty || bounty.tenantId !== tenantId) {
        notFound("Bounty", bountyId);
      }
      return bounty;
    }
    
    async claimBounty(input: {
      tenantId: string;
      bountyId: string;
      personId: string;
    }): Promise<Bounty> {
      const bounty = await this.getBounty(input.tenantId, input.bountyId);
      if (bounty.status !== "OPEN") {
        throw new ConflictError(`bounty is ${bounty.status}`);
      }
      const person = this.persons.get(input.personId);
      if (!person || person.tenantId !== input.tenantId) {
        notFound("Person", input.personId);
      }
      bounty.status = "CLAIMED";
      bounty.assigneePersonId = input.personId;
      bounty.claimedAt = now();
      bounty.updatedAt = bounty.claimedAt;
      bounty.version += 1;
      return bounty;
    }
    
    async submitBounty(input: {
      tenantId: string;
      bountyId: string;
      personId: string;
      submissionRef: string;
    }): Promise<Bounty> {
      const bounty = await this.getBounty(input.tenantId, input.bountyId);
      if (bounty.status !== "CLAIMED") {
        throw new ConflictError(`bounty is ${bounty.status}`);
      }
      if (bounty.assigneePersonId !== input.personId) {
        throw new ConflictError("BOUNTY_ONLY_ASSIGNEE_CAN_SUBMIT");
      }
      bounty.status = "SUBMITTED";
      bounty.submissionRef = input.submissionRef;
      bounty.submittedAt = now();
      bounty.updatedAt = bounty.submittedAt;
      bounty.version += 1;
      return bounty;
    }
    
    async acceptBounty(input: {
      tenantId: string;
      bountyId: string;
      reviewerPersonId: string;
      paymentRef?: string;
    }): Promise<Bounty> {
      const bounty = await this.getBounty(input.tenantId, input.bountyId);
      if (bounty.status !== "SUBMITTED") {
        throw new ConflictError(`bounty is ${bounty.status}`);
      }
      if (bounty.assigneePersonId === input.reviewerPersonId) {
        throw new ConflictError(
          "BOUNTY_SELF_ACCEPTANCE: the assignee cannot accept the bounty",
        );
      }
      const reviewer = this.persons.get(input.reviewerPersonId);
      if (!reviewer || reviewer.tenantId !== input.tenantId) {
        notFound("Person", input.reviewerPersonId);
      }
      bounty.status = "ACCEPTED";
      bounty.acceptedBy = input.reviewerPersonId;
      bounty.acceptedAt = now();
      bounty.paymentRef = input.paymentRef;
      bounty.updatedAt = bounty.acceptedAt;
      bounty.version += 1;
      return bounty;
    }
    
    async cancelBounty(input: {
      tenantId: string;
      bountyId: string;
    }): Promise<Bounty> {
      const bounty = await this.getBounty(input.tenantId, input.bountyId);
      if (bounty.status === "ACCEPTED" || bounty.status === "CANCELLED") {
        throw new ConflictError(`bounty is ${bounty.status}`);
      }
      bounty.status = "CANCELLED";
      bounty.cancelledAt = now();
      bounty.updatedAt = bounty.cancelledAt;
      bounty.version += 1;
      return bounty;
    }
    
    async createIncentiveAwardBatch(input: {
      tenantId: string;
      batchNo: string;
      awardType: IncentiveAwardType;
      period: string;
      cycleId?: string;
      currency: string;
      createdBy: string;
      sourceRecordIds?: string[];
      lines: Array<{
        personId: string;
        amount: string;
        sourceRecordId?: string;
        sourceLineRef?: string;
        note?: string;
      }>;
    }): Promise<IncentiveAwardBatch> {
      if (
        [...this.incentiveAwardBatches.values()].some(
          (batch) =>
            batch.tenantId === input.tenantId && batch.batchNo === input.batchNo,
        )
      ) {
        throw new ConflictError(
          `incentive award batch ${input.batchNo} already exists`,
        );
      }
      if (input.lines.length === 0) {
        throw new ConflictError("incentive award batch requires at least one line");
      }
      const sourceRecordIds = [
        ...new Set([
          ...(input.sourceRecordIds ?? []),
          ...input.lines
            .map((line) => line.sourceRecordId)
            .filter((value): value is string => Boolean(value)),
        ]),
      ];
      const usedSource = [...this.incentiveAwardBatches.values()].find(
        (batch) =>
          batch.tenantId === input.tenantId &&
          batch.status !== "CANCELLED" &&
          batch.sourceRecordIds.some((id) => sourceRecordIds.includes(id)),
      );
      if (usedSource) {
        throw new ConflictError(
          `source record already used by award batch ${usedSource.batchNo}`,
        );
      }
      const seenLines = new Set<string>();
      let total = 0n;
      const batchId = randomUUID();
      const lines = input.lines.map((line) => {
        const key = `${line.personId}:${line.sourceLineRef ?? ""}`;
        if (seenLines.has(key)) {
          throw new ConflictError(`duplicate award line ${key}`);
        }
        seenLines.add(key);
        const amount = parseDecimal(line.amount);
        if (amount <= 0n) {
          throw new ConflictError("incentive award line amount must be positive");
        }
        total += amount;
        return {
          id: randomUUID(),
          batchId,
          personId: line.personId,
          amount: formatDecimal(amount),
          currency: input.currency.toUpperCase(),
          sourceRecordId: line.sourceRecordId,
          sourceLineRef: line.sourceLineRef,
          note: line.note,
        };
      });
      const timestamp = now();
      const batch: IncentiveAwardBatch = {
        id: batchId,
        tenantId: input.tenantId,
        batchNo: input.batchNo,
        awardType: input.awardType,
        period: input.period,
        cycleId: input.cycleId,
        currency: input.currency.toUpperCase(),
        status: "DRAFT",
        totalAmount: formatDecimal(total),
        lineCount: lines.length,
        sourceRecordIds,
        createdBy: input.createdBy,
        lines,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      this.incentiveAwardBatches.set(batch.id, batch);
      return batch;
    }
    
    async listIncentiveAwardBatches(
      tenantId: string,
      filter?: { awardType?: string; period?: string; status?: string },
    ): Promise<IncentiveAwardBatch[]> {
      return [...this.incentiveAwardBatches.values()]
        .filter((batch) => batch.tenantId === tenantId)
        .filter(
          (batch) =>
            (!filter?.awardType || batch.awardType === filter.awardType) &&
            (!filter?.period || batch.period === filter.period) &&
            (!filter?.status || batch.status === filter.status),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }
    
    async getIncentiveAwardBatch(
      tenantId: string,
      batchId: string,
    ): Promise<IncentiveAwardBatch> {
      const batch = this.incentiveAwardBatches.get(batchId);
      if (!batch || batch.tenantId !== tenantId) {
        notFound("IncentiveAwardBatch", batchId);
      }
      return batch;
    }
    
    async commandIncentiveAwardBatch(input: {
      tenantId: string;
      batchId: string;
      command:
        | "SUBMIT"
        | "APPROVE"
        | "LOCK"
        | "EXPORT"
        | "ACKNOWLEDGE"
        | "CANCEL";
      actorPersonId: string;
      paymentRef?: string;
    }): Promise<IncentiveAwardBatch> {
      return this.withCommandLock(`award:${input.tenantId}:${input.batchId}`, () =>
        this.commandIncentiveAwardBatchUnlocked(input),
      );
    }
    
    async createAdverseAction(input: {
      tenantId: string;
      personId: string;
      actionType: AdverseActionCase["actionType"];
      reason: string;
      performanceBasis: string;
      evidenceRefs: string[];
      requestedBy: string;
    }): Promise<AdverseActionCase> {
      if (!this.tenants.has(input.tenantId)) {
        notFound("Tenant", input.tenantId);
      }
      for (const personId of [input.personId, input.requestedBy]) {
        const person = this.persons.get(personId);
        if (!person || person.tenantId !== input.tenantId) {
          notFound("Person", personId);
        }
      }
      const timestamp = now();
      const action: AdverseActionCase = {
        id: randomUUID(),
        tenantId: input.tenantId,
        personId: input.personId,
        actionType: input.actionType,
        status: "DRAFT",
        reason: input.reason,
        performanceBasis: input.performanceBasis,
        evidenceRefs: [...input.evidenceRefs],
        requestedBy: input.requestedBy,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      };
      this.adverseActions.set(action.id, action);
      return action;
    }
    
    async listAdverseActions(
      tenantId: string,
      personId?: string,
    ): Promise<AdverseActionCase[]> {
      return [...this.adverseActions.values()]
        .filter(
          (action) =>
            action.tenantId === tenantId &&
            (!personId || action.personId === personId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    
    async getAdverseAction(
      tenantId: string,
      actionId: string,
    ): Promise<AdverseActionCase> {
      const action = this.adverseActions.get(actionId);
      if (!action || action.tenantId !== tenantId) {
        notFound("AdverseActionCase", actionId);
      }
      return action;
    }
    
    async reviewAdverseAction(input: {
      tenantId: string;
      actionId: string;
      legalReviewerId: string;
      legalReviewRef: string;
      decision: "APPROVE" | "REJECT";
      note?: string;
    }): Promise<AdverseActionCase> {
      const action = await this.getAdverseAction(
        input.tenantId,
        input.actionId,
      );
      assertTransition(
        adverseActionTransitions,
        "AdverseActionCase",
        action.status,
        "LEGAL_REVIEW",
      );
      if (action.requestedBy === input.legalReviewerId) {
        throw new ConflictError(
          "ADVERSE_ACTION_SELF_REVIEW: the requester cannot perform legal review",
        );
      }
      const reviewer = this.persons.get(input.legalReviewerId);
      if (!reviewer || reviewer.tenantId !== input.tenantId) {
        notFound("Person", input.legalReviewerId);
      }
      action.status = "LEGAL_REVIEW";
      action.legalReviewerId = input.legalReviewerId;
      action.legalReviewRef = input.legalReviewRef;
      action.legalReviewedAt = now();
      action.updatedAt = action.legalReviewedAt;
      action.version += 1;
      if (input.decision === "REJECT") {
        assertTransition(
          adverseActionTransitions,
          "AdverseActionCase",
          action.status,
          "REJECTED",
        );
        action.status = "REJECTED";
      }
      return action;
    }
    
    async approveAdverseAction(input: {
      tenantId: string;
      actionId: string;
      approvedBy: string;
    }): Promise<AdverseActionCase> {
      const action = await this.getAdverseAction(
        input.tenantId,
        input.actionId,
      );
      assertTransition(
        adverseActionTransitions,
        "AdverseActionCase",
        action.status,
        "APPROVED",
      );
      if (
        action.requestedBy === input.approvedBy ||
        action.legalReviewerId === input.approvedBy
      ) {
        throw new ConflictError(
          "ADVERSE_ACTION_SEPARATION_REQUIRED: requester and legal reviewer cannot approve",
        );
      }
      const approver = this.persons.get(input.approvedBy);
      if (!approver || approver.tenantId !== input.tenantId) {
        notFound("Person", input.approvedBy);
      }
      action.status = "APPROVED";
      action.approvedBy = input.approvedBy;
      action.approvedAt = now();
      action.updatedAt = action.approvedAt;
      action.version += 1;
      return action;
    }
    
    async activateAdverseAction(input: {
      tenantId: string;
      actionId: string;
      effectiveFrom: string;
    }): Promise<AdverseActionCase> {
      const action = await this.getAdverseAction(
        input.tenantId,
        input.actionId,
      );
      assertTransition(
        adverseActionTransitions,
        "AdverseActionCase",
        action.status,
        "ACTIVE",
      );
      action.status = "ACTIVE";
      action.effectiveFrom = input.effectiveFrom;
      action.updatedAt = now();
      action.version += 1;
      return action;
    }
    
    async completeAdverseAction(input: {
      tenantId: string;
      actionId: string;
    }): Promise<AdverseActionCase> {
      const action = await this.getAdverseAction(
        input.tenantId,
        input.actionId,
      );
      assertTransition(
        adverseActionTransitions,
        "AdverseActionCase",
        action.status,
        "COMPLETED",
      );
      action.status = "COMPLETED";
      action.completedAt = now();
      action.updatedAt = action.completedAt;
      action.version += 1;
      return action;
    }
    
    async cancelAdverseAction(input: {
      tenantId: string;
      actionId: string;
      reason: string;
    }): Promise<AdverseActionCase> {
      const action = await this.getAdverseAction(
        input.tenantId,
        input.actionId,
      );
      assertTransition(
        adverseActionTransitions,
        "AdverseActionCase",
        action.status,
        "CANCELLED",
      );
      action.status = "CANCELLED";
      action.cancelledAt = now();
      action.cancelReason = input.reason;
      action.updatedAt = action.cancelledAt;
      action.version += 1;
      return action;
    }
  };
}
