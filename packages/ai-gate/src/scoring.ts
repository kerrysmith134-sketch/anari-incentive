import type { EvaluationGate } from "./index.js";

export type ScoringEvidenceQuality =
  | "VALID"
  | "UNVERIFIED"
  | "STALE"
  | "CONFLICTED"
  | "INVALID";

export interface ScoringEvidence {
  id: string;
  type: string;
  text: string;
  /** Optional dimension tag; untagged evidence applies to every dimension. */
  dimension?: string;
  quality?: ScoringEvidenceQuality;
  /** Authoritative source identity (e.g. hubspot, feishu, erp). */
  sourceSystem?: string;
  /** Hash of the canonical source payload when available. */
  payloadHash?: string;
}

export interface ScoreEvidenceInput {
  dimensions: string[];
  evidence: ScoringEvidence[];
  /** Score scale maximum. Defaults to 5. */
  scale?: number;
}

export interface ScoreEvidenceResult {
  scores: Record<string, number>;
  overallScore: number;
  confidence: number;
  citations: string[];
  rationale: string;
  evidenceCount: number;
  insufficientEvidence: string[];
}

const QUALITY_WEIGHT: Record<ScoringEvidenceQuality, number> = {
  VALID: 1,
  UNVERIFIED: 0.5,
  STALE: 0.25,
  CONFLICTED: 0,
  INVALID: 0,
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * @deprecated NPV2-004 / PRD V4.2 D-02. Numeric AI evidence scoring is
 * permanently retired. Keep this symbol only so old clients fail explicitly
 * with a stable error instead of silently reintroducing score generation.
 * Use `assessEvidenceCoverage()` for coverage metadata; it is not a score.
 */
export function scoreEvidence(
  _input: ScoreEvidenceInput,
  _gate: EvaluationGate,
): ScoreEvidenceResult {
  throw new Error(
    "AI_NUMERIC_SCORING_DISABLED: evidence coverage must never be converted to a performance score (PRD V4.2 D-02)",
  );
}
