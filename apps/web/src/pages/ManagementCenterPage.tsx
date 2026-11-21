import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  InfoNotice,
  LoadingRows,
  PageHeader,
  Panel,
  Select,
  Textarea,
} from "../components/ui.js";
import { BarChart } from "../components/charts.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { api, ApiError } from "../lib/api.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";

/**
 * NPV2-029：Management Center——主管工作空间。
 * 集中待认定、独立评价进度、异常、团队覆盖、周期准备度；
 * AI 草稿在评审人完成独立判断前隐藏内容（只显示状态）。
 * 主管能识别下一步：每面板给出行动提示。
 * NP-022：隐藏（SUBMITTED）AI 草稿支持内联"记录独立判断并决定"——
 * 提交的独立得分与理由即 ATT-06 判断记录，决定后由服务端揭示内容；
 * 已决定草稿是终态（只读展示）；零分维度（D-03 需 ASSESSED 认定）
 * 仍走考核周期页完整流程。
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

interface RubricView {
  id: string;
  code: string;
  name: string;
  status: string;
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
  const { session } = useAuth();
  const toast = useToast();

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
  // NP-022：内联复核需要评分标准版本；决策入口按身份 fail-closed。
  const rubricsQuery = useApiQuery<RubricView[]>("/api/v1/rubrics", "mc-rubrics");
  const identityQuery = useApiQuery<{ roles: string[] }>(
    "/api/v1/platform/identity",
    "mc-identity",
  );
  const canDecide = (identityQuery.data?.roles ?? []).some(
    (role) => role === "manager" || role === "admin",
  );
  const activeRubrics = (rubricsQuery.data ?? []).filter(
    (rubric) => rubric.status === "ACTIVE",
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

  // NP-022：内联复核状态（一次展开一份草稿）。
  const [reviewDraftId, setReviewDraftId] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [reviewRubric, setReviewRubric] = useState("");
  const [reviewScoresText, setReviewScoresText] = useState("{}");
  const [reviewRationale, setReviewRationale] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  function openReview(draftId: string) {
    setReviewDraftId(draftId);
    setReviewDecision("APPROVE");
    setReviewRubric(activeRubrics[0]?.id ?? "");
    setReviewScoresText("{}");
    setReviewRationale("");
    setReviewError(null);
  }

  async function submitReview(draftId: string) {
    let scores: Record<string, number>;
    try {
      const parsed = JSON.parse(reviewScoresText || "{}") as unknown;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.values(parsed).some(
          (value) => typeof value !== "number" || value < 0 || value > 5,
        )
      ) {
        throw new Error("得分必须是 0–5 的数字对象，例如 {\"QUALITY\":4}");
      }
      scores = parsed as Record<string, number>;
      // D-03：零分必须是有依据的 ASSESSED 认定——完整表单在考核周期页。
      const zero = Object.entries(scores).find(([, value]) => value === 0);
      if (zero) {
        throw new Error(
          `维度 ${zero[0]} 打 0 分需要在考核周期页走 D-03 认定流程（ASSESSED + 理由）`,
        );
      }
    } catch (caught) {
      setReviewError(caught instanceof Error ? caught.message : "得分格式无效。");
      return;
    }
    if (!reviewRubric) {
      setReviewError("必须选择评分标准版本。");
      return;
    }
    if (reviewRationale.trim().length < 3) {
      setReviewError("必须填写至少 3 个字符的复核理由。");
      return;
    }
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      await api(`/api/v1/evaluation-drafts/${draftId}/decision`, {
        method: "POST",
        body: {
          reviewerPersonId: session.personId,
          rubricVersionId: reviewRubric,
          decision: reviewDecision,
          scores,
          rationale: reviewRationale.trim(),
          // ATT-06：复核人先独立判断（得分与理由同时作为独立判断记录）。
          independentScores: scores,
          independentRationale: reviewRationale.trim(),
          evidenceOpened: 0,
        },
      });
      toast.success(
        reviewDecision === "APPROVE" ? "评价已批准" : "草稿已驳回",
        draftId.slice(0, 8),
      );
      setReviewDraftId(null);
      draftsQuery.reload();
      decisionsQuery.reload();
      coverageQuery.reload();
    } catch (caught) {
      setReviewError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "无法记录决策。",
      );
    } finally {
      setReviewSubmitting(false);
    }
  }

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
                      {canDecide ? (
                        <>
                          {" "}
                          <Button
                            variant={reviewDraftId === draft.id ? "secondary" : "primary"}
                            onClick={() =>
                              reviewDraftId === draft.id
                                ? setReviewDraftId(null)
                                : openReview(draft.id)
                            }
                          >
                            {reviewDraftId === draft.id ? "收起复核" : "记录独立判断并决定"}
                          </Button>
                        </>
                      ) : null}
                      {reviewDraftId === draft.id ? (
                        <div className="stack">
                          <InfoNotice>
                            内联复核不会展示草稿内容——先填写独立得分与理由提交决定，
                            决定后内容才由服务端揭示（NP-004 盲审）。
                          </InfoNotice>
                          <FormField
                            label="决策"
                            hint="批准生成正式评价决定；驳回退回重评。两者均记录独立判断。"
                          >
                            <Select
                              value={reviewDecision}
                              onChange={(event) =>
                                setReviewDecision(
                                  event.target.value === "REJECT" ? "REJECT" : "APPROVE",
                                )
                              }
                              aria-label={`决策-${draft.id}`}
                            >
                              <option value="APPROVE">批准评价</option>
                              <option value="REJECT">驳回草稿</option>
                            </Select>
                          </FormField>
                          <FormField label="评分标准版本">
                            {rubricsQuery.loading ? (
                              <div className="muted">评分标准加载中…</div>
                            ) : activeRubrics.length === 0 ? (
                              <div className="muted">无 ACTIVE 评分标准——先在政策中启用。</div>
                            ) : (
                              <Select
                                value={reviewRubric}
                                onChange={(event) => setReviewRubric(event.target.value)}
                                aria-label={`评分标准-${draft.id}`}
                              >
                                <option value="">— 选择评分标准 —</option>
                                {activeRubrics.map((rubric) => (
                                  <option key={rubric.id} value={rubric.id}>
                                    {rubric.code} · {rubric.name}
                                  </option>
                                ))}
                              </Select>
                            )}
                          </FormField>
                          <FormField
                            label="独立得分（JSON）"
                            hint="维度 → 0–5 分，例如 {&quot;QUALITY&quot;:4}；零分请到考核周期页走 D-03 认定流程。"
                          >
                            <Textarea
                              value={reviewScoresText}
                              onChange={(event) => setReviewScoresText(event.target.value)}
                              aria-label={`独立得分-${draft.id}`}
                              rows={2}
                              placeholder='{"QUALITY": 4}'
                            />
                          </FormField>
                          <FormField label="独立判断理由（必填，≥3 字，进入正式记录）">
                            <Textarea
                              value={reviewRationale}
                              onChange={(event) => setReviewRationale(event.target.value)}
                              aria-label={`复核理由-${draft.id}`}
                              rows={2}
                              placeholder="基于证据与制度条款的独立判断依据（未参考 AI 草稿）。"
                            />
                          </FormField>
                          {reviewError ? (
                            <InfoNotice tone="warning">{reviewError}</InfoNotice>
                          ) : null}
                          <div>
                            <Button
                              variant={reviewDecision === "REJECT" ? "danger" : "primary"}
                              onClick={() => submitReview(draft.id)}
                              disabled={reviewSubmitting}
                            >
                              {reviewSubmitting
                                ? "提交中…"
                                : reviewDecision === "REJECT"
                                  ? "驳回草稿"
                                  : "批准评价"}
                            </Button>
                          </div>
                        </div>
                      ) : null}
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
                {/* NP-035：周期漏斗——在职分母 → 有草案 → 已决定 */}
                <BarChart
                  title="周期覆盖漏斗"
                  summary={`本周期覆盖漏斗：在职分母 ${coverage.denominator} 人，其中 ${coverage.withDraft} 人有评价草案、${coverage.decided} 人已完成决定；分母为在职 roster（后端计算）。`}
                  bars={[
                    { label: "在职分母", value: coverage.denominator },
                    { label: "有草案", value: coverage.withDraft },
                    { label: "已决定", value: coverage.decided },
                  ]}
                  unit="人"
                  table={{
                    caption: "周期覆盖漏斗数据表（NP-035）",
                    headers: ["阶段", "人数"],
                    rows: [
                      ["在职分母", coverage.denominator],
                      ["有草案", coverage.withDraft],
                      ["已决定", coverage.decided],
                      ["待处理", coverage.pending],
                    ],
                  }}
                />
                {coverage.excluded.length > 0 ? (
                  <>
                    <InfoNotice>
                      排除项：{coverage.excluded.map((entry) => `${entry.displayName}（${entry.reason}）`).join("、")}
                    </InfoNotice>
                    <BarChart
                      title="排除/缺失分布"
                      summary="离职等排除原因的人数分布；N/A 与缺失语义分离——排除者不计入分母。"
                      bars={Object.entries(
                        coverage.excluded.reduce<Record<string, number>>((groups, entry) => {
                          groups[entry.reason] = (groups[entry.reason] ?? 0) + 1;
                          return groups;
                        }, {}),
                      ).map(([reason, count]) => ({ label: reason, value: count }))}
                      unit="人"
                      table={{
                        caption: "排除原因分布数据表（NP-035）",
                        headers: ["排除原因", "人数"],
                        rows: Object.entries(
                          coverage.excluded.reduce<Record<string, number>>((groups, entry) => {
                            groups[entry.reason] = (groups[entry.reason] ?? 0) + 1;
                            return groups;
                          }, {}),
                        ),
                      }}
                    />
                  </>
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
