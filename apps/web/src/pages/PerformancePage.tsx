import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
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
import { useToast } from "../contexts/ToastContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { api, ApiError } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { formatDateTime } from "../lib/format.js";
import { zhStatus } from "../lib/zh.js";

interface EvaluationCycleView {
  id: string;
  name?: string;
  cycleType?: string;
  status: string;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
}

interface EvaluationDraftView {
  id: string;
  cycleId: string;
  personId: string;
  status: string;
  draftType?: string;
  generatedByType?: string;
  strengths?: string[];
  createdAt: string;
}

interface EvaluationDecisionView {
  id: string;
  personId?: string;
  decision?: string;
  reviewerPersonId?: string;
  rationale?: string;
  createdAt: string;
}

interface RubricView {
  id: string;
  code: string;
  name: string;
  dimensions: string[];
  effectiveFrom: string;
}

interface PolicyRecordView<T> {
  id: string;
  recordType: string;
  status?: string;
  personId?: string;
  period?: string;
  payload: T;
  createdAt: string;
}

interface GoalCardPayload {
  id: string;
  personId: string;
  period: string;
  roleCode: string;
  status: string;
  metrics: Array<Record<string, unknown>>;
  lockedAt?: string;
}

interface MetricTemplate {
  metricId: string;
  name: string;
  period: string;
  weight: string;
  metricType: string;
  target?: string;
  dataSource: string;
  [key: string]: unknown;
}

