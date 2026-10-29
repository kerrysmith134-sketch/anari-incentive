import { z } from "zod";

const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "expected a decimal string");

export const uuidSchema = z.string().uuid();

export const createWorkPackageSchema = z.object({
  title: z.string().min(2).max(200),
  objective: z.string().min(3),
  ownerPersonId: uuidSchema,
  members: z
    .array(
      z.object({
        personId: uuidSchema,
        responsibilityCode: z.string().min(1),
        expectedOutput: z.string().min(1),
      }),
    )
    .min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  dueAt: z.string().datetime().optional(),
});
export type CreateWorkPackageInput = z.infer<typeof createWorkPackageSchema>;

export const commitWorkPackageSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export type CommitWorkPackageInput = z.infer<typeof commitWorkPackageSchema>;

export const acceptWorkPackageSchema = z.object({
  reviewerPersonId: uuidSchema,
  comments: z.string().optional(),
});
export type AcceptWorkPackageInput = z.infer<typeof acceptWorkPackageSchema>;

export const acceptWorkPackagesBatchSchema = z.object({
  items: z
    .array(
      z.object({
        id: uuidSchema,
        reviewerPersonId: uuidSchema,
      }),
    )
    .min(1)
    .max(50),
});
export type AcceptWorkPackagesBatchInput = z.infer<
  typeof acceptWorkPackagesBatchSchema
>;

export const rejectWorkPackageSchema = z.object({
  reviewerPersonId: uuidSchema,
  reason: z.string().min(3),
});
export type RejectWorkPackageInput = z.infer<typeof rejectWorkPackageSchema>;

export const createContributionClaimSchema = z.object({
  workPackageId: uuidSchema,
  claimantPersonId: uuidSchema,
  claimType: z.string().min(1),
  claimedContribution: z.object({
    dimensions: z.array(z.string().min(1)).min(1),
    summary: z.string().min(1),
  }),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  rationale: z.string().min(3),
});
export type CreateContributionClaimInput = z.input<
  typeof createContributionClaimSchema
>;

export const createAttributionDecisionSchema = z.object({
  claimId: uuidSchema,
  adjudicatorPersonId: uuidSchema,
  status: z.enum(["CONFIRMED", "PARTIALLY_CONFIRMED", "REJECTED"]),
  acceptedFacts: z.array(z.string()).default([]),
  rejectedFacts: z.array(z.string()).default([]),
  contributionDimensions: z.record(z.number().min(0).max(1)),
  rationale: z.string().min(3),
  confidenceBand: z.string().optional(),
});
export type CreateAttributionDecisionInput = z.input<
  typeof createAttributionDecisionSchema
>;

export const createAttributionDecisionsBatchSchema = z.object({
  items: z.array(createAttributionDecisionSchema).min(1).max(50),
});
export type CreateAttributionDecisionsBatchInput = z.infer<
  typeof createAttributionDecisionsBatchSchema
>;

export const legalGateSchema = z.object({
  democraticProcedureRef: z.string().min(1).optional(),
  employeeNoticeRef: z.string().min(1).optional(),
  dataProtectionAssessmentRef: z.string().min(1).optional(),
  minimumWageChecked: z.boolean(),
  policyApproved: z.boolean(),
});

export const recordLegalGateSchema = z.object({
  democraticProcedureRef: z.string().min(1).optional(),
  democraticProcedureId: uuidSchema.optional(),
  employeeNoticeRef: z.string().min(1).optional(),
  employeeNoticeId: uuidSchema.optional(),
  dataProtectionAssessmentRef: z.string().min(1).optional(),
  dataProtectionAssessmentId: uuidSchema.optional(),
  minimumWageChecked: z.boolean(),
  policyApproved: z.boolean(),
  recordedBy: uuidSchema,
});
export type RecordLegalGateBody = z.infer<typeof recordLegalGateSchema>;

export const createNoticeSchema = z.object({
  noticeType: z.enum([
    "POLICY",
    "PAY_PLAN",
    "AI_USE",
    "DATA_PROCESSING",
    "OTHER",
  ]),
  title: z.string().min(1),
  bodyRef: z.string().min(1),
  policyVersionId: uuidSchema.optional(),
  publishedAt: z.string().datetime().optional(),
  effectiveFrom: z.string().datetime(),
  acknowledgementRequired: z.boolean().default(true),
});
export type CreateNoticeBody = z.infer<typeof createNoticeSchema>;

