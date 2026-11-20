import { useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  PageHeader,
  Panel,
  Select,
  Textarea,
} from "../components/ui.js";
import { Link } from "react-router-dom";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { formatMoney, microsToDecimal } from "../lib/format.js";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";

/**
 * NPV2-030：Finance Center——财务与结算工作空间。
 * 单页聚合：利润池/预算、来源事实、政策版本、计算运行、引用对账
 * （影子结算对账）、阻断项、金额差异与 cap 提示。
 * NP-023（B 方案）：差异行可下钻——模态展示逐笔事实与基准运行分录，
 * 一键生成带审计的调整分录（金额预填差额、允许人工修正）；
 * 锁账/结算/导出等操作仍留在结算与薪酬模块的审批路径。
 */
interface PolicyVersionView {
  policyVersionId: string;
  code: string;
  version: number;
  status: string;
}

interface RunView {
  id: string;
  cycleId: string;
  mode: string;
  status: string;
  blockers: string[];
  warnings: string[];
}

interface FinancialFactView {
  id: string;
  factType: string;
  sourceSystem: string;
  sourceRecordId: string;
  amount: string;
  currency: string;
  qualityStatus: string;
  periodStart?: string;
  periodEnd?: string;
}

/** AUD-014：对账在后端以微单位整数完成——前端只渲染报告。 */
interface ReconciliationRow {
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
      error?: string | null;
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
    error?: string | null;
  };
  deltaMicros: string;
}

interface ReconciliationReport {
  cycles: ReconciliationRow[];
  note: string;
}

interface BudgetPoolView {
  id: string;
  cycleId: string;
  /** 与 /api/v1/budget-pools 返回一致（BudgetPool）。 */
  approvedAmount: string;
  committedAmount?: string;
  status: string;
}

/** 台账分录（/api/v1/ledger）：调整锚点必须是对账基准运行的 LOCKED INCENTIVE。 */
interface LedgerEntryView {
  id: string;
  personId: string;
  cycleId: string;
  calculationRunId: string;
  entryType: string;
  amount: string;
  currency: string;
  status: string;
}

