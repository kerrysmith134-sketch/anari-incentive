import type { PolicyDefinition } from "@anari/domain";
import {
  add,
  div,
  formatDecimal,
  mul,
  parseDecimal,
  sub,
} from "./decimal.js";

export interface EvaluationMultiplierResult {
  multiplier?: string;
  blockers: string[];
}

/**
 * Convert approved evaluation scores into a weight multiplier using the
 * policy's declared dimension weights and floor/ceiling. Missing or
 * out-of-range scores are blockers; they are never silently defaulted.
 */
export function deriveEvaluationMultiplier(
  config: NonNullable<PolicyDefinition["evaluation"]>,
  scores: Record<string, number>,
  personId: string,
): EvaluationMultiplierResult {
  const blockers: string[] = [];
  const dimensions = Object.entries(config.dimensionWeights);
  if (dimensions.length === 0) {
    return { blockers: ["EVALUATION_DIMENSION_WEIGHTS_MISSING"] };
  }
  let floor: bigint;
  let ceiling: bigint;
  let maxScore: bigint;
  try {
    floor = parseDecimal(config.floor);
    ceiling = parseDecimal(config.ceiling);
    maxScore = parseDecimal(config.maxScore ?? "5");
  } catch {
    return { blockers: ["EVALUATION_CONFIG_INVALID"] };
  }
  if (floor < 0n || ceiling < floor || maxScore <= 0n) {
    return { blockers: ["EVALUATION_CONFIG_INVALID"] };
  }

  let weightTotal = 0n;
  let weightedScore = 0n;
  for (const [dimension, rawWeight] of dimensions) {
    let weight: bigint;
    try {
      weight = parseDecimal(rawWeight);
    } catch {
      blockers.push("EVALUATION_DIMENSION_WEIGHTS_MISSING");
      continue;
    }
    if (weight < 0n) {
      blockers.push("EVALUATION_DIMENSION_WEIGHTS_MISSING");
      continue;
    }
    weightTotal += weight;
    const score = scores[dimension];
    if (score === undefined) {
      blockers.push(`EVALUATION_SCORE_MISSING:${personId}:${dimension}`);
      continue;
    }
    const scoreDecimal = parseDecimal(String(score));
    if (scoreDecimal < 0n || scoreDecimal > maxScore) {
      blockers.push(`EVALUATION_SCORE_OUT_OF_RANGE:${personId}:${dimension}`);
      continue;
    }
    weightedScore = add(weightedScore, mul(scoreDecimal, weight));
  }
  if (weightTotal <= 0n) {
    return {
      blockers: [...blockers, "EVALUATION_DIMENSION_WEIGHTS_MISSING"],
    };
  }
  if (blockers.length > 0) return { blockers };

  const averageScore = div(weightedScore, weightTotal);
  const ratio = div(averageScore, maxScore);
  const range = sub(ceiling, floor);
  return {
    multiplier: formatDecimal(add(floor, mul(range, ratio))),
    blockers: [],
  };
}