export const recordAcknowledgementSchema = z
  .object({
    personId: uuidSchema,
    decision: z.enum(["ACKNOWLEDGE", "DECLINE"]),
    signatureRef: z.string().min(1).optional(),
    declineReason: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      value.decision !== "DECLINE" || Boolean(value.declineReason),
    "declineReason is required when declining",
  );
export type RecordAcknowledgementBody = z.infer<
  typeof recordAcknowledgementSchema
>;

export const createRepresentationSchema = z.object({
  bodyName: z.string().min(1),
  bodyType: z.enum([
    "WORKS_COUNCIL",
    "UNION",
    "EMPLOYEE_REP",
    "ALL_EMPLOYEES",
  ]),
  jurisdiction: z.string().min(1),
});
export type CreateRepresentationBody = z.infer<
  typeof createRepresentationSchema
>;

const consultationOutcome = z.enum([
  "PENDING",
  "AGREED",
  "NO_AGREEMENT",
  "INFORMATION_ONLY",
  "CLOSED",
]);

export const createConsultationSchema = z
  .object({
    policyVersionId: uuidSchema,
    representationId: uuidSchema.optional(),
    consultationType: z.enum([
      "DISCUSSION",
      "COMMENT_PERIOD",
      "NEGOTIATION",
      "INFORMATION",
    ]),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
    minutesRef: z.string().min(1).optional(),
    feedbackSummary: z.string().min(1).optional(),
    outcome: consultationOutcome.default("PENDING"),
  })
  .refine(
    (value) =>
      !value.endedAt || new Date(value.endedAt) >= new Date(value.startedAt),
    "endedAt must not be before startedAt",
  );
export type CreateConsultationBody = z.infer<typeof createConsultationSchema>;

export const concludeConsultationSchema = z.object({
  endedAt: z.string().datetime(),
  outcome: z.enum([
    "AGREED",
    "NO_AGREEMENT",
    "INFORMATION_ONLY",
    "CLOSED",
  ]),
  minutesRef: z.string().min(1).optional(),
  feedbackSummary: z.string().min(1).optional(),
});
export type ConcludeConsultationBody = z.infer<
  typeof concludeConsultationSchema
>;

export const createDpiaSchema = z.object({
  assessmentType: z.enum(["DPIA", "PIPIA"]),
  scope: z.string().min(1),
  riskSummary: z.record(z.unknown()).optional(),
  mitigationSummary: z.record(z.unknown()).optional(),
});
export type CreateDpiaBody = z.infer<typeof createDpiaSchema>;

export const approveDpiaSchema = z.object({
  approvedBy: uuidSchema,
});
export type ApproveDpiaBody = z.infer<typeof approveDpiaSchema>;

export const createDsarSchema = z.object({
  personId: uuidSchema.optional(),
  requestType: z.enum([
    "ACCESS",
    "CORRECTION",
    "DELETION",
    "EXPLANATION",
    "OBJECTION",
  ]),
  dueAt: z.string().datetime().optional(),
});
export type CreateDsarBody = z.infer<typeof createDsarSchema>;

export const resolveDsarSchema = z.object({
  resolution: z.enum(["RESOLVED", "REJECTED"]),
  resolutionRef: z.string().min(1),
});
export type ResolveDsarBody = z.infer<typeof resolveDsarSchema>;

export const recordConfirmationSchema = z.object({
  personId: uuidSchema,
  targetType: z.enum([
    "EVALUATION",
    "ATTRIBUTION",
    "CALCULATION",
    "LEDGER",
    "SETTLEMENT",
  ]),
  targetId: uuidSchema,
  decision: z.enum(["VIEWED", "CONFIRMED", "OBJECTED"]),
  reason: z.string().optional(),
});
export type RecordConfirmationBody = z.infer<typeof recordConfirmationSchema>;

export const triageAppealSchema = z.object({
  reviewerPersonId: uuidSchema,
});
export type TriageAppealBody = z.infer<typeof triageAppealSchema>;

export const resolveAppealSchema = z.object({
  reviewerPersonId: uuidSchema,
  resolution: z.enum(["UPHOLD", "CHANGE", "REJECT"]),
  rationale: z.string().min(3),
});
export type ResolveAppealBody = z.infer<typeof resolveAppealSchema>;

export const createCalculationRunSchema = z.object({
  cycleId: uuidSchema,
  policyVersionId: z.string().min(1),
  mode: z.enum(["SHADOW", "FORMAL"]),
  order: z.object({
    id: z.string().min(1),
    grossProfit: decimal,
    currency: z.string().length(3),
    contractAmount: decimal.optional(),
    cashCollected: decimal.optional(),
    retentionAmount: decimal.optional(),
    projectType: z.string().min(1).optional(),
    siteId: z.string().min(1).optional(),
    safetyIncidents: z.number().int().min(0).optional(),
    acceptanceStatus: z.enum(["ACCEPTED", "PENDING", "REJECTED"]).optional(),
    invoiceAmount: decimal.optional(),
    creditApproved: z.boolean().optional(),
    qualityHold: z.boolean().optional(),
    channelPartnerId: z.string().min(1).optional(),
    channelShare: decimal.optional(),
  }),
  participants: z
    .array(
      z.object({
        personId: uuidSchema,
        workPackageId: uuidSchema,
        attributionWeight: decimal,
        evaluationDecisionId: uuidSchema.optional(),
        role: z.string().min(1),
      }),
    )
    .min(1),
});
export type CreateCalculationRunInput = z.infer<
  typeof createCalculationRunSchema
>;

export const createCalculationBatchSchema = z.object({
  runs: z.array(createCalculationRunSchema).min(1).max(50),
});
export type CreateCalculationBatchInput = z.infer<
  typeof createCalculationBatchSchema
>;

export const lockCalculationRunSchema = z.object({
  confirmation: z.literal("LOCK_CALCULATION"),
});
export type LockCalculationRunInput = z.infer<
  typeof lockCalculationRunSchema
>;

export const createAppealSchema = z.object({
  appellantPersonId: uuidSchema,
  targetType: z.enum(["ATTRIBUTION", "EVALUATION", "LEDGER", "CALCULATION"]),
  targetId: uuidSchema,
  reasonCode: z.string().min(1),
  statement: z.string().min(5),
});
export type CreateAppealInput = z.infer<typeof createAppealSchema>;

export const createEvidenceSchema = z.object({
  evidenceType: z.string().min(1),
  subjectType: z.string().min(1),
  subjectId: uuidSchema,
  sourceSystem: z.string().min(1),
  sourceUri: z.string().optional(),
  observedAt: z.string().datetime().optional(),
  qualityStatus: z
    .enum(["VALID", "MISSING", "STALE", "CONFLICTED", "UNVERIFIED", "INVALID"])
    .default("UNVERIFIED"),
  normalizedPayload: z.record(z.unknown()),
  supersedesId: uuidSchema.optional(),
  submittedBy: uuidSchema.optional(),
});
export type CreateEvidenceInput = z.input<typeof createEvidenceSchema>;

export const createEvidenceLinkSchema = z.object({
  toEvidenceId: uuidSchema,
  relationType: z.enum([
    "SUPPORTS",
    "CONTRADICTS",
    "DEPENDS_ON",
    "CORRECTS",
    "CONTEXT",
  ]),
  rationale: z.string().optional(),
});
export type CreateEvidenceLinkInput = z.infer<typeof createEvidenceLinkSchema>;

export const enqueueAgentTaskSchema = z.object({
  agentType: z.enum([
    "EVIDENCE_GAP",
    "SETTLEMENT_READINESS",
    "CONTRIBUTION_ANOMALY",
    "POLICY_PROPOSAL",
    "DATA_QUALITY",
    "APPEAL_SLA",
    "EVALUATION_DRAFT",
  ]),
  triggerType: z.enum(["EVENT", "SCHEDULE", "MANUAL", "THRESHOLD"]),
  triggerRef: z.string().optional(),
  input: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().min(1),
  riskTier: z.enum(["T0", "T1", "T2", "T3"]).optional(),
});
export type EnqueueAgentTaskBody = z.input<typeof enqueueAgentTaskSchema>;

export const approveAgentActionSchema = z.object({
  actionId: uuidSchema,
  approverPersonId: uuidSchema,
});
export type ApproveAgentActionBody = z.infer<typeof approveAgentActionSchema>;

export const rejectAgentActionSchema = z.object({
  actionId: uuidSchema,
  approverPersonId: uuidSchema,
  reason: z.string().min(1),
});
export type RejectAgentActionBody = z.infer<typeof rejectAgentActionSchema>;

export const scanAgentTasksSchema = z.object({
  idempotencyKey: z.string().min(1).optional(),
});
export type ScanAgentTasksBody = z.infer<typeof scanAgentTasksSchema>;

export const policyDefinitionSchema = z.object({
  code: z.string().min(1),
  version: z.number().int().positive(),
  currency: z.string().length(3),
  poolRate: decimal,
  poolCap: decimal,
  rounding: z.enum(["HALF_UP", "HALF_EVEN", "DOWN"]),
  cashCollectionWeight: decimal.optional(),
  retentionHoldbackRate: decimal.optional(),
  afterSalesReserveRate: decimal.optional(),
  qualityGate: z
    .object({
      requireAcceptance: z.boolean(),
      blockOnSafetyIncident: z.boolean(),
    })
    .optional(),
  creditGate: z
    .object({
      requireCreditApproval: z.boolean(),
      blockOnQualityHold: z.boolean(),
    })
    .optional(),
  calculator: z
    .enum([
      "SIMPLE_POOL",
      "CASH_WEIGHTED_POOL",
      "CASH_WEIGHTED_RETENTION_POOL",
      "CASH_WEIGHTED_RESERVE_CHANNEL_POOL",
    ])
    .optional(),
  incentiveType: z.string().optional(),
  minimumWage: z
    .object({ monthlyMinimum: decimal, checked: z.boolean() })
    .optional(),
  evaluation: z
    .object({
      dimensionWeights: z.record(decimal),
      floor: decimal,
      ceiling: decimal,
      maxScore: decimal.optional(),
    })
    .optional(),
});
export type PolicyDefinitionBody = z.input<typeof policyDefinitionSchema>;

export const reverseLedgerEntrySchema = z.object({
  idempotencyKey: z.string().min(1),
  reason: z.string().min(3),
  approvedBy: uuidSchema,
});
export type ReverseLedgerEntryBody = z.infer<
  typeof reverseLedgerEntrySchema
>;

export const createSettlementBatchSchema = z.object({
  cycleId: uuidSchema,
  kind: z.enum(["STANDARD", "RECOVERY"]).default("STANDARD"),
  currency: z.string().length(3).optional(),
  batchNo: z.string().min(1).optional(),
});
export type CreateSettlementBatchBody = z.infer<
  typeof createSettlementBatchSchema
>;

export const settlementCommandSchema = z.object({
  command: z.enum([
    "RECONCILE",
    "SUBMIT",
    "APPROVE",
    "LOCK",
    "EXPORT",
    "ACKNOWLEDGE",
    "REQUIRE_ADJUSTMENT",
    "CANCEL",
  ]),
  actorPersonId: uuidSchema.optional(),
  externalReference: z.string().optional(),
  reason: z.string().optional(),
});
export type SettlementCommandBody = z.infer<typeof settlementCommandSchema>;

export const createNotificationSchema = z.object({
  recipientPersonId: uuidSchema.optional(),
  audience: z.enum(["PERSON", "MANAGER", "FINANCE", "ADMIN"]),
  title: z.string().min(1),
  body: z.string().min(1),
  sourceType: z.string().optional(),
  sourceId: uuidSchema.optional(),
});
export type CreateNotificationBody = z.infer<
  typeof createNotificationSchema
>;

export const createPlatformTenantSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(2),
  defaultTimezone: z.string().optional(),
  defaultCurrency: z.string().length(3).optional(),
});
export type CreatePlatformTenantBody = z.infer<
  typeof createPlatformTenantSchema
