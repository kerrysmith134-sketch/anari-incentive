import type {
  AppealCase,
  AttributionDecision,
  CalculationRun,
  ContributionClaim,
  EmployeeConfirmation,
  EvidenceNode,
  LegalGateRecord,
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
}

export interface AgentTool {
  name: string;
  riskTier: RiskTier;
  description: string;
  execute(
    input: Record<string, unknown>,
    context: AgentContext,
  ): Promise<unknown>;
}

export interface AgentSkill {
  name: string;
  observe(
    context: AgentContext,
    input: Record<string, unknown>,
  ): Promise<AgentFinding[]>;
  plan(finding: AgentFinding): AgentAction[];
}

export interface AgentAuditEntry {
  taskId: string;
  actionId?: string;
  tool?: string;
  actor: string;
  at: string;
  detail: string;
}
