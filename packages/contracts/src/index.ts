import { z } from "zod/v3";
import { decimal, uuidSchema } from "./primitives.js";
export * from "./primitives.js";
import {
  advanceCycleSchema,
  createStrategicPoolCaseSchema,
  createSubscriptionPlanSchema,
  createTenantInvoiceSchema,
  feishuSyncSchema,
  generateClawbackRecoverySchema,
  goldSetImportSchema,
  modelSummarySchema,
  passwordLoginSchema,
  preReviewSchema,
  processRetentionDisposalsSchema,
  publicSignupSchema,
  runsFromIngestionSchema,
  setPasswordSchema,
  setTenantInvoiceStatusSchema,
  setTenantSubscriptionSchema,
  strategicPoolCostReviewSchema,
  strategicPoolFinanceApproveSchema,
} from "./billing.js";

// ----------------------------------------------------------------------
// NP-011（2026-11-21 审计 Wave 3）：制度金额计算器严格 Zod——
// 负值/越界/重复人员在协议层 400，不进入算法层才失败。
// decimalExt 允许附加元数据字段（period 等），核心金额字段严格校验。
// ----------------------------------------------------------------------
const nonNegativeDecimal = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "expected a non-negative decimal string");
const percentDecimal = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,6})?$/, "expected a percent in [0,100]")
  .refine((value) => Number(value) <= 100, "percent must be <= 100");

export const dbcpCalculationSchema = z
  .object({
    grossProfit: decimal,
    managementProvisionBase: nonNegativeDecimal.optional(),
    managementProvisionRatePercent: percentDecimal.optional(),
    // 与 DbcpStatementInput 一致：费用列为必填（缺省视为 0 由调用方显式传 "0"）。
    businessExpenses: nonNegativeDecimal,
    laborAndTravel: nonNegativeDecimal,
    allocatedBusinessUnitExpenses: nonNegativeDecimal,
    allocatedBackendPayroll: nonNegativeDecimal,
  })
  .passthrough();
export type DbcpCalculationBody = z.infer<typeof dbcpCalculationSchema>;

export const businessUnitCommissionCalculationSchema = z
  .object({
    dbcp: decimal,
    netCollection: nonNegativeDecimal,
    bands: z
      .array(
        z.object({
          minMarginPercent: nonNegativeDecimal,
          ratePercent: percentDecimal,
        }),
      )
      .optional(),
  })
  .passthrough();
export type BusinessUnitCommissionCalculationBody = z.infer<
  typeof businessUnitCommissionCalculationSchema
>;

export const internalSplitCalculationSchema = z
  .object({
    commissionPool: nonNegativeDecimal,
    marketingReward: nonNegativeDecimal,
    executiveSupplement: nonNegativeDecimal,
    participants: z
      .array(
        z.object({
          personId: uuidSchema,
          sharePercent: nonNegativeDecimal,
        }),
      )
      .min(1),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const participant of value.participants) {
      if (seen.has(participant.personId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `重复参与人 ${participant.personId}`,
          path: ["participants"],
        });
      }
      seen.add(participant.personId);
    }
  });
export type InternalSplitCalculationBody = z.infer<
  typeof internalSplitCalculationSchema
>;

export const techCenterPoolCalculationSchema = z
  .object({
    totalBusinessCommission: nonNegativeDecimal,
    headPersonId: uuidSchema,
    headReview: z
      .object({
        roadmapAchievementPercent: nonNegativeDecimal,
        crossFunctionalSatisfaction: nonNegativeDecimal,
        techDebtControlled: z.boolean(),
        retentionMet: z.boolean(),
      })
      .optional(),
    members: z
      .array(
        z.object({
          personId: uuidSchema,
          positionCoefficient: nonNegativeDecimal,
          projectContribution: nonNegativeDecimal,
          performanceCoefficient: nonNegativeDecimal,
        }),
      )
      .min(1),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const member of value.members) {
      if (seen.has(member.personId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `重复成员 ${member.personId}`,
          path: ["members"],
        });
      }
      seen.add(member.personId);
    }
  });
export type TechCenterPoolCalculationBody = z.infer<
  typeof techCenterPoolCalculationSchema
>;

export const createWorkPackageSchema = z.object({
  title: z.string().min(2).max(200),
  objective: z.string().min(3),
  /** Defaults to ORDER_DELIVERY in the store when omitted. */
  packageType: z.string().min(1).max(60).optional(),
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

export const createAuditRedactionSchema = z
  .object({
    reason: z.string().min(5),
    replacement: z.string().min(1).default("[REDACTED]"),
    requestedBy: uuidSchema,
    approvedBy: uuidSchema,
  })
  .superRefine((value, context) => {
    if (value.requestedBy === value.approvedBy) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvedBy"],
        message: "redaction requires two different people",
      });
    }
  });
export type CreateAuditRedactionBody = z.infer<
  typeof createAuditRedactionSchema
>;

export const createModelRedTeamRunSchema = z
  .object({
    modelProvider: z.string().min(1),
    modelName: z.string().min(1),
    promptVersion: z.string().min(1),
    scope: z.string().min(3),
    testsRun: z.number().int().positive(),
    passed: z.boolean(),
    findings: z.array(z.string().min(1)).default([]),
    artifactRef: z.string().min(1).optional(),
    createdBy: uuidSchema,
  })
  .superRefine((value, context) => {
    if (!value.passed && value.findings.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["findings"],
        message: "a failed red-team run must list its findings",
      });
    }
  });
export type CreateModelRedTeamRunBody = z.infer<
  typeof createModelRedTeamRunSchema
>;

export const refreshModelEvaluationDatasetSchema = z.object({
  version: z.number().int().positive().optional(),
  name: z.string().min(1).optional(),
  sampleSize: z.number().int().positive().optional(),
  holdoutSize: z.number().int().positive().optional(),
  refreshedAt: z.string().datetime().optional(),
  nextRefreshDueAt: z.string().datetime().optional(),
  contentHash: z.string().min(1).optional(),
  ownerPersonId: uuidSchema.optional(),
});
export type RefreshModelEvaluationDatasetBody = z.infer<
  typeof refreshModelEvaluationDatasetSchema
>;

export const createModelCanaryRunSchema = z.object({
  baselineEvaluationRunId: uuidSchema,
  candidateEvaluationRunId: uuidSchema,
  datasetRef: z.string().min(1),
  trafficPercent: z.number().min(1).max(100),
});
export type CreateModelCanaryRunBody = z.infer<
  typeof createModelCanaryRunSchema
>;

export const createModelEvaluationDatasetSchema = z
  .object({
    code: z.string().min(1),
    version: z.number().int().positive().default(1),
    name: z.string().min(1),
    sampleSize: z.number().int().positive(),
    holdoutSize: z.number().int().min(1),
    labelSource: z.string().min(1),
    ownerPersonId: uuidSchema,
    refreshedAt: z.string().datetime().optional(),
    nextRefreshDueAt: z.string().datetime().optional(),
    contentHash: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.holdoutSize >= value.sampleSize) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["holdoutSize"],
        message: "holdoutSize must be smaller than sampleSize",
      });
    }
  });
export type CreateModelEvaluationDatasetBody = z.infer<
  typeof createModelEvaluationDatasetSchema
>;

export const createModelProviderPolicySchema = z.object({
  provider: z.string().min(1),
  zeroRetentionConfirmed: z.boolean(),
  dpaRef: z.string().min(1),
  inferenceRegion: z.string().min(1),
  egressAllowlist: z.array(z.string().min(1)).min(1),
  approvedBy: uuidSchema,
});
export type CreateModelProviderPolicyBody = z.infer<
  typeof createModelProviderPolicySchema
>;

export const createDiscretionaryPoolReviewSchema = z
  .object({
    committeePersonIds: z.array(uuidSchema).min(2),
    employeeObserverPersonId: uuidSchema.optional(),
    selectionCriteria: z.string().min(3),
    decisionNotes: z.string().min(3),
    reviewedBy: uuidSchema,
  })
  .superRefine((value, context) => {
    if (
      value.employeeObserverPersonId &&
      value.committeePersonIds.includes(value.employeeObserverPersonId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["employeeObserverPersonId"],
        message: "the employee observer must be independent of the committee",
      });
    }
  });
export type CreateDiscretionaryPoolReviewBody = z.infer<
  typeof createDiscretionaryPoolReviewSchema
>;

export const createClawbackCaseSchema = z.object({
  personId: uuidSchema,
  amount: decimal,
  currency: z.string().length(3),
  reasonCode: z.string().min(1),
  explanation: z.string().min(3),
  consentSignatureRef: z.string().min(1),
  installmentMonths: z.number().int().min(1).max(12).default(1),
  hardshipWaiver: z.boolean().default(false),
  hardshipReason: z.string().min(3).optional(),
  requestedBy: uuidSchema,
});
export type CreateClawbackCaseBody = z.infer<
  typeof createClawbackCaseSchema
>;

export const approveClawbackCaseSchema = z.object({
  approvedBy: uuidSchema,
});
export type ApproveClawbackCaseBody = z.infer<
  typeof approveClawbackCaseSchema
>;

export const closeClawbackCaseSchema = z.object({
  reason: z.string().min(3),
  actorPersonId: uuidSchema,
});
export type CloseClawbackCaseBody = z.infer<
  typeof closeClawbackCaseSchema
>;

export const createBreakGlassGrantSchema = z.object({
  scope: z.enum(["PAYROLL_BANK_ACCOUNT"]),
  granteePersonId: uuidSchema,
  reason: z.string().min(5),
  grantedBy: uuidSchema,
  expiresAt: z.string().datetime(),
});
export type CreateBreakGlassGrantBody = z.infer<
  typeof createBreakGlassGrantSchema
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

export const createESignEnvelopeSchema = z.object({
  contractId: uuidSchema,
  provider: z.string().min(1),
  envelopeRef: z.string().min(1),
  documentHash: z.string().min(1),
  signerPersonId: uuidSchema,
});
export type CreateESignEnvelopeBody = z.infer<
  typeof createESignEnvelopeSchema
>;

export const esignCallbackSchema = z.object({
  envelopeRef: z.string().min(1),
  status: z.enum(["SIGNED", "DECLINED", "VOID"]),
  signatureRef: z.string().min(1).optional(),
  reason: z.string().min(3).optional(),
});
export type ESignCallbackBody = z.infer<typeof esignCallbackSchema>;

export const createCompensationTemplateSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    roleCode: z.string().min(1),
    employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACTOR"]),
    currency: z.string().length(3),
    fixedSalaryMin: decimal,
    fixedSalaryMax: decimal,
    deductionCapRate: decimal.default("0.2"),
    variableShareCapRate: decimal.default("1"),
    smoothingThresholdRate: decimal.default("1"),
    deductionOrder: z
      .array(z.enum(["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"]))
      .default(["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"]),
    deductionTypeCaps: z.record(decimal).default({}),
  })
  .superRefine((value, context) => {
    if (Number(value.fixedSalaryMin) > Number(value.fixedSalaryMax)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fixedSalaryMax"],
        message: "fixedSalaryMax must be greater than or equal to min",
      });
    }
  });