>;

export const createPlatformUserSchema = z.object({
  authSubject: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email().optional(),
});
export type CreatePlatformUserBody = z.infer<
  typeof createPlatformUserSchema
>;

export const addMembershipSchema = z.object({
  userId: uuidSchema,
  roleCodes: z.array(z.string().min(1)).min(1),
});
export type AddMembershipBody = z.infer<typeof addMembershipSchema>;

export const createPlatformPersonSchema = z.object({
  employeeCode: z.string().min(1),
  displayName: z.string().min(1),
  employmentStatus: z.string().min(1).optional(),
  /** Optional platform user to link at creation time. */
  userId: uuidSchema.optional(),
});
export type CreatePlatformPersonBody = z.infer<
  typeof createPlatformPersonSchema
>;

export const linkPersonUserSchema = z.object({
  userId: uuidSchema,
});
export type LinkPersonUserBody = z.infer<typeof linkPersonUserSchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)");

export const createOrgNodeSchema = z.object({
  name: z.string().min(1),
  nodeType: z.string().min(1),
  parentId: uuidSchema.optional(),
});
export type CreateOrgNodeBody = z.infer<typeof createOrgNodeSchema>;

export const assignPersonOrgSchema = z
  .object({
    orgNodeId: uuidSchema,
    validFrom: isoDate,
    validTo: isoDate.optional(),
    allocation: decimal.optional(),
  })
  .refine(
    (value) => !value.validTo || value.validTo >= value.validFrom,
    "validTo must not be before validFrom",
  )
  .refine(
    (value) =>
      value.allocation === undefined ||
      (Number(value.allocation) >= 0 && Number(value.allocation) <= 1),
    "allocation must be between 0 and 1",
  );
