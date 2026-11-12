import type { ScoringEvidence, ScoringEvidenceQuality } from "./scoring.js";

/**
 * Evidence Coverage Assessment（NPV2-004）。
 *
 * 回答"系统对这个主体掌握了多少证据"，而不是"这个人表现如何"。
 * 输出永远不是绩效分：没有 0–5 分、没有 overallScore。覆盖率只是
 * 信息掌握程度，不得直接或间接映射为贡献/绩效分值（V2 蓝图 P0-C）。
 */

export interface CoverageRequirement {
  dimension: string;
  /** 该维度要求的最小有效证据数；默认 1。 */
  minValidEvidence?: number;
}

export interface EvidenceCoverageInput {
  subjectType: string;
  subjectId: string;
  cycleId: string;
  dimensions: string[];
  evidence: ScoringEvidence[];
  /** 显式要求集；缺省时每个维度按 ≥1 条非零质量证据计。 */
  requirements?: CoverageRequirement[];
}

export type CoverageBand = "NONE" | "LOW" | "PARTIAL" | "ADEQUATE" | "FULL";

export interface DimensionCoverage {
  dimension: string;
  status:
    | "COVERED"
    | "INSUFFICIENT_EVIDENCE"
    | "NO_EVIDENCE";
  requiredCount: number;
  presentCount: number;
  validCount: number;
  unverifiedCount: number;
  staleCount: number;
  conflictedCount: number;
  invalidCount: number;
  /** 质量加权覆盖（0–1），仅描述信息掌握度。 */
  weightedCoverage: number;
}

export interface EvidenceCoverageAssessment {
  subjectType: string;
  subjectId: string;
  cycleId: string;
  dimensions: DimensionCoverage[];
  totalEvidence: number;
  missingDimensions: string[];
  staleEvidenceIds: string[];
  conflictedEvidenceIds: string[];
  sourceDiversity: number;
  coverageBand: CoverageBand;
  /** 输入证据的确定性快照哈希，绑定后续任何人工判断。 */
  evidenceSnapshotHash: string;
  computedAt: string;
}

const WEIGHT: Record<ScoringEvidenceQuality, number> = {
  VALID: 1,
  UNVERIFIED: 0.5,
  STALE: 0.25,
  CONFLICTED: 0,
  INVALID: 0,
};

function sha256Hex(input: string): string {
  // 轻量 FNV-1a：确定性快照指纹；不承担密码学职责。
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function band(ratio: number): CoverageBand {
  if (ratio <= 0) return "NONE";
  if (ratio < 0.5) return "LOW";
  if (ratio < 1) return "PARTIAL";
  return "ADEQUATE";
}

export function assessEvidenceCoverage(
  input: EvidenceCoverageInput,
): EvidenceCoverageAssessment {
  if (input.dimensions.length === 0) {
    throw new Error("at least one dimension is required");
  }
  const requirementFor = (dimension: string): number =>
    input.requirements?.find((r) => r.dimension === dimension)?.minValidEvidence ?? 1;

  const dimensions: DimensionCoverage[] = input.dimensions.map((dimension) => {
    const relevant = input.evidence.filter(
      (item) => !item.dimension || item.dimension === dimension,
    );
    const requiredCount = requirementFor(dimension);
    const validCount = relevant.filter((item) => (item.quality ?? "UNVERIFIED") === "VALID").length;
    const unverifiedCount = relevant.filter((item) => item.quality === "UNVERIFIED" || item.quality === undefined).length;
    const staleCount = relevant.filter((item) => item.quality === "STALE").length;
    const conflictedCount = relevant.filter((item) => item.quality === "CONFLICTED").length;
    const invalidCount = relevant.filter((item) => item.quality === "INVALID").length;
    const weighted = relevant.reduce(
      (sum, item) => sum + (WEIGHT[item.quality ?? "UNVERIFIED"] ?? 0),
      0,
    );
    const weightedCoverage = Math.min(1, requiredCount === 0 ? 1 : weighted / requiredCount);
    const status =
      validCount >= requiredCount
        ? "COVERED"
        : relevant.length > 0
          ? "INSUFFICIENT_EVIDENCE"
          : "NO_EVIDENCE";
    return {
      dimension,
      status,
      requiredCount,
      presentCount: relevant.length,
      validCount,
      unverifiedCount,
      staleCount,
      conflictedCount,
      invalidCount,
      weightedCoverage: Math.round(weightedCoverage * 100) / 100,
    };
  });

  const missingDimensions = dimensions
    .filter((d) => d.status !== "COVERED")
    .map((d) => d.dimension);
  const fullyCovered = dimensions.filter((d) => d.status === "COVERED").length;
  const sourceDiversity =
    input.evidence.length === 0
      ? 0
      : new Set(input.evidence.map((item) => item.type)).size / input.evidence.length;
  const snapshot = JSON.stringify({
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    cycleId: input.cycleId,
    dimensions: input.dimensions,
    evidence: [...input.evidence]
      .map((item) => [item.id, item.quality ?? "UNVERIFIED", item.dimension ?? null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });

  return {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    cycleId: input.cycleId,
    dimensions,
    totalEvidence: input.evidence.length,
    missingDimensions,
    staleEvidenceIds: input.evidence.filter((e) => e.quality === "STALE").map((e) => e.id),
    conflictedEvidenceIds: input.evidence.filter((e) => e.quality === "CONFLICTED").map((e) => e.id),
    sourceDiversity: Math.round(sourceDiversity * 100) / 100,
    coverageBand: band(fullyCovered / input.dimensions.length),
    evidenceSnapshotHash: `fnv1a:${sha256Hex(snapshot)}`,
    computedAt: new Date().toISOString(),
  };
}
