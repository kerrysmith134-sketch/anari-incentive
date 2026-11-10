import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { Icon } from "./Icon.js";
import { api, ApiError, getApiSession } from "../lib/api.js";
import { formatRelative } from "../lib/format.js";
import { matchLocalIntent } from "../lib/agent-intent.js";

/**
 * 全局 AI 助手。
 *
 * 引擎分层：金额/分数/系数永远由确定性规则引擎计算；意图理解分层——
 * 已配置 LLM 时由 LLM 解析开放语句（/agent-chat），未配置时退回本地
 * 关键词意图匹配，常用问法依然可用。两者执行都走同一个任务状态机。
 *
 * 设计规范（anari-design-system §6）：
 * - brand 实色圆角方块 + 白色 spark 作为唯一 AI 视觉标识；
 * - 任务卡带引擎角标（规则引擎）、风险徽章、一键批准/驳回；
 * - 执行一律走既有 agent 任务状态机，T3 必须人工批准。
 */

interface AgentActionView {
  id: string;
  tool: string;
  riskTier: string;
  status: string;
}

interface AgentTaskView {
  id: string;
  agentType: string;
  status: string;
  findings: Array<{ title?: string; detail?: string }>;
  actions: AgentActionView[];
  createdAt: string;
}

interface InboxItemView {
  source: "AGENT_TASK" | "APPROVAL_REQUEST" | "SCORE_PROPOSAL";
  id: string;
  title: string;
  status: string;
  createdAt: string;
  href: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  task?: AgentTaskView;
  at: string;
}

const COMMANDS: Array<{ command: string; label: string; hint: string }> = [
  { command: "scan_evidence_gaps", label: "证据缺口扫描", hint: "找出缺证据/待补证的工作包" },
  { command: "scan_contribution_anomalies", label: "贡献异常扫描", hint: "自我认定、无证据申报" },
  { command: "scan_data_quality", label: "数据质量扫描", hint: "低质量证据与数据问题" },
  { command: "check_settlement_readiness", label: "结算就绪检查", hint: "法律门禁/确认/异议" },
  { command: "run_cycle_pre_review", label: "周期 AI 预审", hint: "为申报批量生成预审草稿" },
  { command: "check_appeal_sla", label: "申诉 SLA 检查", hint: "超时申诉升级提醒" },
  { command: "draft_evaluations", label: "评价草稿生成", hint: "基于证据生成评价草稿" },
  { command: "propose_policy_change", label: "政策变更提案", hint: "生成提案，T3 人工批准" },
];

const AGENT_LABEL: Record<string, string> = {
  EVIDENCE_GAP: "证据缺口",
  SETTLEMENT_READINESS: "结算就绪",
  CONTRIBUTION_ANOMALY: "贡献异常",
  POLICY_PROPOSAL: "政策提案",
  DATA_QUALITY: "数据质量",
  APPEAL_SLA: "申诉 SLA",
  EVALUATION_DRAFT: "评价草稿",
  CYCLE_PRE_REVIEW: "周期预审",
};

function tierTone(tier: string): "neutral" | "warning" | "danger" {
  if (tier === "T3") return "danger";
  if (tier === "T2") return "warning";
  return "neutral";
}

