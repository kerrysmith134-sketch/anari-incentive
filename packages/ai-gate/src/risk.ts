/**
 * Deterministic risk classification for AI score proposals.
 *
 * The caller may request a higher tier, but can never lower the tier the
 * system derives from the proposal's impact, confidence and evidence. HIGH and
 * CRITICAL proposals always require an independent second review before a
 * decision is recorded (PRD AI-03).
 */

export type AiRiskTier = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface AiRiskAssessmentInput {
  overallScore: number;
  scale?: number;
  confidence: number;
  evidenceCount: number;
  /** True when any scored dimension is zero (unpriced or unobserved work). */
  hasZeroScore?: boolean;
  requestedTier?: AiRiskTier;
}

export interface AiRiskAssessment {
  riskTier: AiRiskTier;
  riskReasons: string[];
  secondReviewRequired: boolean;
  secondReviewSlaHours?: number;
}

export const AI_RISK_DEFAULTS = {
  scale: 5,
  /** At or below this share of the scale a proposal can adversely affect pay. */
  adverseScoreRatio: 0.2,
  lowConfidence: 0.5,
  mediumConfidence: 0.7,
  minimumEvidence: 3,
  secondReviewSlaHours: {
    HIGH: 24,
    CRITICAL: 8,
  } as const,
} as const;

const TIER_ORDER: Record<AiRiskTier, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function maxTier(a: AiRiskTier, b: AiRiskTier): AiRiskTier {
  return TIER_ORDER[a] >= TIER_ORDER[b] ? a : b;
}

/**
 * Classify a proposal. Scores are always proposals; an adverse high score is
 * still high impact because a human may accept it. A zero score is critical
 * because it can suppress pay and must never pass through a single reviewer.
 */
export function assessAiRisk(
  input: AiRiskAssessmentInput,
): AiRiskAssessment {
  const scale = input.scale ?? AI_RISK_DEFAULTS.scale;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("AI risk assessment requires a positive score scale");
  }
  const scoreRatio = input.overallScore / scale;
  let tier: AiRiskTier = "LOW";
  const reasons: string[] = [];

  const requested = input.requestedTier ?? "MEDIUM";
  if (requested !== "LOW") {
    tier = maxTier(tier, requested);
    reasons.push(`CALLER_REQUESTED_${requested}`);
  }

  if (input.hasZeroScore || scoreRatio <= 0) {
    tier = maxTier(tier, "CRITICAL");
    reasons.push("ZERO_SCORE_ADVERSE_IMPACT");
  } else if (scoreRatio <= AI_RISK_DEFAULTS.adverseScoreRatio) {
    tier = maxTier(tier, "HIGH");
    reasons.push("LOW_SCORE_ADVERSE_IMPACT");
  }

  if (input.confidence < AI_RISK_DEFAULTS.lowConfidence) {
    tier = maxTier(tier, "HIGH");
    reasons.push("LOW_CONFIDENCE");
  } else if (input.confidence < AI_RISK_DEFAULTS.mediumConfidence) {
    tier = maxTier(tier, "MEDIUM");
    reasons.push("MEDIUM_CONFIDENCE");
  }

  if (input.evidenceCount <= 0) {
    tier = maxTier(tier, "HIGH");
    reasons.push("NO_EVIDENCE");
  } else if (input.evidenceCount < AI_RISK_DEFAULTS.minimumEvidence) {
    tier = maxTier(tier, "MEDIUM");
    reasons.push("LIMITED_EVIDENCE");
  }

  if (tier === "LOW" && requested === "LOW") {
    reasons.push("CALLER_LOW_TIER_CONFIRMED");
  }
  if (
    tier === "MEDIUM" &&
    requested === "MEDIUM" &&
    reasons.length === 1
  ) {
    reasons.push("DEFAULT_REVIEW_TIER");
  }

  const secondReviewRequired = tier === "HIGH" || tier === "CRITICAL";
  return {
    riskTier: tier,
    riskReasons: [...new Set(reasons)],
    secondReviewRequired,
    secondReviewSlaHours: secondReviewRequired
      ? AI_RISK_DEFAULTS.secondReviewSlaHours[
          tier as "HIGH" | "CRITICAL"
        ]
      : undefined,
  };
}
