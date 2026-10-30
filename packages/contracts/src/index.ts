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
  expectedVersion: z.number().int().positive().optional(),
});
export type AcceptWorkPackageInput = z.infer<typeof acceptWorkPackageSchema>;

export const workPackageCommandSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
});
export type WorkPackageCommandInput = z.infer<
  typeof workPackageCommandSchema
>;

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
  expectedVersion: z.number().int().positive().optional(),
});
export type RejectWorkPackageInput = z.infer<typeof rejectWorkPackageSchema>;

export const createContributionClaimSchema = z
  .object({
    workPackageId: uuidSchema,
    claimantPersonId: uuidSchema,
    claimType: z.string().min(1),
    claimMode: z.enum(["STANDARD", "EXCEPTION", "BACKFILL"]).default("STANDARD"),
    exceptionReason: z.string().min(3).optional(),
    claimedContribution: z.object({
      dimensions: z.array(z.string().min(1)).min(1),
      summary: z.string().min(1),
    }),
    evidenceRefs: z.array(z.string().min(1)).default([]),
    rationale: z.string().min(3),
  })
  .superRefine((value, context) => {
    if (value.claimMode !== "STANDARD" && !value.exceptionReason?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exceptionReason"],
        message: "exceptionReason is required for EXCEPTION or BACKFILL claims",
      });
    }
  });
export type CreateContributionClaimInput = z.input<
  typeof createContributionClaimSchema
>;

export const createPilotEnrollmentSchema = z.object({
  personId: uuidSchema,
  pilotCode: z.string().min(1),
  scope: z.string().min(1),
  consentSignatureRef: z.string().min(1),
  consentSignedAt: z.string().datetime().optional(),
});
export type CreatePilotEnrollmentBody = z.infer<
  typeof createPilotEnrollmentSchema
>;

export const withdrawPilotEnrollmentSchema = z.object({
  personId: uuidSchema.optional(),
  reason: z.string().min(3).optional(),
});
export type WithdrawPilotEnrollmentBody = z.infer<
  typeof withdrawPilotEnrollmentSchema
>;

export const createManagerTrainingRecordSchema = z.object({
  personId: uuidSchema,
  trainingCode: z.string().min(1),
  title: z.string().min(1),
  completedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  evidenceRef: z.string().min(1).optional(),
});
export type CreateManagerTrainingRecordBody = z.infer<
  typeof createManagerTrainingRecordSchema
>;

export const createCalibrationSessionSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  heldAt: z.string().datetime(),
  facilitatorPersonId: uuidSchema,
  attendeePersonIds: z.array(uuidSchema).min(1),
  policyVersionId: uuidSchema.optional(),
  notes: z.string().optional(),
});
export type CreateCalibrationSessionBody = z.infer<
  typeof createCalibrationSessionSchema
>;

export const createFairnessCommitmentSchema = z.object({
  statement: z.string().min(10),
  ownerPersonId: uuidSchema,
  channels: z.array(z.string().min(1)).default([]),
});
export type CreateFairnessCommitmentBody = z.infer<
  typeof createFairnessCommitmentSchema
>;

export const trustSurveyQuestionSchema = z.object({
  code: z.string().min(1),
  prompt: z.string().min(1),
  dimension: z.string().min(1),
});

export const createTrustSurveySchema = z.object({
  code: z.string().min(1),
  period: z.string().min(1),
  title: z.string().min(1),
  questions: z.array(trustSurveyQuestionSchema).min(1),
});
export type CreateTrustSurveyBody = z.infer<typeof createTrustSurveySchema>;

export const submitTrustSurveyResponseSchema = z.object({
  personId: uuidSchema.optional(),
  scores: z.record(z.number().min(1).max(5)),
});
export type SubmitTrustSurveyResponseBody = z.infer<
  typeof submitTrustSurveyResponseSchema
>;

export const createContributionAttestationSchema = z.object({
  workPackageId: uuidSchema,
  subjectPersonId: uuidSchema,
  attesterPersonId: uuidSchema,
  attestationType: z.enum(["PEER", "MANAGER"]),
  statement: z.string().min(3),
  evidenceRefs: z.array(z.string().min(1)).default([]),
});
export type CreateContributionAttestationBody = z.infer<
  typeof createContributionAttestationSchema
>;

export const withdrawContributionAttestationSchema = z.object({
  personId: uuidSchema.optional(),
});
export type WithdrawContributionAttestationBody = z.infer<
  typeof withdrawContributionAttestationSchema
>;

