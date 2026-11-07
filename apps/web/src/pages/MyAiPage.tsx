import {
  Badge,
  EmptyState,
  ErrorNotice,
  LoadingRows,
  PageHeader,
  Panel,
  StatTile,
} from "../components/ui.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  formatDateTime,
  formatPercent,
  shortId,
} from "../lib/format.js";

interface MyAiRecord {
  personId: string;
  generatedAt: string;
  aiUsed: boolean;
  models: string[];
  notices: Array<{
    notice: {
      id: string;
      noticeType: string;
      title: string;
      bodyRef: string;
      effectiveFrom: string;
    };
    myAcknowledgement: {
      decision: string;
      acknowledgedAt?: string;
      declinedAt?: string;
    } | null;
  }>;
  evaluationDrafts: Array<{
    id: string;
    status: string;
    generatedByType: string;
    modelProvider?: string;
    modelName?: string;
    rationale?: string;
    updatedAt: string;
  }>;
  evaluationDecisions: Array<{
    id: string;
    decisionVersion: number;
    status: string;
    rationale: string;
    reviewerPersonId: string;
    approvedAt?: string;
  }>;
  aiScoreProposals: Array<{
    id: string;
    status: string;
    modelProvider: string;
    modelName: string;
    overallScore: number;
    confidence: number;
    rationale: string;
    decidedBy?: string;
    decisionNote?: string;
    decidedAt?: string;
  }>;
  explanation: {
    summary: string;
    humanReviewRequired: boolean;
    autonomousDecision: boolean;
    appealTargetType: string;
    appealTargets: string[];
  };
}

