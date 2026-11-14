import { useMemo, useState } from "react";
import {
  Badge,
  EmptyState,
  InfoNotice,
  LoadingRows,
  PageHeader,
  Panel,
  Select,
} from "../components/ui.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";

/**
 * NPV2-029：Management Center——主管工作空间。
 * 集中待认定、独立评价进度、异常、团队覆盖、周期准备度；
 * AI 草稿在评审人完成独立判断前隐藏内容（只显示状态）。
 * 主管能识别下一步：每面板给出行动提示。
 */

interface ReadinessReport {
  cycleId: string;
  readyForSettlement: boolean;
  calculations: {
    total: number;
    formal: number;
    formalLocked: number;
  };
  legalGates: Array<{ policyVersionId: string; recorded: boolean; blockers: string[] }>;
  settlement: {
    total: number;
    exported: number;
  };
}

interface DraftView {
  id: string;
  cycleId: string;
  personId: string;
  status: string;
}

interface DecisionView {
  id: string;
  personId: string;
  cycleId: string;
  status: string;
  independentScores: Record<string, number>;
}

interface ClaimView {
  id: string;
  claimantPersonId: string;
  status: string;
  exceptionReason?: string;
}

interface AppealView {
  id: string;
  status: string;
  reasonCode: string;
  statement: string;
}

