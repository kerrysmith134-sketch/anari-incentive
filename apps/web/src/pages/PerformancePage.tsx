import { useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  LoadingRows,
  PageHeader,
  Panel,
} from "../components/ui.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";

interface EvaluationCycleView {
  id: string;
  name?: string;
  status: string;
  policyVersionId?: string;
  createdAt: string;
}

interface EvaluationDraftView {
  id: string;
  personId: string;
  status: string;
  draftType?: string;
  generatedByType?: string;
  strengths?: string[];
  createdAt: string;
}

interface EvaluationDecisionView {
  id: string;
  personId?: string;
  decision?: string;
  reviewerPersonId?: string;
  rationale?: string;
  createdAt: string;
}

/** 绩效管理：考核周期、评价草稿与人工决策。 */
export function PerformancePage() {
  useDocumentTitle("绩效管理");
  const cycles = useApiQuery<EvaluationCycleView[]>("/api/v1/evaluation-cycles");
  const drafts = useApiQuery<EvaluationDraftView[]>("/api/v1/evaluation-drafts");
  const decisions = useApiQuery<EvaluationDecisionView[]>(
    "/api/v1/evaluation-decisions",
  );
  const [tab, setTab] = useState("cycles");
  const cycleList = cycles.data ?? [];
  const draftList = drafts.data ?? [];
  const decisionList = decisions.data ?? [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="核心业务"
        title="绩效管理"
        description="考核周期驱动证据 bound 评价草稿（可由 AI 起草），人工复核后形成版本化决策；AI 仅辅助，人工拍板。"
      />
      <div className="row-actions section-gap">
        {[
          { id: "cycles", label: `考核周期 (${cycleList.length})` },
          { id: "drafts", label: `评价草稿 (${draftList.length})` },
          { id: "decisions", label: `已批决策 (${decisionList.length})` },
        ].map((entry) => (
          <Button
            key={entry.id}
            variant={tab === entry.id ? "primary" : "secondary"}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      {tab === "cycles" ? (
        <Panel title="考核周期" flush>
          {cycles.loading && cycles.data === undefined ? (
            <LoadingRows rows={4} />
          ) : cycleList.length === 0 ? (
            <EmptyState
              icon="clock"
              title="还没有考核周期"
              description="在「考核周期」中创建一个周期，把工作包、证据和评价关联到同一考核口径。"
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>周期</th>
                  <th>状态</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {cycleList.map((cycle) => (
                  <tr key={cycle.id}>
                    <td>
                      <code>{cycle.id.slice(0, 8)}</code>
                    </td>
                    <td>
                      <Badge tone="info">{cycle.status}</Badge>
                    </td>
                    <td>{cycle.createdAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ) : null}

      {tab === "drafts" ? (
        <Panel title="评价草稿" flush>
          {drafts.loading && drafts.data === undefined ? (
            <LoadingRows rows={4} />
          ) : draftList.length === 0 ? (
            <EmptyState
              icon="ai"
              title="暂无评价草稿"
              description="AI 或经理可依据证据生成草稿；草稿不含分数，只有优势、反证与不确定性。"
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>对象</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>优势要点</th>
                </tr>
              </thead>
              <tbody>
                {draftList.map((draft) => (
                  <tr key={draft.id}>
                    <td>
                      <code>{draft.personId.slice(0, 8)}</code>
                    </td>
                    <td>{draft.generatedByType ?? draft.draftType ?? "—"}</td>
                    <td>
                      <Badge tone="neutral">{draft.status}</Badge>
                    </td>
                    <td>{draft.strengths?.slice(0, 2).join("、") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ) : null}

      {tab === "decisions" ? (
        <Panel title="已批决策" flush>
          {decisions.loading && decisions.data === undefined ? (
            <LoadingRows rows={4} />
          ) : decisionList.length === 0 ? (
            <EmptyState
              icon="approvals"
              title="暂无已批决策"
              description="人工复核提交草稿后生成版本化决策，可追溯复核人。"
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>对象</th>
                  <th>结论</th>
                  <th>复核人</th>
                  <th>理由</th>
                </tr>
              </thead>
              <tbody>
                {decisionList.map((decision) => (
                  <tr key={decision.id}>
                    <td>
                      <code>{(decision.personId ?? "").slice(0, 8)}</code>
                    </td>
                    <td>
                      <Badge tone="success">{decision.decision ?? "APPROVED"}</Badge>
                    </td>
                    <td>
                      <code>{(decision.reviewerPersonId ?? "").slice(0, 8)}</code>
                    </td>
                    <td>{decision.rationale ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
