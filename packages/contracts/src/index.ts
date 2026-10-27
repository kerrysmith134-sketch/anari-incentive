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

export const legalGateSchema = z.object({
  democraticProcedureRef: z.string().min(1).optional(),
  employeeNoticeRef: z.string().min(1).optional(),
  dataProtectionAssessmentRef: z.string().min(1).optional(),
  minimumWageChecked: z.boolean(),
  policyApproved: z.boolean(),
});

export const recordLegalGateSchema = z.object({
  democraticProcedureRef: z.string().min(1).optional(),
  employeeNoticeRef: z.string().min(1).optional(),
  dataProtectionAssessmentRef: z.string().min(1).optional(),
  minimumWageChecked: z.boolean(),
  policyApproved: z.boolean(),
  recordedBy: uuidSchema,
});
export type RecordLegalGateBody = z.infer<typeof recordLegalGateSchema>;

export const recordConfirmationSchema = z.object({
  personId: uuidSchema,
  targetType: z.enum(["EVALUATION", "ATTRIBUTION", "CALCULATION", "LEDGER"]),
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
  }),
  participants: z
    .array(
      z.object({
        personId: uuidSchema,
        workPackageId: uuidSchema,
        attributionWeight: decimal,
        role: z.string().min(1),
      }),
    )
    .min(1),
});
export type CreateCalculationRunInput = z.infer<
  typeof createCalculationRunSchema
>;

export const lockCalculationRunSchema = z.object({
  confirmation: z.literal("LOCK_CALCULATION"),
});
export type LockCalculationRunInput = z.infer<
  typeof lockCalculationRunSchema
>;

export const createAppealSchema = z.object({
  appellantPersonId: uuidSchema,
  targetType: z.enum(["ATTRIBUTION", "EVALUATION", "LEDGER"]),
  targetId: uuidSchema,
  reasonCode: z.string().min(1),
  statement: z.string().min(5),
});
export type CreateAppealInput = z.infer<typeof createAppealSchema>;
