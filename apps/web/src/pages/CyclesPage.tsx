import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  Textarea,
  TextInput,
} from "../components/ui.js";
import { PersonSelect, usePeople } from "../components/PersonSelect.js";
import { Icon } from "../components/Icon.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api, downloadJson, qs } from "../lib/api.js";
import { zhStatus } from "../lib/zh.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  displayName,
  formatDate,
  formatDateTime,
  shortId,
  toIsoDate,
  titleCase,
} from "../lib/format.js";
import type {
  CycleReadinessReport,
  EvaluationCycle,
  EvaluationDecision,
  EvaluationDraft,
  PolicyVersionSummary,
  Rubric,
  WorkPackage,
} from "../lib/types.js";
import type { CalculationRunView } from "../lib/ops-types.js";

const CYCLE_TYPES = ["MONTHLY", "QUARTERLY", "ANNUAL", "CUSTOM"];
const TIMEZONES = [
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "UTC",
  "Europe/London",
  "America/New_York",
];

const NEXT_CYCLE_STATUS: Record<string, string | undefined> = {
  DRAFT: "COLLECTING",
  COLLECTING: "AI_PRE_REVIEW",
  AI_PRE_REVIEW: "HUMAN_REVIEW",
  HUMAN_REVIEW: "DECIDED",
  DECIDED: "CALCULATING",
  CALCULATING: "SETTLED",
  SETTLED: undefined,
};

