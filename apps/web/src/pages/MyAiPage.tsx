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
  useDocumentTitle("My AI record");
  const { session } = useAuth();
  const record = useApiQuery<MyAiRecord>(
    `/api/v1/me/ai-explanations?personId=${encodeURIComponent(session.personId)}`,
  );

  return (
    <>
      <PageHeader
        eyebrow="Employee transparency"
        title="My AI record"
        description="What AI contributed to decisions about you, which human reviewed it, and how to challenge it. This endpoint returns only your own record."
      />

      {record.error ? (
        <ErrorNotice error={record.error} onRetry={record.reload} />
      ) : record.loading || !record.data ? (
        <Panel title="Loading AI record">
          <LoadingRows rows={5} />
        </Panel>
      ) : (
        <>
          <div className="stat-grid stat-grid--three">
            <StatTile
              label="AI participation"
              value={record.data.aiUsed ? "Used" : "None"}
              detail={
                record.data.aiUsed
                  ? "Advisory only; a human made the decision"
                  : "No AI-assisted record for you"
              }
              icon="ai"
              tone={record.data.aiUsed ? "accent" : "neutral"}
            />
            <StatTile
              label="Advisory score proposals"
              value={record.data.aiScoreProposals.length}
              detail={`${record.data.models.length} model/provider pair(s)`}
              icon="chart"
              tone="warning"
            />
            <StatTile
              label="Human decisions"
              value={record.data.evaluationDecisions.length}
              detail="Reviewer-attributed and appealable"
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
            <Panel title="AI-use notices" subtitle="Disclosure and acknowledgement state">
              {record.data.notices.length === 0 ? (
                <EmptyState
                  icon="policy"
                  title="No AI-use notice"
                  description="Your employer has not linked an AI-use notice to your record yet."
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
                            ? "Acknowledged"
                            : myAcknowledgement?.declinedAt
                              ? "Declined"
                              : "Not acknowledged"}
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

            <Panel title="How AI was used" subtitle="Advisory proposals and human decisions">
              <div className="stack">
                {record.data.evaluationDrafts.map((draft) => (
                  <div key={draft.id} className="reason-box">
                    <div className="inline" style={{ justifyContent: "space-between" }}>
                      <strong>Evaluation draft</strong>
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
                      <strong>Advisory score proposal</strong>
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
                    title="No AI output about you"
                    description="No AI draft or score proposal currently references your person record."
                  />
                ) : null}
              </div>
            </Panel>
          </div>

          <Panel title="Formal evaluation decisions" className="section-gap">
            {record.data.evaluationDecisions.length === 0 ? (
              <EmptyState
                icon="approvals"
                title="No formal decision"
                description="An AI draft does not become a decision until a human reviewer records one."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Decision</th>
                      <th>Version</th>
                      <th>Status</th>
                      <th>Reviewer</th>
                      <th>Approved</th>
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
