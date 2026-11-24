import { z } from "zod";
import { decimal, uuidSchema } from "./primitives.js";


// ---------------------------------------------------------------------------
// Billing: plans, subscriptions, invoices and self-service signup
// ---------------------------------------------------------------------------

export const createSubscriptionPlanSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(1),
  description: z.string().optional(),
  monthlyPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().length(3),
  /** -1 means unlimited seats. */
  seatLimit: z.number().int().min(-1),
  trialDays: z.number().int().min(0).max(365),
  features: z.array(z.string()).default([]),
  active: z.boolean().optional(),
});
export type CreateSubscriptionPlanBody = z.infer<
  typeof createSubscriptionPlanSchema
>;

export const setTenantSubscriptionSchema = z.object({
  planCode: z.string().min(2),
  status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"]),
  seats: z.number().int().min(1),
  currentPeriodStart: z.string().min(4),
  currentPeriodEnd: z.string().min(4),
  trialEndsAt: z.string().optional(),
  cancelReason: z.string().optional(),
});
export type SetTenantSubscriptionBody = z.infer<
  typeof setTenantSubscriptionSchema
>;

const positiveMoney = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/)
  .refine((value) => Number(value) > 0, "must be greater than 0");

export const tenantInvoiceLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().min(1),
  unitAmount: positiveMoney,
  amount: positiveMoney,
});

export const createTenantInvoiceSchema = z.object({
  lineItems: z.array(tenantInvoiceLineItemSchema).min(1),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  dueDate: z.string().optional(),
});
export type CreateTenantInvoiceBody = z.infer<
  typeof createTenantInvoiceSchema
>;

export const setTenantInvoiceStatusSchema = z.object({
  status: z.enum(["ISSUED", "PAID", "VOID"]),
});

export const generateClawbackRecoverySchema = z.object({
  cycleId: z.string().min(1),
  ledgerEntryId: z.string().min(1),
  createBatch: z.boolean().optional(),
  /**
   * 分期追回：按 installmentMonths 提供每个月的 cycleId。提供时按月生成
   * 负数分录，否则仍按单笔一次性追回。
   */
  installmentCycles: z.array(uuidSchema).min(1).max(12).optional(),
});
export type GenerateClawbackRecoveryBody = z.infer<
  typeof generateClawbackRecoverySchema
>;

export const createStrategicPoolCaseSchema = z.object({
  cycleId: z.string().min(1),
  poolAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  capAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().length(3),
  budgetPoolId: z.string().optional(),
  requestedBy: z.string().min(1),
  rationale: z.string().min(1),
});
export type CreateStrategicPoolCaseBody = z.infer<
  typeof createStrategicPoolCaseSchema
>;

export const strategicPoolCostReviewSchema = z.object({
  units: z.number().int().min(0),
  unitStandardCost: z.string().regex(/^\d+(\.\d{1,2})?$/),
  transferPricingRef: z.string().min(1),
  reviewedBy: z.string().min(1),
});

export const strategicPoolFinanceApproveSchema = z.object({
  approvedBy: z.string().min(1),
  deferredInstallmentMonths: z.number().int().min(0).max(36),
});

export const processRetentionDisposalsSchema = z.object({
  actorPersonId: uuidSchema,
});
export type ProcessRetentionDisposalsBody = z.infer<
  typeof processRetentionDisposalsSchema
>;

export const passwordLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  tenantId: z.string().optional(),
});
export type PasswordLoginBody = z.infer<typeof passwordLoginSchema>;

export const setPasswordSchema = z.object({
  userId: uuidSchema,
  password: z.string().min(8).max(200),
});
export type SetPasswordBody = z.infer<typeof setPasswordSchema>;

export const advanceCycleSchema = z.object({
  status: z.enum([
    "COLLECTING",
    "AI_PRE_REVIEW",
    "HUMAN_REVIEW",
    "DECIDED",
    "CALCULATING",
    "SETTLED",
  ]),
  reason: z.string().min(3).optional(),
});

export const runsFromIngestionSchema = z.object({
  cycleId: uuidSchema,
  policyVersionId: uuidSchema,
  sourceSystem: z.string().min(1),
  mode: z.enum(["SHADOW", "FORMAL"]).default("SHADOW"),
  /** 订单证据的 evidenceType（默认 ORDER）。 */
  evidenceType: z.string().min(1).default("ORDER"),
});
export type AdvanceCycleBody = z.infer<typeof advanceCycleSchema>;
export type RunsFromIngestionBody = z.infer<typeof runsFromIngestionSchema>;

/** AI-02：金标集批量导入——一条样本 = 两位人工分 + 模型分 + 对抗结果。 */
export const goldSetImportSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  labelSource: z.string().min(1),
  ownerPersonId: uuidSchema,
  holdoutRatio: z.number().min(0.01).max(0.9).default(0.2),
  refreshedAt: z.string().datetime(),
  nextRefreshDueAt: z.string().datetime(),
  samples: z
    .array(
      z.object({
        sampleId: z.string().min(1),
        subgroup: z.string().min(1),
        humanScoreA: z.number().min(0).max(5),
        humanScoreB: z.number().min(0).max(5),
        aiScore: z.number().min(0).max(5),
        counterfactualScores: z.array(z.number().min(0).max(5)).default([]),
        promptInjectionPassed: z.boolean(),
        holdout: z.boolean().default(false),
      }),
    )
    .min(2),
});
export type GoldSetImportBody = z.infer<typeof goldSetImportSchema>;