export type AssignPersonOrgBody = z.infer<typeof assignPersonOrgSchema>;

export const setPersonManagerSchema = z.object({
  managerPersonId: uuidSchema.nullable(),
});
export type SetPersonManagerBody = z.infer<typeof setPersonManagerSchema>;

export const createDataQualityIssueSchema = z.object({
  objectType: z.string().min(1),
  objectId: uuidSchema,
  issueCode: z.string().min(1),
  severity: z.enum(["INFO", "WARNING", "BLOCKING"]),
  details: z.record(z.unknown()).optional(),
  assignedTo: uuidSchema.optional(),
});
export type CreateDataQualityIssueBody = z.infer<
  typeof createDataQualityIssueSchema
>;

export const dataQualityCommandSchema = z.object({
  command: z.enum(["ASSIGN", "START", "RESOLVE", "WAIVE", "REOPEN"]),
  assignedTo: uuidSchema.optional(),
  actorPersonId: uuidSchema.optional(),
  reason: z.string().optional(),
});
export type DataQualityCommandBody = z.infer<
  typeof dataQualityCommandSchema
>;

export const createEvaluationCycleSchema = z.object({
  name: z.string().min(1),
  cycleType: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string().min(1),
  policyVersionId: z.string().min(1).optional(),
  rubricVersionId: uuidSchema.optional(),
});
export type CreateEvaluationCycleBody = z.infer<
  typeof createEvaluationCycleSchema
