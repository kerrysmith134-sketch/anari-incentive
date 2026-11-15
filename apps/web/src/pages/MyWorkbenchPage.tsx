import { useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  InfoNotice,
  LoadingRows,
  Modal,
  PageHeader,
  Panel,
  Select,
  Textarea,
} from "../components/ui.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { api, ApiError } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";

/**
 * NPV2-028：My Workbench——个人工作台。
 * 合并个人贡献、补证、绩效解释、确认、申诉与待办六个作用域面板；
 * 全部走 me 过滤（服务端 personFilter 强制，无权查看他人数据）。
 */
export function MyWorkbenchPage() {
  useDocumentTitle("我的工作台");
  const { session } = useAuth();
  const me = session.personId;

  const todosQuery = useApiQuery<
    {
      id: string;
      title: string;
      detail?: string;
      sourceType: string;
      status: string;
      dueAt?: string;
      targetType?: string;
      targetId?: string;
    }[]
  >(
    `/api/v1/agent-todos?assigneePersonId=${encodeURIComponent(me)}&status=OPEN`,
    me,
  );
  const claimsQuery = useApiQuery<
    {
      id: string;
      workPackageId: string;
      status: string;
      claimedContribution?: { summary?: string };
      rationale: string;
    }[]
  >("/api/v1/contribution-claims", me);
  const eventsQuery = useApiQuery<
    {
      id: string;
      action: string;
      kind: string;
      occurredAt: string;
      outcome?: { summary?: string };
    }[]
  >(
    `/api/v1/contribution-events?subjectPersonId=${encodeURIComponent(me)}`,
    me,
  );
  const decisionsQuery = useApiQuery<
    {
      id: string;
      cycleId: string;
      status: string;
      scores: Record<string, number>;
      rationale: string;
    }[]
  >(
    `/api/v1/evaluation-decisions?personId=${encodeURIComponent(me)}`,
    me,
  );
  const confirmationsQuery = useApiQuery<
    {
      id: string;
      targetType: string;
      targetId: string;
      decision: string;
      createdAt: string;
    }[]
  >("/api/v1/employee-confirmations", me);
  const appealsQuery = useApiQuery<
    { id: string; reasonCode: string; status: string; statement: string }[]
  >("/api/v1/appeals", me);

  // ------------------------------------------------------------------
  // AUD-016：行内动作闭环——补证/完成待办/确认结果/申诉直接在工作台完成，
  // 动作后状态回写（reload），不再要求用户跨菜单寻找入口。
  // ------------------------------------------------------------------
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [evidenceTarget, setEvidenceTarget] = useState<
    { workPackageId: string; label: string } | undefined
  >();
  const [evidenceNote, setEvidenceNote] = useState("");
  const [appealTarget, setAppealTarget] = useState<
    { targetType: "EVALUATION" | "CALCULATION" | "ATTRIBUTION" | "LEDGER"; targetId: string } | undefined
  >();
  const [appealReason, setAppealReason] = useState("EVALUATION_DISPUTE");
  const [appealStatement, setAppealStatement] = useState("");

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      todosQuery.reload();
      claimsQuery.reload();
      confirmationsQuery.reload();
      appealsQuery.reload();
      toast.success(success);
    } catch (caught) {
      toast.error(
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : String(caught),
      );
    } finally {
      setBusy(false);
    }
  };

  const completeTodo = (todoId: string) =>
    runAction(
      () =>
        api(`/api/v1/agent-todos/${todoId}/complete`, {
          method: "POST",
          body: { completedByPersonId: me },
        }),
      "待办已完成",
    );

  const openEvidence = (workPackageId: string, label: string) => {
    setEvidenceTarget({ workPackageId, label });
    setEvidenceNote("");
  };

  const submitEvidence = () =>
    runAction(async () => {
      if (!evidenceTarget) return;
      await api("/api/v1/evidence", {
        method: "POST",
        body: {
          subjectType: "WORK_PACKAGE",
          subjectId: evidenceTarget.workPackageId,
          evidenceType: "NOTE",
          sourceSystem: "WORKBENCH",
          observedAt: new Date().toISOString(),
          qualityStatus: "UNVERIFIED",
          normalizedPayload: { note: evidenceNote },
          submittedBy: me,
        },
      });
      setEvidenceTarget(undefined);
    }, "证据已提交，等待复核");

  const openAppeal = (
    targetType: "EVALUATION" | "CALCULATION" | "ATTRIBUTION" | "LEDGER",
    targetId: string,
  ) => {
    setAppealTarget({ targetType, targetId });
    setAppealReason(targetType === "EVALUATION" ? "EVALUATION_DISPUTE" : "ATTRIBUTION_DISPUTE");
    setAppealStatement("");
  };

  const submitAppeal = () =>
    runAction(async () => {
      if (!appealTarget) return;
      await api("/api/v1/appeals", {
        method: "POST",
        body: {
          appellantPersonId: me,
          targetType: appealTarget.targetType,
          targetId: appealTarget.targetId,
          reasonCode: appealReason,
          statement: appealStatement,
        },
      });
      setAppealTarget(undefined);
    }, "申诉已提交，进入复核流程");

  const confirmCalculation = (targetId: string, decision: "CONFIRMED" | "OBJECTED") =>
    runAction(
      () =>
        api("/api/v1/employee-confirmations", {
          method: "POST",
          body: {
            personId: me,
            targetType: "CALCULATION",
            targetId,
            decision,
          },
        }),
      decision === "CONFIRMED" ? "已确认计算结果" : "已提交异议",
    );

  const loading =
    todosQuery.loading ||
    claimsQuery.loading ||
    eventsQuery.loading ||
    decisionsQuery.loading ||
    confirmationsQuery.loading ||
    appealsQuery.loading;
  const error =
    todosQuery.error ||
    claimsQuery.error ||
    eventsQuery.error ||
    decisionsQuery.error ||
    confirmationsQuery.error ||
    appealsQuery.error;

  return (
    <>
      <PageHeader
        eyebrow="工作台"
        title="我的工作台"
        description="贡献、补证、绩效解释、确认与申诉——个人作用域聚合，无需跨菜单寻找。"
      />
      {error ? (
        <InfoNotice tone="warning">
          数据加载失败：{(error as Error).message}
        </InfoNotice>
      ) : null}

      {loading ? (
        <LoadingRows rows={6} />
      ) : (
        <>
          <Panel title="我的待办">
            {(todosQuery.data ?? []).length === 0 ? (
              <EmptyState
                icon="clock"
                title="暂无待办"
                description="Agent 或同事指派给你的补证、裁决、跟进任务会出现在这里。"
              />
            ) : (
              <ul className="stack-list">
                {(todosQuery.data ?? []).map((todo) => (
                  <li key={todo.id}>
                    <Badge status={todo.status}>{todo.status}</Badge>{" "}
                    <strong>{todo.title}</strong>
                    {todo.detail ? (
                      <div className="muted">{todo.detail}</div>
                    ) : null}
                    <div className="muted">
                      来源 {todo.sourceType}
                      {todo.dueAt ? ` · 截止 ${todo.dueAt.slice(0, 10)}` : ""}
                    </div>
                    {todo.status === "OPEN" ? (
                      <div className="stack-row-actions">
                        {todo.targetType === "WORK_PACKAGE" && todo.targetId ? (
                          <Button
                            variant="primary"
                            disabled={busy}
                            onClick={() => openEvidence(todo.targetId!, todo.title)}
                          >
                            补交证据
                          </Button>
                        ) : null}
                        {todo.targetType === "CALCULATION" && todo.targetId ? (
                          <>
                            <Button variant="primary" disabled={busy} onClick={() => confirmCalculation(todo.targetId!, "CONFIRMED")}>
                              确认结果
                            </Button>
                            <Button variant="secondary" disabled={busy} onClick={() => confirmCalculation(todo.targetId!, "OBJECTED")}>
                              提出异议
                            </Button>
                          </>
                        ) : null}
                        <Button variant="secondary" disabled={busy} onClick={() => completeTodo(todo.id)}>
                          标记完成
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="我的贡献申报">
            {(claimsQuery.data ?? []).length === 0 ? (
              <EmptyState
                icon="layers"
                title="暂无申报"
                description="在贡献认定页面提交的申报会出现在这里。"
              />
            ) : (
              <ul className="stack-list">
                {(claimsQuery.data ?? []).map((claim) => (
                  <li key={claim.id}>
                    <Badge status={claim.status}>{claim.status}</Badge>{" "}
                    <strong>
                      {claim.claimedContribution?.summary ?? claim.rationale}
                    </strong>{" "}
                    <span className="muted">
                      工作包 {claim.workPackageId.slice(0, 8)}
                    </span>
                    {claim.status === "NEEDS_EVIDENCE" ? (
                      <div className="stack-row-actions">
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={() =>
                            openEvidence(claim.workPackageId, claim.claimedContribution?.summary ?? claim.rationale)
                          }
                        >
                          补交证据
                        </Button>
                      </div>
                    ) : null}
                    {claim.status === "DISPUTED" ? (
                      <div className="muted">该申报有争议——可就对应绩效决定发起申诉。</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="我的贡献事件">
            {(eventsQuery.data ?? []).length === 0 ? (
              <EmptyState
                icon="layers"
                title="暂无贡献事件"
                description="连接器与人工录入的贡献事实会出现在这里。"
              />
            ) : (
              <ul className="stack-list">
                {(eventsQuery.data ?? []).slice(0, 20).map((event) => (
                  <li key={event.id}>
                    <Badge
                      status={event.kind === "CONTRIBUTION" ? "APPROVED" : "CANCELLED"}
                    >
                      {event.kind === "CONTRIBUTION"
                        ? "贡献"
                        : event.kind === "ACTIVITY"
                          ? "活动量"
                          : "上下文"}
                    </Badge>{" "}
                    <strong>{event.action}</strong>{" "}
                    <span className="muted">
                      {event.outcome?.summary ?? ""} ·{" "}
                      {event.occurredAt.slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="我的绩效与解释">
            {(decisionsQuery.data ?? []).length === 0 ? (
              <EmptyState
                icon="policy"
                title="暂无绩效决定"
                description="评价周期内的正式决定（含评分与理由）会出现在这里。"
              />
            ) : (
              <ul className="stack-list">
                {(decisionsQuery.data ?? []).map((decision) => (
                  <li key={decision.id}>
                    <Badge status={decision.status}>{decision.status}</Badge>{" "}
                    <strong>
                      {Object.entries(decision.scores ?? {})
                        .map(([dim, score]) => `${dim}:${score}`)
                        .join(" / ") || "无评分"}
                    </strong>{" "}
                    <span className="muted">
                      周期 {decision.cycleId.slice(0, 8)} ·{" "}
                      {decision.rationale}
                    </span>
                    <div className="stack-row-actions">
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => openAppeal("EVALUATION", decision.id)}
                      >
                        发起申诉
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <InfoNotice>
              绩效决定可追溯：引用冻结的指标计量快照与 Rubric 版本；如需核对原始数据请联系数据管理员导出快照。
            </InfoNotice>
          </Panel>

          <Panel title="我的确认">
            {(confirmationsQuery.data ?? []).length === 0 ? (
              <EmptyState
                icon="clock"
                title="暂无确认记录"
                description="对计算结果与工资单的确认记录会出现在这里。"
              />
            ) : (
              <ul className="stack-list">
                {(confirmationsQuery.data ?? []).map((confirmation) => (
                  <li key={confirmation.id}>
                    <Badge status={confirmation.decision}>
                      {confirmation.decision === "CONFIRMED"
                        ? "已确认"
                        : confirmation.decision === "OBJECTED"
                          ? "异议"
                          : "已阅"}
                    </Badge>{" "}
                    {confirmation.targetType}{" "}
                    {confirmation.targetId.slice(0, 8)}{" "}
                    <span className="muted">
                      {confirmation.createdAt.slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="我的申诉">
            {(appealsQuery.data ?? []).length === 0 ? (
              <EmptyState
                icon="alert-circle"
                title="暂无申诉"
                description="如对认定结果有异议，请在申诉与例外页面发起（带证据引用）。"
              />
            ) : (
              <ul className="stack-list">
                {(appealsQuery.data ?? []).map((appeal) => (
                  <li key={appeal.id}>
                    <Badge status={appeal.status}>{appeal.status}</Badge>{" "}
                    <strong>{appeal.reasonCode}</strong>{" "}
                    <span className="muted">{appeal.statement}</span>
                  </li>
                ))}
              </ul>
            )}
            <InfoNotice>
              对绩效决定或计算结果有异议，可直接在本页发起申诉（ATT-09：受理后 10 日内裁决）。
            </InfoNotice>
          </Panel>

          <Modal
            open={Boolean(evidenceTarget)}
            title={`补交证据：${evidenceTarget?.label ?? ""}`}
            onClose={() => setEvidenceTarget(undefined)}
          >
            <Textarea
              aria-label="证据说明"
              value={evidenceNote}
              onChange={(event) => setEvidenceNote(event.target.value)}
              rows={4}
              placeholder="说明交付事实、来源与可核对方式（不含活动量监测内容）。"
            />
            <div className="stack-row-actions">
              <Button variant="primary" disabled={busy || evidenceNote.trim().length < 5} onClick={submitEvidence}>
                提交证据
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setEvidenceTarget(undefined)}>
                取消
              </Button>
            </div>
          </Modal>

          <Modal
            open={Boolean(appealTarget)}
            title={`发起申诉（${appealTarget?.targetType ?? ""} ${appealTarget?.targetId.slice(0, 8) ?? ""}）`}
            onClose={() => setAppealTarget(undefined)}
          >
            <Select
              aria-label="申诉原因"
              value={appealReason}
              onChange={(event) => setAppealReason(event.target.value)}
            >
              <option value="EVALUATION_DISPUTE">评价结果争议</option>
              <option value="ATTRIBUTION_DISPUTE">贡献归属争议</option>
              <option value="DATA_ERROR">数据错误</option>
              <option value="PROCESS_VIOLATION">流程违规</option>
            </Select>
            <Textarea
              aria-label="申诉陈述"
              value={appealStatement}
              onChange={(event) => setAppealStatement(event.target.value)}
              rows={4}
              placeholder="陈述异议理由（至少 5 字）；证据可随后在申诉页补交。"
            />
            <div className="stack-row-actions">
              <Button
                variant="primary"
                disabled={busy || appealStatement.trim().length < 5}
                onClick={submitAppeal}
              >
                提交申诉
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setAppealTarget(undefined)}>
                取消
              </Button>
            </div>
          </Modal>
        </>
      )}
    </>
  );
}
