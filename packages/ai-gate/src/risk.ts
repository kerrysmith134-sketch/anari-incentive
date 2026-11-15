/**
 * Legacy numeric-score risk types are retained for historical record reads.
 * Numeric-score-derived risk classification is permanently retired (PRD V4.2
 * D-02); new workflows must use qualitative evidence and workflow-risk gates.
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
 * Fail closed. A numeric score must never be created or classified as an AI
 * proposal, regardless of whether a historical model gate passed.
 */
export function assessAiRisk(
  _input: AiRiskAssessmentInput,
): AiRiskAssessment {
  throw new Error(
    "AI_NUMERIC_SCORING_DISABLED: numeric-score risk classification is retired; use evidence-quality and workflow-risk assessments",
  );
}