>;

export const createRubricSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  dimensions: z.array(z.string().min(1)).min(1),
  scoringAnchors: z.record(z.unknown()),
  scope: z.record(z.unknown()).optional(),
  effectiveFrom: z.string().min(1),
});
export type CreateRubricBody = z.infer<typeof createRubricSchema>;

export const createEvaluationDraftSchema = z.object({
  cycleId: uuidSchema,
  personId: uuidSchema,
  generatedByType: z.enum(["AGENT", "USER", "SYSTEM"]),
  generatedById: uuidSchema.optional(),
  modelProvider: z.string().optional(),
  modelName: z.string().optional(),
  promptVersion: z.string().optional(),
  agentTaskId: uuidSchema.optional(),
  evidenceSnapshotHash: z.string().min(1),
  draftPayload: z.record(z.unknown()),
  strengths: z.array(z.string()).default([]),
  counterEvidence: z.array(z.string()).default([]),
  missingInformation: z.array(z.string()).default([]),
  uncertainty: z.record(z.unknown()).default({}),
});
export type CreateEvaluationDraftBody = z.input<
  typeof createEvaluationDraftSchema
>;

export const decideEvaluationDraftSchema = z.object({
  reviewerPersonId: uuidSchema,
  rubricVersionId: uuidSchema,
  decision: z.enum(["APPROVE", "REJECT"]),
  scores: z.record(z.number().min(0).max(5)).default({}),
  rationale: z.string().min(3),
});
export type DecideEvaluationDraftBody = z.infer<
  typeof decideEvaluationDraftSchema
>;

export const publishPolicySchema = z.object({
  policy: policyDefinitionSchema,
  policyVersionId: uuidSchema.optional(),
  effectiveFrom: z.string().datetime(),
  approvedBy: uuidSchema,
  scope: z.record(z.unknown()).optional(),
});
export type PublishPolicyBody = z.infer<typeof publishPolicySchema>;

export const policySimulationSchema = z.object({
  currentPolicyVersionId: z.string().min(1),
  proposedPolicy: policyDefinitionSchema,
  samples: z
    .array(
      z.object({
        personId: uuidSchema,
        input: createCalculationRunSchema,
      }),
    )
    .min(1),
});
export type PolicySimulationBody = z.input<typeof policySimulationSchema>;

export const ingestionEventSchema = z.object({
  sourceRecordId: z.string().min(1),
  sourceEventVersion: z.string().min(1).optional(),
  eventType: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  subjectType: z.string().min(1),
  subjectId: uuidSchema,
  evidenceType: z.string().min(1),
  payload: z.record(z.unknown()),
  qualityStatus: z
    .enum(["VALID", "MISSING", "STALE", "CONFLICTED", "UNVERIFIED", "INVALID"])
    .optional(),
  sourceUri: z.string().optional(),
});
export type IngestionEventBody = z.input<typeof ingestionEventSchema>;

export const ingestionBatchSchema = z.object({
  sourceSystem: z.string().min(1),
  events: z.array(ingestionEventSchema).min(1),
});
export type IngestionBatchBody = z.input<typeof ingestionBatchSchema>;
