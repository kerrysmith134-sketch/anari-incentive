import { useState } from "react";
import { Button, PageHeader, Tabs } from "../components/ui.js";
import { usePeople } from "../components/PersonSelect.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import type {
  AiReviewMetrics,
  AiScoreProposal,
  ModelCanaryRun,
  ModelEvaluationDataset,
  ModelEvaluationRun,
  ModelRedTeamRun,
  ModelPrompt,
} from "../lib/types.js";
import { AiStatGrid } from "../components/ai/AiStatGrid.js";
import { AiProposalsTab } from "../components/ai/AiProposalsTab.js";
import { AiPromptsTab } from "../components/ai/AiPromptsTab.js";
import { AiEvaluationsTab } from "../components/ai/AiEvaluationsTab.js";
import { AiAuditTab } from "../components/ai/AiAuditTab.js";
import { AiDatasetsTab } from "../components/ai/AiDatasetsTab.js";
import { AiCanaryTab } from "../components/ai/AiCanaryTab.js";
import { AiRedTeamTab } from "../components/ai/AiRedTeamTab.js";
import { AiSummaryTab } from "../components/ai/AiSummaryTab.js";

/**
 * AI 保障页面壳：保留数据加载、tab 状态与跨 tab 派生指标；
 * 各 tab 的渲染与局部表单/模态状态由 components/ai 下的组件自持。
 */
export function AiPage() {
  useDocumentTitle("AI 保障");
  const { session } = useAuth();
  const { people } = usePeople();
  // NP-021：数值评分提案已退役——不再拉取列表（服务端裁决/复核也已 409）。
  const proposals = useApiQuery<AiScoreProposal[]>(null);
  const prompts = useApiQuery<ModelPrompt[]>("/api/v1/model-prompts");
  const evaluations = useApiQuery<ModelEvaluationRun[]>(
    "/api/v1/model-evaluation-runs",
  );
  const datasets = useApiQuery<ModelEvaluationDataset[]>(
    "/api/v1/model-evaluation-datasets",
  );
  const datasetsDue = useApiQuery<ModelEvaluationDataset[]>(
    "/api/v1/model-evaluation-datasets/refresh-due?withinDays=30",
  );
  const canaries = useApiQuery<ModelCanaryRun[]>(
    "/api/v1/model-canary-runs",
  );
  const redTeam = useApiQuery<ModelRedTeamRun[]>(
    "/api/v1/model-red-team-runs",
  );
  const reviewMetrics = useApiQuery<AiReviewMetrics>(
    "/api/v1/ai-review-metrics",
  );
  const [tab, setTab] = useState("proposals");
  const auditQueue = useApiQuery<AiScoreProposal[]>(null);
  const evidenceNodes = useApiQuery<
    Array<{ id: string; evidenceType: string; qualityStatus: string }>
  >("/api/v1/evidence");

  const proposalList = proposals.data ?? [];
  const promptList = prompts.data ?? [];
  const evaluationList = evaluations.data ?? [];
  const harnessPassed = evaluationList.filter(
    (run) => run.metrics.harnessVersion === "ai-gate-v1" && run.passed,
  ).length;
  const pending = proposalList.filter(
    (proposal) => proposal.status === "PENDING",
  );
  const averageConfidence =
    pending.length > 0
      ? pending.reduce((total, proposal) => total + proposal.confidence, 0) /
        pending.length
      : 0;

  return (
    <>
      <PageHeader
        eyebrow="人在环评分"
        title="AI 保障"
        description="模型输出永远只是建议。数值评分必须通过评测门禁、引用证据，并由人工决策归属。"
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => {
              proposals.reload();
              prompts.reload();
              evaluations.reload();
              reviewMetrics.reload();
            }}
            loading={
              proposals.loading ||
              prompts.loading ||
              evaluations.loading ||
              reviewMetrics.loading
            }
          >
            刷新
          </Button>
        }
      />

      <AiStatGrid
        pendingCount={pending.length}
        averageConfidence={averageConfidence}
        activePromptCount={
          promptList.filter((prompt) => prompt.status === "ACTIVE").length
        }
        promptCount={promptList.length}
        harnessPassed={harnessPassed}
        reviewMetrics={reviewMetrics.data}
      />

      <Tabs
        items={[
          { id: "proposals", label: "评分提案", count: proposalList.length },
          { id: "prompts", label: "提示词登记簿", count: promptList.length },
          {
            id: "evaluations",
            label: "评测运行",
            count: evaluationList.length,
          },
          {
            id: "audit",
            label: "审计队列",
            count: reviewMetrics.data?.auditPendingCount ?? 0,
          },
          {
            id: "datasets",
            label: "金标集",
            count: datasets.data?.length ?? 0,
          },
          {
            id: "canary",
            label: "金丝雀对比",
            count: canaries.data?.length ?? 0,
          },
          {
            id: "redteam",
            label: "红队",
            count: redTeam.data?.length ?? 0,
          },
        ]}
        active={tab}
        onChange={setTab}
        label="AI 保障视图"
      />

      <div className="tab-panel">
        {tab === "proposals" ? (
          <AiProposalsTab
            proposals={proposals}
            reviewMetrics={reviewMetrics.data}
            people={people}
            personId={session.personId}
          />
        ) : null}
        {tab === "prompts" ? <AiPromptsTab prompts={prompts} /> : null}
        {tab === "evaluations" ? (
          <AiEvaluationsTab evaluations={evaluations} datasets={datasets} />
        ) : null}
        {tab === "audit" ? (
          <AiAuditTab
            auditQueue={auditQueue}
            reviewMetrics={reviewMetrics}
            people={people}
            personId={session.personId}
          />
        ) : null}
        {tab === "datasets" ? (
          <AiDatasetsTab
            datasets={datasets}
            datasetsDue={datasetsDue}
            personId={session.personId}
          />
        ) : null}
        {tab === "canary" ? <AiCanaryTab canaries={canaries} /> : null}
        {tab === "summary" ? <AiSummaryTab evidenceNodes={evidenceNodes} /> : null}
        {tab === "redteam" ? (
          <AiRedTeamTab redTeam={redTeam} personId={session.personId} />
        ) : null}
      </div>
    </>
  );
}
