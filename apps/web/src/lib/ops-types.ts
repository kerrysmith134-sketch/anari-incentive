import type { DecimalString, Uuid } from "./types.js";

export interface CalculationLineView {
  lineKey: string;
  personId: Uuid;
  workPackageId: Uuid;
  incentiveType: string;
  baseAmount: DecimalString;
  multiplier: DecimalString;
  rawAmount: DecimalString;
  roundedAmount: DecimalString;
  currency: string;
  trace: Record<string, unknown>;
  redactedFields?: string[];
}

export interface CalculationRunView {
  id: Uuid;
  cycleId: Uuid;
  mode: "SHADOW" | "FORMAL";
  policyVersionId: string;
  engineVersion: string;
  status: string;
  lines: CalculationLineView[];
  resultHash?: string;
  blockers: string[];
  warnings: string[];
  createdAt: string;
  calculatedAt?: string;
  lockedAt?: string;
}

export interface RecalculationRequestView {
  id: Uuid;
  targetType: "EVIDENCE" | "ATTRIBUTION" | "EVALUATION" | "LEDGER";
  targetId: Uuid;
  reasonCode: string;
  explanation: string;
  requestedBy: Uuid;
  status: "OPEN" | "APPROVED" | "REJECTED" | "COMPLETED";
  approvedBy?: Uuid;
  approvedAt?: string;
  newCalculationRunId?: Uuid;
  createdAt: string;
}

export interface RuleChangeOrderView {
  id: Uuid;
  policyCode: string;
  fromPolicyVersionId?: Uuid;
  toPolicyVersionId: Uuid;
  changeType: string;
  reason: string;
  impactSimulation: Record<string, unknown>;
  status: "DRAFT" | "APPROVED" | "REJECTED" | "PUBLICIZED";
  requestedBy: Uuid;
  approvedBy?: Uuid;
  approvedAt?: string;
  publicizedAt?: string;
  effectiveFrom: string;
  createdAt: string;
}

export interface EmployeeNoticeView {
  id: Uuid;
  policyVersionId?: Uuid;
  noticeType: "POLICY" | "PAY_PLAN" | "AI_USE" | "DATA_PROCESSING" | "OTHER";
  title: string;
  bodyRef: string;
  publishedAt: string;
  effectiveFrom: string;
  acknowledgementRequired: boolean;
  createdAt: string;
}

export interface NoticeAcknowledgementView {
  id: Uuid;
  noticeId: Uuid;
  personId: Uuid;
  acknowledgedAt?: string;
  signatureRef?: string;
  declinedAt?: string;
  declineReason?: string;
  createdAt: string;
}

export interface EmployeeRepresentationView {
  id: Uuid;
  bodyName: string;
  bodyType: "WORKS_COUNCIL" | "UNION" | "EMPLOYEE_REP" | "ALL_EMPLOYEES";
  jurisdiction: string;
  active: boolean;
  createdAt: string;
}