export const preReviewSchema = z.object({
  personIds: z.array(uuidSchema).max(100).optional(),
});
export type PreReviewBody = z.infer<typeof preReviewSchema>;

export const feishuSyncSchema = z.object({
  dryRun: z.boolean().default(true),
  allowCreate: z.boolean().default(false),
});
export type FeishuSyncBody = z.infer<typeof feishuSyncSchema>;

export const modelSummarySchema = z.object({
  dimensions: z.array(z.string().min(1)).min(1).max(8),
  evidenceRefs: z.array(z.string().min(1)).min(1).max(20),
  rubric: z.string().max(8_000).optional(),
  context: z.string().max(8_000).optional(),
}).strict();
export type ModelSummaryBody = z.infer<typeof modelSummarySchema>;

export const publicSignupSchema = z.object({
  password: z.string().min(8).max(200).optional(),
  companyName: z.string().min(2),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  adminDisplayName: z.string().min(1),
  adminEmail: z.string().email(),
  planCode: z.string().optional(),
  acceptTerms: z.literal(true),
  /** Honeypot; must stay empty. */
  website: z.string().max(0).optional(),
});
export type PublicSignupBody = z.infer<typeof publicSignupSchema>;

/**
 * Single source for documented request bodies. Add a schema here and the
 * generated contract manifest plus OpenAPI drift test pick it up.
 */
const awardMoney = z
  .string()
  .regex(/^\d{1,14}(\.\d{1,6})?$/, "expected a positive decimal with <= 14 integer digits")
  .refine((value) => Number(value) > 0, "must be greater than 0");

export const createIncentiveAwardBatchSchema = z.object({
  batchNo: z.string().min(1).max(64),
  awardType: z.enum([
    "BUSINESS_UNIT_COMMISSION",
    "FUNCTIONAL_QUARTERLY_BONUS",
    "ANNUAL_PROFIT_SHARING",
    "MONTHLY_STAR",
    "TECH_CENTER_AWARD",
    "OVERSEAS_SALES_AWARD",
    "BOUNTY_SETTLEMENT",
    "MANUAL",
  ]),
  period: z.string().min(1).max(64),
  cycleId: uuidSchema.optional(),
  currency: z.string().length(3),
  createdBy: uuidSchema.optional(),
  sourceRecordIds: z.array(z.string().min(1).max(200)).max(1000).optional(),
  lines: z
    .array(
      z.object({
        personId: uuidSchema,
        amount: awardMoney,
        sourceRecordId: z.string().min(1).max(200).optional(),
        sourceLineRef: z.string().min(1).max(200).optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(5000),
});
export type CreateIncentiveAwardBatchBody = z.infer<
  typeof createIncentiveAwardBatchSchema
>;

const csvPayload = z.string().min(1).max(2_000_000);

export const importIncentiveAwardBatchSchema = z.object({
  csv: csvPayload,
  batchNo: z.string().min(1).max(64),
  awardType: z.enum([
    "BUSINESS_UNIT_COMMISSION",
    "FUNCTIONAL_QUARTERLY_BONUS",
    "ANNUAL_PROFIT_SHARING",
    "MONTHLY_STAR",
    "TECH_CENTER_AWARD",
    "OVERSEAS_SALES_AWARD",
    "BOUNTY_SETTLEMENT",
    "MANUAL",
  ]),
  period: z.string().min(1).max(64),
  cycleId: uuidSchema.optional(),
  currency: z.string().length(3),
  createdBy: uuidSchema.optional(),
});
export type ImportIncentiveAwardBatchBody = z.infer<
  typeof importIncentiveAwardBatchSchema
>;

export const importEmploymentContractsSchema = z.object({
  csv: csvPayload,
});
export type ImportEmploymentContractsBody = z.infer<
  typeof importEmploymentContractsSchema
>;

const optionalMoney = z
  .string()
  .regex(/^\d{1,14}(\.\d{1,6})?$/, "expected a non-negative decimal");
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const adjustEquityGrantSchema = z
  .object({
    totalUnits: optionalMoney.optional(),
    strikePrice: optionalMoney.optional(),
    grantDate: isoDay.optional(),
    vestingStart: isoDay.optional(),
    cliffMonths: z.number().int().min(0).max(120).optional(),
    vestingMonths: z.number().int().min(1).max(240).optional(),
    reason: z.string().min(3).max(500),
  })
  .refine(
    (body) =>
      Object.entries(body).some(
        ([key, value]) => key !== "reason" && value !== undefined,
      ),
    "at least one editable field is required",
  );
export type AdjustEquityGrantBody = z.infer<typeof adjustEquityGrantSchema>;