export const createConflictDeclarationSchema = z
  .object({
    personId: uuidSchema,
    relatedPersonId: uuidSchema,
    relationshipType: z.string().min(1),
    description: z.string().min(3),
  })
  .superRefine((value, context) => {
    if (value.personId === value.relatedPersonId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["relatedPersonId"],
        message: "a person cannot declare a conflict with themselves",
      });
    }
  });
export type CreateConflictDeclarationBody = z.infer<
  typeof createConflictDeclarationSchema
>;

export const revokeConflictDeclarationSchema = z.object({
  reason: z.string().min(3),
});
export type RevokeConflictDeclarationBody = z.infer<
  typeof revokeConflictDeclarationSchema
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
  approvalRequestId: uuidSchema.optional(),
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

export const createRetentionPolicySchema = z.object({
  dataCategory: z.string().min(1),
  retentionMonths: z.number().int().positive(),
  legalBasis: z.string().min(1),
  legalHold: z.boolean().default(false),
});
export type CreateRetentionPolicyBody = z.infer<
  typeof createRetentionPolicySchema
>;

export const setRetentionLegalHoldSchema = z.object({
  legalHold: z.boolean(),
});
export type SetRetentionLegalHoldBody = z.infer<
  typeof setRetentionLegalHoldSchema
>;

export const dataSourceFieldSchema = z.object({
  fieldName: z.string().min(1),
  classification: z.enum([
    "PUBLIC",
    "INTERNAL",
    "CONFIDENTIAL",
    "PERSONAL",
    "SENSITIVE",
  ]),
  purpose: z.string().min(1),
  retentionMonths: z.number().int().positive().optional(),
});
export type DataSourceFieldBody = z.infer<typeof dataSourceFieldSchema>;

export const createDataSourceSchema = z
  .object({
    code: z.string().min(1).max(80),
    name: z.string().min(1),
    category: z.string().min(1),
    ownerPersonId: uuidSchema,
    backupOwnerPersonId: uuidSchema.optional(),
    slaHours: z.number().int().positive().max(8760),
    criticality: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    containsPersonalData: z.boolean().default(true),
    storageRegion: z.string().min(1),
    crossBorderTransfers: z.boolean().default(false),
    processorRefs: z.array(z.string().min(1)).default([]),
    fields: z.array(dataSourceFieldSchema).min(1),
    lastReviewedAt: z.string().datetime().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.containsPersonalData &&
      !value.fields.some(
        (field) =>
          field.classification === "PERSONAL" ||
          field.classification === "SENSITIVE",
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields"],
        message:
          "containsPersonalData requires at least one PERSONAL or SENSITIVE field",
      });
    }
  });
export type CreateDataSourceBody = z.infer<typeof createDataSourceSchema>;

export const createApprovalRequestSchema = z.object({
  actionType: z.string().min(1),
  targetType: z.string().min(1),
  targetId: uuidSchema,
  targetVersion: z.number().int().positive().default(1),
  requestedByType: z.enum(["USER", "AGENT", "SYSTEM"]),
  requestedById: uuidSchema.optional(),
  riskTier: z.enum(["T0", "T1", "T2", "T3"]),
  requiredApprovals: z.number().int().positive().default(1),
  expiresAt: z.string().datetime().optional(),
  payload: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().min(1),
});
export type CreateApprovalRequestBody = z.infer<
  typeof createApprovalRequestSchema
>;

export const decideApprovalRequestSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  approverPersonId: uuidSchema,
  payloadHash: z.string().min(1),
  reason: z.string().min(1).optional(),
  authContext: z.record(z.unknown()).default({}),
});
export type DecideApprovalRequestBody = z.infer<
  typeof decideApprovalRequestSchema
>;

export const consumeApprovalRequestSchema = z.object({
  consumedBy: uuidSchema,
});
export type ConsumeApprovalRequestBody = z.infer<
  typeof consumeApprovalRequestSchema
>;

export const createBudgetPoolSchema = z.object({
  cycleId: uuidSchema,
  code: z.string().min(1),
  name: z.string().min(1),
  poolType: z.string().min(1),
  currency: z.string().length(3),
  approvedAmount: decimal,
});
export type CreateBudgetPoolBody = z.infer<typeof createBudgetPoolSchema>;

export const approveBudgetPoolSchema = z.object({
  approvedBy: uuidSchema,
});
export type ApproveBudgetPoolBody = z.infer<typeof approveBudgetPoolSchema>;

export const createBudgetAllocationSchema = z.object({
  targetType: z.string().min(1),
  targetId: uuidSchema,
  amount: decimal,
});
export type CreateBudgetAllocationBody = z.infer<
  typeof createBudgetAllocationSchema
>;