export interface DeliverableView {
  id: Uuid;
  workPackageId: Uuid;
  title: string;
  deliverableType: string;
  ownerPersonId: Uuid;
  dueAt?: string;
  status: "DRAFT" | "SUBMITTED" | "ACCEPTED" | "REJECTED";
  artifactRef?: string;
  contentHash?: string;
  submittedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CashGateInputView {
  id: Uuid;
  cycleId: Uuid;
  asOfDate: string;
  safetyReserveMonths: DecimalString;
  thirteenWeekForecastRef: string;
  passesGate: boolean;
  approvedBy: Uuid;
  approvedAt: string;
  createdAt: string;
}

export interface FinancialFactView {
  id: Uuid;
  sourceSystem: string;
  sourceRecordId: string;
  factType: string;
  periodStart?: string;
  periodEnd?: string;
  amount: DecimalString;
  currency: string;
  qualityStatus: string;
  sourceUpdatedAt?: string;
  ingestedAt: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AgentActionView {
  id: string;
  tool: string;
  riskTier: "T0" | "T1" | "T2" | "T3";
  targetType: string;
  targetId: string;
  description: string;
  payload: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface AgentTaskView {
  id: string;
  agentType: string;
  triggerType: string;
  triggerRef?: string;
  status: string;
  riskTier: "T0" | "T1" | "T2" | "T3";
  actorRole?: "READER" | "ACTOR";
  input: Record<string, unknown>;
  findings: Array<{
    code: string;
    severity: string;
    subjectType: string;
    subjectId: string;
    message: string;
  }>;
  actions: AgentActionView[];
  results: Array<{ actionId: string; status: string; error?: string }>;
  attempts: number;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunView {
  id: Uuid;
  agentTaskId: Uuid;
  workflowName: string;
  workflowVersion: string;
  status: string;
  currentStep?: string;
  state: Record<string, unknown>;
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
}

export interface AiSuggestionLogView {
  id: Uuid;
  agentTaskId: Uuid;
  targetType: string;
  targetId?: Uuid;
  suggestionType: string;
  modelProvider?: string;
  modelName?: string;
  promptVersion: string;
  inputHash: string;
  outputJson: Record<string, unknown>;
  validationStatus: string;
  acceptedBy?: Uuid;
  acceptedAt?: string;
  createdAt: string;
}

export interface MetricDefinitionView {
  id: Uuid;
  code: string;
  version: number;
  name: string;
  description?: string;
  dataType: string;
  unit?: string;
  aggregationMethod?: string;
  sourceContract: Record<string, unknown>;
  active: boolean;
  effectiveFrom: string;
  effectiveTo?: string;
  createdAt: string;
}

export interface CompensationTemplateView {
  id: Uuid;
  code: string;
  name: string;
  roleCode: string;
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACTOR";
  currency: string;
  fixedSalaryMin: DecimalString;
  fixedSalaryMax: DecimalString;
  deductionCapRate: DecimalString;
  variableShareCapRate: DecimalString;
  smoothingThresholdRate: DecimalString;
  status: "ACTIVE" | "RETIRED";
  createdAt: string;
  updatedAt: string;
}

export interface ESignEnvelopeView {
  id: Uuid;
  contractId: Uuid;
  provider: string;
  envelopeRef: string;
  documentHash: string;
  signerPersonId: Uuid;
  status: string;
  sentAt: string;
  completedAt?: string;
  declineReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalIdentityView {
  id: Uuid;
  sourceSystem: string;
  externalId: string;
  personId?: Uuid;
  objectType: string;
  createdAt: string;
}

export interface PolicyConsultationView {
  id: Uuid;
  policyVersionId: Uuid;
  representationId?: Uuid;
  consultationType:
    | "DISCUSSION"
    | "COMMENT_PERIOD"
    | "NEGOTIATION"
    | "INFORMATION";
  startedAt: string;
  endedAt?: string;
  minutesRef?: string;
  feedbackSummary?: string;
  outcome: "PENDING" | "AGREED" | "NO_AGREEMENT" | "INFORMATION_ONLY" | "CLOSED";
  createdAt: string;
}

export interface EvidenceView {
  id: Uuid;
  evidenceType: string;
  subjectType: string;
  subjectId: Uuid;
  sourceSystem: string;
  sourceUri?: string;
  observedAt: string;
  qualityStatus: string;
  normalizedPayload: Record<string, unknown>;
  payloadHash: string;
  submittedBy?: Uuid;
  redactedFields?: string[];
  createdAt: string;
}

export interface WorkforceSubgroupAttributeView {
  id: Uuid;
  personId: Uuid;
  dimension: string;
  value: string;
  consentRef: string;
  consentedAt: string;
  expiresAt?: string;
  recordedBy: Uuid;
  createdAt: string;
}

export interface NotificationView {
  id: Uuid;
  recipientPersonId?: Uuid;
  audience: string;
  title: string;
  body: string;
  sourceType?: string;
  sourceId?: Uuid;
  readAt?: string;
  createdAt: string;
}
