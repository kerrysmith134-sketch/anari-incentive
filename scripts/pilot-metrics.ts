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
  /** 财务事实必须显式提供币种；不允许以默认币种参与对账。 */
  currency: string;
  qualityStatus: string;
  payload: Record<string, unknown>;
  periodStart?: string;
  periodEnd?: string;
  /** NP-ALGO-001：财务事实类型必须显式提供，不允许默认成毛利。 */
  factType: string;
  /** NP-ALGO-001：过账状态必须显式提供，不允许默认成 POSTED。 */
  postingStatus: string;
  /** 订单级来源追溯键；试点毛利事实必须绑定到具体订单。 */
  orderId: string;
}

export interface PilotRunInput {
  id: string;
  mode: string;
  status: string;
  orderGrossProfit?: string;
  /** 运行币种必须显式提供，缺失时财务对账失败。 */
  currency: string;
  /** NP-ALGO-001：运行关联订单 id（订单级对账基准）。 */
  orderId?: string;
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
  /** NP-016：证据载荷中的 claimId（claim 级归属）；无则只按 claim.evidenceRefs 判定。 */
  payload?: Record<string, unknown>;
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
  /** NP-018：复核开始时间（决定 - reviewStartedAt = 真实复核时长）。 */
  reviewStartedAt?: string;
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
    /** NP-ALGO-001：非毛利类事实桥接披露（COST/REFUND/ADJUSTMENT…）。 */
    bridgeByType: Record<string, { count: number; totalMicros: string }>;
    draftExcluded: number;
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

  // 1) 财务差异：仅使用明确归属本周期的事实；禁止按会计期间重叠兜底。
  const cycleFacts = input.facts.filter((fact) => {
    if (fact.qualityStatus === "INVALID" || fact.qualityStatus === "MISSING") {
      return false;
    }
    return fact.payload?.cycleId === input.cycle.id;
  });
  let declaredMicros = 0n;
  let factError: string | undefined;
  // 没有本周期事实不得 PASS；混币种、缺少类型/订单/状态均 fail-closed。
  if (cycleFacts.length === 0) {
    factError = "no financial facts explicitly attributed to this cycle";
  }
  if (cycleFacts.some((fact) => !fact.currency?.trim())) {
    factError = "financial facts are missing currency";
  }
  const factCurrencies = new Set(
    cycleFacts.map((fact) => fact.currency.toUpperCase()),
  );
  const runCurrency = input.benchmarkRun?.currency?.trim().toUpperCase() ?? "";
  if (input.benchmarkRun && !runCurrency) {
    factError = "benchmark run has no currency";
  } else if (factCurrencies.size > 1) {
    factError = `mixed financial-fact currencies: ${[...factCurrencies].join("/")}`;
  } else if (
    cycleFacts.length > 0 &&
    runCurrency &&
    !factCurrencies.has(runCurrency)
  ) {
    factError = `financial facts currency ${[...factCurrencies].join("/")} does not match run currency ${runCurrency}`;
  }
  // NP-ALGO-001：只有 GROSS_PROFIT/REVENUE 进入现有毛利比较口径；
  // 其它已知类型作为桥接项披露；DRAFT 不参与对账。
  const factTypeOf = (fact: PilotFactInput) =>
    String(fact.factType ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const postingStatusOf = (fact: PilotFactInput) =>
    String(fact.postingStatus ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const comparable = cycleFacts.filter((fact) => {
    const type = factTypeOf(fact);
    return type === "GROSS_PROFIT" || type === "REVENUE";
  });
  const bridgeByType: Record<string, { count: number; totalMicros: string }> = {};
  const draftExcluded = comparable.filter(
    (fact) => postingStatusOf(fact) === "DRAFT",
  ).length;
  const postedComparable = comparable.filter(
    (fact) => postingStatusOf(fact) === "POSTED",
  );
  const unknownPostingStatus = comparable.filter(
    (fact) => !["DRAFT", "POSTED"].includes(postingStatusOf(fact)),
  );
  if (unknownPostingStatus.length > 0) {
    factError = "financial facts contain an unrecognised posting status";
  }
  if (postedComparable.some((fact) => !fact.orderId?.trim())) {
    factError = "POSTED GROSS_PROFIT/REVENUE financial facts are missing orderId";
  }
  if (cycleFacts.length > 0 && postedComparable.length === 0 && !factError) {
    factError =
      "no POSTED GROSS_PROFIT/REVENUE financial facts matched this cycle; DRAFT facts are excluded";
  }

  for (const fact of cycleFacts) {
    const type = factTypeOf(fact);
    if (type === "GROSS_PROFIT" || type === "REVENUE") continue;
    const key = type;
    bridgeByType[key] = bridgeByType[key] ?? { count: 0, totalMicros: "0" };
    bridgeByType[key]!.count += 1;
    try {
      bridgeByType[key]!.totalMicros = String(
        BigInt(bridgeByType[key]!.totalMicros) + amountToMicros(fact.amount),
      );
    } catch {
      /* 桥接项解析失败不阻塞毛利对账 */
    }
  }

  for (const fact of postedComparable) {
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
  } else if (!input.benchmarkRun.currency?.trim()) {
    runError = "benchmark run has no currency";
  } else if (typeof input.benchmarkRun.orderGrossProfit !== "string") {
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
  // NP-016：证据必须归属到具体 claim——claim.evidenceRefs，或证据载荷里
  // 显式 claimId。工作包里任意一条证据不再覆盖全体成员的申报。
  const evidenceClaimIds = new Map<string, string>();
  for (const node of input.evidence) {
    const claimId = node.payload?.claimId;
    if (typeof claimId === "string" && claimId.length > 0) {
      evidenceClaimIds.set(node.id, claimId);
    }
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
      claim.evidenceRefs.length > 0 ||
      [...evidenceClaimIds.values()].some((claimId) => claimId === claim.id);
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
  const evidenceById = new Map(input.evidence.map((node) => [node.id, node]));
  for (const claim of inCycle) {
    if (!claim.submittedAt) continue;
    const submittedMs = Date.parse(claim.submittedAt);
    // NP-017：只统计 claim 实际引用的证据（其它工作包证据不算补证）。
    const candidates = claim.evidenceRefs
      .map((ref) => evidenceById.get(ref))
      .filter((node): node is PilotEvidenceInput => node !== undefined)
      .filter((node) => Date.parse(node.createdAt) >= submittedMs)
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
    if (decision.reviewStartedAt) {
      // NP-018：优先使用服务端记录的复核开始时间（真实复核时长）。
      const minutes = Math.round(
        (Date.parse(decision.createdAt) - Date.parse(decision.reviewStartedAt)) /
          60_000,
      );
      if (Number.isFinite(minutes) && minutes >= 0) reviewSamples.push(minutes);
      continue;
    }
    // 兼容：无 reviewStartedAt 时用最近一份早于决定的草案（含等待，口径保守）。
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
  // NP-018：ClaimStatus 无 DISPUTED——争议以 APPEALED 计。
  const disputed = inCycle.filter((claim) => claim.status === "APPEALED").length;
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
          : "GROSS_PROFIT/REVENUE facts vs benchmark run gross profit"),
      bridgeByType,
      draftExcluded,
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