export const createCashGateInputSchema = z.object({
  cycleId: uuidSchema,
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)"),
  safetyReserveMonths: decimal,
  thirteenWeekForecastRef: z.string().min(1),
  passesGate: z.boolean(),
  approvedBy: uuidSchema,
  approvedAt: z.string().datetime().optional(),
});
export type CreateCashGateInputBody = z.infer<
  typeof createCashGateInputSchema
>;

export const createFinancialFactSchema = z.object({
  sourceSystem: z.string().min(1),
  sourceRecordId: z.string().min(1),
  factType: z.string().min(1),
  periodStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)")
    .optional(),
  periodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)")
    .optional(),
  amount: decimal,
  currency: z.string().length(3),
  qualityStatus: z
    .enum(["VALID", "MISSING", "STALE", "CONFLICTED", "UNVERIFIED", "INVALID"])
    .default("UNVERIFIED"),
  sourceUpdatedAt: z.string().datetime().optional(),
  payload: z.record(z.unknown()).default({}),
});
export type CreateFinancialFactBody = z.infer<
  typeof createFinancialFactSchema
>;

export const createRuleChangeOrderSchema = z.object({
  policyCode: z.string().min(1),
  fromPolicyVersionId: uuidSchema.optional(),
  toPolicyVersionId: uuidSchema,
  changeType: z.string().min(1),
  reason: z.string().min(3),
  impactSimulation: z.record(z.unknown()).default({}),
  effectiveFrom: z.string().datetime(),
  requestedBy: uuidSchema,
});
export type CreateRuleChangeOrderBody = z.infer<
  typeof createRuleChangeOrderSchema
>;

export const reviewRuleChangeOrderSchema = z.object({
  approvedBy: uuidSchema,
});
export type ReviewRuleChangeOrderBody = z.infer<
  typeof reviewRuleChangeOrderSchema
>;

export const createPolicyTestCaseSchema = z.object({
  policyVersionId: uuidSchema,
  caseCode: z.string().min(1),
  input: z.record(z.unknown()),
  expectedOutput: z.record(z.unknown()),
  category: z.enum(["NORMAL", "BOUNDARY", "EXCEPTION", "HISTORICAL"]),
});
export type CreatePolicyTestCaseBody = z.infer<
  typeof createPolicyTestCaseSchema
>;

export const createPolicyNoticeSchema = z.object({
  policyVersionId: uuidSchema,
  noticeId: uuidSchema,
  audience: z.record(z.unknown()).default({}),
});
export type CreatePolicyNoticeBody = z.infer<
  typeof createPolicyNoticeSchema
>;

export const createMetricDefinitionSchema = z
  .object({
    code: z.string().min(1),
    version: z.number().int().positive(),
    name: z.string().min(1),
    description: z.string().optional(),
    dataType: z.string().min(1),
    unit: z.string().optional(),
    aggregationMethod: z.string().optional(),
    sourceContract: z.record(z.unknown()).default({}),
    effectiveFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)"),
    effectiveTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)")
      .optional(),
  })
  .refine(
    (value) =>
      !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
    "effectiveTo must not be before effectiveFrom",
  );
export type CreateMetricDefinitionBody = z.infer<
  typeof createMetricDefinitionSchema
>;

export const createDeliverableSchema = z.object({
  title: z.string().min(1),
  deliverableType: z.string().min(1),
  ownerPersonId: uuidSchema,
  dueAt: z.string().datetime().optional(),
});
export type CreateDeliverableBody = z.infer<typeof createDeliverableSchema>;

export const submitDeliverableSchema = z.object({
  artifactRef: z.string().min(1).optional(),
  contentHash: z.string().min(1).optional(),
});
export type SubmitDeliverableBody = z.infer<
  typeof submitDeliverableSchema
>;

export const recordDeliverableAcceptanceSchema = z.object({
  decision: z.enum(["ACCEPT", "REJECT", "ACCEPT_WITH_ISSUES"]),
  reviewerPersonId: uuidSchema,
  criteriaResults: z.record(z.unknown()).default({}),
  comments: z.string().optional(),
});
export type RecordDeliverableAcceptanceBody = z.infer<
  typeof recordDeliverableAcceptanceSchema
>;

export const createAiSuggestionLogSchema = z.object({
  agentTaskId: uuidSchema,
  targetType: z.string().min(1),
  targetId: uuidSchema.optional(),
  suggestionType: z.string().min(1),
  modelProvider: z.string().min(1).optional(),
  modelName: z.string().min(1).optional(),
  modelPromptId: uuidSchema.optional(),
  promptVersion: z.string().min(1),
  inputHash: z.string().min(1),
  outputJson: z.record(z.unknown()),
  validationStatus: z.string().min(1),
});
export type CreateAiSuggestionLogBody = z.infer<
  typeof createAiSuggestionLogSchema
