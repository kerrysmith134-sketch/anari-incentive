import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Icon } from "./Icon.js";
import { api, ApiError, getApiSession } from "../lib/api.js";
import { formatRelative } from "../lib/format.js";

/**
 * 全局 AI 助手（第一阶段：智能指令台 + 任务卡，无 LLM）。
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
    return () => window.clearInterval(timer);
  }, [open, refreshInbox]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open]);

  async function runCommand(command: string, label: string) {
    setBusyCommand(command);
    setError(null);
    setMessages((current) => [
      ...current,
      { role: "user", text: label, at: new Date().toISOString() },
    ]);
    try {
      const task = await api<AgentTaskView>("/api/v1/agent-command", {
        method: "POST",
        body: {
          command,
          params: { idempotencyKey: `${command}:${Date.now()}` },
        },
      });
      const findingCount = task.findings?.length ?? 0;
      const actionCount = task.actions?.length ?? 0;
      const waiting = task.actions?.filter((action) => action.status === "WAITING_APPROVAL").length ?? 0;
      const summary =
        task.status === "WAITING_APPROVAL" || waiting > 0
          ? `完成扫描：${findingCount} 项发现，${actionCount} 项建议动作，其中 ${waiting} 项等待你批准。`
          : `完成扫描：${findingCount} 项发现，${actionCount} 项建议动作已自动执行（低风险）。`;
      setMessages((current) => [
        ...current,
        { role: "assistant", text: summary, task, at: new Date().toISOString() },
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
          body: { actionId: action.id, rejecterPersonId: approver, reason },
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
                规则引擎 · 无 LLM
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
