/**
 * 报表域路由（周期/政策/团队/运营/公平性/复核一致性报表）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { AgentRuntime } from "@anari/agent-runtime";
import { summarizeAgentMetrics } from "@anari/agent-runtime";
import type { CycleReadinessReport, OperationsCoverageReport, PolicyReadinessReport } from "@anari/domain";
import { confirmationBlockers, legalGateBlockers } from "@anari/domain";
import { sha256 } from "@anari/policy-dsl";
import type { PlatformStore } from "../../platform-store.js";
import type { IncentiveStore } from "../../store-interface.js";
import { NotFoundError, ConflictError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  cycleReadinessQuerySchema,
  policyReadinessQuerySchema,
  postReconciliationAdjustmentSchema,
  workforceSubgroupDimensionSchema,
} from "@anari/contracts";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  isPrivileged,
  ownPersonId,
  policyBody,
  requireString,
  requireActorRequired,
} from "../../http-helpers.js";

/** 与 app.ts 中的 BadRequestError 同语义（协议层 400）。 */
class BadRequestError extends Error {
  readonly statusCode = 400;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}


function ratio(numerator: number, denominator: number): number {
  return denominator === 0
    ? 0
    : Math.round((numerator / denominator) * 10_000) / 10_000;
}

// ----------------------------------------------------------------------
// AUD-014 / NP-023：财务对账共享计算——GET 报表与 POST 一键调整端点共用，
// 保证"看到的差异"与"调整依据的差异"永远同源。
// ----------------------------------------------------------------------

/** 严格解析 DecimalString → 微单位 bigint（>6 位小数报错，不静默丢精度）。 */
function amountToMicros(
  value: string,
): { micros?: bigint; error?: string } {
  const match = /^-?\d+(\.\d+)?$/.exec(value.trim());
  if (!match) return { error: `invalid amount: ${value}` };
  const negative = value.trim().startsWith("-");
  const digits = value.trim().replace("-", "");
  const [intPart, fracPart = ""] = digits.split(".");
  if (fracPart.length > 6) {
    return { error: `amount has more than 6 decimal places: ${value}` };
  }
  const micros =
    BigInt(intPart ?? "0") * 1_000_000n +
    BigInt(((fracPart ?? "") + "000000").slice(0, 6));
  return { micros: negative ? -micros : micros };
}

export interface ReconciliationRowView {
  cycleId: string;
  cycleName: string;
  status: "MATCH" | "VARIANCE";
  declared: {
    facts: Array<{
      factId: string;
      sourceSystem: string;
      sourceRecordId: string;
      factType: string;
      amount: string;
      currency: string;
      qualityStatus: string;
      amountMicros: string | null;
      error?: string;
    }>;
    totalMicros: string;
    total: string | null;
  };
  calculated: {
    runId: string | null;
    runStatus: string | null;
    runMode: string | null;
    grossProfit: string | null;
    totalMicros: string;
    error?: string;
  };
  deltaMicros: string;
}

async function computeReconciliationRows(
  store: IncentiveStore,
  platformStore: PlatformStore,
  tenantId: string,
  cycles: Array<{ id: string; name: string; startsAt: string; endsAt: string }>,
): Promise<ReconciliationRowView[]> {
  const allRuns = await store.listRuns();
  const facts = await platformStore.listFinancialFacts(tenantId);
  const rows: ReconciliationRowView[] = [];
  for (const cycle of cycles) {
    const cycleRuns = allRuns.filter(
      (run) => run.cycleId === cycle.id && run.status !== "REVERSED",
    );
    // 对账基准：该周期最新一个 FORMAL 且 APPROVED/LOCKED 的运行
    // （SHADOW/草稿运行不参与对账；一次对账只对一个运行基准）。
    const eligibleRuns = cycleRuns.filter(
      (run) =>
        run.mode === "FORMAL" &&
        (run.status === "APPROVED" || run.status === "LOCKED"),
    );
    const benchmarkRun = [...eligibleRuns].sort((a, b) =>
      (b.lockedAt ?? b.calculatedAt ?? b.createdAt).localeCompare(
        a.lockedAt ?? a.calculatedAt ?? a.createdAt,
      ),
    )[0];
    // 财务事实归属：payload.cycleId 显式绑定优先；否则按事实期间与周期窗口重叠。
    const cycleFacts = facts.filter((fact) => {
      // INVALID/MISSING 质量状态的事实不参与对账（无 REJECTED 状态；INVALID 即废）。
      if (fact.qualityStatus === "INVALID" || fact.qualityStatus === "MISSING") {
        return false;
      }
      const payloadCycle = fact.payload?.cycleId;
      if (typeof payloadCycle === "string" && payloadCycle.length > 0) {
        return payloadCycle === cycle.id;
      }
      const startsBeforeEnd = !fact.periodEnd || fact.periodEnd >= cycle.startsAt;
      const endsAfterStart = !fact.periodStart || fact.periodStart <= cycle.endsAt;
      return startsBeforeEnd && endsAfterStart;
    });

    const factEntries = cycleFacts.map((fact) => {
      const parsed = amountToMicros(fact.amount);
      return {
        factId: fact.id,
        sourceSystem: fact.sourceSystem,
        sourceRecordId: fact.sourceRecordId,
        factType: fact.factType,
        amount: fact.amount,
        currency: fact.currency,
        qualityStatus: fact.qualityStatus,
        amountMicros: parsed.micros !== undefined ? String(parsed.micros) : null,
        error: parsed.error,
      };
    });
    const declaredMicros = factEntries.reduce(
      (sum, entry) => sum + (entry.amountMicros ? BigInt(entry.amountMicros) : 0n),
      0n,
    );
    let runGrossMicros = 0n;
    let runError: string | undefined;
    if (benchmarkRun) {
      const gross = benchmarkRun.inputSnapshot?.order?.grossProfit;
      if (typeof gross === "string") {
        const parsed = amountToMicros(gross);
        if (parsed.error) runError = parsed.error;
        else runGrossMicros = parsed.micros as bigint;
      } else {
        runError = "benchmark run has no grossProfit in its input snapshot";
      }
    }
    const deltaMicros = declaredMicros - runGrossMicros;
    rows.push({
      cycleId: cycle.id,
      cycleName: cycle.name,
      status: deltaMicros === 0n && !runError && factEntries.every((entry) => !entry.error)
        ? "MATCH"
        : "VARIANCE",
      declared: {
        facts: factEntries,
        totalMicros: String(declaredMicros),
        total: factEntries.some((entry) => entry.error)
          ? null
          : String(Number(declaredMicros) / 1_000_000),
      },
      calculated: {
        runId: benchmarkRun?.id ?? null,
        runStatus: benchmarkRun?.status ?? null,
        runMode: benchmarkRun?.mode ?? null,
        grossProfit: benchmarkRun?.inputSnapshot?.order?.grossProfit ?? null,
        totalMicros: String(runGrossMicros),
        error: runError,
      },
      deltaMicros: String(deltaMicros),
    });
  }
  return rows;
}