>;

export const acceptAiSuggestionSchema = z.object({
  acceptedBy: uuidSchema,
});
export type AcceptAiSuggestionBody = z.infer<
  typeof acceptAiSuggestionSchema
>;

export const createModelEvaluationRunSchema = z.object({
  evaluationType: z.string().min(1),
  modelProvider: z.string().min(1),
  modelName: z.string().min(1),
  promptVersion: z.string().min(1),
  datasetRef: z.string().min(1),
  sampleSize: z.number().int().positive(),
  metrics: z.record(z.unknown()).default({}),
  subgroupMetrics: z.record(z.unknown()).default({}),
  passed: z.boolean(),
  blockers: z.array(z.string()).default([]),
});
export type CreateModelEvaluationRunBody = z.infer<
  typeof createModelEvaluationRunSchema
>;

export const modelEvaluationSampleSchema = z.object({
  sampleId: z.string().min(1),
  subgroup: z.string().min(1),
  humanScoreA: z.number(),
  humanScoreB: z.number(),
  aiScore: z.number(),
  counterfactualScores: z.array(z.number()).min(1),
  promptInjectionPassed: z.boolean(),
  holdout: z.boolean().default(false),
});
export type ModelEvaluationSample = z.infer<typeof modelEvaluationSampleSchema>;

export const modelEvaluationThresholdsSchema = z.object({
  minSampleSize: z.number().int().positive().default(100),
  minKappa: z.number().min(0).max(1).default(0.6),
  maxSubgroupErrorGap: z.number().min(0).default(0.1),
  minCounterfactualStability: z.number().min(0).max(1).default(0.95),
  minPromptInjectionPassRate: z.number().min(0).max(1).default(1),
  minHoldoutSampleSize: z.number().int().min(0).default(0),
});
export type ModelEvaluationThresholds = z.infer<
  typeof modelEvaluationThresholdsSchema
>;

export const runModelEvaluationSchema = z.object({
  evaluationType: z.string().min(1),
  modelProvider: z.string().min(1),
  modelName: z.string().min(1),
  promptVersion: z.string().min(1),
  datasetRef: z.string().min(1),
  samples: z.array(modelEvaluationSampleSchema).min(1),
  thresholds: modelEvaluationThresholdsSchema.optional(),
});
export type RunModelEvaluationBody = z.infer<
  typeof runModelEvaluationSchema
>;

export const createModelPromptSchema = z.object({
  promptCode: z.string().min(1),
  version: z.number().int().positive(),
  purpose: z.string().min(1),
  modelProvider: z.string().min(1),
  modelName: z.string().min(1),
  template: z.string().min(1),
});
export type CreateModelPromptBody = z.infer<typeof createModelPromptSchema>;

export const activateModelPromptSchema = z.object({
  evaluationRunId: uuidSchema,
});
export type ActivateModelPromptBody = z.infer<
  typeof activateModelPromptSchema
>;

export const scoringEvidenceSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  text: z.string().min(1),
  dimension: z.string().min(1).optional(),
  quality: z
    .enum(["VALID", "UNVERIFIED", "STALE", "CONFLICTED", "INVALID"])
    .optional(),
});

export const createAiScoreProposalSchema = z.object({
  cycleId: uuidSchema,
  personId: uuidSchema,
  evaluationRunId: uuidSchema,
  modelPromptId: uuidSchema.optional(),
  dimensions: z.array(z.string().min(1)).min(1),
  evidence: z.array(scoringEvidenceSchema).min(1),
  requestedBy: uuidSchema.optional(),
});
export type CreateAiScoreProposalBody = z.infer<
  typeof createAiScoreProposalSchema
>;

export const decideAiScoreProposalSchema = z.object({
  decision: z.enum(["ACCEPT", "REJECT"]),
  decidedBy: uuidSchema,
  note: z.string().optional(),
  independentScores: z.record(z.number().min(0).max(5)),
  independentRationale: z.string().optional(),
  reviewStartedAt: z.string().datetime(),
  evidenceOpened: z.number().int().min(0).default(0),
  overrideReason: z.string().optional(),
  blindReview: z.boolean().default(false),
});
export type DecideAiScoreProposalBody = z.infer<
  typeof decideAiScoreProposalSchema
>;

export const submitAiScoreAuditSchema = z.object({
  reviewerPersonId: uuidSchema,
  scores: z.record(z.number().min(0).max(5)),
  rationale: z.string().min(3),
  reviewStartedAt: z.string().datetime(),
  evidenceOpened: z.number().int().min(0).default(0),
});
export type SubmitAiScoreAuditBody = z.infer<
  typeof submitAiScoreAuditSchema
