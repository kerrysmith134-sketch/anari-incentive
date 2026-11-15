import {
  Badge,
  EmptyState,
  InfoNotice,
  LoadingRows,
  PageHeader,
  Panel,
} from "../components/ui.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { formatMoney } from "../lib/format.js";

/**
 * NPV2-030：Finance Center——财务与结算工作空间。
 * 单页聚合：利润池/预算、来源事实、政策版本、计算运行、引用对账
 * （影子结算对账）、阻断项、金额差异与 cap 提示。
 * 只读聚合视图；锁账/结算/导出等操作留在结算与薪酬模块的审批路径。
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
      factType: string;
      amount: string;
      qualityStatus: string;
      error?: string | null;
    }>;
    totalMicros: string;
    total: string | null;
  };
  calculated: {
    runId: string | null;
    runStatus: string | null;
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
  totalAmount: string;
  allocatedAmount?: string;
  status: string;
}

export function FinanceCenterPage() {
  useDocumentTitle("财务中心");

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

  return (
    <>
      <PageHeader
        eyebrow="财务与结算"
        title="财务中心"
        description="利润池/预算与来源事实、政策版本、计算运行、引用对账、阻断项与 cap——财务视角单页聚合。只读；锁账/结算/导出留在结算与薪酬模块的审批路径。"
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
                    {row.cycleName}（{row.cycleId.slice(0, 8)}）{" "}
                    <span className="muted">
                      声明 {row.declared.total ?? "解析错误"} vs 运行{" "}
                      {row.calculated.grossProfit ?? "无正式运行"}
                      {row.deltaMicros !== "0" ? ` · 差异（微单位）${row.deltaMicros}` : ""}
                    </span>
                    {row.declared.facts.length > 0 ? (
                      <ul className="stack-list muted">
                        {row.declared.facts.map((fact) => (
                          <li key={fact.factId}>
                            逐笔 {fact.factType}（{fact.sourceSystem}）{fact.amount}{" "}
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
                    周期 {pool.cycleId.slice(0, 8)} 预算{" "}
                    {formatMoney(pool.totalAmount)}
                    {pool.allocatedAmount ? (
                      <span className="muted">
                        {" "}
                        · 已分配 {formatMoney(pool.allocatedAmount)}
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
