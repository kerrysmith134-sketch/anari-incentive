/**
 * NPV2-009 / AUD-022：试点影子周期验收指标（纯函数，可测试）。
 *
 * 五项验收（审计口径）：
 *  1. 财务差异 = 0        —— 财务事实 vs 每周期最新 FORMAL APPROVED/LOCKED 运行毛利
 *  2. 证据覆盖 ≥ 70%      —— 按岗位/角色分层统计（样本 <3 的角色标 N/A）
 *  3. 员工补证 ≤ 30 min   —— 申报提交 → 该工作包首份证据登记 的中位分钟数
 *  4. 经理复核 ≤ 2 h      —— 草案创建 → 独立决定 的中位分钟数（含等待，口径保守）
 *  5. 争议率 < 10%        —— DISPUTED 申报 / 周期窗口内申报总数
 *
 * 指标计算与 CLI/存储解耦：CLI（pilot-shadow-cycle.ts）负责取数，本文件只算。
 */

export interface PilotFactInput {
  id?: string;
  amount: string;
  qualityStatus: string;
  payload: Record<string, unknown>;
  periodStart?: string;
  periodEnd?: string;
}

export interface PilotRunInput {
  id: string;
  mode: string;
  status: string;
  orderGrossProfit?: string;
}

export interface PilotClaimInput {
  id: string;
  workPackageId: string;
  claimantPersonId: string;
  status: string;
  createdAt: string;
  submittedAt?: string;
  evidenceRefs: string[];
}

export interface PilotWorkPackageInput {
  id: string;
  members: Array<{ personId: string; responsibilityCode: string }>;
}

export interface PilotEvidenceInput {
  id: string;
  subjectType: string;
  subjectId: string;
  createdAt: string;
}

export interface PilotDraftInput {
  id: string;
  personId: string;
  cycleId: string;
  createdAt: string;
}

export interface PilotDecisionInput {
  id: string;
  personId: string;
  cycleId: string;
  createdAt: string;
}

export interface PilotMetricInputs {
  cycle: { id: string; startsAt: string; endsAt: string };
  facts: PilotFactInput[];
  /** 每周期最新 FORMAL APPROVED/LOCKED 运行（调用方负责挑选）。 */
  benchmarkRun?: PilotRunInput;
  claims: PilotClaimInput[];
  workPackages: PilotWorkPackageInput[];
  evidence: PilotEvidenceInput[];
  drafts: PilotDraftInput[];
  decisions: PilotDecisionInput[];
}

export type PilotVerdict = "PASS" | "FAIL" | "N/A";

export interface PilotMetricsReport {
  cycleId: string;
  financial: {
    declaredMicros: string;
    runMicros: string;
    deltaMicros: string;
    verdict: PilotVerdict;
    detail: string;
  };
  evidenceCoverage: {
    overall: { covered: number; total: number; rate: number | null; verdict: PilotVerdict };
    byRole: Record<
      string,
      { covered: number; total: number; rate: number | null; verdict: PilotVerdict }
    >;
    verdict: PilotVerdict;
  };
  supplement: {
    samples: number;
    medianMinutes: number | null;
    verdict: PilotVerdict;
    note: string;
  };
  review: {
    samples: number;
    medianMinutes: number | null;
    verdict: PilotVerdict;
    note: string;
  };
  dispute: {
    disputed: number;
    total: number;
    rate: number | null;
    verdict: PilotVerdict;
  };
  /** 任一硬性指标 FAIL 即整体不通过（N/A 视为尚不可测，不判 FAIL 但会披露）。 */
  pass: boolean;
}