export function registerReportRoutes(deps: {
  platformStore: PlatformStore;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  fieldPoliciesFor: (
    request: FastifyRequest,
  ) => Promise<Record<string, unknown> | undefined>;
  fieldMatchContextFor: (
    request: FastifyRequest,
    policies: Record<string, unknown> | undefined,
  ) => Promise<unknown>;
  countByStatus: (items: Array<{ status: string }>) => Record<string, number>;
  redactSettlementBatchFields: (batch: unknown, viewer: unknown) => unknown;
  assertExportAllowed: (request: FastifyRequest) => void;
  assertExportDlp: (
    request: FastifyRequest,
    text: string,
    targetType: string,
    targetId: string,
    approvalRequestId?: string,
  ) => Promise<void>;
  auditExport: (
    request: FastifyRequest,
    action: string,
    objectType: string,
    objectId: string,
    detail?: string,
  ) => Promise<void>;
  exportHeaders: (
    request: FastifyRequest,
    csv: string,
    classification: string,
  ) => Record<string, string>;
  runtimeFor: (request: FastifyRequest) => AgentRuntime;
  countEvent: (event: string) => void;
  ensureApproval: (
    request: FastifyRequest,
    actionType: string,
    approvalRequestId?: string,
  ) => Promise<void>;
  consumeApprovalForAction: (
    request: FastifyRequest,
    input: {
      approvalRequestId: string;
      actionType: string;
      targetType: string;
      targetId: string;
    },
  ) => Promise<void>;
  assertNoRetroactiveAdjustment: (
    request: FastifyRequest,
    ledgerEntryId: string,
  ) => Promise<void>;
}): FastifyPluginAsync {
  const { platformStore, storeFor, fieldPoliciesFor, fieldMatchContextFor, countByStatus, redactSettlementBatchFields, assertExportAllowed, assertExportDlp, auditExport, exportHeaders, runtimeFor, countEvent, ensureApproval, consumeApprovalForAction, assertNoRetroactiveAdjustment } = deps;
  return async (app: FastifyInstance) => {
  app.get("/api/v1/settlement-batches/:id/report", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const store = storeFor(request);
    const storedBatch = await store.getSettlementBatch(idOf(request));
    // The printable report is an export: apply the same field matrix as the
    // JSON read routes instead of rendering raw salary/amount columns.
    const roles = request.authContext?.roles ?? [];
    let batch = storedBatch;
    if (!roles.includes("admin")) {
      const policies = await fieldPoliciesFor(request);
      const matchContext = await fieldMatchContextFor(request, policies);
      batch = redactSettlementBatchFields(storedBatch, {
        personId: ownPersonId(request),
        roles,
        policies,
        matchContext,
      }) as unknown as typeof storedBatch;
    }
    const active = (batch.lines ?? []).filter((line) => line.active);
    const total = active.reduce((sum, line) => sum + Number(line.amount), 0);
    const esc = (v: unknown): string =>
      String(v ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      })[char]!);
    const rows = active
      .map(
        (line) => `<tr>
          <td>${esc(line.personName ?? line.personId)}</td>
          <td>${esc(line.personCode ?? "")}</td>
          <td style="text-align:right">${esc(line.amount)}</td>
          <td>${esc(line.currency)}</td>
        </tr>`,
      )
      .join("");
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>结算单 ${esc(batch.batchNo)}</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 720px; margin: 32px auto; color: #1a1a1a; }
  h1 { font-size: 20px; } table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 8px; border-bottom: 1px solid #e5e5e5; text-align: left; font-size: 13px; }
  .meta { color: #666; font-size: 12px; } .total { font-weight: 600; }
  @media print { .no-print { display: none; } }
</style></head><body>
<h1>激励结算单</h1>
<p class="meta">批次号 ${esc(batch.batchNo)} · 周期 ${esc(batch.cycleId)} · 状态 ${esc(batch.status)} · 币种 ${esc(batch.currency)}</p>
<table>
  <thead><tr><th>人员</th><th>工号</th><th style="text-align:right">金额</th><th>币种</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td class="total" colspan="2">合计</td><td class="total" style="text-align:right">${esc(batch.totalAmount)}</td><td></td></tr></tfoot>
</table>
<p class="meta no-print">使用浏览器打印（Ctrl/Cmd+P）另存为 PDF。本单由系统确定性引擎生成，哈希与审计链可验证。</p>
</body></html>`;
    await auditExport(
      request,
      "SETTLEMENT_REPORT_VIEWED",
      "SETTLEMENT_BATCH",
      batch.id,
    );
    return reply.type("text/html; charset=utf-8").send(html);
  });

  // 周期报告 HTML（中文，打印即 PDF）。
  app.get("/api/v1/reports/cycles/:id/report", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const cycle = await storeFor(request).getEvaluationCycle(idOf(request));
    const store = storeFor(request);
    const runs = (await store.listRuns()).filter(
      (run) => run.cycleId === idOf(request),
    );
    const formalLocked = runs.filter(
      (run) => run.mode === "FORMAL" && run.status === "LOCKED",
    ).length;
    const batchRows = (await store.listSettlementBatches()).filter(
      (batch) => batch.cycleId === idOf(request),
    );
    const confirmedCount = (await store.listConfirmations()).filter(
      (confirmation) =>
        confirmation.targetType === "CALCULATION" &&
        confirmation.decision === "CONFIRMED",
    ).length;
    const readiness = {
      readyForSettlement: formalLocked > 0 && batchRows.length > 0,
      blockers: [
        ...(formalLocked === 0 ? ["没有已锁定的正式计算批次"] : []),
        ...(batchRows.length === 0 ? ["尚未创建结算批次"] : []),
      ],
      formalLocked,
      batchCount: batchRows.length,
      confirmations: confirmedCount,
    };
    const esc = (v: unknown): string =>
      String(v ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      })[char]!);
    const blockers = readiness.blockers
      .map((blocker: string) => `<li>${esc(blocker)}</li>`)
      .join("");
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>周期报告 ${esc(cycle.name)}</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 720px; margin: 32px auto; color: #1a1a1a; }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin-top: 24px; }
  .meta { color: #666; font-size: 12px; }
  ul { padding-left: 20px; } li { font-size: 13px; }
  @media print { .no-print { display: none; } }
</style></head><body>
<h1>考核周期报告</h1>
<p class="meta">${esc(cycle.name)} · ${esc(cycle.startsAt.slice(0, 10))} 至 ${esc(cycle.endsAt.slice(0, 10))} · 状态 ${esc(cycle.status)}</p>
<h2>就绪度</h2>
<p>结算就绪：<strong>${readiness.readyForSettlement ? "是" : "否"}</strong></p>
<h2>阻断项</h2>
${blockers ? `<ul>${blockers}</ul>` : "<p>无阻断项。</p>"}
<p class="meta no-print">使用浏览器打印（Ctrl/Cmd+P）另存为 PDF。生成时间 ${new Date().toISOString()}。</p>
</body></html>`;
    return reply.type("text/html; charset=utf-8").send(html);
  });
  app.get("/api/v1/reports/cycle-readiness", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = parse(cycleReadinessQuerySchema, request.query);
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const [allRuns, confirmations, allBatches, pools] = await Promise.all([
      store.listRuns(),
      store.listConfirmations(),
      store.listSettlementBatches(),
      platformStore.listBudgetPools(tenantId, query.cycleId),
    ]);
    const runs = allRuns.filter(
      (run) => run.cycleId === query.cycleId,
    );
    const relevantRuns = runs.filter((run) => run.status !== "REVERSED");
    const batches = allBatches.filter(
      (batch) => batch.cycleId === query.cycleId,
    );
    const formalPolicyIds = [
      ...new Set(
        relevantRuns
          .filter((run) => run.mode === "FORMAL")
          .map((run) => run.policyVersionId),
      ),
    ];
    const legalGates = await Promise.all(
      formalPolicyIds.map(async (policyVersionId) => {
        const gate = await store.getLegalGate(policyVersionId);
        return {
          policyVersionId,
          recorded: Boolean(gate),
          blockers: legalGateBlockers("FORMAL", gate),
        };
      }),
    );
    const gateByPolicy = new Map(
      legalGates.map((gate) => [gate.policyVersionId, gate]),
    );
    const blockers: string[] = [];
    for (const gate of legalGates) {
      for (const blocker of gate.blockers) {
        blockers.push(`POLICY:${gate.policyVersionId}:${blocker}`);
      }
    }
    const runReports = runs.map((run) => {
      const runBlockers =
        run.status === "REVERSED" ? [] : [...run.blockers];
      if (run.status !== "REVERSED" && run.mode === "FORMAL") {
        runBlockers.push(...confirmationBlockers(run, confirmations));
        runBlockers.push(
          ...(gateByPolicy.get(run.policyVersionId)?.blockers ?? []),
        );
      }
      const unique = [...new Set(runBlockers)];
      for (const blocker of unique) {
        blockers.push(`RUN:${run.id}:${blocker}`);
      }
      return {
        runId: run.id,
        status: run.status,
        mode: run.mode,
        policyVersionId: run.policyVersionId,
        blockers: unique,
      };
    });
    const formalRuns = runs.filter((run) => run.mode === "FORMAL");
    const report: CycleReadinessReport = {
      cycleId: query.cycleId,
      generatedAt: new Date().toISOString(),
      readyForSettlement:
        relevantRuns.some((run) => run.mode === "FORMAL") &&
        blockers.length === 0,
      calculations: {
        total: runs.length,
        byStatus: countByStatus(runs),
        formal: formalRuns.length,
        formalLocked: formalRuns.filter(
          (run) => run.status === "LOCKED",
        ).length,
        runs: runReports,
      },
      legalGates,
      settlement: {
        total: batches.length,
        byStatus: countByStatus(batches),
        exported: batches.filter((batch) => Boolean(batch.exportedAt))
          .length,
        acknowledged: batches.filter((batch) =>
          Boolean(batch.acknowledgedAt),
        ).length,
        batches: batches.map((batch) => ({
          batchId: batch.id,
          status: batch.status,
          kind: batch.kind,
          exportedAt: batch.exportedAt,
          acknowledgedAt: batch.acknowledgedAt,
        })),
      },
      budgets: {
        pools: pools.length,
        approved: pools.filter((pool) => pool.status === "APPROVED")
          .length,
      },
      blockers: [...new Set(blockers)],
    };
    return data(report, request);
  });

  // ------------------------------------------------------------------
  // AUD-014：财务对账下沉后端——金额用 bigint 微单位（1e6）整数运算，
  // 只取 FORMAL 且 APPROVED/LOCKED（非 REVERSED）的每周期最新运行与
  // 财务事实对账，逐笔披露；客户端不再自行拼装/浮点比较。
  // ------------------------------------------------------------------
  app.get("/api/v1/reports/finance-reconciliation", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { cycleId?: string };
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const cycles = (await store.listEvaluationCycles()).filter(
      (cycle) => !query.cycleId || cycle.id === query.cycleId,
    );
    const rows = await computeReconciliationRows(store, platformStore, tenantId, cycles);
    return data(
      {
        cycles: rows,
        note:
          "对账基准 = 每周期最新 FORMAL（APPROVED/LOCKED，非 REVERSED）运行的输入毛利；" +
          "财务事实按 payload.cycleId 或期间重叠归属；金额以 1e6 微单位整数运算。" +
          "INVALID/MISSING 质量状态的事实不参与对账。",
        generatedAt: new Date().toISOString(),
      },
      request,
    );
  });

  // ------------------------------------------------------------------
  // NP-023（B 方案）：对账差异一键生成调整分录。
  // 财务专属；差异与调整依据同源（同一 computeReconciliationRows）；
  // 目标分录必须属于该周期对账基准运行且为 LOCKED INCENTIVE；
  // 复用 adjustLedgerEntry（幂等 + AdjustmentRecord + 锁定）并落审计。
  // ------------------------------------------------------------------
  app.post(
    "/api/v1/reports/finance-reconciliation/:id/adjustment",
    async (request, reply) => {
      requireRoles(request, "finance");
      const body = parse(postReconciliationAdjustmentSchema, request.body);
      const tenantId = tenantOf(request);
      const store = storeFor(request);
      const cycle = (await store.listEvaluationCycles()).find(
        (candidate) => candidate.id === idOf(request),
      );
      if (!cycle) {
        throw new NotFoundError(`EvaluationCycle ${idOf(request)} not found`);
      }
      const rows = await computeReconciliationRows(store, platformStore, tenantId, [cycle]);
      const row = rows[0]!;
      if (row.status !== "VARIANCE") {
        throw new ConflictError(
          `RECONCILIATION_NO_VARIANCE: cycle ${cycle.id} reconciles (delta ${row.deltaMicros}); nothing to adjust`,
        );
      }
      if (!row.calculated.runId) {
        throw new ConflictError(
          `RECONCILIATION_NO_BENCHMARK_RUN: cycle ${cycle.id} has no FORMAL APPROVED/LOCKED run to anchor the adjustment`,
        );
      }
      const target = (await store.listLedger()).find(
        (entry) => entry.id === body.ledgerEntryId,
      );
      if (!target) {
        throw new NotFoundError(`LedgerEntry ${body.ledgerEntryId} not found`);
      }
      if (
        target.cycleId !== cycle.id ||
        target.calculationRunId !== row.calculated.runId
      ) {
        throw new ConflictError(
          `RECONCILIATION_SOURCE_MISMATCH: ledger entry ${target.id} does not belong to benchmark run ${row.calculated.runId}`,
        );
      }
      if (target.entryType !== "INCENTIVE") {
        throw new ConflictError(
          `RECONCILIATION_SOURCE_NOT_INCENTIVE: only INCENTIVE entries of the benchmark run can anchor a reconciliation adjustment`,
        );
      }
      if (target.status !== "LOCKED") {
        throw new ConflictError(
          `LEDGER_NOT_LOCKED: ${target.id} is ${target.status}`,
        );
      }
      await assertNoRetroactiveAdjustment(request, body.ledgerEntryId);
      await ensureApproval(request, "LEDGER_ADJUSTMENT", body.approvalRequestId);
      if (body.approvalRequestId) {
        await consumeApprovalForAction(request, {
          approvalRequestId: body.approvalRequestId,
          actionType: "LEDGER_ADJUSTMENT",
          targetType: "LEDGER_ENTRY",
          targetId: body.ledgerEntryId,
        });
      }
      const result = await store.adjustLedgerEntry(body.ledgerEntryId, {
        amount: body.amount,
        reasonCode: body.reasonCode,
        explanation: body.explanation,
        approvedBy: requireActorRequired(request, body.approvedBy, "approve"),
        idempotencyKey: body.idempotencyKey,
      });
      try {
        await store.recordAuditEvent({
          actorType: "USER",
          actorId: ownPersonId(request) ?? body.approvedBy,
          action: "RECONCILIATION_ADJUSTMENT_POSTED",
          objectType: "CALCULATION_RUN",
          objectId: row.calculated.runId,
          reason:
            `cycle=${cycle.id} deltaMicros=${row.deltaMicros} ` +
            `declared=${row.declared.totalMicros} calculated=${row.calculated.totalMicros} ` +
            `adjustment=${result.entry.id} amount=${body.amount} reason=${body.reasonCode}`,
        });
      } catch {
        /* audit is best-effort for legacy stores */
      }
      countEvent("reconciliation_adjustment");
      return reply.status(201).send(
        data({ ...result, reconciliation: row }, request),
      );
    },
  );

  // ------------------------------------------------------------------
  // AUD-015：评价覆盖率以全员 roster 为分母（不是“有草案的人才算”）。
  // decision 匹配按 person+cycle（decision 由草案审批产生，归属同周期）。
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // P1 Sync Health Dashboard：最近运行的延迟/失败率/错误分布聚合。
  // ------------------------------------------------------------------
  app.get("/api/v1/reports/sync-health", async (request) => {
    requireRoles(request, "manager", "finance", "integration");
    const query = request.query as { connectionId?: string; limit?: string };
    const runs = await platformStore.listSyncRuns(tenantOf(request), query.connectionId);
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);
    const recent = runs
      .filter((run) => run.finishedAt)
      .slice(0, limit);
    const succeeded = recent.filter((run) => run.status === "SUCCEEDED");
    const failed = recent.filter((run) => run.status === "FAILED");
    const durations = recent
      .filter((run) => run.startedAt && run.finishedAt)
      .map((run) => new Date(run.finishedAt!).getTime() - new Date(run.startedAt!).getTime());
    const avgDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
        : null;
    const errorSummaryCounts: Record<string, number> = {};
    for (const run of failed) {
      const key = (run.errorSummary ?? "unknown").slice(0, 80);
      errorSummaryCounts[key] = (errorSummaryCounts[key] ?? 0) + 1;
    }
    const report = {
      window: recent.length,
      totalRuns: recent.length,
      succeeded: succeeded.length,
      failed: failed.length,
      successRate: recent.length > 0 ? succeeded.length / recent.length : null,
      avgDurationMs,
      recordsFetched: recent.reduce(
        (sum, run) => sum + (run.recordsFetched ?? run.recordsSeen),
        0,
      ),
      recordsFailed: recent.reduce((sum, run) => sum + (run.recordsFailed ?? 0), 0),
      errorSummaryCounts,
      generatedAt: new Date().toISOString(),
    };
    return data(report, request);
  });

  app.get("/api/v1/reports/evaluation-coverage", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { cycleId?: string };
    if (!query.cycleId) {
      throw new BadRequestError("CYCLE_ID_REQUIRED", "cycleId is required");
    }
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const [roster, drafts, decisions] = await Promise.all([
      platformStore.listPersons(tenantId),
      store.listEvaluationDrafts({ cycleId: query.cycleId }),
      store.listEvaluationDecisions({ cycleId: query.cycleId }),
    ]);
    const inactive = roster.filter(
      (person) => person.employmentStatus === "INACTIVE",
    );
    const eligible = roster.filter(
      (person) => person.employmentStatus !== "INACTIVE",
    );
    const draftByPerson = new Map<string, { id: string; status: string }>();
    for (const draft of drafts) {
      const existing = draftByPerson.get(draft.personId);
      // 同人多草案：以最新状态覆盖（列表按创建序，后者覆盖前者）。
      draftByPerson.set(draft.personId, { id: draft.id, status: draft.status });
      void existing;
    }
    const decidedPersons = new Set(
      decisions.map((decision) => decision.personId),
    );
    const perPerson = eligible.map((person) => {
      const draft = draftByPerson.get(person.id);
      return {
        personId: person.id,
        displayName: person.displayName,
        draftId: draft?.id ?? null,
        draftStatus: draft?.status ?? null,
        decided: decidedPersons.has(person.id),
        state: decidedPersons.has(person.id)
          ? "DECIDED"
          : draft
            ? "DRAFT_PENDING"
            : "NO_DRAFT",
      };
    });
    const decided = perPerson.filter((entry) => entry.state === "DECIDED").length;
    return data(
      {
        cycleId: query.cycleId,
        denominator: eligible.length,
        eligibleCount: eligible.length,
        withDraft: perPerson.filter((entry) => entry.draftId).length,
        decided,
        pending: eligible.length - decided,
        excluded: inactive.map((person) => ({
          personId: person.id,
          displayName: person.displayName,
          reason: `employmentStatus=${person.employmentStatus}`,
        })),
        perPerson,
        note:
          "分母 = 在职 roster（employmentStatus != INACTIVE）；NO_DRAFT 是待办不是豁免。" +
          "decision 按 person+cycle 匹配，不跨周期。",
        generatedAt: new Date().toISOString(),
      },
      request,
    );
  });

  app.get("/api/v1/reports/policy-readiness", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = parse(policyReadinessQuerySchema, request.query);
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const [policyVersion, gate, cases, links, consultations, dpias] =
      await Promise.all([
        store.getPolicyVersion(query.policyVersionId),
        store.getLegalGate(query.policyVersionId),
        platformStore.listPolicyTestCases(
          tenantId,
          query.policyVersionId,
        ),
        platformStore.listPolicyNotices(
          tenantId,
          query.policyVersionId,
        ),
        platformStore.listConsultations(
          tenantId,
          query.policyVersionId,
        ),
        platformStore.listDpias(tenantId),
      ]);
    const noticeRows = await Promise.all(
      links.map(async (link) => {
        const overview = await platformStore.listAcknowledgements(
          tenantId,
          link.noticeId,
        );
        return { noticeId: link.noticeId, summary: overview.summary };
      }),
    );
    const activeCases = cases.filter(
      (testCase) => testCase.status === "ACTIVE",
    );
    const passed = activeCases.filter(
      (testCase) => testCase.lastRunPassed === true,
    ).length;
    const failed = activeCases.filter(
      (testCase) => testCase.lastRunPassed === false,
    ).length;
    const notRun = activeCases.filter(
      (testCase) => testCase.lastRunAt === undefined,
    ).length;
    const legalBlockers = legalGateBlockers("FORMAL", gate);
    const blockers = [...legalBlockers];
    if (activeCases.length === 0) {
      blockers.push("NO_ACTIVE_POLICY_TEST_CASES");
    }
    for (const testCase of activeCases) {
      if (!testCase.lastRunAt) {
        blockers.push(`POLICY_TEST_CASE_NOT_RUN:${testCase.caseCode}`);
      } else if (testCase.lastRunPassed === false) {
        blockers.push(`POLICY_TEST_CASE_FAILED:${testCase.caseCode}`);
      }
    }
    const incomplete = noticeRows
      .filter(
        (notice) =>
          notice.summary.acknowledgementRequired &&
          !notice.summary.complete,
      )
      .map((notice) => ({
        noticeId: notice.noticeId,
        acknowledgedCount: notice.summary.acknowledgedCount,
        personCount: notice.summary.personCount,
        pendingCount: notice.summary.pendingCount,
        declinedCount: notice.summary.declinedCount,
      }));
    for (const notice of incomplete) {
      blockers.push(`NOTICE_ACKNOWLEDGEMENTS_INCOMPLETE:${notice.noticeId}`);
    }
    const dpiaRef = gate?.dataProtectionAssessmentRef;
    const dpiaRecord = dpiaRef
      ? dpias.find((dpia) => dpia.id === dpiaRef)
      : undefined;
    if (dpiaRecord && dpiaRecord.status !== "APPROVED") {
      blockers.push(`DPIA_NOT_APPROVED:${dpiaRecord.id}`);
    }
    const concluded = consultations.filter(
      (consultation) =>
        Boolean(consultation.endedAt) &&
        consultation.outcome !== "PENDING",
    );
    const latest = [...concluded].sort((a, b) =>
      (b.endedAt ?? "").localeCompare(a.endedAt ?? ""),
    )[0];
    const report: PolicyReadinessReport = {
      policyVersionId: query.policyVersionId,
      code: policyVersion.code,
      version: policyVersion.version,
      generatedAt: new Date().toISOString(),
      ready: blockers.length === 0,
      legalGate: {
        recorded: Boolean(gate),
        approved: Boolean(gate?.policyApproved),
        blockers: legalBlockers,
      },
      tests: {
        active: activeCases.length,
        passed,
        failed,
        notRun,
        suitePassed:
          activeCases.length > 0 && failed === 0 && notRun === 0,
        cases: activeCases.map((testCase) => ({
          testCaseId: testCase.id,
          caseCode: testCase.caseCode,
          passed: testCase.lastRunPassed,
          lastRunAt: testCase.lastRunAt,
        })),
      },
      notices: {
        linked: links.length,
        acknowledgementRequired: noticeRows.filter(
          (notice) => notice.summary.acknowledgementRequired,
        ).length,
        complete: noticeRows.filter((notice) => notice.summary.complete)
          .length,
        incomplete,
      },
      consultations: {
        total: consultations.length,
        concluded: concluded.length,
        latestOutcome: latest?.outcome,
      },
      dpia: {
        referenced: Boolean(dpiaRef),
        status: dpiaRecord?.status,
        approved: dpiaRecord?.status === "APPROVED",
      },
      blockers: [...new Set(blockers)],
    };
    return data(report, request);
  });

  app.get("/api/v1/reports/team-aggregate", async (request) => {
    const query = request.query as { managerPersonId?: string };
    const tenantId = tenantOf(request);
    const people = await platformStore.listPersons(tenantId);
    const own = ownPersonId(request);
    let managerPersonId = query.managerPersonId ?? own;
    if (!isPrivileged(request)) {
      const self = own
        ? people.find((person) => person.id === own)
        : undefined;
      if (!self?.managerPersonId) {
        throw new ForbiddenError(
          "MANAGER_REQUIRED_FOR_TEAM_AGGREGATE: no manager is linked to this person",
        );
      }
      if (
        query.managerPersonId &&
        query.managerPersonId !== self.managerPersonId
      ) {
        throw new ForbiddenError(
          "an employee can only view their own team aggregate",
        );
      }
      managerPersonId = self.managerPersonId;
    }
    if (!managerPersonId) {
      throw new BadRequestError(
        "MANAGER_REQUIRED",
        "managerPersonId is required when no person is linked to the caller",
      );
    }
    const [
      decisions,
      attributionDecisions,
      claims,
      appeals,
      workPackages,
    ] = await Promise.all([
      storeFor(request).listEvaluationDecisions(),
      storeFor(request).listDecisions(),
      storeFor(request).listClaims(),
      storeFor(request).listAppeals(),
      storeFor(request).listWorkPackages(),
    ]);
    const team = people.filter(
      (person) =>
        person.managerPersonId === managerPersonId &&
        person.id !== managerPersonId,
    );
    const teamIds = new Set(team.map((person) => person.id));
    const minimumGroupSize = 3;
    if (team.length < minimumGroupSize) {
      return data(
        {
          generatedAt: new Date().toISOString(),
          managerPersonId,
          teamSize: team.length,
          suppressed: true,
          minimumGroupSize,
          note: "Team aggregates are suppressed below the minimum group size.",
        },
        request,
      );
    }
    const latestDecisionByPerson = new Map<string, (typeof decisions)[number]>();
    for (const decision of decisions) {
      if (!teamIds.has(decision.personId)) continue;
      if (decision.status !== "APPROVED") continue;
      const current = latestDecisionByPerson.get(decision.personId);
      if (
        !current ||
        decision.decisionVersion > current.decisionVersion
      ) {
        latestDecisionByPerson.set(decision.personId, decision);
      }
    }
    const latestDecisions = [...latestDecisionByPerson.values()];
    const dimensionTotals: Record<string, { total: number; count: number }> = {};
    for (const decision of latestDecisions) {
      for (const [dimension, score] of Object.entries(decision.scores)) {
        dimensionTotals[dimension] ??= { total: 0, count: 0 };
        dimensionTotals[dimension].total += score;
        dimensionTotals[dimension].count += 1;
      }
    }
    const dimensions = Object.fromEntries(
      Object.entries(dimensionTotals).map(([dimension, total]) => [
        dimension,
        Math.round((total.total / total.count) * 100) / 100,
      ]),
    );
    const teamClaims = claims.filter((claim) =>
      teamIds.has(claim.claimantPersonId),
    );
    const claimIds = new Set(teamClaims.map((claim) => claim.id));
    const confirmedClaims = attributionDecisions.filter(
      (decision) =>
        claimIds.has(decision.claimId) &&
        decision.status === "CONFIRMED",
    ).length;
    const teamAppeals = appeals.filter((appeal) =>
      teamIds.has(appeal.appellantPersonId),
    );
    const teamPackages = workPackages.filter(
      (workPackage) =>
        teamIds.has(workPackage.ownerPersonId) ||
        workPackage.members.some((member) => teamIds.has(member.personId)),
    );
    return data(
      {
        generatedAt: new Date().toISOString(),
        managerPersonId,
        teamSize: team.length,
        suppressed: false,
        minimumGroupSize,
        evaluations: {
          evaluated: latestDecisions.length,
          coverage:
            team.length === 0 ? 0 : latestDecisions.length / team.length,
          dimensions,
        },
        claims: {
          total: teamClaims.length,
          confirmed: confirmedClaims,
        },
        appeals: {
          total: teamAppeals.length,
          open: teamAppeals.filter((appeal) => appeal.status !== "CLOSED")
            .length,
        },
        workPackages: {
          total: teamPackages.length,
          accepted: teamPackages.filter(
            (workPackage) => workPackage.status === "ACCEPTED",
          ).length,
        },
      },
      request,
    );
  });

  app.get("/api/v1/reports/policy-review", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { from?: string; to?: string };
    const to = query.to ?? new Date().toISOString();
    const toMs = Date.parse(to);
    // Validate `to` before deriving the default `from`: new Date(NaN)
    // .toISOString() throws a RangeError before the guard can run.
    if (!Number.isFinite(toMs)) {
      throw new BadRequestError(
        "INVALID_REPORT_WINDOW",
        "from/to must be valid ISO dates and from <= to",
      );
    }
    const from =
      query.from ??
      new Date(toMs - 365 * 24 * 60 * 60 * 1000).toISOString();
    const fromMs = Date.parse(from);
    if (!Number.isFinite(fromMs) || fromMs > toMs) {
      throw new BadRequestError(
        "INVALID_REPORT_WINDOW",
        "from/to must be valid ISO dates and from <= to",
      );
    }
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const [
      versions,
      notices,
      appeals,
      claims,
      attributionDecisions,
      decisions,
      drafts,
      issues,
      dsars,
      dpias,
      proposals,
      modelRuns,
      trustSurveys,
      trainingRecords,
      calibrationSessions,
      subgroupAttributes,
    ] = await Promise.all([
      store.listPolicyVersions(),
      platformStore.listNotices(tenantId),
      store.listAppeals(),
      store.listClaims(),
      store.listDecisions(),
      store.listEvaluationDecisions(),
      store.listEvaluationDrafts(),
      store.listDataQualityIssues(),
      platformStore.listDsars(tenantId),
      platformStore.listDpias(tenantId),
      platformStore.listAiScoreProposals(tenantId),
      platformStore.listModelEvaluationRuns(tenantId),
      platformStore.listTrustSurveys(tenantId),
      platformStore.listManagerTrainingRecords(tenantId),
      platformStore.listCalibrationSessions(tenantId),
      platformStore.listWorkforceSubgroupAttributes(tenantId),
    ]);
    const noticeCoverage = await Promise.all(
      notices.map((notice) =>
        platformStore.listAcknowledgements(tenantId, notice.id),
      ),
    );
    const published = versions.filter((version) => {
      const timestamp = Date.parse(
        version.publishedAt ?? version.effectiveFrom ?? "",
      );
      return Number.isFinite(timestamp) && timestamp >= fromMs && timestamp <= toMs;
    });
    const inRange = (value: string | undefined): boolean => {
      if (!value) return false;
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) && timestamp >= fromMs && timestamp <= toMs;
    };
    const openAppeals = appeals.filter((appeal) => appeal.status !== "CLOSED");
    const openIssues = issues.filter(
      (issue) =>
        issue.status !== "RESOLVED" &&
        issue.status !== "WAIVED_WITH_APPROVAL",
    );
    const decidedProposals = proposals.filter(
      (proposal) => proposal.status !== "PENDING",
    );
    const latestTrustSurvey = trustSurveys
      .filter((survey) => survey.status === "CLOSED")
      .sort((a, b) =>
        (b.closedAt ?? b.updatedAt).localeCompare(
          a.closedAt ?? a.updatedAt,
        ),
      )[0];
    const trustReport = latestTrustSurvey
      ? await platformStore.getTrustSurveyReport(
          tenantId,
          latestTrustSurvey.id,
        )
      : undefined;
    const latestDecisionByClaim = new Map<
      string,
      (typeof attributionDecisions)[number]
    >();
    const decisionCountByClaim = new Map<string, number>();
    const statusesByClaim = new Map<string, Set<string>>();
    for (const decision of attributionDecisions) {
      const current = latestDecisionByClaim.get(decision.claimId);
      if (
        !current ||
        decision.decisionVersion > current.decisionVersion
      ) {
        latestDecisionByClaim.set(decision.claimId, decision);
      }
      decisionCountByClaim.set(
        decision.claimId,
        (decisionCountByClaim.get(decision.claimId) ?? 0) + 1,
      );
      const statuses =
        statusesByClaim.get(decision.claimId) ?? new Set<string>();
      statuses.add(decision.status);
      statusesByClaim.set(decision.claimId, statuses);
    }
    const claimById = new Map(claims.map((claim) => [claim.id, claim]));
    const reviewerStats = new Map<
      string,
      {
        decisions: number;
        confirmed: number;
        partiallyConfirmed: number;
        rejected: number;
        totalDays: number;
        timedDecisions: number;
      }
    >();
    for (const decision of latestDecisionByClaim.values()) {
      const stats = reviewerStats.get(decision.adjudicatorPersonId) ?? {
        decisions: 0,
        confirmed: 0,
        partiallyConfirmed: 0,
        rejected: 0,
        totalDays: 0,
        timedDecisions: 0,
      };
      stats.decisions += 1;
      if (decision.status === "CONFIRMED") stats.confirmed += 1;
      if (decision.status === "PARTIALLY_CONFIRMED") {
        stats.partiallyConfirmed += 1;
      }
      if (decision.status === "REJECTED") stats.rejected += 1;
      const submittedAt = claimById.get(decision.claimId)?.submittedAt;
      if (submittedAt) {
        const days =
          (Date.parse(decision.createdAt) - Date.parse(submittedAt)) /
          (24 * 60 * 60 * 1000);
        if (Number.isFinite(days) && days >= 0) {
          stats.totalDays += days;
          stats.timedDecisions += 1;
        }
      }
      reviewerStats.set(decision.adjudicatorPersonId, stats);
    }
    const repeatedClaims = [...decisionCountByClaim.values()].filter(
      (count) => count > 1,
    ).length;
    const changedOutcomeClaims = [...statusesByClaim.values()].filter(
      (statuses) => statuses.size > 1,
    ).length;
    const acceptedProposals = decidedProposals.filter(
      (proposal) => proposal.status === "ACCEPTED",
    ).length;
    return data(
      {
        from,
        to,
        generatedAt: new Date().toISOString(),
        policies: {
          published: published.length,
          versionsInScope: versions.length,
        },
        notices: {
          total: notices.length,
          complete: noticeCoverage.filter((coverage) => coverage.summary.complete)
            .length,
          incomplete: noticeCoverage.filter(
            (coverage) => !coverage.summary.complete,
          ).length,
        },
        appeals: {
          total: appeals.length,
          open: openAppeals.length,
          overdue: openAppeals.filter(
            (appeal) =>
              Boolean(appeal.dueAt) &&
              new Date(appeal.dueAt as string).getTime() < Date.now(),
          ).length,
          closed: appeals.filter((appeal) => appeal.status === "CLOSED").length,
          outcomes: appeals.reduce<Record<string, number>>((totals, appeal) => {
            if (appeal.resolution) {
              totals[appeal.resolution] = (totals[appeal.resolution] ?? 0) + 1;
            }
            return totals;
          }, {}),
        },
        claims: {
          total: claims.length,
          decided: decisions.filter((decision) => inRange(decision.createdAt))
            .length,
        },
        evaluations: {
          drafts: drafts.length,
          decisions: decisions.length,
        },
        reviewConsistency: {
          reviewers: [...reviewerStats.entries()].map(
            ([reviewerPersonId, stats]) => ({
              reviewerPersonId,
              decisions: stats.decisions,
              confirmedRate:
                stats.decisions === 0
                  ? 0
                  : stats.confirmed / stats.decisions,
              partiallyConfirmedRate:
                stats.decisions === 0
                  ? 0
                  : stats.partiallyConfirmed / stats.decisions,
              rejectedRate:
                stats.decisions === 0
                  ? 0
                  : stats.rejected / stats.decisions,
              averageDaysToDecision:
                stats.timedDecisions === 0
                  ? 0
                  : Math.round(
                      (stats.totalDays / stats.timedDecisions) * 10,
                    ) / 10,
            }),
          ),
          claimsDecided: latestDecisionByClaim.size,
          claimsWithMultipleDecisions: repeatedClaims,
          claimsWithChangedOutcome: changedOutcomeClaims,
          subgroupImpact: {
            available: subgroupAttributes.some(
              (attribute) =>
                !attribute.expiresAt ||
                Date.parse(attribute.expiresAt) > Date.now(),
            ),
            note:
              subgroupAttributes.length > 0
                ? "See GET /reports/subgroup-impact for suppressed aggregate metrics; protected labels are never used for individual decisions."
                : "No consent-backed subgroup labels are recorded; review by role/location remains available through stratified coverage.",
          },
        },
        aiReview: {
          total: proposals.length,
          decided: decidedProposals.length,
          accepted: acceptedProposals,
          acceptanceRate:
            decidedProposals.length === 0
              ? 0
              : acceptedProposals / decidedProposals.length,
          overrides: decidedProposals.filter(
            (proposal) => proposal.override,
          ).length,
          blindReviews: decidedProposals.filter(
            (proposal) => proposal.blindReview,
          ).length,
          harnessEvaluations: modelRuns.filter(
            (run) => run.metrics.harnessVersion === "ai-gate-v1",
          ).length,
          highRiskProposals: proposals.filter(
            (proposal) =>
              proposal.riskTier === "HIGH" ||
              proposal.riskTier === "CRITICAL",
          ).length,
          secondReviewSlaBreaches: proposals.filter(
            (proposal) => proposal.secondReviewSlaBreached,
          ).length,
          secondReviewOverdue: proposals.filter(
            (proposal) =>
              proposal.status === "PENDING" &&
              proposal.secondReviewRequired &&
              Boolean(proposal.secondReviewDueAt) &&
              Date.parse(proposal.secondReviewDueAt as string) < Date.now(),
          ).length,
        },
        dataQuality: {
          total: issues.length,
          open: openIssues.length,
          overdue: openIssues.filter(
            (issue) =>
              Boolean(issue.dueAt) &&
              new Date(issue.dueAt as string).getTime() < Date.now(),
          ).length,
          escalated: issues.filter((issue) => Boolean(issue.escalatedAt)).length,
        },
        privacy: {
          dsars: dsars.length,
          openDsars: dsars.filter((request) => request.status === "OPEN").length,
          dpias: dpias.length,
          approvedDpias: dpias.filter((record) => record.status === "APPROVED")
            .length,
        },
        managerEnablement: {
          trainingRecords: trainingRecords.length,
          calibrationSessions: calibrationSessions.length,
        },
        trustSurvey: trustReport
          ? {
              available: true,
              surveyId: trustReport.survey.id,
              period: trustReport.survey.period,
              responseCount: trustReport.responseCount,
              dimensions: trustReport.dimensions,
              baseline: trustReport.baseline,
            }
          : {
              available: false,
              note: "Employee trust/procedural-fairness survey is not captured yet.",
            },
        subgroupImpact: {
          available: subgroupAttributes.some(
            (attribute) =>
              !attribute.expiresAt ||
              Date.parse(attribute.expiresAt) > Date.now(),
          ),
          note:
            subgroupAttributes.length > 0
              ? "See GET /reports/subgroup-impact for suppressed aggregate metrics; protected labels are never used for individual decisions."
              : "No consent-backed subgroup labels are recorded; review by role/location remains available through stratified coverage.",
        },
      },
      request,
    );
  });

  app.get("/api/v1/reports/operations-coverage", async (request) => {
    requireRoles(request, "manager", "finance");
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const [
      workPackages,
      claims,
      evidence,
      deliverables,
      approvals,
      dsars,
      dataQualityIssues,
      appeals,
      runs,
      decisions,
      confirmations,
      payrollRuns,
    ] = await Promise.all([
      store.listWorkPackages(),
      store.listClaims(),
      store.listEvidence(),
      platformStore.listDeliverables(tenantId),
      platformStore.listApprovalRequests(tenantId),
      platformStore.listDsars(tenantId),
      store.listDataQualityIssues(),
      store.listAppeals(),
      store.listRuns(),
      store.listDecisions(),
      store.listConfirmations(),
      platformStore.listPayrollRuns(tenantId),
    ]);
    const acceptedPackages = workPackages.filter(
      (workPackage) => workPackage.status === "ACCEPTED",
    );
    const workPackageEvidence = evidence.filter(
      (node) => node.subjectType === "WORK_PACKAGE",
    );
    const evidenceSubjects = new Set(
      workPackageEvidence.map((node) => node.subjectId),
    );
    const packagesWithEvidence = acceptedPackages.filter((workPackage) =>
      evidenceSubjects.has(workPackage.id),
    ).length;
    const orderTypeByPackage = new Map<string, string>();
    for (const run of runs) {
      for (const participant of run.inputSnapshot.participants) {
        if (!orderTypeByPackage.has(participant.workPackageId)) {
          orderTypeByPackage.set(
            participant.workPackageId,
            run.inputSnapshot.order.projectType ?? "UNSPECIFIED",
          );
        }
      }
    }
    const responsibilityCoverage = new Map<
      string,
      { total: number; withEvidence: number }
    >();
    const orderTypeCoverage = new Map<
      string,
      { total: number; withEvidence: number }
    >();
    const packageTypeCoverage = new Map<
      string,
      { total: number; withEvidence: number }
    >();
    for (const workPackage of acceptedPackages) {
      const hasEvidence = evidenceSubjects.has(workPackage.id);
      const roles = new Set(
        workPackage.members.map((member) => member.responsibilityCode),
      );
      for (const role of roles) {
        const current = responsibilityCoverage.get(role) ?? {
          total: 0,
          withEvidence: 0,
        };
        current.total += 1;
        if (hasEvidence) current.withEvidence += 1;
        responsibilityCoverage.set(role, current);
      }
      const orderType = orderTypeByPackage.get(workPackage.id) ?? "UNLINKED";
      const currentOrder = orderTypeCoverage.get(orderType) ?? {
        total: 0,
        withEvidence: 0,
      };
      currentOrder.total += 1;
      if (hasEvidence) currentOrder.withEvidence += 1;
      orderTypeCoverage.set(orderType, currentOrder);
      const packageType = workPackage.packageType ?? "UNSPECIFIED";
      const currentPackage = packageTypeCoverage.get(packageType) ?? {
        total: 0,
        withEvidence: 0,
      };
      currentPackage.total += 1;
      if (hasEvidence) currentPackage.withEvidence += 1;
      packageTypeCoverage.set(packageType, currentPackage);
    }
    // Monthly trend uses acceptance time (updatedAt when ACCEPTED) as the
    // period bucket so the series can be compared across cycles over time.
    const coverageTrend = new Map<
      string,
      { total: number; withEvidence: number }
    >();
    const coverageTrendByPackageType = new Map<
      string,
      Map<string, { total: number; withEvidence: number }>
    >();
    for (const workPackage of acceptedPackages) {
      const acceptedAt = new Date(workPackage.updatedAt);
      if (Number.isNaN(acceptedAt.getTime())) continue;
      const period = acceptedAt.toISOString().slice(0, 7);
      const hasEvidence = evidenceSubjects.has(workPackage.id);
      const periodTotals = coverageTrend.get(period) ?? {
        total: 0,
        withEvidence: 0,
      };
      periodTotals.total += 1;
      if (hasEvidence) periodTotals.withEvidence += 1;
      coverageTrend.set(period, periodTotals);
      const packageType = workPackage.packageType ?? "UNSPECIFIED";
      const byPeriod =
        coverageTrendByPackageType.get(packageType) ??
        new Map<string, { total: number; withEvidence: number }>();
      const typeTotals = byPeriod.get(period) ?? {
        total: 0,
        withEvidence: 0,
      };
      typeTotals.total += 1;
      if (hasEvidence) typeTotals.withEvidence += 1;
      byPeriod.set(period, typeTotals);
      coverageTrendByPackageType.set(packageType, byPeriod);
    }
    const openAppeals = appeals.filter(
      (appeal) => appeal.status !== "CLOSED",
    );
    const overdueAppeals = openAppeals.filter(
      (appeal) =>
        Boolean(appeal.dueAt) &&
        new Date(appeal.dueAt as string).getTime() < Date.now(),
    ).length;
    const confirmedClaims = claims.filter(
      (claim) =>
        claim.status === "ACCEPTED" ||
        claim.status === "PARTIALLY_ACCEPTED",
    ).length;
    const rejectedClaims = claims.filter(
      (claim) => claim.status === "REJECTED",
    ).length;
    const pendingClaims = claims.filter(
      (claim) =>
        ![
          "ACCEPTED",
          "PARTIALLY_ACCEPTED",
          "REJECTED",
          "WITHDRAWN",
        ].includes(claim.status),
    ).length;
    const openDataQualityIssues = dataQualityIssues.filter(
      (issue) =>
        issue.status !== "RESOLVED" &&
        issue.status !== "WAIVED_WITH_APPROVAL",
    );
    const nowMs = Date.now();
    const overdueDataQualityIssues = openDataQualityIssues.filter(
      (issue) =>
        Boolean(issue.dueAt) &&
        new Date(issue.dueAt as string).getTime() < nowMs,
    ).length;
    const escalatedDataQualityIssues = dataQualityIssues.filter(
      (issue) => Boolean(issue.escalatedAt),
    ).length;
    const acceptanceHours = acceptedPackages
      .map(
        (workPackage) =>
          (Date.parse(workPackage.updatedAt) -
            Date.parse(workPackage.createdAt)) /
          (60 * 60 * 1000),
      )
      .filter((value) => Number.isFinite(value) && value >= 0);
    const latestDecisionByClaim = new Map<
      string,
      (typeof decisions)[number]
    >();
    for (const decision of decisions) {
      const current = latestDecisionByClaim.get(decision.claimId);
      if (
        !current ||
        decision.decisionVersion > current.decisionVersion
      ) {
        latestDecisionByClaim.set(decision.claimId, decision);
      }
    }
    const workPackageById = new Map(
      workPackages.map((workPackage) => [workPackage.id, workPackage]),
    );
    const rolesByPerson = new Map<string, Set<string>>();
    const addPersonRole = (personId: string, role: string): void => {
      const roles = rolesByPerson.get(personId) ?? new Set<string>();
      roles.add(role);
      rolesByPerson.set(personId, roles);
    };
    for (const workPackage of workPackages) {
      for (const member of workPackage.members) {
        addPersonRole(member.personId, member.responsibilityCode);
      }
      addPersonRole(workPackage.ownerPersonId, "OWNER");
    }
    const rolesOfPerson = (personId: string): string[] => {
      const roles = rolesByPerson.get(personId);
      return roles && roles.size > 0 ? [...roles] : ["UNKNOWN"];
    };
    const acceptanceHoursByRole = new Map<string, number[]>();
    for (const workPackage of acceptedPackages) {
      const hours =
        (Date.parse(workPackage.updatedAt) -
          Date.parse(workPackage.createdAt)) /
        (60 * 60 * 1000);
      if (!Number.isFinite(hours) || hours < 0) continue;
      const roles = new Set(
        workPackage.members.map((member) => member.responsibilityCode),
      );
      if (roles.size === 0) roles.add("OWNER");
      for (const role of roles) {
        const values = acceptanceHoursByRole.get(role) ?? [];
        values.push(hours);
        acceptanceHoursByRole.set(role, values);
      }
    }
    const claimDecisionHoursByRole = new Map<string, number[]>();
    for (const claim of claims) {
      const decision = latestDecisionByClaim.get(claim.id);
      if (!decision) continue;
      const hours =
        (Date.parse(decision.createdAt) -
          Date.parse(claim.submittedAt ?? claim.createdAt)) /
        (60 * 60 * 1000);
      if (!Number.isFinite(hours) || hours < 0) continue;
      const workPackage = workPackageById.get(claim.workPackageId);
      const role =
        workPackage?.members.find(
          (member) => member.personId === claim.claimantPersonId,
        )?.responsibilityCode ??
        (workPackage?.ownerPersonId === claim.claimantPersonId
          ? "OWNER"
          : "UNKNOWN");
      const values = claimDecisionHoursByRole.get(role) ?? [];
      values.push(hours);
      claimDecisionHoursByRole.set(role, values);
    }
    const claimDecisionHours = claims
      .map((claim) => {
        const decision = latestDecisionByClaim.get(claim.id);
        if (!decision) return undefined;
        const from = Date.parse(claim.submittedAt ?? claim.createdAt);
        const to = Date.parse(decision.createdAt);
        return (to - from) / (60 * 60 * 1000);
      })
      .filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0,
      );
    const runById = new Map(runs.map((run) => [run.id, run]));
    const confirmationHours = confirmations
      .map((confirmation) => {
        if (confirmation.targetType !== "CALCULATION") return undefined;
        const run = runById.get(confirmation.targetId);
        if (!run) return undefined;
        const from = Date.parse(run.calculatedAt ?? run.createdAt);
        const to = Date.parse(
          confirmation.confirmedAt ??
            confirmation.objectedAt ??
            confirmation.createdAt,
        );
        return (to - from) / (60 * 60 * 1000);
      })
      .filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0,
      );
    const payrollApprovalHours = payrollRuns
      .filter((run) => Boolean(run.approvedAt))
      .map(
        (run) =>
          (Date.parse(run.approvedAt as string) -
            Date.parse(run.createdAt)) /
          (60 * 60 * 1000),
      )
      .filter((value) => Number.isFinite(value) && value >= 0);
    const appealResolutionHours = appeals
      .filter((appeal) => Boolean(appeal.resolvedAt))
      .map(
        (appeal) =>
          (Date.parse(appeal.resolvedAt as string) -
            Date.parse(appeal.createdAt)) /
          (60 * 60 * 1000),
      )
      .filter((value) => Number.isFinite(value) && value >= 0);
    const pushByRole = (
      target: Map<string, number[]>,
      roles: Iterable<string>,
      hours: number,
    ): void => {
      if (!Number.isFinite(hours) || hours < 0) return;
      for (const role of new Set(roles)) {
        const values = target.get(role) ?? [];
        values.push(hours);
        target.set(role, values);
      }
    };
    const confirmationHoursByRole = new Map<string, number[]>();
    for (const confirmation of confirmations) {
      if (confirmation.targetType !== "CALCULATION") continue;
      const run = runById.get(confirmation.targetId);
      if (!run) continue;
      pushByRole(
        confirmationHoursByRole,
        rolesOfPerson(confirmation.personId),
        (Date.parse(
          confirmation.confirmedAt ??
            confirmation.objectedAt ??
            confirmation.createdAt,
        ) -
          Date.parse(run.calculatedAt ?? run.createdAt)) /
          (60 * 60 * 1000),
      );
    }
    const payrollApprovalHoursByRole = new Map<string, number[]>();
    for (const run of payrollRuns) {
      if (!run.approvedAt) continue;
      const hours =
        (Date.parse(run.approvedAt) - Date.parse(run.createdAt)) /
        (60 * 60 * 1000);
      const roles = new Set<string>();
      for (const line of run.lines ?? []) {
        rolesOfPerson(line.personId).forEach((role) => roles.add(role));
      }
      pushByRole(payrollApprovalHoursByRole, roles, hours);
    }
    const appealResolutionHoursByRole = new Map<string, number[]>();
    for (const appeal of appeals) {
      if (!appeal.resolvedAt) continue;
      pushByRole(
        appealResolutionHoursByRole,
        rolesOfPerson(appeal.appellantPersonId),
        (Date.parse(appeal.resolvedAt) - Date.parse(appeal.createdAt)) /
          (60 * 60 * 1000),
      );
    }
    const average = (values: number[]): number =>
      values.length === 0
        ? 0
        : Math.round(
            (values.reduce((sum, value) => sum + value, 0) /
              values.length) *
              10,
          ) / 10;
    const responsibilityCycleRoles = new Set([
      ...acceptanceHoursByRole.keys(),
      ...claimDecisionHoursByRole.keys(),
      ...confirmationHoursByRole.keys(),
      ...payrollApprovalHoursByRole.keys(),
      ...appealResolutionHoursByRole.keys(),
    ]);
    const cycleTimesByResponsibility = [...responsibilityCycleRoles]
      .sort()
      .map((responsibilityCode) => {
        const acceptance = acceptanceHoursByRole.get(responsibilityCode) ?? [];
        const claimHours =
          claimDecisionHoursByRole.get(responsibilityCode) ?? [];
        const confirmationHoursForRole =
          confirmationHoursByRole.get(responsibilityCode) ?? [];
        const payrollHoursForRole =
          payrollApprovalHoursByRole.get(responsibilityCode) ?? [];
        const appealHoursForRole =
          appealResolutionHoursByRole.get(responsibilityCode) ?? [];
        return {
          responsibilityCode,
          workPackageAcceptanceHours: average(acceptance),
          workPackageSamples: acceptance.length,
          claimDecisionHours: average(claimHours),
          claimSamples: claimHours.length,
          confirmationHours: average(confirmationHoursForRole),
          confirmationSamples: confirmationHoursForRole.length,
          payrollApprovalHours: average(payrollHoursForRole),
          payrollSamples: payrollHoursForRole.length,
          appealResolutionHours: average(appealHoursForRole),
          appealSamples: appealHoursForRole.length,
        };
      });
    const report: OperationsCoverageReport = {
      generatedAt: new Date().toISOString(),
      workPackages: {
        total: workPackages.length,
        accepted: acceptedPackages.length,
        withEvidence: packagesWithEvidence,
        evidenceCoverageRate: ratio(
          packagesWithEvidence,
          acceptedPackages.length,
        ),
        coverageByResponsibility: [...responsibilityCoverage.entries()]
          .map(([responsibilityCode, value]) => ({
            responsibilityCode,
            total: value.total,
            withEvidence: value.withEvidence,
            coverageRate: ratio(value.withEvidence, value.total),
          }))
          .sort((a, b) =>
            a.responsibilityCode.localeCompare(b.responsibilityCode),
          ),
        coverageByOrderType: [...orderTypeCoverage.entries()]
          .map(([orderType, value]) => ({
            orderType,
            total: value.total,
            withEvidence: value.withEvidence,
            coverageRate: ratio(value.withEvidence, value.total),
          }))
          .sort((a, b) => a.orderType.localeCompare(b.orderType)),
        coverageByPackageType: [...packageTypeCoverage.entries()]
          .map(([packageType, value]) => ({
            packageType,
            total: value.total,
            withEvidence: value.withEvidence,
            coverageRate: ratio(value.withEvidence, value.total),
          }))
          .sort((a, b) => a.packageType.localeCompare(b.packageType)),
        coverageTrend: [...coverageTrend.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([period, value]) => ({
            period,
            total: value.total,
            withEvidence: value.withEvidence,
            coverageRate: ratio(value.withEvidence, value.total),
          })),
        coverageTrendByPackageType: [
          ...coverageTrendByPackageType.entries(),
        ]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([packageType, periods]) => ({
            packageType,
            periods: [...periods.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([period, value]) => ({
                period,
                total: value.total,
                withEvidence: value.withEvidence,
                coverageRate: ratio(value.withEvidence, value.total),
              })),
          })),
      },
      claims: {
        total: claims.length,
        confirmed: confirmedClaims,
        pending: pendingClaims,
        rejected: rejectedClaims,
      },
      evidence: {
        total: evidence.length,
        workPackage: workPackageEvidence.length,
      },
      deliverables: {
        total: deliverables.length,
        pendingAcceptance: deliverables.filter(
          (deliverable) => deliverable.status === "SUBMITTED",
        ).length,
        accepted: deliverables.filter(
          (deliverable) => deliverable.status === "ACCEPTED",
        ).length,
      },
      approvals: {
        total: approvals.length,
        pending: approvals.filter(
          (approval) => approval.status === "PENDING",
        ).length,
        approved: approvals.filter(
          (approval) => approval.status === "APPROVED",
        ).length,
        consumed: approvals.filter((approval) =>
          Boolean(approval.consumedAt),
        ).length,
      },
      dataQuality: {
        total: dataQualityIssues.length,
        open: openDataQualityIssues.length,
        overdue: overdueDataQualityIssues,
        escalated: escalatedDataQualityIssues,
      },
      dsars: {
        total: dsars.length,
        open: dsars.filter((request) => request.status === "OPEN").length,
        resolved: dsars.filter(
          (request) => request.status === "RESOLVED",
        ).length,
        rejected: dsars.filter(
          (request) => request.status === "REJECTED",
        ).length,
      },
      appeals: {
        total: appeals.length,
        open: openAppeals.length,
        overdue: overdueAppeals,
        closed: appeals.filter((appeal) => appeal.status === "CLOSED").length,
        appealRate: ratio(appeals.length, Math.max(claims.length, 1)),
      },
      cycleTimes: {
        workPackageAcceptanceHours: average(acceptanceHours),
        claimDecisionHours: average(claimDecisionHours),
        confirmationHours: average(confirmationHours),
        payrollApprovalHours: average(payrollApprovalHours),
        appealResolutionHours: average(appealResolutionHours),
        byResponsibility: cycleTimesByResponsibility,
      },
    };
    return data(report, request);
  });

  app.get("/api/v1/reports/success-metrics", async (request) => {
    requireRoles(request, "manager", "finance");
    const store = storeFor(request);
    const [
      workPackages,
      claims,
      evidence,
      appeals,
      decisions,
      runs,
      batches,
      dataQualityIssues,
      persons,
      trustSurveys,
    ] = await Promise.all([
      store.listWorkPackages(),
      store.listClaims(),
      store.listEvidence(),
      store.listAppeals(),
      store.listDecisions(),
      store.listRuns(),
      store.listSettlementBatches(),
      store.listDataQualityIssues(),
      platformStore.listPersons(tenantOf(request)),
      platformStore.listTrustSurveys(tenantOf(request)),
    ]);
    const accepted = workPackages.filter(
      (workPackage) => workPackage.status === "ACCEPTED",
    );
    const evidenceSubjects = new Set(
      evidence
        .filter((node) => node.subjectType === "WORK_PACKAGE")
        .map((node) => node.subjectId),
    );
    const withEvidence = accepted.filter((workPackage) =>
      evidenceSubjects.has(workPackage.id),
    ).length;
    const coverage =
      accepted.length === 0 ? 0 : withEvidence / accepted.length;
    const latestDecisionByClaim = new Map<
      string,
      (typeof decisions)[number]
    >();
    for (const decision of decisions) {
      const current = latestDecisionByClaim.get(decision.claimId);
      if (!current || decision.decisionVersion > current.decisionVersion) {
        latestDecisionByClaim.set(decision.claimId, decision);
      }
    }
    const decisionHours = claims
      .map((claim) => {
        const decision = latestDecisionByClaim.get(claim.id);
        if (!decision) return undefined;
        return (
          (Date.parse(decision.createdAt) -
            Date.parse(claim.submittedAt ?? claim.createdAt)) /
          (60 * 60 * 1000)
        );
      })
      .filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0,
      );
    const managerIds = new Set(
      persons
        .map((person) => person.managerPersonId)
        .filter((value): value is string => Boolean(value)),
    );
    const managerDecisionHours = claims
      .map((claim) => {
        const decision = latestDecisionByClaim.get(claim.id);
        if (!decision || !managerIds.has(decision.adjudicatorPersonId)) {
          return undefined;
        }
        return (
          (Date.parse(decision.createdAt) -
            Date.parse(claim.submittedAt ?? claim.createdAt)) /
          (60 * 60 * 1000)
        );
      })
      .filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0,
      );
    const managerReviewHours =
      managerDecisionHours.length === 0
        ? null
        : Math.round(
            (managerDecisionHours.reduce((sum, value) => sum + value, 0) /
              managerDecisionHours.length) *
              10,
          ) / 10;
    const evidenceSupplementMinutes = dataQualityIssues
      .filter(
        (issue) =>
          /EVIDENCE/i.test(issue.issueCode) && Boolean(issue.resolvedAt),
      )
      .map(
        (issue) =>
          (Date.parse(issue.resolvedAt as string) -
            Date.parse(issue.createdAt)) /
          (60 * 1000),
      )
      .filter((value) => Number.isFinite(value) && value >= 0);
    const evidenceSupplementAvg =
      evidenceSupplementMinutes.length === 0
        ? null
        : Math.round(
            (evidenceSupplementMinutes.reduce((sum, value) => sum + value, 0) /
              evidenceSupplementMinutes.length) *
              10,
          ) / 10;
    const latestClosedSurvey = trustSurveys
      .filter((survey) => survey.status === "CLOSED")
      .sort((a, b) =>
        (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt),
      )[0];
    const trustReport = latestClosedSurvey
      ? await platformStore.getTrustSurveyReport(
          tenantOf(request),
          latestClosedSurvey.id,
        )
      : undefined;
    const meanOf = (values: Record<string, number>): number | null => {
      const numbers = Object.values(values);
      if (numbers.length === 0) return null;
      return (
        Math.round(
          (numbers.reduce((sum, value) => sum + value, 0) / numbers.length) *
            100,
        ) / 100
      );
    };
    const trustCurrent = trustReport ? meanOf(trustReport.dimensions) : null;
    const trustBaseline = trustReport?.baseline
      ? meanOf(trustReport.baseline.dimensions)
      : null;
    const disputeRate =
      claims.length === 0 ? 0 : appeals.length / claims.length;
    const reconciliationDifferences =
      batches.filter((batch) => batch.status === "ADJUSTMENT_REQUIRED")
        .length +
      runs.filter((run) => run.status === "RECONCILIATION_REQUIRED")
        .length;
    const metrics = [
      {
        id: "EVIDENCE_COVERAGE",
        label: "证据覆盖率（≥70%）",
        value: Math.round(coverage * 10000) / 10000,
        unit: "RATIO",
        target: 0.7,
        comparator: "GTE",
        status: coverage >= 0.7 ? "PASS" : "FAIL",
        note: "Accepted work packages with at least one work-package evidence node.",
      },
      {
        id: "MANAGER_REVIEW_HOURS",
        label: "经理复核时间（≤2 小时）",
        value: managerReviewHours,
        unit: "HOURS",
        target: 2,
        comparator: "LTE",
        status:
          managerReviewHours === null
            ? "UNAVAILABLE"
            : managerReviewHours <= 2
              ? "PASS"
              : "FAIL",
        note: "Claims whose latest decision was issued by a person with direct reports; submission to decision.",
      },
      {
        id: "CONTRIBUTION_DISPUTE_RATE",
        label: "贡献争议率（<10%）",
        value: Math.round(disputeRate * 10000) / 10000,
        unit: "RATIO",
        target: 0.1,
        comparator: "LT",
        status: disputeRate < 0.1 ? "PASS" : "FAIL",
        note: "Appeals divided by claims; target is below 10%.",
      },
      {
        id: "RECONCILIATION_DIFFERENCES",
        label: "财务对账差异（=0）",
        value: reconciliationDifferences,
        unit: "COUNT",
        target: 0,
        comparator: "EQ",
        status: reconciliationDifferences === 0 ? "PASS" : "FAIL",
        note: "Settlement batches in ADJUSTMENT_REQUIRED plus calculation runs in RECONCILIATION_REQUIRED.",
      },
      {
        id: "EMPLOYEE_EVIDENCE_MINUTES",
        label: "员工补证时间（≤30 分钟）",
        value: evidenceSupplementAvg,
        unit: "MINUTES",
        target: 30,
        comparator: "LTE",
        status:
          evidenceSupplementAvg === null
            ? "UNAVAILABLE"
            : evidenceSupplementAvg <= 30
              ? "PASS"
              : "FAIL",
        note: "Proxy: resolved data-quality issues about evidence, from issue creation to resolution. No session or activity tracking is used.",
      },
      {
        id: "TRUST_VS_BASELINE",
        label: "员工信任对比基线",
        value: trustCurrent,
        unit: "RATIO",
        target: trustBaseline ?? 0,
        comparator: "GTE",
        status:
          trustCurrent === null || trustBaseline === null
            ? "UNAVAILABLE"
            : trustCurrent >= trustBaseline
              ? "PASS"
              : "FAIL",
        note: "Mean of the latest closed trust-survey dimensions versus the previous closed survey with the same code.",
      },
    ];
    return data(
      {
        generatedAt: new Date().toISOString(),
        overall: metrics.some((metric) => metric.status === "FAIL")
          ? "FAIL"
          : metrics.some((metric) => metric.status === "UNAVAILABLE")
            ? "PARTIAL"
            : "PASS",
        metrics,
      },
      request,
    );
  });

  app.get("/api/v1/reports/agent-metrics", async (request) => {
    requireRoles(request, "manager", "finance");
    const store = storeFor(request);
    const tasks = await runtimeFor(request).list();
    // AUD-023：外部指标从持久化事实自动计算——
    // humanLabels 来自 agent_feedback_labels；aiOffBaseline 来自最新基线记录；
    // cost 需要"单价目录"（哪些还没配置就保持 unavailable，绝不冒充实时值）。
    const [labels, baselines, usage] = await Promise.all([
      store.listAgentFeedbackLabels(),
      store.latestAgentAiOffBaseline(),
      store.listAgentModelUsage(),
    ]);
    const decided = labels.filter(
      (entry) =>
        entry.label === "FALSE_POSITIVE" || entry.label === "CONFIRMED_POSITIVE",
    );
    const external = {
      humanLabels:
        decided.length > 0
          ? {
              reviewed: decided.length,
              falsePositives: decided.filter(
                (entry) => entry.label === "FALSE_POSITIVE",
              ).length,
            }
          : undefined,
      aiOffBaseline: baselines
        ? {
            completionRate: Number(baselines.completionRate),
            sampleSize: baselines.sampleSize,
          }
        : undefined,
      // token 用量是持久化事实；换算成成本需要单价目录（未提供则不可测）。
      usage: usage.map((entry) => ({
        provider: entry.provider,
        model: entry.model,
        requests: entry.requests,
        promptTokens: entry.promptTokens,
        completionTokens: entry.completionTokens,
      })),
    };
    const report = summarizeAgentMetrics(tasks, new Date().toISOString(), {
      humanLabels: external.humanLabels,
      aiOffBaseline: external.aiOffBaseline,
    });
    return data(
      {
        ...report,
        modelUsage: external.usage,
        note:
          "Metrics computed from persisted facts where available; metrics " +
          "without stored labels/baselines remain explicitly unavailable " +
          "(see availability[]). token 用量为持久化事实，costPerClosedLoop " +
          "需要单价目录（未配置则保持 unavailable）。",
      },
      request,
    );
  });
  app.get("/api/v1/reports/appeal-stats", async (request) => {
    const tenantId = tenantOf(request);
    const [appeals, claims, commitment] = await Promise.all([
      storeFor(request).listAppeals(),
      storeFor(request).listClaims(),
      platformStore.getActiveFairnessCommitment(tenantId),
    ]);
    const closed = appeals.filter((appeal) => appeal.status === "CLOSED");
    const durations = closed
      .map((appeal) => {
        if (!appeal.resolvedAt) return undefined;
        return (
          (Date.parse(appeal.resolvedAt) - Date.parse(appeal.createdAt)) /
          (24 * 60 * 60 * 1000)
        );
      })
      .filter((value): value is number => Number.isFinite(value));
    const resolutions = closed.reduce<Record<string, number>>(
      (totals, appeal) => {
        const key = appeal.resolution ?? "UNSPECIFIED";
        totals[key] = (totals[key] ?? 0) + 1;
        return totals;
      },
      {},
    );
    return data(
      {
        generatedAt: new Date().toISOString(),
        commitment: commitment
          ? {
              id: commitment.id,
              version: commitment.version,
              statement: commitment.statement,
              ownerPersonId: commitment.ownerPersonId,
              channels: commitment.channels,
              publishedAt: commitment.publishedAt,
            }
          : null,
        appeals: {
          total: appeals.length,
          open: appeals.filter((appeal) => appeal.status !== "CLOSED").length,
          closed: closed.length,
          overdue: appeals.filter(
            (appeal) =>
              appeal.status !== "CLOSED" &&
              Boolean(appeal.dueAt) &&
              new Date(appeal.dueAt as string).getTime() < Date.now(),
          ).length,
          resolutions,
          averageResolutionDays:
            durations.length === 0
              ? 0
              : Math.round(
                  (durations.reduce((sum, value) => sum + value, 0) /
                    durations.length) *
                    10,
                ) / 10,
          appealRate: claims.length === 0 ? 0 : appeals.length / claims.length,
        },
      },
      request,
    );
  });
  app.get("/api/v1/reports/subgroup-impact", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      cycleId?: string;
      dimension?: string;
    };
    const dimension = query.dimension
      ? workforceSubgroupDimensionSchema.safeParse(query.dimension)
      : undefined;
    if (dimension && !dimension.success) {
      throw new BadRequestError(
        "INVALID_SUBGROUP_DIMENSION",
        `Unknown subgroup dimension ${query.dimension}`,
      );
    }
    const tenantId = tenantOf(request);
    const allRuns = await storeFor(request).listRuns();
    const selectedCycleId =
      query.cycleId ??
      [...allRuns].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )[0]?.cycleId;
    const attributes = (
      await platformStore.listWorkforceSubgroupAttributes(tenantId, {
        dimension: dimension?.data,
      })
    ).filter(
      (attribute) =>
        !attribute.expiresAt || Date.parse(attribute.expiresAt) > Date.now(),
    );
    if (!selectedCycleId || attributes.length === 0) {
      return data(
        {
          generatedAt: new Date().toISOString(),
          cycleId: selectedCycleId,
          available: false,
          thresholds: {
            minimumQuantitativeGroupSize: 30,
            minimumReportableGroupSize: 10,
            adverseImpactRatioThreshold: 0.8,
          },
          note:
            attributes.length === 0
              ? "No consent-backed subgroup labels are recorded; no protected-attribute analysis is produced."
              : "A cycle with calculation or evaluation outcomes is required.",
          dimensions: {},
        },
        request,
      );
    }
    const cycleRuns = allRuns
      .filter((run) => run.cycleId === selectedCycleId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latestRun = cycleRuns[0];
    const proposals = await platformStore.listAiScoreProposals(tenantId, {
      cycleId: selectedCycleId,
    });
    const incentives = new Map<string, number>();
    for (const line of latestRun?.lines ?? []) {
      const amount = Number(line.roundedAmount);
      if (Number.isFinite(amount)) {
        incentives.set(
          line.personId,
          (incentives.get(line.personId) ?? 0) + amount,
        );
      }
    }
    const proposalScores = new Map<string, number[]>();
    for (const proposal of proposals) {
      const scores = proposalScores.get(proposal.personId) ?? [];
      scores.push(proposal.overallScore);
      proposalScores.set(proposal.personId, scores);
    }
    const attributesByDimension = new Map<
      string,
      Map<string, typeof attributes>
    >();
    for (const attribute of attributes) {
      const groups =
        attributesByDimension.get(attribute.dimension) ??
        new Map<string, typeof attributes>();
      const group = groups.get(attribute.value) ?? [];
      group.push(attribute);
      groups.set(attribute.value, group);
      attributesByDimension.set(attribute.dimension, groups);
    }
    const dimensions: Record<string, unknown> = {};
    for (const [dimensionKey, groups] of attributesByDimension) {
      let suppressedGroups = 0;
      const reported = [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([value, members]) => {
          if (members.length < 10) {
            suppressedGroups += 1;
            return undefined;
          }
          if (members.length < 30) {
            return {
              value,
              headcount: members.length,
              quantitative: false,
              qualitativeReviewRequired: true,
              metrics: null,
              flags: ["SMALL_SAMPLE_QUALITATIVE"],
            };
          }
          if (!latestRun) {
            return {
              value,
              headcount: members.length,
              quantitative: true,
              qualitativeReviewRequired: false,
              metrics: null,
              flags: ["OUTCOMES_UNAVAILABLE"],
            };
          }
          const scores = members.flatMap(
            (member) => proposalScores.get(member.personId) ?? [],
          );
          const payouts = members.map(
            (member) => incentives.get(member.personId) ?? 0,
          );
          const positive = payouts.filter((amount) => amount > 0).length;
          return {
            value,
            headcount: members.length,
            quantitative: true,
            qualitativeReviewRequired: false,
            metrics: {
              meanAiScore:
                scores.length === 0
                  ? null
                  : Math.round(
                      (scores.reduce((sum, score) => sum + score, 0) /
                        scores.length) *
                        100,
                    ) / 100,
              meanIncentiveAmount:
                Math.round(
                  (payouts.reduce((sum, amount) => sum + amount, 0) /
                    payouts.length) *
                    100,
                ) / 100,
              positivePayoutRate:
                Math.round((positive / payouts.length) * 10000) / 10000,
              adverseImpactRatio: null as number | null,
            },
            flags: [] as string[],
          };
        })
        .filter(
          (
            group,
          ): group is {
            value: string;
            headcount: number;
            quantitative: boolean;
            qualitativeReviewRequired: boolean;
            metrics: {
              meanAiScore: number | null;
              meanIncentiveAmount: number;
              positivePayoutRate: number;
              adverseImpactRatio: number | null;
            } | null;
            flags: string[];
          } => Boolean(group),
        );
      const quantitative = reported.filter(
        (group) => group.quantitative && group.metrics,
      );
      const highestRate = Math.max(
        0,
        ...quantitative.map(
          (group) => group.metrics?.positivePayoutRate ?? 0,
        ),
      );
      for (const group of quantitative) {
        if (!group.metrics) continue;
        const ratio =
          highestRate === 0
            ? 1
            : group.metrics.positivePayoutRate / highestRate;
        group.metrics.adverseImpactRatio =
          Math.round(ratio * 10000) / 10000;
        if (ratio < 0.8) {
          group.flags.push("ADVERSE_IMPACT_BELOW_FOUR_FIFTHS");
        }
      }
      dimensions[dimensionKey] = {
        reportedGroups: reported.length,
        suppressedGroups,
        outcomesAvailable: Boolean(latestRun),
        groups: reported,
      };
    }
    return data(
      {
        generatedAt: new Date().toISOString(),
        cycleId: selectedCycleId,
        available: true,
        thresholds: {
          minimumQuantitativeGroupSize: 30,
          minimumReportableGroupSize: 10,
          adverseImpactRatioThreshold: 0.8,
        },
        note:
          "Aggregate-only analysis. Cells below 10 are suppressed; groups of 10-29 are qualitative. Protected attributes are never used for individual decisions.",
        dimensions,
      },
      request,
    );
  });
  app.post("/api/v1/reports/policy-review:finalize", async (request, reply) => {
    requireRoles(request, "finance");
    const body = policyBody(request);
    const from = requireString(body, "from");
    const to = requireString(body, "to");
    if (!body.report || typeof body.report !== "object") {
      throw new BadRequestError("INVALID_INPUT", "report 必须为对象");
    }
    const report = body.report as Record<string, unknown>;
    const reportHash = sha256(report);
    // A签: 签署人必须是会话身份（不可代签）。缺省时保持 DRAFT。
    const signedOffBy =
      typeof body.signedOffBy === "string"
        ? requireActorRequired(request, body.signedOffBy, "policy review sign-off")
        : undefined;
    const record = await platformStore.savePolicyEngineRecord({
      tenantId: tenantOf(request),
      recordType: "POLICY_ANNUAL_REVIEW",
      period: `${from}..${to}`,
      status: signedOffBy ? "FINAL" : "DRAFT",
      payload: {
        from,
        to,
        report,
        reportHash,
        signedOffBy,
        signedAt: signedOffBy ? new Date().toISOString() : undefined,
      },
    });
    return reply.status(201).send(data(record, request));
  });

  app.get("/api/v1/reports/policy-review/snapshots", async (request) => {
    requireRoles(request, "manager", "finance", "admin");
    return data(
      await platformStore.listPolicyEngineRecords(tenantOf(request), {
        recordType: "POLICY_ANNUAL_REVIEW",
      }),
      request,
    );
  });

  app.get("/api/v1/reports/policy-review/snapshots/:id/export", async (request, reply) => {
      requireRoles(request, "manager", "finance", "admin");
      const record = await platformStore.getPolicyEngineRecord(
        tenantOf(request),
        idOf(request),
      );
      if (record.recordType !== "POLICY_ANNUAL_REVIEW") {
        throw new NotFoundError(`AnnualReview ${idOf(request)} 不存在`);
      }
      const payload = record.payload as {
        from?: string;
        to?: string;
        reportHash?: string;
        signedOffBy?: string;
        signedAt?: string;
        report?: Record<string, unknown>;
      };
      const escape = (value: unknown) =>
        String(value ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>年度制度审查报告</title>
<style>body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;line-height:1.7;color:#222}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 8px;text-align:left}pre{white-space:pre-wrap;background:#f6f6f6;padding:12px}</style></head><body>
<h1>年度制度审查报告</h1>
<p>周期：${escape(payload.from)} 至 ${escape(payload.to)}</p>
<p>状态：${escape(record.status)} · 报告哈希：<code>${escape(payload.reportHash)}</code></p>
<p>签核人：${escape(payload.signedOffBy ?? "未签核")} · 签核时间：${escape(payload.signedAt ?? "—")}</p>
<h2>报告内容</h2><pre>${escape(JSON.stringify(payload.report, null, 2))}</pre>
</body></html>`;
      assertExportAllowed(request);
      await assertExportDlp(request, html, "POLICY_ANNUAL_REVIEW", record.id);
      return reply
        .header("content-type", "text/html; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="policy-review-${record.id}.html"`,
        )
        .headers(exportHeaders(request, html, "CONFIDENTIAL_GOVERNANCE"))
        .send(html);
    },
  );

  async function buildReviewerAgreementReport(request: FastifyRequest): Promise<{
    pairCount: number;
    exactAgreementRate: number | null;
    withinOneRate: number | null;
    cohenKappa: number | null;
    insufficient: boolean;
    pairs: Array<{
      personId: string;
      cycleId: string;
      reviewerA: string;
      reviewerB: string;
      exactAgreementRate: number;
      withinOneRate: number;
    }>;
  }> {
    const decisions = (
      await storeFor(request).listEvaluationDecisions()
    ).filter((decision) =>
      ["APPROVED", "SUPERSEDED"].includes(decision.status),
    );
    const groups = new Map<string, typeof decisions>();
    for (const decision of decisions) {
      const key = `${decision.cycleId}:${decision.personId}`;
      groups.set(key, [...(groups.get(key) ?? []), decision]);
    }
    const pairs: Array<{
      personId: string;
      cycleId: string;
      reviewerA: string;
      reviewerB: string;
      exactAgreementRate: number;
      withinOneRate: number;
    }> = [];
    let exactTotal = 0;
    let withinOneTotal = 0;
    let ratingCount = 0;
    const observedRatings: Array<[number, number]> = [];
    for (const group of groups.values()) {
      for (let left = 0; left < group.length; left += 1) {
        for (let right = left + 1; right < group.length; right += 1) {
          const a = group[left]!;
          const b = group[right]!;
          if (a.reviewerPersonId === b.reviewerPersonId) continue;
          const dimensions = [
            ...new Set([
              ...Object.keys(a.scores ?? {}),
              ...Object.keys(b.scores ?? {}),
            ]),
          ];
          if (dimensions.length === 0) continue;
          let exact = 0;
          let withinOne = 0;
          for (const dimension of dimensions) {
            const scoreA = a.scores[dimension];
            const scoreB = b.scores[dimension];
            if (scoreA === undefined || scoreB === undefined) continue;
            ratingCount += 1;
            observedRatings.push([scoreA, scoreB]);
            if (scoreA === scoreB) exact += 1;
            if (Math.abs(scoreA - scoreB) <= 1) withinOne += 1;
          }
          exactTotal += exact;
          withinOneTotal += withinOne;
          pairs.push({
            personId: a.personId,
            cycleId: a.cycleId,
            reviewerA: a.reviewerPersonId,
            reviewerB: b.reviewerPersonId,
            exactAgreementRate: ratio(exact, dimensions.length),
            withinOneRate: ratio(withinOne, dimensions.length),
          });
        }
      }
    }
    const exactAgreementRate = ratingCount === 0 ? null : ratio(exactTotal, ratingCount);
    const withinOneRate = ratingCount === 0 ? null : ratio(withinOneTotal, ratingCount);
    let cohenKappa: number | null = null;
    if (ratingCount > 0) {
      const categories = [
        ...new Set(observedRatings.flatMap(([a, b]) => [a, b])),
      ];
      let expected = 0;
      for (const category of categories) {
        const pA =
          observedRatings.filter(([a]) => a === category).length / ratingCount;
        const pB =
          observedRatings.filter(([, b]) => b === category).length / ratingCount;
        expected += pA * pB;
      }
      cohenKappa =
        expected === 1
          ? 1
          : Math.round(((exactAgreementRate! - expected) / (1 - expected)) * 10_000) /
            10_000;
    }
    return {
      pairCount: pairs.length,
      exactAgreementRate,
      withinOneRate,
      cohenKappa,
      insufficient: pairs.length === 0,
      pairs,
    };
  }

  app.get("/api/v1/reports/reviewer-agreement", async (request) => {
    requireRoles(request, "manager", "finance", "admin");
    return data(await buildReviewerAgreementReport(request), request);
  });

  app.post("/api/v1/reports/reviewer-agreement:snapshot", async (request, reply) => {
      requireRoles(request, "finance", "admin");
      const report = await buildReviewerAgreementReport(request);
      const record = await platformStore.savePolicyEngineRecord({
        tenantId: tenantOf(request),
        recordType: "REVIEWER_AGREEMENT_AUDIT",
        period: new Date().toISOString().slice(0, 10),
        status: report.insufficient ? "INSUFFICIENT" : "GENERATED",
        payload: report,
      });
      return reply.status(201).send(data(record, request));
    },
  );

  app.get("/api/v1/reports/reviewer-agreement/snapshots", async (request) => {
    requireRoles(request, "manager", "finance", "admin");
    return data(
      await platformStore.listPolicyEngineRecords(tenantOf(request), {
        recordType: "REVIEWER_AGREEMENT_AUDIT",
      }),
      request,
    );
  });
  };
}
