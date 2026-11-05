import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  InfoNotice,
  LoadingRows,
  PageHeader,
  Panel,
  StatTile,
} from "../components/ui.js";
import { Icon } from "../components/Icon.js";
import { api } from "../lib/api.js";
import { useToast } from "../contexts/ToastContext.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatRelative,
  shortId,
  titleCase,
} from "../lib/format.js";
import type {
  AppealCase,
  AppealStatsReport,
  ApprovalRequest,
  AuditEvent,
  Bounty,
  EquityGrant,
  EvaluationCycle,
  IntegrationConnection,
  OperationsCoverageReport,
  PayrollRun,
  PlatformIdentity,
  TeamAggregateReport,
  WorkPackage,
} from "../lib/types.js";
import type { NotificationView } from "../lib/ops-types.js";

const CLOSED_CYCLE_STATUSES = new Set([
  "CLOSED",
  "ARCHIVED",
  "COMPLETED",
  "SETTLED",
  "CANCELLED",
]);

export function DashboardPage() {
  useDocumentTitle("Overview");
  const identity = useApiQuery<PlatformIdentity>("/api/v1/platform/identity");
  const privileged = Boolean(
    identity.data?.roles.some((role) =>
      ["admin", "manager", "finance"].includes(role),
    ),
  );
  const canViewTeam = privileged;
  const cycles = useApiQuery<EvaluationCycle[]>(
    privileged ? "/api/v1/evaluation-cycles" : null,
  );
  const approvals = useApiQuery<ApprovalRequest[]>(
    privileged ? "/api/v1/approval-requests" : null,
  );
  const payroll = useApiQuery<PayrollRun[]>(
    privileged ? "/api/v1/payroll-runs" : null,
  );
  const bounties = useApiQuery<Bounty[]>(
    privileged ? "/api/v1/bounties" : null,
  );
  const grants = useApiQuery<EquityGrant[]>(
    privileged ? "/api/v1/equity-grants" : null,
  );
  const connections = useApiQuery<IntegrationConnection[]>(
    privileged ? "/api/v1/integration-connections" : null,
  );
  const coverage = useApiQuery<OperationsCoverageReport>(
    privileged ? "/api/v1/reports/operations-coverage" : null,
  );
  const audit = useApiQuery<AuditEvent[]>(
    privileged ? "/api/v1/audit-events?limit=7" : null,
  );
  const auditChain = useApiQuery<{ valid: boolean }>(
    privileged ? "/api/v1/audit-events/verify" : null,
  );
  const team = useApiQuery<TeamAggregateReport>(
    canViewTeam ? "/api/v1/reports/team-aggregate" : null,
  );
  const appealStats = useApiQuery<AppealStatsReport>(
    privileged ? "/api/v1/reports/appeal-stats" : null,
  );

  if (identity.loading) {
    return (
      <Panel title="Loading workspace">
        <LoadingRows rows={4} />
      </Panel>
    );
  }
  if (!privileged) {
    return <EmployeeHome />;
  }

  const activeCycles =
    cycles.data?.filter(
      (cycle) => !CLOSED_CYCLE_STATUSES.has(cycle.status.toUpperCase()),
    ) ?? [];
  const pendingApprovals =
    approvals.data?.filter((request) => request.status === "PENDING") ?? [];
  const blockedRuns =
    payroll.data?.filter((run) => run.status === "BLOCKED") ?? [];
  const sortedRuns = [...(payroll.data ?? [])].sort((a, b) =>
    (b.periodStart ?? b.createdAt).localeCompare(a.periodStart ?? a.createdAt),
  );
  const latestRun = sortedRuns[0];
  const openBounties =
    bounties.data?.filter(
      (bounty) => bounty.status === "OPEN" || bounty.status === "CLAIMED",
    ) ?? [];
  const activeGrants =
    grants.data?.filter((grant) => grant.status === "ACTIVE") ?? [];
  const activeConnections =
    connections.data?.filter((connection) =>
      ["CONNECTED", "ACTIVE"].includes(connection.status.toUpperCase()),
    ) ?? [];
  const lastSync = (connections.data ?? [])
    .map((connection) => connection.lastSyncAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const highRisk = pendingApprovals.filter((request) =>
    ["T2", "T3", "HIGH", "CRITICAL"].includes(request.riskTier.toUpperCase()),
  ).length;
  const attention = pendingApprovals.length + blockedRuns.length;
  const report = coverage.data;

  const verifyIcon = auditChain.loading
    ? "clock"
    : auditChain.data?.valid
      ? "check-circle"
      : "alert-circle";

  return (
    <>
      <PageHeader
        eyebrow="指挥室"
        title="运营总览"
        description="贡献认定、审批门禁与激励结算一站式总览；数字来自本租户实时账本。"
        actions={
          <>
            <Link className="btn btn--secondary" to="/policy">
              <Icon name="policy" size={16} />
              <span>就绪度</span>
            </Link>
            <Link className="btn btn--primary" to="/approvals">
              <Icon name="approvals" size={16} />
              <span>审批队列</span>
            </Link>
          </>
        }
      />

      <Panel
        title="AI 工作台"
        subtitle="主动式 Agent 持续观察证据缺口、结算就绪与数据质量"
        className="section-gap"
      >
        <AiWorkbench privileged={privileged} />
      </Panel>

      {attention > 0 ? (
        <div className="attention-bar">
          <span className="attention-bar__icon" aria-hidden="true">
            <Icon name="alert-circle" size={17} />
          </span>
          <span>
            <strong>
              {pendingApprovals.length} approval
              {pendingApprovals.length === 1 ? "" : "s"} waiting
            </strong>
            {blockedRuns.length > 0
              ? ` · ${blockedRuns.length} payroll run${blockedRuns.length === 1 ? "" : "s"} blocked by the minimum-wage gate`
              : " · 高风险动作在人工决策前保持门禁"}
          </span>
          <Link className="btn btn--secondary btn--sm" to="/approvals">
            处理队列
            <Icon name="chevron-right" size={14} />
          </Link>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatTile
          label="进行中周期"
          value={cycles.loading ? "…" : activeCycles.length}
          detail={
            cycles.loading
              ? "Loading cycles"
              : activeCycles[0]
                ? `${activeCycles[0].name} · ends ${formatDate(activeCycles[0].endsAt)}`
                : "No cycle currently in flight"
          }
          icon="layers"
          tone="accent"
        />
        <StatTile
          label="Pending approvals"
          value={approvals.loading ? "…" : pendingApprovals.length}
          detail={
            approvals.loading
              ? "Loading queue"
              : highRisk > 0
                ? `${highRisk} at T2 or above`
                : "Nothing above T1"
          }
          icon="approvals"
          tone={pendingApprovals.length > 0 ? "warning" : "good"}
        />
        <StatTile
          label="Latest payroll net"
          value={
            payroll.loading
              ? "…"
              : latestRun
                ? formatMoney(latestRun.totalNet, latestRun.currency, {
                    compact: true,
                  })
                : "—"
          }
          detail={
            latestRun ? (
              <>
                <Badge status={latestRun.status} />
                <span>{formatDate(latestRun.periodEnd)}</span>
              </>
            ) : (
              "暂无薪酬批次"
            )
          }
          icon="wallet"
          tone={blockedRuns.length > 0 ? "critical" : "neutral"}
        />
        <StatTile
          label="进行中悬赏"
          value={bounties.loading ? "…" : openBounties.length}
          detail={
            openBounties.length > 0
              ? `${formatMoney(
                  openBounties.reduce(
                    (total, bounty) => total + Number(bounty.rewardAmount || 0),
                    0,
                  ),
                  openBounties[0]?.currency ?? "CNY",
                  { compact: true },
                )} committed`
              : "No live bounty"
          }
          icon="rewards"
          tone="neutral"
        />
      </div>

      <div className="dashboard-grid">
        <div className="stack">
          <Panel
            title="审批队列"
            subtitle="等待人工决策的受门禁动作"
            action={
              <Link className="btn btn--quiet btn--sm" to="/approvals">
                查看全部
                <Icon name="chevron-right" size={13} />
              </Link>
            }
            flush
          >
            {approvals.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={approvals.error} onRetry={approvals.reload} />
              </div>
            ) : approvals.loading ? (
              <div className="approval-list">
                {Array.from({ length: 3 }, (_, index) => (
                  <div className="approval-row" key={index}>
                    <span className="skeleton" style={{ width: 28, height: 28, borderRadius: 8 }} />
                    <div className="approval-row__main">
                      <span className="skeleton skeleton--wide" />
                      <span className="skeleton skeleton--short" style={{ marginTop: 6 }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : pendingApprovals.length === 0 ? (
              <EmptyState
                icon="check-circle"
                title="Queue is clear"
                description="没有等待审批的动作；新的 T2/T3 请求会出现在这里。"
              />
            ) : (
              <div className="approval-list">
                {pendingApprovals.slice(0, 5).map((request) => (
                  <Link
                    className="approval-row"
                    key={request.id}
                    to="/approvals"
                  >
                    <span className="connection-card__icon" style={{ width: 30, height: 30 }}>
                      <Icon name="approvals" size={15} />
                    </span>
                    <div className="approval-row__main">
                      <div className="approval-row__title">
                        {titleCase(request.actionType)}
                        <span className="chip">{request.riskTier}</span>
                      </div>
                      <div className="approval-row__meta">
                        <span>
                          {request.targetType} · {shortId(request.targetId)}
                        </span>
                        <span>·</span>
                        <span>{formatRelative(request.createdAt)}</span>
                      </div>
                    </div>
                    <Badge status={request.status} />
                    <Icon name="chevron-right" size={14} />
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="薪酬批次"
            subtitle="Most recent settlement periods"
            action={
              <Link className="btn btn--quiet btn--sm" to="/payroll">
                打开薪酬
                <Icon name="chevron-right" size={13} />
              </Link>
            }
            flush
          >
            {payroll.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={payroll.error} onRetry={payroll.reload} />
              </div>
            ) : payroll.loading ? (
              <div className="loading-inline">
                <span className="spinner" /> Loading payroll runs…
              </div>
            ) : sortedRuns.length === 0 ? (
              <EmptyState
                icon="wallet"
                title="暂无薪酬批次"
                description="从已申报合同创建影子计算，开启一个结算周期。"
                action={
                  <Link className="btn btn--primary btn--sm" to="/payroll">
                    前往薪酬
                  </Link>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>周期</th>
                      <th>状态</th>
                      <th className="cell-num">税前</th>
                      <th className="cell-num">税后</th>
                      <th>更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRuns.slice(0, 5).map((run) => (
                      <tr key={run.id}>
                        <td>
                          <span className="cell-primary">
                            {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
                          </span>
                          <span className="cell-sub">
                            {run.currency} · {shortId(run.id)}
                          </span>
                        </td>
                        <td>
                          <Badge status={run.status} />
                        </td>
                        <td className="cell-num">
                          {formatMoney(run.totalGross, run.currency)}
                        </td>
                        <td className="cell-num">
                          {formatMoney(run.totalNet, run.currency)}
                        </td>
                        <td className="muted nowrap">{formatRelative(run.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="split-grid">
            <Panel title="激励" subtitle="Equity and open work">
              <div className="coverage-grid">
                <div className="coverage-cell">
                  <div className="coverage-cell__label">生效授予</div>
                  <div className="coverage-cell__value">{activeGrants.length}</div>
                  <div className="coverage-cell__sub">
                    {grants.data?.length ?? 0} total
                  </div>
                </div>
                <div className="coverage-cell">
                  <div className="coverage-cell__label">进行中悬赏</div>
                  <div className="coverage-cell__value">{openBounties.length}</div>
                  <div className="coverage-cell__sub">
                    {bounties.data?.length ?? 0} total
                  </div>
                </div>
              </div>
              <div className="detail-section">
                {openBounties.length === 0 ? (
                  <p className="muted">当前没有进行中的悬赏。</p>
                ) : (
                  <div className="approval-list" style={{ margin: "0 -20px -20px" }}>
                    {openBounties.slice(0, 3).map((bounty) => (
                      <div className="approval-row" key={bounty.id}>
                        <div className="approval-row__main">
                          <div className="approval-row__title">{bounty.title}</div>
                          <div className="approval-row__meta">
                            {formatMoney(bounty.rewardAmount, bounty.currency)} ·{" "}
                            {titleCase(bounty.status)}
                          </div>
                        </div>
                        <Badge status={bounty.status} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Link className="btn btn--quiet btn--sm section-gap" to="/rewards">
                打开激励
                <Icon name="chevron-right" size={13} />
              </Link>
            </Panel>

            <Panel title="集成" subtitle="Payload movement">
              <div className="two-col">
                <div className="coverage-cell" style={{ border: "1px solid var(--line-soft)", borderRadius: 10 }}>
                  <div className="coverage-cell__label">已连通</div>
                  <div className="coverage-cell__value">{activeConnections.length}</div>
                  <div className="coverage-cell__sub">
                    of {connections.data?.length ?? 0} configured
                  </div>
                </div>
                <div className="coverage-cell" style={{ border: "1px solid var(--line-soft)", borderRadius: 10 }}>
                  <div className="coverage-cell__label">最近同步</div>
                  <div className="coverage-cell__value" style={{ fontSize: 15 }}>
                    {lastSync ? formatRelative(lastSync) : "—"}
                  </div>
                  <div className="coverage-cell__sub">跨供应商</div>
                </div>
              </div>
              <div className="detail-section">
                {connections.loading ? (
                  <div className="loading-inline">
                    <span className="spinner" /> Loading connections…
                  </div>
                ) : (connections.data?.length ?? 0) === 0 ? (
                  <p className="muted">尚未配置连接。</p>
                ) : (
                  <div className="stack" style={{ gap: 7 }}>
                    {connections.data?.slice(0, 4).map((connection) => (
                      <div
                        key={connection.id}
                        className="inline"
                        style={{ justifyContent: "space-between", width: "100%" }}
                      >
                        <span className="truncate">
                          <strong style={{ fontWeight: 600 }}>{connection.connectionName}</strong>
                          <span className="subtle"> · {connection.provider}</span>
                        </span>
                        <Badge status={connection.status} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Link className="btn btn--quiet btn--sm section-gap" to="/integrations">
                打开集成
                <Icon name="chevron-right" size={13} />
              </Link>
            </Panel>
          </div>
        </div>

        <div className="stack">
          <Panel
            title="Assurance posture"
            subtitle="Coverage and data quality signals"
            action={
              <Link className="btn btn--quiet btn--sm" to="/policy">
                报告
              </Link>
            }
          >
            {coverage.error ? (
              <ErrorNotice error={coverage.error} onRetry={coverage.reload} />
            ) : coverage.loading || !report ? (
              <div className="loading-inline">
                <span className="spinner" /> Computing coverage…
              </div>
            ) : (
              <>
                <div className="coverage-grid">
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">证据覆盖率</div>
                    <div className="coverage-cell__value">
                      {formatPercent(report.workPackages.evidenceCoverageRate)}
                    </div>
                    <div className="coverage-cell__sub">
                      {report.workPackages.withEvidence} of{" "}
                      {report.workPackages.accepted} accepted packages
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">已确认申报</div>
                    <div className="coverage-cell__value">{report.claims.confirmed}</div>
                    <div className="coverage-cell__sub">
                      {report.claims.pending} in review
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">交付物</div>
                    <div className="coverage-cell__value">
                      {report.deliverables.pendingAcceptance}
                    </div>
                    <div className="coverage-cell__sub">待验收</div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">未结数据问题</div>
                    <div className="coverage-cell__value">{report.dataQuality.open}</div>
                    <div className="coverage-cell__sub">
                      {report.dataQuality.overdue} overdue
                    </div>
                  </div>
                </div>
                <div
                  className={`notice ${report.dataQuality.overdue > 0 ? "notice--warning" : "notice--success"}`}
                  style={{ marginTop: 14 }}
                >
                  <Icon
                    name={report.dataQuality.overdue > 0 ? "alert-circle" : "shield"}
                    size={18}
                  />
                  <div>
                    <strong>
                      {report.dataQuality.overdue > 0
                        ? "Remediation is overdue"
                        : "Data quality is inside tolerance"}
                    </strong>
                    <p>
                      {report.dataQuality.overdue > 0
                        ? `${report.dataQuality.overdue} issue${report.dataQuality.overdue === 1 ? "" : "s"} past due — resolve before locking the next cycle.`
                        : "本租户没有逾期的阻断级数据质量问题。"}
                    </p>
                  </div>
                </div>
              </>
            )}
            <div className="detail-section">
              <div className="inline" style={{ justifyContent: "space-between" }}>
                <span className="muted inline">
                  <Icon name={verifyIcon} size={16} />
                  审计哈希链
                </span>
                {auditChain.loading ? (
                  <span className="badge badge--neutral">检查中…</span>
                ) : auditChain.data?.valid ? (
                  <Badge tone="success">已验证</Badge>
                ) : (
                  <Badge tone="danger">需要关注</Badge>
                )}
              </div>
              <div className="inline" style={{ justifyContent: "space-between", marginTop: 10 }}>
                <span className="muted inline">
                  <Icon name="clock" size={16} />
                  报告已生成
                </span>
                <span className="subtle">{formatDateTime(report?.generatedAt)}</span>
              </div>
            </div>
          </Panel>

          <Panel
            title="Recent activity"
            subtitle="Append-only audit trail"
            action={
              <button
                type="button"
                className="icon-button"
                aria-label="Refresh activity"
                onClick={audit.reload}
              >
                <Icon name="refresh" size={16} />
              </button>
            }
            flush
          >
            {audit.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={audit.error} onRetry={audit.reload} />
              </div>
            ) : audit.loading ? (
              <div className="loading-inline">
                <span className="spinner" /> Loading audit trail…
              </div>
            ) : (audit.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon="clock"
                title="No activity recorded"
                description="创建演示周期或业务实体后，审计轨迹会填充 here。"
              />
            ) : (
              <div className="activity-list">
                {audit.data?.map((event) => (
                  <div className="activity-row" key={event.id}>
                    <span className="activity-row__dot" aria-hidden="true" />
                    <div className="activity-row__main">
                      <div className="activity-row__title">
                        <strong>{titleCase(event.action)}</strong> on{" "}
                        {titleCase(event.objectType)}
                        {event.objectId ? ` ${shortId(event.objectId, 8)}` : ""}
                      </div>
                      <div className="activity-row__meta">
                        {event.actorType} · {formatRelative(event.occurredAt)} · seq{" "}
                        {event.sequence}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {canViewTeam ? (
        <Panel
          title="Team aggregate"
          subtitle="仅群体级覆盖；绝不显示个人金额与姓名"
          className="section-gap"
        >
          {team.error ? (
            <ErrorNotice error={team.error} onRetry={team.reload} />
          ) : team.loading || !team.data ? (
            <div className="loading-inline">
              <span className="spinner" /> Loading team aggregate…
            </div>
          ) : team.data.suppressed ? (
            <InfoNotice>
              {team.data.note ??
                "低于最小人数时团队聚合自动抑制。"}{" "}
              Current group size is {team.data.teamSize}; at least{" "}
              {team.data.minimumGroupSize} direct reports are required.
            </InfoNotice>
          ) : (
            <>
              <div className="coverage-grid">
                <div className="coverage-cell">
                  <div className="coverage-cell__label">直属下属</div>
                  <div className="coverage-cell__value">{team.data.teamSize}</div>
                  <div className="coverage-cell__sub">
                    minimum group {team.data.minimumGroupSize}
                  </div>
                </div>
                <div className="coverage-cell">
                  <div className="coverage-cell__label">评价覆盖率</div>
                  <div className="coverage-cell__value">
                    {formatPercent(team.data.evaluations?.coverage ?? 0)}
                  </div>
                  <div className="coverage-cell__sub">
                    {team.data.evaluations?.evaluated ?? 0} of{" "}
                    {team.data.teamSize} evaluated
                  </div>
                </div>
                <div className="coverage-cell">
                  <div className="coverage-cell__label">已确认申报</div>
                  <div className="coverage-cell__value">
                    {team.data.claims?.confirmed ?? 0}
                  </div>
                  <div className="coverage-cell__sub">
                    of {team.data.claims?.total ?? 0} claims
                  </div>
                </div>
                <div className="coverage-cell">
                  <div className="coverage-cell__label">未结申诉</div>
                  <div className="coverage-cell__value">
                    {team.data.appeals?.open ?? 0}
                  </div>
                  <div className="coverage-cell__sub">
                    {team.data.appeals?.total ?? 0} total
                  </div>
                </div>
                <div className="coverage-cell">
                  <div className="coverage-cell__label">工作包</div>
                  <div className="coverage-cell__value">
                    {team.data.workPackages?.total ?? 0}
                  </div>
                  <div className="coverage-cell__sub">
                    {team.data.workPackages?.accepted ?? 0} accepted
                  </div>
                </div>
              </div>
              {Object.keys(team.data.evaluations?.dimensions ?? {}).length >
              0 ? (
                <div className="detail-section">
                  <div className="detail-section__title">维度均值</div>
                  <div className="stack" style={{ gap: 6 }}>
                    {Object.entries(
                      team.data.evaluations?.dimensions ?? {},
                    ).map(([dimension, score]) => (
                      <div
                        key={dimension}
                        className="inline"
                        style={{ justifyContent: "space-between", width: "100%" }}
                      >
                        <span>{titleCase(dimension)}</span>
                        <span className="muted">{score.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </Panel>
      ) : null}

      <Panel
        title="Fairness and appeals"
        subtitle="已发布无报复承诺与申诉聚合结果"
        className="section-gap"
      >
        {appealStats.error ? (
          <ErrorNotice error={appealStats.error} onRetry={appealStats.reload} />
        ) : appealStats.loading || !appealStats.data ? (
          <div className="loading-inline">
            <span className="spinner" /> Loading fairness statement…
          </div>
        ) : (
          <>
            {appealStats.data.commitment ? (
              <div className="detail-section" style={{ marginTop: 0 }}>
                <div className="detail-section__title">
                  No-retaliation commitment · v
                  {appealStats.data.commitment.version} · published{" "}
                  {formatDate(appealStats.data.commitment.publishedAt)}
                </div>
                <p>{appealStats.data.commitment.statement}</p>
                <p className="subtle" style={{ fontSize: 12 }}>
                  Channels:{" "}
                  {appealStats.data.commitment.channels.join(", ") ||
                    "not specified"}
                </p>
              </div>
            ) : (
              <InfoNotice>
                尚未发布无报复承诺。
              </InfoNotice>
            )}
            <div className="coverage-grid">
              <div className="coverage-cell">
                <div className="coverage-cell__label">申诉</div>
                <div className="coverage-cell__value">
                  {appealStats.data.appeals.total}
                </div>
                <div className="coverage-cell__sub">
                  {formatPercent(appealStats.data.appeals.appealRate)} of claims
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">待处理</div>
                <div className="coverage-cell__value">
                  {appealStats.data.appeals.open}
                </div>
                <div className="coverage-cell__sub">
                  {appealStats.data.appeals.overdue} past SLA
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">已关闭</div>
                <div className="coverage-cell__value">
                  {appealStats.data.appeals.closed}
                </div>
                <div className="coverage-cell__sub">
                  avg{" "}
                  {appealStats.data.appeals.averageResolutionDays.toFixed(1)}{" "}
                  days
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">结果</div>
                <div className="coverage-cell__value" style={{ fontSize: 15 }}>
                  {Object.keys(appealStats.data.appeals.resolutions).length === 0
                    ? "No resolution yet"
                    : Object.entries(appealStats.data.appeals.resolutions)
                        .map(
                          ([outcome, count]) =>
                            `${titleCase(outcome)} ${count}`,
                        )
                        .join(" · ")}
                </div>
                <div className="coverage-cell__sub">
                  仅聚合，无个人数据
                </div>
              </div>
            </div>
          </>
        )}
      </Panel>
      <NotificationsPanel />
    </>
  );
}

function EmployeeHome() {
  useDocumentTitle("我的工作台");
  async function downloadDataPackage() {
    try {
      const dataPackage = await api<Record<string, unknown>>(
        "/api/v1/me/data-package",
      );
      const blob = new Blob([JSON.stringify(dataPackage, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "my-data-package.json";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      /* the export limit or auth error is visible through the API */
    }
  }
  const workPackages = useApiQuery<WorkPackage[]>("/api/v1/work-packages");
  const appeals = useApiQuery<AppealCase[]>("/api/v1/appeals");
  const confirmations = useApiQuery<
    Array<{
      id: string;
      targetType: string;
      decision: string;
      createdAt: string;
      confirmedAt?: string;
      objectedAt?: string;
    }>
  >("/api/v1/employee-confirmations");
  const ai = useApiQuery<{
    aiUsed: boolean;
    models: string[];
    notices: Array<{ notice: { id: string; title: string } }>;
    aiScoreProposals: Array<{ id: string; status: string }>;
  }>("/api/v1/me/ai-explanations");
  const team = useApiQuery<TeamAggregateReport>(
    "/api/v1/reports/team-aggregate",
  );

  const activeWork =
    workPackages.data?.filter(
      (workPackage) => !CLOSED_CYCLE_STATUSES.has(workPackage.status),
    ) ?? [];
  const openAppeals =
    appeals.data?.filter(
      (appeal) => !["CLOSED", "DECIDED"].includes(appeal.status),
    ) ?? [];
  const objected =
    confirmations.data?.filter(
      (confirmation) => confirmation.decision === "OBJECTED",
    ) ?? [];
  const pendingAi =
    ai.data?.aiScoreProposals.filter(
      (proposal) => proposal.status === "PENDING",
    ) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="My workspace"
        title="我的工作台"
        description="你的工作、确认、申诉与 AI 记录；团队数据仅聚合展示，低于最小人数自动抑制。"
        actions={
          <>
            <Button
              variant="secondary"
              icon="download"
              onClick={() => void downloadDataPackage()}
            >
              我的数据
            </Button>
            <Link className="btn btn--secondary" to="/contribution">
              <Icon name="layers" size={16} />
              <span>我的工作</span>
            </Link>
            <Link className="btn btn--primary" to="/my-ai">
              <Icon name="ai" size={16} />
              <span>我的 AI 记录</span>
            </Link>
          </>
        }
      />
      <div className="stat-grid">
        <StatTile
          label="Active work"
          value={activeWork.length}
          detail={`${workPackages.data?.length ?? 0} packages in scope`}
          icon="layers"
        />
        <StatTile
          label="未结申诉"
          value={openAppeals.length}
          detail={`${appeals.data?.length ?? 0} total`}
          icon="alert-circle"
          tone={openAppeals.length > 0 ? "warning" : "neutral"}
        />
        <StatTile
          label="Objections"
          value={objected.length}
          detail="Confirmations you objected to"
          icon="check-circle"
          tone={objected.length > 0 ? "warning" : "neutral"}
        />
        <StatTile
          label="AI proposals pending"
          value={pendingAi.length}
          detail={
            ai.data?.aiUsed
              ? `${ai.data.models.join(", ") || "review pending"}`
              : "AI not used for your record"
          }
          icon="ai"
        />
      </div>
      <div className="split-grid section-gap">
        <Panel title="我的工作" subtitle="Packages where you own or contribute">
          {workPackages.error ? (
            <ErrorNotice
              error={workPackages.error}
              onRetry={workPackages.reload}
            />
          ) : workPackages.loading ? (
            <LoadingRows rows={3} />
          ) : (workPackages.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="layers"
              title="暂无工作包"
              description="分配给你的工作会出现在这里。"
            />
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {workPackages.data?.slice(0, 5).map((workPackage) => (
                <div
                  key={workPackage.id}
                  className="inline"
                  style={{ justifyContent: "space-between", width: "100%" }}
                >
                  <span>{workPackage.title}</span>
                  <Badge status={workPackage.status} />
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="My appeals" subtitle="独立复核与证据公开">
          {appeals.error ? (
            <ErrorNotice error={appeals.error} onRetry={appeals.reload} />
          ) : appeals.loading ? (
            <LoadingRows rows={3} />
          ) : (appeals.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="approvals"
              title="暂无申诉"
              description="你的申诉与证据公开记录会出现在这里。"
            />
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {appeals.data?.slice(0, 5).map((appeal) => (
                <div
                  key={appeal.id}
                  className="inline"
                  style={{ justifyContent: "space-between", width: "100%" }}
                >
                  <span>{appeal.reasonCode}</span>
                  <span className="muted">
                    <Badge status={appeal.status} />{" "}
                    {appeal.dueAt ? formatDate(appeal.dueAt) : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
      <div className="split-grid section-gap">
        <Panel title="My confirmation record">
          {confirmations.error ? (
            <ErrorNotice
              error={confirmations.error}
              onRetry={confirmations.reload}
            />
          ) : confirmations.loading ? (
            <LoadingRows rows={2} />
          ) : (confirmations.data?.length ?? 0) === 0 ? (
            <p className="muted">暂无确认记录。</p>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {confirmations.data?.slice(0, 6).map((confirmation) => (
                <div
                  key={confirmation.id}
                  className="inline"
                  style={{ justifyContent: "space-between", width: "100%" }}
                >
                  <span>{titleCase(confirmation.targetType)}</span>
                  <span className="muted">
                    {titleCase(confirmation.decision)} ·{" "}
                    {formatDateTime(confirmation.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="My team aggregate" subtitle="No individual names or amounts">
          {team.error ? (
            <p className="muted">
              未关联汇报关系前团队聚合不可用。
            </p>
          ) : team.loading ? (
            <LoadingRows rows={2} />
          ) : team.data?.suppressed ? (
            <p className="muted">
              团队人数低于最小值，已抑制。
            </p>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              <div className="inline" style={{ justifyContent: "space-between" }}>
                <span>团队人数</span>
                <span className="muted">{team.data?.teamSize}</span>
              </div>
              <div className="inline" style={{ justifyContent: "space-between" }}>
                <span>已评测</span>
                <span className="muted">
                  {team.data?.evaluations?.evaluated ?? 0}
                </span>
              </div>
            </div>
          )}
        </Panel>
      </div>
      <NotificationsPanel />
    </>
  );
}

/* ------------------------------------------------------------ notifications */

function NotificationsPanel() {
  const notifications = useApiQuery<NotificationView[]>(
    "/api/v1/notifications",
  );
  const list = notifications.data ?? [];
  const unread = list.filter((item) => !item.readAt).length;

  async function markRead(id: string) {
    try {
      await api(`/api/v1/notifications/${id}/read`, { method: "POST" });
      notifications.reload();
    } catch {
      notifications.reload();
    }
  }

  return (
    <Panel
      title="通知"
      subtitle={unread > 0 ? `${unread} unread` : "All caught up"}
      className="section-gap"
      flush
    >
      {notifications.error ? (
        <div style={{ padding: 16 }}>
          <ErrorNotice
            error={notifications.error}
            onRetry={notifications.reload}
          />
        </div>
      ) : notifications.loading ? (
        <div style={{ padding: 16 }}>
          <LoadingRows rows={2} />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon="approvals"
          title="No notification"
          description="提醒、审批与结算事件会出现在这里。"
        />
      ) : (
        <div className="activity-list">
          {list.slice(0, 12).map((item) => (
            <div className="activity-row" key={item.id}>
              <span
                className="activity-row__dot"
                aria-hidden="true"
                style={{ opacity: item.readAt ? 0.3 : 1 }}
              />
              <div className="activity-row__main">
                <div className="activity-row__title">
                  <strong>{item.title}</strong>
                </div>
                <div className="activity-row__meta">
                  {item.body} · {formatRelative(item.createdAt)}
                </div>
              </div>
              <div className="cell-actions">
                {item.readAt ? (
                  <span className="subtle">已读</span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void markRead(item.id)}
                  >
                    标记已读
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}


interface AgentScanFinding {
  skill: string;
  severity?: string;
  summary?: string;
  detail?: string;
}

function AiWorkbench({ privileged }: { privileged: boolean }) {
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const [findings, setFindings] = useState<AgentScanFinding[] | null>(null);

  async function runScan() {
    setScanning(true);
    try {
      const result = await api<{ findings?: AgentScanFinding[] }>(
        "/api/v1/agent-tasks/scan",
        { method: "POST", body: {} },
      );
      setFindings(result.findings ?? []);
      toast.success("智能扫描完成", `共 ${result.findings?.length ?? 0} 条发现`);
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "扫描失败，请稍后再试",
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="stack">
      <div className="row-actions">
        <span className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: "var(--brand)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
            }}
            aria-hidden="true"
          >
            ✨
          </span>
          AI 仅建议，人工拍板：
        </span>
        <Button
          variant="primary"
          loading={scanning}
          onClick={() => void runScan()}
        >
          {privileged ? "发起智能扫描" : "查看我的 AI 记录"}
        </Button>
        {!privileged ? (
          <a className="btn btn--secondary" href="/console/my-ai">
            我的 AI 记录
          </a>
        ) : null}
      </div>
      {findings ? (
        findings.length === 0 ? (
          <InfoNotice>本轮扫描没有发现需要处理的事项。</InfoNotice>
        ) : (
          <div className="stat-grid stat-grid--three">
            {findings.slice(0, 6).map((finding, index) => (
              <div className="stat-tile" key={index}>
                <div className="stat-tile__top">
                  <span className="stat-tile__label">{finding.skill}</span>
                </div>
                <div className="stat-tile__value" style={{ fontSize: 18 }}>
                  {finding.severity ?? "INFO"}
                </div>
                <div className="stat-tile__detail">
                  {finding.summary ?? finding.detail ?? "查看详情"}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <InfoNotice>
          点击「发起智能扫描」，Agent 会检查证据缺口、结算就绪度与数据质量阻塞项，并给出建议；高影响动作始终等待人工批准。
        </InfoNotice>
      )}
    </div>
  );
}
