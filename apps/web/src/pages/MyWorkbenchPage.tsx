import {
  Badge,
  EmptyState,
  InfoNotice,
  LoadingRows,
  PageHeader,
  Panel,
} from "../components/ui.js";
import { useAuth } from "../contexts/AuthContext.js";
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
          </Panel>
        </>
      )}
    </>
  );
}
