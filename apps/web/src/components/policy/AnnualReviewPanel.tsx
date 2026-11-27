import { ErrorNotice, InfoNotice, LoadingRows, Panel } from "../ui.js";
import {
  formatDate,
  formatDateTime,
  formatPercent,
  shortId,
  titleCase,
} from "../../lib/format.js";
import type { PolicyReviewReport, SubgroupImpactReport } from "../../lib/types.js";
import type { QueryState } from "../../lib/hooks.js";

export interface AnnualReviewPanelProps {
  review: QueryState<PolicyReviewReport>;
  subgroup: QueryState<SubgroupImpactReport>;
}

export function AnnualReviewPanel({
  review,
  subgroup,
}: AnnualReviewPanelProps) {
  return (
    <Panel
      title="年度政策审查"
      subtitle="政策/申诉/AI 复核/隐私证据的滚动 12 个月视图"
    >
      {review.error ? (
        <ErrorNotice error={review.error} onRetry={review.reload} />
      ) : review.loading || !review.data ? (
        <LoadingRows rows={4} />
      ) : (
        <>
          <div className="coverage-grid">
            <div className="coverage-cell">
              <div className="coverage-cell__label">已发布政策</div>
              <div className="coverage-cell__value">
                {review.data.policies.published}
              </div>
              <div className="coverage-cell__sub">
                {review.data.policies.versionsInScope} versions in scope
              </div>
            </div>
            <div className="coverage-cell">
              <div className="coverage-cell__label">员工告知确认</div>
              <div className="coverage-cell__value">
                {review.data.notices.complete}/{review.data.notices.total}
              </div>
              <div className="coverage-cell__sub">
                {review.data.notices.incomplete} incomplete
              </div>
            </div>
            <div className="coverage-cell">
              <div className="coverage-cell__label">未结申诉</div>
              <div className="coverage-cell__value">
                {review.data.appeals.open}
              </div>
              <div className="coverage-cell__sub">
                {review.data.appeals.overdue} past SLA ·{" "}
                {review.data.appeals.closed} closed
              </div>
            </div>
            <div className="coverage-cell">
              <div className="coverage-cell__label">AI 采纳率</div>
              <div className="coverage-cell__value">
                {formatPercent(review.data.aiReview.acceptanceRate, 1)}
              </div>
              <div className="coverage-cell__sub">
                {review.data.aiReview.accepted} of{" "}
                {review.data.aiReview.decided} decided
              </div>
            </div>
            <div className="coverage-cell">
              <div className="coverage-cell__label">人工改判</div>
              <div className="coverage-cell__value">
                {review.data.aiReview.overrides}
              </div>
              <div className="coverage-cell__sub">
                {review.data.aiReview.blindReviews} independent-first reviews
              </div>
            </div>
            <div className="coverage-cell">
              <div className="coverage-cell__label">数据质量</div>
              <div className="coverage-cell__value">
                {review.data.dataQuality.open}
              </div>
              <div className="coverage-cell__sub">
                {review.data.dataQuality.overdue} overdue ·{" "}
                {review.data.dataQuality.escalated} escalated
              </div>
            </div>
            <div className="coverage-cell">
              <div className="coverage-cell__label">评价决策</div>
              <div className="coverage-cell__value">
                {review.data.evaluations.decisions}
              </div>
              <div className="coverage-cell__sub">
                {review.data.evaluations.drafts} AI drafts
              </div>
            </div>
            <div className="coverage-cell">
              <div className="coverage-cell__label">隐私</div>
              <div className="coverage-cell__value">
                {review.data.privacy.approvedDpias}/
                {review.data.privacy.dpias}
              </div>
              <div className="coverage-cell__sub">
                {review.data.privacy.openDsars} open data requests
              </div>
            </div>
          </div>
          <div className="split-grid section-gap">
            <div className="detail-section" style={{ marginTop: 0 }}>
              <div className="detail-section__title">申诉结果</div>
              {Object.keys(review.data.appeals.outcomes).length === 0 ? (
                <p className="muted">区间内无已结申诉。</p>
              ) : (
                <div className="stack" style={{ gap: 6 }}>
                  {Object.entries(review.data.appeals.outcomes).map(
                    ([outcome, count]) => (
                      <div
                        key={outcome}
                        className="inline"
                        style={{ justifyContent: "space-between", width: "100%" }}
                      >
                        <span>{titleCase(outcome)}</span>
                        <span className="muted">{count}</span>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
            <div className="detail-section" style={{ marginTop: 0 }}>
              <div className="detail-section__title">评测证据</div>
              <div className="stack" style={{ gap: 6 }}>
                <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                  <span>评测台运行</span>
                  <span className="muted">
                    {review.data.aiReview.harnessEvaluations}
                  </span>
                </div>
                <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                  <span>已决 AI 提案</span>
                  <span className="muted">
                    {review.data.aiReview.decided}/{review.data.aiReview.total}
                  </span>
                </div>
                <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                  <span>高风险提案</span>
                  <span className="muted">
                    {review.data.aiReview.highRiskProposals}
                  </span>
                </div>
                <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                  <span>第二复核 SLA</span>
                  <span className="muted">
                    {review.data.aiReview.secondReviewOverdue} overdue ·{" "}
                    {review.data.aiReview.secondReviewSlaBreaches} breached
                  </span>
                </div>
                <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                  <span>已认定申报数</span>
                  <span className="muted">
                    {review.data.claims.decided}/{review.data.claims.total}
                  </span>
                </div>
              </div>
            </div>
          </div>
          {review.data.trustSurvey.available ? (
            <div className="detail-section">
              <div className="detail-section__title">
                Trust and procedural fairness ·{" "}
                {review.data.trustSurvey.period} ·{" "}
                {review.data.trustSurvey.responseCount} responses
              </div>
              <div className="stack" style={{ gap: 6 }}>
                {Object.entries(
                  review.data.trustSurvey.dimensions,
                ).map(([dimension, score]) => {
                  const baseline =
                    review.data?.trustSurvey.available
                      ? review.data.trustSurvey.baseline?.dimensions[
                          dimension
                        ]
                      : undefined;
                  return (
                    <div
                      key={dimension}
                      className="inline"
                      style={{
                        justifyContent: "space-between",
                        width: "100%",
                      }}
                    >
                      <span>{titleCase(dimension)}</span>
                      <span className="muted">
                        {score.toFixed(2)} / 5
                        {baseline !== undefined
                          ? ` · baseline ${baseline.toFixed(2)}`
                          : " · no baseline"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <InfoNotice tone="warning">
              {review.data.trustSurvey.note}
            </InfoNotice>
          )}
          <div className="detail-section">
            <div className="detail-section__title">
              Reviewer consistency ·{" "}
              {review.data.reviewConsistency.claimsDecided} claims decided
            </div>
            {review.data.reviewConsistency.reviewers.length === 0 ? (
              <p className="muted">区间内无认定决策。</p>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {review.data.reviewConsistency.reviewers.map(
                  (reviewer) => (
                    <div
                      key={reviewer.reviewerPersonId}
                      className="inline"
                      style={{
                        justifyContent: "space-between",
                        width: "100%",
                      }}
                    >
                      <span className="mono">
                        {shortId(reviewer.reviewerPersonId, 10)}
                      </span>
                      <span className="muted">
                        {reviewer.decisions} decisions ·{" "}
                        {formatPercent(reviewer.confirmedRate)} confirmed ·{" "}
                        {formatPercent(reviewer.rejectedRate)} rejected ·{" "}
                        {reviewer.averageDaysToDecision.toFixed(1)}d avg
                      </span>
                    </div>
                  ),
                )}
                <div
                  className="inline"
                  style={{
                    justifyContent: "space-between",
                    width: "100%",
                  }}
                >
                  <span>重复决策</span>
                  <span className="muted">
                    {review.data.reviewConsistency.claimsWithMultipleDecisions}{" "}
                    · {review.data.reviewConsistency.claimsWithChangedOutcome}{" "}
                    changed outcome
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="detail-section">
            <div className="detail-section__title">
              Subgroup fairness · aggregate-only
            </div>
            {!subgroup.data?.available ? (
              <InfoNotice tone="warning">
                {subgroup.data?.note ??
                  "No consent-backed subgroup labels are available."}
              </InfoNotice>
            ) : (
              <div className="stack">
                <p className="muted">
                  Groups below {subgroup.data.thresholds.minimumReportableGroupSize} are
                  suppressed; groups below{" "}
                  {subgroup.data.thresholds.minimumQuantitativeGroupSize} are
                  qualitative only. Protected labels are never used for an
                  individual decision.
                </p>
                {Object.entries(subgroup.data.dimensions).map(
                  ([dimension, summary]) => (
                    <div key={dimension} className="detail-section">
                      <div className="detail-section__title">
                        {titleCase(dimension)} · {summary.reportedGroups} groups
                        {summary.suppressedGroups > 0
                          ? ` · ${summary.suppressedGroups} suppressed`
                          : ""}
                      </div>
                      <div className="stack" style={{ gap: 6 }}>
                        {summary.groups.map((group) => (
                          <div
                            key={group.value}
                            className="inline"
                            style={{
                              justifyContent: "space-between",
                              width: "100%",
                            }}
                          >
                            <span>{group.value}</span>
                            <span className="muted">
                              n={group.headcount}
                              {!summary.outcomesAvailable
                                ? " · outcomes unavailable"
                                : group.quantitative && group.metrics
                                  ? ` · mean ${group.metrics.meanIncentiveAmount.toFixed(2)} · selection ${formatPercent(group.metrics.positivePayoutRate)} · ratio ${group.metrics.adverseImpactRatio?.toFixed(2) ?? "—"}`
                                  : " · qualitative review only"}
                              {group.flags.includes(
                                "ADVERSE_IMPACT_BELOW_FOUR_FIFTHS",
                              )
                                ? " · below four-fifths"
                                : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
          <p className="subtle" style={{ fontSize: 12 }}>
            Window {formatDate(review.data.from)} – {formatDate(review.data.to)}.
            Generated {formatDateTime(review.data.generatedAt)}.
          </p>
        </>
      )}
    </Panel>
  );
}