>;

export const createWorkflowRunSchema = z.object({
  agentTaskId: uuidSchema,
  workflowName: z.string().min(1),
  workflowVersion: z.string().min(1),
  status: z.string().min(1),
  currentStep: z.string().min(1).optional(),
  state: z.record(z.unknown()).default({}),
  startedAt: z.string().datetime().optional(),
});
export type CreateWorkflowRunBody = z.infer<
  typeof createWorkflowRunSchema
>;

export const finishWorkflowRunSchema = z.object({
  status: z.string().min(1),
  currentStep: z.string().min(1).optional(),
});
export type FinishWorkflowRunBody = z.infer<
  typeof finishWorkflowRunSchema
>;

export const createIntegrationConnectionSchema = z.object({
  provider: z.string().min(1),
  connectionName: z.string().min(1),
  credentialRef: z.string().min(1),
  config: z.record(z.unknown()).default({}),
});
export type CreateIntegrationConnectionBody = z.infer<
  typeof createIntegrationConnectionSchema
>;

export const setIntegrationConnectionStatusSchema = z.object({
  status: z.string().min(1),
});
export type SetIntegrationConnectionStatusBody = z.infer<
  typeof setIntegrationConnectionStatusSchema
>;

export const createIntegrationMappingSchema = z.object({
  name: z.string().min(1),
  mappingType: z.enum(["CSV", "HTTP_JSON"]),
  sourceSystem: z.string().min(1),
  targetType: z.string().min(1),
  fieldMap: z.record(z.string().min(1)).refine(
    (value) => Object.keys(value).length > 0,
    "fieldMap must contain at least one mapping",
  ),
  config: z.record(z.unknown()).default({}),
  version: z.number().int().positive().default(1),
});
export type CreateIntegrationMappingBody = z.infer<
  typeof createIntegrationMappingSchema
>;

export const createSyncRunSchema = z.object({
  status: z.string().min(1).default("QUEUED"),
  cursorBefore: z.record(z.unknown()).optional(),
});
export type CreateSyncRunBody = z.infer<typeof createSyncRunSchema>;

export const finishSyncRunSchema = z.object({
  status: z.string().min(1),
  recordsSeen: z.number().int().min(0).default(0),
  recordsUpserted: z.number().int().min(0).default(0),
  cursorAfter: z.record(z.unknown()).optional(),
  errorSummary: z.string().optional(),
});
export type FinishSyncRunBody = z.infer<typeof finishSyncRunSchema>;

export const createSyncScheduleSchema = z.object({
  name: z.string().min(1),
  intervalMinutes: z.number().int().min(1),
  startAt: z.string().datetime().optional(),
});
export type CreateSyncScheduleBody = z.infer<
  typeof createSyncScheduleSchema
>;

export const setSyncScheduleEnabledSchema = z.object({
  enabled: z.boolean(),
});
export type SetSyncScheduleEnabledBody = z.infer<
  typeof setSyncScheduleEnabledSchema
>;

export const claimDueSyncSchedulesSchema = z.object({
  limit: z.number().int().min(1).max(100).default(10),
  now: z.string().datetime().optional(),
});
export type ClaimDueSyncSchedulesBody = z.infer<
  typeof claimDueSyncSchedulesSchema
>;

export const createEquityGrantSchema = z.object({
  personId: uuidSchema,
  grantCode: z.string().min(1),
  grantType: z.enum(["OPTION", "RSU", "SAR"]),
  totalUnits: decimal,
  strikePrice: decimal,
  currency: z.string().length(3),
  grantDate: z.string().datetime(),
  vestingStart: z.string().datetime(),
  cliffMonths: z.number().int().min(0).default(0),
  vestingMonths: z.number().int().min(1),
});
export type CreateEquityGrantBody = z.infer<
  typeof createEquityGrantSchema
>;

export const createEquityExerciseSchema = z.object({
  units: decimal,
  requestedBy: uuidSchema,
});
export type CreateEquityExerciseBody = z.infer<
  typeof createEquityExerciseSchema
>;

export const approveEquityExerciseSchema = z.object({
  approvedBy: uuidSchema,
});
export type ApproveEquityExerciseBody = z.infer<
  typeof approveEquityExerciseSchema
>;

export const createBountySchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  rewardAmount: decimal,
  currency: z.string().length(3),
  createdBy: uuidSchema,
  dueAt: z.string().datetime().optional(),
});
export type CreateBountyBody = z.infer<typeof createBountySchema>;

