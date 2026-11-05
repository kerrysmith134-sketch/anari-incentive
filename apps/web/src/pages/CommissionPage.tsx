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
} from "../components/ui.js";
import { PersonSelect, usePeople } from "../components/PersonSelect.js";
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
  lines?: Array<{ personId: string; amount: string }>;
}

/** 奖金提成：确定性计算 → 审批 → 锁定 → 结算。 */
export function CommissionPage() {
  useDocumentTitle("奖金提成");
  const toast = useToast();
  const { session } = useAuth();
  const { people } = usePeople();
  const runs = useApiQuery<CalculationRunView[]>("/api/v1/calculation-runs");
  const cycles = useApiQuery<CycleOption[]>("/api/v1/evaluation-cycles");
  const versions = useApiQuery<PolicyVersionOption[]>("/api/v1/policy-versions");
  const batches = useApiQuery<SettlementBatchView[]>("/api/v1/settlement-batches");
  const [tab, setTab] = useState("runs");

  // 新建计算
  const [runOpen, setRunOpen] = useState(false);
  const [runCycle, setRunCycle] = useState("");
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

  const runList = runs.data ?? [];
  const batchList = batches.data ?? [];
  const cycleList = cycles.data ?? [];
  const versionList = (versions.data ?? []).filter(
    (version) => version.status === "PUBLISHED",
  );

  async function createRun(event: FormEvent) {
    event.preventDefault();
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
              workPackageId: runCycle,
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

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchCycle, setBatchCycle] = useState("");
  const [batchKind, setBatchKind] = useState<"STANDARD" | "RECOVERY">("STANDARD");
  const [batchError, setBatchError] = useState<string | null>(null);

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

  return (
    <div className="page">
      <PageHeader
        eyebrow="核心业务"
        title="奖金提成"
        description="同一输入 + 同一政策 = 同一结果哈希。计算结果须人工审批、全员确认后才能锁定进账本，LLM 永远不写金额。"
        actions={
          <Button variant="secondary" onClick={() => runs.reload()}>
            刷新
          </Button>
        }
      />
      <Tabs
        items={[
          { id: "runs", label: "计算批次", count: runList.length },
          { id: "settlements", label: "结算批次", count: batchList.length },
        ]}
        active={tab}
        onChange={setTab}
        label="奖金提成视图"
      />

      <div className="tab-panel">
        {tab === "runs" ? (
          <Panel
            title="提成计算批次"
            action={<Button onClick={() => setRunOpen(true)}>新建计算</Button>}
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
    </div>
  );
}