export function CyclesPage() {
  useDocumentTitle("考核周期");
  const { session } = useAuth();
  const toast = useToast();
  const { people } = usePeople();
  const cycles = useApiQuery<EvaluationCycle[]>("/api/v1/evaluation-cycles");
  const drafts = useApiQuery<EvaluationDraft[]>("/api/v1/evaluation-drafts");
  const decisions = useApiQuery<EvaluationDecision[]>(
    "/api/v1/evaluation-decisions",
  );
  const rubrics = useApiQuery<Rubric[]>("/api/v1/rubrics");
  const policies = useApiQuery<PolicyVersionSummary[]>("/api/v1/policy-versions");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [cycleType, setCycleType] = useState("QUARTERLY");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [policyVersionId, setPolicyVersionId] = useState("");
  const [rubricVersionId, setRubricVersionId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [advanceReason, setAdvanceReason] = useState("");
  const [cycleActionError, setCycleActionError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportScopeOpen, setExportScopeOpen] = useState(false);
  const [exportLegalEntity, setExportLegalEntity] = useState("");
  const [exportJurisdiction, setExportJurisdiction] = useState("");
  const [detailDraft, setDetailDraft] = useState<EvaluationDraft | null>(null);
  const [reviewDraft, setReviewDraft] = useState<EvaluationDraft | null>(null);
  const [decision, setDecision] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [reviewer, setReviewer] = useState(session.personId);
  const [reviewRubric, setReviewRubric] = useState("");
  const [scoresText, setScoresText] = useState("{}");
  const [rationale, setRationale] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const runs = useApiQuery<CalculationRunView[]>("/api/v1/calculation-runs");
  const workPackages = useApiQuery<WorkPackage[]>("/api/v1/work-packages");
  const [runOpen, setRunOpen] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runSubmitting, setRunSubmitting] = useState(false);
  const [runMode, setRunMode] = useState<"SHADOW" | "FORMAL">("FORMAL");
  const [runPolicyVersionId, setRunPolicyVersionId] = useState("");
  const [orderId, setOrderId] = useState("order-1");
  const [orderGrossProfit, setOrderGrossProfit] = useState("100000");
  const [orderCurrency, setOrderCurrency] = useState("CNY");
  const [runParticipants, setRunParticipants] = useState<
    Array<{
      personId: string;
      workPackageId: string;
      attributionWeight: string;
      role: string;
    }>
  >([]);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const cycleList = cycles.data ?? [];
  const selected = cycleList.find((cycle) => cycle.id === selectedId);
  const cycleDrafts =
    drafts.data?.filter((draft) => draft.cycleId === selectedId) ?? [];
  const cycleDecisions =
    decisions.data?.filter((item) => item.cycleId === selectedId) ?? [];
  const cycleRuns =
    runs.data?.filter((run) => run.cycleId === selectedId) ?? [];

  function openRunModal() {
    setRunError(null);
    setRunMode("FORMAL");
    setRunPolicyVersionId(
      selected?.policyVersionId ??
        policies.data?.[0]?.policyVersionId ??
        "",
    );
    setOrderId("order-1");
    setOrderGrossProfit("100000");
    setOrderCurrency("CNY");
    const firstPackage = workPackages.data?.[0]?.id ?? "";
    setRunParticipants([
      {
        personId: session.personId,
        workPackageId: firstPackage,
        attributionWeight: "1",
        role: "OWNER",
      },
    ]);
    setRunOpen(true);
  }

  async function submitRun(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    setRunError(null);
    setRunSubmitting(true);
    try {
      const participants = runParticipants.filter(
        (participant) =>
          participant.personId.trim() &&
          participant.workPackageId.trim() &&
          Number(participant.attributionWeight) >= 0,
      );
      await api("/api/v1/calculation-runs", {
        method: "POST",
        body: {
          cycleId: selectedId,
          policyVersionId: runPolicyVersionId,
          mode: runMode,
          order: {
            id: orderId.trim(),
            grossProfit: orderGrossProfit,
            currency: orderCurrency.toUpperCase(),
          },
          participants: participants.map((participant) => ({
            personId: participant.personId.trim(),
            workPackageId: participant.workPackageId.trim(),
            attributionWeight: participant.attributionWeight,
            role: participant.role.trim() || "CONTRIBUTOR",
          })),
        },
      });
      toast.success("计算批次已创建", runMode);
      setRunOpen(false);
      runs.reload();
      readiness.reload();
    } catch (caught) {
      setRunError(
        caught instanceof ApiError ? caught.message : "创建计算失败",
      );
    } finally {
      setRunSubmitting(false);
    }
  }

  async function runCommand(
    runId: string,
    command: "approve" | "lock",
  ) {
    setBusy(`${command}:${runId}`);
    try {
      await api(
        `/api/v1/calculation-runs/${runId}/${command}`,
        {
          method: "POST",
          body:
            command === "lock"
              ? { confirmation: "LOCK_CALCULATION" }
              : {},
        },
      );
      toast.success(
        command === "approve" ? "计算已批准" : "Run locked",
        shortId(runId),
      );
      runs.reload();
      readiness.reload();
    } catch (caught) {
      toast.error(
        command === "approve" ? "审批失败" : "锁定失败",
        caught instanceof ApiError ? caught.message : "请求失败",
      );
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!selectedId && cycleList[0]?.id) setSelectedId(cycleList[0].id);
  }, [cycleList, selectedId]);

  const successMetrics = useApiQuery<{ overall: string; metrics: Array<{ label: string; status: string; actual?: string; target?: string }> }>(
    selectedId
      ? "/api/v1/reports/success-metrics"
      : null,
    selectedId,
  );
  const readiness = useApiQuery<CycleReadinessReport>(
    selectedId
      ? `/api/v1/reports/cycle-readiness?cycleId=${encodeURIComponent(selectedId)}`
      : null,
    selectedId,
  );

  const pendingDrafts =
    drafts.data?.filter((draft) => draft.status === "SUBMITTED") ?? [];
  const approvedDecisions =
    decisions.data?.filter((item) => item.status === "APPROVED") ?? [];

  function openCreate() {
    setName("");
    setCycleType("QUARTERLY");
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 3, 0);
    setStartsAt(start.toISOString().slice(0, 10));
    setEndsAt(end.toISOString().slice(0, 10));
    setTimezone("Asia/Shanghai");
    setPolicyVersionId(policies.data?.[0]?.policyVersionId ?? "");
    setRubricVersionId(rubrics.data?.[0]?.id ?? "");
    setFormError(null);
    setCreateOpen(true);
  }

  async function createCycle(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const created = await api<EvaluationCycle>("/api/v1/evaluation-cycles", {
        method: "POST",
        body: {
          name: name.trim(),
          cycleType,
          startsAt: toIsoDate(startsAt),
          endsAt: toIsoDate(endsAt),
          timezone,
          policyVersionId: policyVersionId || undefined,
          rubricVersionId: rubricVersionId || undefined,
        },
      });
      toast.success("周期已创建", name);
      setCreateOpen(false);
      setSelectedId(created.id);
      cycles.reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "创建周期失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function exportEvidencePackage() {
    if (!selectedId) return;
    setExporting(true);
    try {
      const evidencePackage = await api<Record<string, unknown>>(
        `/api/v1/evidence-packages/${selectedId}${qs({
          legalEntity: exportLegalEntity.trim(),
          jurisdiction: exportJurisdiction.trim(),
        })}`,
      );
      downloadJson(
        evidencePackage,
        `evidence-package-${selectedId}.json`,
      );
      toast.success(
        "证据包已下载",
        "包含法律门禁、决策、结算、账本与审计事件。",
      );
    } catch (caught) {
      toast.error(
        "证据包构建失败",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setExporting(false);
    }
  }

  async function runPreReview() {
    if (!selectedId) return;
    setCycleActionError(null);
    setAdvancing(true);
    try {
      const result = await api<{
        created: unknown[];
        skipped: unknown[];
        note?: string;
      }>(`/api/v1/evaluation-cycles/${selectedId}/pre-review`, {
        method: "POST",
        body: {},
      });
      toast.success(
        "AI 预审已执行",
        `生成 ${result.created?.length ?? 0} 份草稿${
          result.skipped?.length ? `，跳过 ${result.skipped.length} 项` : ""
        }${result.note ? `。${result.note}` : ""}`,
      );
      drafts.reload();
      cycles.reload();
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "预审失败";
      setCycleActionError(message);
    } finally {
      setAdvancing(false);
    }
  }

  async function advanceCycle(target: string) {
    if (!selectedId) return;
    setCycleActionError(null);
    setAdvancing(true);
    try {
      await api(`/api/v1/evaluation-cycles/${selectedId}/advance`, {
        method: "POST",
        body: {
          status: target,
          reason: advanceReason.trim() || "控制台推进",
        },
      });
      toast.success("周期已推进", titleCase(target));
      setAdvanceReason("");
      cycles.reload();
      readiness.reload();
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "推进失败";
      setCycleActionError(message);
    } finally {
      setAdvancing(false);
    }
  }

  function openCycleReport() {
    if (!selectedId) return;
    window.open(`/api/v1/reports/cycles/${selectedId}/report`, "_blank");
  }

  async function submitDraft(draft: EvaluationDraft) {
    setBusy(draft.id);
    try {
      await api(`/api/v1/evaluation-drafts/${draft.id}/submit`, {
        method: "POST",
      });
      toast.success("草稿已提交复核", shortId(draft.id));
      drafts.reload();
      setDetailDraft(null);
    } catch (caught) {
      toast.error(
        "提交草稿失败",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setBusy(null);
    }
  }

  function openReview(draft: EvaluationDraft) {
    setReviewDraft(draft);
    setDecision("APPROVE");
    setReviewer(session.personId);
    setReviewRubric(
      selected?.rubricVersionId ?? rubrics.data?.[0]?.id ?? "",
    );
    setScoresText("{}");
    setRationale("");
    setReviewError(null);
  }

  async function submitDecision() {
    if (!reviewDraft) return;
    let scores: Record<string, number>;
    try {
      const parsed = JSON.parse(scoresText || "{}") as unknown;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.values(parsed).some(
          (value) => typeof value !== "number" || value < 0 || value > 5,
        )
      ) {
        throw new Error("得分必须是 0–5 的数字对象");
      }
      scores = parsed as Record<string, number>;
    } catch (caught) {
      setReviewError(
        caught instanceof Error ? caught.message : "Scores must be valid JSON.",
      );
      return;
    }
    if (!reviewRubric) {
      setReviewError("必须选择评分标准版本。");
      return;
    }
    if (rationale.trim().length < 3) {
      setReviewError("必须填写至少 3 个字符的理由。");
      return;
    }
    setSubmitting(true);
    setReviewError(null);
    try {
      await api(`/api/v1/evaluation-drafts/${reviewDraft.id}/decision`, {
        method: "POST",
        body: {
          reviewerPersonId: reviewer,
          rubricVersionId: reviewRubric,
          decision,
          scores,
          rationale: rationale.trim(),
          // ATT-06: the reviewer's independent judgement is recorded before
          // comparing with the AI draft.
          independentScores: scores,
          independentRationale: rationale.trim(),
          evidenceOpened: 0,
        },
      });
      toast.success(
        decision === "APPROVE" ? "评价已批准" : "草稿已驳回",
        shortId(reviewDraft.id),
      );
      setReviewDraft(null);
      drafts.reload();
      decisions.reload();
      readiness.reload();
    } catch (caught) {
      setReviewError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "无法记录决策。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const activeRubrics = useMemo(
    () => rubrics.data?.filter((rubric) => rubric.status === "ACTIVE") ?? [],
    [rubrics.data],
  );

  return (
    <>
      <PageHeader
        eyebrow="评价操作"
        title="考核周期"
        description="运行考核周期、复核证据 bound 草稿并作出人工决策；没有复核人，草稿不会成为正式决策。"
        actions={
          <>
            <Button
              variant="secondary"
              icon="refresh"
              onClick={() => {
                cycles.reload();
                drafts.reload();
                decisions.reload();
                readiness.reload();
              }}
              loading={cycles.loading}
            >
              刷新
            </Button>
            <Button
              variant="secondary"
              icon="download"
              onClick={() => setExportScopeOpen(true)}
              loading={exporting}
              disabled={!selectedId}
            >
              证据包
            </Button>
            <Button
              variant="secondary"
              icon="download"
              onClick={openCycleReport}
              disabled={!selectedId}
            >
              周期报告
            </Button>
            <Button variant="primary" icon="plus" onClick={openCreate}>
              新建周期
            </Button>
          </>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">考核周期</span>
          </div>
          <div className="stat-tile__value">{cycleList.length}</div>
          <div className="stat-tile__detail">
            {cycleList.filter((cycle) => !["CLOSED", "ARCHIVED"].includes(cycle.status))
              .length}{" "}
            未关闭
          </div>
        </div>
        <div className="stat-tile stat-tile--warning">
          <div className="stat-tile__top">
            <span className="stat-tile__label">复核中草稿</span>
          </div>
          <div className="stat-tile__value">{pendingDrafts.length}</div>
          <div className="stat-tile__detail">已提交，等待决策</div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">已批决策</span>
          </div>
          <div className="stat-tile__value">{approvedDecisions.length}</div>
          <div className="stat-tile__detail">版本化并归属复核人</div>
        </div>
      </div>

      {cycles.error ? (
        <ErrorNotice error={cycles.error} onRetry={cycles.reload} />
      ) : cycles.loading ? (
        <Panel title="考核周期">
          <LoadingRows rows={4} />
        </Panel>
      ) : cycleList.length === 0 ? (
        <Panel>
          <EmptyState
            icon="layers"
            title="暂无考核周期"
            description="创建周期以绑定评价草稿、政策版本与结算。"
            action={
              <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                新建周期
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="split-grid">
            <Panel title="考核周期" subtitle="选择周期查看其证据" flush>
              <div className="table-wrap">
                <table className="data-table table-clickable">
                  <thead>
                    <tr>
                      <th>周期</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycleList.map((cycle) => (
                      <tr
                        key={cycle.id}
                        className={cycle.id === selectedId ? "is-selected" : ""}
                        onClick={() => setSelectedId(cycle.id)}
                      >
                        <td>
                          <span className="cell-primary">{cycle.name}</span>
                          <span className="cell-sub nowrap">
                            {formatDate(cycle.startsAt)} –{" "}
                            {formatDate(cycle.endsAt)} ·{" "}
                            {titleCase(cycle.cycleType)}
                          </span>
                          <span className="cell-sub mono nowrap">
                            {shortId(cycle.id, 8)} · v{cycle.version}
                          </span>
                        </td>
                        <td>
                          <Badge status={cycle.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel
              title={selected ? `${selected.name} 就绪度` : "周期就绪度"}
              subtitle={
                selected
                  ? `${selected.timezone} · updated ${formatDateTime(selected.updatedAt)}`
                  : undefined
              }
              action={
                readiness.data ? (
                  <Badge
                    tone={readiness.data.readyForSettlement ? "success" : "danger"}
                  >
                    {readiness.data.readyForSettlement
                      ? "结算就绪"
                      : "未就绪"}
                  </Badge>
                ) : null
              }
            >
              {readiness.error ? (
                <ErrorNotice error={readiness.error} onRetry={readiness.reload} />
              ) : readiness.loading || !readiness.data ? (
                <LoadingRows rows={4} />
              ) : (
                <>
                  <div className="coverage-grid">
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">计算</div>
                      <div className="coverage-cell__value">
                        {readiness.data.calculations.total}
                      </div>
                      <div className="coverage-cell__sub">
                        {readiness.data.calculations.formalLocked} 正式已锁定
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">法律门禁</div>
                      <div className="coverage-cell__value">
                        {
                          readiness.data.legalGates.filter((gate) => gate.recorded)
                            .length
                        }
                        /{readiness.data.legalGates.length}
                      </div>
                      <div className="coverage-cell__sub">已记录</div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">结算</div>
                      <div className="coverage-cell__value">
                        {readiness.data.settlement.total}
                      </div>
                      <div className="coverage-cell__sub">
                        {readiness.data.settlement.acknowledged} 已确认
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">预算</div>
                      <div className="coverage-cell__value">
                        {readiness.data.budgets.approved}/
                        {readiness.data.budgets.pools}
                      </div>
                      <div className="coverage-cell__sub">已批准资金池</div>
                    </div>
                  </div>
                  {readiness.data.blockers.length > 0 ? (
                    <div className="notice notice--danger section-gap">
                      <Icon name="alert-circle" size={18} />
                      <div>
                        <strong>{readiness.data.blockers.length} blocker(s)</strong>
                        <div className="chip-row" style={{ marginTop: 6 }}>
                          {readiness.data.blockers.map((blocker) => (
                            <span className="chip" key={blocker}>
                              {blocker}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : readiness.data.readyForSettlement ? (
                    <div className="notice notice--success section-gap">
                      <Icon name="check-circle" size={18} />
                      <div>
                        <strong>结算就绪</strong>
                        <p>
                          正式计算已锁定，且已满足全部就绪检查。
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="notice notice--warning section-gap">
                      <Icon name="alert-circle" size={18} />
                      <div>
                        <strong>未就绪</strong>
                        <p>
                          未记录明确阻断项，但周期仍需完成正式计算锁定及其后续检查。
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </Panel>

            <Panel
              title="周期流程"
              subtitle="数据采集 → AI 预审 → 人工复核 → 决策 → 计算 → 结算"
              action={
                selected ? <Badge status={selected.status} /> : undefined
              }
            >
              {!selected ? (
                <EmptyState
                  icon="clock"
                  title="请选择周期"
                  description="在左侧选择一个考核周期后推进流程。"
                />
              ) : (
                <div className="stack">
                  {cycleActionError ? (
                    <InfoNotice tone="warning">{cycleActionError}</InfoNotice>
                  ) : null}
                  <div className="muted">
                    当前状态：<strong>{titleCase(selected.status)}</strong>
                    {NEXT_CYCLE_STATUS[selected.status]
                      ? `；下一步：${titleCase(NEXT_CYCLE_STATUS[selected.status]!)}`
                      : "；已到终态"}
                  </div>
                  <div className="form-grid">
                    <FormField label="推进说明" hint="会写入周期审计事件">
                      <TextInput
                        value={advanceReason}
                        onChange={(event) => setAdvanceReason(event.target.value)}
                        placeholder="例如：收集期结束，进入 AI 预审"
                      />
                    </FormField>
                  </div>
                  <div className="form-actions">
                    <Button
                      variant="secondary"
                      onClick={runPreReview}
                      loading={advancing}
                      disabled={!["COLLECTING", "AI_PRE_REVIEW"].includes(selected.status)}
                    >
                      运行 AI 预审
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => advanceCycle(NEXT_CYCLE_STATUS[selected.status]!)}
                      loading={advancing}
                      disabled={!NEXT_CYCLE_STATUS[selected.status]}
                    >
                      推进到 {NEXT_CYCLE_STATUS[selected.status] ? zhStatus(NEXT_CYCLE_STATUS[selected.status]!) : "终态"}
                    </Button>
                  </div>
                  <InfoNotice tone="info">
                    HUMAN_REVIEW 前必须有 AGENT 预审草稿；DECIDED 前所有草稿必须已决策。门禁不满足时后端会返回 409，不会跳过。
                  </InfoNotice>
                </div>
              )}
            </Panel>

            <Panel
              title="PRD 成功指标"
              subtitle="证据覆盖 / 复核耗时 / 争议率 / 对账差异 / 门禁通过率"
            >
              {successMetrics.error ? (
                <ErrorNotice
                  error={successMetrics.error}
                  onRetry={successMetrics.reload}
                />
              ) : successMetrics.loading || !successMetrics.data ? (
                <LoadingRows rows={3} />
              ) : (
                <>
                  <div
                    className="notice notice--success"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    <strong>
                      整体状态：
                      {successMetrics.data.overall === "PASS"
                        ? "达标"
                        : successMetrics.data.overall === "FAIL"
                          ? "未达标"
                          : successMetrics.data.overall}
                    </strong>
                  </div>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>指标</th>
                        <th>实际</th>
                        <th>目标</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {successMetrics.data.metrics.map((metric) => (
                        <tr key={metric.label}>
                          <td>{metric.label}</td>
                          <td className="mono">{metric.actual ?? "—"}</td>
                          <td className="mono">{metric.target ?? "—"}</td>
                          <td>
                            <Badge status={metric.status === "PASS" ? "APPROVED" : metric.status === "FAIL" ? "REJECTED" : "DRAFT"} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </Panel>
          </div>

          <div className="split-grid section-gap">
            <Panel
              title="评价草稿"
              subtitle={selected ? `For ${selected.name}` : undefined}
              flush
            >
              {drafts.error ? (
                <div style={{ padding: 16 }}>
                  <ErrorNotice error={drafts.error} onRetry={drafts.reload} />
                </div>
              ) : drafts.loading ? (
                <div style={{ padding: 16 }}>
                  <LoadingRows rows={3} />
                </div>
              ) : cycleDrafts.length === 0 ? (
                <EmptyState
                  icon="policy"
                  title="该周期暂无草稿"
                  description="草稿由人工或 Agent 生成，必须引用证据快照。"
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>人员</th>
                        <th>来源</th>
                        <th>状态</th>
                        <th>更新时间</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {cycleDrafts.map((draft) => (
                        <tr key={draft.id}>
                          <td>
                            <span className="cell-primary">
                              {displayName(draft.personId, people)}
                            </span>
                            <span className="cell-sub mono">
                              {shortId(draft.id, 10)} · v{draft.version}
                            </span>
                          </td>
                          <td>
                            {draft.generatedByType}
                            {draft.modelName ? (
                              <span className="cell-sub">
                                {draft.modelProvider} · {draft.modelName}
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <Badge status={draft.status} />
                          </td>
                          <td className="nowrap">
                            {formatDateTime(draft.updatedAt)}
                          </td>
                          <td className="cell-actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDetailDraft(draft)}
                            >
                              待处理
                            </Button>
                            {draft.status === "SUBMITTED" ? (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => openReview(draft)}
                              >
                                复核
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="已批决策" subtitle="仅人工决策" flush>
              {decisions.error ? (
                <div style={{ padding: 16 }}>
                  <ErrorNotice error={decisions.error} onRetry={decisions.reload} />
                </div>
              ) : decisions.loading ? (
                <div style={{ padding: 16 }}>
                  <LoadingRows rows={3} />
                </div>
              ) : cycleDecisions.length === 0 ? (
                <EmptyState
                  icon="approvals"
                  title="该周期暂无决策"
                  description="批准已提交草稿会生成归属复核人的版本化决策。"
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>人员</th>
                        <th>版本</th>
                        <th>状态</th>
                        <th>已批准</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cycleDecisions.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <span className="cell-primary">
                              {displayName(item.personId, people)}
                            </span>
                            <span className="cell-sub">
                              Reviewer {displayName(item.reviewerPersonId, people)}
                            </span>
                          </td>
                          <td>v{item.decisionVersion}</td>
                          <td>
                            <Badge status={item.status} />
                          </td>
                          <td className="nowrap">
                            {item.approvedAt
                              ? formatDateTime(item.approvedAt)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <Panel
            title="计算批次"
            subtitle={selected ? `${selected.name} 的正式/影子计算批次` : undefined}
            flush
            action={
              <Button size="sm" variant="primary" icon="plus" onClick={openRunModal}>
                新建计算
              </Button>
            }
          >
            {runs.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={runs.error} onRetry={runs.reload} />
              </div>
            ) : runs.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={3} />
              </div>
            ) : cycleRuns.length === 0 ? (
              <EmptyState
                icon="clock"
                title="该周期暂无计算批次"
                description="申报完成认定并记录法律门禁后，即可发起影子或正式计算。"
                action={
                  <Button size="sm" variant="primary" icon="plus" onClick={openRunModal}>
                    新建计算
                  </Button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>运行</th>
                      <th>模式</th>
                      <th>状态</th>
                      <th>明细行</th>
                      <th>阻断项</th>
                      <th>创建时间</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {cycleRuns.map((run) => (
                      <>
                        <tr key={run.id}>
                          <td>
                            <span className="cell-primary mono">
                              {shortId(run.id, 10)}
                            </span>
                            <span className="cell-sub">
                              engine {run.engineVersion}
                            </span>
                          </td>
                          <td>{titleCase(run.mode)}</td>
                          <td>
                            <Badge status={run.status} />
                          </td>
                          <td>{run.lines.length}</td>
                          <td>
                            {run.blockers.length > 0 ? (
                              <Badge tone="danger">{run.blockers.length}</Badge>
                            ) : (
                              <span className="muted">0</span>
                            )}
                          </td>
                          <td className="nowrap">{formatDateTime(run.createdAt)}</td>
                          <td className="cell-actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setExpandedRunId(
                                  expandedRunId === run.id ? null : run.id,
                                )
                              }
                            >
                              {expandedRunId === run.id ? "隐藏" : "详情"}
                            </Button>
                            {run.status === "CALCULATED" ? (
                              <Button
                                size="sm"
                                variant="primary"
                                loading={busy === `approve:${run.id}`}
                                onClick={() => runCommand(run.id, "approve")}
                              >
                                批准
                              </Button>
                            ) : null}
                            {run.status === "APPROVED" ? (
                              <Button
                                size="sm"
                                variant="primary"
                                loading={busy === `lock:${run.id}`}
                                onClick={() => runCommand(run.id, "lock")}
                              >
                                锁定
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                        {expandedRunId === run.id ? (
                          <tr key={`${run.id}-detail`}>
                            <td colSpan={7}>
                              <div className="detail-section" style={{ margin: 0 }}>
                                <DefinitionList
                                  items={[
                                    {
                                      label: "结果哈希",
                                      value: run.resultHash ?? "—",
                                    },
                                    {
                                      label: "Calculated",
                                      value: run.calculatedAt
                                        ? formatDateTime(run.calculatedAt)
                                        : "—",
                                    },
                                    {
                                      label: "Locked",
                                      value: run.lockedAt
                                        ? formatDateTime(run.lockedAt)
                                        : "—",
                                    },
                                    {
                                      label: "Warnings",
                                      value:
                                        run.warnings.length > 0
                                          ? run.warnings.join(", ")
                                          : "—",
                                    },
                                  ]}
                                />
                                {run.blockers.length > 0 ? (
                                  <div className="chip-row section-gap">
                                    {run.blockers.map((blocker) => (
                                      <span className="chip" key={blocker}>
                                        {blocker}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                                {run.lines.length > 0 ? (
                                  <div className="table-wrap section-gap">
                                    <table className="data-table">
                                      <thead>
                                        <tr>
                                          <th>人员</th>
                                          <th>行</th>
                                          <th>原始</th>
                                          <th>舍入后</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {run.lines.map((line) => (
                                          <tr key={line.lineKey}>
                                            <td>
                                              {displayName(line.personId, people)}
                                            </td>
                                            <td className="mono">
                                              {line.lineKey}
                                            </td>
                                            <td>
                                              {line.rawAmount} {line.currency}
                                            </td>
                                            <td>
                                              {line.roundedAmount} {line.currency}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      <Modal
        open={createOpen}
        title="新建考核周期"
        description="周期绑定政策版本、评分标准、评价草稿与结算区间。"
        onClose={() => setCreateOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-cycle-form"
              loading={submitting}
            >
              创建
            </Button>
          </>
        }
      >
        <form id="create-cycle-form" onSubmit={createCycle} className="form-grid">
          {formError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{formError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="周期名称" htmlFor="cycle-name" className="field--full">
            <TextInput
              id="cycle-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="FY27 Q1 激励周期"
              required
            />
          </FormField>
          <FormField label="周期类型" htmlFor="cycle-type">
            <Select
              id="cycle-type"
              value={cycleType}
              onChange={(event) => setCycleType(event.target.value)}
            >
              {CYCLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {
                    {
                      MONTHLY: "月度",
                      QUARTERLY: "季度",
                      ANNUAL: "年度",
                      CUSTOM: "自定义",
                    }[type] ?? type
                  }
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="时区" htmlFor="cycle-timezone">
            <Select
              id="cycle-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="开始日期" htmlFor="cycle-start">
            <TextInput
              id="cycle-start"
              type="date"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              required
            />
          </FormField>
          <FormField label="结束日期" htmlFor="cycle-end">
            <TextInput
              id="cycle-end"
              type="date"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
              required
            />
          </FormField>
          <FormField label="政策版本" htmlFor="cycle-policy">
            <Select
              id="cycle-policy"
              value={policyVersionId}
              onChange={(event) => setPolicyVersionId(event.target.value)}
            >
              <option value="">尚未绑定</option>
              {(policies.data ?? []).map((policy) => (
                <option key={policy.policyVersionId} value={policy.policyVersionId}>
                  {policy.code} v{policy.version} · {policy.status}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="评分标准版本" htmlFor="cycle-rubric">
            <Select
              id="cycle-rubric"
              value={rubricVersionId}
              onChange={(event) => setRubricVersionId(event.target.value)}
            >
              <option value="">尚未绑定</option>
              {(rubrics.data ?? []).map((rubric) => (
                <option key={rubric.id} value={rubric.id}>
                  {rubric.code} v{rubric.version} · {rubric.name}
                </option>
              ))}
            </Select>
          </FormField>
        </form>
      </Modal>

      <Modal
        open={exportScopeOpen}
        title="证据包范围"
        description="可将工作包限定到法人实体与法域；留空表示整个周期。"
        onClose={() => setExportScopeOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExportScopeOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              icon="download"
              loading={exporting}
              onClick={async () => {
                await exportEvidencePackage();
                setExportScopeOpen(false);
              }}
            >
              下载
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <FormField label="法人实体（可选）" htmlFor="export-entity">
            <TextInput
              id="export-entity"
              value={exportLegalEntity}
              onChange={(event) => setExportLegalEntity(event.target.value)}
            />
          </FormField>
          <FormField
            label="法域（可选）"
            htmlFor="export-jurisdiction"
          >
            <TextInput
              id="export-jurisdiction"
              value={exportJurisdiction}
              onChange={(event) => setExportJurisdiction(event.target.value)}
              placeholder="CN"
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={runOpen}
        title="新建计算批次"
        description="正式计算前必须记录法律门禁；参与人的申报须已完成认定。"
        onClose={() => setRunOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setRunOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-run-form"
              loading={runSubmitting}
            >
              新建计算
            </Button>
          </>
        }
      >
        <form id="create-run-form" onSubmit={submitRun} className="form-grid">
          {runError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{runError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="模式" htmlFor="run-mode">
            <Select
              id="run-mode"
              value={runMode}
              onChange={(event) =>
                setRunMode(event.target.value as "SHADOW" | "FORMAL")
              }
            >
              <option value="FORMAL">正式</option>
              <option value="SHADOW">影子</option>
            </Select>
          </FormField>
          <FormField label="政策版本" htmlFor="run-policy">
            <Select
              id="run-policy"
              value={runPolicyVersionId}
              onChange={(event) => setRunPolicyVersionId(event.target.value)}
              required
            >
              <option value="">选择政策版本…</option>
              {(policies.data ?? []).map((policy) => (
                <option key={policy.policyVersionId} value={policy.policyVersionId}>
                  {policy.code} v{policy.version}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="订单 ID" htmlFor="run-order-id">
            <TextInput
              id="run-order-id"
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              required
            />
          </FormField>
          <FormField label="订单毛利" htmlFor="run-order-profit">
            <TextInput
              id="run-order-profit"
              value={orderGrossProfit}
              onChange={(event) => setOrderGrossProfit(event.target.value)}
              required
            />
          </FormField>
          <FormField label="币种" htmlFor="run-order-currency">
            <TextInput
              id="run-order-currency"
              value={orderCurrency}
              maxLength={3}
              onChange={(event) =>
                setOrderCurrency(event.target.value.toUpperCase())
              }
              required
            />
          </FormField>
          <div className="field--full">
            <div className="inline" style={{ justifyContent: "space-between" }}>
              <strong>参与人</strong>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                icon="plus"
                onClick={() =>
                  setRunParticipants((current) => [
                    ...current,
                    {
                      personId: "",
                      workPackageId: workPackages.data?.[0]?.id ?? "",
                      attributionWeight: "0",
                      role: "CONTRIBUTOR",
                    },
                  ])
                }
              >
                添加参与人
              </Button>
            </div>
          </div>
          {runParticipants.map((participant, index) => (
            <div className="field--full" key={index}>
              <div className="form-grid">
                <FormField label={`Person ${index + 1}`}>
                  <PersonSelect
                    value={participant.personId}
                    onChange={(value) =>
                      setRunParticipants((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, personId: value }
                            : item,
                        ),
                      )
                    }
                  />
                </FormField>
                <FormField label="工作包">
                  <Select
                    value={participant.workPackageId}
                    onChange={(event) =>
                      setRunParticipants((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, workPackageId: event.target.value }
                            : item,
                        ),
                      )
                    }
                    required
                  >
                    <option value="">选择工作包…</option>
                    {(workPackages.data ?? []).map((workPackage) => (
                      <option key={workPackage.id} value={workPackage.id}>
                        {workPackage.title}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="权重">
                  <TextInput
                    value={participant.attributionWeight}
                    onChange={(event) =>
                      setRunParticipants((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                attributionWeight: event.target.value,
                              }
                            : item,
                        ),
                      )
                    }
                    required
                  />
                </FormField>
                <FormField label="角色">
                  <TextInput
                    value={participant.role}
                    onChange={(event) =>
                      setRunParticipants((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, role: event.target.value }
                            : item,
                        ),
                      )
                    }
                    required
                  />
                </FormField>
                <div className="inline" style={{ alignItems: "end" }}>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={runParticipants.length === 1}
                    onClick={() =>
                      setRunParticipants((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    移除
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </form>
      </Modal>

      <Modal
        open={Boolean(detailDraft)}
        title="评价草稿"
        description={
          detailDraft
            ? `${displayName(detailDraft.personId, people)} · ${titleCase(detailDraft.status)}`
            : undefined
        }
        onClose={() => setDetailDraft(null)}
        wide
        footer={
          detailDraft ? (
            <>
              <Button variant="ghost" onClick={() => setDetailDraft(null)}>
                关闭
              </Button>
              {detailDraft.status === "DRAFT" ? (
                <Button
                  variant="primary"
                  onClick={() => submitDraft(detailDraft)}
                  loading={busy === detailDraft.id}
                >
                  提交复核
                </Button>
              ) : detailDraft.status === "SUBMITTED" ? (
                <Button variant="primary" onClick={() => openReview(detailDraft)}>
                  复核草稿
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {detailDraft ? (
          <div className="stack">
            <DefinitionList
              items={[
                {
                  label: "来源",
                  value: `${detailDraft.generatedByType}${
                    detailDraft.modelName
                      ? ` · ${detailDraft.modelProvider} ${detailDraft.modelName}`
                      : ""
                  }`,
                },
                {
                  label: "证据快照",
                  value: (
                    <span className="mono">
                      {shortId(detailDraft.evidenceSnapshotHash, 20)}
                    </span>
                  ),
                },
                { label: "状态", value: <Badge status={detailDraft.status} /> },
                {
                  label: "更新时间",
                  value: formatDateTime(detailDraft.updatedAt),
                },
              ]}
            />
            {detailDraft.strengths.length > 0 ? (
              <div className="detail-section">
                <div className="detail-section__title">优势</div>
                <ul className="stack" style={{ gap: 4 }}>
                  {detailDraft.strengths.map((item) => (
                    <li key={item} className="muted">
                      • {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {detailDraft.counterEvidence.length > 0 ? (
              <div className="detail-section">
                <div className="detail-section__title">反证</div>
                <ul className="stack" style={{ gap: 4 }}>
                  {detailDraft.counterEvidence.map((item) => (
                    <li key={item} className="muted">
                      • {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {detailDraft.missingInformation.length > 0 ? (
              <div className="detail-section">
                <div className="detail-section__title">缺失信息</div>
                <div className="chip-row">
                  {detailDraft.missingInformation.map((item) => (
                    <span className="chip" key={item}>
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="detail-section">
              <div className="detail-section__title">草稿内容</div>
              <pre className="code-block">
                {JSON.stringify(detailDraft.draftPayload, null, 2)}
              </pre>
            </div>
            <div className="detail-section">
              <div className="detail-section__title">不确定性</div>
              <pre className="code-block">
                {JSON.stringify(detailDraft.uncertainty ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(reviewDraft)}
        title="复核评价草稿"
        description="批准会写入版本化决策；复核人不得是草稿对象本人。"
        onClose={() => setReviewDraft(null)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewDraft(null)}>
              取消
            </Button>
            <Button
              variant={decision === "REJECT" ? "danger" : "primary"}
              onClick={submitDecision}
              loading={submitting}
            >
              {decision === "REJECT" ? "驳回草稿" : "批准评价"}
            </Button>
          </>
        }
      >
        {reviewDraft ? (
          <div className="stack">
            {reviewError ? (
              <InfoNotice tone="warning">{reviewError}</InfoNotice>
            ) : null}
            <DefinitionList
              items={[
                {
                  label: "人员",
                  value: displayName(reviewDraft.personId, people),
                },
                {
                  label: "证据",
                  value: (
                    <span className="mono">
                      {shortId(reviewDraft.evidenceSnapshotHash, 20)}
                    </span>
                  ),
                },
                {
                  label: "草稿版本",
                  value: `v${reviewDraft.version}`,
                },
              ]}
            />
            <div className="form-grid">
              <FormField label="决策" htmlFor="draft-decision">
                <Select
                  id="draft-decision"
                  value={decision}
                  onChange={(event) =>
                    setDecision(event.target.value as "APPROVE" | "REJECT")
                  }
                >
                  <option value="APPROVE">批准</option>
                  <option value="REJECT">驳回</option>
                </Select>
              </FormField>
              <FormField label="复核人" htmlFor="draft-reviewer">
                <PersonSelect
                  id="draft-reviewer"
                  value={reviewer}
                  onChange={setReviewer}
                />
              </FormField>
              <FormField
                label="评分标准版本"
                htmlFor="draft-rubric"
                className="field--full"
                hint="决策会记录所用的评分标准版本。"
              >
                {activeRubrics.length > 0 ? (
                  <Select
                    id="draft-rubric"
                    value={reviewRubric}
                    onChange={(event) => setReviewRubric(event.target.value)}
                    required
                  >
                    <option value="">Select a rubric…</option>
                    {activeRubrics.map((rubric) => (
                      <option key={rubric.id} value={rubric.id}>
                        {rubric.code} v{rubric.version} · {rubric.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <TextInput
                    id="draft-rubric"
                    value={reviewRubric}
                    onChange={(event) => setReviewRubric(event.target.value)}
                    placeholder="评分标准版本 UUID"
                    required
                  />
                )}
              </FormField>
              <FormField
                label="得分（JSON）"
                htmlFor="draft-scores"
                className="field--full"
                hint='Optional dimension scores, e.g. {"execution":4.2,"ownership":3.8}. Values 0–5.'
              >
                <Textarea
                  id="draft-scores"
                  value={scoresText}
                  onChange={(event) => setScoresText(event.target.value)}
                  className="input mono"
                  spellCheck={false}
                />
              </FormField>
              <FormField
                label="理由"
                htmlFor="draft-rationale"
                className="field--full"
                hint="至少 3 个字符；随决策一并留存。"
              >
                <Textarea
                  id="draft-rationale"
                  value={rationale}
                  onChange={(event) => setRationale(event.target.value)}
                  required
                />
              </FormField>
            </div>
            {reviewDraft.generatedByType === "AGENT" ? (
              <InfoNotice>
                This draft was generated by an agent. The model output is
                advisory; your decision is the formal record.
              </InfoNotice>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
