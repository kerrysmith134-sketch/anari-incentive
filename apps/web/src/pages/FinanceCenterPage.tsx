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
  grossProfit?: string;
  blockers: string[];
  warnings: string[];
}

interface FinancialFactView {
  id: string;
  cycleId: string;
  netProfit?: string;
  grossProfit?: string;
  source: string;
  recordedAt?: string;
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

  const loading =
    policyQuery.loading ||
    runsQuery.loading ||
    factsQuery.loading ||
    poolsQuery.loading;
  const error =
    policyQuery.error ||
    runsQuery.error ||
    factsQuery.error ||
    poolsQuery.error;

  const runs = runsQuery.data ?? [];
  const formalRuns = runs.filter((run) => run.mode === "FORMAL");
  const blockedRuns = runs.filter((run) => run.blockers.length > 0);
  const warnedRuns = runs.filter((run) => run.warnings.length > 0);
  const facts = factsQuery.data ?? [];
  const pools = poolsQuery.data ?? [];

  // 金额差异/对账提示：同一周期内财务事实毛利与计算运行毛利不一致的周期。
  const factByCycle = new Map<string, string>();
  for (const fact of facts) {
    if (fact.grossProfit && fact.cycleId) {
      factByCycle.set(fact.cycleId, fact.grossProfit);
    }
  }
  const reconciliations = [...factByCycle.entries()].map(([cycleId, factGross]) => {
    const runGross = runs
      .filter((run) => run.cycleId === cycleId && run.grossProfit)
      .reduce((sum, run) => sum + Number(run.grossProfit ?? 0), 0);
    const declared = Number(factGross);
    const delta = declared - runGross;
    return {
      cycleId,
      declared,
      runGross,
      delta,
      status: delta === 0 ? "MATCH" : "VARIANCE",
    };
  });
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
          <Panel title="引用对账（财务事实 vs 计算运行）">
            {reconciliations.length === 0 ? (
              <EmptyState
                title="暂无可对账周期"
                description="录入财务事实并有计算运行后，按周期对比毛利。"
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
                    周期 {row.cycleId.slice(0, 8)}：财务 {row.declared} vs 运行{" "}
                    {row.runGross}
                    {row.delta !== 0 ? (
                      <span className="muted">（差异 {row.delta}）</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <InfoNotice>
              差异 = 财务申报毛利 − 计算运行毛利合计；非零差异需先核对来源事实再进入结算。
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
                    周期 {fact.cycleId.slice(0, 8)} 来源 {fact.source}{" "}
                    {fact.grossProfit ? `毛利 ${fact.grossProfit}` : ""}
                    {fact.netProfit ? ` 净利 ${fact.netProfit}` : ""}
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
