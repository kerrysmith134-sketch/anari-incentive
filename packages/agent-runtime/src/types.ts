import type {
  AppealCase,
  AttributionDecision,
  CalculationRun,
  ContributionClaim,
  DataQualityIssue,
  EmployeeConfirmation,
  EvaluationDraft,
  EvidenceNode,
  InAppNotification,
  LegalGateRecord,
  PublishPolicyInput,
  PublishedPolicy,
  WorkPackage,
} from "@anari/domain";

export type AgentTaskStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "RETRY_PENDING"
  | "BLOCKED"
  | "FAILED"
  | "ESCALATED"
  | "SUCCEEDED"
  | "CANCELLED";

export type RiskTier = "T0" | "T1" | "T2" | "T3";
export type TriggerType = "EVENT" | "SCHEDULE" | "MANUAL" | "THRESHOLD";

export interface AgentFinding {
  code: string;
  severity: "INFO" | "WARNING" | "BLOCKING";
  subjectType: string;
  subjectId: string;
  message: string;
  evidenceRefs?: string[];
  suggestedAction?: string;
  /** Structured observation data passed to `plan`. */
  data?: Record<string, unknown>;
}

export interface AgentAction {
  id: string;
  tool: string;
  riskTier: RiskTier;
  targetType: string;
  targetId: string;
  description: string;
  payload: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface AgentActionResult {
  actionId: string;
  status: "EXECUTED" | "PENDING_APPROVAL" | "REJECTED" | "FAILED";
  output?: unknown;
  error?: string;
}

export interface AgentTask {
  id: string;
  tenantId: string;
  agentType: string;
  triggerType: TriggerType;
  triggerRef?: string;
  status: AgentTaskStatus;
  riskTier: RiskTier;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  findings: AgentFinding[];
  actions: AgentAction[];
  results: AgentActionResult[];
  attempts: number;
  idempotencyKey: string;
  correlationId: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentContext {
  listWorkPackages(): Promise<WorkPackage[]>;
  listClaims(): Promise<ContributionClaim[]>;
  listDecisions(claimId?: string): Promise<AttributionDecision[]>;
  listRuns(): Promise<CalculationRun[]>;
  listConfirmations(personId?: string): Promise<EmployeeConfirmation[]>;
  listAppeals(): Promise<AppealCase[]>;
  getLegalGate(policyVersionId: string): Promise<LegalGateRecord | undefined>;
  listEvidence(
    subjectType?: string,
    subjectId?: string,
  ): Promise<EvidenceNode[]>;
  /** Publishes an approved policy version; T3 and never called without a human. */
  publishPolicy(input: PublishPolicyInput): Promise<PublishedPolicy>;
  createDataQualityIssue(input: {
    objectType: string;
    objectId: string;
    issueCode: string;
    severity: "INFO" | "WARNING" | "BLOCKING";
    details?: Record<string, unknown>;
  }): Promise<DataQualityIssue>;
  createNotification(input: {
    recipientPersonId?: string;
    audience: "PERSON" | "MANAGER" | "FINANCE" | "ADMIN";
    title: string;
    body: string;
    sourceType?: string;
    sourceId?: string;
  }): Promise<InAppNotification>;
  createEvaluationDraft(input: {
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
  }): Promise<EvaluationDraft>;
}

export interface AgentToolExecutionContext {
  taskId: string;
  actor: string;
  /** Present only when a human approved this specific action. */
  approvedBy?: string;
}

export interface AgentTool {
  name: string;
  riskTier: RiskTier;
  description: string;
  execute(
    input: Record<string, unknown>,
    context: AgentContext,
    execution?: AgentToolExecutionContext,
  ): Promise<unknown>;
}

export interface AgentSkill {
  name: string;
  observe(
    context: AgentContext,
    input: Record<string, unknown>,
  ): Promise<AgentFinding[]>;
  plan(finding: AgentFinding, input?: Record<string, unknown>): AgentAction[];
}

export interface AgentAuditEntry {
  taskId: string;
  actionId?: string;
  tool?: string;
  actor: string;
  at: string;
  detail: string;
}

/**
 * Durable task/audit adapter. The runtime stays synchronous internally but
 * loads once on first use and persists each task snapshot after a mutation.
 */
export interface AgentTaskRepository {
  load(): Promise<{ tasks: AgentTask[]; audit: AgentAuditEntry[] }>;
  saveTask(task: AgentTask): Promise<void>;
  appendAudit(entry: AgentAuditEntry): Promise<void>;
}