export type CreateCompensationTemplateBody = z.infer<
  typeof createCompensationTemplateSchema
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

export const createRetentionDisposalRequestSchema = z.object({
  reason: z.string().min(5),
  requestedBy: uuidSchema,
  scheduledFor: z.string().datetime().optional(),
});

export const createFlatRetentionDisposalRequestSchema = z.object({
  retentionPolicyId: uuidSchema,
  reason: z.string().min(5),
  requestedBy: uuidSchema,
  scheduledFor: z.string().datetime().optional(),
});
export type CreateRetentionDisposalRequestBody = z.infer<
  typeof createRetentionDisposalRequestSchema
>;

export const approveRetentionDisposalRequestSchema = z.object({
  approvedBy: uuidSchema,
});
export type ApproveRetentionDisposalRequestBody = z.infer<
  typeof approveRetentionDisposalRequestSchema
>;

export const completeRetentionDisposalRequestSchema = z.object({
  actorPersonId: uuidSchema,
});
export type CompleteRetentionDisposalRequestBody = z.infer<
  typeof completeRetentionDisposalRequestSchema
>;

export const cancelRetentionDisposalRequestSchema = z.object({
  reason: z.string().min(3),
  actorPersonId: uuidSchema,
});
export type CancelRetentionDisposalRequestBody = z.infer<
  typeof cancelRetentionDisposalRequestSchema
>;

export const workforceSubgroupDimensionSchema = z.enum([
  "GENDER",
  "AGE_BAND",
  "REGION",
  "TENURE_BAND",
  "EMPLOYMENT_TYPE",
]);
export type WorkforceSubgroupDimensionValue = z.infer<
  typeof workforceSubgroupDimensionSchema
>;

export const recordWorkforceSubgroupAttributeSchema = z
  .object({
    personId: uuidSchema,
    dimension: workforceSubgroupDimensionSchema,
    value: z.string().trim().min(1).max(40),
    consentRef: z.string().trim().min(3),
    consentedAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    recordedBy: uuidSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.expiresAt &&
      Date.parse(value.expiresAt) <= Date.parse(value.consentedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "expiresAt must be after consentedAt",
      });
    }
  });
export type RecordWorkforceSubgroupAttributeBody = z.infer<
  typeof recordWorkforceSubgroupAttributeSchema
>;

export const withdrawWorkforceSubgroupAttributeSchema = z.object({
  personId: uuidSchema,
  dimension: workforceSubgroupDimensionSchema,
  actorPersonId: uuidSchema,
  reason: z.string().trim().min(3),
});
export type WithdrawWorkforceSubgroupAttributeBody = z.infer<
  typeof withdrawWorkforceSubgroupAttributeSchema
>;

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
    for (const field of value.fields) {
      if (
        (field.classification === "PERSONAL" ||
          field.classification === "SENSITIVE") &&
        !field.retentionMonths
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fields"],
          message: `personal field ${field.fieldName} requires retentionMonths`,
        });
      }
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

export const financialInstrumentTypeSchema = z.enum([
  "INVOICE",
  "CREDIT_NOTE",
  "PAYMENT",
  "COST",
  "REFUND",
]);
export type FinancialInstrumentTypeBody = z.infer<
  typeof financialInstrumentTypeSchema
>;

export const financialRecognitionStatusSchema = z.enum(["DRAFT", "POSTED"]);
export type FinancialRecognitionStatusBody = z.infer<
  typeof financialRecognitionStatusSchema
>;

export const fxSnapshotSchema = z.object({
  rate: decimal,
  quoteCurrency: z.string().length(3),
  source: z.string().min(1),
  asOf: z.string().datetime(),
});
export type FxSnapshotBody = z.infer<typeof fxSnapshotSchema>;

// ----------------------------------------------------------------------
// 财务子账（迁移 111）：业务文档身份 + 原币/功能币双金额。
// 金额与汇率统一 6 位小数定点，币种严格 ISO 4217（三位大写字母）。
// ----------------------------------------------------------------------
export const financialDocumentTypeSchema = z.enum([
  "INVOICE",
  "PAYMENT",
  "REFUND",
  "FX_REVALUATION",
  "REVERSAL",
  "CREDIT_NOTE",
  "BAD_DEBT_PROVISION",
  "BAD_DEBT_WRITE_OFF",
]);
export type FinancialDocumentTypeBody = z.infer<
  typeof financialDocumentTypeSchema
>;

/** 账龄桶（迁移 112）：与 @anari/domain 的 FinancialAgingBucket 对齐。 */
export const financialAgingBucketSchema = z.enum([
  "CURRENT",
  "1-30",
  "31-60",
  "61-90",
  "90+",
]);
export type FinancialAgingBucketBody = z.infer<
  typeof financialAgingBucketSchema
>;

const isoCurrency = z
  .string()
  .regex(/^[A-Z]{3}$/, "expected an ISO 4217 currency code (three uppercase letters)");

const subledgerDecimal = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "expected a non-negative decimal with <= 6 fraction digits");

const positiveSubledgerDecimal = subledgerDecimal.refine(
  (value) => Number(value) > 0,
  "amount must be greater than zero",
);

const positiveFxRate = subledgerDecimal.refine(
  (value) => Number(value) > 0,
  "fxRate must be greater than zero",
);

const accountingPeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM");

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)");

/**
 * 百分比（0-100，最多 6 位小数）。用于 taxRate 与坏账计提矩阵；
 * 服务端用 1e6 定点计算，浮点数只做入参表达。
 */
const percentSchema = z
  .number()
  .finite()
  .min(0, "percent must be between 0 and 100")
  .max(100, "percent must be between 0 and 100")
  .refine(
    (value) =>
      Math.abs(value * 1_000_000 - Math.round(value * 1_000_000)) < 1e-6,
    "percent supports at most 6 decimal places",
  );

/**
 * 迁移 115：多税种发票的单一税种（code + rate）。
 *
 * - code 1-32 字符（首尾空白由服务端 trim，全空白视为空）；
 * - rate 与旧 taxRate 同一口径（0-100，≤6 位小数）；
 * - 数组本身由 createFinancialInvoiceSchema 限定 1-5 条并做唯一性校验
 *   （与 @anari/domain 的 FinancialTaxBreakdownLine / 迁移 115 约定对齐；
 *   contracts 不依赖 domain，故在此重复字面量）。
 */
export const invoiceTaxesItemSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "tax code must not be empty")
    .max(32, "tax code supports at most 32 characters"),
  rate: percentSchema,
});
export type InvoiceTaxesItem = z.infer<typeof invoiceTaxesItemSchema>;

/**
 * 2026-11-21 审计 Sprint 5：Financial Fact 不再是“金额 + payload”。
 *
 * 兼容策略：DRAFT（未确认）事实可以只带金额/币种；POSTED（已入账）事实
 * 必须带 Legal Entity、会计期间、Instrument、来源版本，并由数据库 CHECK
 * 二次兜底。收入确认状态与现金收款状态分离（instrumentType=PAYMENT 才表示
 * 现金事实；INVOICE/CREDIT_NOTE 不等于收入确认）。
 */
