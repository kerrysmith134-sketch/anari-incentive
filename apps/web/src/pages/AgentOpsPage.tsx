import { useState } from "react";
import {
  Badge,
  Button,
  DefinitionList,
  EmptyState,
  ErrorNotice,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  PageHeader,
  Panel,
  Select,
  Tabs,
  Textarea,
  TextInput,
} from "../components/ui.js";
import { PersonSelect, usePeople } from "../components/PersonSelect.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { formatDateTime, formatPercent, shortId, titleCase } from "../lib/format.js";
import type {
  AgentActionView,
  AgentTaskView,
  AgentMetricsView,
  AgentStepView,
  ToolInvocationView,
  AiSuggestionLogView,
  WorkflowRunView,
} from "../lib/ops-types.js";

const AGENT_TYPES = [
  "EVIDENCE_GAP",
  "SETTLEMENT_READINESS",
  "CONTRIBUTION_ANOMALY",
  "POLICY_PROPOSAL",
  "DATA_QUALITY",
  "APPEAL_SLA",
  "EVALUATION_DRAFT",
];
const TRIGGER_TYPES = ["MANUAL", "EVENT", "SCHEDULE", "THRESHOLD"];

export function AgentOpsPage() {
  useDocumentTitle("Agent 运维");
  const { session } = useAuth();
  const toast = useToast();
  const { people } = usePeople();
  const tasks = useApiQuery<AgentTaskView[]>("/api/v1/agent-tasks");
  // NPV2-031：任务事实溯源——步骤链与工具调用记录；成本指标卡。
  const [traceTaskId, setTraceTaskId] = useState<string | undefined>(undefined);
  const stepsQuery = useApiQuery<AgentStepView[]>(
    traceTaskId ? `/api/v1/agent-tasks/${traceTaskId}/steps` : null,
    traceTaskId,
  );
  const invocationsQuery = useApiQuery<ToolInvocationView[]>(
    traceTaskId ? `/api/v1/agent-tasks/${traceTaskId}/invocations` : null,
    traceTaskId,
  );
  const workflows = useApiQuery<WorkflowRunView[]>("/api/v1/workflow-runs");
  const suggestions = useApiQuery<AiSuggestionLogView[]>(
    "/api/v1/ai-suggestion-logs",
  );
  const agentMetrics = useApiQuery<AgentMetricsView>(
    "/api/v1/reports/agent-metrics",
  );
  const [tab, setTab] = useState("tasks");
  const [busy, setBusy] = useState<string | null>(null);
  const [enqueueOpen, setEnqueueOpen] = useState(false);
  const [agentType, setAgentType] = useState(AGENT_TYPES[0] as string);
  const [triggerType, setTriggerType] = useState("MANUAL");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [taskInput, setTaskInput] = useState("{}");
  const [enqueueError, setEnqueueError] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<{
    task: AgentTaskView;
    action: AgentActionView;
  } | null>(null);
  const [actionDecision, setActionDecision] = useState<"approve" | "reject">(
    "approve",
  );
  const [approver, setApprover] = useState(session.personId);
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowTaskId, setWorkflowTaskId] = useState("");
  const [workflowName, setWorkflowName] = useState("");
  const [workflowVersion, setWorkflowVersion] = useState("1");
  const [workflowStep, setWorkflowStep] = useState("");
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [suggestionTaskId, setSuggestionTaskId] = useState("");
  const [suggestionTargetType, setSuggestionTargetType] = useState("");
  const [suggestionType, setSuggestionType] = useState("");
  const [suggestionPromptVersion, setSuggestionPromptVersion] = useState("v1");
  const [suggestionInputHash, setSuggestionInputHash] = useState("");
  const [suggestionOutput, setSuggestionOutput] = useState("{}");
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  const taskList = tasks.data ?? [];
  const workflowList = workflows.data ?? [];
  const suggestionList = suggestions.data ?? [];

  async function scan() {
    setBusy("scan");
    try {
      const result = await api<AgentTaskView[]>("/api/v1/agent-tasks/scan", {
        method: "POST",
        body: {},
      });
      toast.success("Agent 扫描完成", `${result.length} task(s) ran`);
      tasks.reload();
      workflows.reload();
    } catch (caught) {
      toast.error(
        "扫描失败",
        caught instanceof ApiError ? caught.message : undefined,
      );
    } finally {
      setBusy(null);
    }
  }

  async function runTask(task: AgentTaskView) {
    setBusy(`run:${task.id}`);
    try {
      await api(`/api/v1/agent-tasks/${task.id}/run`, { method: "POST" });
      toast.success("任务已执行", shortId(task.id));
      tasks.reload();
    } catch (caught) {
      toast.error(
        "执行失败",
        caught instanceof ApiError ? caught.message : undefined,
      );
    } finally {
      setBusy(null);
    }
  }

  async function enqueueTask() {
    setEnqueueError(null);
    try {
      const input = JSON.parse(taskInput) as Record<string, unknown>;
      await api("/api/v1/agent-tasks", {
        method: "POST",
        body: {
          agentType,
          triggerType,
          input,
          idempotencyKey: idempotencyKey.trim(),
        },
      });
      toast.success("Agent 任务已排队", agentType);
      setEnqueueOpen(false);
      tasks.reload();
    } catch (caught) {
      setEnqueueError(
        caught instanceof Error ? caught.message : "任务排队失败",
      );
    }
  }

  async function decideAction() {
    if (!actionTarget) return;
    setActionError(null);
    try {
      await api(
        `/api/v1/agent-tasks/${actionTarget.task.id}/${actionDecision}`,
        {
          method: "POST",
          body: {
            actionId: actionTarget.action.id,
            approverPersonId: approver,
            ...(actionDecision === "reject"
              ? { reason: actionReason.trim() }
              : {}),
          },
        },
      );
      toast.success(
        actionDecision === "approve" ? "Action approved" : "Action rejected",
        actionTarget.action.tool,
      );
      setActionTarget(null);
      tasks.reload();
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : "无法记录决策",
      );
    }
  }

  async function createWorkflow() {
    setWorkflowError(null);
    try {
      await api("/api/v1/workflow-runs", {
        method: "POST",
        body: {
          agentTaskId: workflowTaskId.trim(),
          workflowName: workflowName.trim(),
          workflowVersion: workflowVersion.trim(),
          status: "RUNNING",
          currentStep: workflowStep.trim() || undefined,
        },
      });
      toast.success("工作流运行已记录", workflowName);
      setWorkflowOpen(false);
      workflows.reload();
    } catch (caught) {
      setWorkflowError(
        caught instanceof Error ? caught.message : "无法记录工作流",
      );
    }
  }

  async function finishWorkflow(run: WorkflowRunView) {
    setBusy(`finish:${run.id}`);
    try {
      await api(`/api/v1/workflow-runs/${run.id}/finish`, {
        method: "POST",
        body: { status: "SUCCEEDED" },
      });
      toast.success("工作流已完结", run.workflowName);
      workflows.reload();
    } catch (caught) {
      toast.error(
        "无法完成工作流",
        caught instanceof ApiError ? caught.message : undefined,
      );
    } finally {
      setBusy(null);
    }
  }

  async function createSuggestion() {
    setSuggestionError(null);
    try {
      const outputJson = JSON.parse(suggestionOutput) as Record<string, unknown>;
      await api("/api/v1/ai-suggestion-logs", {
        method: "POST",
        body: {
          agentTaskId: suggestionTaskId.trim(),
          targetType: suggestionTargetType.trim(),
          suggestionType: suggestionType.trim(),
          promptVersion: suggestionPromptVersion.trim(),
          inputHash: suggestionInputHash.trim(),
          outputJson,
          validationStatus: "UNVERIFIED",
        },
      });
      toast.success("建议已记录", suggestionType);
      setSuggestionOpen(false);
      suggestions.reload();
    } catch (caught) {
      setSuggestionError(
        caught instanceof Error ? caught.message : "记录建议失败",
      );
    }
  }

  async function acceptSuggestion(suggestion: AiSuggestionLogView) {
    setBusy(`accept:${suggestion.id}`);
    try {
      await api(`/api/v1/ai-suggestion-logs/${suggestion.id}/accept`, {
        method: "POST",
        body: { acceptedBy: session.personId },
      });
      toast.success("建议已采纳", suggestion.suggestionType);
      suggestions.reload();
    } catch (caught) {
      toast.error(
        "无法采纳建议",
        caught instanceof ApiError ? caught.message : undefined,
      );
    } finally {
      setBusy(null);
    }
  }

  const pendingActions = taskList.flatMap((task) =>
    task.status === "WAITING_APPROVAL"
      ? task.actions
          .filter((action) => action.requiresApproval)
          .map((action) => ({ task, action }))
      : [],
  );

  return (
    <>
      <PageHeader
        eyebrow="有界自动化"
        title="Agent 运维"
        description="主动式 Agent 任务、审批门禁、工作流运行与建议日志；T2/T3 必须人工批准，AI 关闭时全人工兜底。"
        actions={
          <>
            <Button
              variant="secondary"
              icon="play"
              loading={busy === "scan"}
              onClick={scan}
            >
              运行扫描
            </Button>
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                setAgentType(AGENT_TYPES[0] as string);
                setTriggerType("MANUAL");
                setIdempotencyKey(`manual-${Date.now()}`);
                setTaskInput("{}");
                setEnqueueError(null);
                setEnqueueOpen(true);
              }}
            >
              排队任务
            </Button>
          </>
        }
      />

      {traceTaskId ? (
        <Panel
          title={`任务溯源：${shortId(traceTaskId, 10)}`}
          subtitle="步骤链与工具调用记录（NPV2-019 持久化）——任务事实溯源"
          flush
        >
          {stepsQuery.loading || invocationsQuery.loading ? (
            <div style={{ padding: 16 }}>
              <LoadingRows rows={3} />
            </div>
          ) : (
            <>
              <ul className="stack-list">
                {(stepsQuery.data ?? []).map((step) => (
                  <li key={step.id}>
                    <Badge
                      status={
                        step.status === "SUCCEEDED"
                          ? "APPROVED"
                          : step.status === "RUNNING"
                            ? "WAITING_APPROVAL"
                            : step.status === "FAILED"
                              ? "REJECTED"
                              : "CANCELLED"
                      }
                    >
                      {step.kind}
                    </Badge>{" "}
                    <span className="muted">
                      #{step.stepIndex} · {step.executedBy ?? "system"} ·{" "}
                      {step.durationMs ?? 0}ms
                    </span>
                    {step.error ? (
                      <div className="muted">错误：{step.error}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
              <ul className="stack-list">
                {(invocationsQuery.data ?? []).map((record) => (
                  <li key={record.id}>
                    <Badge
                      status={
                        record.status === "EXECUTED"
                          ? "APPROVED"
                          : record.status === "FAILED"
                            ? "REJECTED"
                            : "WAITING_APPROVAL"
                      }
                    >
                      {record.tool}
                    </Badge>{" "}
                    <span className="muted">
                      输入 {record.inputHash.slice(0, 12)}… · 重试{" "}
                      {record.retries} · {record.durationMs ?? 0}ms
                    </span>
                    {record.error ? (
                      <div className="muted">错误：{record.error}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setTraceTaskId(undefined)}
          >
            关闭溯源
          </Button>
        </Panel>
      ) : null}

      <Panel title="Agent 成本与质量指标">
        {agentMetrics.error ? (
          <InfoNotice tone="warning">
            指标加载失败：{(agentMetrics.error as Error).message}
          </InfoNotice>
        ) : agentMetrics.data ? (
          <ul className="stack-list">
            <li>
              verified 闭环率：
              {agentMetrics.data.verifiedClosureRate !== null
                ? `${Math.round(agentMetrics.data.verifiedClosureRate * 10000) / 100}`
                : "不可测（窗口内无 EXECUTED 结果）"}
            </li>
            <li>
              误报率：
              {agentMetrics.data.falsePositiveRate !== null
                ? `${Math.round(agentMetrics.data.falsePositiveRate * 10000) / 100}`
                : "不可测（需人工标注）"}
            </li>
            <li>
              每闭环任务成本：
              {agentMetrics.data.costPerClosedLoop !== null
                ? `${agentMetrics.data.costPerClosedLoop}（模型 ${agentMetrics.data.costBreakdown.modelCost ?? "-"} / 工具 ${agentMetrics.data.costBreakdown.toolCost ?? "-"}）`
                : "不可测（需成本核算接入）"}
            </li>
            <li>
              AI-off 对照差：
              {agentMetrics.data.aiOffFloor.delta !== null
                ? `${agentMetrics.data.aiOffFloor.delta}`
                : "不可测（需 AI-off 对照组）"}
            </li>
          </ul>
        ) : (
          <LoadingRows rows={2} />
        )}
      </Panel>

      <Tabs
        items={[
          { id: "tasks", label: "Agent 任务", count: taskList.length },
          {
            id: "approvals",
            label: "待处理动作",
            count: pendingActions.length,
          },
          { id: "workflows", label: "工作流运行", count: workflowList.length },
          { id: "metrics", label: "验收指标" },
          {
            id: "suggestions",
            label: "建议日志",
            count: suggestionList.length,
          },
        ]}
        active={tab}
        onChange={setTab}
        label="Agent 视图"
      />

      <div className="tab-panel">
        {tab === "tasks" ? (
          <Panel title="Agent 任务" flush>
            {tasks.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={tasks.error} onRetry={tasks.reload} />
              </div>
            ) : tasks.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={4} />
              </div>
            ) : taskList.length === 0 ? (
              <EmptyState
                icon="ai"
                title="暂无 Agent 任务"
                description="可手动排队任务或运行扫描，让 Agent 观察证据缺口与结算就绪度。"
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>任务</th>
                      <th>智能体</th>
                      <th>状态</th>
                      <th>风险</th>
                      <th>发现</th>
                      <th>更新时间</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {taskList.map((task) => (
                      <tr key={task.id}>
                        <td>
                          <span className="cell-primary mono">
                            {shortId(task.id, 10)}
                          </span>
                          <span className="cell-sub">
                            {task.triggerType}
                            {task.triggerRef ? ` · ${task.triggerRef}` : ""}
                          </span>
                        </td>
                        <td>{titleCase(task.agentType)}</td>
                        <td>
                          <Badge status={task.status} />
                        </td>
                        <td>
                          <Badge tone={task.riskTier === "T3" ? "danger" : "neutral"}>
                            {task.riskTier}
                          </Badge>
                        </td>
                        <td>{task.findings.length}</td>
                        <td className="nowrap">
                          {formatDateTime(task.updatedAt)}
                        </td>
                        <td className="cell-actions">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setTraceTaskId(task.id)}
                          >
                            溯源
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={busy === `run:${task.id}`}
                            onClick={() => runTask(task)}
                          >
                            运行
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : tab === "approvals" ? (
          <Panel
            title="待审批 Agent 动作"
            subtitle="批准即执行动作；T3 政策发布仅管理员"
            flush
          >
            {pendingActions.length === 0 ? (
              <EmptyState
                icon="approvals"
                title="没有等待审批的事项"
                description="T0/T1 自动执行；更高风险动作在此等待。"
              />
            ) : (
              <div className="stack" style={{ padding: 16, gap: 12 }}>
                {pendingActions.map(({ task, action }) => (
                  <div key={`${task.id}:${action.id}`} className="notice">
                    <DefinitionList
                      items={[
                        {
                          label: "任务",
                          value: `${titleCase(task.agentType)} · ${shortId(task.id, 10)}`,
                        },
                        { label: "Tool", value: action.tool },
                        { label: "风险", value: action.riskTier },
                        { label: "对象", value: `${action.targetType} ${shortId(action.targetId, 10)}` },
                      ]}
                    />
                    <p className="muted">{action.description}</p>
                    <div className="row-actions">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setActionTarget({ task, action });
                          setActionDecision("approve");
                          setApprover(session.personId);
                          setActionReason("");
                          setActionError(null);
                        }}
                      >
                        批准
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setActionTarget({ task, action });
                          setActionDecision("reject");
                          setApprover(session.personId);
                          setActionReason("");
                          setActionError(null);
                        }}
                      >
                        驳回
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        ) : tab === "workflows" ? (
          <Panel
            title="工作流运行"
            subtitle="与任务关联的工作流执行"
            flush
            action={
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                onClick={() => {
                  setWorkflowTaskId(taskList[0]?.id ?? "");
                  setWorkflowName("");
                  setWorkflowVersion("1");
                  setWorkflowStep("");
                  setWorkflowError(null);
                  setWorkflowOpen(true);
                }}
              >
                新建计算
              </Button>
            }
          >
            {workflows.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={workflows.error} onRetry={workflows.reload} />
              </div>
            ) : workflows.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={3} />
              </div>
            ) : workflowList.length === 0 ? (
              <EmptyState
                icon="clock"
                title="暂无工作流运行"
                description="工作流运行记录 Agent 多步执行及当前步骤。"
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>工作流</th>
                      <th>任务</th>
                      <th>状态</th>
                      <th>已开始</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {workflowList.map((run) => (
                      <tr key={run.id}>
                        <td>
                          <span className="cell-primary">
                            {run.workflowName} v{run.workflowVersion}
                          </span>
                          <span className="cell-sub">
                            {run.currentStep ?? "no step"}
                          </span>
                        </td>
                        <td className="mono">{shortId(run.agentTaskId, 10)}</td>
                        <td>
                          <Badge status={run.status} />
                        </td>
                        <td className="nowrap">
                          {formatDateTime(run.startedAt)}
                        </td>
                        <td className="cell-actions">
                          {!run.finishedAt ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={busy === `finish:${run.id}`}
                              onClick={() => finishWorkflow(run)}
                            >
                              完成
                            </Button>
                          ) : (
                            <span className="subtle">
                              {run.finishedAt
                                ? formatDateTime(run.finishedAt)
                                : "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : tab === "suggestions" ? (
          <Panel
            title="AI 建议日志"
            subtitle="与 Agent 任务关联的模型输出；采纳归属到人"
            flush
            action={
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                onClick={() => {
                  setSuggestionTaskId(taskList[0]?.id ?? "");
                  setSuggestionTargetType("");
                  setSuggestionType("");
                  setSuggestionPromptVersion("v1");
                  setSuggestionInputHash("");
                  setSuggestionOutput("{}");
                  setSuggestionError(null);
                  setSuggestionOpen(true);
                }}
              >
                记录建议
              </Button>
            }
          >
            {suggestions.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice
                  error={suggestions.error}
                  onRetry={suggestions.reload}
                />
              </div>
            ) : suggestions.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={3} />
              </div>
            ) : suggestionList.length === 0 ? (
              <EmptyState
                icon="ai"
                title="暂无建议日志"
                description="建议是非评分类模型输出，须人工复核。"
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>建议</th>
                      <th>对象</th>
                      <th>校验</th>
                      <th>创建时间</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {suggestionList.map((suggestion) => (
                      <tr key={suggestion.id}>
                        <td>
                          <span className="cell-primary">
                            {suggestion.suggestionType}
                          </span>
                          <span className="cell-sub">
                            {suggestion.modelProvider ?? "model"} ·{" "}
                            {suggestion.modelName ?? "n/a"} ·{" "}
                            {suggestion.promptVersion}
                          </span>
                        </td>
                        <td>
                          {suggestion.targetType}
                          <span className="cell-sub mono">
                            {suggestion.targetId
                              ? shortId(suggestion.targetId, 10)
                              : "—"}
                          </span>
                        </td>
                        <td>
                          <Badge status={suggestion.validationStatus} />
                        </td>
                        <td className="nowrap">
                          {formatDateTime(suggestion.createdAt)}
                        </td>
                        <td className="cell-actions">
                          {suggestion.acceptedAt ? (
                            <span className="subtle">
                              accepted {formatDateTime(suggestion.acceptedAt)}
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="primary"
                              loading={busy === `accept:${suggestion.id}`}
                              onClick={() => acceptSuggestion(suggestion)}
                            >
                              验收
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : (
          <Panel
            title="验收指标"
            subtitle="运营闭环指标；误报率/成本/AI 关闭兜底率需要外部数据"
          >
            {agentMetrics.error ? (
              <ErrorNotice
                error={agentMetrics.error}
                onRetry={agentMetrics.reload}
              />
            ) : agentMetrics.loading || !agentMetrics.data ? (
              <LoadingRows rows={3} />
            ) : (
              <>
                <div className="coverage-grid">
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">已关闭任务</div>
                    <div className="coverage-cell__value">
                      {agentMetrics.data.closedTasks}/
                      {agentMetrics.data.totalTasks}
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">
                      关闭耗时中位数
                    </div>
                    <div className="coverage-cell__value">
                      {agentMetrics.data.medianCloseHours ?? "—"}h
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">
                      自动解决率
                    </div>
                    <div className="coverage-cell__value">
                      {agentMetrics.data.autoResolvedRate === null
                        ? "—"
                        : formatPercent(
                            agentMetrics.data.autoResolvedRate,
                          )}
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">升级率</div>
                    <div className="coverage-cell__value">
                      {agentMetrics.data.escalationRate === null
                        ? "—"
                        : formatPercent(agentMetrics.data.escalationRate)}
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">人工改判</div>
                    <div className="coverage-cell__value">
                      {agentMetrics.data.humanOverrideRate === null
                        ? "—"
                        : formatPercent(agentMetrics.data.humanOverrideRate)}
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">
                      平均尝试次数
                    </div>
                    <div className="coverage-cell__value">
                      {agentMetrics.data.averageAttempts ?? "—"}
                    </div>
                  </div>
                </div>
                <p className="subtle" style={{ fontSize: 11.5 }}>
                  {agentMetrics.data.note}
                </p>
              </>
            )}
          </Panel>
        )}
      </div>

      <Modal
        open={enqueueOpen}
        title="排队 Agent 任务"
        description="幂等键防止重复执行。"
        onClose={() => setEnqueueOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEnqueueOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={enqueueTask}>
              排队
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {enqueueError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{enqueueError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="Agent 类型" htmlFor="agent-type">
            <Select
              id="agent-type"
              value={agentType}
              onChange={(event) => setAgentType(event.target.value)}
            >
              {AGENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="触发器" htmlFor="agent-trigger">
            <Select
              id="agent-trigger"
              value={triggerType}
              onChange={(event) => setTriggerType(event.target.value)}
            >
              {TRIGGER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="幂等键" htmlFor="agent-key">
            <TextInput
              id="agent-key"
              value={idempotencyKey}
              onChange={(event) => setIdempotencyKey(event.target.value)}
              required
            />
          </FormField>
          <FormField label="输入 JSON" htmlFor="agent-input" className="field--full">
            <Textarea
              id="agent-input"
              value={taskInput}
              onChange={(event) => setTaskInput(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={Boolean(actionTarget)}
        title={actionDecision === "approve" ? "批准 Agent 动作" : "拒绝 Agent 动作"}
        description={actionTarget?.action.description}
        onClose={() => setActionTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setActionTarget(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={decideAction}>
              {actionDecision === "approve" ? "批准" : "驳回"}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {actionError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{actionError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="审批人" htmlFor="agent-approver">
            <PersonSelect
              id="agent-approver"
              value={approver}
              onChange={setApprover}
            />
          </FormField>
          {actionDecision === "reject" ? (
            <FormField
              label="原因"
              htmlFor="agent-reject-reason"
              className="field--full"
            >
              <Textarea
                id="agent-reject-reason"
                value={actionReason}
                onChange={(event) => setActionReason(event.target.value)}
                required
              />
            </FormField>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={workflowOpen}
        title="新建工作流运行"
        onClose={() => setWorkflowOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setWorkflowOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={createWorkflow}>
              记录运行
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {workflowError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{workflowError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="Agent 任务" htmlFor="workflow-task">
            <Select
              id="workflow-task"
              value={workflowTaskId}
              onChange={(event) => setWorkflowTaskId(event.target.value)}
              required
            >
              <option value="">选择任务…</option>
              {taskList.map((task) => (
                <option key={task.id} value={task.id}>
                  {titleCase(task.agentType)} · {shortId(task.id, 8)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="工作流名称" htmlFor="workflow-name">
            <TextInput
              id="workflow-name"
              value={workflowName}
              onChange={(event) => setWorkflowName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="版本" htmlFor="workflow-version">
            <TextInput
              id="workflow-version"
              value={workflowVersion}
              onChange={(event) => setWorkflowVersion(event.target.value)}
              required
            />
          </FormField>
          <FormField label="当前步骤" htmlFor="workflow-step">
            <TextInput
              id="workflow-step"
              value={workflowStep}
              onChange={(event) => setWorkflowStep(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={suggestionOpen}
        title="记录 AI 建议"
        onClose={() => setSuggestionOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSuggestionOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={createSuggestion}>
              记录建议
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {suggestionError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{suggestionError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="Agent 任务" htmlFor="suggestion-task">
            <Select
              id="suggestion-task"
              value={suggestionTaskId}
              onChange={(event) => setSuggestionTaskId(event.target.value)}
              required
            >
              <option value="">选择任务…</option>
              {taskList.map((task) => (
                <option key={task.id} value={task.id}>
                  {titleCase(task.agentType)} · {shortId(task.id, 8)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="对象类型" htmlFor="suggestion-target">
            <TextInput
              id="suggestion-target"
              value={suggestionTargetType}
              onChange={(event) => setSuggestionTargetType(event.target.value)}
              placeholder="WORK_PACKAGE"
              required
            />
          </FormField>
          <FormField label="建议类型" htmlFor="suggestion-type">
            <TextInput
              id="suggestion-type"
              value={suggestionType}
              onChange={(event) => setSuggestionType(event.target.value)}
              placeholder="EVIDENCE_REMINDER"
              required
            />
          </FormField>
          <FormField label="提示词版本" htmlFor="suggestion-prompt">
            <TextInput
              id="suggestion-prompt"
              value={suggestionPromptVersion}
              onChange={(event) =>
                setSuggestionPromptVersion(event.target.value)
              }
              required
            />
          </FormField>
          <FormField label="输入哈希" htmlFor="suggestion-hash">
            <TextInput
              id="suggestion-hash"
              value={suggestionInputHash}
              onChange={(event) => setSuggestionInputHash(event.target.value)}
              placeholder="sha256:…"
              required
            />
          </FormField>
          <FormField
            label="输出 JSON"
            htmlFor="suggestion-output"
            className="field--full"
          >
            <Textarea
              id="suggestion-output"
              value={suggestionOutput}
              onChange={(event) => setSuggestionOutput(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>
    </>
  );
}
