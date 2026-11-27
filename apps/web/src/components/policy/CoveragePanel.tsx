import { Badge, ErrorNotice, InfoNotice, LoadingRows, Panel } from "../ui.js";
import { formatDateTime, formatPercent, titleCase } from "../../lib/format.js";
import type {
  OperationsCoverageReport,
  SuccessMetricsReport,
} from "../../lib/types.js";
import type { QueryState } from "../../lib/hooks.js";

export interface CoveragePanelProps {
  coverage: QueryState<OperationsCoverageReport>;
  successMetrics: QueryState<SuccessMetricsReport>;
}

export function CoveragePanel({
  coverage,
  successMetrics,
}: CoveragePanelProps) {
  return (
    <Panel
      title="运营覆盖"
      subtitle="跨模块证据与数据质量态势"
    >
      {coverage.error ? (
        <ErrorNotice error={coverage.error} onRetry={coverage.reload} />
      ) : coverage.loading || !coverage.data ? (
        <LoadingRows rows={4} />
      ) : (
        <>
          <div className="coverage-grid">
            <div className="coverage-cell">
              <div className="coverage-cell__label">证据覆盖率</div>
              <div className="coverage-cell__value">
                {formatPercent(coverage.data.workPackages.evidenceCoverageRate)}
              </div>
              <div className="coverage-cell__sub">
                {coverage.data.workPackages.withEvidence} of{" "}
                {coverage.data.workPackages.accepted} accepted
              </div>
            </div>
            <div className="coverage-cell">
              <div className="coverage-cell__label">申报</div>
              <div className="coverage-cell__value">
                {coverage.data.claims.total}
              </div>
              <div className="coverage-cell__sub">
                {coverage.data.claims.confirmed} confirmed ·{" "}
                {coverage.data.claims.rejected} rejected
              </div>
            </div>
            <div className="coverage-cell">
              <div className="coverage-cell__label">交付物</div>
              <div className="coverage-cell__value">
                {coverage.data.deliverables.total}
              </div>
              <div className="coverage-cell__sub">
                {coverage.data.deliverables.pendingAcceptance} pending
              </div>
            </div>
            <div className="coverage-cell">
              <div className="coverage-cell__label">数据质量</div>
              <div className="coverage-cell__value">
                {coverage.data.dataQuality.open}
              </div>
              <div className="coverage-cell__sub">
                {coverage.data.dataQuality.overdue} overdue ·{" "}
                {coverage.data.dataQuality.escalated} escalated
              </div>
            </div>
          </div>
          <div className="detail-section">
            <div className="detail-section__title">申诉与争议</div>
            <div className="coverage-grid">
              <div className="coverage-cell">
                <div className="coverage-cell__label">未结申诉</div>
                <div className="coverage-cell__value">
                  {coverage.data.appeals?.open ?? 0}
                </div>
                <div className="coverage-cell__sub">
                  {coverage.data.appeals?.overdue ?? 0} past SLA
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">申诉率</div>
                <div className="coverage-cell__value">
                  {formatPercent(coverage.data.appeals?.appealRate ?? 0, 1)}
                </div>
                <div className="coverage-cell__sub">
                  of {coverage.data.claims.total} claims
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">已结申诉</div>
                <div className="coverage-cell__value">
                  {coverage.data.appeals?.closed ?? 0}
                </div>
                <div className="coverage-cell__sub">已裁决并关闭</div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">SLA 状态</div>
                <div className="coverage-cell__value" style={{ fontSize: 15 }}>
                  {(coverage.data.appeals?.overdue ?? 0) > 0 ? (
                    <Badge tone="danger">已违反</Badge>
                  ) : (
                    <Badge tone="success">SLA 内</Badge>
                  )}
                </div>
                <div className="coverage-cell__sub">
                  申诉创建时配置
                </div>
              </div>
            </div>
          </div>
          <div className="detail-section">
            <div className="detail-section__title">周期耗时</div>
            <div className="coverage-grid">
              <div className="coverage-cell">
                <div className="coverage-cell__label">
                  工作包验收
                </div>
                <div className="coverage-cell__value">
                  {(
                    coverage.data.cycleTimes
                      ?.workPackageAcceptanceHours ?? 0
                  ).toFixed(1)}
                  h
                </div>
                <div className="coverage-cell__sub">
                  created → accepted
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">
                  申报决策
                </div>
                <div className="coverage-cell__value">
                  {(
                    coverage.data.cycleTimes?.claimDecisionHours ?? 0
                  ).toFixed(1)}
                  h
                </div>
                <div className="coverage-cell__sub">
                  submitted → decision
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">
                  员工确认
                </div>
                <div className="coverage-cell__value">
                  {(
                    coverage.data.cycleTimes?.confirmationHours ?? 0
                  ).toFixed(1)}
                  h
                </div>
                <div className="coverage-cell__sub">
                  calculated → confirmed / objected
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">
                  薪酬审批
                </div>
                <div className="coverage-cell__value">
                  {(
                    coverage.data.cycleTimes?.payrollApprovalHours ?? 0
                  ).toFixed(1)}
                  h
                </div>
                <div className="coverage-cell__sub">
                  created → approved
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">
                  申诉裁决
                </div>
                <div className="coverage-cell__value">
                  {(
                    coverage.data.cycleTimes?.appealResolutionHours ?? 0
                  ).toFixed(1)}
                  h
                </div>
                <div className="coverage-cell__sub">
                  submitted → resolved
                </div>
              </div>
            </div>
            {coverage.data.cycleTimes?.byResponsibility?.length ? (
              <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                {coverage.data.cycleTimes.byResponsibility.map((row) => (
                  <div
                    key={row.responsibilityCode}
                    className="inline"
                    style={{
                      justifyContent: "space-between",
                      width: "100%",
                    }}
                  >
                    <span>{titleCase(row.responsibilityCode)}</span>
                    <span className="muted">
                      {[
                        `acceptance ${row.workPackageAcceptanceHours.toFixed(1)}h (${row.workPackageSamples})`,
                        `decision ${row.claimDecisionHours.toFixed(1)}h (${row.claimSamples})`,
                        `confirm ${row.confirmationHours.toFixed(1)}h (${row.confirmationSamples})`,
                        `payroll ${row.payrollApprovalHours.toFixed(1)}h (${row.payrollSamples})`,
                        `appeal ${row.appealResolutionHours.toFixed(1)}h (${row.appealSamples})`,
                      ].join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          {successMetrics.data ? (
            <div className="detail-section">
              <div className="detail-section__title">
                PRD success metrics · {successMetrics.data.overall}
              </div>
              <div className="stack" style={{ gap: 6 }}>
                {successMetrics.data.metrics.map((metric) => (
                  <div
                    key={metric.id}
                    className="inline"
                    style={{
                      justifyContent: "space-between",
                      width: "100%",
                    }}
                  >
                    <span>{metric.label}</span>
                    <span className="muted">
                      {metric.value === null
                        ? "unavailable"
                        : metric.unit === "RATIO"
                          ? formatPercent(metric.value)
                          : metric.value}
                      {metric.unit === "HOURS"
                        ? "h"
                        : metric.unit === "MINUTES"
                          ? "m"
                          : ""}{" "}
                      · target {metric.comparator}{" "}
                      {metric.unit === "RATIO"
                        ? formatPercent(metric.target)
                        : metric.target}{" "}
                      · {metric.status}
                    </span>
                  </div>
                ))}
              </div>
              <p className="subtle" style={{ fontSize: 12 }}>
                Employee evidence supplement time is unavailable because
                the product does not time sessions.
              </p>
            </div>
          ) : null}
          <div className="split-grid section-gap">
            <div className="detail-section" style={{ marginTop: 0 }}>
              <div className="detail-section__title">
                按职责覆盖率
              </div>
              {coverage.data.workPackages.coverageByResponsibility.length === 0 ? (
                <p className="muted">暂无带角色的已验收工作包。</p>
              ) : (
                <div className="stack" style={{ gap: 6 }}>
                  {coverage.data.workPackages.coverageByResponsibility.map(
                    (row) => (
                      <div
                        key={row.responsibilityCode}
                        className="inline"
                        style={{ justifyContent: "space-between", width: "100%" }}
                      >
                        <span>{titleCase(row.responsibilityCode)}</span>
                        <span className="muted">
                          {formatPercent(row.coverageRate)} ·{" "}
                          {row.withEvidence}/{row.total}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
            <div className="detail-section" style={{ marginTop: 0 }}>
              <div className="detail-section__title">
                按订单类型覆盖率
              </div>
              {coverage.data.workPackages.coverageByOrderType.length === 0 ? (
                <p className="muted">暂无关联计算的工作包。</p>
              ) : (
                <div className="stack" style={{ gap: 6 }}>
                  {coverage.data.workPackages.coverageByOrderType.map((row) => (
                    <div
                      key={row.orderType}
                      className="inline"
                      style={{ justifyContent: "space-between", width: "100%" }}
                    >
                      <span>{titleCase(row.orderType)}</span>
                      <span className="muted">
                        {formatPercent(row.coverageRate)} ·{" "}
                        {row.withEvidence}/{row.total}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="detail-section" style={{ marginTop: 0 }}>
              <div className="detail-section__title">
                按任务类型覆盖率
              </div>
              {coverage.data.workPackages.coverageByPackageType.length === 0 ? (
                <p className="muted">暂无已验收的工作包。</p>
              ) : (
                <div className="stack" style={{ gap: 6 }}>
                  {coverage.data.workPackages.coverageByPackageType.map((row) => (
                    <div
                      key={row.packageType}
                      className="inline"
                      style={{ justifyContent: "space-between", width: "100%" }}
                    >
                      <span>{titleCase(row.packageType)}</span>
                      <span className="muted">
                        {formatPercent(row.coverageRate)} ·{" "}
                        {row.withEvidence}/{row.total}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="detail-section">
            <div className="detail-section__title">
              按月覆盖趋势
            </div>
            {coverage.data.workPackages.coverageTrend.length === 0 ? (
              <p className="muted">暂无已验收的工作包。</p>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {coverage.data.workPackages.coverageTrend
                  .slice(-6)
                  .map((row) => (
                    <div
                      key={row.period}
                      className="inline"
                      style={{
                        justifyContent: "space-between",
                        width: "100%",
                      }}
                    >
                      <span>{row.period}</span>
                      <span className="muted">
                        {formatPercent(row.coverageRate)} ·{" "}
                        {row.withEvidence}/{row.total}
                      </span>
                    </div>
                  ))}
              </div>
            )}
            {coverage.data.workPackages.coverageTrendByPackageType.length ? (
              <div className="stack" style={{ gap: 4, marginTop: 10 }}>
                {coverage.data.workPackages.coverageTrendByPackageType.map(
                  (series) => (
                    <div
                      key={series.packageType}
                      className="inline"
                      style={{
                        justifyContent: "space-between",
                        width: "100%",
                      }}
                    >
                      <span>{titleCase(series.packageType)}</span>
                      <span className="muted">
                        {series.periods
                          .slice(-6)
                          .map(
                            (period) =>
                              `${period.period} ${formatPercent(
                                period.coverageRate,
                              )}`,
                          )
                          .join(" · ")}
                      </span>
                    </div>
                  ),
                )}
              </div>
            ) : null}
          </div>
          <InfoNotice>
            Generated {formatDateTime(coverage.data.generatedAt)}. Coverage is
            recomputed from live tenant records on refresh.
          </InfoNotice>
        </>
      )}
    </Panel>
  );
}
