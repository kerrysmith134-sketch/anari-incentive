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
  SearchInput,
  Select,
  Tabs,
  TextInput,
  Textarea,
} from "../components/ui.js";
import { PersonSelect, usePeople } from "../components/PersonSelect.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { clickableRowProps } from "../lib/a11y.js";
import {
  displayName,
  formatDateTime,
  formatMoney,
  formatRelative,
  shortId,
  titleCase,
  sumMoney,
} from "../lib/format.js";
import type {
  BudgetAllocation,
  BudgetPool,
  EvaluationCycle,
  LedgerEntry,
  SettlementBatch,
  SettlementCommandResult,
} from "../lib/types.js";
import type {
  AdjustmentRecordView,
  CashGateInputView,
  FinancialFactView,
  SettlementExportView,
} from "../lib/ops-types.js";

type Command =
  | "RECONCILE"
  | "SUBMIT"
  | "APPROVE"
  | "LOCK"
  | "EXPORT"
  | "ACKNOWLEDGE"
  | "REQUIRE_ADJUSTMENT"
  | "CANCEL";

const COMMANDS_BY_STATUS: Record<
  string,
  Array<{ command: Command; label: string; variant?: "primary" | "secondary" | "danger" }>
> = {
  DRAFT: [
    { command: "RECONCILE", label: "对账", variant: "primary" },
    { command: "CANCEL", label: "取消", variant: "danger" },
  ],
  RECONCILING: [
    { command: "SUBMIT", label: "提交审批", variant: "primary" },
    { command: "REQUIRE_ADJUSTMENT", label: "需调整", variant: "danger" },
    { command: "CANCEL", label: "取消", variant: "danger" },
  ],
  PENDING_APPROVAL: [
    { command: "APPROVE", label: "批准", variant: "primary" },
    { command: "CANCEL", label: "取消", variant: "danger" },
  ],
  APPROVED: [{ command: "LOCK", label: "锁定批次", variant: "primary" }],
  LOCKED: [{ command: "EXPORT", label: "导出 CSV", variant: "primary" }],
  EXPORTED: [
    { command: "ACKNOWLEDGE", label: "签收", variant: "primary" },
    { command: "REQUIRE_ADJUSTMENT", label: "需调整", variant: "danger" },
  ],
  ACKNOWLEDGED: [
    { command: "REQUIRE_ADJUSTMENT", label: "需调整", variant: "danger" },
  ],
  ADJUSTMENT_REQUIRED: [
    { command: "RECONCILE", label: "Reconcile again", variant: "primary" },
  ],
};

const COMMAND_COPY: Record<Command, { title: string; description: string }> = {
  RECONCILE: {
    title: "Reconcile settlement batch",
    description: "批准前逐行核对锁定账本。",
  },
  SUBMIT: {
    title: "提交审批",
    description: "将对账完成的批次移入审批队列。",
  },
  APPROVE: {
    title: "批准结算批次",
    description: "记录批准；如已配置，需提供对应审批请求。",
  },
  LOCK: {
    title: "锁定结算批次",
    description: "锁定明细，导出前不可再变更。",
  },
  EXPORT: {
    title: "导出结算批次",
    description: "生成结算 CSV 并记录导出证据。",
  },
  ACKNOWLEDGE: {
    title: "确认结算导出",
    description: "记录导出文件的外部回执引用。",
  },
  REQUIRE_ADJUSTMENT: {
    title: "需调整",
    description: "将批次标记为需更正并记录原因。",
  },
  CANCEL: {
    title: "取消结算批次",
    description: "将批次行置为失效；已验收或锁定的资金不会被删除。",
  },
};