export function ManagementCenterPage() {
  useDocumentTitle("管理中心");
  const [cycleId, setCycleId] = useState("");

  const cyclesQuery = useApiQuery<
    { id: string; name: string; status: string }[]
  >("/api/v1/evaluation-cycles");
  const activeCycle = cycleId || cyclesQuery.data?.[0]?.id || "";

  const readinessQuery = useApiQuery<ReadinessReport>(
    activeCycle
      ? `/api/v1/reports/cycle-readiness?cycleId=${encodeURIComponent(activeCycle)}`
      : null,
    activeCycle,
  );
  const draftsQuery = useApiQuery<DraftView[]>(
    activeCycle
      ? `/api/v1/evaluation-drafts?cycleId=${encodeURIComponent(activeCycle)}`
      : null,
    activeCycle,
  );
  const decisionsQuery = useApiQuery<DecisionView[]>(
    activeCycle
      ? `/api/v1/evaluation-decisions?cycleId=${encodeURIComponent(activeCycle)}`
      : null,
    activeCycle,
  );
  const claimsQuery = useApiQuery<ClaimView[]>(
    "/api/v1/contribution-claims",
    "claims",
  );
  const appealsQuery = useApiQuery<AppealView[]>(
    "/api/v1/appeals",
    "appeals",
  );

  const exceptionClaims = useMemo(
    () =>
      (claimsQuery.data ?? []).filter(
        (claim) =>
          claim.status === "DISPUTED" || claim.status === "NEEDS_EVIDENCE",
      ),
    [claimsQuery.data],
  );
  const openAppeals = (appealsQuery.data ?? []).filter(
    (appeal) => appeal.status !== "DECIDED" && appeal.status !== "CLOSED",
  );

  // NPV2-029：AI 草稿隐藏——独立判断完成的评审人才能看到关联草稿内容。
  const submittedDrafts = (draftsQuery.data ?? []).filter(
    (draft) => draft.status === "SUBMITTED",
  );
  const decidedByPerson = new Set(
    (decisionsQuery.data ?? [])
      .filter(
        (decision) =>
          Object.keys(decision.independentScores ?? {}).length > 0,
      )
      .map((decision) => decision.personId),
  );
  const hiddenDrafts = submittedDrafts.filter(
    (draft) => !decidedByPerson.has(draft.personId),
  );
  const visibleDrafts = submittedDrafts.filter((draft) =>
    decidedByPerson.has(draft.personId),
  );

  const coverage = useMemo(() => {
    const people = new Set(
      (draftsQuery.data ?? []).map((draft) => draft.personId),
    );
    const decided = [...people].filter((person) =>
      (decisionsQuery.data ?? []).some(
        (decision) => decision.personId === person,
      ),
    );
    return {
      total: people.size,
      decided: decided.length,
      pending: people.size - decided.length,
    };
  }, [draftsQuery.data, decisionsQuery.data]);

  const loading =
    cyclesQuery.loading ||
    readinessQuery.loading ||
    draftsQuery.loading ||
    decisionsQuery.loading ||
    claimsQuery.loading ||
    appealsQuery.loading;
  const error =
    cyclesQuery.error ||
    readinessQuery.error ||
    draftsQuery.error ||
    decisionsQuery.error ||
    claimsQuery.error ||
    appealsQuery.error;

  return (
    <>
      <PageHeader
        eyebrow="考核与认定"
        title="管理中心"
        description="待认定、独立评价进度、异常、团队覆盖与周期准备度——主管从这里识别下一步。"
      />
      <Panel title="周期选择">
        <Select
          value={activeCycle}
          onChange={(event) => setCycleId(event.target.value)}
          aria-label="选择考核周期"
        >
          <option value="">— 选择周期 —</option>
          {(cyclesQuery.data ?? []).map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              {cycle.name}（{cycle.status}）
            </option>
          ))}
        </Select>
        {error ? (
          <InfoNotice tone="warning">
            数据加载失败：{(error as Error).message}
          </InfoNotice>
        ) : null}
      </Panel>

      {loading ? (
        <LoadingRows rows={6} />
      ) : (
        <>
          <Panel title="周期准备度（七门禁）">
            {readinessQuery.data ? (
              <>
                <InfoNotice tone={readinessQuery.data.readyForSettlement ? "success" : "warning"}>
                  {readinessQuery.data.readyForSettlement
                    ? "周期就绪：可进入结算（需财务执行）。"
                    : "周期未就绪：存在未满足的门禁，见下方异常与阻断项。"}
                </InfoNotice>
                <ul className="stack-list">
                  <li>
                    计算：{readinessQuery.data.calculations.formalLocked} /{" "}
                    {readinessQuery.data.calculations.formal} 个正式运行已锁定
                  </li>
                  {readinessQuery.data.legalGates.map((gate) => (
                    <li key={gate.policyVersionId}>
                      法务门禁 {gate.policyVersionId.slice(0, 8)}：{" "}
                      {gate.recorded ? "已记录" : `缺失（${gate.blockers.join("; ")}）`}
                    </li>
                  ))}
                  <li>
                    结算批次：{readinessQuery.data.settlement.total} 个（已导出{" "}
                    {readinessQuery.data.settlement.exported}）
                  </li>
                </ul>
                <InfoNotice>
                  Agent 与本页面均不执行锁账/结算——这些操作在结算模块由财务与审批路径完成。
                </InfoNotice>
              </>
            ) : (
              <EmptyState title="选择周期" description="选择考核周期以查看准备度。" />
            )}
          </Panel>

          <Panel title={`独立评价进度（已决 ${coverage.decided} / ${coverage.total} 人）`}>
            {coverage.total === 0 ? (
              <EmptyState
                title="暂无评价草案"
                description="周期内生成或提交评价草案后，进度会出现在这里。"
              />
            ) : (
              <>
                <InfoNotice tone={coverage.pending > 0 ? "warning" : "success"}>
                  {coverage.pending > 0
                    ? `${coverage.pending} 人待完成独立判断——完成前其关联 AI 草稿保持隐藏。`
                    : "全部独立判断已完成。"}
                </InfoNotice>
                <ul className="stack-list">
                  {hiddenDrafts.map((draft) => (
                    <li key={draft.id}>
                      <Badge status="NEEDS_EVIDENCE">AI 草稿已隐藏</Badge>{" "}
                      人员 {draft.personId.slice(0, 8)}{" "}
                      <span className="muted">
                        先完成独立判断（ATT-06），再揭示 AI 草稿。
                      </span>
                    </li>
                  ))}
                  {visibleDrafts.map((draft) => (
                    <li key={draft.id}>
                      <Badge status="APPROVED">AI 草稿已揭示</Badge>{" "}
                      人员 {draft.personId.slice(0, 8)}{" "}
                      <span className="muted">独立判断已记录，可对比 AI 草稿。</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel title={`异常申报（${exceptionClaims.length}）`}>
            {exceptionClaims.length === 0 ? (
              <EmptyState
                title="无异常申报"
                description="冲突、补证、自裁等异常会出现在这里。"
              />
            ) : (
              <ul className="stack-list">
                {exceptionClaims.map((claim) => (
                  <li key={claim.id}>
                    <Badge status={claim.status}>{claim.status}</Badge>{" "}
                    申报 {claim.id.slice(0, 8)}{" "}
                    {claim.exceptionReason ? (
                      <span className="muted">{claim.exceptionReason}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <InfoNotice>
              下一步：NEEDS_EVIDENCE → 指派补证；DISPUTED → 指派独立复核（不由 Agent 自动裁决）。
            </InfoNotice>
          </Panel>

          <Panel title={`未结申诉（${openAppeals.length}）`}>
            {openAppeals.length === 0 ? (
              <EmptyState title="无未结申诉" />
            ) : (
              <ul className="stack-list">
                {openAppeals.map((appeal) => (
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
