import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  PageHeader,
  Panel,
  Select,
  Tabs,
  TextInput,
  DefinitionList,
} from "../components/ui.js";
import { PersonSelect } from "../components/PersonSelect.js";
import { useToast } from "../contexts/ToastContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { api, ApiError } from "../lib/api.js";
import { zhStatus } from "../lib/zh.js";
import { useApiQuery, useDocumentTitle, useTenantModules } from "../lib/hooks.js";

interface EquityGrantView {
  id: string;
  personId: string;
  grantCode: string;
  grantType: string;
  totalUnits: string;
  strikePrice: string;
  currency: string;
  cliffMonths: number;
  vestingMonths: number;
  status: string;
  createdAt?: string;
}

interface VestingView {
  vestedUnits: string;
  unvestedUnits: string;
  exercisedUnits: string;
  availableUnits: string;
  nextVestAt?: string;
  fullyVested: boolean;
}

interface ExerciseView {
  id: string;
  grantId: string;
  personId: string;
  units: string;
  status: string;
  createdAt: string;
}

interface PolicyRecordView<T> {
  id: string;
  status?: string;
  payload: T;
  createdAt: string;
}

interface GrantCasePayload {
  id: string;
  personId: string;
  instrument: string;
  status: string;
  positionLevel: string;
  financingStage: string;
  performanceGrade: string;
  tenureStage: string;
  grantPercent: string;
  totalUnits: string;
  strikePrice: string;
  married: boolean;
  spouseConfirmationSigned: boolean;
  agreementSigned: boolean;
  riskAcknowledged: boolean;
  shareholderResolutionRef?: string;
  taxFilingRef?: string;
  capTableUpdated: boolean;
}