export function SettlementsPage() {
  useDocumentTitle("结算");
  const { session } = useAuth();
  const toast = useToast();
  const { people } = usePeople();
  const [tab, setTab] = useState("batches");
  const cycles = useApiQuery<EvaluationCycle[]>("/api/v1/evaluation-cycles");
  const batches = useApiQuery<SettlementBatch[]>("/api/v1/settlement-batches");
  const ledger = useApiQuery<LedgerEntry[]>("/api/v1/ledger");
  const ledgerVerify = useApiQuery<{ valid: boolean }>("/api/v1/ledger/verify");
  const pools = useApiQuery<BudgetPool[]>("/api/v1/budget-pools");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [cycleId, setCycleId] = useState("");
  const [kind, setKind] = useState<"STANDARD" | "RECOVERY">("STANDARD");
  const [currency, setCurrency] = useState("CNY");
  const [batchNo, setBatchNo] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [commandTarget, setCommandTarget] = useState<{
    command: Command;
    batch: SettlementBatch;
  } | null>(null);
  const [actorPersonId, setActorPersonId] = useState(session.personId);
  const [externalReference, setExternalReference] = useState("");
  const [commandReason, setCommandReason] = useState("");
  const [approvalRequestId, setApprovalRequestId] = useState("");
  const [commandError, setCommandError] = useState<string | null>(null);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerStatus, setLedgerStatus] = useState("ALL");

  const batchList = batches.data ?? [];
  const selectedBatch = batchList.find((batch) => batch.id === selectedBatchId);
  const detail = useApiQuery<SettlementBatch>(
    selectedBatchId
      ? `/api/v1/settlement-batches/${selectedBatchId}`
      : null,
    selectedBatchId,
  );

  useEffect(() => {
    if (!selectedBatchId && batchList[0]?.id) setSelectedBatchId(batchList[0].id);
  }, [batchList, selectedBatchId]);

  const [poolCreateOpen, setPoolCreateOpen] = useState(false);
  const [poolCycleId, setPoolCycleId] = useState("");
  const [poolCode, setPoolCode] = useState("");
  const [poolName, setPoolName] = useState("");
  const [poolType, setPoolType] = useState("INCENTIVE");
  const [poolCurrency, setPoolCurrency] = useState("CNY");
  const [poolAmount, setPoolAmount] = useState("");
  const [poolError, setPoolError] = useState<string | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [approvedBy, setApprovedBy] = useState(session.personId);
  const [approveTarget, setApproveTarget] = useState<BudgetPool | null>(null);
  const [allocationBusy, setAllocationBusy] = useState<string | null>(null);
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [allocationTargetType, setAllocationTargetType] = useState("CALCULATION_RUN");
  const [allocationTargetId, setAllocationTargetId] = useState("");
  const [allocationAmount, setAllocationAmount] = useState("");
  const [allocationError, setAllocationError] = useState<string | null>(null);
  const [ledgerTarget, setLedgerTarget] = useState<LedgerEntry | null>(null);
  const [ledgerAction, setLedgerAction] = useState<"adjust" | "reverse">("adjust");
  const [ledgerAmount, setLedgerAmount] = useState("");
  const [ledgerReasonCode, setLedgerReasonCode] = useState("DATA_CORRECTION");
  const [ledgerExplanation, setLedgerExplanation] = useState("");
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const cashGates = useApiQuery<CashGateInputView[]>("/api/v1/cash-gate-inputs");
  const financialFacts = useApiQuery<FinancialFactView[]>(
    "/api/v1/financial-facts",
  );
  const settlementExports = useApiQuery<SettlementExportView[]>(
    "/api/v1/settlement-exports",
  );
  const adjustmentRecords = useApiQuery<AdjustmentRecordView[]>(
    "/api/v1/adjustment-records",
  );
  const [ackTarget, setAckTarget] = useState<SettlementExportView | null>(null);
  const [ackReference, setAckReference] = useState("");
  const [ackError, setAckError] = useState<string | null>(null);
  const [cashOpen, setCashOpen] = useState(false);
  const [cashCycleId, setCashCycleId] = useState("");
  const [cashAsOfDate, setCashAsOfDate] = useState("");
  const [cashReserveMonths, setCashReserveMonths] = useState("3");
  const [cashForecastRef, setCashForecastRef] = useState("");
  const [cashPassesGate, setCashPassesGate] = useState(true);
  const [cashApprovedBy, setCashApprovedBy] = useState(session.personId);
  const [cashError, setCashError] = useState<string | null>(null);
  const [factOpen, setFactOpen] = useState(false);
  const [factSourceSystem, setFactSourceSystem] = useState("");
  const [factSourceRecordId, setFactSourceRecordId] = useState("");
  const [factType, setFactType] = useState("");
  const [factAmount, setFactAmount] = useState("");
  const [factCurrency, setFactCurrency] = useState("CNY");
  const [factPeriodStart, setFactPeriodStart] = useState("");
  const [factPeriodEnd, setFactPeriodEnd] = useState("");
  const [factQuality, setFactQuality] = useState("UNVERIFIED");
  const [factError, setFactError] = useState<string | null>(null);

  const poolList = pools.data ?? [];
  const selectedPool = poolList.find((pool) => pool.id === selectedPoolId);

  useEffect(() => {
    if (!selectedPoolId && poolList[0]?.id) setSelectedPoolId(poolList[0].id);
  }, [poolList, selectedPoolId]);
  const allocations = useApiQuery<BudgetAllocation[]>(
    selectedPoolId
      ? `/api/v1/budget-pools/${selectedPoolId}/allocations`
      : null,
    selectedPoolId,
  );

  const ledgerEntries = ledger.data ?? [];
  const visibleLedger = useMemo(() => {
    const query = ledgerSearch.trim().toLowerCase();
    return ledgerEntries.filter((entry) => {
      if (ledgerStatus !== "ALL" && entry.status !== ledgerStatus) return false;
      if (!query) return true;
      return [
        entry.personId,
        entry.cycleId,
        entry.entryType,
        entry.status,
        entry.id,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [ledgerEntries, ledgerSearch, ledgerStatus]);
  // Never add different currencies together: show one total per currency.
  // 金额按 decimal 字符串精确累加（sumMoney），不用 Number 浮点求和。
  const lockedByCurrency = ledgerEntries
    .filter((entry) => entry.status === "LOCKED")
    .reduce<Record<string, string[]>>((totals, entry) => {
      const currency = entry.currency || "CNY";
      totals[currency] = [...(totals[currency] ?? []), entry.amount];
      return totals;
    }, {});
  const lockedTotals = Object.fromEntries(
    Object.entries(lockedByCurrency).map(([currency, values]) => [
      currency,
      sumMoney(values),
    ]),
  );
  const lockedTotalLabel =
    Object.keys(lockedByCurrency).length === 0
      ? formatMoney(0, "CNY", { compact: true })
      : Object.entries(lockedTotals)
          .map(([currency, total]) =>
            formatMoney(total, currency, { compact: true }),
          )
          .join(" · ");

  function openCreate() {
    setCycleId(cycles.data?.[0]?.id ?? "");
    setKind("STANDARD");
    setCurrency("CNY");
    setBatchNo("");
    setFormError(null);
    setCreateOpen(true);
  }

  async function createBatch(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const created = await api<SettlementBatch>("/api/v1/settlement-batches", {
        method: "POST",
        body: {
          cycleId,
          kind,
          currency: currency || undefined,
          batchNo: batchNo.trim() || undefined,
        },
      });
      toast.success("结算批次已创建", created.batchNo);
      setCreateOpen(false);
      setSelectedBatchId(created.id);
      batches.reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "创建批次失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function openCommand(command: Command, batch: SettlementBatch) {
    setCommandTarget({ command, batch });
    setActorPersonId(session.personId);
    setExternalReference("");
    setCommandReason("");
    setApprovalRequestId("");
    setCommandError(null);
  }

  async function executeCommand() {
    if (!commandTarget) return;
    const { command, batch } = commandTarget;
    if (command === "ACKNOWLEDGE" && !externalReference.trim()) {
      setCommandError("必须填写外部回执引用。");
      return;
    }
    if (command === "REQUIRE_ADJUSTMENT" && !commandReason.trim()) {
      setCommandError("必须填写原因。");
      return;
    }
    setSubmitting(true);
    setCommandError(null);
    try {
      const result = await api<SettlementCommandResult>(
        `/api/v1/settlement-batches/${batch.id}/commands`,
        {
          method: "POST",
          body: {
            command,
            actorPersonId: actorPersonId || undefined,
            externalReference: externalReference.trim() || undefined,
            reason: commandReason.trim() || undefined,
            approvalRequestId: approvalRequestId.trim() || undefined,
          },
        },
      );
      if (result.csv) {
        const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `settlement-${batch.batchNo}.csv`;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      }
      toast.success(`${titleCase(command)} recorded`, batch.batchNo);
      setCommandTarget(null);
      batches.reload();
      detail.reload();
    } catch (caught) {
      setCommandError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "命令执行失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function openPoolCreate() {
    setPoolCycleId(cycles.data?.[0]?.id ?? "");
    setPoolCode("");
    setPoolName("");
    setPoolType("INCENTIVE");
    setPoolCurrency("CNY");
    setPoolAmount("");
    setPoolError(null);
    setPoolCreateOpen(true);
  }

  async function createPool(event: FormEvent) {
    event.preventDefault();
    setPoolError(null);
    setSubmitting(true);
    try {
      const created = await api<BudgetPool>("/api/v1/budget-pools", {
        method: "POST",
        body: {
          cycleId: poolCycleId,
          code: poolCode.trim(),
          name: poolName.trim(),
          poolType: poolType.trim(),
          currency: poolCurrency.toUpperCase(),
          approvedAmount: poolAmount,
        },
      });
      toast.success("预算池已创建", poolName);
      setSelectedPoolId(created.id);
      setPoolCreateOpen(false);
      pools.reload();
    } catch (caught) {
      setPoolError(
        caught instanceof Error ? caught.message : "创建资金池失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function approvePool() {
    if (!approveTarget) return;
    setSubmitting(true);
    try {
      await api(`/api/v1/budget-pools/${approveTarget.id}/approve`, {
        method: "POST",
        body: { approvedBy },
      });
      toast.success("预算池已批准", approveTarget.name);
      setApproveTarget(null);
      pools.reload();
    } catch (caught) {
      toast.error(
        "审批失败",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function releaseAllocation(allocation: BudgetAllocation) {
    setAllocationBusy(allocation.id);
    try {
      await api(`/api/v1/budget-allocations/${allocation.id}/release`, {
        method: "POST",
      });
      toast.success("分配已释放", shortId(allocation.id));
      allocations.reload();
      pools.reload();
    } catch (caught) {
      toast.error(
        "Release failed",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setAllocationBusy(null);
    }
  }

  async function createAllocation(event: FormEvent) {
    event.preventDefault();
    if (!selectedPoolId) return;
    setAllocationError(null);
    try {
      await api(`/api/v1/budget-pools/${selectedPoolId}/allocations`, {
        method: "POST",
        body: {
          targetType: allocationTargetType,
          targetId: allocationTargetId.trim(),
          amount: allocationAmount,
        },
      });
      toast.success("预算分配已创建", "已占用资金池额度");
      setAllocationOpen(false);
      setAllocationTargetId("");
      setAllocationAmount("");
      allocations.reload();
      pools.reload();
    } catch (caught) {
      setAllocationError(
        caught instanceof ApiError ? caught.message : "创建分配失败",
      );
    }
  }

  function openLedgerAction(
    entry: LedgerEntry,
    action: "adjust" | "reverse",
  ) {
    setLedgerTarget(entry);
    setLedgerAction(action);
    setLedgerAmount(action === "adjust" ? entry.amount : "");
    setLedgerReasonCode(action === "adjust" ? "DATA_CORRECTION" : "REVERSAL");
    setLedgerExplanation("");
    setLedgerError(null);
  }

  async function submitLedgerAction(event: FormEvent) {
    event.preventDefault();
    if (!ledgerTarget) return;
    setLedgerError(null);
    try {
      if (ledgerAction === "adjust") {
        await api(`/api/v1/ledger/${ledgerTarget.id}/adjustments`, {
          method: "POST",
          body: {
            amount: ledgerAmount,
            reasonCode: ledgerReasonCode,
            explanation: ledgerExplanation.trim(),
            approvedBy: session.personId,
            idempotencyKey: `adjust-${ledgerTarget.id}-${Date.now()}`,
          },
        });
      } else {
        await api(`/api/v1/ledger/${ledgerTarget.id}/reverse`, {
          method: "POST",
          body: {
            reason: ledgerExplanation.trim(),
            approvedBy: session.personId,
            idempotencyKey: `reverse-${ledgerTarget.id}-${Date.now()}`,
          },
        });
      }
      toast.success(
        ledgerAction === "adjust" ? "调整已入账" : "冲销已入账",
        "追加式账本保留原记录",
      );
      setLedgerTarget(null);
      ledger.reload();
      adjustmentRecords.reload();
    } catch (caught) {
      setLedgerError(
        caught instanceof ApiError ? caught.message : "账本操作失败",
      );
    }
  }

  function openCashGate() {
    setCashCycleId(cycles.data?.[0]?.id ?? "");
    setCashAsOfDate(new Date().toISOString().slice(0, 10));
    setCashReserveMonths("3");
    setCashForecastRef("");
    setCashPassesGate(true);
    setCashApprovedBy(session.personId);
    setCashError(null);
    setCashOpen(true);
  }

  async function submitCashGate() {
    setCashError(null);
    try {
      await api("/api/v1/cash-gate-inputs", {
        method: "POST",
        body: {
          cycleId: cashCycleId,
          asOfDate: cashAsOfDate,
          safetyReserveMonths: cashReserveMonths,
          thirteenWeekForecastRef: cashForecastRef.trim(),
          passesGate: cashPassesGate,
          approvedBy: cashApprovedBy,
        },
      });
      toast.success("现金门禁已记录", cashCycleId);
      setCashOpen(false);
      cashGates.reload();
    } catch (caught) {
      setCashError(
        caught instanceof ApiError ? caught.message : "记录门禁输入失败",
      );
    }
  }

  function openFinancialFact() {
    setFactSourceSystem("");
    setFactSourceRecordId("");
    setFactType("");
    setFactAmount("");
    setFactCurrency("CNY");
    setFactPeriodStart("");
    setFactPeriodEnd("");
    setFactQuality("UNVERIFIED");
    setFactError(null);
    setFactOpen(true);
  }

  async function submitFinancialFact() {
    setFactError(null);
    try {
      await api("/api/v1/financial-facts", {
        method: "POST",
        body: {
          sourceSystem: factSourceSystem.trim(),
          sourceRecordId: factSourceRecordId.trim(),
          factType: factType.trim(),
          periodStart: factPeriodStart || undefined,
          periodEnd: factPeriodEnd || undefined,
          amount: factAmount,
          currency: factCurrency.toUpperCase(),
          qualityStatus: factQuality,
        },
      });
      toast.success("财务事实已记录", factSourceRecordId);
      setFactOpen(false);
      financialFacts.reload();
    } catch (caught) {
      setFactError(
        caught instanceof ApiError ? caught.message : "记录财务事实失败",
      );
    }
  }

  async function acknowledgeExport() {
    if (!ackTarget) return;
    setAckError(null);
    try {
      await api(`/api/v1/settlement-exports/${ackTarget.id}/acknowledge`, {
        method: "POST",
        body: { externalReference: ackReference.trim() },
      });
      toast.success("导出回执已确认", ackTarget.exportRef);
      setAckTarget(null);
      settlementExports.reload();
    } catch (caught) {
      setAckError(
        caught instanceof ApiError ? caught.message : "确认回执失败",
      );
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="资金路径"
        title="结算"
        description="从锁定账本对账、批准、锁定并导出批次；账本哈希链与预算占用始终可见。"
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => {
              batches.reload();
              ledger.reload();
              pools.reload();
              ledgerVerify.reload();
            }}
            loading={batches.loading}
          >
            刷新
          </Button>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">结算批次</span>
          </div>
          <div className="stat-tile__value">{batchList.length}</div>
          <div className="stat-tile__detail">
            {batchList.filter((batch) => batch.status === "ACKNOWLEDGED").length}{" "}
            acknowledged
          </div>
        </div>
        <div className="stat-tile stat-tile--neutral">
          <div className="stat-tile__top">
            <span className="stat-tile__label">锁定账本合计</span>
          </div>
          <div className="stat-tile__value">
            {lockedTotalLabel}
          </div>
          <div className="stat-tile__detail">
            {ledgerEntries.filter((entry) => entry.status === "LOCKED").length}{" "}
            locked entries
          </div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">账本链</span>
          </div>
          <div className="stat-tile__value" style={{ fontSize: 22 }}>
            {ledgerVerify.loading ? (
              "检查中…"
            ) : ledgerVerify.data?.valid ? (
              <Badge tone="success">已验证</Badge>
            ) : (
              <Badge tone="danger">关注</Badge>
            )}
          </div>
          <div className="stat-tile__detail">
            {ledgerEntries.length} 条追加式账本记录
          </div>
        </div>
      </div>

      <Tabs
        items={[
          { id: "batches", label: "批次", count: batchList.length },
          { id: "ledger", label: "账本", count: ledgerEntries.length },
          { id: "budgets", label: "预算", count: poolList.length },
          {
            id: "cash",
            label: "现金与事实",
            count: cashGates.data?.length ?? 0,
          },
          {
            id: "exports",
            label: "导出与调整",
            count: settlementExports.data?.length ?? 0,
          },
        ]}
        active={tab}
        onChange={setTab}
        label="结算视图"
      />

      <div className="tab-panel">
        {tab === "batches" ? (
          <div className="payroll-detail-grid">
            <Panel
              title="结算批次"
              subtitle="选择批次执行资金路径流程"
              action={
                <Button size="sm" variant="primary" icon="plus" onClick={openCreate}>
                  新建批次
                </Button>
              }
              flush
            >
              {batches.error ? (
                <div style={{ padding: 16 }}>
                  <ErrorNotice error={batches.error} onRetry={batches.reload} />
                </div>
              ) : batches.loading ? (
                <div style={{ padding: 16 }}>
                  <LoadingRows rows={4} />
                </div>
              ) : batchList.length === 0 ? (
                <EmptyState
                  icon="wallet"
                  title="暂无结算批次"
                  description="从有锁定账本的周期创建批次。"
                  action={
                    <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                      创建批次
                    </Button>
                  }
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table table-clickable">
                    <thead>
                      <tr>
                        <th>批次</th>
                        <th>状态</th>
                        <th className="cell-num">合计</th>
                        <th className="cell-num">明细行</th>
                        <th>更新时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchList.map((batch) => (
                        <tr
                          key={batch.id}
                          className={selectedBatchId === batch.id ? "is-selected" : ""}
                          {...clickableRowProps(() => setSelectedBatchId(batch.id))}
                        >
                          <td>
                            <span className="cell-primary">{batch.batchNo}</span>
                            <span className="cell-sub">
                              {batch.kind} · {shortId(batch.cycleId)}
                            </span>
                          </td>
                          <td>
                            <Badge status={batch.status} />
                          </td>
                          <td className="cell-num">
                            {formatMoney(batch.totalAmount, batch.currency)}
                          </td>
                          <td className="cell-num">{batch.lineCount}</td>
                          <td className="nowrap">
                            {formatRelative(batch.updatedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <div className="stack">
              {!selectedBatch ? (
                <Panel title="批次详情">
                  <EmptyState
                    icon="layers"
                    title="选择批次…"
                    description="打开批次进行对账、批准、锁定或导出。"
                  />
                </Panel>
              ) : detail.error ? (
                <Panel title="批次详情">
                  <ErrorNotice error={detail.error} onRetry={detail.reload} />
                </Panel>
              ) : detail.loading || !detail.data ? (
                <Panel title="批次详情">
                  <LoadingRows rows={4} />
                </Panel>
              ) : (
                <Panel
                  title={detail.data.batchNo}
                  subtitle={`${detail.data.kind} · ${shortId(detail.data.id)}`}
                  action={<Badge status={detail.data.status} />}
                >
                  <div className="coverage-grid">
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">合计</div>
                      <div className="coverage-cell__value">
                        {formatMoney(detail.data.totalAmount, detail.data.currency)}
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">明细行</div>
                      <div className="coverage-cell__value">
                        {detail.data.lineCount}
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">已导出</div>
                      <div className="coverage-cell__value" style={{ fontSize: 14 }}>
                        {detail.data.exportedAt
                          ? formatRelative(detail.data.exportedAt)
                          : "尚未"}
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">已签收</div>
                      <div className="coverage-cell__value" style={{ fontSize: 14 }}>
                        {detail.data.acknowledgedAt
                          ? formatRelative(detail.data.acknowledgedAt)
                          : "尚未"}
                      </div>
                    </div>
                  </div>

                  <div className="detail-section">
                    <div className="detail-section__title">命令</div>
                    <div className="row-actions" style={{ flexWrap: "wrap" }}>
                      {(COMMANDS_BY_STATUS[detail.data.status] ?? []).map((item) => (
                        <Button
                          key={item.command}
                          size="sm"
                          variant={item.variant ?? "secondary"}
                          onClick={() => openCommand(item.command, detail.data!)}
                        >
                          {item.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="detail-section">
                    <div className="detail-section__title">明细行</div>
                    {(detail.data.lines?.length ?? 0) === 0 ? (
                      <p className="muted">本批次暂无明细。</p>
                    ) : (
                      <div className="table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>人员</th>
                              <th className="cell-num">金额</th>
                              <th>状态</th>
                              <th>账本</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.data.lines?.map((line) => (
                              <tr key={line.id}>
                                <td>
                                  <span className="cell-primary">
                                    {line.personName ??
                                      displayName(line.personId, people)}
                                  </span>
                                  <span className="cell-sub mono">
                                    {line.personCode ?? shortId(line.personId, 10)}
                                  </span>
                                </td>
                                <td className="cell-num">
                                  {formatMoney(line.amount, line.currency)}
                                </td>
                                <td>
                                  <Badge
                                    tone={line.active ? "success" : "neutral"}
                                  >
                                    {line.active ? line.status : "未启用"}
                                  </Badge>
                                </td>
                                <td className="cell-mono">
                                  {shortId(line.ledgerId, 10)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </Panel>
              )}
            </div>
          </div>
        ) : null}

        {tab === "ledger" ? (
          <Panel
            title="账本条目"
            subtitle="追加式；锁定条目不可编辑"
            action={
              <div className="toolbar__group">
                <SearchInput
                  value={ledgerSearch}
                  onChange={setLedgerSearch}
                  placeholder="搜索人员、周期或条目"
                />
                <Select
                  value={ledgerStatus}
                  onChange={(event) => setLedgerStatus(event.target.value)}
                  aria-label="账本状态"
                  style={{ width: 140, height: 34 }}
                >
                  {["ALL", "PROVISIONAL", "APPROVED", "LOCKED", "REVERSED"].map(
                    (status) => (
                      <option key={status} value={status}>
                        {titleCase(status)}
                      </option>
                    ),
                  )}
                </Select>
              </div>
            }
            flush
          >
            {ledger.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={ledger.error} onRetry={ledger.reload} />
              </div>
            ) : ledger.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={5} />
              </div>
            ) : visibleLedger.length === 0 ? (
              <EmptyState
                icon="wallet"
                title="暂无账本条目"
                description="账本条目在计算批次批准并锁定后出现。"
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>条目</th>
                      <th>人员</th>
                      <th>类型</th>
                      <th>状态</th>
                      <th className="cell-num">金额</th>
                      <th>创建时间</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLedger.slice(0, 250).map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <span className="cell-primary mono">
                            {shortId(entry.id, 12)}
                          </span>
                          <span className="cell-sub mono">
                            cycle {shortId(entry.cycleId, 8)}
                          </span>
                        </td>
                        <td>{displayName(entry.personId, people)}</td>
                        <td>{titleCase(entry.entryType)}</td>
                        <td>
                          <Badge status={entry.status} />
                        </td>
                        <td
                          className={`cell-num ${Number(entry.amount) < 0 ? "text-danger" : ""}`}
                        >
                          {formatMoney(entry.amount, entry.currency)}
                        </td>
                        <td className="nowrap">
                          {formatDateTime(entry.createdAt)}
                        </td>
                        <td className="cell-actions">
                          {entry.status === "LOCKED" ? (
                            <div className="row-actions">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openLedgerAction(entry, "adjust")}
                              >
                                调整
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openLedgerAction(entry, "reverse")}
                              >
                                冲销
                              </Button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : null}

        {tab === "budgets" ? (
          <div className="split-grid">
            <Panel
              title="预算池"
              subtitle="已批准资金池供正式计算使用"
              action={
                <Button size="sm" variant="primary" icon="plus" onClick={openPoolCreate}>
                  新建资金池
                </Button>
              }
              flush
            >
              {pools.error ? (
                <div style={{ padding: 16 }}>
                  <ErrorNotice error={pools.error} onRetry={pools.reload} />
                </div>
              ) : pools.loading ? (
                <div style={{ padding: 16 }}>
                  <LoadingRows rows={4} />
                </div>
              ) : poolList.length === 0 ? (
                <EmptyState
                  icon="chart"
                  title="暂无预算池"
                  description="预算正式激励前请先创建并批准资金池。"
                  action={
                    <Button variant="primary" size="sm" icon="plus" onClick={openPoolCreate}>
                      创建资金池
                    </Button>
                  }
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table table-clickable">
                    <thead>
                      <tr>
                        <th>资金池</th>
                        <th>状态</th>
                        <th className="cell-num">已批准</th>
                        <th className="cell-num">已承诺</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {poolList.map((pool) => (
                        <tr
                          key={pool.id}
                          className={selectedPoolId === pool.id ? "is-selected" : ""}
                          onClick={() => setSelectedPoolId(pool.id)}
                        >
                          <td>
                            <span className="cell-primary">{pool.name}</span>
                            <span className="cell-sub">
                              {pool.code} · {pool.poolType}
                            </span>
                          </td>
                          <td>
                            <Badge status={pool.status} />
                          </td>
                          <td className="cell-num">
                            {formatMoney(pool.approvedAmount, pool.currency)}
                          </td>
                          <td className="cell-num">
                            {formatMoney(pool.committedAmount, pool.currency)}
                          </td>
                          <td className="cell-actions">
                            {pool.status !== "APPROVED" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setApprovedBy(session.personId);
                                  setApproveTarget(pool);
                                }}
                              >
                                批准
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

            <Panel
              title={selectedPool ? selectedPool.name : "Pool detail"}
              subtitle={
                selectedPool
                  ? `${selectedPool.code} · ${shortId(selectedPool.cycleId)}`
                  : "Select a pool to inspect allocations"
              }
              action={
                selectedPool ? (
                  <div className="row-actions">
                    <Badge status={selectedPool.status} />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setAllocationOpen(true)}
                    >
                      新建分配
                    </Button>
                  </div>
                ) : null
              }
            >
              {!selectedPool ? (
                <EmptyState
                  icon="chart"
                  title="未选择资金池"
                  description="打开资金池查看已占用分配，必要时释放。"
                />
              ) : (
                <>
                  <div className="coverage-grid">
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">已批准</div>
                      <div className="coverage-cell__value">
                        {formatMoney(
                          selectedPool.approvedAmount,
                          selectedPool.currency,
                        )}
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">已承诺</div>
                      <div className="coverage-cell__value">
                        {formatMoney(
                          selectedPool.committedAmount,
                          selectedPool.currency,
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="detail-section">
                    <div className="detail-section__title">分配</div>
                    {allocations.error ? (
                      <ErrorNotice
                        error={allocations.error}
                        onRetry={allocations.reload}
                      />
                    ) : allocations.loading ? (
                      <LoadingRows rows={3} />
                    ) : (allocations.data?.length ?? 0) === 0 ? (
                      <p className="muted">暂无分配记录。</p>
                    ) : (
                      <div className="stack" style={{ gap: 8 }}>
                        {allocations.data?.map((allocation) => (
                          <div
                            key={allocation.id}
                            className="inline"
                            style={{ justifyContent: "space-between", width: "100%" }}
                          >
                            <span>
                              <strong style={{ fontWeight: 600 }}>
                                {formatMoney(allocation.amount, selectedPool.currency)}
                              </strong>
                              <span className="subtle">
                                {" "}
                                · {allocation.targetType}{" "}
                                {shortId(allocation.targetId, 8)}
                              </span>
                            </span>
                            {allocation.status === "RESERVED" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={allocationBusy === allocation.id}
                                onClick={() => void releaseAllocation(allocation)}
                              >
                                释放
                              </Button>
                            ) : (
                              <Badge tone="neutral">已释放</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </Panel>
          </div>
        ) : tab === "cash" ? (
          <>
            <div className="split-grid">
              <Panel
                title="现金门禁输入"
                subtitle="按周期日期的安全准备金与 13 周预测证据"
                flush
                action={
                  <Button
                    size="sm"
                    variant="primary"
                    icon="plus"
                    onClick={openCashGate}
                  >
                    记录输入
                  </Button>
                }
              >
                {cashGates.error ? (
                  <div style={{ padding: 16 }}>
                    <ErrorNotice
                      error={cashGates.error}
                      onRetry={cashGates.reload}
                    />
                  </div>
                ) : cashGates.loading ? (
                  <div style={{ padding: 16 }}>
                    <LoadingRows rows={3} />
                  </div>
                ) : (cashGates.data?.length ?? 0) === 0 ? (
                  <EmptyState
                    icon="chart"
                    title="暂无现金门禁输入"
                    description="记录周期是否通过现金门禁及其依赖的预测。"
                  />
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>As of</th>
                          <th>准备金</th>
                          <th>预测</th>
                          <th>门禁</th>
                          <th>批准人</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(cashGates.data ?? []).map((input) => (
                          <tr key={input.id}>
                            <td>{input.asOfDate}</td>
                            <td>{input.safetyReserveMonths} months</td>
                            <td className="mono">{input.thirteenWeekForecastRef}</td>
                            <td>
                              <Badge
                                tone={input.passesGate ? "success" : "danger"}
                              >
                                {input.passesGate ? "Pass" : "Fail"}
                              </Badge>
                            </td>
                            <td>{displayName(input.approvedBy, people)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              <Panel
                title="财务事实"
                subtitle="带质量状态与周期的财务事实"
                flush
                action={
                  <Button
                    size="sm"
                    variant="primary"
                    icon="plus"
                    onClick={openFinancialFact}
                  >
                    添加财务事实
                  </Button>
                }
              >
                {financialFacts.error ? (
                  <div style={{ padding: 16 }}>
                    <ErrorNotice
                      error={financialFacts.error}
                      onRetry={financialFacts.reload}
                    />
                  </div>
                ) : financialFacts.loading ? (
                  <div style={{ padding: 16 }}>
                    <LoadingRows rows={3} />
                  </div>
                ) : (financialFacts.data?.length ?? 0) === 0 ? (
                  <EmptyState
                    icon="payroll"
                    title="暂无财务事实"
                    description="财务事实用于预算占用与回款检查。"
                  />
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>事实</th>
                          <th>周期</th>
                          <th>金额</th>
                          <th>质量</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(financialFacts.data ?? []).map((fact) => (
                          <tr key={fact.id}>
                            <td>
                              <span className="cell-primary">{fact.factType}</span>
                              <span className="cell-sub mono">
                                {fact.sourceSystem} · {fact.sourceRecordId}
                              </span>
                            </td>
                            <td className="nowrap">
                              {fact.periodStart ?? "—"} – {fact.periodEnd ?? "—"}
                            </td>
                            <td>
                              {formatMoney(fact.amount, fact.currency)}
                            </td>
                            <td>
                              <Badge status={fact.qualityStatus} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          </>
        ) : (
          <div className="split-grid">
            <Panel
              title="结算导出"
              subtitle="导出文件、哈希与外部回执"
              flush
            >
              {settlementExports.error ? (
                <div style={{ padding: 16 }}>
                  <ErrorNotice
                    error={settlementExports.error}
                    onRetry={settlementExports.reload}
                  />
                </div>
              ) : settlementExports.loading ? (
                <div style={{ padding: 16 }}>
                  <LoadingRows rows={3} />
                </div>
              ) : (settlementExports.data?.length ?? 0) === 0 ? (
                <EmptyState
                  icon="download"
                  title="暂无结算导出"
                  description="锁定批次导出时记录。"
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>导出</th>
                        <th>批次</th>
                        <th>已签收</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(settlementExports.data ?? []).map((record) => (
                        <tr key={record.id}>
                          <td>
                            <span className="cell-primary mono">
                              {record.exportRef}
                            </span>
                            <span className="cell-sub mono">
                              {record.exportHash}
                            </span>
                          </td>
                          <td className="mono">{shortId(record.batchId, 10)}</td>
                          <td>
                            {record.acknowledgedAt
                              ? `${formatDateTime(record.acknowledgedAt)} · ${record.acknowledgementRef ?? ""}`
                              : "待处理"}
                          </td>
                          <td className="cell-actions">
                            {record.acknowledgedAt ? null : (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setAckTarget(record);
                                  setAckReference("");
                                  setAckError(null);
                                }}
                              >
                                签收
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel
              title="账本调整"
              subtitle="原条目 → 调整条目对，附审批证据"
              flush
            >
              {adjustmentRecords.error ? (
                <div style={{ padding: 16 }}>
                  <ErrorNotice
                    error={adjustmentRecords.error}
                    onRetry={adjustmentRecords.reload}
                  />
                </div>
              ) : adjustmentRecords.loading ? (
                <div style={{ padding: 16 }}>
                  <LoadingRows rows={3} />
                </div>
              ) : (adjustmentRecords.data?.length ?? 0) === 0 ? (
                <EmptyState
                  icon="clock"
                  title="暂无调整"
                  description="调整以追加更正条目实现；原账本行永不被修改。"
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>原值</th>
                        <th>调整</th>
                        <th>原因</th>
                        <th>已批准</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(adjustmentRecords.data ?? []).map((record) => (
                        <tr key={record.id}>
                          <td className="mono">
                            {shortId(record.originalLedgerId, 10)}
                          </td>
                          <td className="mono">
                            {shortId(record.adjustmentLedgerId, 10)}
                          </td>
                          <td>
                            {record.reasonCode}
                            <span className="cell-sub">
                              {record.explanation}
                            </span>
                          </td>
                          <td className="nowrap">
                            {formatDateTime(record.approvedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        )}
      </div>

      <Modal
        open={createOpen}
        title="新建结算批次"
        description="批次归集周期的锁定账本条目。"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-batch-form"
              loading={submitting}
            >
              创建批次
            </Button>
          </>
        }
      >
        <form id="create-batch-form" onSubmit={createBatch} className="form-grid">
          {formError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{formError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="周期" htmlFor="batch-cycle" className="field--full">
            <Select
              id="batch-cycle"
              value={cycleId}
              onChange={(event) => setCycleId(event.target.value)}
              required
            >
              <option value="">Select a cycle…</option>
              {(cycles.data ?? []).map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.name} · {cycle.status}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Kind" htmlFor="batch-kind">
            <Select
              id="batch-kind"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as "STANDARD" | "RECOVERY")
              }
            >
              <option value="STANDARD">标准</option>
              <option value="RECOVERY">追回</option>
            </Select>
          </FormField>
          <FormField label="币种" htmlFor="batch-currency">
            <TextInput
              id="batch-currency"
              value={currency}
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
          </FormField>
          <FormField
            label="批次号（可选）"
            htmlFor="batch-number"
            className="field--full"
            hint="留空使用自动生成编号。"
          >
            <TextInput
              id="batch-number"
              value={batchNo}
              onChange={(event) => setBatchNo(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(commandTarget)}
        title={
          commandTarget ? COMMAND_COPY[commandTarget.command].title : "命令"
        }
        description={
          commandTarget ? COMMAND_COPY[commandTarget.command].description : undefined
        }
        onClose={() => setCommandTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCommandTarget(null)}>
              取消
            </Button>
            <Button
              variant={
                commandTarget &&
                ["CANCEL", "REQUIRE_ADJUSTMENT"].includes(commandTarget.command)
                  ? "danger"
                  : "primary"
              }
              onClick={executeCommand}
              loading={submitting}
            >
              Confirm {commandTarget ? titleCase(commandTarget.command) : ""}
            </Button>
          </>
        }
      >
        {commandTarget ? (
          <div className="stack">
            {commandError ? (
              <InfoNotice tone="warning">{commandError}</InfoNotice>
            ) : null}
            <DefinitionList
              items={[
                { label: "批次", value: commandTarget.batch.batchNo },
                {
                  label: "合计",
                  value: formatMoney(
                    commandTarget.batch.totalAmount,
                    commandTarget.batch.currency,
                  ),
                },
                {
                  label: "状态",
                  value: <Badge status={commandTarget.batch.status} />,
                },
              ]}
            />
            {commandTarget.command === "ACKNOWLEDGE" ? (
              <FormField
                label="外部引用"
                htmlFor="command-reference"
                hint="银行或支付渠道回执。"
              >
                <TextInput
                  id="command-reference"
                  value={externalReference}
                  onChange={(event) => setExternalReference(event.target.value)}
                  required
                />
              </FormField>
            ) : null}
            {["REQUIRE_ADJUSTMENT", "CANCEL"].includes(
              commandTarget.command,
            ) ? (
              <FormField
                label={
                  commandTarget.command === "REQUIRE_ADJUSTMENT"
                    ? "原因（必填）"
                    : "原因（可选）"
                }
                htmlFor="command-reason"
              >
                <Textarea
                  id="command-reason"
                  value={commandReason}
                  onChange={(event) => setCommandReason(event.target.value)}
                />
              </FormField>
            ) : null}
            {["APPROVE", "LOCK"].includes(commandTarget.command) ? (
              <FormField
                label="审批请求 ID（可选）"
                htmlFor="command-approval"
                hint="仅当该动作配置为需审批时必填。"
              >
                <TextInput
                  id="command-approval"
                  value={approvalRequestId}
                  onChange={(event) => setApprovalRequestId(event.target.value)}
                />
              </FormField>
            ) : null}
            {commandTarget.command !== "RECONCILE" ? (
              <FormField label="操作人" htmlFor="command-actor">
                <PersonSelect
                  id="command-actor"
                  value={actorPersonId}
                  onChange={setActorPersonId}
                />
              </FormField>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={poolCreateOpen}
        title="新建资金池"
        description="资金池批准后才可用于正式计算。"
        onClose={() => setPoolCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPoolCreateOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-pool-form"
              loading={submitting}
            >
              创建资金池
            </Button>
          </>
        }
      >
        <form id="create-pool-form" onSubmit={createPool} className="form-grid">
          {poolError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{poolError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="周期" htmlFor="pool-cycle" className="field--full">
            <Select
              id="pool-cycle"
              value={poolCycleId}
              onChange={(event) => setPoolCycleId(event.target.value)}
              required
            >
              <option value="">Select a cycle…</option>
              {(cycles.data ?? []).map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.name} · {cycle.status}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="编码" htmlFor="pool-code">
            <TextInput
              id="pool-code"
              value={poolCode}
              onChange={(event) => setPoolCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="名称" htmlFor="pool-name">
            <TextInput
              id="pool-name"
              value={poolName}
              onChange={(event) => setPoolName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="资金池类型" htmlFor="pool-type">
            <TextInput
              id="pool-type"
              value={poolType}
              onChange={(event) => setPoolType(event.target.value)}
              required
            />
          </FormField>
          <FormField label="币种" htmlFor="pool-currency">
            <TextInput
              id="pool-currency"
              value={poolCurrency}
              maxLength={3}
              onChange={(event) => setPoolCurrency(event.target.value.toUpperCase())}
              required
            />
          </FormField>
          <FormField label="批准金额" htmlFor="pool-amount" className="field--full">
            <TextInput
              id="pool-amount"
              type="number"
              min="0"
              step="0.01"
              value={poolAmount}
              onChange={(event) => setPoolAmount(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(approveTarget)}
        title="批准资金池"
        description="批准后资金池可用于正式计算。"
        onClose={() => setApproveTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setApproveTarget(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={approvePool} loading={submitting}>
              批准资金池
            </Button>
          </>
        }
      >
        {approveTarget ? (
          <div className="stack">
            <DefinitionList
              items={[
                { label: "资金池", value: approveTarget.name },
                { label: "编码", value: approveTarget.code },
                {
                  label: "金额",
                  value: formatMoney(
                    approveTarget.approvedAmount,
                    approveTarget.currency,
                  ),
                },
              ]}
            />
            <FormField label="批准人" htmlFor="pool-approver">
              <PersonSelect
                id="pool-approver"
                value={approvedBy}
                onChange={setApprovedBy}
              />
            </FormField>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={cashOpen}
        title="记录现金门禁"
        description="现金门禁是周期足以支付已批激励的证据。"
        onClose={() => setCashOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCashOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={submitCashGate}>
              记录
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {cashError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{cashError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="周期" htmlFor="cash-cycle">
            <Select
              id="cash-cycle"
              value={cashCycleId}
              onChange={(event) => setCashCycleId(event.target.value)}
              required
            >
              <option value="">选择周期…</option>
              {(cycles.data ?? []).map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="As of date" htmlFor="cash-date">
            <TextInput
              id="cash-date"
              type="date"
              value={cashAsOfDate}
              onChange={(event) => setCashAsOfDate(event.target.value)}
              required
            />
          </FormField>
          <FormField label="安全准备金（月）" htmlFor="cash-reserve">
            <TextInput
              id="cash-reserve"
              value={cashReserveMonths}
              onChange={(event) => setCashReserveMonths(event.target.value)}
              required
            />
          </FormField>
          <FormField label="13 周预测引用" htmlFor="cash-forecast">
            <TextInput
              id="cash-forecast"
              value={cashForecastRef}
              onChange={(event) => setCashForecastRef(event.target.value)}
              required
            />
          </FormField>
          <label className="checkbox field--full">
            <input
              type="checkbox"
              checked={cashPassesGate}
              onChange={(event) => setCashPassesGate(event.target.checked)}
            />
            <span>周期通过现金门禁。</span>
          </label>
          <FormField label="批准人" htmlFor="cash-approver">
            <PersonSelect
              id="cash-approver"
              value={cashApprovedBy}
              onChange={setCashApprovedBy}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={factOpen}
        title="添加财务事实"
        description="财务事实按来源系统与记录 ID 唯一。"
        onClose={() => setFactOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFactOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={submitFinancialFact}>
              添加财务事实
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {factError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{factError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="来源系统" htmlFor="fact-source">
            <TextInput
              id="fact-source"
              value={factSourceSystem}
              onChange={(event) => setFactSourceSystem(event.target.value)}
              required
            />
          </FormField>
          <FormField label="来源记录 ID" htmlFor="fact-record">
            <TextInput
              id="fact-record"
              value={factSourceRecordId}
              onChange={(event) => setFactSourceRecordId(event.target.value)}
              required
            />
          </FormField>
          <FormField label="事实类型" htmlFor="fact-type">
            <TextInput
              id="fact-type"
              value={factType}
              onChange={(event) => setFactType(event.target.value)}
              placeholder="CASH_COLLECTED"
              required
            />
          </FormField>
          <FormField label="金额" htmlFor="fact-amount">
            <TextInput
              id="fact-amount"
              value={factAmount}
              onChange={(event) => setFactAmount(event.target.value)}
              required
            />
          </FormField>
          <FormField label="币种" htmlFor="fact-currency">
            <TextInput
              id="fact-currency"
              value={factCurrency}
              maxLength={3}
              onChange={(event) =>
                setFactCurrency(event.target.value.toUpperCase())
              }
              required
            />
          </FormField>
          <FormField label="质量" htmlFor="fact-quality">
            <Select
              id="fact-quality"
              value={factQuality}
              onChange={(event) => setFactQuality(event.target.value)}
            >
              {[
                "VALID",
                "MISSING",
                "STALE",
                "CONFLICTED",
                "UNVERIFIED",
                "INVALID",
              ].map((status) => (
                <option key={status} value={status}>
                  {titleCase(status)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="周期开始（可选）" htmlFor="fact-start">
            <TextInput
              id="fact-start"
              type="date"
              value={factPeriodStart}
              onChange={(event) => setFactPeriodStart(event.target.value)}
            />
          </FormField>
          <FormField label="周期结束（可选）" htmlFor="fact-end">
            <TextInput
              id="fact-end"
              type="date"
              value={factPeriodEnd}
              onChange={(event) => setFactPeriodEnd(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={Boolean(ackTarget)}
        title="确认结算导出"
        description={ackTarget?.exportRef}
        onClose={() => setAckTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAckTarget(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={acknowledgeExport}>
              签收
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {ackError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{ackError}</InfoNotice>
            </div>
          ) : null}
          <FormField
            label="外部引用"
            htmlFor="ack-reference"
            className="field--full"
            hint="本次导出的银行/财务回执引用。"
          >
            <TextInput
              id="ack-reference"
              value={ackReference}
              onChange={(event) => setAckReference(event.target.value)}
              required
            />
          </FormField>
        </div>
      </Modal>

      {/* 新建预算分配 */}
      <Modal
        open={allocationOpen}
        title="新建预算分配"
        onClose={() => setAllocationOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAllocationOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="allocation-form">
              占用额度
            </Button>
          </>
        }
      >
        <form id="allocation-form" onSubmit={createAllocation} className="form-grid">
          {allocationError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{allocationError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="目标类型">
            <Select
              value={allocationTargetType}
              onChange={(event) => setAllocationTargetType(event.target.value)}
            >
              <option value="CALCULATION_RUN">计算批次</option>
              <option value="SETTLEMENT_BATCH">结算批次</option>
              <option value="STRATEGIC_POOL_CASE">战略池案例</option>
            </Select>
          </FormField>
          <FormField label="目标 ID">
            <TextInput
              value={allocationTargetId}
              onChange={(event) => setAllocationTargetId(event.target.value)}
              required
            />
          </FormField>
          <FormField label="分配金额">
            <TextInput
              value={allocationAmount}
              onChange={(event) => setAllocationAmount(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      {/* 账本调整 / 冲销 */}
      <Modal
        open={Boolean(ledgerTarget)}
        title={ledgerAction === "adjust" ? "账本调整" : "账本冲销"}
        onClose={() => setLedgerTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLedgerTarget(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="ledger-action-form">
              提交
            </Button>
          </>
        }
      >
        <form id="ledger-action-form" onSubmit={submitLedgerAction} className="form-grid">
          {ledgerError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{ledgerError}</InfoNotice>
            </div>
          ) : null}
          <div className="field--full muted">
            原账本条目 {shortId(ledgerTarget?.id ?? "", 12)} · 锁定后不可修改，只能追加调整/冲销。
          </div>
          {ledgerAction === "adjust" ? (
            <>
              <FormField label="调整金额" hint="正数补发、负数扣回">
                <TextInput
                  value={ledgerAmount}
                  onChange={(event) => setLedgerAmount(event.target.value)}
                  required
                />
              </FormField>
              <FormField label="原因代码">
                <TextInput
                  value={ledgerReasonCode}
                  onChange={(event) => setLedgerReasonCode(event.target.value)}
                  required
                />
              </FormField>
            </>
          ) : null}
          <FormField label="说明" className="field--full">
            <TextInput
              value={ledgerExplanation}
              onChange={(event) => setLedgerExplanation(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>
    </>
  );
}
