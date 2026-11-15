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
  Textarea,
  TextInput,
} from "../components/ui.js";
import { PersonSelect } from "../components/PersonSelect.js";
import { useToast } from "../contexts/ToastContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { api, ApiError } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";

interface CalculationRunView {
  id: string;
  cycleId: string;
  mode: string;
  status: string;
  resultHash?: string;
  blockers?: string[];
  createdAt: string;
  lines?: Array<{
    id: string;
    personId: string;
    incentiveType?: string;
    amount?: string;
    netAmount?: string;
  }>;
}

interface CycleOption {
  id: string;
  name?: string;
}

interface PolicyVersionOption {
  policyVersionId: string;
  code: string;
  version: number;
  status: string;
}

interface SettlementBatchView {
  id: string;
  batchNo: string;
  status: string;
  totalAmount: string;
  currency: string;
  kind: string;
}

interface WorkPackageView {
  id: string;
  title: string;
  status: string;
  objective?: string;
}

interface ClaimView {
  id: string;
  workPackageId: string;
  claimantPersonId: string;
  status: string;
  claimMode?: string;
}

interface DecisionView {
  id: string;
  claimId: string;
  status: string;
  adjudicatorPersonId: string;
}

/** 奖金提成：业务链路（工作包→申报→认定）→ 计算 → 结算，附带 AI 影响模拟。 */
export function CommissionPage() {
  useDocumentTitle("奖金提成");
  const toast = useToast();
  const { session } = useAuth();
  const runs = useApiQuery<CalculationRunView[]>("/api/v1/calculation-runs");
  const cycles = useApiQuery<CycleOption[]>("/api/v1/evaluation-cycles");
  const versions = useApiQuery<PolicyVersionOption[]>("/api/v1/policy-versions");
  const batches = useApiQuery<SettlementBatchView[]>("/api/v1/settlement-batches");
  const packages = useApiQuery<WorkPackageView[]>("/api/v1/work-packages");
  const claims = useApiQuery<ClaimView[]>("/api/v1/contribution-claims");
  const decisions = useApiQuery<DecisionView[]>("/api/v1/attribution-decisions");
  const [tab, setTab] = useState("pipeline");
  // 任一查询失败都要显式提示——不能把 403/网络错误显示成"暂无数据"。
  const loadError =
    runs.error ??
    cycles.error ??
    versions.error ??
    batches.error ??
    packages.error ??
    claims.error ??
    decisions.error;

  // 新建计算
  const [runOpen, setRunOpen] = useState(false);
  const [runCycle, setRunCycle] = useState("");
  const [runPackage, setRunPackage] = useState("");
  const [runPolicy, setRunPolicy] = useState("");
  const [runMode, setRunMode] = useState<"SHADOW" | "FORMAL">("SHADOW");
  const [orderId, setOrderId] = useState("");
  const [grossProfit, setGrossProfit] = useState("");
  const [orderCurrency, setOrderCurrency] = useState("CNY");
  const [participant, setParticipant] = useState(session.personId);
  const [weight, setWeight] = useState("1");
  const [runError, setRunError] = useState<string | null>(null);
  const [savingRun, setSavingRun] = useState(false);

  // 明细
  const [detail, setDetail] = useState<CalculationRunView | null>(null);

  // 新建工作包
  const [packageOpen, setPackageOpen] = useState(false);
  const [packageTitle, setPackageTitle] = useState("");
  const [packageObjective, setPackageObjective] = useState("");
  const [packageOwner, setPackageOwner] = useState(session.personId);
  const [packageMember, setPackageMember] = useState(session.personId);
  const [packageCriteria, setPackageCriteria] = useState("");
  const [packageError, setPackageError] = useState<string | null>(null);
  const [savingPackage, setSavingPackage] = useState(false);

  // 新建申报
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimPackage, setClaimPackage] = useState("");
  const [claimPerson, setClaimPerson] = useState(session.personId);
  const [claimDims, setClaimDims] = useState("QUALITY, TIMELINESS");
  const [claimSummary, setClaimSummary] = useState("");
  const [claimEvidence, setClaimEvidence] = useState("");
  const [claimRationale, setClaimRationale] = useState("");
  const [claimMode, setClaimMode] = useState<"STANDARD" | "EXCEPTION" | "BACKFILL">("STANDARD");
  const [claimException, setClaimException] = useState("");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [savingClaim, setSavingClaim] = useState(false);

  // 新建认定
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decisionClaim, setDecisionClaim] = useState("");
  const [decisionAdjudicator, setDecisionAdjudicator] = useState(session.personId);
  const [decisionRationale, setDecisionRationale] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [savingDecision, setSavingDecision] = useState(false);

  // 结算批次
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchCycle, setBatchCycle] = useState("");
  const [batchKind, setBatchKind] = useState<"STANDARD" | "RECOVERY">("STANDARD");
  const [batchError, setBatchError] = useState<string | null>(null);

  // AI 影响模拟
  const [simOpen, setSimOpen] = useState(false);
  const [simPolicy, setSimPolicy] = useState("");
  const [simPoolRate, setSimPoolRate] = useState("4.0");
  const [simGrossProfit, setSimGrossProfit] = useState("100000");
  const [simPerson, setSimPerson] = useState(session.personId);
  const [simWeight, setSimWeight] = useState("1");
  const [simResult, setSimResult] = useState<unknown>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [simBusy, setSimBusy] = useState(false);

  const runList = runs.data ?? [];
  const batchList = batches.data ?? [];
  const cycleList = cycles.data ?? [];
  const packageList = packages.data ?? [];
  const claimList = claims.data ?? [];
  const decisionList = decisions.data ?? [];
  const versionList = (versions.data ?? []).filter(
    (version) => version.status === "PUBLISHED",
  );
  const acceptedPackages = packageList.filter(
    (item) => item.status === "ACCEPTED",
  );
  const submittedClaims = claimList.filter(
    (claim) => claim.status === "SUBMITTED",
  );

  async function createRun(event: FormEvent) {
    event.preventDefault();
    if (!runPackage) {
      setRunError("必须选择已验收的工作包：提成认定需要真实的归属对象。");
      return;
    }
    setRunError(null);
    setSavingRun(true);
    try {
      const created = await api<CalculationRunView>("/api/v1/calculation-runs", {
        method: "POST",
        body: {
          cycleId: runCycle,
          policyVersionId: runPolicy,
          mode: runMode,
          order: {
            id: orderId.trim() || `order-${Date.now()}`,
            grossProfit,
            currency: orderCurrency.toUpperCase(),
          },
          participants: [
            {
              personId: participant,
              workPackageId: runPackage,
              attributionWeight: weight,
              role: "OWNER",
            },
          ],
        },
      });
      toast.success(
        runMode === "FORMAL" ? "正式计算已创建" : "影子计算已创建",
        created.resultHash ? `结果哈希 ${created.resultHash.slice(0, 12)}` : "",
      );
      setRunOpen(false);
      runs.reload();
    } catch (caught) {
      setRunError(caught instanceof ApiError ? caught.message : "计算失败");
    } finally {
      setSavingRun(false);
    }
  }

  async function advanceRun(run: CalculationRunView, action: "approve" | "lock") {
    try {
      await api(`/api/v1/calculation-runs/${run.id}/${action}`, {
        method: "POST",
        body: action === "lock" ? { confirmation: "LOCK_CALCULATION" } : {},
      });
      toast.success(action === "approve" ? "计算已批准" : "账本已锁定");
      runs.reload();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "操作失败");
    }
  }

  async function createPackage(event: FormEvent) {
    event.preventDefault();
    setPackageError(null);
    setSavingPackage(true);
    try {
      await api("/api/v1/work-packages", {
        method: "POST",
        body: {
          title: packageTitle.trim(),
          objective: packageObjective.trim(),
          ownerPersonId: packageOwner,
          members: [
            {
              personId: packageOwner,
              responsibilityCode: "OWNER",
              expectedOutput: "主责交付",
            },
            ...(packageMember !== packageOwner
              ? [
                  {
                    personId: packageMember,
                    responsibilityCode: "CONTRIBUTOR",
                    expectedOutput: "协作交付",
                  },
                ]
              : []),
          ],
          acceptanceCriteria: packageCriteria
            .split(/[,，]/)
            .map((item) => item.trim())
            .filter(Boolean),
        },
      });
      toast.success("工作包已创建");
      setPackageOpen(false);
      packages.reload();
    } catch (caught) {
      setPackageError(caught instanceof ApiError ? caught.message : "创建失败");
    } finally {
      setSavingPackage(false);
    }
  }

  async function packageStep(
    workPackage: WorkPackageView,
    step: "commit" | "start" | "submit" | "accept",
  ) {
    try {
      await api(`/api/v1/work-packages/${workPackage.id}/${step}`, {
        method: "POST",
        body:
          step === "commit"
            ? { expectedVersion: 1 }
            : step === "accept"
              ? { reviewerPersonId: session.personId }
              : {},
      });
      toast.success(
        { commit: "已提交承诺快照", start: "已开始", submit: "已提交验收", accept: "已验收" }[step],
      );
      packages.reload();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "操作失败");
    }
  }

  async function createClaim(event: FormEvent) {
    event.preventDefault();
    setClaimError(null);
    setSavingClaim(true);
    try {
      await api("/api/v1/contribution-claims", {
        method: "POST",
        body: {
          workPackageId: claimPackage,
          claimantPersonId: claimPerson,
          claimType: "DELIVERABLE_CONTRIBUTION",
          claimMode,
          exceptionReason:
            claimMode !== "STANDARD" ? claimException.trim() : undefined,
          claimedContribution: {
            dimensions: claimDims
              .split(",")
              .map((dimension) => dimension.trim())
              .filter(Boolean),
            summary: claimSummary.trim(),
          },
          evidenceRefs: claimEvidence
            .split(/[,，]/)
            .map((ref) => ref.trim())
            .filter(Boolean),
          rationale: claimRationale.trim(),
        },
      });
      toast.success("贡献申报已创建");
      setClaimOpen(false);
      claims.reload();
    } catch (caught) {
      setClaimError(caught instanceof ApiError ? caught.message : "创建失败");
    } finally {
      setSavingClaim(false);
    }
  }

  async function submitClaim(claim: ClaimView) {
    try {
      await api(`/api/v1/contribution-claims/${claim.id}/submit`, {
        method: "POST",
      });
      toast.success("申报已提交待认定");
      claims.reload();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "提交失败");
    }
  }

  async function createDecision(event: FormEvent) {
    event.preventDefault();
    setDecisionError(null);
    setSavingDecision(true);
    try {
      await api("/api/v1/attribution-decisions", {
        method: "POST",
        body: {
          claimId: decisionClaim,
          adjudicatorPersonId: decisionAdjudicator,
          status: "CONFIRMED",
          acceptedFacts: ["交付与申报一致"],
          rejectedFacts: [],
          contributionDimensions: { QUALITY: 1 },
          rationale: decisionRationale.trim(),
        },
      });
      toast.success("贡献认定已记录");
      setDecisionOpen(false);
      decisions.reload();
    } catch (caught) {
      setDecisionError(caught instanceof ApiError ? caught.message : "认定失败");
    } finally {
      setSavingDecision(false);
    }
  }

  async function createBatch(event: FormEvent) {
    event.preventDefault();
    setBatchError(null);
    try {
      await api("/api/v1/settlement-batches", {
        method: "POST",
        body: { cycleId: batchCycle, kind: batchKind },
      });
      toast.success("结算批次已创建");
      setBatchOpen(false);
      batches.reload();
    } catch (caught) {
      setBatchError(caught instanceof ApiError ? caught.message : "创建失败");
    }
  }

  async function advanceBatch(
    batch: SettlementBatchView,
    command: "APPROVE" | "LOCK",
  ) {
    try {
      await api(`/api/v1/settlement-batches/${batch.id}/commands`, {
        method: "POST",
        body: { command, actorPersonId: session.personId },
      });
      toast.success(command === "APPROVE" ? "批次已批准" : "批次已锁定");
      batches.reload();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "操作失败");
    }
  }

  async function runSimulation(event: FormEvent) {
    event.preventDefault();
    setSimError(null);
    setSimBusy(true);
    setSimResult(null);
    try {
      const version = versionList.find(
        (candidate) => candidate.policyVersionId === simPolicy,
      );
      if (!version) throw new Error("请选择政策版本");
      const result = await api<unknown>("/api/v1/policy-simulations", {
        method: "POST",
        body: {
          currentPolicyVersionId: simPolicy,
          proposedPolicy: {
            code: version.code,
            version: version.version + 1,
            currency: "CNY",
            poolRate: simPoolRate,
            poolCap: "120000",
            rounding: "HALF_UP",
          },
          samples: [
            {
              personId: simPerson,
              input: {
                cycleId: runCycle || cycleList[0]?.id,
                policyVersionId: simPolicy,
                mode: "SHADOW",
                order: {
                  id: `sim-${Date.now()}`,
                  grossProfit: simGrossProfit,
                  currency: "CNY",
                  invoiceAmount: simGrossProfit,
                  cashCollected: simGrossProfit,
                  creditApproved: true,
                  qualityHold: false,
                  channelShare: "0",
                  projectType: "DC_CHARGING_PILE_SALE",
                },
                participants: [
                  {
                    personId: simPerson,
                    workPackageId: runPackage || acceptedPackages[0]?.id || "",
                    attributionWeight: simWeight,
                    role: "OWNER",
                  },
                ],
              },
            },
          ],
        },
      });
      setSimResult(result);
    } catch (caught) {
      setSimError(caught instanceof ApiError ? caught.message : "模拟失败");
    } finally {
      setSimBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="核心业务"
        title="奖金提成"
        description="业务链路：工作包 → 申报 → 认定 → 确定性计算 → 审批 → 结算。同一输入 + 同一政策 = 同一结果哈希；LLM 永远不写金额。"
        actions={
          <>
            <Button variant="secondary" onClick={() => setSimOpen(true)}>
              AI 影响模拟
            </Button>
            <Button variant="secondary" onClick={() => runs.reload()}>
              刷新
            </Button>
          </>
        }
      />
      {loadError ? (
        <InfoNotice tone="warning">数据加载失败：{loadError.message}</InfoNotice>
      ) : null}

      <Tabs
        items={[
          { id: "pipeline", label: "业务链路", count: packageList.length },
          { id: "runs", label: "计算批次", count: runList.length },
          { id: "settlements", label: "结算批次", count: batchList.length },
        ]}
        active={tab}
        onChange={setTab}
        label="奖金提成视图"
      />

      <div className="tab-panel">
        {tab === "pipeline" ? (
          <div className="stack">
            <Panel
              title="① 工作包与验收"
              subtitle="创建 → 承诺快照 → 开始 → 提交验收 → 验收人≠交付人"
              action={
                <Button onClick={() => setPackageOpen(true)}>新建工作包</Button>
              }
              flush
            >
              {packageList.length === 0 ? (
                <EmptyState
                  icon="layers"
                  title="暂无工作包"
                  description="先创建工作包并完成验收，才能申报贡献。"
                />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>工作包</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packageList.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.title}</strong>
                          <div className="hint">{item.objective ?? ""}</div>
                        </td>
                        <td>
                          <Badge status={item.status} />
                        </td>
                        <td className="cell-actions">
                          <div className="row-actions">
                            {item.status === "DRAFT" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void packageStep(item, "commit")}
                              >
                                提交承诺
                              </Button>
                            ) : null}
                            {item.status === "COMMITTED" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void packageStep(item, "start")}
                              >
                                开始
                              </Button>
                            ) : null}
                            {item.status === "IN_PROGRESS" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void packageStep(item, "submit")}
                              >
                                提交验收
                              </Button>
                            ) : null}
                            {item.status === "SUBMITTED" ? (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => void packageStep(item, "accept")}
                              >
                                验收
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

            <Panel
              title="② 贡献申报"
              subtitle="申报≠认定；例外/补录必须填写原因"
              action={<Button onClick={() => setClaimOpen(true)}>新建申报</Button>}
              flush
            >
              {claimList.length === 0 ? (
                <EmptyState
                  icon="layers"
                  title="暂无申报"
                  description="从已验收的工作包发起申报。"
                />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>申报人</th>
                      <th>工作包</th>
                      <th>模式</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claimList.map((claim) => (
                      <tr key={claim.id}>
                        <td>
                          <code>{claim.claimantPersonId.slice(0, 8)}</code>
                        </td>
                        <td>
                          <code>{claim.workPackageId.slice(0, 8)}</code>
                        </td>
                        <td>{claim.claimMode ?? "STANDARD"}</td>
                        <td>
                          <Badge status={claim.status} />
                        </td>
                        <td className="cell-actions">
                          <div className="row-actions">
                            {claim.status === "DRAFT" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void submitClaim(claim)}
                              >
                                提交
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

            <Panel
              title="③ 贡献认定"
              subtitle="裁决人≠申报人；利益冲突会被阻断"
              action={
                <Button onClick={() => setDecisionOpen(true)}>记录认定</Button>
              }
              flush
            >
              {decisionList.length === 0 ? (
                <EmptyState
                  icon="approvals"
                  title="暂无认定"
                  description="对已提交的申报记录认定结论。"
                />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>申报</th>
                      <th>裁决人</th>
                      <th>结论</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decisionList.map((decision) => (
                      <tr key={decision.id}>
                        <td>
                          <code>{decision.claimId.slice(0, 8)}</code>
                        </td>
                        <td>
                          <code>{decision.adjudicatorPersonId.slice(0, 8)}</code>
                        </td>
                        <td>
                          <Badge status={decision.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        ) : null}

        {tab === "runs" ? (
          <Panel
            title="提成计算批次"
            action={
              <div className="row-actions">
                <Button variant="secondary" onClick={() => setSimOpen(true)}>
                  AI 影响模拟
                </Button>
                <Button onClick={() => setRunOpen(true)}>新建计算</Button>
              </div>
            }
            flush
          >
            {runs.loading && runs.data === undefined ? (
              <LoadingRows rows={4} />
            ) : runList.length === 0 ? (
              <EmptyState
                icon="clock"
                title="还没有计算批次"
                description="创建考核周期后，发起影子（SHADOW）试算或正式（FORMAL）计算。"
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>批次</th>
                    <th>模式</th>
                    <th>状态</th>
                    <th>结果哈希</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {runList.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <code>{run.id.slice(0, 8)}</code>
                      </td>
                      <td>
                        <Badge tone={run.mode === "FORMAL" ? "info" : "neutral"}>
                          {run.mode === "FORMAL" ? "正式" : "影子"}
                        </Badge>
                      </td>
                      <td>
                        <Badge status={run.status} />
                        {(run.blockers ?? []).length > 0 ? (
                          <div className="hint text-danger">
                            {run.blockers!.slice(0, 2).join("；")}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <code>{run.resultHash?.slice(0, 12) ?? "—"}</code>
                      </td>
                      <td className="cell-actions">
                        <div className="row-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDetail(run)}
                          >
                            明细
                          </Button>
                          {run.status === "CALCULATED" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void advanceRun(run, "approve")}
                            >
                              批准
                            </Button>
                          ) : null}
                          {run.status === "APPROVED" ? (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => void advanceRun(run, "lock")}
                            >
                              锁定
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

        {tab === "settlements" ? (
          <Panel
            title="结算批次"
            action={<Button onClick={() => setBatchOpen(true)}>创建批次</Button>}
            flush
          >
            {batchList.length === 0 ? (
              <EmptyState
                icon="wallet"
                title="暂无结算批次"
                description="锁定账本后按周期生成结算批次；追回批次需员工逐人确认。"
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>批次号</th>
                    <th>类型</th>
                    <th>状态</th>
                    <th>总额</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {batchList.map((batch) => (
                    <tr key={batch.id}>
                      <td>
                        <code>{batch.batchNo}</code>
                      </td>
                      <td>{batch.kind === "RECOVERY" ? "追回" : "标准"}</td>
                      <td>
                        <Badge status={batch.status} />
                      </td>
                      <td className="mono">
                        {batch.totalAmount} {batch.currency}
                      </td>
                      <td className="cell-actions">
                        <div className="row-actions">
                          {batch.status === "RECONCILING" ||
                          batch.status === "PENDING_APPROVAL" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void advanceBatch(batch, "APPROVE")}
                            >
                              批准
                            </Button>
                          ) : null}
                          {batch.status === "APPROVED" ? (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => void advanceBatch(batch, "LOCK")}
                            >
                              锁定
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
      </div>

      {/* 新建工作包 */}
      <Modal
        open={packageOpen}
        title="新建工作包"
        onClose={() => setPackageOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPackageOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="package-form"
              loading={savingPackage}
            >
              创建
            </Button>
          </>
        }
      >
        <form id="package-form" onSubmit={createPackage} className="form-grid">
          {packageError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{packageError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="标题" htmlFor="package-title">
            <TextInput
              id="package-title"
              value={packageTitle}
              onChange={(event) => setPackageTitle(event.target.value)}
              required
            />
          </FormField>
          <FormField label="目标" htmlFor="package-objective">
            <TextInput
              id="package-objective"
              value={packageObjective}
              onChange={(event) => setPackageObjective(event.target.value)}
              required
            />
          </FormField>
          <FormField label="负责人" htmlFor="package-owner">
            <PersonSelect
              id="package-owner"
              value={packageOwner}
              onChange={setPackageOwner}
            />
          </FormField>
          <FormField label="协作人（可同负责人）" htmlFor="package-member">
            <PersonSelect
              id="package-member"
              value={packageMember}
              onChange={setPackageMember}
            />
          </FormField>
          <FormField label="验收标准（逗号分隔）" htmlFor="package-criteria">
            <TextInput
              id="package-criteria"
              value={packageCriteria}
              onChange={(event) => setPackageCriteria(event.target.value)}
              placeholder="客户验收通过, 文档齐全"
              required
            />
          </FormField>
        </form>
      </Modal>

      {/* 新建申报 */}
      <Modal
        open={claimOpen}
        title="新建贡献申报"
        onClose={() => setClaimOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setClaimOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="claim-form"
              loading={savingClaim}
            >
              提交申报
            </Button>
          </>
        }
      >
        <form id="claim-form" onSubmit={createClaim} className="form-grid">
          {claimError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{claimError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="工作包（仅已验收）" htmlFor="claim-package">
            <Select
              id="claim-package"
              value={claimPackage}
              onChange={(event) => setClaimPackage(event.target.value)}
              required
            >
              <option value="">选择工作包…</option>
              {acceptedPackages.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="申报人" htmlFor="claim-person">
            <PersonSelect
              id="claim-person"
              value={claimPerson}
              onChange={setClaimPerson}
            />
          </FormField>
          <FormField label="申报模式" htmlFor="claim-mode">
            <Select
              id="claim-mode"
              value={claimMode}
              onChange={(event) =>
                setClaimMode(
                  event.target.value as "STANDARD" | "EXCEPTION" | "BACKFILL",
                )
              }
            >
              <option value="STANDARD">标准申报</option>
              <option value="EXCEPTION">例外申报</option>
              <option value="BACKFILL">事后补录</option>
            </Select>
          </FormField>
          {claimMode !== "STANDARD" ? (
            <FormField label="例外原因（必填）" htmlFor="claim-exception">
              <TextInput
                id="claim-exception"
                value={claimException}
                onChange={(event) => setClaimException(event.target.value)}
                required
              />
            </FormField>
          ) : null}
          <FormField label="贡献维度（逗号分隔）" htmlFor="claim-dims">
            <TextInput
              id="claim-dims"
              value={claimDims}
              onChange={(event) => setClaimDims(event.target.value)}
            />
          </FormField>
          <FormField label="贡献摘要" htmlFor="claim-summary">
            <Textarea
              id="claim-summary"
              rows={2}
              value={claimSummary}
              onChange={(event) => setClaimSummary(event.target.value)}
              required
            />
          </FormField>
          <FormField label="证据引用（逗号分隔）" htmlFor="claim-evidence">
            <TextInput
              id="claim-evidence"
              value={claimEvidence}
              onChange={(event) => setClaimEvidence(event.target.value)}
              placeholder="evidence-id-1, evidence-id-2"
            />
          </FormField>
          <FormField label="申报理由" htmlFor="claim-rationale">
            <Textarea
              id="claim-rationale"
              rows={2}
              value={claimRationale}
              onChange={(event) => setClaimRationale(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      {/* 认定 */}
      <Modal
        open={decisionOpen}
        title="记录贡献认定"
        onClose={() => setDecisionOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecisionOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="decision-form"
              loading={savingDecision}
            >
              记录认定
            </Button>
          </>
        }
      >
        <form id="decision-form" onSubmit={createDecision} className="form-grid">
          {decisionError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{decisionError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="申报（仅已提交）" htmlFor="decision-claim">
            <Select
              id="decision-claim"
              value={decisionClaim}
              onChange={(event) => setDecisionClaim(event.target.value)}
              required
            >
              <option value="">选择申报…</option>
              {submittedClaims.map((claim) => (
                <option key={claim.id} value={claim.id}>
                  {claim.claimantPersonId.slice(0, 8)} · {claim.workPackageId.slice(0, 8)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="裁决人（≠申报人）" htmlFor="decision-adjudicator">
            <PersonSelect
              id="decision-adjudicator"
              value={decisionAdjudicator}
              onChange={setDecisionAdjudicator}
            />
          </FormField>
          <FormField label="认定理由" htmlFor="decision-rationale">
            <Textarea
              id="decision-rationale"
              rows={2}
              value={decisionRationale}
              onChange={(event) => setDecisionRationale(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      {/* 新建计算 */}
      <Modal
        open={runOpen}
        title="新建提成计算"
        onClose={() => setRunOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRunOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="run-form"
              loading={savingRun}
            >
              开始计算
            </Button>
          </>
        }
      >
        <form id="run-form" onSubmit={createRun} className="form-grid">
          {runError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{runError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="考核周期" htmlFor="run-cycle">
            <Select
              id="run-cycle"
              value={runCycle}
              onChange={(event) => setRunCycle(event.target.value)}
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
          <FormField
            label="工作包"
            htmlFor="run-package"
            hint="提成必须归属到已验收的工作包"
          >
            <Select
              id="run-package"
              value={runPackage}
              onChange={(event) => setRunPackage(event.target.value)}
              required
            >
              <option value="">选择已验收工作包…</option>
              {acceptedPackages.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="政策版本" htmlFor="run-policy">
            <Select
              id="run-policy"
              value={runPolicy}
              onChange={(event) => setRunPolicy(event.target.value)}
              required
            >
              <option value="">选择已发布版本…</option>
              {versionList.map((version) => (
                <option key={version.policyVersionId} value={version.policyVersionId}>
                  {version.code} v{version.version}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="计算模式" htmlFor="run-mode">
            <Select
              id="run-mode"
              value={runMode}
              onChange={(event) =>
                setRunMode(event.target.value as "SHADOW" | "FORMAL")
              }
            >
              <option value="SHADOW">影子试算（不产生付款效力）</option>
              <option value="FORMAL">正式计算（需法律门禁）</option>
            </Select>
          </FormField>
          <FormField label="订单编号" htmlFor="order-id">
            <TextInput
              id="order-id"
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              placeholder="order-2026-001"
            />
          </FormField>
          <FormField label="订单毛利" htmlFor="gross-profit">
            <TextInput
              id="gross-profit"
              value={grossProfit}
              onChange={(event) => setGrossProfit(event.target.value)}
              placeholder="100000"
              required
            />
          </FormField>
          <FormField label="币种" htmlFor="order-currency">
            <TextInput
              id="order-currency"
              value={orderCurrency}
              onChange={(event) => setOrderCurrency(event.target.value)}
            />
          </FormField>
          <FormField label="参与人" htmlFor="run-person">
            <PersonSelect
              id="run-person"
              value={participant}
              onChange={setParticipant}
            />
          </FormField>
          <FormField label="贡献权重" htmlFor="run-weight">
            <TextInput
              id="run-weight"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      {/* 计算明细 */}
      <Modal
        open={Boolean(detail)}
        title="计算明细"
        onClose={() => setDetail(null)}
        footer={
          <Button variant="ghost" onClick={() => setDetail(null)}>
            关闭
          </Button>
        }
      >
        {detail ? (
          <div className="stack">
            <InfoNotice>
              模式 {detail.mode === "FORMAL" ? "正式" : "影子"} · 状态{" "}
              {detail.status} · 哈希 {detail.resultHash?.slice(0, 16) ?? "—"}
            </InfoNotice>
            {(detail.lines ?? []).length === 0 ? (
              <p className="hint">没有可见的计算行（可能尚未计算或已按权限脱敏）。</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>对象</th>
                    <th>类型</th>
                    <th>金额</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.lines ?? []).map((line) => (
                    <tr key={line.id}>
                      <td>
                        <code>{line.personId.slice(0, 8)}</code>
                      </td>
                      <td>{line.incentiveType ?? "—"}</td>
                      <td className="mono">{line.amount ?? line.netAmount ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </Modal>

      {/* 创建结算批次 */}
      <Modal
        open={batchOpen}
        title="创建结算批次"
        onClose={() => setBatchOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBatchOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="batch-form">
              创建
            </Button>
          </>
        }
      >
        <form id="batch-form" onSubmit={createBatch} className="form-grid">
          {batchError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{batchError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="考核周期" htmlFor="batch-cycle">
            <Select
              id="batch-cycle"
              value={batchCycle}
              onChange={(event) => setBatchCycle(event.target.value)}
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
          <FormField label="批次类型" htmlFor="batch-kind">
            <Select
              id="batch-kind"
              value={batchKind}
              onChange={(event) =>
                setBatchKind(event.target.value as "STANDARD" | "RECOVERY")
              }
            >
              <option value="STANDARD">标准结算</option>
              <option value="RECOVERY">追回（需逐人确认）</option>
            </Select>
          </FormField>
        </form>
      </Modal>

      {/* AI 影响模拟 */}
      <Modal
        open={simOpen}
        title="AI 影响模拟"
        onClose={() => setSimOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSimOpen(false)}>
              关闭
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="sim-form"
              loading={simBusy}
            >
              运行模拟
            </Button>
          </>
        }
      >
        <form id="sim-form" onSubmit={runSimulation} className="form-grid">
          {simError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{simError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="当前政策版本" htmlFor="sim-policy">
            <Select
              id="sim-policy"
              value={simPolicy}
              onChange={(event) => setSimPolicy(event.target.value)}
              required
            >
              <option value="">选择版本…</option>
              {versionList.map((version) => (
                <option key={version.policyVersionId} value={version.policyVersionId}>
                  {version.code} v{version.version}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="拟调整池比例（%）"
            htmlFor="sim-rate"
            hint="模拟修改 poolRate 对个人金额的影响；不会发布政策。"
          >
            <TextInput
              id="sim-rate"
              value={simPoolRate}
              onChange={(event) => setSimPoolRate(event.target.value)}
              required
            />
          </FormField>
          <FormField label="订单毛利" htmlFor="sim-profit">
            <TextInput
              id="sim-profit"
              value={simGrossProfit}
              onChange={(event) => setSimGrossProfit(event.target.value)}
              required
            />
          </FormField>
          <FormField label="参与人" htmlFor="sim-person">
            <PersonSelect
              id="sim-person"
              value={simPerson}
              onChange={setSimPerson}
            />
          </FormField>
          <FormField label="权重" htmlFor="sim-weight">
            <TextInput
              id="sim-weight"
              value={simWeight}
              onChange={(event) => setSimWeight(event.target.value)}
            />
          </FormField>
          {simResult ? (
            <div className="field--full">
              <InfoNotice>
                模拟结果仅供参考，不会写入金额或发布政策：
              </InfoNotice>
              {(() => {
                const result = simResult as {
                  currentTotal?: string;
                  proposedTotal?: string;
                  deltaTotal?: string;
                  affectedPeople?: number;
                  blockers?: string[];
                };
                return (
                  <div className="stat-grid stat-grid--three section-gap">
                    <div>
                      <div className="stat-label">当前总额</div>
                      <div className="stat-value">{result.currentTotal ?? "—"}</div>
                    </div>
                    <div>
                      <div className="stat-label">拟调整后总额</div>
                      <div className="stat-value">{result.proposedTotal ?? "—"}</div>
                    </div>
                    <div>
                      <div className="stat-label">差额</div>
                      <div className="stat-value">{result.deltaTotal ?? "—"}</div>
                    </div>
                  </div>
                );
              })()}
              {(() => {
                const result = simResult as { blockers?: string[] };
                return (result.blockers ?? []).length > 0 ? (
                  <div className="section-gap">
                    <InfoNotice tone="warning">
                      阻断项：{(result.blockers ?? []).slice(0, 3).join("；")}
                    </InfoNotice>
                  </div>
                ) : null;
              })()}
            </div>
          ) : null}
        </form>
      </Modal>
    </div>
  );
}