export const claimBountySchema = z.object({
  personId: uuidSchema,
});
export type ClaimBountyBody = z.infer<typeof claimBountySchema>;

export const submitBountySchema = z.object({
  personId: uuidSchema,
  submissionRef: z.string().min(1),
});
export type SubmitBountyBody = z.infer<typeof submitBountySchema>;

export const acceptBountySchema = z.object({
  reviewerPersonId: uuidSchema,
  paymentRef: z.string().min(1).optional(),
});
export type AcceptBountyBody = z.infer<typeof acceptBountySchema>;

export const adverseActionTypeSchema = z.enum([
  "PIP",
  "TRAINING",
  "REASSIGNMENT",
  "DEMOTION",
  "PAY_REDUCTION",
  "TERMINATION",
]);

export const createAdverseActionSchema = z.object({
  personId: uuidSchema,
  actionType: adverseActionTypeSchema,
  reason: z.string().min(3),
  performanceBasis: z.string().min(3),
  evidenceRefs: z.array(uuidSchema).default([]),
  requestedBy: uuidSchema,
});
export type CreateAdverseActionBody = z.infer<
  typeof createAdverseActionSchema
>;

export const reviewAdverseActionSchema = z.object({
  legalReviewerId: uuidSchema,
  legalReviewRef: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().optional(),
});
export type ReviewAdverseActionBody = z.infer<
  typeof reviewAdverseActionSchema
>;

export const approveAdverseActionSchema = z.object({
  approvedBy: uuidSchema,
});
export type ApproveAdverseActionBody = z.infer<
  typeof approveAdverseActionSchema
>;

export const activateAdverseActionSchema = z.object({
  effectiveFrom: z.string().datetime(),
});
export type ActivateAdverseActionBody = z.infer<
  typeof activateAdverseActionSchema
>;

export const cancelAdverseActionSchema = z.object({
  reason: z.string().min(3),
});
export type CancelAdverseActionBody = z.infer<
  typeof cancelAdverseActionSchema
>;

export const createEmploymentContractSchema = z.object({
  personId: uuidSchema,
  contractCode: z.string().min(1),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACTOR"]),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  workLocation: z.string().min(1),
  currency: z.string().length(3),
  fixedMonthlySalary: decimal,
  minimumMonthlyWage: decimal,
  taxRate: decimal.default("0"),
  socialInsuranceRate: decimal.default("0"),
  deductionCapRate: decimal.default("0.2"),
  variableShareCapRate: decimal.default("1"),
  bankAccountRef: z.string().min(1).optional(),
  consentSignatureRef: z.string().min(1),
  consentSignedAt: z.string().datetime().optional(),
});
export type CreateEmploymentContractBody = z.infer<
  typeof createEmploymentContractSchema
>;

export const amendEmploymentContractSchema = z.object({
  fixedMonthlySalary: decimal,
  minimumMonthlyWage: decimal,
  taxRate: decimal,
  socialInsuranceRate: decimal,
  deductionCapRate: decimal,
  variableShareCapRate: decimal,
  bankAccountRef: z.string().min(1).optional(),
  effectiveFrom: z.string().datetime(),
  consentSignatureRef: z.string().min(1),
  approvedBy: uuidSchema,
});
export type AmendEmploymentContractBody = z.infer<
  typeof amendEmploymentContractSchema
>;

export const createPayrollRunSchema = z.object({
  cycleId: uuidSchema,
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  currency: z.string().length(3),
  preparedBy: uuidSchema,
});
export type CreatePayrollRunBody = z.infer<typeof createPayrollRunSchema>;

export const approvePayrollRunSchema = z.object({
  approvedBy: uuidSchema,
});
export type ApprovePayrollRunBody = z.infer<
  typeof approvePayrollRunSchema
>;

export const calculateCnIitSchema = z.object({
  cumulativeTaxableIncome: decimal,
  taxAlreadyWithheld: decimal.default("0"),
});
export type CalculateCnIitBody = z.infer<typeof calculateCnIitSchema>;

export const payrollLineInputSchema = z.object({
  personId: uuidSchema,
  contractId: uuidSchema,
  fixedAmount: decimal,
  incentiveAmount: decimal,
  grossAmount: decimal,
  deductionAmount: decimal,
  taxAmount: decimal,
  socialInsuranceAmount: decimal,
  netAmount: decimal,
  minimumMonthlyWage: decimal,
  minimumWagePassed: z.boolean(),
  deductionCapRate: decimal,
  deductionCapAmount: decimal,
  deductionCapPassed: z.boolean(),
  variableShareRate: decimal,
  variableShareCapRate: decimal,
  variableShareCapAmount: decimal,
  variableSharePassed: z.boolean(),
  bankAccountRef: z.string().min(1).optional(),
});
export type PayrollLineInput = z.infer<typeof payrollLineInputSchema>;

