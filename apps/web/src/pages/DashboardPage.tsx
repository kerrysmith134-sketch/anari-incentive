import { Link } from "react-router-dom";
import {
  Badge,
  EmptyState,
  ErrorNotice,
  InfoNotice,
  LoadingRows,
  PageHeader,
  Panel,
  StatTile,
} from "../components/ui.js";
import { Icon } from "../components/Icon.js";
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
        eyebrow="Control room"
        title="Operations overview"
        description="Contribution assurance, approval gates and reward settlement in one place. Numbers reflect this tenant's live ledger."
        actions={
          <>
            <Link className="btn btn--secondary" to="/policy">
              <Icon name="policy" size={16} />
              <span>Readiness</span>
            </Link>
            <Link className="btn btn--primary" to="/approvals">
              <Icon name="approvals" size={16} />
              <span>Approval queue</span>
            </Link>
          </>
        }
      />

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
              : " · high-risk actions stay gated until a human decides"}
          </span>
          <Link className="btn btn--secondary btn--sm" to="/approvals">
            Review queue
            <Icon name="chevron-right" size={14} />
          </Link>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatTile
          label="Active cycles"
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
              "No payroll run yet"
            )
          }
          icon="wallet"
          tone={blockedRuns.length > 0 ? "critical" : "neutral"}
        />
        <StatTile
          label="Open bounties"
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
            title="Approval queue"
            subtitle="Gated actions waiting for a human decision"
            action={
              <Link className="btn btn--quiet btn--sm" to="/approvals">
                View all
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
                description="No action is waiting for approval. New T2/T3 requests will appear here."
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
            title="Payroll runs"
            subtitle="Most recent settlement periods"
            action={
              <Link className="btn btn--quiet btn--sm" to="/payroll">
                Open payroll
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
                title="No payroll run yet"
                description="Create a draft run from declared employment contracts to begin a settlement period."
                action={
                  <Link className="btn btn--primary btn--sm" to="/payroll">
                    Go to payroll
                  </Link>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Status</th>
                      <th className="cell-num">Gross</th>
                      <th className="cell-num">Net</th>
                      <th>Updated</th>
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
            <Panel title="Rewards" subtitle="Equity and open work">
              <div className="coverage-grid">
                <div className="coverage-cell">
                  <div className="coverage-cell__label">Active grants</div>
                  <div className="coverage-cell__value">{activeGrants.length}</div>
                  <div className="coverage-cell__sub">
                    {grants.data?.length ?? 0} total
                  </div>
                </div>
                <div className="coverage-cell">
                  <div className="coverage-cell__label">Open bounties</div>
                  <div className="coverage-cell__value">{openBounties.length}</div>
                  <div className="coverage-cell__sub">
                    {bounties.data?.length ?? 0} total
                  </div>
                </div>
              </div>
              <div className="detail-section">
                {openBounties.length === 0 ? (
                  <p className="muted">No bounty is open right now.</p>
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
                Open rewards
                <Icon name="chevron-right" size={13} />
              </Link>
            </Panel>

            <Panel title="Integrations" subtitle="Payload movement">
              <div className="two-col">
                <div className="coverage-cell" style={{ border: "1px solid var(--line-soft)", borderRadius: 10 }}>
                  <div className="coverage-cell__label">Connected</div>
                  <div className="coverage-cell__value">{activeConnections.length}</div>
                  <div className="coverage-cell__sub">
                    of {connections.data?.length ?? 0} configured
                  </div>
                </div>
                <div className="coverage-cell" style={{ border: "1px solid var(--line-soft)", borderRadius: 10 }}>
                  <div className="coverage-cell__label">Last sync</div>
                  <div className="coverage-cell__value" style={{ fontSize: 15 }}>
                    {lastSync ? formatRelative(lastSync) : "—"}
                  </div>
                  <div className="coverage-cell__sub">across providers</div>
                </div>
              </div>
              <div className="detail-section">
                {connections.loading ? (
                  <div className="loading-inline">
                    <span className="spinner" /> Loading connections…
                  </div>
                ) : (connections.data?.length ?? 0) === 0 ? (
                  <p className="muted">No connection configured yet.</p>
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
                Open integrations
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
                Reports
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
                    <div className="coverage-cell__label">Evidence coverage</div>
                    <div className="coverage-cell__value">
                      {formatPercent(report.workPackages.evidenceCoverageRate)}
                    </div>
                    <div className="coverage-cell__sub">
                      {report.workPackages.withEvidence} of{" "}
                      {report.workPackages.accepted} accepted packages
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Confirmed claims</div>
                    <div className="coverage-cell__value">{report.claims.confirmed}</div>
                    <div className="coverage-cell__sub">
                      {report.claims.pending} in review
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Deliverables</div>
                    <div className="coverage-cell__value">
                      {report.deliverables.pendingAcceptance}
                    </div>
                    <div className="coverage-cell__sub">pending acceptance</div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Open data issues</div>
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
                        : "No blocking data-quality issue is overdue for this tenant."}
                    </p>
                  </div>
                </div>
              </>
            )}
            <div className="detail-section">
              <div className="inline" style={{ justifyContent: "space-between" }}>
                <span className="muted inline">
                  <Icon name={verifyIcon} size={16} />
                  Audit hash chain
                </span>
                {auditChain.loading ? (
                  <span className="badge badge--neutral">Checking…</span>
                ) : auditChain.data?.valid ? (
                  <Badge tone="success">Verified</Badge>
                ) : (
                  <Badge tone="danger">Needs attention</Badge>
                )}
              </div>
              <div className="inline" style={{ justifyContent: "space-between", marginTop: 10 }}>
                <span className="muted inline">
                  <Icon name="clock" size={16} />
                  Report generated
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
                description="Seed a demo cycle or create an entity to populate the audit trail."
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
          subtitle="Group-level coverage only; individual amounts and names are never shown"
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
                "Team aggregates are suppressed below the minimum group size."}{" "}
              Current group size is {team.data.teamSize}; at least{" "}
              {team.data.minimumGroupSize} direct reports are required.
            </InfoNotice>
          ) : (
            <>
              <div className="coverage-grid">
                <div className="coverage-cell">
                  <div className="coverage-cell__label">Direct reports</div>
                  <div className="coverage-cell__value">{team.data.teamSize}</div>
                  <div className="coverage-cell__sub">
                    minimum group {team.data.minimumGroupSize}
                  </div>
                </div>
                <div className="coverage-cell">
                  <div className="coverage-cell__label">Evaluation coverage</div>
                  <div className="coverage-cell__value">
                    {formatPercent(team.data.evaluations?.coverage ?? 0)}
                  </div>
                  <div className="coverage-cell__sub">
                    {team.data.evaluations?.evaluated ?? 0} of{" "}
                    {team.data.teamSize} evaluated
                  </div>
                </div>
                <div className="coverage-cell">
                  <div className="coverage-cell__label">Confirmed claims</div>
                  <div className="coverage-cell__value">
                    {team.data.claims?.confirmed ?? 0}
                  </div>
                  <div className="coverage-cell__sub">
                    of {team.data.claims?.total ?? 0} claims
                  </div>
                </div>
                <div className="coverage-cell">
                  <div className="coverage-cell__label">Open appeals</div>
                  <div className="coverage-cell__value">
                    {team.data.appeals?.open ?? 0}
                  </div>
                  <div className="coverage-cell__sub">
                    {team.data.appeals?.total ?? 0} total
                  </div>
                </div>
                <div className="coverage-cell">
                  <div className="coverage-cell__label">Work packages</div>
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
                  <div className="detail-section__title">Dimension averages</div>
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
        subtitle="Published no-retaliation statement and aggregate appeal outcomes"
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
                No no-retaliation commitment has been published yet.
              </InfoNotice>
            )}
            <div className="coverage-grid">
              <div className="coverage-cell">
                <div className="coverage-cell__label">Appeals</div>
                <div className="coverage-cell__value">
                  {appealStats.data.appeals.total}
                </div>
                <div className="coverage-cell__sub">
                  {formatPercent(appealStats.data.appeals.appealRate)} of claims
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">Open</div>
                <div className="coverage-cell__value">
                  {appealStats.data.appeals.open}
                </div>
                <div className="coverage-cell__sub">
                  {appealStats.data.appeals.overdue} past SLA
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">Closed</div>
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
                <div className="coverage-cell__label">Outcomes</div>
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
                  aggregate only, no personal data
                </div>
              </div>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

function EmployeeHome() {
  useDocumentTitle("My overview");
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
        title="My overview"
        description="Your work, confirmations, appeals and AI record. Team data is aggregate-only and suppressed below the minimum group size."
        actions={
          <>
            <Link className="btn btn--secondary" to="/contribution">
              <Icon name="layers" size={16} />
              <span>My work</span>
            </Link>
            <Link className="btn btn--primary" to="/my-ai">
              <Icon name="ai" size={16} />
              <span>My AI record</span>
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
          label="Open appeals"
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
        <Panel title="My work" subtitle="Packages where you own or contribute">
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
              title="No work package"
              description="Work assigned to you will appear here."
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
        <Panel title="My appeals" subtitle="Independent review and evidence disclosure">
          {appeals.error ? (
            <ErrorNotice error={appeals.error} onRetry={appeals.reload} />
          ) : appeals.loading ? (
            <LoadingRows rows={3} />
          ) : (appeals.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="approvals"
              title="No appeal"
              description="Your appeals and their evidence disclosures will appear here."
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
            <p className="muted">No confirmation recorded yet.</p>
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
              Team aggregate is unavailable until a manager is linked.
            </p>
          ) : team.loading ? (
            <LoadingRows rows={2} />
          ) : team.data?.suppressed ? (
            <p className="muted">
              Suppressed because the team is below the minimum group size.
            </p>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              <div className="inline" style={{ justifyContent: "space-between" }}>
                <span>Team size</span>
                <span className="muted">{team.data?.teamSize}</span>
              </div>
              <div className="inline" style={{ justifyContent: "space-between" }}>
                <span>Evaluated</span>
                <span className="muted">
                  {team.data?.evaluations?.evaluated ?? 0}
                </span>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