export function MyAiPage() {
  useDocumentTitle("我的 AI 记录");
  const { session } = useAuth();
  const record = useApiQuery<MyAiRecord>(
    `/api/v1/me/ai-explanations?personId=${encodeURIComponent(session.personId)}`,
  );

  return (
    <>
      <PageHeader
        eyebrow="员工透明"
        title="我的 AI 记录"
        description="AI 在关于你的决策中参与了什么、由哪位人工复核、如何申诉——这里只返回你本人的记录。"
      />

      {record.error ? (
        <ErrorNotice error={record.error} onRetry={record.reload} />
      ) : record.loading || !record.data ? (
        <Panel title="AI 记录加载中">
          <LoadingRows rows={5} />
        </Panel>
      ) : (
        <>
          <div className="stat-grid stat-grid--three">
            <StatTile
              label="AI 参与"
              value={record.data.aiUsed ? "Used" : "无"}
              detail={
                record.data.aiUsed
                  ? "仅供参考；决策由人工作出"
                  : "暂无涉及你的 AI 记录"
              }
              icon="ai"
              tone={record.data.aiUsed ? "accent" : "neutral"}
            />
            <StatTile
              label="建议性评分提案"
              value={record.data.aiScoreProposals.length}
              detail={`${record.data.models.length} model/provider pair(s)`}
              icon="chart"
              tone="warning"
            />
            <StatTile
              label="人工决策"
              value={record.data.evaluationDecisions.length}
              detail="归属复核人、可申诉"
              icon="approvals"
              tone="good"
            />
          </div>

          <div className="notice notice--success" style={{ marginBottom: 18 }}>
            <div>
              <strong>{record.data.explanation.summary}</strong>
              <p>
                Human review required:{" "}
                {record.data.explanation.humanReviewRequired ? "yes" : "no"} ·
                Fully autonomous decision:{" "}
                {record.data.explanation.autonomousDecision ? "yes" : "no"}
              </p>
            </div>
          </div>

          <div className="split-grid">
            <Panel title="AI 使用告知" subtitle="告知与签收状态">
              {record.data.notices.length === 0 ? (
                <EmptyState
                  icon="policy"
                  title="暂无 AI 使用告知"
                  description="公司尚未将 AI 使用告知关联到你的记录。"
                />
              ) : (
                <div className="stack">
                  {record.data.notices.map(({ notice, myAcknowledgement }) => (
                    <div key={notice.id} className="reason-box">
                      <div className="inline" style={{ justifyContent: "space-between" }}>
                        <strong>{notice.title}</strong>
                        <Badge
                          tone={
                            myAcknowledgement?.acknowledgedAt
                              ? "success"
                              : myAcknowledgement?.declinedAt
                                ? "danger"
                                : "warning"
                          }
                        >
                          {myAcknowledgement?.acknowledgedAt
                            ? "已签收"
                            : myAcknowledgement?.declinedAt
                              ? "Declined"
                              : "未签收"}
                        </Badge>
                      </div>
                      <p>
                        Effective {formatDateTime(notice.effectiveFrom)} · ref{" "}
                        {notice.bodyRef}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="AI 参与方式" subtitle="建议性提案与人工决策">
              <div className="stack">
                {record.data.evaluationDrafts.map((draft) => (
                  <div key={draft.id} className="reason-box">
                    <div className="inline" style={{ justifyContent: "space-between" }}>
                      <strong>评价草稿</strong>
                      <Badge status={draft.status} />
                    </div>
                    <p>
                      Source {draft.generatedByType}
                      {draft.modelName
                        ? ` · ${draft.modelProvider}/${draft.modelName}`
                        : ""}{" "}
                      · updated {formatDateTime(draft.updatedAt)}
                    </p>
                    {draft.rationale ? <p>{draft.rationale}</p> : null}
                  </div>
                ))}
                {record.data.aiScoreProposals.map((proposal) => (
                  <div key={proposal.id} className="reason-box">
                    <div className="inline" style={{ justifyContent: "space-between" }}>
                      <strong>建议性评分提案</strong>
                      <Badge status={proposal.status} />
                    </div>
                    <p>
                      {proposal.modelProvider}/{proposal.modelName} ·{" "}
                      {proposal.overallScore.toFixed(2)}/5 · confidence{" "}
                      {formatPercent(proposal.confidence)}
                    </p>
                    <p>{proposal.rationale}</p>
                    {proposal.decidedAt ? (
                      <p className="muted">
                        Human decision by{" "}
                        {shortId(proposal.decidedBy, 12)} on{" "}
                        {formatDateTime(proposal.decidedAt)}
                        {proposal.decisionNote
                          ? ` — ${proposal.decisionNote}`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                ))}
                {record.data.evaluationDrafts.length === 0 &&
                record.data.aiScoreProposals.length === 0 ? (
                  <EmptyState
                    icon="ai"
                    title="暂无关于你的 AI 输出"
                    description="当前没有 AI 草稿或评分提案关联到你。"
                  />
                ) : null}
              </div>
            </Panel>
          </div>

          <Panel title="正式评价决策" className="section-gap">
            {record.data.evaluationDecisions.length === 0 ? (
              <EmptyState
                icon="approvals"
                title="暂无正式决策"
                description="AI 草稿在人工复核记录决策之前不构成决策。"
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>决策</th>
                      <th>版本</th>
                      <th>状态</th>
                      <th>复核人</th>
                      <th>已批准</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.data.evaluationDecisions.map((decision) => (
                      <tr key={decision.id}>
                        <td>
                          <span className="cell-primary">
                            {decision.rationale}
                          </span>
                          <span className="cell-sub mono">
                            {shortId(decision.id, 10)}
                          </span>
                        </td>
                        <td>v{decision.decisionVersion}</td>
                        <td>
                          <Badge status={decision.status} />
                        </td>
                        <td className="mono">
                          {shortId(decision.reviewerPersonId, 12)}
                        </td>
                        <td className="nowrap">
                          {decision.approvedAt
                            ? formatDateTime(decision.approvedAt)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <p className="subtle" style={{ marginTop: 18, fontSize: 11.5 }}>
            Generated {formatDateTime(record.data.generatedAt)}. Advisory AI
            output never writes money or a formal decision. Appealable decision
            ids: {record.data.explanation.appealTargets.join(", ") || "none"}.
          </p>
        </>
      )}
    </>
  );
}