export const savePayrollCalculationSchema = z.object({
  lines: z.array(payrollLineInputSchema).min(1),
  totalGross: decimal,
  totalDeductions: decimal,
  totalTax: decimal,
  totalSocialInsurance: decimal,
  totalNet: decimal,
  blockedCount: z.number().int().min(0),
});
export type SavePayrollCalculationBody = z.infer<
  typeof savePayrollCalculationSchema
>;

export const reversePayrollRunSchema = z.object({
  reason: z.string().min(1),
  reversedBy: uuidSchema,
});
export type ReversePayrollRunBody = z.infer<
  typeof reversePayrollRunSchema
>;

export const upsertExternalIdentitySchema = z.object({
  sourceSystem: z.string().min(1),
  externalId: z.string().min(1),
  personId: uuidSchema.optional(),
  objectType: z.string().min(1),
});
export type UpsertExternalIdentityBody = z.infer<
  typeof upsertExternalIdentitySchema
>;

export const receiveWebhookSchema = z.object({
  sourceSystem: z.string().min(1),
  messageId: z.string().min(1),
  payloadHash: z.string().min(1),
});
export type ReceiveWebhookBody = z.infer<typeof receiveWebhookSchema>;

export const processWebhookSchema = z.object({
  status: z.enum(["PROCESSED", "FAILED"]),
  errorCode: z.string().min(1).optional(),
});
export type ProcessWebhookBody = z.infer<typeof processWebhookSchema>;

export const adjustLedgerEntrySchema = z.object({
  amount: decimal,
  reasonCode: z.string().min(1),
  explanation: z.string().min(3),
  approvedBy: uuidSchema,
  idempotencyKey: z.string().min(1),
  approvalRequestId: uuidSchema.optional(),
});
export type AdjustLedgerEntryBody = z.infer<typeof adjustLedgerEntrySchema>;

export const receiveInboxMessageSchema = z.object({
  consumerName: z.string().min(1),
  messageId: z.string().min(1),
});
export type ReceiveInboxMessageBody = z.infer<
  typeof receiveInboxMessageSchema
>;

export const processInboxMessageSchema = z.object({
  status: z.enum(["PROCESSED", "FAILED", "IGNORED"]),
  errorCode: z.string().min(1).optional(),
});
export type ProcessInboxMessageBody = z.infer<
  typeof processInboxMessageSchema
>;

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

export const createRecalculationRequestSchema = z.object({
  targetType: z.enum(["EVIDENCE", "ATTRIBUTION", "EVALUATION", "LEDGER"]),
  targetId: uuidSchema,
  reasonCode: z.string().min(1),
  explanation: z.string().min(3),
  requestedBy: uuidSchema,
});
export type CreateRecalculationRequestBody = z.infer<
  typeof createRecalculationRequestSchema
>;

export const reviewRecalculationRequestSchema = z.object({
  approvedBy: uuidSchema,
});
export type ReviewRecalculationRequestBody = z.infer<
  typeof reviewRecalculationRequestSchema
>;

export const completeRecalculationRequestSchema = z.object({
  newCalculationRunId: uuidSchema,
});
export type CompleteRecalculationRequestBody = z.infer<
  typeof completeRecalculationRequestSchema
>;

export const createCalculationRunSchema = z.object({
  cycleId: uuidSchema,
  policyVersionId: z.string().min(1),
  mode: z.enum(["SHADOW", "FORMAL"]),
  budgetPoolId: uuidSchema.optional(),
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
  approvalRequestId: uuidSchema.optional(),
});
export type LockCalculationRunInput = z.infer<
  typeof lockCalculationRunSchema
>;

export const approveCalculationRunSchema = z.object({
  approvalRequestId: uuidSchema.optional(),
});
export type ApproveCalculationRunBody = z.infer<
  typeof approveCalculationRunSchema
>;

export const createAppealSchema = z.object({
  appellantPersonId: uuidSchema,
  targetType: z.enum(["ATTRIBUTION", "EVALUATION", "LEDGER", "CALCULATION"]),
  targetId: uuidSchema,
  reasonCode: z.string().min(1),
  statement: z.string().min(5),
  evidenceRefs: z.array(uuidSchema).default([]),
  dueAt: z.string().datetime().optional(),
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
  approvalRequestId: uuidSchema.optional(),
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
  approvalRequestId: uuidSchema.optional(),
});
export type SettlementCommandBody = z.infer<typeof settlementCommandSchema>;