export const createFinancialFactSchema = z
  .object({
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
    /** 会计语义（POSTED 时必填）。 */
    legalEntityId: z.string().min(1).optional(),
    orderId: z.string().min(1).optional(),
    contractRef: z.string().min(1).optional(),
    instrumentType: financialInstrumentTypeSchema.optional(),
    recognitionStatus: financialRecognitionStatusSchema.default("DRAFT"),
    accountingPeriod: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM")
      .optional(),
    fxSnapshot: fxSnapshotSchema.optional(),
    sourceVersion: z.string().min(1).max(256).optional(),
    reversalOf: z.string().min(1).optional(),
    reopeningRef: z.string().min(1).optional(),
    /** 财务子账语义（迁移 111，全部可选，兼容既有调用方）。 */
    documentType: financialDocumentTypeSchema.optional(),
    documentId: z.string().min(1).max(128).optional(),
    relatedFactId: z.string().min(1).max(128).optional(),
    fxRate: positiveFxRate.optional(),
    functionalCurrency: isoCurrency.optional(),
    functionalAmount: subledgerDecimal.optional(),
    /** 迁移 112：税额（可选）。taxAmount 由服务端按 taxRate 重算校验。 */
    taxRate: percentSchema.optional(),
    taxAmount: subledgerDecimal.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.recognitionStatus !== "POSTED") return;
    for (const field of [
      "legalEntityId",
      "accountingPeriod",
      "instrumentType",
      "sourceVersion",
    ] as const) {
      if (!value[field]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when recognitionStatus=POSTED`,
        });
      }
    }
    // 所有 POSTED 事实都必须能追溯到订单或合同；否则无法对账到业务贡献。
    if (!value.orderId && !value.contractRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orderId"],
        message:
          "POSTED facts require orderId or contractRef for business traceability",
      });
    }
    // 跨币种入账必须带汇率与功能币金额，服务端仍会重算并拒绝不一致。
    if (
      value.functionalCurrency &&
      value.currency !== value.functionalCurrency
    ) {
      if (!value.fxRate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fxRate"],
          message:
            "fxRate is required when currency differs from functionalCurrency",
        });
      }
      if (!value.functionalAmount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["functionalAmount"],
          message:
            "functionalAmount is required when currency differs from functionalCurrency",
        });
      }
    }
  });
export type CreateFinancialFactBody = z.infer<
  typeof createFinancialFactSchema
>;

/**
 * POST /api/v1/financial-invoices：开具一张 INVOICE 子账事实。
 *
 * - 必须能追溯到订单或合同；
 * - 币种严格 ISO 4217，金额/汇率最多 6 位小数且必须为正；
 * - 跨币种（currency != functionalCurrency）必须带 fxRate，服务端用
 *   1e6 BigInt 计算 functionalAmount 并拒绝不一致；
 * - 迁移 112：taxRate（百分比 0-100）可选，taxAmount 由服务端按
 *   amount × taxRate / 100 计算；客户端传入不一致的 taxAmount 会被 409 拒绝，
 *   发票 total = amount + taxAmount。
 * - 迁移 115：多税种发票用 taxes[{code,rate}]（1-5 条，code 1-32 字符、
 *   同一发票内唯一），与 taxRate 互斥（同时传 → 400）。服务端逐税种用
 *   1e6 定点计算 taxAmount 并汇总，明细写 payload.taxBreakdown；
 *   发票 total = amount + Σ taxAmount。
 */
export const createFinancialInvoiceSchema = z
  .object({
    documentId: z.string().min(1).max(128).optional(),
    legalEntityId: z.string().min(1),
    accountingPeriod: accountingPeriodSchema,
    orderId: z.string().min(1).optional(),
    contractRef: z.string().min(1).optional(),
    currency: isoCurrency,
    amount: positiveSubledgerDecimal,
    fxRate: positiveFxRate.optional(),
    functionalCurrency: isoCurrency,
    functionalAmount: subledgerDecimal.optional(),
    taxRate: percentSchema.optional(),
    taxes: z
      .array(invoiceTaxesItemSchema)
      .min(1, "taxes must contain between 1 and 5 items")
      .max(5, "taxes must contain between 1 and 5 items")
      .optional(),
    taxAmount: subledgerDecimal.optional(),
    sourceVersion: z.string().min(1).max(256).default("1"),
    issuedAt: z.string().datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.taxes !== undefined && value.taxRate !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["taxes"],
        message:
          "MUTUALLY_EXCLUSIVE_TAX_INPUT: send either taxRate (single rate) or taxes[{code,rate}] (multi-tax), not both",
      });
    }
    if (value.taxes !== undefined) {
      const seen = new Set<string>();
      value.taxes.forEach((tax, index) => {
        const key = tax.code.toUpperCase();
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["taxes", index, "code"],
            message: `DUPLICATE_TAX_CODE: ${tax.code} appears more than once (merge it into a single rate)`,
          });
        }
        seen.add(key);
      });
    }
    if (!value.orderId && !value.contractRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orderId"],
        message: "orderId or contractRef is required for an invoice",
      });
    }
    if (value.currency !== value.functionalCurrency && !value.fxRate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fxRate"],
        message:
          "fxRate is required when currency differs from functionalCurrency",
      });
    }
    if (
      value.currency === value.functionalCurrency &&
      value.fxRate !== undefined &&
      Number(value.fxRate) !== 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fxRate"],
        message:
          "fxRate must be 1 when currency equals functionalCurrency",
      });
    }
  });
export type CreateFinancialInvoiceBody = z.infer<
  typeof createFinancialInvoiceSchema
>;

/**
 * POST /api/v1/financial-payments：登记收款（PAYMENT）或退款（REFUND）。
 * 请求金额始终为正数；REFUND 由服务端写入负金额。关联发票必填。
 */
export const createFinancialPaymentSchema = z.object({
  relatedFactId: uuidSchema,
  documentType: z.enum(["PAYMENT", "REFUND"]).default("PAYMENT"),
  documentId: z.string().min(1).max(128).optional(),
  legalEntityId: z.string().min(1).optional(),
  accountingPeriod: accountingPeriodSchema.optional(),
  currency: isoCurrency.optional(),
  amount: positiveSubledgerDecimal,
  fxRate: positiveFxRate.optional(),
  functionalCurrency: isoCurrency.optional(),
  functionalAmount: subledgerDecimal.optional(),
  paidAt: z.string().datetime().optional(),
  sourceVersion: z.string().min(1).max(256).default("1"),
});
export type CreateFinancialPaymentBody = z.infer<
  typeof createFinancialPaymentSchema
>;

/**
 * POST /api/v1/financial-facts/:id/reverse：冲销原事实（金额取反）。
 * 期间默认沿用原事实，可通过 body 显式指定入账期间。
 */
export const reverseFinancialFactSchema = z.object({
  legalEntityId: z.string().min(1).optional(),
  accountingPeriod: accountingPeriodSchema.optional(),
  reason: z.string().min(1).max(512).optional(),
  sourceVersion: z.string().min(1).max(256).default("1"),
});
export type ReverseFinancialFactBody = z.infer<
  typeof reverseFinancialFactSchema
>;

/**
 * POST /api/v1/financial-revaluations：按新汇率重估原事实。
 * 金额 = 原币金额 × (新汇率 - 原汇率)，由服务端 1e6 BigInt 计算。
 */
export const createFinancialRevaluationSchema = z.object({
  factId: uuidSchema,
  fxRate: positiveFxRate,
  functionalCurrency: isoCurrency,
  reason: z.string().min(1).max(512).optional(),
});
export type CreateFinancialRevaluationBody = z.infer<
  typeof createFinancialRevaluationSchema
>;

/** GET /api/v1/financial-subledger：按订单或合同回读整条子账链。 */
export const financialSubledgerQuerySchema = z
  .object({
    orderId: z.string().min(1).optional(),
    contractRef: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.orderId && !value.contractRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orderId"],
        message: "orderId or contractRef is required",
      });
    }
  });
export type FinancialSubledgerQueryBody = z.infer<
  typeof financialSubledgerQuerySchema
>;

/** GET /api/v1/financial-subledger/aging：按法人 + 截止日计算账龄。 */
export const financialAgingQuerySchema = z.object({
  legalEntityId: z.string().min(1),
  asOf: isoDateSchema.optional(),
});
export type FinancialAgingQueryBody = z.infer<
  typeof financialAgingQuerySchema
>;

/**
 * POST /api/v1/financial-bad-debt/provision：按账龄矩阵计提坏账准备。
 * matrix 为 0-100 的百分比，可只覆盖部分桶；缺省桶使用默认矩阵。
 */
export const financialBadDebtProvisionSchema = z.object({
  legalEntityId: z.string().min(1),
  accountingPeriod: accountingPeriodSchema,
  asOf: isoDateSchema.optional(),
  currency: isoCurrency.optional(),
  matrix: z
    .record(financialAgingBucketSchema, percentSchema)
    .optional(),
  sourceVersion: z.string().min(1).max(256).default("1"),
});
export type FinancialBadDebtProvisionBody = z.infer<
  typeof financialBadDebtProvisionSchema
>;

/**
 * POST /api/v1/financial-bad-debt/write-off：核销一张发票的剩余 open amount。
 *
 * - amount 缺省 → 全额核销当前 open amount（沿用旧行为）；
 * - amount 指定 → 部分核销，必须 > 0（否则 400）且 <= 当前 open amount
 *   （超限 → 409 WRITE_OFF_EXCEEDS_OPEN）；
 * - 每次核销生成金额为 -amount 的 BAD_DEBT_WRITE_OFF 事实（冲减 AR，
 *   符号约定与 REFUND / REVERSAL 一致），多次核销累计不得超过 open。
 */
export const financialBadDebtWriteOffSchema = z.object({
  invoiceFactId: uuidSchema,
  legalEntityId: z.string().min(1).optional(),
  accountingPeriod: accountingPeriodSchema.optional(),
  amount: positiveSubledgerDecimal.optional(),
  reason: z.string().min(1).max(512).optional(),
  sourceVersion: z.string().min(1).max(256).default("1"),
});
export type FinancialBadDebtWriteOffBody = z.infer<
  typeof financialBadDebtWriteOffSchema
>;

/** GET /api/v1/financial-subledger/reconciliation：子账 vs ERP 对账。 */
export const financialReconciliationQuerySchema = z.object({
  period: accountingPeriodSchema,
  legalEntityId: z.string().min(1),
  sourceSystem: z.string().min(1).default("ERP"),
});
export type FinancialReconciliationQueryBody = z.infer<
  typeof financialReconciliationQuerySchema
>;

/** GET /api/v1/financial-journals：按文档/期间回读复式分录。 */
export const financialJournalQuerySchema = z.object({
  documentId: z.string().min(1).max(128).optional(),
  documentType: financialDocumentTypeSchema.optional(),
  legalEntityId: z.string().min(1).optional(),
  accountingPeriod: accountingPeriodSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
export type FinancialJournalQueryBody = z.infer<
  typeof financialJournalQuerySchema
>;

const glJournalLineInputSchema = z
  .object({
    accountCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/, "expected an uppercase account code"),
    debit: subledgerDecimal.optional(),
    credit: subledgerDecimal.optional(),
  })
  .superRefine((value, ctx) => {
    const debit = value.debit === undefined ? 0 : Number(value.debit);
    const credit = value.credit === undefined ? 0 : Number(value.credit);
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["debit"],
        message: "exactly one of debit/credit must be greater than zero",
      });
    }
  });

/**
 * POST /api/v1/financial-journals：登记一张手工复式凭证。
 * 借贷必须相等（1e6 定点），否则 409；CLOSED 期间同样拒绝。
 */
export const createGlJournalSchema = z.object({
  documentType: financialDocumentTypeSchema,
  documentId: z.string().min(1).max(128),
  legalEntityId: z.string().min(1),
  accountingPeriod: accountingPeriodSchema,
  currency: isoCurrency,
  description: z.string().min(1).max(512).optional(),
  sourceFactId: z.string().min(1).max(128).optional(),
  lines: z.array(glJournalLineInputSchema).min(2).max(100),
});
export type CreateGlJournalBody = z.infer<typeof createGlJournalSchema>;

const commercialCurrency = z.string().length(3);

export const createCommercialAccountSchema = z.object({
  externalAccountId: z.string().min(1).optional(),
  name: z.string().min(1),
  ownerPersonId: uuidSchema.optional(),
});
export type CreateCommercialAccountBody = z.infer<
  typeof createCommercialAccountSchema
>;

export const createCommercialOpportunitySchema = z.object({
  accountId: uuidSchema,
  externalOpportunityId: z.string().min(1).optional(),
  name: z.string().min(1),
  stage: z
    .enum(["PROSPECT", "QUALIFIED", "PROPOSAL", "WON", "LOST"])
    .optional(),
  estimatedAmount: decimal.optional(),
  currency: commercialCurrency,
  ownerPersonId: uuidSchema.optional(),
});
export type CreateCommercialOpportunityBody = z.infer<
  typeof createCommercialOpportunitySchema
>;

export const createCommercialQuoteSchema = z.object({
  opportunityId: uuidSchema,
  currency: commercialCurrency,
  amount: decimal,
  issuedAt: z.string().datetime().optional(),
  supersedesQuoteId: uuidSchema.optional(),
});
export type CreateCommercialQuoteBody = z.infer<
  typeof createCommercialQuoteSchema
>;

export const createCommercialContractSchema = z.object({
  accountId: uuidSchema,
  opportunityId: uuidSchema,
  quoteId: uuidSchema,
  contractRef: z.string().min(1),
  currency: commercialCurrency,
  amount: decimal,
});
export type CreateCommercialContractBody = z.infer<
  typeof createCommercialContractSchema
>;

export const createCommercialOrderLineSchema = z.object({
  kind: z.enum(["PRODUCT", "SERVICE", "DISCOUNT", "SURCHARGE"]),
  description: z.string().min(1),
  quantity: decimal,
  unitPrice: decimal,
  amount: decimal,
  currency: commercialCurrency,
});

export const createCommercialOrderSchema = z.object({
  accountId: uuidSchema,
  contractId: uuidSchema,
  orderNumber: z.string().min(1),
  currency: commercialCurrency,
  lines: z.array(createCommercialOrderLineSchema).min(1),
});
export type CreateCommercialOrderBody = z.infer<
  typeof createCommercialOrderSchema
>;

export const closeAccountingPeriodSchema = z.object({
  legalEntityId: z.string().min(1),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM"),
  actorPersonId: uuidSchema,
  reason: z.string().min(3).optional(),
});
export type CloseAccountingPeriodBody = z.infer<
  typeof closeAccountingPeriodSchema
>;

export const reopenAccountingPeriodSchema = z.object({
  legalEntityId: z.string().min(1),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM"),
  actorPersonId: uuidSchema,
  reopeningRef: z.string().min(1),
  reason: z.string().min(3),
});
export type ReopenAccountingPeriodBody = z.infer<
  typeof reopenAccountingPeriodSchema
>;

/**
 * 迁移 113：全量替换会计期间审批人目录。
 * 至少 1 人；服务端再校验每个人属于当前租户且 employmentStatus=ACTIVE。
 */
export const replaceAccountingPeriodApproversSchema = z.object({
  personIds: z.array(uuidSchema).min(1).max(50),
});
export type ReplaceAccountingPeriodApproversBody = z.infer<
  typeof replaceAccountingPeriodApproversSchema
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
  minSubgroupSize: z.number().int().positive().default(30),
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
  samples: z.array(modelEvaluationSampleSchema).default([]),
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

const assessmentDimensionStatusSchema = z.enum([
  "ASSESSED",
  "INSUFFICIENT_EVIDENCE",
  "NOT_OBSERVED",
  "NOT_APPLICABLE",
  "DISPUTED",
  "PENDING_REVIEW",
]);

export const createAiScoreProposalSchema = z.object({
  cycleId: uuidSchema,
  personId: uuidSchema,
  evaluationRunId: uuidSchema,
  modelPromptId: uuidSchema.optional(),
  dimensions: z.array(z.string().min(1)).min(1),
  evidence: z.array(scoringEvidenceSchema).min(1),
  riskTier: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  zeroScoreRationale: z.string().min(3).optional(),
  requestedBy: uuidSchema.optional(),
  /**
   * NPV2-005：维度评估状态。零分仅在该维度为 ASSESSED 且附理由时接受；
   * 缺证据/不适用/未观测/争议维度不得提交数字分。
   */
  dimensionStates: z.record(assessmentDimensionStatusSchema).optional(),
});

export const assessEvidenceCoverageSchema = z.object({
  subjectType: z.enum(["PERSON", "WORK_PACKAGE", "CONTRIBUTION_CLAIM"]),
  subjectId: uuidSchema,
  cycleId: uuidSchema,
  dimensions: z.array(z.string().min(1).max(128)).min(1).max(50)
    .refine((items) => new Set(items).size === items.length, "dimensions must be unique"),
  /** References only. Evidence content and quality are loaded from the tenant store. */
  evidenceRefs: z.array(z.string().min(1).max(256)).max(500).default([])
    .refine((items) => new Set(items).size === items.length, "evidenceRefs must be unique"),
  requirements: z
    .array(
      z.object({
        dimension: z.string().min(1),
        minValidEvidence: z.number().int().min(1).max(50).optional(),
      }),
    )
    .max(50)
    .optional(),
}).strict();
export type CreateAiScoreProposalBody = z.infer<
  typeof createAiScoreProposalSchema
>;

/**
 * NP-020：贡献认定草案生成请求——只接收 claim 与可选上下文；
 * 证据由服务端按 claim 解析，模型输出仅作定性综合（D-02）。
 */
export const generateContributionAssessmentSchema = z.object({
  context: z.string().max(4_000).optional(),
});
export type GenerateContributionAssessmentBody = z.infer<
  typeof generateContributionAssessmentSchema
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
  secondReviewerPersonId: uuidSchema.optional(),
  secondIndependentScores: z.record(z.number().min(0).max(5)).optional(),
  secondIndependentRationale: z.string().optional(),
  secondReviewStartedAt: z.string().datetime().optional(),
  secondEvidenceOpened: z.number().int().min(0).default(0),
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

/** INT-201 红线（Sprint 2.1）：凭据只走 credentialRef——连接/映射 config
 * 中出现敏感键（headers 认证、api key、token、密码等）一律拒绝存储。 */
const SENSITIVE_CONFIG_KEY = /authorization|api[-_]?key|secret|token|password|credential/i;

function rejectSensitiveConfig(
  config: Record<string, unknown>,
  ctx: z.RefinementCtx,
): void {
  for (const [key, value] of Object.entries(config)) {
    if (SENSITIVE_CONFIG_KEY.test(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `敏感键 "${key}" 禁止写入配置——凭据只走 credentialRef（SecretProvider）`,
        path: [key],
      });
      continue;
    }
    if (
      key === "headers" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      for (const headerKey of Object.keys(value as Record<string, unknown>)) {
        if (SENSITIVE_CONFIG_KEY.test(headerKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `headers 中的 "${headerKey}" 属于凭据——只走 credentialRef（SecretProvider）`,
            path: ["headers", headerKey],
          });
        }
      }
    }
  }
}

export const createIntegrationConnectionSchema = z
  .object({
    provider: z.string().min(1),
    connectionName: z.string().min(1),
    credentialRef: z.string().min(1),
    config: z.record(z.unknown()).default({}),
  })
  .superRefine((value, ctx) => rejectSensitiveConfig(value.config ?? {}, ctx));
export type CreateIntegrationConnectionBody = z.infer<
  typeof createIntegrationConnectionSchema
>;

export const setIntegrationConnectionStatusSchema = z.object({
  status: z.string().min(1),
});
export type SetIntegrationConnectionStatusBody = z.infer<
  typeof setIntegrationConnectionStatusSchema
>;

export const createIntegrationMappingSchema = z
  .object({
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
  })
  .superRefine((value, ctx) => rejectSensitiveConfig(value.config ?? {}, ctx));
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
  /** 兼容字段：created + updated（不含幂等重复/隔离/失败）。 */
  recordsUpserted: z.number().int().min(0).default(0),
  /** NP-016 / INT-211：精确计数——与逐条结果对账。 */
  recordsFetched: z.number().int().min(0).optional(),
  recordsRawPersisted: z.number().int().min(0).optional(),
  recordsCreated: z.number().int().min(0).optional(),
  recordsUpdated: z.number().int().min(0).optional(),
  recordsDuplicate: z.number().int().min(0).optional(),
  recordsInvalid: z.number().int().min(0).optional(),
  recordsQuarantined: z.number().int().min(0).optional(),
  recordsFailed: z.number().int().min(0).optional(),
  cursorAfter: z.record(z.unknown()).optional(),
  errorSummary: z.string().optional(),
});
export type FinishSyncRunBody = z.infer<typeof finishSyncRunSchema>;

/**
 * sync-run 级重放（Mapping Studio 失败面板）：只重放目标写入，不重置
 * checkpoint、不创建新 run。缺省范围 = 该 run 期间落地的原始记录；
 * 显式 rawRecordIds 用于精确重放（仍受租户与所属连接约束）。
 */
export const replaySyncRunSchema = z
  .object({
    rawRecordIds: z.array(uuidSchema).min(1).max(500).optional(),
  })
  .strict();
export type ReplaySyncRunBody = z.infer<typeof replaySyncRunSchema>;

/**
 * NP-001（2026-11-21 审计 Wave 1）：资源流、检查点与隔离区契约。
 */
export const createSyncResourceSchema = z.object({
  connectionId: uuidSchema,
  resourceKey: z.string().min(1),
  mappingId: uuidSchema.optional(),
  scheduleId: uuidSchema.optional(),
  /** INT-212：资源级最小调度间隔（分钟）；缺省沿用连接级排期。 */
  intervalMinutes: z.number().int().min(1).max(10080).optional(),
});
export type CreateSyncResourceBody = z.infer<typeof createSyncResourceSchema>;

export const upsertSyncCheckpointSchema = z.object({
  /**
   * 游标语义（INT-210）：字段缺省 = 保留旧值；显式 null = 清空；
   * 字符串 = 更新。服务端据此区分“未提供”与“明确清空”。
   */
  cursor: z.string().nullable().optional(),
  watermark: z.string().datetime().nullable().optional(),
  lastRunId: uuidSchema.nullable().optional(),
  /** INT-206：边界防丢重叠窗口（秒）；沿用 checkpoint 既有值。 */
  overlapSeconds: z.number().int().min(0).max(86400).optional(),
  /** INT-205：只有当前租约持有人可以推进游标（fencing）。 */
  leaseOwner: z.string().min(1),
  fencingToken: z.number().int().min(0),
});
export type UpsertSyncCheckpointBody = z.infer<
  typeof upsertSyncCheckpointSchema
>;

/** NP-008：外部对象身份注册/解析契约。 */
export const upsertExternalObjectSchema = z.object({
  sourceSystem: z.string().min(1),
  externalObjectType: z.string().min(1),
  externalObjectId: z.string().min(1),
  internalObjectType: z.string().min(1),
  internalObjectId: uuidSchema,
  matchRule: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  confirmedBy: uuidSchema.optional(),
});
export type UpsertExternalObjectBody = z.infer<
  typeof upsertExternalObjectSchema
>;

/** NP-027：身份生命周期契约。 */
export const externalObjectUnlinkSchema = z.object({
  sourceSystem: z.string().min(1),
  externalObjectType: z.string().min(1),
  externalObjectId: z.string().min(1),
  reason: z.string().min(1),
  actorPersonId: uuidSchema,
});
export type ExternalObjectUnlinkBody = z.infer<typeof externalObjectUnlinkSchema>;

export const externalObjectMergeSchema = z.object({
  sourceSystem: z.string().min(1),
  externalObjectType: z.string().min(1),
  keepExternalObjectId: z.string().min(1),
  mergeExternalObjectIds: z.array(z.string().min(1)).min(1),
  actorPersonId: uuidSchema,
});
export type ExternalObjectMergeBody = z.infer<typeof externalObjectMergeSchema>;

/**
 * NP-020 / INT-202：原始落地契约（版本化、append-only）。
 *
 * - `sourceVersion` 与 `payloadHash` 必须贯穿 runner → API → adapter：
 *   同一来源记录的不同版本独立成行，同版本重复写入幂等返回既有行。
 * - `fetchedAt` 由服务端生成（不信任客户端时钟）；`sourceUpdatedAt` 是
 *   来源系统的最后更新时间，与业务发生时间 `occurredAt` 严格区分。
 */
export const createRawSourceRecordSchema = z.object({
  sourceSystem: z.string().min(1),
  externalRecordId: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  /** 稳定内容哈希；缺省时由服务端对 payload 计算（sha256）。 */
  payloadHash: z.string().min(1).max(128).optional(),
  /** 来源版本；缺省时使用 payloadHash（内容即版本）。 */
  sourceVersion: z.string().min(1).max(256).optional(),
  mappingVersion: z.number().int().positive().optional(),
  retentionClass: z.enum(["DEFAULT", "PII", "FINANCIAL"]).optional(),
  /** 来源资源（同步流）；用于按资源追溯原始记录。 */
  resourceId: uuidSchema.optional(),
  /** 来源系统最后更新时间（与 occurredAt 不同）。 */
  sourceUpdatedAt: z.string().datetime().optional(),
});
export type CreateRawSourceRecordBody = z.infer<
  typeof createRawSourceRecordSchema
>;

export const replayRawSourceRecordSchema = z
  .object({
    eventType: z.string().min(1).optional(),
    subjectType: z.string().min(1).optional(),
    subjectId: uuidSchema.optional(),
    evidenceType: z.string().min(1).optional(),
    occurredAt: z.string().datetime().optional(),
    /** INT-209（Sprint 2.1 P1）：基于 Mapping 版本重放——服务端读映射自行应用 fieldMap。 */
    mappingId: uuidSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasMapping = value.mappingId !== undefined;
    const hasFields =
      value.eventType !== undefined &&
      value.subjectType !== undefined &&
      value.subjectId !== undefined &&
      value.evidenceType !== undefined;
    if (!hasMapping && !hasFields) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "必须提供 mappingId（基于映射重放）或完整解析字段",
      });
    }
    if (hasMapping && hasFields) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mappingId 与解析字段互斥——二选一",
      });
    }
  });
export type ReplayRawSourceRecordBody = z.infer<
  typeof replayRawSourceRecordSchema
>;

/** NP-021：资源级租约契约。 */
export const claimResourceLeaseSchema = z.object({
  leaseOwner: z.string().min(1),
  leaseSeconds: z.number().int().min(1).max(3600),
});
export type ClaimResourceLeaseBody = z.infer<typeof claimResourceLeaseSchema>;

export const releaseResourceLeaseSchema = z.object({
  leaseOwner: z.string().min(1),
  // 0 也是合法输入——必然 stale（token 从 1 起），由租约逻辑返回 409。
  fencingToken: z.number().int().min(0),
});
export type ReleaseResourceLeaseBody = z.infer<
  typeof releaseResourceLeaseSchema
>;

/** INT-205：长同步的心跳续约（owner + token 必须匹配，不递增 token）。 */
export const renewResourceLeaseSchema = z.object({
  leaseOwner: z.string().min(1),
  fencingToken: z.number().int().min(0),
  leaseSeconds: z.number().int().min(1).max(3600),
});
export type RenewResourceLeaseBody = z.infer<
  typeof renewResourceLeaseSchema
>;

export const quarantineReasons = [
  "UNRESOLVED_IDENTITY",
  "INVALID_CURRENCY",
  "MISSING_RELATION",
  "SCHEMA_MISMATCH",
  "OTHER",
] as const;
export const createQuarantineRecordSchema = z.object({
  sourceSystem: z.string().min(1),
  externalRecordId: z.string().min(1).optional(),
  reason: z.enum(quarantineReasons),
  payload: z.record(z.unknown()).default({}),
  resolutionNote: z.string().optional(),
});
export type CreateQuarantineRecordBody = z.infer<
  typeof createQuarantineRecordSchema
>;

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
  /** Employing legal entity; required for sameLegalEntity field predicates. */
  legalEntity: z.string().min(1).optional(),
  currency: z.string().length(3),
  fixedMonthlySalary: decimal,
  minimumMonthlyWage: decimal,
  taxRate: decimal.default("0"),
  socialInsuranceRate: decimal.default("0"),
  deductionCapRate: decimal.default("0.2"),
  variableShareCapRate: decimal.default("1"),
  deductionOrder: z
    .array(z.string().min(1))
    .default(["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"]),
  deductionTypeCaps: z.record(decimal).default({}),
  smoothingThresholdRate: decimal.default("1"),
  smoothingMode: z
    .enum(["NONE", "BLOCK", "MOVING_AVERAGE", "RAMP"])
    .default("BLOCK"),
  smoothingWindowPeriods: z.number().int().positive().max(24).default(3),
  smoothingMaxStepRate: decimal.default("0.5"),
  compensationTemplateCode: z.string().min(1).optional(),
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
  deductionOrder: z.array(z.string().min(1)).optional(),
  deductionTypeCaps: z.record(decimal).optional(),
  smoothingThresholdRate: decimal.optional(),
  smoothingMode: z.enum(["NONE", "BLOCK", "MOVING_AVERAGE", "RAMP"]).optional(),
  smoothingWindowPeriods: z.number().int().positive().max(24).optional(),
  smoothingMaxStepRate: decimal.optional(),
  compensationTemplateCode: z.string().min(1).optional(),
  bankAccountRef: z.string().min(1).optional(),
  effectiveFrom: z.string().datetime(),
  consentSignatureRef: z.string().min(1),
  approvedBy: uuidSchema,
});
export type AmendEmploymentContractBody = z.infer<
  typeof amendEmploymentContractSchema
>;

export const cancelContractAmendmentSchema = z.object({
  reason: z.string().min(3),
});
export type CancelContractAmendmentBody = z.infer<
  typeof cancelContractAmendmentSchema
>;

export const createPayrollRunSchema = z.object({
  cycleId: uuidSchema,
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  /** ISO 4217 code; defaults to CNY to keep existing callers unchanged. */
  currency: z.string().length(3).default("CNY"),
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
  /**
   * ISO 4217 code for this line. Optional for backward compatibility; when
   * omitted the store inherits the run currency. A provided value must match
   * the run currency (fail-closed 409 otherwise).
   */
  currency: z.string().length(3).optional(),
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
  deductionBreakdown: z
    .array(
      z.object({
        type: z.string().min(1),
        amount: decimal,
        priority: z.number().int().min(0),
      }),
    )
    .default([]),
  deductionTypeCapPassed: z.boolean().default(true),
  deductionTypeCapBreaches: z.array(z.string()).default([]),
  priorIncentiveAmount: decimal.default("0"),
  incentiveChangeRate: decimal.default("0"),
  smoothingThresholdRate: decimal.default("1"),
  smoothingPassed: z.boolean().default(true),
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

/**
 * NP-023（B 方案）：对账差异一键生成调整分录。
 * 在 adjustLedgerEntry 基础上指定目标 INCENTIVE 分录——分录必须属于该周期
 * 对账基准运行；金额由前端预填差额、允许人工修正（带审计）。
 */
export const postReconciliationAdjustmentSchema = adjustLedgerEntrySchema.extend({
  ledgerEntryId: uuidSchema,
});
export type PostReconciliationAdjustmentBody = z.infer<
  typeof postReconciliationAdjustmentSchema
>;

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

export const createAppealEvidenceDisclosureSchema = z.object({
  disclosedBy: uuidSchema,
  method: z.enum(["PORTAL", "EMAIL", "IN_PERSON", "OTHER"]),
  evidenceRefs: z.array(uuidSchema).min(1),
  note: z.string().trim().min(3).optional(),
});
export type CreateAppealEvidenceDisclosureBody = z.infer<
  typeof createAppealEvidenceDisclosureSchema
>;

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
  /** 发起人（NPV2-003：缺省时兼容既有演示请求人）。 */
  requestedBy: uuidSchema.optional(),
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
    "CYCLE_PRE_REVIEW",
  ]),
  triggerType: z.enum(["EVENT", "SCHEDULE", "MANUAL", "THRESHOLD"]),
  triggerRef: z.string().optional(),
  input: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().min(1),
  riskTier: z.enum(["T0", "T1", "T2", "T3"]).optional(),
  actorRole: z.enum(["READER", "ACTOR"]).optional(),
});
export type EnqueueAgentTaskBody = z.input<typeof enqueueAgentTaskSchema>;

/** 对话式入口：LLM 只做意图选择 + 人话回复，执行仍走 agent-command。 */
export const agentChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20),
});
export type AgentChatBody = z.infer<typeof agentChatSchema>;

/** 智能指令台（无 LLM）：命令 → 现有 skill 任务；执行一律走 T0-T3 状态机。 */
export const agentCommandSchema = z.object({
  command: z.enum([
    "scan_evidence_gaps",
    "scan_contribution_anomalies",
    "scan_data_quality",
    "check_settlement_readiness",
    "run_cycle_pre_review",
    "check_appeal_sla",
    "propose_policy_change",
    "draft_evaluations",
  ]),
  params: z.record(z.unknown()).default({}),
});
export type AgentCommandBody = z.infer<typeof agentCommandSchema>;

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
      "TIERED",
      "TEAM_POOL",
      "CASH_WEIGHTED_POOL",
      "CASH_WEIGHTED_RETENTION_POOL",
      "CASH_WEIGHTED_RESERVE_CHANNEL_POOL",
    ])
    .optional(),
  tiers: z
    .array(
      z.object({
        upTo: decimal.nullable(),
        ratePercent: decimal,
      }),
    )
    .optional(),
  roleWeights: z.record(decimal).optional(),
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

/**
 * 迁移 117：奖励批次支付回执。
 *
 * - (lineId, paymentRef) 是幂等键：同一银行流水重复回传只落一条；
 * - amount / currency 必须与批次行一致（服务端再校验，不一致 → 409）；
 * - 只有 PAID 计入已付并生成 GL 凭证，FAILED/RETURNED 只留痕；
 * - creditAccount 决定贷方科目（CASH=已付款，PAYABLE=挂应付），缺省 CASH。
 */
const awardPaymentAmountSchema = z
  .string()
  .regex(
    /^\d{1,14}(\.\d{1,6})?$/,
    "expected a positive decimal with <= 14 integer digits",
  )
  .refine((value) => Number(value) > 0, "must be greater than 0");

export const incentiveAwardPaymentSchema = z.object({
  lineId: uuidSchema,
  paymentRef: z.string().min(1).max(200),
  status: z.enum(["PAID", "FAILED", "RETURNED"]),
  amount: awardPaymentAmountSchema,
  currency: z
    .string()
    .length(3)
    .regex(/^[A-Za-z]{3}$/, "expected an ISO 4217 code"),
  paidAt: z.string().datetime({ offset: true }).optional(),
  failureCode: z.string().min(1).max(100).optional(),
  legalEntityId: z.string().min(1).max(64).optional(),
  accountingPeriod: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM")
    .optional(),
  creditAccount: z.enum(["CASH", "PAYABLE"]).optional(),
});
export type IncentiveAwardPaymentBody = z.infer<
  typeof incentiveAwardPaymentSchema
>;

export const recordIncentiveAwardPaymentsSchema = z
  .object({
    payments: z.array(incentiveAwardPaymentSchema).min(1).max(500),
  })
  .strict();
export type RecordIncentiveAwardPaymentsBody = z.infer<
  typeof recordIncentiveAwardPaymentsSchema
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

/**
 * AUD-017 / D-04：租户模块 capability 开关。
 * P0 核心域永远启用；扩展域（薪酬含个税/股权/计费/战略池）默认关闭，
 * 由租户 settings.modules 显式开启，变更留审计。
 */
// 计费（BILLING）当前没有租户面路由，故不列入可开关模块键——
// 避免"开关存在但无任何门禁"的假能力（审计 F5/D-04）。
export const TENANT_MODULE_KEYS = [
  "PAYROLL",
  "EQUITY",
  "STRATEGIC_POOL",
] as const;
export type TenantModuleKey = (typeof TENANT_MODULE_KEYS)[number];
export const createAgentFeedbackLabelSchema = z.object({
  taskId: uuidSchema.optional(),
  findingRef: z.string().min(1).max(256).optional(),
  label: z.enum(["CONFIRMED_POSITIVE", "FALSE_POSITIVE", "ESCALATED"]),
  model: z.string().min(1).max(128).optional(),
  promptVersion: z.string().min(1).max(64).optional(),
  comment: z.string().min(1).max(2_000).optional(),
});
export type CreateAgentFeedbackLabelBody = z.infer<typeof createAgentFeedbackLabelSchema>;

export const createAgentAiOffBaselineSchema = z.object({
  windowStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  windowEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completionRate: z.string().regex(/^\d+(\.\d+)?$/),
  sampleSize: z.number().int().positive().max(1_000_000),
});
export type CreateAgentAiOffBaselineBody = z.infer<typeof createAgentAiOffBaselineSchema>;

export const updateTenantModulesSchema = z.object({
  modules: z.array(z.enum(TENANT_MODULE_KEYS)).max(TENANT_MODULE_KEYS.length),
});
export type UpdateTenantModulesBody = z.infer<typeof updateTenantModulesSchema>;

export const createNotificationSchema = z.object({
  recipientPersonId: uuidSchema.optional(),
  audience: z.enum(["PERSON", "MANAGER", "FINANCE", "ADMIN"]),
  title: z.string().min(1),
  body: z.string().min(1),
  sourceType: z.string().optional(),
  sourceId: uuidSchema.optional(),
  /** AUD-011：稳定幂等键——同租户同键只产生一条通知。 */
  idempotencyKey: z.string().min(1).max(256).optional(),
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

/**
 * Object form of a field policy. Conditions are intentionally limited: only
 * `allowRoles`/`allowSelf`/`onDeny` are accepted today; unknown keys such as
 * `match` are rejected until the predicate whitelist in ADR-009 ships.
 */
/**
 * Supported server-side predicates for object field policies. Unknown keys are
 * rejected so a typo cannot silently broaden access. Missing subject context
 * fails closed at evaluation time.
 */
export const fieldAccessMatchSchema = z
  .object({
    isSubjectManager: z.boolean().optional(),
    sameOrgNode: z.boolean().optional(),
    sameLegalEntity: z.boolean().optional(),
    legalHoldActive: z.boolean().optional(),
    subjectEmploymentActive: z.boolean().optional(),
    viewerEmploymentActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "match must contain at least one predicate",
  });
export type FieldAccessMatch = z.infer<typeof fieldAccessMatchSchema>;

export const fieldAccessPolicyObjectSchema = z
  .object({
    allowRoles: z.array(z.string().min(1)).min(1).optional(),
    allowSelf: z.boolean().optional(),
    onDeny: z.enum(["OMIT", "ZERO", "REDACT"]).optional(),
    match: fieldAccessMatchSchema.optional(),
  })
  .strict()
  .refine((value) => value.allowRoles !== undefined || value.allowSelf !== undefined, {
    message: "policy must set allowRoles or allowSelf",
  });

export const fieldAccessPolicySchema = z.union([
  z.array(z.string().min(1)).min(1),
  fieldAccessPolicyObjectSchema,
]);
export type FieldAccessPolicyObject = z.infer<
  typeof fieldAccessPolicyObjectSchema
>;
export type FieldAccessPolicy = z.infer<typeof fieldAccessPolicySchema>;

export const fieldAccessPoliciesSchema = z.record(
  z
    .string()
    .regex(
      /^(PAYROLL_LINE|CALCULATION_LINE|EMPLOYMENT_CONTRACT|EVIDENCE|SETTLEMENT_LINE|AI_PROPOSAL)\.[A-Za-z][A-Za-z0-9_]*$/,
      "policy key must be RESOURCE.field",
    ),
  fieldAccessPolicySchema,
);

export const updateFieldAccessPoliciesSchema = z.object({
  policies: fieldAccessPoliciesSchema,
});
export type UpdateFieldAccessPoliciesBody = z.infer<
  typeof updateFieldAccessPoliciesSchema
>;

export const updateTenantSettingsSchema = z
  .object({
    requiredApprovals: z.array(z.string().min(1)).optional(),
    /** Cross-resource field access matrix: `RESOURCE.field` -> allowed roles. */
    fieldAccessPolicies: fieldAccessPoliciesSchema.optional(),
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
  /** ATT-06：复核人必须先独立判断再看 AI 草稿；此处记录独立得分与理由。 */
  independentScores: z.record(z.number().min(0).max(5)),
  independentRationale: z.string().min(3),
  evidenceOpened: z.number().int().min(0).default(0),
  /**
   * D-03：每个维度的认定状态。任何维度打 0 分必须是 ASSESSED（有依据的
   * 人工认定），并附独立理由——零分不是"未评"的默认值。
   */
  dimensionStates: z
    .record(z.enum(["ASSESSED", "NOT_APPLICABLE", "INSUFFICIENT_EVIDENCE"]))
    .optional(),
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

export const marginalSimulationSchema = z.object({
  policyVersionId: z.string().min(1),
  sample: createCalculationRunSchema,
  participantIndex: z.number().int().min(0).default(0),
  field: z
    .enum(["attributionWeight", "evaluationMultiplier"])
    .default("attributionWeight"),
  from: decimal,
  to: decimal,
  step: decimal,
});
export type MarginalSimulationBody = z.input<typeof marginalSimulationSchema>;

export const ingestionEventSchema = z.object({
  sourceRecordId: z.string().min(1),
  sourceEventVersion: z.string().min(1).optional(),
  eventType: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  /** 来源系统最后更新时间（增量水位依据；与 occurredAt 分离）。 */
  sourceUpdatedAt: z.string().datetime().optional(),
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

type ZodContractNode = {
  _def?: { schema?: ZodContractNode };
  shape?: Record<string, { isOptional?: () => boolean }>;
};

export interface RequestSchemaContract {
  /** Fields the API requires; derived from Zod rather than hand-maintained. */
  required: string[];
  /** Fields accepted but optional (including schema defaults). */
  optional: string[];
}

/** Derive the request contract for one Zod object schema. */
export function describeRequestSchema(schema: unknown): RequestSchemaContract {
  let node = schema as ZodContractNode;
  while (node._def?.schema) node = node._def.schema;
  const shape = node.shape ?? {};
  const required: string[] = [];
  const optional: string[] = [];
  for (const [field, fieldSchema] of Object.entries(shape)) {
    if (fieldSchema?.isOptional?.() === false) required.push(field);
    else optional.push(field);
  }
  return { required: required.sort(), optional: optional.sort() };
}

/** Commercial 外部同步：source-aware upsert（Account / Opportunity）。 */
export const importCommercialAccountSchema = z.object({
  sourceSystem: z.string().min(1),
  externalAccountId: z.string().min(1),
  name: z.string().min(1),
  ownerPersonId: uuidSchema.optional(),
});
export type ImportCommercialAccountBody = z.infer<
  typeof importCommercialAccountSchema
>;

export const importCommercialOpportunitySchema = z.object({
  sourceSystem: z.string().min(1),
  externalAccountId: z.string().min(1),
  accountName: z.string().min(1),
  externalOpportunityId: z.string().min(1),
  name: z.string().min(1),
  stage: z
    .enum(["PROSPECT", "QUALIFIED", "PROPOSAL", "WON", "LOST"])
    .optional(),
  estimatedAmount: decimal.optional(),
  currency: z.string().length(3),
  ownerPersonId: uuidSchema.optional(),
});
export type ImportCommercialOpportunityBody = z.infer<
  typeof importCommercialOpportunitySchema
>;

/**
 * 114：Ticketing Canonical Work Item 导入契约。
 * 枚举与 @anari/domain 的 WORK_ITEM_* 对齐（contracts 不依赖 domain，
 * 故在此显式重复字面量；domain 的单测覆盖同一取值集合）。
 */
export const workItemStatusSchema = z.enum([
  "OPEN",
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
  "CANCELLED",
]);
export const workItemTypeSchema = z.enum([
  "STORY",
  "TASK",
  "BUG",
  "EPIC",
  "OTHER",
]);
export const workItemPrioritySchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
]);

export const workItemEventInputSchema = z.object({
  fromStatus: workItemStatusSchema.optional(),
  toStatus: workItemStatusSchema,
  occurredAt: z.string().datetime().optional(),
  actorPersonId: uuidSchema.optional(),
});

export const workItemContributionInputSchema = z.object({
  personId: uuidSchema,
  role: z.string().min(1).max(64),
  weight: decimal.optional(),
  ratio: decimal.optional(),
});

export const importWorkItemSchema = z
  .object({
    sourceSystem: z.string().min(1).max(64),
    externalId: z.string().min(1).max(256),
    projectId: z.string().min(1).max(256),
    title: z.string().min(1).max(512),
    type: workItemTypeSchema,
    priority: workItemPrioritySchema.optional(),
    status: workItemStatusSchema,
    assigneePersonId: uuidSchema.optional(),
    reporterPersonId: uuidSchema.optional(),
    startedAt: z.string().datetime().optional(),
    dueAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    weight: decimal.optional(),
    currency: z.string().length(3).optional(),
    amount: decimal.optional(),
    payload: z.record(z.unknown()).optional(),
    events: z.array(workItemEventInputSchema).max(500).optional(),
    contributions: z.array(workItemContributionInputSchema).max(200).optional(),
  })
  // 有金额必须能说明币种（与 114 迁移的 CHECK 约束一致）。
  .refine((body) => body.amount === undefined || body.currency !== undefined, {
    message: "currency is required when amount is present",
    path: ["currency"],
  });
export type ImportWorkItemBody = z.infer<typeof importWorkItemSchema>;

/**
 * 确定性 Agent 辅助（不调用外部 LLM）：字段映射建议 / 同步异常诊断 /
 * 对账差异解释。三个端点都只做纯函数计算——不写库、不调用模型。
 */
export const agentAssistTargetTypeSchema = z.enum([
  "COMMERCIAL_OPPORTUNITY",
  "WORK_ITEM",
  "FINANCIAL_FACT",
]);

export const mappingSuggestionsRequestSchema = z.object({
  targetType: agentAssistTargetTypeSchema,
  /** 单条样例记录；只读取顶层字段名与值类型，不递归。 */
  sample: z
    .record(z.unknown())
    .refine(
      (sample) => Object.keys(sample).length <= 200,
      "sample must contain at most 200 top-level fields",
    ),
});
export type MappingSuggestionsBody = z.infer<
  typeof mappingSuggestionsRequestSchema
>;

const agentAssistCountSchema = z
  .number()
  .int()
  .min(0)
  .max(1_000_000_000);

export const syncAnomalyRunSchema = z.object({
  status: z.string().min(1).max(64),
  fetched: agentAssistCountSchema,
  created: agentAssistCountSchema,
  updated: agentAssistCountSchema,
  duplicate: agentAssistCountSchema,
  quarantined: agentAssistCountSchema,
  failed: agentAssistCountSchema,
});
export type SyncAnomalyRunInput = z.infer<typeof syncAnomalyRunSchema>;

export const syncAnomaliesRequestSchema = z.object({
  runs: z.array(syncAnomalyRunSchema).max(500),
});
export type SyncAnomaliesBody = z.infer<typeof syncAnomaliesRequestSchema>;

/**
 * 对账金额一律用十进制定点字符串；超过 6 位有效小数在协议层拒绝
 * （与 @anari/policy-dsl 的 1e6 标度一致，避免静默截断）。
 */
export const agentAssistDecimalSchema = decimal.refine(
  (value) =>
    (value.split(".")[1] ?? "").replace(/0+$/, "").length <= 6,
  "expected at most 6 significant decimal places",
);

export const reconciliationExplainRowSchema = z
  .object({
    key: z.string().min(1).max(256),
    source: agentAssistDecimalSchema.nullable().optional(),
    target: agentAssistDecimalSchema.nullable().optional(),
    delta: agentAssistDecimalSchema,
  })
  .superRefine((row, ctx) => {
    if (row.source == null && row.target == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at least one of source/target must be present",
        path: ["source"],
      });
    }
  });
export type ReconciliationExplainRowInput = z.infer<
  typeof reconciliationExplainRowSchema
>;

export const reconciliationExplainRequestSchema = z.object({
  rows: z.array(reconciliationExplainRowSchema).max(1000),
});
export type ReconciliationExplainBody = z.infer<
  typeof reconciliationExplainRequestSchema
>;

/**
 * 118：通用 JEV Decision Record 请求契约。
 *
 * - 证据必须同时提交内容和 sha256 承诺，服务端重算后不一致即 409；
 * - 判断 actor 只有 HUMAN / AI_MODEL 两类，同一 actor 一人一判（不可改写）；
 * - 最终决定由授权人提交，服务端另行校验独立判断、校验通过、非自决。
 */
export const decisionCaseKindSchema = z.enum([
  "PERFORMANCE",
  "CONTRIBUTION",
  "APPEAL",
  "INCENTIVE_ELIGIBILITY",
  "BUDGET",
]);

export const decisionEvidenceSupportSchema = z.enum([
  "FOR",
  "AGAINST",
  "NEUTRAL",
]);

export const decisionJudgmentActorTypeSchema = z.enum(["HUMAN", "AI_MODEL"]);

export const decisionContentHashSchema = z
  .string()
  .trim()
  .regex(/^(sha256:)?[0-9a-fA-F]{64}$/, "expected a sha256 content hash");

export const createDecisionCaseSchema = z
  .object({
    kind: decisionCaseKindSchema,
    /** 被决策对象类型；不限定枚举，由各 kind 的模板解释。 */
    subjectType: z.string().min(1).max(64),
    /** 允许外部系统标识，因此不强制 uuid。 */
    subjectId: z.string().min(1).max(256),
    context: z.record(z.unknown()).default({}),
    createdBy: uuidSchema.optional(),
  })
  .strict();
export type CreateDecisionCaseBody = z.infer<typeof createDecisionCaseSchema>;

const decisionWeightSchema = z
  .union([
    decimal.refine((value) => Number(value) > 0, "weight must be positive"),
    z.number().positive(),
  ])
  .transform((value) => String(value));

export const appendDecisionEvidenceSchema = z
  .object({
    sourceType: z.string().min(1).max(64),
    sourceId: z.string().min(1).max(256),
    /** 证据原文：服务端只用于重算 hash，不落库。 */
    content: z
      .unknown()
      .refine((value) => value !== undefined, "content is required"),
    contentHash: decisionContentHashSchema,
    supports: decisionEvidenceSupportSchema,
    /** 允许 decimal string 或 number；落库统一为 decimal string。 */
    weight: decisionWeightSchema.optional(),
  })
  .strict();
export type AppendDecisionEvidenceBody = z.infer<
  typeof appendDecisionEvidenceSchema
>;

const decisionConfidenceSchema = z
  .union([
    z.number().min(0).max(1),
    z.string().regex(/^(0(\.\d+)?|1(\.0+)?)$/, "expected a confidence in [0,1]"),
  ])
  .transform((value) => (typeof value === "number" ? value : Number(value)));

export const submitDecisionJudgmentSchema = z
  .object({
    actorType: decisionJudgmentActorTypeSchema,
    /** HUMAN 时为人员 id；AI_MODEL 时为模型标识（允许非 uuid）。 */
    actorId: z.string().min(1).max(128),
    modelRef: z.string().min(1).max(256).optional(),
    independentScores: z.record(z.unknown()).default({}),
    independentRationale: z.string().min(1).max(20_000),
    dimensionStates: z.record(z.unknown()).default({}),
    confidence: decisionConfidenceSchema.optional(),
  })
  .strict();
export type SubmitDecisionJudgmentBody = z.infer<
  typeof submitDecisionJudgmentSchema
>;

/**
 * vLLM decision AI 建议请求（POST /decision-cases/:id/ai-suggestion）。
 *
 * - 只允许指定审查维度；模型/端点/超时来自服务端 env，客户端不能覆盖，
 *   避免调用方把证据发往任意地址或伪造模型标识；
 * - 省略 dimensions 时由路由按 case.kind 取默认维度；
 * - 维度必须唯一（重复维度会让“每维一个结论”的校验失去意义）。
 */
export const decisionAiSuggestionSchema = z
  .object({
    dimensions: z
      .array(z.string().trim().min(1).max(64))
      .min(1)
      .max(20)
      .optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const dimensions = body.dimensions;
    if (!dimensions) return;
    const seen = new Set<string>();
    dimensions.forEach((dimension, index) => {
      if (seen.has(dimension)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "dimensions must be unique",
          path: ["dimensions", index],
        });
      }
      seen.add(dimension);
    });
  });
export type DecisionAiSuggestionBody = z.infer<
  typeof decisionAiSuggestionSchema
>;

/**
 * 120：校验结果由服务端 5 个 checker 产出。passed / checks / findings 仅为
 * 向后兼容而接受，服务端一律忽略，绝不计入权威结果。`decidedBy` 只是可选的
 * 拟授权人，用于在 verify 阶段提前发现利益冲突；最终仍以 decide 时的真实
 * decidedBy 再校验一次。
 */
export const recordDecisionVerificationSchema = z
  .object({
    /** @deprecated ignored; server computes the authoritative result. */
    passed: z.boolean().optional(),
    /** @deprecated ignored; server computes the authoritative result. */
    checks: z.record(z.unknown()).optional(),
    /** @deprecated ignored; server computes the authoritative result. */
    findings: z.array(z.record(z.unknown())).max(200).optional(),
    verifiedBy: uuidSchema.optional(),
    decidedBy: uuidSchema.optional(),
  })
  .strict();
export type RecordDecisionVerificationBody = z.infer<
  typeof recordDecisionVerificationSchema
>;

export const decideDecisionCaseSchema = z
  .object({
    decidedBy: uuidSchema.optional(),
    rationale: z.string().min(1).max(20_000),
    finalJudgmentId: uuidSchema.optional(),
  })
  .strict();
export type DecideDecisionCaseBody = z.infer<
  typeof decideDecisionCaseSchema
>;

/** 120：业务对象引用 caseId（评价/贡献/申诉/资格/预算）。 */
export const decisionLinkResourceTypeSchema = z.enum([
  "PERFORMANCE_EVALUATION",
  "CONTRIBUTION_ASSESSMENT",
  "APPEAL",
  "INCENTIVE_ELIGIBILITY",
  "BUDGET",
]);

export const linkDecisionCaseSchema = z
  .object({
    resourceType: decisionLinkResourceTypeSchema,
    /** 业务对象 id；允许外部系统标识，因此不强制 uuid。 */
    resourceId: z.string().min(1).max(256),
    note: z.string().min(1).max(2000).optional(),
    /** 默认回落到会话身份；不能代他人建立引用。 */
    linkedBy: uuidSchema.optional(),
  })
  .strict();
export type LinkDecisionCaseBody = z.infer<typeof linkDecisionCaseSchema>;

/**
 * 绩效评分权威化契约：
 *
 * 分数只能由「已锁定目标卡（指标/权重/目标）+ 已核验计量快照（metricId/value）」
 * 推出，客户端不得自行提交测量值。`metricInputs` 仅用于补充说明性字段
 * （naReason / sampleSize / evidenceRefs）；一旦携带 rawValue / value /
 * applicable / acceptanceScore / eventAdjustment 等权威字段，路由返回
 * 409 PERFORMANCE_INPUT_OVERRIDES_FACTS。故此处对条目 passthrough，
 * 由路由层显式判定并给出稳定错误码，而不是在协议层静默剥离。
 */
export const performanceMetricInputSchema = z
  .object({
    metricId: z.string().min(1).max(64),
    /** 仅对快照中不可用的测量生效（解释 N/A 原因）。 */
    naReason: z.string().min(1).max(512).optional(),
    sampleSize: z.number().int().nonnegative().max(1_000_000).optional(),
    evidenceRefs: z.array(z.string().min(1).max(256)).max(50).optional(),
  })
  .passthrough();

export const scorePerformanceFromFactsSchema = z
  .object({
    cycleId: uuidSchema,
    personId: uuidSchema,
    policyVersionId: z.string().min(1).max(128),
    metricInputs: z.array(performanceMetricInputSchema).max(200).optional(),
  })
  .strict();
export type ScorePerformanceFromFactsBody = z.infer<
  typeof scorePerformanceFromFactsSchema
>;

export const requestSchemaRegistry = {
  MappingSuggestions: mappingSuggestionsRequestSchema,
  SyncAnomalies: syncAnomaliesRequestSchema,
  ReconciliationExplain: reconciliationExplainRequestSchema,
  AmendEmploymentContract: amendEmploymentContractSchema,
  ApprovePayrollRun: approvePayrollRunSchema,
  CreateAiScoreProposal: createAiScoreProposalSchema,
  AssessEvidenceCoverage: assessEvidenceCoverageSchema,
  CreateAppeal: createAppealSchema,
  CreateStrategicPoolCase: createStrategicPoolCaseSchema,
  CreateSubscriptionPlan: createSubscriptionPlanSchema,
  GenerateClawbackRecovery: generateClawbackRecoverySchema,
  StrategicPoolCostReview: strategicPoolCostReviewSchema,
  StrategicPoolFinanceApprove: strategicPoolFinanceApproveSchema,
  CreateTenantInvoice: createTenantInvoiceSchema,
  FeishuSync: feishuSyncSchema,
  PasswordLogin: passwordLoginSchema,
  AdvanceCycle: advanceCycleSchema,
  GoldSetImport: goldSetImportSchema,
  PreReview: preReviewSchema,
  RunsFromIngestion: runsFromIngestionSchema,
  SetPassword: setPasswordSchema,
  ModelSummary: modelSummarySchema,
  ProcessRetentionDisposals: processRetentionDisposalsSchema,
  PublicSignup: publicSignupSchema,
  SetTenantInvoiceStatus: setTenantInvoiceStatusSchema,
  SetTenantSubscription: setTenantSubscriptionSchema,
  CreateApprovalRequest: createApprovalRequestSchema,
  CreateClawbackCase: createClawbackCaseSchema,
  CreateContributionClaim: createContributionClaimSchema,
  CreateDataQualityIssue: createDataQualityIssueSchema,
  CreateDataSource: createDataSourceSchema,
  CreateDsar: createDsarSchema,
  CreateEmploymentContract: createEmploymentContractSchema,
  CreateEvidence: createEvidenceSchema,
  CreateFinancialFact: createFinancialFactSchema,
  CreateFinancialInvoice: createFinancialInvoiceSchema,
  CreateFinancialPayment: createFinancialPaymentSchema,
  CreateFinancialRevaluation: createFinancialRevaluationSchema,
  ReverseFinancialFact: reverseFinancialFactSchema,
  FinancialBadDebtProvision: financialBadDebtProvisionSchema,
  FinancialBadDebtWriteOff: financialBadDebtWriteOffSchema,
  CreateGlJournal: createGlJournalSchema,
  RecordIncentiveAwardPayments: recordIncentiveAwardPaymentsSchema,
  CreateCommercialAccount: createCommercialAccountSchema,
  CreateCommercialOpportunity: createCommercialOpportunitySchema,
  CreateCommercialQuote: createCommercialQuoteSchema,
  CreateCommercialContract: createCommercialContractSchema,
  CreateCommercialOrder: createCommercialOrderSchema,
  ImportCommercialAccount: importCommercialAccountSchema,
  ImportCommercialOpportunity: importCommercialOpportunitySchema,
  CloseAccountingPeriod: closeAccountingPeriodSchema,
  ReopenAccountingPeriod: reopenAccountingPeriodSchema,
  ReplaceAccountingPeriodApprovers: replaceAccountingPeriodApproversSchema,
  CreatePayrollRun: createPayrollRunSchema,
  CreateRetentionPolicy: createRetentionPolicySchema,
  CreateSettlementBatch: createSettlementBatchSchema,
  CreateWorkPackage: createWorkPackageSchema,
  PublishPolicy: publishPolicySchema,
  RecordConfirmation: recordConfirmationSchema,
  RecordLegalGate: recordLegalGateSchema,
  RecordWorkforceSubgroupAttribute: recordWorkforceSubgroupAttributeSchema,
  ResolveAppeal: resolveAppealSchema,
  UpdateFieldAccessPolicies: updateFieldAccessPoliciesSchema,
  ImportWorkItem: importWorkItemSchema,
  ReplaySyncRun: replaySyncRunSchema,
  CreateDecisionCase: createDecisionCaseSchema,
  AppendDecisionEvidence: appendDecisionEvidenceSchema,
  SubmitDecisionJudgment: submitDecisionJudgmentSchema,
  RecordDecisionVerification: recordDecisionVerificationSchema,
  DecideDecisionCase: decideDecisionCaseSchema,
  LinkDecisionCase: linkDecisionCaseSchema,
  ScorePerformanceFromFacts: scorePerformanceFromFactsSchema,
} as const;

/**
 * NPV2-015：贡献事件录入契约。
 * ACTIVITY 事件只承载活动量（observed facts），不得作为贡献认定依据。
 */
export const contributionEventOutcomeSchema = z.object({
  summary: z.string().min(1),
  metrics: z.record(z.union([z.number(), z.string()])).optional(),
});

export const createContributionEventSchema = z.object({
  actorPersonId: uuidSchema.optional(),
  subjectPersonId: uuidSchema,
  action: z.string().min(1),
  targetType: z.string().min(1),
  targetId: z.string().min(1),
  occurredAt: z.string().datetime(),
  source: z.string().min(1).max(64),
  externalId: z.string().min(1).max(256).optional(),
  kind: z.enum(["CONTRIBUTION", "ACTIVITY", "CONTEXT"]),
  outcome: contributionEventOutcomeSchema,
  evidenceRefs: z.array(z.string().min(1)).default([]),
  correctionOfEventId: uuidSchema.optional(),
});

export const createManualContributionEventSchema = z.object({
  subjectPersonId: uuidSchema,
  action: z.string().min(1).max(256),
  targetType: z.string().min(1).max(64),
  targetId: z.string().min(1).max(256),
  occurredAt: z.string().datetime(),
  kind: z.enum(["CONTRIBUTION", "ACTIVITY", "CONTEXT"]),
  outcome: contributionEventOutcomeSchema,
  evidenceRefs: z.array(z.string().min(1).max(256)).max(100).default([]),
  correctionOfEventId: uuidSchema.optional(),
}).strict();

export const contributionEventBatchSchema = z.object({
  events: z.array(createContributionEventSchema).min(1).max(200),
});

export const contributionEventFilterSchema = z.object({
  subjectPersonId: uuidSchema.optional(),
  kind: z.enum(["CONTRIBUTION", "ACTIVITY", "CONTEXT"]).optional(),
  source: z.string().min(1).max(64).optional(),
  occurredFrom: z.string().datetime().optional(),
  occurredTo: z.string().datetime().optional(),
});

/**
 * NPV2-016：贡献认定草案契约。
 * 每条断言必须携带 evidence refs；不确定性用定性 band，不用百分比；
 * basedOnEventIds 引用的事件不得含 ACTIVITY（存储层再校验事件类型）。
 */
export const assessmentAssertionSchema = z
  .object({
    statement: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    basis: z.enum(["EVENT", "CLAIM", "REVIEWER"]),
    relatedEventId: uuidSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.basis === "EVENT" && !value.relatedEventId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "EVENT 断言必须携带 relatedEventId",
      });
    }
  });

export const assessmentUncertaintySchema = z.object({
  band: z.enum(["LOW", "MEDIUM", "HIGH"]),
  reasons: z.array(z.string().min(1)).default([]),
});

export const createContributionAssessmentDraftSchema = z.object({
  claimId: uuidSchema,
  generatedByType: z.enum(["AGENT", "USER", "SYSTEM"]),
  generatedById: uuidSchema.optional(),
  modelProvider: z.string().max(64).optional(),
  modelName: z.string().max(128).optional(),
  promptVersion: z.string().max(64).optional(),
  supporting: z.array(assessmentAssertionSchema).default([]),
  counter: z.array(assessmentAssertionSchema).default([]),
  missingInformation: z.array(z.string().min(1)).default([]),
  alternativeExplanations: z.array(assessmentAssertionSchema).default([]),
  uncertainty: assessmentUncertaintySchema,
  basedOnEventIds: z.array(uuidSchema).default([]),
});

export const linkContributionAssessmentDecisionSchema = z.object({
  attributionDecisionId: uuidSchema,
  linkedBy: uuidSchema,
});

/**
 * NPV2-017：指标计量快照契约。
 * 冻结后不可变；contentHash 服务端计算；link-decision 要求决定已存在。
 */
export const metricMeasurementRecordSchema = z.object({
  metricId: z.string().min(1),
  name: z.string().min(1),
  value: decimal,
  unit: z.string().max(16).optional(),
  source: z.string().min(1).max(64),
  /** 来源记录引用（贡献事件/证据/摄取批次 id）。 */
  sourceRef: z.string().min(1).max(256).optional(),
  /** 逐项来源追溯：正式评分要求四项齐全，否则 409 PERFORMANCE_SOURCE_TRACE_MISSING。 */
  sourceSystem: z.string().min(1).max(64).optional(),
  sourceRecordId: z.string().min(1).max(256).optional(),
  sourceVersion: z.string().min(1).max(256).optional(),
  observedAt: z.string().datetime(),
  qualityStatus: z.enum(["VALID", "MISSING", "STALE", "CONFLICTED"]),
});

export const createMetricMeasurementSnapshotSchema = z.object({
  cycleId: uuidSchema,
  personId: uuidSchema,
  rubricVersionId: uuidSchema,
  measurements: z.array(metricMeasurementRecordSchema).min(1).max(100),
}).strict();

export const linkMetricMeasurementSnapshotSchema = z.object({
  evaluationDecisionId: uuidSchema,
}).strict();

/**
 * NPV2-020/023：Agent 待办 upsert（worker 经 API 落库；幂等键必填）。
 */
export const upsertAgentTodoSchema = z.object({
  title: z.string().min(1),
  detail: z.string().optional(),
  assigneePersonId: uuidSchema,
  dueAt: z.string().datetime().optional(),
  targetType: z.string().max(64).optional(),
  targetId: z.string().min(1).max(256).optional(),
  sourceType: z.string().min(1).max(64),
  sourceId: z.string().min(1).max(256),
  idempotencyKey: z.string().min(1).max(256),
  createdByAgentTaskId: uuidSchema.optional(),
});

export const decideAccountingPeriodChangeSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  approverPersonId: uuidSchema,
  note: z.string().min(3).optional(),
});
export type DecideAccountingPeriodChangeBody = z.infer<
  typeof decideAccountingPeriodChangeSchema
>;

export * from "./billing.js";

export const importCommercialQuoteSchema = z.object({
  sourceSystem: z.string().min(1),
  externalOpportunityId: z.string().min(1),
  externalQuoteId: z.string().min(1),
  currency: z.string().length(3),
  amount: decimal,
  status: z.enum(["DRAFT", "ISSUED", "ACCEPTED", "REJECTED", "EXPIRED"]).optional(),
  issuedAt: z.string().datetime().optional(),
  acceptedAt: z.string().datetime().optional(),
});
export type ImportCommercialQuoteBody = z.infer<
  typeof importCommercialQuoteSchema
>;

export const importCommercialContractSchema = z.object({
  sourceSystem: z.string().min(1),
  externalContractId: z.string().min(1),
  externalQuoteId: z.string().min(1),
  contractRef: z.string().min(1),
  currency: z.string().length(3),
  amount: decimal,
  status: z.enum(["DRAFT", "SIGNED", "TERMINATED"]).optional(),
  signedAt: z.string().datetime().optional(),
});
export type ImportCommercialContractBody = z.infer<
  typeof importCommercialContractSchema
>;

export const importCommercialOrderSchema = z.object({
  sourceSystem: z.string().min(1),
  externalOrderId: z.string().min(1),
  externalContractId: z.string().min(1),
  orderNumber: z.string().min(1),
  currency: z.string().length(3),
  status: z.enum(["DRAFT", "CONFIRMED", "CANCELLED"]).optional(),
  lines: z
    .array(
      z.object({
        kind: z.enum(["PRODUCT", "SERVICE", "DISCOUNT", "SURCHARGE"]),
        description: z.string().min(1),
        quantity: decimal,
        unitPrice: decimal,
        amount: decimal,
        currency: z.string().length(3),
      }),
    )
    .min(1),
});
export type ImportCommercialOrderBody = z.infer<
  typeof importCommercialOrderSchema
>;

export const importPersonSchema = z.object({
  sourceSystem: z.string().min(1),
  externalId: z.string().min(1),
  employeeCode: z.string().min(1).max(64).optional(),
  displayName: z.string().min(1),
  employmentStatus: z.string().min(1).optional(),
});
export type ImportPersonBody = z.infer<typeof importPersonSchema>;