/** 绩效管理：考核周期 → 评分标准 → 评价草稿（AI 可起草）→ 人工决策。 */
export function PerformancePage() {
  useDocumentTitle("绩效管理");
  const toast = useToast();
  const { session } = useAuth();
  const { people } = usePeople();
  const cycles = useApiQuery<EvaluationCycleView[]>("/api/v1/evaluation-cycles");
  const drafts = useApiQuery<EvaluationDraftView[]>("/api/v1/evaluation-drafts");
  const decisions = useApiQuery<EvaluationDecisionView[]>(
    "/api/v1/evaluation-decisions",
  );
  const rubrics = useApiQuery<RubricView[]>("/api/v1/rubrics");
  const goalCards = useApiQuery<PolicyRecordView<GoalCardPayload>[]>(
    "/api/v1/policy/performance/goal-cards",
  );
  const scoreRecords = useApiQuery<
    PolicyRecordView<{ result?: { finalScore?: string; kp?: string } }>[]
  >("/api/v1/policy/performance/scores");
  const [tab, setTab] = useState("cycles");

  // 目标卡
  const [goalPerson, setGoalPerson] = useState(session.personId);
  const [goalPeriod, setGoalPeriod] = useState("QUARTERLY");
  const [goalRole, setGoalRole] = useState("SALES");
  const [goalMetricsText, setGoalMetricsText] = useState("[]");
  const [goalError, setGoalError] = useState<string | null>(null);
  const [goalSaving, setGoalSaving] = useState(false);

  // 正式评分
  const [scoreCardId, setScoreCardId] = useState("");
  const [measurementsText, setMeasurementsText] = useState(
    '[{"metricId":"Q-S-001","rawValue":"120","applicable":true}]',
  );
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [scoreSaving, setScoreSaving] = useState(false);

  // 新建周期
  const [cycleOpen, setCycleOpen] = useState(false);
  const [cycleName, setCycleName] = useState("");
  const [cycleType, setCycleType] = useState("MONTHLY");
  const [cycleStart, setCycleStart] = useState("");
  const [cycleEnd, setCycleEnd] = useState("");
  const [cycleError, setCycleError] = useState<string | null>(null);
  const [savingCycle, setSavingCycle] = useState(false);

  // 新建评分标准
  const [rubricOpen, setRubricOpen] = useState(false);
  const [rubricCode, setRubricCode] = useState("");
  const [rubricName, setRubricName] = useState("");
  const [rubricDims, setRubricDims] = useState("QUALITY, TIMELINESS, IMPACT");
  const [rubricError, setRubricError] = useState<string | null>(null);

  // 新建评价草稿
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftCycle, setDraftCycle] = useState("");
  const [draftPerson, setDraftPerson] = useState(session.personId);
  const [draftSource, setDraftSource] = useState<"USER" | "AGENT">("USER");
  const [draftSummary, setDraftSummary] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  // 决策
  const [decideTarget, setDecideTarget] = useState<EvaluationDraftView | null>(
    null,
  );
  const [decision, setDecision] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [decideRubric, setDecideRubric] = useState("");
  const [decideScores, setDecideScores] = useState('{"QUALITY": 4}');
  const [decideRationale, setDecideRationale] = useState("");
  const [decideError, setDecideError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);

  const cycleList = cycles.data ?? [];
  const draftList = drafts.data ?? [];
  const decisionList = decisions.data ?? [];
  const rubricList = rubrics.data ?? [];

  async function loadGoalTemplate() {
    setGoalError(null);
    try {
      const query =
        goalPeriod === "QUARTERLY"
          ? `?period=QUARTERLY&role=${encodeURIComponent(goalRole)}`
          : `?period=${goalPeriod}`;
      const template = await api<MetricTemplate[]>(
        `/api/v1/policy/performance/templates${query}`,
      );
      setGoalMetricsText(
        JSON.stringify(
          template.map((metric) => ({
            ...metric,
            target: metric.target ?? "100",
          })),
          null,
          2,
        ),
      );
    } catch (caught) {
      setGoalError(
        caught instanceof ApiError ? caught.message : "载入指标模板失败",
      );
    }
  }

  async function createGoalCard(event: FormEvent) {
    event.preventDefault();
    setGoalError(null);
    setGoalSaving(true);
    try {
      const metrics = JSON.parse(goalMetricsText) as unknown;
      if (!Array.isArray(metrics) || metrics.length === 0) {
        throw new Error("指标 JSON 必须是非空数组");
      }
      await api("/api/v1/policy/performance/goal-cards", {
        method: "POST",
        body: {
          personId: goalPerson,
          period: goalPeriod,
          roleCode: goalRole,
          metrics,
        },
      });
      toast.success("目标卡已创建", "请确认目标后锁定");
      goalCards.reload();
    } catch (caught) {
      setGoalError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "创建目标卡失败",
      );
    } finally {
      setGoalSaving(false);
    }
  }

  async function lockGoalCard(record: PolicyRecordView<GoalCardPayload>) {
    try {
      await api(
        `/api/v1/policy/performance/goal-cards/${record.id}/lock`,
        { method: "POST", body: {} },
      );
      toast.success("目标卡已锁定", "锁定后不得静默覆盖");
      goalCards.reload();
    } catch (caught) {
      toast.error(
        "锁定失败",
        caught instanceof ApiError ? caught.message : undefined,
      );
    }
  }

  async function runOfficialScore(event: FormEvent) {
    event.preventDefault();
    setScoreError(null);
    setScoreSaving(true);
    try {
      const card = goalCards.data?.find(
        (record) => record.id === scoreCardId,
      );
      if (!card) throw new Error("请选择已锁定的目标卡");
      const measurements = JSON.parse(measurementsText) as unknown;
      if (!Array.isArray(measurements)) {
        throw new Error("测量值 JSON 必须是数组");
      }
      const result = await api<{
        finalScore: string;
        kp: string;
        complete: boolean;
      }>("/api/v1/policy/performance/score", {
        method: "POST",
        body: {
          personId: card.payload.personId,
          period: card.payload.period,
          metrics: card.payload.metrics,
          measurements,
        },
      });
      toast.success(
        "正式评分已生成",
        `S=${result.finalScore} · Kp=${result.kp}`,
      );
      scoreRecords.reload();
    } catch (caught) {
      setScoreError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "评分失败",
      );
    } finally {
      setScoreSaving(false);
    }
  }

  function toIso(value: string): string {
    return value ? new Date(`${value}T00:00:00Z`).toISOString() : "";
  }

  async function createCycle(event: FormEvent) {
    event.preventDefault();
    setCycleError(null);
    setSavingCycle(true);
    try {
      await api("/api/v1/evaluation-cycles", {
        method: "POST",
        body: {
          name: cycleName.trim(),
          cycleType,
          startsAt: toIso(cycleStart),
          endsAt: toIso(cycleEnd),
          timezone: "Asia/Shanghai",
        },
      });
      toast.success("考核周期已创建", cycleName);
      setCycleOpen(false);
      cycles.reload();
    } catch (caught) {
      setCycleError(caught instanceof ApiError ? caught.message : "创建失败");
    } finally {
      setSavingCycle(false);
    }
  }

  async function createRubric(event: FormEvent) {
    event.preventDefault();
    setRubricError(null);
    try {
      await api("/api/v1/rubrics", {
        method: "POST",
        body: {
          code: rubricCode.trim(),
          name: rubricName.trim(),
          dimensions: rubricDims
            .split(",")
            .map((dimension) => dimension.trim())
            .filter(Boolean),
          scoringAnchors: {},
          effectiveFrom: new Date().toISOString().slice(0, 10),
        },
      });
      toast.success("评分标准已创建", rubricCode);
      setRubricOpen(false);
      rubrics.reload();
    } catch (caught) {
      setRubricError(caught instanceof ApiError ? caught.message : "创建失败");
    }
  }

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    setDraftError(null);
    setSavingDraft(true);
    try {
      await api("/api/v1/evaluation-drafts", {
        method: "POST",
        body: {
          cycleId: draftCycle,
          personId: draftPerson,
          generatedByType: draftSource,
          evidenceSnapshotHash: `evidence-${draftPerson}-${Date.now()}`,
          draftPayload: { summary: draftSummary.trim() || "周期评价草稿" },
        },
      });
      toast.success("评价草稿已创建", `对象：${draftPerson.slice(0, 8)}`);
      setDraftOpen(false);
      drafts.reload();
    } catch (caught) {
      setDraftError(caught instanceof ApiError ? caught.message : "创建失败");
    } finally {
      setSavingDraft(false);
    }
  }

  async function submitDraft(draft: EvaluationDraftView) {
    try {
      await api(`/api/v1/evaluation-drafts/${draft.id}/submit`, {
        method: "POST",
      });
      toast.success("草稿已提交待复核");
      drafts.reload();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "提交失败");
    }
  }

  async function decideDraft(event: FormEvent) {
    event.preventDefault();
    if (!decideTarget) return;
    setDecideError(null);
    setDeciding(true);
    try {
      let scores: Record<string, number> = {};
      if (decision === "APPROVE") {
        scores = JSON.parse(decideScores) as Record<string, number>;
      }
      await api(`/api/v1/evaluation-drafts/${decideTarget.id}/decision`, {
        method: "POST",
        body: {
          reviewerPersonId: session.personId,
          rubricVersionId: decideRubric,
          decision,
          scores,
          rationale: decideRationale.trim(),
        },
      });
      toast.success("决策已记录", decision === "APPROVE" ? "已批准" : "已驳回");
      setDecideTarget(null);
      drafts.reload();
      decisions.reload();
    } catch (caught) {
      setDecideError(caught instanceof ApiError ? caught.message : "决策失败");
    } finally {
      setDeciding(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="核心业务"
        title="绩效管理"
        description="考核周期驱动证据 bound 评价草稿（可由 AI 起草），人工复核后形成版本化决策；AI 仅辅助，人工拍板。"
        actions={
          <Button variant="secondary" onClick={() => cycles.reload()}>
            刷新
          </Button>
        }
      />
      <Tabs
        items={[
          { id: "cycles", label: "考核周期", count: cycleList.length },
          { id: "drafts", label: "评价草稿", count: draftList.length },
          { id: "decisions", label: "已批决策", count: decisionList.length },
          { id: "rubrics", label: "评分标准", count: rubricList.length },
          {
            id: "scoring",
            label: "目标卡与评分",
            count: goalCards.data?.length ?? 0,
          },
        ]}
        active={tab}
        onChange={setTab}
        label="绩效管理视图"
      />

      <div className="tab-panel">
        {tab === "cycles" ? (
          <Panel
            title="考核周期"
            action={
              <Button onClick={() => setCycleOpen(true)}>新建考核周期</Button>
            }
            flush
          >
            {cycles.loading && cycles.data === undefined ? (
              <LoadingRows rows={4} />
            ) : cycleList.length === 0 ? (
              <EmptyState
                icon="clock"
                title="还没有考核周期"
                description="创建周期后，可关联政策版本、评分标准与评价草稿。"
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>周期</th>
                    <th>类型</th>
                    <th>起止</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {cycleList.map((cycle) => (
                    <tr key={cycle.id}>
                      <td>
                        <strong>{cycle.name ?? cycle.id.slice(0, 8)}</strong>
                      </td>
                      <td>
                        {{
                          MONTHLY: "月度",
                          QUARTERLY: "季度",
                          ANNUAL: "年度",
                          CUSTOM: "自定义",
                        }[cycle.cycleType ?? ""] ?? cycle.cycleType ?? "—"}
                      </td>
                      <td className="mono">
                        {(cycle.startsAt ?? "").slice(0, 10)} →{" "}
                        {(cycle.endsAt ?? "").slice(0, 10)}
                      </td>
                      <td>
                        <Badge status={cycle.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        ) : null}

        {tab === "drafts" ? (
          <Panel
            title="评价草稿"
            subtitle="AI 或经理可依据证据起草；草稿不含分数，仅优势、反证与不确定性"
            action={<Button onClick={() => setDraftOpen(true)}>新建草稿</Button>}
            flush
          >
            {drafts.loading && drafts.data === undefined ? (
              <LoadingRows rows={4} />
            ) : draftList.length === 0 ? (
              <EmptyState
                icon="ai"
                title="暂无评价草稿"
                description="选择考核周期与对象创建草稿，提交后由复核人决策。"
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>对象</th>
                    <th>来源</th>
                    <th>状态</th>
                    <th>优势要点</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {draftList.map((draft) => (
                    <tr key={draft.id}>
                      <td>
                        <code>{draft.personId.slice(0, 8)}</code>
                      </td>
                      <td>{draft.generatedByType === "AGENT" ? "AI 起草" : draft.generatedByType ?? draft.draftType ?? "—"}</td>
                      <td>
                        <Badge status={draft.status} />
                      </td>
                      <td>{draft.strengths?.slice(0, 2).join("、") || "—"}</td>
                      <td className="cell-actions">
                        <div className="row-actions">
                          {draft.status === "DRAFT" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void submitDraft(draft)}
                            >
                              提交
                            </Button>
                          ) : null}
                          {draft.status === "SUBMITTED" ? (
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={rubricList.length === 0}
                              onClick={() => {
                                setDecideTarget(draft);
                                setDecision("APPROVE");
                                setDecideRubric(rubricList[0]?.id ?? "");
                                setDecideScores('{"QUALITY": 4}');
                                setDecideRationale("");
                                setDecideError(null);
                              }}
                            >
                              决策
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {rubricList.length === 0 ? (
              <div style={{ padding: 16 }}>
                <InfoNotice>
                  决策前需要先创建评分标准（「评分标准」页签）。
                </InfoNotice>
              </div>
            ) : null}
          </Panel>
        ) : null}

        {tab === "decisions" ? (
          <Panel title="已批决策" flush>
            {decisionList.length === 0 ? (
              <EmptyState
                icon="approvals"
                title="暂无已批决策"
                description="人工复核提交草稿后生成版本化决策，可追溯复核人。"
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>对象</th>
                    <th>结论</th>
                    <th>复核人</th>
                    <th>理由</th>
                  </tr>
                </thead>
                <tbody>
                  {decisionList.map((decision) => (
                    <tr key={decision.id}>
                      <td>
                        <code>{(decision.personId ?? "").slice(0, 8)}</code>
                      </td>
                      <td>
                        <Badge status={decision.decision ?? "APPROVED"} />
                      </td>
                      <td>
                        <code>{(decision.reviewerPersonId ?? "").slice(0, 8)}</code>
                      </td>
                      <td>{decision.rationale ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        ) : null}

        {tab === "rubrics" ? (
          <Panel
            title="评分标准"
            action={
              <Button onClick={() => setRubricOpen(true)}>新建评分标准</Button>
            }
            flush
          >
            {rubricList.length === 0 ? (
              <EmptyState
                icon="layers"
                title="暂无评分标准"
                description="评分标准定义评价维度；决策时需引用一个版本。"
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>编码</th>
                    <th>名称</th>
                    <th>维度</th>
                    <th>生效日</th>
                  </tr>
                </thead>
                <tbody>
                  {rubricList.map((rubric) => (
                    <tr key={rubric.id}>
                      <td>
                        <code>{rubric.code}</code>
                      </td>
                      <td>{rubric.name}</td>
                      <td>{rubric.dimensions.join("、")}</td>
                      <td>{rubric.effectiveFrom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        ) : null}

        {tab === "scoring" ? (
          <div className="stack">
            <Panel
              title="季度目标卡"
              subtitle="指标权重合计必须 100%；目标、锚点、数据源事前锁定，锁定后不得静默覆盖"
            >
              <form onSubmit={createGoalCard}>
                <div className="form-grid">
                  <FormField label="员工">
                    <PersonSelect value={goalPerson} onChange={setGoalPerson} />
                  </FormField>
                  <FormField label="周期">
                    <Select
                      value={goalPeriod}
                      onChange={(event) => setGoalPeriod(event.target.value)}
                    >
                      <option value="MONTHLY">月度</option>
                      <option value="QUARTERLY">季度</option>
                      <option value="ANNUAL">年度</option>
                    </Select>
                  </FormField>
                  <FormField label="岗位代码" hint="销售 SALES / 执行总监 EXECUTIVE_DIRECTOR / 产品 PRODUCT_MANAGER / 客服 CUSTOMER_SERVICE / 供应链 SUPPLY_CHAIN / 财务 FINANCE">
                    <TextInput
                      value={goalRole}
                      onChange={(event) => setGoalRole(event.target.value)}
                    />
                  </FormField>
                </div>
                <div className="form-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={loadGoalTemplate}
                  >
                    载入岗位指标模板
                  </Button>
                </div>
                <FormField
                  label="指标 JSON"
                  hint="模板载入后逐项填写 target 或 scoringAnchors；提交时后端校验权重合计 100%"
                >
                  <Textarea
                    rows={12}
                    value={goalMetricsText}
                    onChange={(event) => setGoalMetricsText(event.target.value)}
                  />
                </FormField>
                {goalError ? <InfoNotice tone="warning">{goalError}</InfoNotice> : null}
                <div className="form-actions">
                  <Button type="submit" loading={goalSaving}>
                    创建目标卡
                  </Button>
                </div>
              </form>
            </Panel>

            <Panel title="目标卡台账" flush>
              {goalCards.loading ? (
                <div style={{ padding: 16 }}><LoadingRows /></div>
              ) : (goalCards.data ?? []).length === 0 ? (
                <EmptyState
                  icon="policy"
                  title="暂无目标卡"
                  description="季度开始前为每位员工锁定指标、权重、目标与评分函数。"
                />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>员工</th>
                      <th>周期 / 岗位</th>
                      <th>指标数</th>
                      <th>状态</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(goalCards.data ?? []).map((record) => (
                      <tr key={record.id}>
                        <td className="mono">{record.payload.personId.slice(0, 8)}</td>
                        <td>
                          {record.payload.period} · {record.payload.roleCode}
                        </td>
                        <td>{record.payload.metrics.length}</td>
                        <td><Badge status={record.payload.status} /></td>
                        <td className="cell-actions">
                          {record.payload.status !== "LOCKED" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => lockGoalCard(record)}
                            >
                              锁定
                            </Button>
                          ) : (
                            <span className="muted">已锁定</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel
              title="正式评分"
              subtitle="选择已锁定目标卡，录入测量值；确定性引擎输出 S、Kp 与 N/A 归一化结果"
            >
              <form onSubmit={runOfficialScore}>
                <div className="form-grid">
                  <FormField label="目标卡">
                    <Select
                      value={scoreCardId}
                      onChange={(event) => setScoreCardId(event.target.value)}
                      required
                    >
                      <option value="">请选择</option>
                      {(goalCards.data ?? [])
                        .filter((record) => record.payload.status === "LOCKED")
                        .map((record) => (
                          <option key={record.id} value={record.id}>
                            {record.payload.personId.slice(0, 8)} · {record.payload.period} · {record.payload.roleCode}
                          </option>
                        ))}
                    </Select>
                  </FormField>
                </div>
                <FormField
                  label="测量值 JSON"
                  hint='例如 [{"metricId":"Q-S-001","rawValue":"120","applicable":true}]；不适用项传 applicable:false'
                >
                  <Textarea
                    rows={6}
                    value={measurementsText}
                    onChange={(event) => setMeasurementsText(event.target.value)}
                  />
                </FormField>
                {scoreError ? <InfoNotice tone="warning">{scoreError}</InfoNotice> : null}
                <div className="form-actions">
                  <Button type="submit" loading={scoreSaving}>
                    生成正式评分
                  </Button>
                </div>
              </form>
            </Panel>

            <Panel title="评分记录" flush>
              {scoreRecords.loading ? (
                <div style={{ padding: 16 }}><LoadingRows /></div>
              ) : (scoreRecords.data ?? []).length === 0 ? (
                <EmptyState
                  icon="policy"
                  title="暂无评分记录"
                  description="正式评分会写入制度计算留痕，可按人员与周期查询。"
                />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>人员</th>
                      <th>周期</th>
                      <th>综合得分</th>
                      <th>Kp</th>
                      <th>状态</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(scoreRecords.data ?? []).map((record) => (
                      <tr key={record.id}>
                        <td className="mono">{record.personId?.slice(0, 8)}</td>
                        <td>{record.period ?? "—"}</td>
                        <td className="mono">{record.payload.result?.finalScore ?? "—"}</td>
                        <td className="mono">{record.payload.result?.kp ?? "—"}</td>
                        <td><Badge status={record.status} /></td>
                        <td className="nowrap">{formatDateTime(record.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        ) : null}
      </div>

      {/* 新建周期 */}
      <Modal
        open={cycleOpen}
        title="新建考核周期"
        onClose={() => setCycleOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCycleOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="cycle-form"
              loading={savingCycle}
            >
              创建
            </Button>
          </>
        }
      >
        <form id="cycle-form" onSubmit={createCycle} className="form-grid">
          {cycleError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{cycleError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="周期名称" htmlFor="cycle-name">
            <TextInput
              id="cycle-name"
              value={cycleName}
              onChange={(event) => setCycleName(event.target.value)}
              placeholder="2026 年 11 月绩效周期"
              required
            />
          </FormField>
          <FormField label="周期类型" htmlFor="cycle-type">
            <Select
              id="cycle-type"
              value={cycleType}
              onChange={(event) => setCycleType(event.target.value)}
            >
              <option value="MONTHLY">月度</option>
              <option value="QUARTERLY">季度</option>
              <option value="ANNUAL">年度</option>
            </Select>
          </FormField>
          <FormField label="开始日期" htmlFor="cycle-start">
            <TextInput
              id="cycle-start"
              type="date"
              value={cycleStart}
              onChange={(event) => setCycleStart(event.target.value)}
              required
            />
          </FormField>
          <FormField label="结束日期" htmlFor="cycle-end">
            <TextInput
              id="cycle-end"
              type="date"
              value={cycleEnd}
              onChange={(event) => setCycleEnd(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      {/* 新建评分标准 */}
      <Modal
        open={rubricOpen}
        title="新建评分标准"
        onClose={() => setRubricOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRubricOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="rubric-form">
              创建
            </Button>
          </>
        }
      >
        <form id="rubric-form" onSubmit={createRubric} className="form-grid">
          {rubricError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{rubricError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="编码" htmlFor="rubric-code">
            <TextInput
              id="rubric-code"
              value={rubricCode}
              onChange={(event) => setRubricCode(event.target.value)}
              placeholder="PERF-2026"
              required
            />
          </FormField>
          <FormField label="名称" htmlFor="rubric-name">
            <TextInput
              id="rubric-name"
              value={rubricName}
              onChange={(event) => setRubricName(event.target.value)}
              placeholder="2026 绩效评分标准"
              required
            />
          </FormField>
          <FormField
            label="维度（逗号分隔）"
            htmlFor="rubric-dims"
            hint="决策时按维度打分（0–5）。"
          >
            <TextInput
              id="rubric-dims"
              value={rubricDims}
              onChange={(event) => setRubricDims(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      {/* 新建草稿 */}
      <Modal
        open={draftOpen}
        title="新建评价草稿"
        onClose={() => setDraftOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraftOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="draft-form" loading={savingDraft}>
              创建草稿
            </Button>
          </>
        }
      >
        <form id="draft-form" onSubmit={createDraft} className="form-grid">
          {draftError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{draftError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="考核周期" htmlFor="draft-cycle">
            <Select
              id="draft-cycle"
              value={draftCycle}
              onChange={(event) => setDraftCycle(event.target.value)}
              required
            >
              <option value="">选择周期…</option>
              {cycleList.map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.name ?? cycle.id.slice(0, 8)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="评价对象" htmlFor="draft-person">
            <PersonSelect
              id="draft-person"
              value={draftPerson}
              onChange={setDraftPerson}
            />
          </FormField>
          <FormField label="起草来源" htmlFor="draft-source">
            <Select
              id="draft-source"
              value={draftSource}
              onChange={(event) =>
                setDraftSource(event.target.value as "USER" | "AGENT")
              }
            >
              <option value="USER">人工起草</option>
              <option value="AGENT">AI 起草（建议，需人工决策）</option>
            </Select>
          </FormField>
          <FormField label="要点摘要" htmlFor="draft-summary">
            <Textarea
              id="draft-summary"
              rows={3}
              value={draftSummary}
              onChange={(event) => setDraftSummary(event.target.value)}
              placeholder="本周期主要贡献与证据要点"
            />
          </FormField>
        </form>
      </Modal>

      {/* 决策 */}
      <Modal
        open={Boolean(decideTarget)}
        title="评价决策"
        onClose={() => setDecideTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecideTarget(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="decide-form"
              loading={deciding}
            >
              记录决策
            </Button>
          </>
        }
      >
        <form id="decide-form" onSubmit={decideDraft} className="form-grid">
          {decideError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{decideError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="决策结论" htmlFor="decide-decision">
            <Select
              id="decide-decision"
              value={decision}
              onChange={(event) =>
                setDecision(event.target.value as "APPROVE" | "REJECT")
              }
            >
              <option value="APPROVE">批准</option>
              <option value="REJECT">驳回</option>
            </Select>
          </FormField>
          <FormField label="评分标准" htmlFor="decide-rubric">
            <Select
              id="decide-rubric"
              value={decideRubric}
              onChange={(event) => setDecideRubric(event.target.value)}
              required
            >
              <option value="">选择标准…</option>
              {rubricList.map((rubric) => (
                <option key={rubric.id} value={rubric.id}>
                  {rubric.name}
                </option>
              ))}
            </Select>
          </FormField>
          {decision === "APPROVE" ? (
            <FormField
              label="维度得分（JSON）"
              htmlFor="decide-scores"
              hint='例如 {"QUALITY": 4, "TIMELINESS": 5}'
            >
              <TextInput
                id="decide-scores"
                value={decideScores}
                onChange={(event) => setDecideScores(event.target.value)}
              />
            </FormField>
          ) : null}
          <FormField label="决策理由" htmlFor="decide-rationale">
            <Textarea
              id="decide-rationale"
              rows={3}
              value={decideRationale}
              onChange={(event) => setDecideRationale(event.target.value)}
              placeholder="依据证据说明结论"
              required
            />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