/** 严格解析 DecimalString → 1e6 微单位（>6 位小数报错，不静默丢精度）。 */
export function amountToMicros(value: string): bigint {
  const trimmed = value.trim();
  const match = /^-?\d+(\.\d+)?$/.exec(trimmed);
  if (!match) throw new Error(`invalid amount: ${value}`);
  const negative = trimmed.startsWith("-");
  const digits = negative ? trimmed.slice(1) : trimmed;
  const [intPart = "0", fracPart = ""] = digits.split(".");
  if (fracPart.length > 6) {
    throw new Error(`amount has more than 6 decimal places: ${value}`);
  }
  const micros =
    BigInt(intPart) * 1_000_000n + BigInt((fracPart + "000000").slice(0, 6));
  return negative ? -micros : micros;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

const EVIDENCE_TARGET = 0.7;
const SUPPLEMENT_MAX_MINUTES = 30;
const REVIEW_MAX_MINUTES = 120;
const DISPUTE_MAX_RATE = 0.1;

function inWindow(iso: string | undefined, startsAt: string, endsAt: string): boolean {
  if (!iso) return false;
  return iso >= startsAt && iso <= endsAt;
}

export function computePilotMetrics(input: PilotMetricInputs): PilotMetricsReport {
  const inCycle = input.claims.filter((claim) =>
    inWindow(claim.createdAt, input.cycle.startsAt, input.cycle.endsAt),
  );

  // 1) 财务差异：facts（payload.cycleId 优先，否则期间重叠）vs 运行毛利。
  const cycleFacts = input.facts.filter((fact) => {
    if (fact.qualityStatus === "INVALID" || fact.qualityStatus === "MISSING") {
      return false;
    }
    const payloadCycle = fact.payload?.cycleId;
    if (typeof payloadCycle === "string" && payloadCycle.length > 0) {
      return payloadCycle === input.cycle.id;
    }
    const startsBeforeEnd = !fact.periodEnd || fact.periodEnd >= input.cycle.startsAt;
    const endsAfterStart = !fact.periodStart || fact.periodStart <= input.cycle.endsAt;
    return startsBeforeEnd && endsAfterStart;
  });
  let declaredMicros = 0n;
  let factError: string | undefined;
  for (const fact of cycleFacts) {
    try {
      declaredMicros += amountToMicros(fact.amount);
    } catch (error) {
      factError = (error as Error).message;
    }
  }
  let runMicros = 0n;
  let runError: string | undefined;
  const eligibleRun =
    input.benchmarkRun &&
    input.benchmarkRun.mode === "FORMAL" &&
    (input.benchmarkRun.status === "APPROVED" || input.benchmarkRun.status === "LOCKED");
  if (!eligibleRun) {
    runError = "no FORMAL APPROVED/LOCKED calculation run for this cycle";
  } else if (typeof input.benchmarkRun?.orderGrossProfit !== "string") {
    runError = "benchmark run has no grossProfit in its input snapshot";
  } else {
    try {
      runMicros = amountToMicros(input.benchmarkRun.orderGrossProfit);
    } catch (error) {
      runError = (error as Error).message;
    }
  }
  const deltaMicros = declaredMicros - runMicros;
  const financialVerdict: PilotVerdict =
    factError || runError
      ? "FAIL"
      : deltaMicros === 0n
        ? "PASS"
        : "FAIL";

  // 2) 证据覆盖（按角色分层）。
  const wpById = new Map(input.workPackages.map((wp) => [wp.id, wp]));
  const evidenceByWp = new Map<string, number>();
  for (const node of input.evidence) {
    if (node.subjectType !== "WORK_PACKAGE") continue;
    evidenceByWp.set(node.subjectId, (evidenceByWp.get(node.subjectId) ?? 0) + 1);
  }
  const roleByPerson = (personId: string, wpId: string): string => {
    const wp = wpById.get(wpId);
    const member = wp?.members.find((entry) => entry.personId === personId);
    return member?.responsibilityCode ?? "UNKNOWN";
  };
  const coveredByRole: Record<string, { covered: number; total: number }> = {};
  let coveredTotal = 0;
  for (const claim of inCycle) {
    const covered =
      claim.evidenceRefs.length > 0 || (evidenceByWp.get(claim.workPackageId) ?? 0) > 0;
    const role = roleByPerson(claim.claimantPersonId, claim.workPackageId);
    coveredByRole[role] = coveredByRole[role] ?? { covered: 0, total: 0 };
    coveredByRole[role].total += 1;
    if (covered) {
      coveredByRole[role].covered += 1;
      coveredTotal += 1;
    }
  }
  const rate = (covered: number, total: number): number | null =>
    total === 0 ? null : Math.round((covered / total) * 10_000) / 10_000;
  const byRole: PilotMetricsReport["evidenceCoverage"]["byRole"] = {};
  const roleVerdicts: PilotVerdict[] = [];
  for (const [role, stats] of Object.entries(coveredByRole)) {
    const roleRate = rate(stats.covered, stats.total);
    // 角色样本 <3 时统计不显著：标 N/A 不参与门禁。
    const verdict: PilotVerdict =
      stats.total < 3 || roleRate === null
        ? "N/A"
        : roleRate >= EVIDENCE_TARGET
          ? "PASS"
          : "FAIL";
    byRole[role] = { ...stats, rate: roleRate, verdict };
    roleVerdicts.push(verdict);
  }
  const overallRate = rate(coveredTotal, inCycle.length);
  const overallVerdict: PilotVerdict =
    overallRate === null
      ? "N/A"
      : roleVerdicts.includes("FAIL") || overallRate < EVIDENCE_TARGET
        ? "FAIL"
        : "PASS";

  // 3) 补证时长：申报提交 → 该 WP 首份证据登记。
  const supplementSamples: number[] = [];
  for (const claim of inCycle) {
    if (!claim.submittedAt) continue;
    const submittedMs = Date.parse(claim.submittedAt);
    const candidates = input.evidence
      .filter(
        (node) =>
          node.subjectType === "WORK_PACKAGE" &&
          node.subjectId === claim.workPackageId &&
          Date.parse(node.createdAt) >= submittedMs,
      )
      .map((node) => Date.parse(node.createdAt) - submittedMs);
    if (candidates.length > 0) {
      supplementSamples.push(Math.round(Math.min(...candidates) / 60_000));
    }
  }
  const supplementMedian = median(supplementSamples);
  const supplementVerdict: PilotVerdict =
    supplementMedian === null
      ? "N/A"
      : supplementMedian <= SUPPLEMENT_MAX_MINUTES
        ? "PASS"
        : "FAIL";

  // 4) 经理复核时长：草案创建 → 决定（含等待，口径保守）。
  const cycleDecisions = input.decisions.filter(
    (decision) => decision.cycleId === input.cycle.id,
  );
  const reviewSamples: number[] = [];
  for (const decision of cycleDecisions) {
    const draftCandidates = input.drafts
      .filter(
        (draft) =>
          draft.personId === decision.personId &&
          draft.cycleId === input.cycle.id &&
          Date.parse(draft.createdAt) <= Date.parse(decision.createdAt),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const draft = draftCandidates[0];
    if (!draft) continue;
    const minutes = Math.round(
      (Date.parse(decision.createdAt) - Date.parse(draft.createdAt)) / 60_000,
    );
    if (Number.isFinite(minutes) && minutes >= 0) reviewSamples.push(minutes);
  }
  const reviewMedian = median(reviewSamples);
  const reviewVerdict: PilotVerdict =
    reviewMedian === null
      ? "N/A"
      : reviewMedian <= REVIEW_MAX_MINUTES
        ? "PASS"
        : "FAIL";

  // 5) 争议率。
  const disputed = inCycle.filter((claim) => claim.status === "DISPUTED").length;
  const disputeRate = rate(disputed, inCycle.length);
  const disputeVerdict: PilotVerdict =
    disputeRate === null
      ? "N/A"
      : disputeRate < DISPUTE_MAX_RATE
        ? "PASS"
        : "FAIL";

  const verdicts: PilotVerdict[] = [
    financialVerdict,
    overallVerdict,
    supplementVerdict,
    reviewVerdict,
    disputeVerdict,
  ];

  return {
    cycleId: input.cycle.id,
    financial: {
      declaredMicros: declaredMicros.toString(),
      runMicros: runMicros.toString(),
      deltaMicros: deltaMicros.toString(),
      verdict: financialVerdict,
      detail:
        factError ?? runError ??
        (cycleFacts.length === 0
          ? "no financial facts matched this cycle"
          : "declared vs benchmark run gross profit"),
    },
    evidenceCoverage: {
      overall: {
        covered: coveredTotal,
        total: inCycle.length,
        rate: overallRate,
        verdict: overallVerdict,
      },
      byRole,
      verdict: overallVerdict,
    },
    supplement: {
      samples: supplementSamples.length,
      medianMinutes: supplementMedian,
      verdict: supplementVerdict,
      note: "口径：claim.submittedAt → 同工作包首份证据 createdAt（仅统计有证据之后的样本）。",
    },
    review: {
      samples: reviewSamples.length,
      medianMinutes: reviewMedian,
      verdict: reviewVerdict,
      note: "口径：草案 createdAt → 独立决定 createdAt（含等待，口径保守）。",
    },
    dispute: {
      disputed,
      total: inCycle.length,
      rate: disputeRate,
      verdict: disputeVerdict,
    },
    pass: !verdicts.includes("FAIL"),
  };
}