/** 期权股权：授予 → 悬崖归属 → 行权申请 → 审批 → 交割。 */
export function EquityPage() {
  useDocumentTitle("期权股权");
  // AUD-017：股权为扩展域——capability 在 hooks 全部执行后判定。
  const { modules: enabledModules } = useTenantModules();
  const toast = useToast();
  const { session } = useAuth();
  const identity = useApiQuery<{ roles: string[] }>("/api/v1/platform/identity");
  const roles = identity.data?.roles ?? [];
  const privileged = roles.some((role) =>
    ["admin", "manager", "finance"].includes(role),
  );
  const isAdmin = roles.includes("admin");
  const canSettle = isAdmin || roles.includes("finance");
  const [adjustTarget, setAdjustTarget] = useState<EquityGrantView | null>(
    null,
  );
  const [adjustUnits, setAdjustUnits] = useState("");
  const [adjustStrike, setAdjustStrike] = useState("");
  const [adjustVestingStart, setAdjustVestingStart] = useState("");
  const [adjustCliff, setAdjustCliff] = useState("");
  const [adjustVesting, setAdjustVesting] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  async function submitAdjust(event: FormEvent) {
    event.preventDefault();
    if (!adjustTarget) return;
    setAdjustError(null);
    setAdjusting(true);
    try {
      await api(`/api/v1/equity-grants/${adjustTarget.id}/adjust`, {
        method: "POST",
        body: {
          totalUnits: adjustUnits.trim() || undefined,
          strikePrice: adjustStrike.trim() || undefined,
          vestingStart: adjustVestingStart.trim() || undefined,
          cliffMonths: adjustCliff.trim()
            ? Number(adjustCliff)
            : undefined,
          vestingMonths: adjustVesting.trim()
            ? Number(adjustVesting)
            : undefined,
          reason: adjustReason.trim(),
        },
      });
      toast.success("授予已人工修正", adjustTarget.grantCode);
      setAdjustTarget(null);
      grants.reload();
    } catch (caught) {
      setAdjustError(
        caught instanceof ApiError ? caught.message : "修正失败",
      );
    } finally {
      setAdjusting(false);
    }
  }
  const grants = useApiQuery<EquityGrantView[]>("/api/v1/equity-grants");
  const exercises = useApiQuery<ExerciseView[]>("/api/v1/equity-exercises");
  const grantCases = useApiQuery<PolicyRecordView<GrantCasePayload>[]>(
    "/api/v1/policy/equity/grant-cases",
  );
  const [tab, setTab] = useState("grants");

  // 授予决策流程
  const [casePerson, setCasePerson] = useState(session.personId);
  const [caseInstrument, setCaseInstrument] = useState("OPTION");
  const [caseLevel, setCaseLevel] = useState("L1");
  const [caseStage, setCaseStage] = useState("A");
  const [caseGrade, setCaseGrade] = useState("B");
  const [caseTenure, setCaseTenure] = useState("A");
  const [casePercent, setCasePercent] = useState("2.5");
  const [caseUnits, setCaseUnits] = useState("25000");
  const [caseStrike, setCaseStrike] = useState("27.5");
  const [caseMarried, setCaseMarried] = useState(false);
  const [caseRisk, setCaseRisk] = useState(false);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [caseSaving, setCaseSaving] = useState(false);
  const [advanceCase, setAdvanceCase] =
    useState<PolicyRecordView<GrantCasePayload> | null>(null);
  const [advanceResolution, setAdvanceResolution] = useState("");
  const [advanceAgreement, setAdvanceAgreement] = useState(false);
  const [advanceSpouse, setAdvanceSpouse] = useState(false);
  const [advanceTaxRef, setAdvanceTaxRef] = useState("");
  const [advanceCapTable, setAdvanceCapTable] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const GRANT_STEPS = [
    "QUALIFICATION",
    "CALCULATION",
    "PLAN",
    "SHAREHOLDER_APPROVAL",
    "AGREEMENT",
    "REGISTRATION",
    "TAX_FILING",
    "LEDGERED",
  ];

  const [grantOpen, setGrantOpen] = useState(false);
  const [grantPerson, setGrantPerson] = useState(session.personId);
  const [grantCode, setGrantCode] = useState("");
  const [grantType, setGrantType] = useState<"OPTION" | "RSU" | "SAR">("RSU");
  const [grantUnits, setGrantUnits] = useState("");
  const [grantStrike, setGrantStrike] = useState("0");
  const [grantCurrency, setGrantCurrency] = useState("CNY");
  const [grantDate, setGrantDate] = useState(new Date().toISOString().slice(0, 10));
  const [vestingStart, setVestingStart] = useState(new Date().toISOString().slice(0, 10));
  const [cliffMonths, setCliffMonths] = useState("12");
  const [vestingMonths, setVestingMonths] = useState("48");
  const [grantError, setGrantError] = useState<string | null>(null);
  const [savingGrant, setSavingGrant] = useState(false);

  const [vestingTarget, setVestingTarget] = useState<EquityGrantView | null>(null);
  const [vesting, setVesting] = useState<VestingView | null>(null);
  const [vestingError, setVestingError] = useState<string | null>(null);

  const [exerciseTarget, setExerciseTarget] = useState<EquityGrantView | null>(null);
  const [exerciseUnits, setExerciseUnits] = useState("");
  const [exerciseError, setExerciseError] = useState<string | null>(null);

  const grantList = grants.data ?? [];
  const exerciseList = exercises.data ?? [];

  function toIso(value: string): string {
    return new Date(`${value}T00:00:00Z`).toISOString();
  }

  async function createGrant(event: FormEvent) {
    event.preventDefault();
    setGrantError(null);
    setSavingGrant(true);
    try {
      await api("/api/v1/equity-grants", {
        method: "POST",
        body: {
          personId: grantPerson,
          grantCode: grantCode.trim(),
          grantType,
          totalUnits: grantUnits,
          strikePrice: grantStrike,
          currency: grantCurrency.toUpperCase(),
          grantDate: toIso(grantDate),
          vestingStart: toIso(vestingStart),
          cliffMonths: Number.parseInt(cliffMonths, 10) || 0,
          vestingMonths: Number.parseInt(vestingMonths, 10) || 1,
        },
      });
      toast.success("授予已创建", grantCode);
      setGrantOpen(false);
      grants.reload();
    } catch (caught) {
      setGrantError(caught instanceof ApiError ? caught.message : "创建失败");
    } finally {
      setSavingGrant(false);
    }
  }

  async function openVesting(grant: EquityGrantView) {
    setVestingTarget(grant);
    setVesting(null);
    setVestingError(null);
    try {
      const result = await api<VestingView>(
        `/api/v1/equity-grants/${grant.id}/vesting`,
      );
      setVesting(result);
    } catch (caught) {
      setVestingError(caught instanceof ApiError ? caught.message : "查询失败");
    }
  }

  async function requestExercise(event: FormEvent) {
    event.preventDefault();
    if (!exerciseTarget) return;
    setExerciseError(null);
    try {
      await api(`/api/v1/equity-grants/${exerciseTarget.id}/exercises`, {
        method: "POST",
        body: { units: exerciseUnits, requestedBy: session.personId },
      });
      toast.success("行权申请已提交", "等待审批");
      setExerciseTarget(null);
      exercises.reload();
    } catch (caught) {
      setExerciseError(caught instanceof ApiError ? caught.message : "提交失败");
    }
  }

  async function advanceExercise(exercise: ExerciseView, action: "approve" | "settle") {
    try {
      await api(`/api/v1/equity-exercises/${exercise.id}/${action}`, {
        method: "POST",
        body: { approvedBy: session.personId },
      });
      toast.success(action === "approve" ? "行权已批准" : "行权已交割");
      exercises.reload();
      grants.reload();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "操作失败");
    }
  }

  async function createGrantCase(event: FormEvent) {
    event.preventDefault();
    setCaseError(null);
    setCaseSaving(true);
    try {
      await api("/api/v1/policy/equity/grant-cases", {
        method: "POST",
        body: {
          personId: casePerson,
          instrument: caseInstrument,
          positionLevel: caseLevel,
          financingStage: caseStage,
          performanceGrade: caseGrade,
          tenureStage: caseTenure,
          grantPercent: casePercent,
          totalUnits: caseUnits,
          strikePrice: caseStrike,
          married: caseMarried,
          riskAcknowledged: caseRisk,
        },
      });
      toast.success("授予流程已发起", "从资格审核开始，按八步推进");
      grantCases.reload();
    } catch (caught) {
      setCaseError(caught instanceof ApiError ? caught.message : "发起失败");
    } finally {
      setCaseSaving(false);
    }
  }

  function openAdvance(record: PolicyRecordView<GrantCasePayload>) {
    setAdvanceCase(record);
    setAdvanceResolution(record.payload.shareholderResolutionRef ?? "");
    setAdvanceAgreement(record.payload.agreementSigned);
    setAdvanceSpouse(record.payload.spouseConfirmationSigned);
    setAdvanceTaxRef(record.payload.taxFilingRef ?? "");
    setAdvanceCapTable(record.payload.capTableUpdated);
    setAdvanceError(null);
  }

  async function submitAdvance(event: FormEvent) {
    event.preventDefault();
    if (!advanceCase) return;
    const index = GRANT_STEPS.indexOf(advanceCase.payload.status);
    const next = GRANT_STEPS[index + 1];
    if (!next) return;
    setAdvanceError(null);
    try {
      await api(
        `/api/v1/policy/equity/grant-cases/${advanceCase.id}/advance`,
        {
          method: "POST",
          body: {
            status: next,
            shareholderResolutionRef: advanceResolution.trim() || undefined,
            agreementSigned: advanceAgreement,
            spouseConfirmationSigned: advanceSpouse,
            riskAcknowledged: advanceCase.payload.riskAcknowledged,
            taxFilingRef: advanceTaxRef.trim() || undefined,
            capTableUpdated: advanceCapTable,
          },
        },
      );
      toast.success("授予流程已推进", next);
      setAdvanceCase(null);
      grantCases.reload();
    } catch (caught) {
      setAdvanceError(caught instanceof ApiError ? caught.message : "推进失败");
    }
  }

  if (!enabledModules.has("EQUITY")) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="激励"
          title="期权股权"
          description="本租户未启用股权模块（D-04：P0 默认不含扩展域）。"
        />
        <InfoNotice tone="warning">
          功能未启用（FEATURE_DISABLED）：请联系平台管理员开启 EQUITY 模块；
          接口层同步返回 403 FEATURE_DISABLED。
        </InfoNotice>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="核心业务"
        title="期权股权"
        description="OPTION / RSU / SAR 授予，悬崖 + 按月归属；行权需审批人≠申请人，归属与可用额度实时可查。"
        actions={
          <Button variant="secondary" onClick={() => grants.reload()}>
            刷新
          </Button>
        }
      />
      <Tabs
        items={[
          { id: "grants", label: "授予台账", count: grantList.length },
          { id: "exercises", label: "行权记录", count: exerciseList.length },
          {
            id: "workflow",
            label: "授予决策流程",
            count: grantCases.data?.length ?? 0,
          },
        ]}
        active={tab}
        onChange={setTab}
        label="期权股权视图"
      />

      <div className="tab-panel">
        {tab === "grants" ? (
          <Panel
            title="授予台账"
            action={
              isAdmin ? (
                <Button onClick={() => setGrantOpen(true)}>新建授予</Button>
              ) : null
            }
            flush
          >
            {grants.loading && grants.data === undefined ? (
              <LoadingRows rows={4} />
            ) : grantList.length === 0 ? (
              <EmptyState
                icon="rewards"
                title="暂无授予记录"
                description="为员工创建期权/RSU/SAR 授予后，这里会展示台账、归属进度与行权状态。"
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>授予编号</th>
                    <th>对象</th>
                    <th>类型</th>
                    <th>总量</th>
                    <th>悬崖/归属</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {grantList.map((grant) => (
                    <tr key={grant.id}>
                      <td>
                        <code>{grant.grantCode}</code>
                      </td>
                      <td>
                        <code>{grant.personId.slice(0, 8)}</code>
                      </td>
                      <td>{grant.grantType}</td>
                      <td className="mono">{grant.totalUnits}</td>
                      <td>
                        {grant.cliffMonths} 个月悬崖 · {grant.vestingMonths} 个月归属
                      </td>
                      <td>
                        <Badge status={grant.status} />
                      </td>
                      <td className="cell-actions">
                        <div className="row-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void openVesting(grant)}
                          >
                            归属进度
                          </Button>
                          {isAdmin && grant.status === "ACTIVE" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setAdjustTarget(grant);
                                setAdjustUnits(grant.totalUnits);
                                setAdjustStrike(grant.strikePrice);
                                setAdjustVestingStart("");
                                setAdjustCliff("");
                                setAdjustVesting("");
                                setAdjustReason("");
                                setAdjustError(null);
                              }}
                            >
                              修正
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setExerciseTarget(grant);
                              setExerciseUnits("");
                              setExerciseError(null);
                            }}
                          >
                            行权
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        ) : null}

        {tab === "exercises" ? (
          <Panel title="行权记录" flush>
            {exerciseList.length === 0 ? (
              <EmptyState
                icon="rewards"
                title="暂无行权记录"
                description="行权需在归属后发起，审批人不能是申请人本人。"
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>对象</th>
                    <th>数量</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {exerciseList.map((exercise) => (
                    <tr key={exercise.id}>
                      <td>
                        <code>{exercise.personId.slice(0, 8)}</code>
                      </td>
                      <td className="mono">{exercise.units}</td>
                      <td>
                        <Badge status={exercise.status} />
                      </td>
                      <td className="cell-actions">
                        <div className="row-actions">
                          {isAdmin && exercise.status === "PENDING" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void advanceExercise(exercise, "approve")}
                            >
                              批准
                            </Button>
                          ) : null}
                          {canSettle && exercise.status === "APPROVED" ? (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => void advanceExercise(exercise, "settle")}
                            >
                              交割
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        ) : null}

        {tab === "workflow" ? (
          <div className="stack">
            <Panel
              title="发起股权授予流程"
              subtitle="资格审核 → 配股计算 → 方案 → 股东会 → 协议 → 工商 → 税务 → 台账"
            >
              <form onSubmit={createGrantCase}>
                <div className="form-grid">
                  <FormField label="激励对象">
                    <PersonSelect value={casePerson} onChange={setCasePerson} />
                  </FormField>
                  <FormField label="工具">
                    <Select
                      value={caseInstrument}
                      onChange={(event) => setCaseInstrument(event.target.value)}
                    >
                      <option value="OPTION">期权</option>
                      <option value="RSU">限制性股票</option>
                      <option value="LP_SHARE">实股 LP 份额</option>
                      <option value="PHANTOM">虚拟股/分红权</option>
                    </Select>
                  </FormField>
                  <FormField label="岗位等级">
                    <Select value={caseLevel} onChange={(event) => setCaseLevel(event.target.value)}>
                      <option value="L1">L1 · C-Level</option>
                      <option value="L2">L2 · VP/总监</option>
                      <option value="L3">L3 · 高级</option>
                      <option value="L4">L4 · 中级</option>
                      <option value="L5">L5 · 初级</option>
                    </Select>
                  </FormField>
                  <FormField label="融资阶段">
                    <Select value={caseStage} onChange={(event) => setCaseStage(event.target.value)}>
                      <option value="PRE_A">Pre-A/天使</option>
                      <option value="A">A 轮</option>
                      <option value="B">B 轮</option>
                      <option value="C_PRE_IPO">C 轮/Pre-IPO</option>
                    </Select>
                  </FormField>
                  <FormField label="绩效评级">
                    <Select value={caseGrade} onChange={(event) => setCaseGrade(event.target.value)}>
                      <option value="S">S</option>
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                      <option value="D">D（一票否决）</option>
                    </Select>
                  </FormField>
                  <FormField label="加入时融资阶段（司龄）">
                    <Select value={caseTenure} onChange={(event) => setCaseTenure(event.target.value)}>
                      <option value="FOUNDING">创始期</option>
                      <option value="A">A 轮</option>
                      <option value="B">B 轮</option>
                      <option value="C">C 轮后</option>
                    </Select>
                  </FormField>
                  <FormField label="授予比例（%）">
                    <TextInput value={casePercent} onChange={(event) => setCasePercent(event.target.value)} />
                  </FormField>
                  <FormField label="授予单位数">
                    <TextInput value={caseUnits} onChange={(event) => setCaseUnits(event.target.value)} />
                  </FormField>
                  <FormField label="行权价">
                    <TextInput value={caseStrike} onChange={(event) => setCaseStrike(event.target.value)} />
                  </FormField>
                  <FormField label="已婚（需配偶确认函）">
                    <Select
                      value={caseMarried ? "yes" : "no"}
                      onChange={(event) => setCaseMarried(event.target.value === "yes")}
                    >
                      <option value="no">否</option>
                      <option value="yes">是</option>
                    </Select>
                  </FormField>
                  <FormField label="已取得风险知悉确认">
                    <Select
                      value={caseRisk ? "yes" : "no"}
                      onChange={(event) => setCaseRisk(event.target.value === "yes")}
                    >
                      <option value="no">否</option>
                      <option value="yes">是</option>
                    </Select>
                  </FormField>
                </div>
                {caseError ? <InfoNotice tone="warning">{caseError}</InfoNotice> : null}
                <div className="form-actions">
                  <Button type="submit" loading={caseSaving}>
                    发起授予流程
                  </Button>
                </div>
              </form>
            </Panel>

            <Panel title="授予流程台账" flush>
              {grantCases.loading ? (
                <div style={{ padding: 16 }}><LoadingRows /></div>
              ) : (grantCases.data ?? []).length === 0 ? (
                <EmptyState
                  icon="rewards"
                  title="暂无授予流程"
                  description="先完成资格审核与配股计算，再提交股东会审批。"
                />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>对象</th>
                      <th>工具 / 等级</th>
                      <th>授予比例</th>
                      <th>当前步骤</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(grantCases.data ?? []).map((record) => {
                      const index = GRANT_STEPS.indexOf(record.payload.status);
                      const next = GRANT_STEPS[index + 1];
                      return (
                        <tr key={record.id}>
                          <td className="mono">{record.payload.personId.slice(0, 8)}</td>
                          <td>
                            {record.payload.instrument} · {record.payload.positionLevel}
                          </td>
                          <td className="mono">{record.payload.grantPercent}%</td>
                          <td><Badge status={record.payload.status} /></td>
                          <td className="cell-actions">
                            {next ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => openAdvance(record)}
                              >
                                推进到 {zhStatus(next)}
                              </Button>
                            ) : (
                              <span className="muted">已完成</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        ) : null}
      </div>

      {/* 新建授予 */}
      <Modal
        open={grantOpen}
        title="新建授予"
        onClose={() => setGrantOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGrantOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="grant-form" loading={savingGrant}>
              创建授予
            </Button>
          </>
        }
      >
        <form id="grant-form" onSubmit={createGrant} className="form-grid">
          {grantError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{grantError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="授予对象" htmlFor="grant-person">
            <PersonSelect id="grant-person" value={grantPerson} onChange={setGrantPerson} />
          </FormField>
          <FormField label="授予编号" htmlFor="grant-code">
            <TextInput
              id="grant-code"
              value={grantCode}
              onChange={(event) => setGrantCode(event.target.value)}
              placeholder="G-2026-001"
              required
            />
          </FormField>
          <FormField label="类型" htmlFor="grant-type">
            <Select
              id="grant-type"
              value={grantType}
              onChange={(event) =>
                setGrantType(event.target.value as "OPTION" | "RSU" | "SAR")
              }
            >
              <option value="RSU">限制性股票（RSU）</option>
              <option value="OPTION">期权（OPTION）</option>
              <option value="SAR">股票增值权（SAR）</option>
            </Select>
          </FormField>
          <FormField label="授予总量" htmlFor="grant-units">
            <TextInput
              id="grant-units"
              value={grantUnits}
              onChange={(event) => setGrantUnits(event.target.value)}
              placeholder="10000"
              required
            />
          </FormField>
          <FormField label="行权价" htmlFor="grant-strike">
            <TextInput
              id="grant-strike"
              value={grantStrike}
              onChange={(event) => setGrantStrike(event.target.value)}
            />
          </FormField>
          <FormField label="币种" htmlFor="grant-currency">
            <TextInput
              id="grant-currency"
              value={grantCurrency}
              onChange={(event) => setGrantCurrency(event.target.value)}
            />
          </FormField>
          <FormField label="授予日" htmlFor="grant-date">
            <TextInput
              id="grant-date"
              type="date"
              value={grantDate}
              onChange={(event) => setGrantDate(event.target.value)}
              required
            />
          </FormField>
          <FormField label="归属起始日" htmlFor="vesting-start">
            <TextInput
              id="vesting-start"
              type="date"
              value={vestingStart}
              onChange={(event) => setVestingStart(event.target.value)}
              required
            />
          </FormField>
          <FormField label="悬崖（月）" htmlFor="cliff-months">
            <TextInput
              id="cliff-months"
              value={cliffMonths}
              onChange={(event) => setCliffMonths(event.target.value)}
            />
          </FormField>
          <FormField label="总归属期（月）" htmlFor="vesting-months">
            <TextInput
              id="vesting-months"
              value={vestingMonths}
              onChange={(event) => setVestingMonths(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      {/* 归属进度 */}
      <Modal
        open={Boolean(vestingTarget)}
        title={`归属进度 · ${vestingTarget?.grantCode ?? ""}`}
        onClose={() => setVestingTarget(null)}
        footer={
          <Button variant="ghost" onClick={() => setVestingTarget(null)}>
            关闭
          </Button>
        }
      >
        {vestingError ? <InfoNotice tone="warning">{vestingError}</InfoNotice> : null}
        {vesting ? (
          <div className="stat-grid stat-grid--three">
            <div>
              <div className="stat-label">已归属</div>
              <div className="stat-value">{vesting.vestedUnits}</div>
            </div>
            <div>
              <div className="stat-label">未归属</div>
              <div className="stat-value">{vesting.unvestedUnits}</div>
            </div>
            <div>
              <div className="stat-label">可行使</div>
              <div className="stat-value">{vesting.availableUnits}</div>
            </div>
            <div>
              <div className="stat-label">已行权</div>
              <div className="stat-value">{vesting.exercisedUnits}</div>
            </div>
            <div>
              <div className="stat-label">下一次归属</div>
              <div className="stat-value">{vesting.nextVestAt?.slice(0, 10) ?? "—"}</div>
            </div>
            <div>
              <div className="stat-label">状态</div>
              <div className="stat-value">{vesting.fullyVested ? "已全部归属" : "归属中"}</div>
            </div>
          </div>
        ) : (
          <LoadingRows rows={2} />
        )}
      </Modal>

      {/* 行权申请 */}
      <Modal
        open={Boolean(exerciseTarget)}
        title={`行权申请 · ${exerciseTarget?.grantCode ?? ""}`}
        onClose={() => setExerciseTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExerciseTarget(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="exercise-form">
              提交申请
            </Button>
          </>
        }
      >
        <form id="exercise-form" onSubmit={requestExercise} className="form-grid">
          {exerciseError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{exerciseError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="行权数量" htmlFor="exercise-units">
            <TextInput
              id="exercise-units"
              value={exerciseUnits}
              onChange={(event) => setExerciseUnits(event.target.value)}
              placeholder="1000"
              required
            />
          </FormField>
        </form>
      </Modal>

      {/* 推进授予流程 */}
      <Modal
        open={Boolean(advanceCase)}
        title={`推进授予流程 · ${advanceCase?.payload.status ?? ""}`}
        onClose={() => setAdvanceCase(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdvanceCase(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="advance-case-form">
              确认推进
            </Button>
          </>
        }
      >
        <form id="advance-case-form" onSubmit={submitAdvance} className="form-grid">
          {advanceError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{advanceError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="股东会决议编号" hint="进入协议签署前必填">
            <TextInput
              value={advanceResolution}
              onChange={(event) => setAdvanceResolution(event.target.value)}
            />
          </FormField>
          <FormField label="授予协议已签署">
            <Select
              value={advanceAgreement ? "yes" : "no"}
              onChange={(event) => setAdvanceAgreement(event.target.value === "yes")}
            >
              <option value="no">否</option>
              <option value="yes">是</option>
            </Select>
          </FormField>
          <FormField label="配偶确认函已签署">
            <Select
              value={advanceSpouse ? "yes" : "no"}
              onChange={(event) => setAdvanceSpouse(event.target.value === "yes")}
            >
              <option value="no">否</option>
              <option value="yes">是</option>
            </Select>
          </FormField>
          <FormField label="税务备案编号">
            <TextInput
              value={advanceTaxRef}
              onChange={(event) => setAdvanceTaxRef(event.target.value)}
            />
          </FormField>
          <FormField label="Cap Table 已更新">
            <Select
              value={advanceCapTable ? "yes" : "no"}
              onChange={(event) => setAdvanceCapTable(event.target.value === "yes")}
            >
              <option value="no">否</option>
              <option value="yes">是</option>
            </Select>
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(adjustTarget)}
        title="人工修正授予"
        description="台账自动计算的最终修正入口：仅 ACTIVE 授予可改，调整会写入审计并保留原因。"
        onClose={() => setAdjustTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdjustTarget(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="equity-adjust-form"
              loading={adjusting}
              disabled={!adjustReason.trim()}
            >
              保存修正
            </Button>
          </>
        }
      >
        <form id="equity-adjust-form" onSubmit={submitAdjust}>
          {adjustError ? (
            <div className="section-gap">
              <InfoNotice tone="warning">{adjustError}</InfoNotice>
            </div>
          ) : null}
          <DefinitionList
            items={[
              { label: "授予编号", value: adjustTarget?.grantCode ?? "" },
              { label: "对象", value: adjustTarget?.personId.slice(0, 8) ?? "" },
            ]}
          />
          <FormField label="总量（份）">
            <TextInput
              value={adjustUnits}
              onChange={(event) => setAdjustUnits(event.target.value)}
              placeholder="留空表示不修改"
            />
          </FormField>
          <FormField label="行权价">
            <TextInput
              value={adjustStrike}
              onChange={(event) => setAdjustStrike(event.target.value)}
              placeholder="留空表示不修改"
            />
          </FormField>
          <FormField label="归属起始日（YYYY-MM-DD）">
            <TextInput
              value={adjustVestingStart}
              onChange={(event) => setAdjustVestingStart(event.target.value)}
              placeholder="留空表示不修改"
            />
          </FormField>
          <FormField label="悬崖月数">
            <TextInput
              value={adjustCliff}
              onChange={(event) => setAdjustCliff(event.target.value)}
              placeholder="留空表示不修改"
            />
          </FormField>
          <FormField label="归属总月数">
            <TextInput
              value={adjustVesting}
              onChange={(event) => setAdjustVesting(event.target.value)}
              placeholder="留空表示不修改"
            />
          </FormField>
          <FormField label="修正原因（必填，写入审计）">
            <TextInput
              value={adjustReason}
              onChange={(event) => setAdjustReason(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