export function AgentAssistant() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [busyCommand, setBusyCommand] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inbox, setInbox] = useState<InboxItemView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [llmStatus, setLlmStatus] = useState<{
    enabled: boolean;
    provider: string | null;
    model: string | null;
  } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const refreshInbox = useCallback(async () => {
    try {
      const result = await api<{ items: InboxItemView[]; total: number }>(
        "/api/v1/agent-inbox",
      );
      setInbox(result.items);
    } catch {
      /* 收件箱失败不打断聊天 */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshInbox();
    const timer = window.setInterval(() => void refreshInbox(), 20_000);
    api<{
      enabled: boolean;
      provider: string | null;
      model: string | null;
    }>("/api/v1/agent-chat/status")
      .then(setLlmStatus)
      .catch(() => setLlmStatus(null));
    return () => window.clearInterval(timer);
  }, [open, refreshInbox]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open]);

  async function executeCommand(command: string): Promise<AgentTaskView> {
    return api<AgentTaskView>("/api/v1/agent-command", {
      method: "POST",
      body: {
        command,
        params: { idempotencyKey: `${command}:${Date.now()}` },
      },
    });
  }

  function summarizeTask(task: AgentTaskView): string {
    const findingCount = task.findings?.length ?? 0;
    const actionCount = task.actions?.length ?? 0;
    const waiting =
      task.actions?.filter((action) => action.status === "WAITING_APPROVAL")
        .length ?? 0;
    return task.status === "WAITING_APPROVAL" || waiting > 0
      ? `完成扫描：${findingCount} 项发现，${actionCount} 项建议动作，其中 ${waiting} 项等待你批准。`
      : `完成扫描：${findingCount} 项发现，${actionCount} 项建议动作已自动执行（低风险）。`;
  }

  async function runCommand(command: string, label: string) {
    setBusyCommand(command);
    setError(null);
    setMessages((current) => [
      ...current,
      { role: "user", text: label, at: new Date().toISOString() },
    ]);
    try {
      const task = await executeCommand(command);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: summarizeTask(task),
          task,
          at: new Date().toISOString(),
        },
      ]);
      void refreshInbox();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "指令执行失败，请稍后再试",
      );
    } finally {
      setBusyCommand(null);
    }
  }

  async function sendChat(event: FormEvent) {
    event.preventDefault();
    const content = chatInput.trim();
    if (!content || chatSending) return;
    setChatSending(true);
    setError(null);
    setMessages((current) => [
      ...current,
      { role: "user", text: content, at: new Date().toISOString() },
    ]);
    setChatInput("");
    const llmReady = llmStatus?.enabled === true;
    if (!llmReady) {
      // LLM 未配置：确定性本地意图匹配兜底，金额/分数依然只由规则引擎产生。
      const intent = matchLocalIntent(content);
      if (intent) {
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            text: `（本地意图匹配「${intent.keyword}」，未调用 LLM）已执行${intent.label}。`,
            at: new Date().toISOString(),
          },
        ]);
        try {
          setBusyCommand(intent.command);
          const task = await executeCommand(intent.command);
          setMessages((current) => [
            ...current,
            {
              role: "assistant",
              text: summarizeTask(task),
              task,
              at: new Date().toISOString(),
            },
          ]);
          void refreshInbox();
        } catch (caught) {
          setError(
            caught instanceof ApiError
              ? caught.message
              : "指令执行失败，请稍后再试",
          );
        } finally {
          setBusyCommand(null);
          setChatSending(false);
        }
        return;
      }
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text:
            "这个说法我没能本地匹配到指令。可以直接点上方指令按钮；或让管理员配置 LLM_PROVIDER/LLM_API_KEY（支持 DeepSeek/GLM/Kimi）后，我就能理解任意说法。",
          at: new Date().toISOString(),
        },
      ]);
      setChatSending(false);
      return;
    }
    try {
      const history = [...messages, {
        role: "user" as const,
        text: content,
        at: new Date().toISOString(),
      }]
        .slice(-10)
        .map((message) => ({ role: message.role, content: message.text }));
      let result: { reply: string; task: AgentTaskView | null };
      try {
        result = await api<{
          reply: string;
          task: AgentTaskView | null;
        }>("/api/v1/agent-chat", { method: "POST", body: { messages: history } });
      } catch (caught) {
        // LLM 状态过期/调用失败时退回本地意图，而不是把用户挡在门外。
        const intent = caught instanceof ApiError ? matchLocalIntent(content) : null;
        if (!intent) throw caught;
        const task = await executeCommand(intent.command);
        result = {
          reply: `（LLM 不可用，已本地匹配「${intent.keyword}」）`,
          task,
        };
      }
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: result.reply,
          task: result.task ?? undefined,
          at: new Date().toISOString(),
        },
      ]);
      void refreshInbox();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "发送失败");
    } finally {
      setChatSending(false);
    }
  }

  async function decide(task: AgentTaskView, action: AgentActionView, decision: "approve" | "reject") {
    setError(null);
    try {
      const session = getApiSession();
      const approver =
        session.personId || "00000000-0000-4000-8000-000000000001";
      if (decision === "approve") {
        await api(`/api/v1/agent-tasks/${task.id}/approve`, {
          method: "POST",
          body: { actionId: action.id, approverPersonId: approver },
        });
      } else {
        const reason = window.prompt("驳回原因（会写入审计）", "人工判断不采纳");
        if (!reason) return;
        await api(`/api/v1/agent-tasks/${task.id}/reject`, {
          method: "POST",
          body: { actionId: action.id, approverPersonId: approver, reason },
        });
      }
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text:
            decision === "approve"
              ? "动作已批准并执行完成。"
              : "动作已驳回，已记录审计。",
          at: new Date().toISOString(),
        },
      ]);
      void refreshInbox();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "操作失败");
    }
  }

  // 路由切换时收起抽屉，避免遮挡新页面。
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <>
      <button
        type="button"
        className="agent-fab"
        aria-label={open ? "关闭 AI 助手" : "打开 AI 助手"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="spark" size={20} />
        {inbox.length > 0 ? (
          <span className="agent-fab__badge" aria-hidden="true">
            {inbox.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="agent-drawer__scrim"
            aria-label="关闭 AI 助手"
            onClick={() => setOpen(false)}
          />
          <aside className="agent-drawer" role="dialog" aria-label="AI 助手">
            <header className="agent-drawer__header">
              <span className="agent-drawer__engine">
                <Icon name="spark" size={16} />
                {llmStatus?.enabled && llmStatus.provider
                  ? `意图解析 · ${llmStatus.provider.toUpperCase()} · 规则计算`
                  : "本地意图 · 规则计算（LLM 未配置）"}
              </span>
              <strong>AI 助手</strong>
              <button
                type="button"
                className="agent-drawer__close"
                aria-label="关闭"
                onClick={() => setOpen(false)}
              >
                <Icon name="close" size={18} />
              </button>
            </header>

            <div className="agent-drawer__commands" aria-label="常用指令">
              {COMMANDS.map((command) => (
                <button
                  key={command.command}
                  type="button"
                  className="agent-command"
                  title={command.hint}
                  disabled={busyCommand !== null}
                  onClick={() => void runCommand(command.command, command.label)}
                >
                  {busyCommand === command.command ? "执行中…" : command.label}
                </button>
              ))}
            </div>

            {error ? (
              <div className="agent-drawer__error" role="alert">
                {error}
              </div>
            ) : null}

            <div className="agent-drawer__messages" ref={listRef}>
              {messages.length === 0 ? (
                <p className="agent-drawer__empty">
                  选择上方指令，助手会执行对应扫描并给出任务卡；高风险动作需要你批准后才执行。
                </p>
              ) : null}
              {messages.map((message, index) => (
                <div
                  key={`${message.at}-${index}`}
                  className={`agent-msg agent-msg--${message.role}`}
                >
                  <div className="agent-msg__bubble">{message.text}</div>
                  {message.task ? (
                    <div className="task-card">
                      <div className="task-card__head">
                        <strong>
                          {AGENT_LABEL[message.task.agentType] ??
                            message.task.agentType}
                        </strong>
                        <span className="task-card__engine">规则引擎</span>
                        <span className="task-card__status">
                          {message.task.status}
                        </span>
                      </div>
                      {(message.task.findings ?? []).slice(0, 5).map((finding, findingIndex) => (
                        <p
                          className="task-card__finding"
                          key={findingIndex}
                          title={finding.detail ?? finding.title}
                        >
                          {finding.title ?? finding.detail ?? "发现"}
                        </p>
                      ))}
                      {(message.task.actions ?? []).length > 0 ? (
                        <ul className="task-card__actions">
                          {(message.task.actions ?? []).map((action) => (
                            <li key={action.id}>
                              <span className={`tier-badge tier-badge--${tierTone(action.riskTier)}`}>
                                {action.riskTier}
                              </span>
                              <span className="task-card__tool">{action.tool}</span>
                              {action.status === "WAITING_APPROVAL" ? (
                                <span className="task-card__decide">
                                  <button
                                    type="button"
                                    onClick={() => void decide(message.task!, action, "approve")}
                                  >
                                    批准
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost"
                                    onClick={() => void decide(message.task!, action, "reject")}
                                  >
                                    驳回
                                  </button>
                                </span>
                              ) : (
                                <span className="task-card__done">{action.status}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <form className="agent-drawer__chat-input" onSubmit={sendChat}>
              <input
                type="text"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder={
                  llmStatus?.enabled
                    ? "描述你想做的事，例如“扫描本月证据缺口”…"
                    : "直接描述，例如“查一下证据缺口”——本地意图匹配，无需 LLM"
                }
                aria-label="对 AI 助手说点什么"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || chatSending}
                aria-label="发送"
              >
                <Icon name="arrow-up-right" size={16} />
              </button>
            </form>

            <footer className="agent-drawer__inbox">
              <strong>
                待办收件箱{inbox.length > 0 ? ` · ${inbox.length}` : ""}
              </strong>
              {inbox.length === 0 ? (
                <p>没有等待你处理的审批。</p>
              ) : (
                <ul>
                  {inbox.slice(0, 6).map((item) => (
                    <li key={`${item.source}-${item.id}`}>
                      <span className="agent-inbox__title">{item.title}</span>
                      <span className="agent-inbox__meta">
                        {formatRelative(item.createdAt)}
                      </span>
                      <a href={item.href}>处理</a>
                    </li>
                  ))}
                </ul>
              )}
            </footer>
          </aside>
        </>
      ) : null}
    </>
  );
}