export const recordSettlementExportSchema = z.object({
  exportedBy: uuidSchema,
  exportRef: z.string().min(1).optional(),
});
export type RecordSettlementExportBody = z.infer<
  typeof recordSettlementExportSchema
>;

export const acknowledgeSettlementExportSchema = z.object({
  externalReference: z.string().min(1),
  acknowledgedAt: z.string().datetime().optional(),
});
export type AcknowledgeSettlementExportBody = z.infer<
  typeof acknowledgeSettlementExportSchema
>;

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

export const updateTenantSettingsSchema = z
  .object({
    requiredApprovals: z.array(z.string().min(1)).optional(),
  })
  .passthrough();
export type UpdateTenantSettingsBody = z.infer<
  typeof updateTenantSettingsSchema
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
  dueAt: z.string().datetime().optional(),
});
export type CreateDataQualityIssueBody = z.infer<
  typeof createDataQualityIssueSchema
>;

export const dataQualityCommandSchema = z.object({
  command: z.enum([
    "ASSIGN",
    "START",
    "RESOLVE",
    "WAIVE",
    "REOPEN",
    "ESCALATE",
  ]),
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

export const policyPackManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  status: z.string().min(1),
  description: z.string().min(1),
  corePolicyCode: z.string().min(1),
  policy: z.string().min(1),
  fixtures: z.string().min(1),
  policyVersionId: uuidSchema,
  applicability: z.object({
    legalEntity: z.string().min(1),
    jurisdictions: z.array(z.string().min(1)).min(1),
    workLocations: z.array(z.string().min(1)).min(1),
    employeeCategories: z.array(z.string().min(1)).min(1),
    workTimeTypes: z.array(z.string().min(1)).min(1),
  }),
  roles: z
    .array(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        employmentTypes: z.array(z.string().min(1)).default([]),
        description: z.string().optional(),
      }),
    )
    .min(1),
  workPackageTemplates: z
    .array(
      z.object({
        code: z.string().min(1),
        title: z.string().min(1),
        objective: z.string().min(1),
        defaultResponsibilityCode: z.string().min(1).optional(),
        acceptanceCriteria: z.array(z.string().min(1)).min(1),
        evidenceRequirementCodes: z.array(z.string().min(1)).default([]),
      }),
    )
    .min(1),
  evidenceRequirements: z
    .array(
      z.object({
        code: z.string().min(1),
        roleCode: z.string().min(1).optional(),
        requiredTypes: z.array(z.string().min(1)).min(1),
        minCount: z.number().int().min(1).default(1),
        minimumQuality: z.string().min(1).optional(),
        ownerRoleCode: z.string().min(1).optional(),
        slaHours: z.number().int().min(1).optional(),
      }),
    )
    .min(1),
  simulationData: z.record(z.unknown()).optional(),
  seed: z.record(z.unknown()).optional(),
});
export type PolicyPackManifest = z.infer<typeof policyPackManifestSchema>;

export const policyApplicabilitySchema = z.object({
  legalEntity: z.string().min(1),
  jurisdictions: z.array(z.string().min(1)).min(1),
  workLocations: z.array(z.string().min(1)).min(1),
  employeeCategories: z.array(z.string().min(1)).min(1),
  workTimeTypes: z.array(z.string().min(1)).min(1),
});
export type PolicyApplicabilityBody = z.infer<
  typeof policyApplicabilitySchema
>;

export const publishPolicySchema = z.object({
  policy: policyDefinitionSchema,
  policyVersionId: uuidSchema.optional(),
  effectiveFrom: z.string().datetime(),
  approvedBy: uuidSchema,
  scope: z.record(z.unknown()).optional(),
  applicability: policyApplicabilitySchema,
  approvalRequestId: uuidSchema.optional(),
});
export type PublishPolicyBody = z.infer<typeof publishPolicySchema>;

export const rollbackPolicySchema = z.object({
  newPolicyVersionId: uuidSchema.optional(),
  effectiveFrom: z.string().datetime(),
  approvedBy: uuidSchema,
  approvalRequestId: uuidSchema.optional(),
});
export type RollbackPolicyBody = z.infer<typeof rollbackPolicySchema>;

export const cycleReadinessQuerySchema = z.object({
  cycleId: uuidSchema,
});
export type CycleReadinessQuery = z.infer<typeof cycleReadinessQuerySchema>;

export const policyReadinessQuerySchema = z.object({
  policyVersionId: uuidSchema,
});
export type PolicyReadinessQuery = z.infer<typeof policyReadinessQuerySchema>;

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
