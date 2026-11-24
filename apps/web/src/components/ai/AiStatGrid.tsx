/**
 * AI 保障页面顶部指标卡。由页面容器传入派生后的数值，不自行请求数据。
 */
import { Badge } from "../ui.js";
import { formatPercent } from "../../lib/format.js";
import type { AiReviewMetrics } from "../../lib/types.js";

export function AiStatGrid({
  pendingCount,
  averageConfidence,
  activePromptCount,
  promptCount,
  harnessPassed,
  reviewMetrics,
}: {
  pendingCount: number;
  averageConfidence: number;
  activePromptCount: number;
  promptCount: number;
  harnessPassed: number;
  reviewMetrics?: AiReviewMetrics;
}) {
  return (
    <div className="stat-grid">
      <div className="stat-tile stat-tile--warning">
        <div className="stat-tile__top">
          <span className="stat-tile__label">待复核</span>
        </div>
        <div className="stat-tile__value">{pendingCount}</div>
        <div className="stat-tile__detail">提案绝不自动采纳</div>
      </div>
      <div className="stat-tile stat-tile--accent">
        <div className="stat-tile__top">
          <span className="stat-tile__label">平均置信度</span>
        </div>
        <div className="stat-tile__value">
          {formatPercent(averageConfidence)}
        </div>
        <div className="stat-tile__detail">全部待审提案</div>
      </div>
      <div className="stat-tile stat-tile--good">
        <div className="stat-tile__top">
          <span className="stat-tile__label">已激活提示词</span>
        </div>
        <div className="stat-tile__value">{activePromptCount}</div>
        <div className="stat-tile__detail">
          {promptCount} registered versions · {harnessPassed} harness passes
        </div>
      </div>
      <div
        className={`stat-tile ${
          reviewMetrics?.rubberStampAlert
            ? "stat-tile--critical"
            : "stat-tile--neutral"
        }`}
      >
        <div className="stat-tile__top">
          <span className="stat-tile__label">复核监督</span>
        </div>
        <div className="stat-tile__value" style={{ fontSize: 22 }}>
          {reviewMetrics?.rubberStampAlert ? (
            <Badge tone="danger">需要复核</Badge>
          ) : (
            <Badge tone="success">符合政策</Badge>
          )}
        </div>
        <div className="stat-tile__detail">
          {reviewMetrics
            ? `${reviewMetrics.decided} decided · ${formatPercent(
                reviewMetrics.overrideRate,
              )} override · ${formatPercent(
                reviewMetrics.acceptanceRate,
              )} accepted`
            : "暂无评审指标"}
        </div>
      </div>
    </div>
  );
}