export function FinanceCenterPage() {
  useDocumentTitle("财务中心");
  const { session } = useAuth();
  const toast = useToast();

  const policyQuery = useApiQuery<PolicyVersionView[]>(
    "/api/v1/policy-versions",
    "finance-policy",
  );
  const runsQuery = useApiQuery<RunView[]>("/api/v1/calculation-runs", "finance-runs");
  const factsQuery = useApiQuery<FinancialFactView[]>(
    "/api/v1/financial-facts",
    "finance-facts",
  );
  const poolsQuery = useApiQuery<BudgetPoolView[]>(
    "/api/v1/budget-pools",
    "finance-pools",
  );
  // AUD-014：对账下沉后端（微单位整数 + FORMAL/LOCKED 运行筛选）。
  const reconciliationQuery = useApiQuery<ReconciliationReport>(
    "/api/v1/reports/finance-reconciliation",
    "finance-reconciliation",
  );
  // 调整入口只对 finance/admin 展示（与后端 requireRoles("finance") 同语义：
  // admin 特权放行；fail-closed：身份未确认前不显示）。
  const identityQuery = useApiQuery<{ roles: string[] }>(
    "/api/v1/platform/identity",
    "finance-identity",
  );
  const isFinance = (identityQuery.data?.roles ?? []).some(
    (role) => role === "finance" || role === "admin",
  );

  const loading =
    policyQuery.loading ||
    runsQuery.loading ||
    factsQuery.loading ||
    poolsQuery.loading ||
    reconciliationQuery.loading;
  const error =
    policyQuery.error ||
    runsQuery.error ||
    factsQuery.error ||
    poolsQuery.error ||
    reconciliationQuery.error;

  const runs = runsQuery.data ?? [];
  const formalRuns = runs.filter((run) => run.mode === "FORMAL");
  const blockedRuns = runs.filter((run) => run.blockers.length > 0);
  const warnedRuns = runs.filter((run) => run.warnings.length > 0);
  const facts = factsQuery.data ?? [];
  const pools = poolsQuery.data ?? [];
  const reconciliations = reconciliationQuery.data?.cycles ?? [];
  const variances = reconciliations.filter((row) => row.status === "VARIANCE");

  // NP-023：差异下钻模态状态。
  const [adjustRow, setAdjustRow] = useState<ReconciliationRow | null>(null);
  const [ledgerQueryKey, setLedgerQueryKey] = useState("ledger-idle");
  const ledgerQuery = useApiQuery<LedgerEntryView[]>(
    adjustRow ? "/api/v1/ledger" : null,
    ledgerQueryKey,
  );
  const anchorEntries = (ledgerQuery.data ?? []).filter(
    (entry) =>
      adjustRow !== null &&
      entry.cycleId === adjustRow.cycleId &&
      adjustRow.calculated.runId !== null &&
      entry.calculationRunId === adjustRow.calculated.runId &&
      entry.entryType === "INCENTIVE" &&
      entry.status === "LOCKED",
  );
  const [anchorId, setAnchorId] = useState("");
  const [amount, setAmount] = useState("");
  const [explanation, setExplanation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openAdjust(row: ReconciliationRow) {
    setAdjustRow(row);
    setLedgerQueryKey(`ledger-${row.cycleId}`);
    setAnchorId("");
    // 金额预填差额（微单位精确转 DecimalString；符号即补差方向）。
    setAmount(microsToDecimal(row.deltaMicros));
    setExplanation("");
    setFormError(null);
  }

  function closeAdjust() {
    setAdjustRow(null);
    setLedgerQueryKey("ledger-idle");
    setFormError(null);
  }

  async function submitAdjustment() {
    if (!adjustRow) return;
    if (!anchorId) {
      setFormError("必须选择要调整的台账分录（对账基准运行的 LOCKED INCENTIVE 分录）。");
      return;
    }
    if (!/^-?\d+(\.\d{1,6})?$/.test(amount.trim()) || amount.trim() === "0" || amount.trim() === "-0") {
      setFormError("调整金额必须是非零数字（最多 6 位小数）。");
      return;
    }
    if (explanation.trim().length < 3) {
      setFormError("必须填写至少 3 个字符的调整说明（进入审计与 AdjustmentRecord）。");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await api(`/api/v1/reports/finance-reconciliation/${adjustRow.cycleId}/adjustment`, {
        method: "POST",
        body: {
          ledgerEntryId: anchorId,
          amount: amount.trim(),
          reasonCode: "RECONCILIATION_VARIANCE",
          explanation: explanation.trim(),
          approvedBy: session.personId,
          idempotencyKey: `recon-adj-${adjustRow.cycleId}-${crypto.randomUUID()}`,
        },
      });
      toast.success("调整分录已入账", `${adjustRow.cycleName} · 差额 ${microsToDecimal(adjustRow.deltaMicros)}`);
      closeAdjust();
      reconciliationQuery.reload();
      ledgerQuery.reload();
    } catch (caught) {
      setFormError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "无法生成调整分录。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="财务与结算"
        title="财务中心"
        description="利润池/预算与来源事实、政策版本、计算运行、引用对账、阻断项与 cap——财务视角单页聚合。差异行可下钻并生成带审计的调整分录；锁账/结算/导出留在结算与薪酬模块的审批路径。"
      />
      {error ? (
        <InfoNotice tone="warning">
          数据加载失败：{(error as Error).message}
        </InfoNotice>
      ) : null}

      {loading ? (
        <LoadingRows rows={6} />
      ) : (
        <>
          <Panel title={`引用对账（财务事实 vs 计算运行，${variances.length} 个差异）`}>
            {reconciliations.length === 0 ? (
              <EmptyState
                title="暂无可对账周期"
                description="录入财务事实并有正式计算运行后，按周期对比毛利。"
              />
            ) : (
              <ul className="stack-list">
                {reconciliations.map((row) => (
                  <li key={row.cycleId}>
                    <Badge
                      status={row.status === "MATCH" ? "APPROVED" : "NEEDS_EVIDENCE"}
                    >
                      {row.status === "MATCH" ? "一致" : "差异"}
                    </Badge>{" "}
                    <Link to="/console/cycles" className="mono">
                      {row.cycleName}（{row.cycleId.slice(0, 8)}）
                    </Link>{" "}
                    <span className="muted">
                      声明 {row.declared.total ?? "解析错误"} vs 运行{" "}
                      {row.calculated.grossProfit ?? "无正式运行"}
                      {row.deltaMicros !== "0" ? ` · 差异（微单位）${row.deltaMicros}` : ""}
                    </span>
                    {row.status === "VARIANCE" ? (
                      <span className="muted">
                        {" "}
                        <Link to="/console/settlements">→ 结算核对</Link>
                      </span>
                    ) : null}
                    {row.status === "VARIANCE" && isFinance ? (
                      <>
                        {" "}
                        <Button
                          variant="secondary"
                          onClick={() => openAdjust(row)}
                        >
                          差异明细与调整
                        </Button>
                      </>
                    ) : null}
                    {row.declared.facts.length > 0 ? (
                      <ul className="stack-list muted">
                        {row.declared.facts.map((fact) => (
                          <li key={fact.factId}>
                            逐笔 {fact.factType}（{fact.sourceSystem}）{formatMoney(fact.amount)}{" "}
                            {fact.qualityStatus !== "VALID" ? `[${fact.qualityStatus}]` : ""}
                            {fact.error ? ` ⚠ ${fact.error}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {row.calculated.error ? (
                      <div className="muted">⚠ 运行侧：{row.calculated.error}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <InfoNotice>
              对账在后端完成：金额按 1e6 微单位整数运算；运行侧只取每周期最新
              FORMAL（APPROVED/LOCKED，非 REVERSED）运行；REJECTED 事实不参与。
            </InfoNotice>
          </Panel>

          <Modal
            open={adjustRow !== null}
            title={`差异明细与调整——${adjustRow?.cycleName ?? ""}`}
            description="逐笔事实、对账基准与差额同源（同一后端计算）；调整分录锚定基准运行的一条 LOCKED INCENTIVE 分录，金额默认为差额、可人工修正，全程带审计。"
            onClose={closeAdjust}
            wide
            footer={
              <>
                <Button variant="secondary" onClick={closeAdjust}>
                  关闭
                </Button>
                <Button
                  variant="primary"
                  onClick={submitAdjustment}
                  disabled={submitting}
                >
                  {submitting ? "提交中…" : "生成调整分录"}
                </Button>
              </>
            }
          >
            {adjustRow ? (
              <>
                <ul className="stack-list">
                  <li>
                    声明合计：<strong>{formatMoney(adjustRow.declared.total ?? "0")}</strong>{" "}
                    <span className="muted">（{adjustRow.declared.totalMicros} 微单位）</span>
                  </li>
                  <li>
                    运行基准：
                    {adjustRow.calculated.runId ? (
                      <>
                        {formatMoney(adjustRow.calculated.grossProfit ?? "0")}{" "}
                        <span className="muted">
                          （运行 {adjustRow.calculated.runId.slice(0, 8)} ·{" "}
                          {adjustRow.calculated.runStatus}）
                        </span>
                      </>
                    ) : (
                      <strong>无正式运行基准</strong>
                    )}
                  </li>
                  <li>
                    差额：<strong>{microsToDecimal(adjustRow.deltaMicros)}</strong>{" "}
                    <span className="muted">（{adjustRow.deltaMicros} 微单位；正数 = 财务申报高于运行基准）</span>
                  </li>
                </ul>
                {adjustRow.declared.facts.length > 0 ? (
                  <ul className="stack-list muted">
                    {adjustRow.declared.facts.map((fact) => (
                      <li key={fact.factId}>
                        {fact.factType}（{fact.sourceSystem}#{fact.sourceRecordId}）{" "}
                        {formatMoney(fact.amount)} {fact.qualityStatus !== "VALID" ? `[${fact.qualityStatus}]` : ""}
                        {fact.error ? ` ⚠ ${fact.error}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="muted">该周期没有参与对账的财务事实。</div>
                )}
                <FormField
                  label="调整锚点分录"
                  hint="仅列出对账基准运行中该周期的 LOCKED INCENTIVE 分录。"
                >
                  {ledgerQuery.loading ? (
                    <div className="muted">分录加载中…</div>
                  ) : anchorEntries.length === 0 ? (
                    <div className="muted">
                      该基准运行没有可锚定的 LOCKED INCENTIVE 分录（可能因运行侧解析错误或分录已被调整）。
                    </div>
                  ) : (
                    <Select
                      value={anchorId}
                      onChange={(event) => setAnchorId(event.target.value)}
                      aria-label="选择调整锚点分录"
                    >
                      <option value="">— 选择分录 —</option>
                      {anchorEntries.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.id.slice(0, 8)} · 人员 {entry.personId.slice(0, 8)} ·{" "}
                          {formatMoney(entry.amount, entry.currency)}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField
                  label="调整金额"
                  hint="默认预填差额；可人工修正。非零，最多 6 位小数；符号决定补差方向。"
                >
                  <input
                    className="input"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    aria-label="调整金额"
                  />
                </FormField>
                <FormField label="调整说明（必填，进入审计）">
                  <Textarea
                    value={explanation}
                    onChange={(event) => setExplanation(event.target.value)}
                    aria-label="调整说明"
                    rows={3}
                    placeholder="例如：ERP 补录 10 月毛利 100，与运行基准差额一致，调整该分录。"
                  />
                </FormField>
                {formError ? (
                  <InfoNotice tone="warning">{formError}</InfoNotice>
                ) : null}
                <InfoNotice>
                  提交后：AdjustmentRecord + 账本 ADJUSTMENT 分录（幂等键防重）+
                  审计事件 RECONCILIATION_ADJUSTMENT_POSTED（含差异上下文）；已确认结算批次的周期会被追溯调整防护拦截。
                </InfoNotice>
              </>
            ) : null}
          </Modal>

          <Panel title={`阻断与提示（阻断 ${blockedRuns.length} / 提示 ${warnedRuns.length}）`}>
            {blockedRuns.length === 0 && warnedRuns.length === 0 ? (
              <EmptyState title="无阻断项" description="所有计算运行无未解决阻断。" />
            ) : (
              <ul className="stack-list">
                {[...blockedRuns, ...warnedRuns].map((run) => (
                  <li key={run.id}>
                    <Badge
                      status={run.blockers.length > 0 ? "REJECTED" : "WAITING_APPROVAL"}
                    >
                      {run.blockers.length > 0 ? "阻断" : "提示"}
                    </Badge>{" "}
                    运行 {run.id.slice(0, 8)}（周期 {run.cycleId.slice(0, 8)}）{" "}
                    <span className="muted">
                      {run.blockers.length > 0
                        ? `blockers: ${run.blockers.join("; ")}`
                        : `warnings: ${run.warnings.join("; ")}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <InfoNotice>
              舍入采用 HALF_UP 分摊、cap 在政策定义内生效；计算明细在各运行详情（计算模块）。
            </InfoNotice>
          </Panel>

          <Panel title={`计算运行（FORMAL ${formalRuns.length} / 全部 ${runs.length}）`}>
            {runs.length === 0 ? (
              <EmptyState title="暂无计算运行" />
            ) : (
              <ul className="stack-list">
                {runs.slice(0, 20).map((run) => (
                  <li key={run.id}>
                    <Badge status={run.status}>{run.status}</Badge>{" "}
                    <span className="muted">{run.mode}</span> 周期{" "}
                    {run.cycleId.slice(0, 8)}{" "}
                    <span className="muted">{run.id.slice(0, 8)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`利润池与预算（${pools.length}）`}>
            {pools.length === 0 ? (
              <EmptyState title="暂无预算池" />
            ) : (
              <ul className="stack-list">
                {pools.map((pool) => (
                  <li key={pool.id}>
                    <Badge status={pool.status}>{pool.status}</Badge>{" "}
                    周期 {pool.cycleId.slice(0, 8)} 核准预算{" "}
                    {formatMoney(pool.approvedAmount)}
                    {pool.committedAmount ? (
                      <span className="muted">
                        {" "}
                        · 已占用 {formatMoney(pool.committedAmount)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`来源事实（${facts.length}）`}>
            {facts.length === 0 ? (
              <EmptyState
                title="暂无财务事实"
                description="财务事实（净利/毛利申报）是计算与预算的来源依据。"
              />
            ) : (
              <ul className="stack-list">
                {facts.slice(0, 20).map((fact) => (
                  <li key={fact.id}>
                    {fact.factType}（{fact.sourceSystem}#{fact.sourceRecordId}）{" "}
                    {formatMoney(fact.amount)}{" "}
                    {fact.qualityStatus !== "VALID" ? (
                      <span className="muted">[{fact.qualityStatus}]</span>
                    ) : null}
                    {fact.periodStart || fact.periodEnd ? (
                      <span className="muted">
                        {" "}
                        · {(fact.periodStart ?? "?").slice(0, 10)}~
                        {(fact.periodEnd ?? "?").slice(0, 10)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`政策版本（${policyQuery.data?.length ?? 0}）`}>
            {(policyQuery.data ?? []).length === 0 ? (
              <EmptyState title="暂无政策版本" />
            ) : (
              <ul className="stack-list">
                {(policyQuery.data ?? []).slice(0, 20).map((version) => (
                  <li key={version.policyVersionId}>
                    <Badge status={version.status}>{version.status}</Badge>{" "}
                    <strong>
                      {version.code} v{version.version}
                    </strong>{" "}
                    <span className="muted">{version.policyVersionId.slice(0, 8)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
