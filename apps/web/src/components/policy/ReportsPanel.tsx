import { Badge, Button, EmptyState, InfoNotice, LoadingRows, Panel } from "../ui.js";
import { formatDateTime } from "../../lib/format.js";
import type { PolicyReviewReport } from "../../lib/types.js";
import type { QueryState } from "../../lib/hooks.js";

export interface ReviewSnapshot {
  id: string;
  status?: string;
  period?: string;
  createdAt: string;
}

export interface ReviewerAgreementReport {
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
}

export interface ReportsPanelProps {
  finalizeAnnualReport: () => void;
  reportBusy: string | null;
  reviewReports: QueryState<PolicyReviewReport>;
  reviewSnapshots: QueryState<ReviewSnapshot[]>;
  reviewerAgreement: QueryState<ReviewerAgreementReport>;
  snapshotAgreement: () => void;
}

export function ReportsPanel({
  finalizeAnnualReport,
  reportBusy,
  reviewReports,
  reviewSnapshots,
  reviewerAgreement,
  snapshotAgreement,
}: ReportsPanelProps) {
  return (
    <div className="stack">
      <Panel
        title="年度审查快照"
        subtitle="生成不可变快照；记录报告哈希与签核人"
        action={
          <Button
            size="sm"
            variant="primary"
            loading={reportBusy === "annual"}
            onClick={() => void finalizeAnnualReport()}
            disabled={!reviewReports.data}
          >
            生成年度快照
          </Button>
        }
        flush
      >
        {reviewSnapshots.loading ? (
          <div style={{ padding: 16 }}><LoadingRows /></div>
        ) : (reviewSnapshots.data ?? []).length === 0 ? (
          <EmptyState
            icon="policy"
            title="暂无年度快照"
            description="年度审查完成后生成快照，供审计/仲裁导出。"
          />
        ) : (
          <table className="table">
            <thead>
              <tr><th>周期</th><th>状态</th><th>生成时间</th><th /></tr>
            </thead>
            <tbody>
              {(reviewSnapshots.data ?? []).map((record) => (
                <tr key={record.id}>
                  <td>{record.period ?? "—"}</td>
                  <td><Badge status={record.status} /></td>
                  <td className="nowrap">{formatDateTime(record.createdAt)}</td>
                  <td className="cell-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        window.open(
                          `/api/v1/reports/policy-review/snapshots/${record.id}/export`,
                          "_blank",
                        )
                      }
                    >
                      导出 HTML
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="评审人一致性（ATT-09）"
        subtitle="同一对象多评审的成对一致率与 Cohen's kappa"
        action={
          <Button
            size="sm"
            variant="secondary"
            loading={reportBusy === "agreement"}
            onClick={() => void snapshotAgreement()}
          >
            保存一致性快照
          </Button>
        }
      >
        {reviewerAgreement.loading ? (
          <LoadingRows />
        ) : reviewerAgreement.data?.insufficient ? (
          <InfoNotice tone="warning">
            配对评审样本不足，无法计算 kappa。需同一周期同一对象至少两名不同评审人。
          </InfoNotice>
        ) : (
          <>
            <div className="stat-grid stat-grid--three">
              <div className="stat-card"><span>配对数</span><strong>{reviewerAgreement.data?.pairCount ?? 0}</strong></div>
              <div className="stat-card"><span>完全一致率</span><strong>{reviewerAgreement.data?.exactAgreementRate ?? "—"}</strong></div>
              <div className="stat-card"><span>Cohen's kappa</span><strong>{reviewerAgreement.data?.cohenKappa ?? "—"}</strong></div>
            </div>
            <table className="table">
              <thead>
                <tr><th>对象</th><th>周期</th><th>评审人 A</th><th>评审人 B</th><th>完全一致</th><th>±1 一致</th></tr>
              </thead>
              <tbody>
                {(reviewerAgreement.data?.pairs ?? []).map((pair, index) => (
                  <tr key={`${pair.personId}-${pair.reviewerA}-${pair.reviewerB}-${index}`}>
                    <td className="mono">{pair.personId.slice(0, 8)}</td>
                    <td className="mono">{pair.cycleId.slice(0, 8)}</td>
                    <td className="mono">{pair.reviewerA.slice(0, 8)}</td>
                    <td className="mono">{pair.reviewerB.slice(0, 8)}</td>
                    <td>{pair.exactAgreementRate}</td>
                    <td>{pair.withinOneRate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Panel>
    </div>
  );
}
