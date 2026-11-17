import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  generatedByType?: string;
  /** NP-004：服务端盲审掩码标记——内容未揭示。 */
  contentHidden?: boolean;
  strengths?: string[];
  counterEvidence?: string[];
  missingInformation?: string[];
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

/** AUD-015：覆盖率以全员 roster 为分母（后端计算，前端只渲染）。 */
interface CoverageReport {
  cycleId: string;
  denominator: number;
  eligibleCount: number;
  withDraft: number;
  decided: number;
  pending: number;
  excluded: Array<{ personId: string; displayName: string; reason: string }>;
  perPerson: Array<{
    personId: string;
    displayName: string;
    draftId: string | null;
    draftStatus: string | null;
    decided: boolean;
    state: "DECIDED" | "DRAFT_PENDING" | "NO_DRAFT";
  }>;
  note: string;
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
  // AUD-015：覆盖率分母 = 在职 roster（后端按周期计算）。
  const coverageQuery = useApiQuery<CoverageReport>(
    activeCycle
      ? `/api/v1/reports/evaluation-coverage?cycleId=${encodeURIComponent(activeCycle)}`
      : null,
    activeCycle ? `coverage-${activeCycle}` : "coverage",
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
  // NP-004：AI 草稿（非 USER）分两类——SUBMITTED 阶段由服务端掩码
  // （contentHidden），决定后揭示。USER 草稿不属于盲审范围。
  const aiDrafts = (draftsQuery.data ?? []).filter(
    (draft) => draft.generatedByType !== "USER",
  );
  const hiddenDrafts = aiDrafts.filter(
    (draft) => draft.contentHidden || draft.status === "SUBMITTED",
  );
  const visibleDrafts = aiDrafts.filter(
    (draft) => !draft.contentHidden && draft.status !== "SUBMITTED",
  );

  const coverage = coverageQuery.data;

  const loading =
    cyclesQuery.loading ||
    readinessQuery.loading ||
    draftsQuery.loading ||
    decisionsQuery.loading ||
    claimsQuery.loading ||
    appealsQuery.loading ||
    coverageQuery.loading;
  const error =
    cyclesQuery.error ||
    readinessQuery.error ||
    draftsQuery.error ||
    decisionsQuery.error ||
    claimsQuery.error ||
    appealsQuery.error ||
    coverageQuery.error;

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
                    {readinessQuery.data.calculations.formal} 个正式运行已锁定{" "}
                    <Link to="/console/cycles">→ 考核周期</Link>
                  </li>
                  {readinessQuery.data.legalGates.map((gate) => (
                    <li key={gate.policyVersionId}>
                      法务门禁 {gate.policyVersionId.slice(0, 8)}：{" "}
                      {gate.recorded ? "已记录" : `缺失（${gate.blockers.join("; ")}）`}
                    </li>
                  ))}
                  <li>
                    结算批次：{readinessQuery.data.settlement.total} 个（已导出{" "}
                    {readinessQuery.data.settlement.exported}）{" "}
                    <Link to="/console/settlements">→ 结算</Link>
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

          <Panel title={`独立评价进度（已决 ${coverage?.decided ?? 0} / ${coverage?.denominator ?? 0} 在职人员）`}>
            {!coverage || coverage.denominator === 0 ? (
              <EmptyState
                title="暂无评价草案"
                description="同步组织架构后，覆盖率会以在职 roster 为分母出现在这里。"
              />
            ) : (
              <>
                <InfoNotice tone={coverage.pending > 0 ? "warning" : "success"}>
                  分母 = 在职 roster {coverage.denominator} 人（不含离职
                  {coverage.excluded.length > 0 ? ` ${coverage.excluded.length} 人` : ""}）。
                  {coverage.pending > 0
                    ? `${coverage.pending} 人待完成独立判断——完成前其关联 AI 草稿保持隐藏。`
                    : "全部在职人员的独立判断已完成。"}
                </InfoNotice>
                <ul className="stack-list">
                  {coverage.perPerson
                    .filter((entry) => entry.state === "NO_DRAFT")
                    .map((entry) => (
                      <li key={entry.personId}>
                        <Badge status="NEEDS_EVIDENCE">无草案</Badge>{" "}
                        {entry.displayName}{" "}
                        <span className="muted">
                          未生成评价草案——需要先补齐草案，不能从分母豁免。
                        </span>
                      </li>
                    ))}
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
                      {((draft.strengths?.length ?? 0) +
                        (draft.counterEvidence?.length ?? 0) +
                        (draft.missingInformation?.length ?? 0)) > 0 ? (
                        <ul className="stack-list muted">
                          {(draft.strengths ?? []).map((item, index) => (
                            <li key={`s-${index}`}>支持证据：{item}</li>
                          ))}
                          {(draft.counterEvidence ?? []).map((item, index) => (
                            <li key={`c-${index}`}>反证：{item}</li>
                          ))}
                          {(draft.missingInformation ?? []).map((item, index) => (
                            <li key={`m-${index}`}>缺失信息：{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="muted">该草稿无支持/反证/缺失信息条目。</div>
                      )}
                    </li>
                  ))}
                </ul>
                {coverage.excluded.length > 0 ? (
                  <InfoNotice>
                    排除项：{coverage.excluded.map((entry) => `${entry.displayName}（${entry.reason}）`).join("、")}
                  </InfoNotice>
                ) : null}
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
