import { InMemoryLedger } from "@anari/ledger";
import {
  type AdjustmentRecord,
  type AppealCase,
  type AuditEvent,
  type AttributionDecision,
  type CalculationRun,
  type CommitmentSnapshot,
  type ContributionAttestation,
  type ContributionClaim,
  type DataQualityIssue,
  type EmployeeConfirmation,
  type EvaluationCycle,
  type EvaluationDecision,
  type EvaluationDraft,
  type EvidenceLink,
  type EvidenceNode,
  type InAppNotification,
  type LegalGateRecord,
  type PolicyDefinition,
  type PolicyVersionSummary,
  type RecalculationRequest,
  type Rubric,
  type SettlementBatch,
  type SettlementLine,
  type WorkPackage,
  type ContributionAssessmentDraft,
  type MetricMeasurementSnapshot,
  type AgentTodo,
  type AgentFeedbackLabel,
  type AgentModelUsage,
  type AgentAiOffBaseline,
  type ContributionEvent,
} from "@anari/domain";
import {
  DEFAULT_TENANT_ID,
  DEMO_CYCLE_ID,
  now,
} from "../store-support.js";

/**
 * Constructor type used by the domain mixins. The final `Store` class declares
 * the public constructor signature; mixins only forward their arguments.
 */
export type StoreCtor<T = object> = new (...args: any[]) => T;

/** Shared in-memory state and the few behaviours used across domains. */
export class StoreBase {
  readonly ledger = new InMemoryLedger();
  protected readonly workPackages = new Map<string, WorkPackage>();
  protected readonly workPackageSnapshots = new Map<
    string,
    CommitmentSnapshot[]
  >();
  protected readonly claims = new Map<string, ContributionClaim>();
  protected readonly attestations = new Map<string, ContributionAttestation>();
  protected readonly decisions = new Map<string, AttributionDecision>();
  protected readonly runs = new Map<string, CalculationRun>();
  protected readonly settlementExclusions = new Set<string>();
  protected readonly commandLocks = new Map<string, Promise<void>>();
  protected readonly appeals = new Map<string, AppealCase>();
  protected readonly recalculations = new Map<string, RecalculationRequest>();
  protected readonly adjustmentRecords = new Map<string, AdjustmentRecord>();
  protected readonly auditLog: AuditEvent[] = [];
  protected readonly legalGates = new Map<string, LegalGateRecord>();
  protected readonly confirmations = new Map<string, EmployeeConfirmation>();
  protected readonly evidence = new Map<string, EvidenceNode>();
  protected readonly evidenceLinks = new Map<string, EvidenceLink>();
  protected readonly ingestedKeys = new Set<string>();
  protected readonly publishedPolicies = new Map<string, PolicyDefinition>();
  protected readonly publishedPolicyKeys = new Set<string>();
  protected readonly publishedPolicyScopes = new Map<
    string,
    Record<string, unknown>
  >();
  protected readonly policyWindows = new Map<
    string,
    { effectiveFrom?: string; effectiveTo?: string }
  >();
  protected readonly publishedPolicySummaries = new Map<
    string,
    PolicyVersionSummary
  >();
  protected readonly settlementBatches = new Map<string, SettlementBatch>();
  protected readonly settlementLines = new Map<string, SettlementLine[]>();
  protected readonly rubrics = new Map<string, Rubric>();
  protected readonly evaluationCycles = new Map<string, EvaluationCycle>();
  protected readonly dataQualityIssues = new Map<string, DataQualityIssue>();
  protected readonly notifications = new Map<string, InAppNotification>();
  protected readonly evaluationDrafts = new Map<string, EvaluationDraft>();
  protected readonly evaluationDecisions = new Map<string, EvaluationDecision>();
  protected readonly contributionEvents = new Map<string, ContributionEvent>();
  protected readonly contributionAssessmentDrafts = new Map<
    string,
    ContributionAssessmentDraft
  >();
  protected readonly metricSnapshots = new Map<string, MetricMeasurementSnapshot>();
  protected readonly agentTodos = new Map<string, AgentTodo>();
  protected readonly agentFeedbackLabels = new Map<string, AgentFeedbackLabel>();
  protected readonly agentModelUsage = new Map<string, AgentModelUsage>();
  protected agentAiOffBaselines: AgentAiOffBaseline[] = [];


  constructor(protected readonly tenantId: string = DEFAULT_TENANT_ID) {
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


  protected hasConfirmedAttribution(
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
}
