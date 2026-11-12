import { assertScoringAllowed, type EvaluationGate } from "./index.js";

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
 * @deprecated NPV2-004（PRD V4.2 D-02）：证据覆盖不得映射为 0–5 绩效分。
 * 新代码一律使用 `assessEvidenceCoverage()`（./coverage.ts），它只输出
 * 覆盖率与缺口，不含任何数字评分。本函数仅保留给已通过 Gold Set 门禁的
 * numeric 提案通道（`aiNumericScoringEnabled`），且其结果永远是提案、
 * 永远需要人工独立判断，不得自动升级为正式决定。
 */
export function scoreEvidence(
  input: ScoreEvidenceInput,
  gate: EvaluationGate,
): ScoreEvidenceResult {
  assertScoringAllowed(gate);
  if (input.dimensions.length === 0) {
    throw new Error("at least one scoring dimension is required");
  }
  const scale = input.scale ?? 5;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("score scale must be a positive number");
  }

  const scores: Record<string, number> = {};
  const rationale: string[] = [];
  const insufficientEvidence: string[] = [];
  for (const dimension of input.dimensions) {
    const relevant = input.evidence.filter(
      (item) => !item.dimension || item.dimension === dimension,
    );
    const weighted = relevant.reduce(
      (sum, item) =>
        sum + (QUALITY_WEIGHT[item.quality ?? "UNVERIFIED"] ?? 0),
      0,
    );
    if (weighted === 0) insufficientEvidence.push(dimension);
    const coverage = Math.min(1, weighted / 3);
    scores[dimension] = round(scale * coverage);
    rationale.push(
      `${dimension}: ${relevant.length} item(s), weighted coverage ${round(
        coverage,
      )}`,
    );
  }

  const values = Object.values(scores);
  const overallScore =
    values.length === 0
      ? 0
      : round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const weighted = input.evidence.reduce(
    (sum, item) => sum + (QUALITY_WEIGHT[item.quality ?? "UNVERIFIED"] ?? 0),
    0,
  );
  const confidence = round(Math.min(1, weighted / 3));

  return {
    scores,
    overallScore,
    confidence,
    citations: input.evidence.map((item) => item.id),
    rationale: rationale.join("; "),
    evidenceCount: input.evidence.length,
    insufficientEvidence,
  };
}
