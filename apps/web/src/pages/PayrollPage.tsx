import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
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
  Tabs,
  TextInput,
  Textarea,
} from "../components/ui.js";
import { PersonSelect, usePeople } from "../components/PersonSelect.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api, downloadFile } from "../lib/api.js";
import { useApiQuery, useDocumentTitle, useTenantModules } from "../lib/hooks.js";
import {
  displayName,
  formatDate,
  formatMoney,
  formatPercent,
  formatRelative,
  monthBounds,
  shortId,
  titleCase,
  toIsoDate,
  toNumber,
} from "../lib/format.js";
import type {
  CnIitResult,
  EmploymentContract,
  EvaluationCycle,
  PayrollRun,
} from "../lib/types.js";
import type { ESignEnvelopeView } from "../lib/ops-types.js";

const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACTOR"] as const;

type RunAction = "calculate" | "approve" | "pay" | "reverse" | "cancel";

const ACTION_COPY: Record<
  RunAction,
  { title: string; description: string; confirm: string; danger?: boolean }
> = {
  calculate: {
    title: "计算薪酬批次",
    description:
      "从生效合同与锁定账本重新计算；本批次已有明细会被替换。",
    confirm: "计算批次",
  },
  approve: {
    title: "批准薪酬批次",
    description:
      "批准会锁定计算结果；编制人不能批准自己的批次。",
    confirm: "批准批次",
  },
  pay: {
    title: "标记工资已发放",
    description:
      "银行代发执行后再标记已支付；之后仍可冲销。",
    confirm: "标记已支付",
    danger: true,
  },
  reverse: {
    title: "冲销工资批次",
    description:
      "冲销是追加式更正，原因会保留在批次上。",
    confirm: "冲销批次",
    danger: true,
  },
  cancel: {
    title: "取消薪酬批次",
    description:
      "仅未批准批次可取消；已支付批次请冲销。",
    confirm: "取消批次",
    danger: true,
  },
};

export function PayrollPage() {
  useDocumentTitle("薪酬");
  // AUD-017：薪酬（含个税）为扩展域——capability 在 hooks 全部执行后判定
  // （early-return 不能放在其它 hooks 之前，否则数据到达时 hooks 顺序变化）。
  const { modules: enabledModules } = useTenantModules();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "runs";
  const setTab = (next: string) => {
    if (next === "runs") setSearchParams({}, { replace: true });
    else setSearchParams({ tab: next }, { replace: true });
  };
  const runs = useApiQuery<PayrollRun[]>("/api/v1/payroll-runs");
  const contracts = useApiQuery<EmploymentContract[]>(
    "/api/v1/employment-contracts",
  );
  const cycles = useApiQuery<EvaluationCycle[]>("/api/v1/evaluation-cycles");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const runList = runs.data ?? [];
  const contractList = contracts.data ?? [];

  if (!enabledModules.has("PAYROLL")) {
    return (
      <>
        <PageHeader
          eyebrow="激励"
          title="薪酬发放"
          description="本租户未启用薪酬模块（D-04：P0 默认不含扩展域）。"
        />
        <InfoNotice tone="warning">
          功能未启用（FEATURE_DISABLED）：请联系平台管理员开启 PAYROLL 模块；
          接口层同步返回 403 FEATURE_DISABLED。
        </InfoNotice>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="激励结算"
        title="薪酬发放"
        description="已申报合同、最低工资门禁、个税代扣与银行代发结算——内置中国法定个税计算器。"
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => {
              runs.reload();
              contracts.reload();
            }}
            loading={runs.loading || contracts.loading}
          >
            刷新
          </Button>
        }
      />

      <Tabs
        items={[
          { id: "runs", label: "薪酬批次", count: runList.length },
          { id: "contracts", label: "合同", count: contractList.length },
          { id: "tax", label: "个税工作台" },
          { id: "statutory", label: "法定扣款类型" },
        ]}
        active={tab}
        onChange={setTab}
        label="薪酬视图"
      />

      <div className="tab-panel">
        {tab === "runs" ? (
          <RunsTab
            runs={runList}
            loading={runs.loading}
            error={runs.error instanceof Error ? runs.error : undefined}
            reload={runs.reload}
            cycles={cycles.data ?? []}
            selectedRunId={selectedRunId}
            onSelect={setSelectedRunId}
          />
        ) : null}
        {tab === "contracts" ? (
          <ContractsTab
            contracts={contractList}
            loading={contracts.loading}
            error={contracts.error instanceof Error ? contracts.error : undefined}
            reload={contracts.reload}
          />
        ) : null}
        {tab === "tax" ? <TaxStudio /> : null}
        {tab === "statutory" ? <StatutoryDeductionStudio /> : null}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- runs tab */

function RunsTab({
  runs,
  loading,
  error,
  reload,
  cycles,
  selectedRunId,
  onSelect,
}: {
  runs: PayrollRun[];
  loading: boolean;
  error: Error | undefined;
  reload: () => void;
  cycles: EvaluationCycle[];
  selectedRunId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { session } = useAuth();
  const toast = useToast();
  const bounds = monthBounds();
  const [createOpen, setCreateOpen] = useState(false);
  const [cycleId, setCycleId] = useState(cycles[0]?.id ?? "");
  const [manualCycle, setManualCycle] = useState(cycles.length === 0);
  const [periodStart, setPeriodStart] = useState(bounds.startInput);
  const [periodEnd, setPeriodEnd] = useState(bounds.endInput);
  const [currency, setCurrency] = useState("CNY");
  const [preparedBy, setPreparedBy] = useState(session.personId);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    kind: RunAction;
    run: PayrollRun;
  } | null>(null);
  const [approvedBy, setApprovedBy] = useState(session.personId);
  const [reversedBy, setReversedBy] = useState(session.personId);
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const detail = useApiQuery<PayrollRun>(
    selectedRunId ? `/api/v1/payroll-runs/${selectedRunId}` : null,
    selectedRunId,
  );
  const { people } = usePeople();

  const selected = detail.data;

  function openCreate() {
    setCycleId(cycles[0]?.id ?? "");
    setManualCycle(cycles.length === 0);
    setPeriodStart(bounds.startInput);
    setPeriodEnd(bounds.endInput);
    setCurrency("CNY");
    setPreparedBy(session.personId);
    setFormError(null);
    setCreateOpen(true);
  }

  async function createRun(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!cycleId.trim()) {
      setFormError("必须选择考核周期；请先创建。");
      return;
    }
    setSubmitting(true);
    try {
      const created = await api<PayrollRun>("/api/v1/payroll-runs", {
        method: "POST",
        body: {
          cycleId: cycleId.trim(),
          periodStart: toIsoDate(periodStart),
          periodEnd: toIsoDate(periodEnd),
          currency: currency.toUpperCase(),
          preparedBy,
        },
      });
      toast.success("工资批次草稿已创建", shortId(created.id));
      setCreateOpen(false);
      onSelect(created.id);
      reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "创建批次失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function openAction(kind: RunAction, run: PayrollRun) {
    setPendingAction({ kind, run });
    setApprovedBy(session.personId);
    setReversedBy(session.personId);
    setActionReason("");
    setActionError(null);
  }

  async function executeAction() {
    if (!pendingAction) return;
    const { kind, run } = pendingAction;
    if (kind === "reverse" && !actionReason.trim()) {
      setActionError("必须填写冲销原因。");
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      const bodies: Record<RunAction, unknown> = {
        calculate: undefined,
        approve: { approvedBy },
        pay: undefined,
        reverse: { reason: actionReason.trim(), reversedBy },
        cancel: undefined,
      };
      const result = await api<PayrollRun>(
        `/api/v1/payroll-runs/${run.id}/${kind}`,
        {
          method: "POST",
          body: bodies[kind],
        },
      );
      toast.success(
        `${ACTION_COPY[kind].confirm} complete`,
        kind === "calculate" && result.blockedCount > 0
          ? `${result.blockedCount} line${result.blockedCount === 1 ? "" : "s"} blocked by the minimum-wage gate`
          : `${shortId(run.id)} · ${result.status}`,
      );
      setPendingAction(null);
      reload();
      detail.reload();
    } catch (caught) {
      setActionError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "操作失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function exportRun(
    run: PayrollRun,
    kind: "export" | "bank-file" | "tax-filing",
    bankFormat: "" | "ICBC" | "CMB" = "",
  ): Promise<void> {
    const key = `${run.id}:${kind}${bankFormat}`;
    setDownloading(key);
    const query =
      kind === "bank-file" && bankFormat ? `?format=${bankFormat}` : "";
    try {
      await downloadFile(
        `/api/v1/payroll-runs/${run.id}/${kind}${query}`,
        kind === "export"
          ? `payroll-${shortId(run.id, 12)}.csv`
          : kind === "tax-filing"
            ? `payroll-tax-filing-${shortId(run.id, 12)}.csv`
            : `payroll-bank-${shortId(run.id, 12)}${bankFormat ? `-${bankFormat.toLowerCase()}` : ""}.csv`,
      );
    } catch (caught) {
      toast.error(
        "导出失败",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setDownloading(null);
    }
  }

  async function downloadPayslip(runId: string, personId: string) {
    setDownloading(`payslip:${personId}`);
    try {
      await downloadFile(
        `/api/v1/payroll-runs/${runId}/payslips/${personId}`,
        `payslip-${shortId(personId, 10)}.html`,
      );
    } catch (caught) {
      toast.error(
        "工资单下载失败",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setDownloading(null);
    }
  }

  return (
    <>
      <div className="payroll-detail-grid">
        <Panel
          title="薪酬批次"
          subtitle="草稿 → 已计算 → 已批准 → 已支付；被阻断的批次需先整改。"
          action={
            <Button size="sm" variant="primary" icon="plus" onClick={openCreate}>
              新建计算
            </Button>
          }
          flush
        >
          {error ? (
            <div style={{ padding: 16 }}>
              <ErrorNotice error={error} onRetry={reload} />
            </div>
          ) : loading ? (
            <div style={{ padding: 16 }}>
              <LoadingRows rows={5} />
            </div>
          ) : runs.length === 0 ? (
            <EmptyState
              icon="wallet"
              title="暂无薪酬批次"
              description="先创建草稿批次，再基于生效合同与锁定账本计算。"
              action={
                <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                  创建首个批次
                </Button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table table-clickable">
                <thead>
                  <tr>
                    <th>周期</th>
                    <th>状态</th>
                    <th className="cell-num">税前</th>
                    <th className="cell-num">税后</th>
                    <th>更新时间</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {runs
                    .slice()
                    .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
                    .map((run) => (
                      <tr
                        key={run.id}
                        className={selectedRunId === run.id ? "is-selected" : ""}
                        onClick={() => onSelect(run.id)}
                      >
                        <td>
                          <span className="cell-primary nowrap">
                            {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
                          </span>
                          <span className="cell-sub">
                            {run.currency} · {shortId(run.id)}
                          </span>
                        </td>
                        <td>
                          <Badge status={run.status} />
                          {run.blockedCount > 0 ? (
                            <span className="cell-sub text-danger">
                              {run.blockedCount} blocked
                            </span>
                          ) : null}
                        </td>
                        <td className="cell-num">
                          {formatMoney(run.totalGross, run.currency)}
                        </td>
                        <td className="cell-num">
                          {formatMoney(run.totalNet, run.currency)}
                        </td>
                        <td className="muted nowrap">{formatRelative(run.updatedAt)}</td>
                        <td className="cell-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelect(run.id);
                            }}
                          >
                            待处理
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="stack">
          {!selectedRunId ? (
            <Panel title="批次明细">
              <EmptyState
                icon="approvals"
                title="选择批次…"
                description="打开薪酬批次查看明细、执行流转并导出结算文件。"
              />
            </Panel>
          ) : detail.error ? (
            <Panel title="批次明细">
              <ErrorNotice error={detail.error} onRetry={detail.reload} />
            </Panel>
          ) : detail.loading || !selected ? (
            <Panel title="批次明细">
              <LoadingRows rows={4} />
            </Panel>
          ) : (
            <>
              <Panel
                title="批次明细"
                subtitle={`${formatDate(selected.periodStart)} – ${formatDate(selected.periodEnd)} · ${shortId(selected.id)}`}
                action={<Badge status={selected.status} />}
              >
                <div className="coverage-grid">
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">税前</div>
                    <div className="coverage-cell__value">
                      {formatMoney(selected.totalGross, selected.currency)}
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">税后</div>
                    <div className="coverage-cell__value">
                      {formatMoney(selected.totalNet, selected.currency)}
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">代扣</div>
                    <div className="coverage-cell__value">
                      {formatMoney(selected.totalTax, selected.currency)}
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">社保</div>
                    <div className="coverage-cell__value">
                      {formatMoney(
                        selected.totalSocialInsurance,
                        selected.currency,
                      )}
                    </div>
                  </div>
                </div>

                <DefinitionList
                  items={[
                    {
                      label: "编制人",
                      value: displayName(selected.preparedBy, people),
                    },
                    {
                      label: "批准人",
                      value: selected.approvedBy
                        ? displayName(selected.approvedBy, people)
                        : "—",
                    },
                    {
                      label: "被阻断明细",
                      value:
                        selected.blockedCount > 0 ? (
                          <span className="text-danger">
                            {selected.blockedCount} below minimum wage
                          </span>
                        ) : (
                          "0"
                        ),
                    },
                    selected.reversalReason
                      ? {
                          label: "冲销原因",
                          value: selected.reversalReason,
                        }
                      : { label: "版本", value: `v${selected.version}` },
                  ]}
                />

                <div className="detail-section">
                  <div className="detail-section__title">工作流</div>
                  <div className="row-actions" style={{ flexWrap: "wrap" }}>
                    {["DRAFT", "CALCULATED", "BLOCKED"].includes(selected.status) ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="play"
                        onClick={() => openAction("calculate", selected)}
                      >
                        计算
                      </Button>
                    ) : null}
                    {selected.status === "CALCULATED" ? (
                      <Button
                        size="sm"
                        variant="primary"
                        icon="check"
                        onClick={() => openAction("approve", selected)}
                      >
                        批准
                      </Button>
                    ) : null}
                    {selected.status === "APPROVED" ? (
                      <Button
                        size="sm"
                        variant="primary"
                        icon="wallet"
                        onClick={() => openAction("pay", selected)}
                      >
                        标记已支付
                      </Button>
                    ) : null}
                    {["APPROVED", "PAID"].includes(selected.status) ? (
                      <Button
                        size="sm"
                        variant="danger"
                        icon="undo"
                        onClick={() => openAction("reverse", selected)}
                      >
                        冲销
                      </Button>
                    ) : null}
                    {!["PAID", "REVERSED", "CANCELLED"].includes(selected.status) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openAction("cancel", selected)}
                      >
                        取消
                      </Button>
                    ) : null}
                  </div>
                  {selected.status === "CALCULATED" &&
                  selected.preparedBy === session.personId ? (
                    <InfoNotice tone="warning">
                      You prepared this run. Separation of duties blocks you from
                      approving it — choose a different approver.
                    </InfoNotice>
                  ) : null}
                </div>

                <div className="detail-section">
                  <div className="detail-section__title">导出</div>
                  <div className="row-actions" style={{ flexWrap: "wrap" }}>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="download"
                      loading={downloading === `${selected.id}:export`}
                      onClick={() => void exportRun(selected, "export")}
                    >
                      薪酬 CSV
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="download"
                      loading={downloading === `${selected.id}:bank-file`}
                      onClick={() => void exportRun(selected, "bank-file")}
                    >
                      银行代发文件
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="download"
                      loading={downloading === `${selected.id}:bank-fileICBC`}
                      onClick={() => void exportRun(selected, "bank-file", "ICBC")}
                    >
                      银行 · 工行
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="download"
                      loading={downloading === `${selected.id}:bank-fileCMB`}
                      onClick={() => void exportRun(selected, "bank-file", "CMB")}
                    >
                      银行 · 招行
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="download"
                      loading={downloading === `${selected.id}:tax-filing`}
                      onClick={() => void exportRun(selected, "tax-filing")}
                    >
                      个税申报 CSV
                    </Button>
                  </div>
                </div>
              </Panel>

              <Panel
                title="明细行"
                subtitle={`${selected.lines?.length ?? 0} employee lines`}
                flush
              >
                {(selected.lines?.length ?? 0) === 0 ? (
                  <EmptyState
                    icon="layers"
                    title="尚未计算明细"
                    description="运行计算，把生效合同与锁定账本纳入本期。"
                    action={
                      <Button
                        size="sm"
                        variant="primary"
                        icon="play"
                        onClick={() => openAction("calculate", selected)}
                      >
                        立即计算
                      </Button>
                    }
                  />
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>人员</th>
                          <th className="cell-num">税前</th>
                          <th className="cell-num">个税</th>
                          <th className="cell-num">税后</th>
                          <th>门禁</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {selected.lines?.map((line) => (
                          <tr key={line.id}>
                            <td>
                              <span className="cell-primary">
                                {displayName(line.personId, people)}
                              </span>
                              <span className="cell-sub mono">
                                {shortId(line.personId, 12)}
                              </span>
                            </td>
                            <td className="cell-num">
                              {line.redactedFields?.includes("grossAmount")
                                ? "已脱敏"
                                : formatMoney(line.grossAmount, line.currency)}
                            </td>
                            <td className="cell-num">
                              {line.redactedFields?.includes("taxAmount")
                                ? "已脱敏"
                                : formatMoney(line.taxAmount, line.currency)}
                            </td>
                            <td className="cell-num">
                              {line.redactedFields?.includes("netAmount")
                                ? "已脱敏"
                                : formatMoney(line.netAmount, line.currency)}
                            </td>
                            <td>
                              <div className="stack" style={{ gap: 4 }}>
                                {line.redactedFields &&
                                line.redactedFields.length > 0 ? (
                                  <Badge tone="neutral">
                                    Redacted: {line.redactedFields.join(", ")}
                                  </Badge>
                                ) : null}
                                <Badge
                                  tone={line.minimumWagePassed ? "success" : "danger"}
                                >
                                  {line.minimumWagePassed
                                    ? "最低工资"
                                    : "低于最低工资"}
                                </Badge>
                                <Badge
                                  tone={line.deductionCapPassed ? "success" : "danger"}
                                >
                                  {line.deductionCapPassed
                                    ? "扣款上限内"
                                    : "超出扣款上限"}
                                </Badge>
                                <Badge
                                  tone={line.variableSharePassed ? "success" : "danger"}
                                >
                                  {line.variableSharePassed
                                    ? "浮动占比在上限内"
                                    : "浮动占比超限"}
                                </Badge>
                                <Badge
                                  tone={
                                    line.noticeAcknowledgementPassed
                                      ? "success"
                                      : "danger"
                                  }
                                >
                                  {line.noticeAcknowledgementPassed
                                    ? "通知已确认"
                                    : `未确认通知：${
                                        line.noticeAcknowledgementMissing
                                          .length
                                      }`}
                                </Badge>
                                {line.deductionBreakdown.length > 0 ? (
                                  <span className="cell-sub">
                                    {line.deductionBreakdown
                                      .map(
                                        (item) =>
                                          `${titleCase(item.type)} ${formatMoney(
                                            item.amount,
                                            line.currency,
                                          )}`,
                                      )
                                      .join(" · ")}
                                  </span>
                                ) : null}
                                {line.deductionTypeCapPassed ? null : (
                                  <Badge tone="danger">
                                    类型上限：{" "}
                                    {line.deductionTypeCapBreaches.join(", ")}
                                  </Badge>
                                )}
                                {line.smoothingPassed ? null : (
                                  <Badge tone="warning">
                                    平滑调整：{" "}
                                    {formatPercent(
                                      toNumber(line.incentiveChangeRate),
                                      0,
                                    )}{" "}
                                    变动
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="cell-actions">
                              <Button
                                size="sm"
                                variant="ghost"
                                icon="download"
                                loading={downloading === `payslip:${line.personId}`}
                                onClick={() =>
                                  void downloadPayslip(selected.id, line.personId)
                                }
                              >
                                工资条
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </>
          )}
        </div>
      </div>

      <Modal
        open={createOpen}
        title="新建薪酬批次"
        description="草稿即一个结算周期；计算是独立的受门禁步骤。"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-run-form"
              loading={submitting}
            >
              创建草稿批次
            </Button>
          </>
        }
      >
        <form id="create-run-form" onSubmit={createRun} className="form-grid">
          {formError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{formError}</InfoNotice>
            </div>
          ) : null}
          <FormField
            label="考核周期"
            htmlFor="run-cycle"
            hint={
              cycles.length === 0
                ? "尚无考核周期，请粘贴已有周期 UUID。"
                : "将结算关联到考核周期。"
            }
            className="field--full"
          >
            {cycles.length > 0 && !manualCycle ? (
              <Select
                id="run-cycle"
                value={cycleId}
                onChange={(event) => {
                  if (event.target.value === "__manual__") {
                    setManualCycle(true);
                    setCycleId("");
                  } else {
                    setCycleId(event.target.value);
                  }
                }}
              >
                {cycles.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.name} · {cycle.status}
                  </option>
                ))}
                <option value="__manual__">Enter a cycle UUID…</option>
              </Select>
            ) : (
              <TextInput
                id="run-cycle"
                value={cycleId}
                onChange={(event) => setCycleId(event.target.value)}
                placeholder="00000000-0000-4000-8000-000000000000"
                required
              />
            )}
          </FormField>
          <FormField label="周期开始" htmlFor="run-start">
            <TextInput
              id="run-start"
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              required
            />
          </FormField>
          <FormField label="周期结束" htmlFor="run-end">
            <TextInput
              id="run-end"
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
              required
            />
          </FormField>
          <FormField label="币种" htmlFor="run-currency">
            <TextInput
              id="run-currency"
              value={currency}
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              required
            />
          </FormField>
          <FormField
            label="编制人"
            htmlFor="run-preparer"
            hint="编制人不能批准本批次。"
          >
            <PersonSelect
              id="run-preparer"
              value={preparedBy}
              onChange={setPreparedBy}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(pendingAction)}
        title={pendingAction ? ACTION_COPY[pendingAction.kind].title : ""}
        description={
          pendingAction ? ACTION_COPY[pendingAction.kind].description : undefined
        }
        onClose={() => setPendingAction(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingAction(null)}>
              关闭
            </Button>
            <Button
              variant={
                pendingAction && ACTION_COPY[pendingAction.kind].danger
                  ? "danger"
                  : "primary"
              }
              onClick={executeAction}
              loading={submitting}
            >
              {pendingAction ? ACTION_COPY[pendingAction.kind].confirm : "确认"}
            </Button>
          </>
        }
      >
        {pendingAction ? (
          <div className="stack">
            {actionError ? (
              <InfoNotice tone="warning">{actionError}</InfoNotice>
            ) : null}
            <DefinitionList
              items={[
                {
                  label: "运行",
                  value: `${shortId(pendingAction.run.id, 14)} · v${pendingAction.run.version}`,
                },
                {
                  label: "周期",
                  value: `${formatDate(pendingAction.run.periodStart)} – ${formatDate(pendingAction.run.periodEnd)}`,
                },
                {
                  label: "当前状态",
                  value: <Badge status={pendingAction.run.status} />,
                },
              ]}
            />
            {pendingAction.kind === "approve" ? (
              <FormField
                label="审批人"
                htmlFor="run-approver"
                hint={
                  pendingAction.run.preparedBy === approvedBy
                    ? "这是编制人，职责分离会拒绝该操作。"
                    : "贡献认定将记录到该人员名下。"
                }
              >
                <PersonSelect
                  id="run-approver"
                  value={approvedBy}
                  onChange={setApprovedBy}
                />
              </FormField>
            ) : null}
            {pendingAction.kind === "reverse" ? (
              <>
                <FormField label="冲销人" htmlFor="run-reverser">
                  <PersonSelect
                    id="run-reverser"
                    value={reversedBy}
                    onChange={setReversedBy}
                  />
                </FormField>
                <FormField
                  label="原因（必填）"
                  htmlFor="run-reason"
                  hint="随批次永久保留。"
                >
                  <Textarea
                    id="run-reason"
                    value={actionReason}
                    onChange={(event) => setActionReason(event.target.value)}
                    placeholder="冲销本批次的原因？"
                  />
                </FormField>
              </>
            ) : null}
            {pendingAction.kind === "pay" ? (
              <InfoNotice>
                This marks the run paid in the ledger. The bank file must be
                executed separately; use reversal for corrections.
              </InfoNotice>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

/* ----------------------------------------------------------- contracts tab */

function ContractsTab({
  contracts,
  loading,
  error,
  reload,
}: {
  contracts: EmploymentContract[];
  loading: boolean;
  error: Error | undefined;
  reload: () => void;
}) {
  const toast = useToast();
  const { session } = useAuth();
  const { people } = usePeople();
  const [open, setOpen] = useState(false);
  const [personId, setPersonId] = useState("");
  const [contractCode, setContractCode] = useState("");
  const [employmentType, setEmploymentType] = useState<string>("FULL_TIME");
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [endDate, setEndDate] = useState("");
  const [workLocation, setWorkLocation] = useState("");
  const [legalEntity, setLegalEntity] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [fixedMonthlySalary, setFixedMonthlySalary] = useState("");
  const [minimumMonthlyWage, setMinimumMonthlyWage] = useState("");
  const [taxRatePercent, setTaxRatePercent] = useState("0");
  const [socialRatePercent, setSocialRatePercent] = useState("0");
  const [deductionCapPercent, setDeductionCapPercent] = useState("20");
  const [variableCapPercent, setVariableCapPercent] = useState("100");
  const [deductionOrder, setDeductionOrder] = useState(
    "RECOVERY, REVERSAL, ADJUSTMENT, OTHER",
  );
  const [deductionTypeCaps, setDeductionTypeCaps] = useState("");
  const [smoothingPercent, setSmoothingPercent] = useState("100");
  const [smoothingMode, setSmoothingMode] = useState("BLOCK");
  const [smoothingWindow, setSmoothingWindow] = useState("3");
  const [smoothingMaxStep, setSmoothingMaxStep] = useState("50");
  const [compensationTemplate, setCompensationTemplate] = useState("");
  const [consentSignatureRef, setConsentSignatureRef] = useState("");
  const [bankAccountRef, setBankAccountRef] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [amendTarget, setAmendTarget] = useState<EmploymentContract | null>(
    null,
  );
  const [importOpen, setImportOpen] = useState(false);
  const [importCsv, setImportCsv] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    created: number;
    failed: number;
    errors: Array<{ row: number; error: string }>;
    defaultConsentRef: string;
  } | null>(null);

  async function submitContractImport(event: FormEvent) {
    event.preventDefault();
    setImportError(null);
    setImporting(true);
    try {
      const result = await api<{
        created: number;
        failed: number;
        errors: Array<{ row: number; error: string }>;
        defaultConsentRef: string;
      }>("/api/v1/employment-contracts:import", {
        method: "POST",
        body: { csv: importCsv },
      });
      setImportResult(result);
      toast.success(
        "合同导入完成",
        `成功 ${result.created} 份，失败 ${result.failed} 份`,
      );
      reload();
    } catch (caught) {
      const details =
        caught instanceof ApiError && Array.isArray(caught.details)
          ? (caught.details as string[]).slice(0, 10).join("\n")
          : "";
      setImportError(
        (caught instanceof ApiError ? caught.message : "导入失败") +
          (details ? `\n${details}` : ""),
      );
    } finally {
      setImporting(false);
    }
  }
  const [amendSalary, setAmendSalary] = useState("");
  const [amendMinimum, setAmendMinimum] = useState("");
  const [amendTax, setAmendTax] = useState("0");
  const [amendSocial, setAmendSocial] = useState("0");
  const [amendCap, setAmendCap] = useState("20");
  const [amendVariableCap, setAmendVariableCap] = useState("100");
  const [amendDeductionOrder, setAmendDeductionOrder] = useState(
    "RECOVERY, REVERSAL, ADJUSTMENT, OTHER",
  );
  const [amendDeductionTypeCaps, setAmendDeductionTypeCaps] = useState("");
  const [amendSmoothingPercent, setAmendSmoothingPercent] = useState("100");
  const [amendCompensationTemplate, setAmendCompensationTemplate] =
    useState("");
  const [amendEffective, setAmendEffective] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [amendConsent, setAmendConsent] = useState("");
  const [amendApprover, setAmendApprover] = useState(session.personId);
  const [amendError, setAmendError] = useState<string | null>(null);
  const envelopes = useApiQuery<ESignEnvelopeView[]>(
    "/api/v1/esign-envelopes",
  );
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignContractId, setEsignContractId] = useState("");
  const [esignProvider, setEsignProvider] = useState("");
  const [esignRef, setEsignRef] = useState("");
  const [esignHash, setEsignHash] = useState("");
  const [esignSigner, setEsignSigner] = useState(session.personId);
  const [esignError, setEsignError] = useState<string | null>(null);

  function openEsign() {
    setEsignContractId(contracts[0]?.id ?? "");
    setEsignProvider("");
    setEsignRef("");
    setEsignHash("");
    setEsignSigner(session.personId);
    setEsignError(null);
    setEsignOpen(true);
  }

  async function createEsign() {
    setEsignError(null);
    try {
      await api("/api/v1/esign-envelopes", {
        method: "POST",
        body: {
          contractId: esignContractId,
          provider: esignProvider.trim(),
          envelopeRef: esignRef.trim(),
          documentHash: esignHash.trim(),
          signerPersonId: esignSigner,
        },
      });
      toast.success("电子签信封已登记", esignRef);
      setEsignOpen(false);
      envelopes.reload();
    } catch (caught) {
      setEsignError(
        caught instanceof Error
          ? caught.message
          : "登记信封失败",
      );
    }
  }

  function openForm() {
    setPersonId(people[0]?.id ?? "");
    setContractCode("");
    setEmploymentType("FULL_TIME");
    setStartDate(new Date().toISOString().slice(0, 10));
    setEndDate("");
    setWorkLocation("");
    setCurrency("CNY");
    setFixedMonthlySalary("");
    setMinimumMonthlyWage("");
    setTaxRatePercent("0");
    setSocialRatePercent("0");
    setDeductionCapPercent("20");
    setVariableCapPercent("100");
    setDeductionOrder("RECOVERY, REVERSAL, ADJUSTMENT, OTHER");
    setDeductionTypeCaps("");
    setSmoothingPercent("100");
    setCompensationTemplate("");
    setConsentSignatureRef("");
    setBankAccountRef("");
    setFormError(null);
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api("/api/v1/employment-contracts", {
        method: "POST",
        body: {
          personId,
          contractCode: contractCode.trim(),
          employmentType,
          startDate: toIsoDate(startDate),
          endDate: endDate ? toIsoDate(endDate) : undefined,
          workLocation: workLocation.trim(),
          legalEntity: legalEntity.trim() || undefined,
          currency: currency.toUpperCase(),
          fixedMonthlySalary,
          minimumMonthlyWage,
          taxRate: String(toNumber(taxRatePercent) / 100),
          socialInsuranceRate: String(toNumber(socialRatePercent) / 100),
          deductionCapRate: String(toNumber(deductionCapPercent) / 100),
          variableShareCapRate: String(toNumber(variableCapPercent) / 100),
          deductionOrder: deductionOrder
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          deductionTypeCaps: Object.fromEntries(
            deductionTypeCaps
              .split(",")
              .map((part) => part.split("=").map((value) => value.trim()))
              .filter(([type, rate]) => Boolean(type) && Boolean(rate)),
          ),
          smoothingThresholdRate: String(toNumber(smoothingPercent) / 100),
          smoothingMode,
          smoothingWindowPeriods: Number(smoothingWindow) || 3,
          smoothingMaxStepRate: String(toNumber(smoothingMaxStep) / 100),
          compensationTemplateCode: compensationTemplate.trim() || undefined,
          bankAccountRef: bankAccountRef.trim() || undefined,
          consentSignatureRef: consentSignatureRef.trim(),
        },
      });
      toast.success("合同已创建", contractCode);
      setOpen(false);
      reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "创建合同失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function openAmend(contract: EmploymentContract) {
    setAmendTarget(contract);
    setAmendSalary(contract.fixedMonthlySalary);
    setAmendMinimum(contract.minimumMonthlyWage);
    setAmendTax(String(toNumber(contract.taxRate) * 100));
    setAmendSocial(String(toNumber(contract.socialInsuranceRate) * 100));
    setAmendCap(String(toNumber(contract.deductionCapRate) * 100));
    setAmendVariableCap(String(toNumber(contract.variableShareCapRate) * 100));
    setAmendDeductionOrder(contract.deductionOrder.join(", "));
    setAmendDeductionTypeCaps(
      Object.entries(contract.deductionTypeCaps ?? {})
        .map(([type, rate]) => `${type}=${rate}`)
        .join(", "),
    );
    setAmendSmoothingPercent(
      String(toNumber(contract.smoothingThresholdRate) * 100),
    );
    setAmendCompensationTemplate(contract.compensationTemplateCode ?? "");
    setAmendEffective(new Date().toISOString().slice(0, 10));
    setAmendConsent("");
    setAmendApprover(session.personId);
    setAmendError(null);
  }

  async function amendContract(event: FormEvent) {
    event.preventDefault();
    if (!amendTarget) return;
    setAmendError(null);
    setSubmitting(true);
    try {
      await api(`/api/v1/employment-contracts/${amendTarget.id}/amendments`, {
        method: "POST",
        body: {
          fixedMonthlySalary: amendSalary,
          minimumMonthlyWage: amendMinimum,
          taxRate: String(toNumber(amendTax) / 100),
          socialInsuranceRate: String(toNumber(amendSocial) / 100),
          deductionCapRate: String(toNumber(amendCap) / 100),
          variableShareCapRate: String(toNumber(amendVariableCap) / 100),
          deductionOrder: amendDeductionOrder
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          deductionTypeCaps: Object.fromEntries(
            amendDeductionTypeCaps
              .split(",")
              .map((part) => part.split("=").map((value) => value.trim()))
              .filter(([type, rate]) => Boolean(type) && Boolean(rate)),
          ),
          smoothingThresholdRate: String(
            toNumber(amendSmoothingPercent) / 100,
          ),
          compensationTemplateCode:
            amendCompensationTemplate.trim() || undefined,
          effectiveFrom: toIsoDate(amendEffective),
          consentSignatureRef: amendConsent.trim(),
          approvedBy: amendApprover,
        },
      });
      toast.success("合同已修订", amendTarget.contractCode);
      setAmendTarget(null);
      reload();
    } catch (caught) {
      setAmendError(
        caught instanceof Error ? caught.message : "修订合同失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel
      title="劳动合同"
      subtitle="申报的固定薪、最低工资与扣缴率；法定计算见「个税工作台」。"
      action={
        <div className="row-actions">
          <Button
            size="sm"
            variant="secondary"
            icon="refresh"
            onClick={async () => {
              try {
                const applied = await api<Array<unknown>>(
                  "/api/v1/employment-contracts/apply-due",
                  { method: "POST" },
                );
                toast.success(
                  "到期修订已应用",
                  `已更新 ${applied.length} 份合同`,
                );
                reload();
              } catch (caught) {
                toast.error(
                  "应用修订失败",
                  caught instanceof Error ? caught.message : undefined,
                );
              }
            }}
          >
            应用到期修订
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setImportOpen(true);
              setImportError(null);
              setImportResult(null);
              setImportCsv("");
            }}
          >
            导入合同 CSV
          </Button>
          <Button size="sm" variant="primary" icon="plus" onClick={openForm}>
            新建合同
          </Button>
        </div>
      }
      flush
    >
      {error ? (
        <div style={{ padding: 16 }}>
          <ErrorNotice error={error} onRetry={reload} />
        </div>
      ) : loading ? (
        <div style={{ padding: 16 }}>
          <LoadingRows rows={5} />
        </div>
      ) : contracts.length === 0 ? (
        <EmptyState
          icon="people"
          title="暂无已申报合同"
          description="薪酬只读取生效合同；请先创建合同，人员才会进入下次计算。"
          action={
            <Button variant="primary" size="sm" icon="plus" onClick={openForm}>
              创建合同
            </Button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>合同</th>
                <th>人员</th>
                <th>类型</th>
                <th className="cell-num">固定薪</th>
                <th className="cell-num">最低工资</th>
                <th className="cell-num">个税</th>
                <th className="cell-num">社保</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contracts.map((contract) => (
                <tr key={contract.id}>
                  <td>
                    <span className="cell-primary">{contract.contractCode}</span>
                    <span className="cell-sub">
                      {formatDate(contract.startDate)}
                      {contract.endDate ? ` – ${formatDate(contract.endDate)}` : ""}
                    </span>
                  </td>
                  <td>
                    <span>{displayName(contract.personId, people)}</span>
                    <span className="cell-sub">
                      {contract.legalEntity
                        ? `${contract.workLocation} · ${contract.legalEntity}`
                        : contract.workLocation}
                    </span>
                  </td>
                  <td>{titleCase(contract.employmentType)}</td>
                  <td className="cell-num">
                    {formatMoney(contract.fixedMonthlySalary, contract.currency)}
                  </td>
                  <td className="cell-num">
                    {formatMoney(contract.minimumMonthlyWage, contract.currency)}
                  </td>
                  <td className="cell-num">{formatPercent(contract.taxRate)}</td>
                  <td className="cell-num">
                    {formatPercent(contract.socialInsuranceRate)}
                  </td>
                  <td>
                    <Badge status={contract.status} />
                    <span className="cell-sub">
                      plan v{contract.payPlanVersion} · contract v{contract.version}
                    </span>
                  </td>
                  <td className="cell-actions">
                    {contract.status === "ACTIVE" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openAmend(contract)}
                      >
                        修订
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="detail-section" style={{ padding: 16 }}>
        <div
          className="inline"
          style={{ justifyContent: "space-between", width: "100%" }}
        >
          <div className="detail-section__title" style={{ margin: 0 }}>
            电子签信封
          </div>
          <Button size="sm" variant="secondary" icon="plus" onClick={openEsign}>
            登记信封
          </Button>
        </div>
        {envelopes.error ? (
          <ErrorNotice error={envelopes.error} onRetry={envelopes.reload} />
        ) : envelopes.loading ? (
          <LoadingRows rows={2} />
        ) : (envelopes.data?.length ?? 0) === 0 ? (
          <p className="muted">
            No e-sign envelope. Contracts require a consent signature reference;
            providers confirm completion through the signed callback.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>合同</th>
                  <th>供应商</th>
                  <th>信封</th>
                  <th>状态</th>
                  <th>签署人</th>
                </tr>
              </thead>
              <tbody>
                {(envelopes.data ?? []).map((envelope) => (
                  <tr key={envelope.id}>
                    <td className="mono">
                      {contracts.find(
                        (contract) => contract.id === envelope.contractId,
                      )?.contractCode ?? shortId(envelope.contractId, 10)}
                    </td>
                    <td>{envelope.provider}</td>
                    <td className="mono">{envelope.envelopeRef}</td>
                    <td>
                      <Badge status={envelope.status} />
                    </td>
                    <td>{displayName(envelope.signerPersonId, people)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={open}
        title="新建劳动合同"
        description="申报薪酬计算所用的法定最低工资与扣缴率。"
        onClose={() => setOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-contract-form"
              loading={submitting}
            >
              创建合同
            </Button>
          </>
        }
      >
        <form id="create-contract-form" onSubmit={submit} className="form-grid">
          {formError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{formError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="人员" htmlFor="contract-person">
            <PersonSelect
              id="contract-person"
              value={personId}
              onChange={setPersonId}
            />
          </FormField>
          <FormField label="合同编号" htmlFor="contract-code">
            <TextInput
              id="contract-code"
              value={contractCode}
              onChange={(event) => setContractCode(event.target.value)}
              placeholder="CTR-2026-001"
              required
            />
          </FormField>
          <FormField label="用工类型" htmlFor="contract-type">
            <Select
              id="contract-type"
              value={employmentType}
              onChange={(event) => setEmploymentType(event.target.value)}
            >
              {EMPLOYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="工作地" htmlFor="contract-location">
            <TextInput
              id="contract-location"
              value={workLocation}
              onChange={(event) => setWorkLocation(event.target.value)}
              placeholder="Shanghai"
              required
            />
          </FormField>
          <FormField
            label="法人实体（可选）"
            htmlFor="contract-legal-entity"
          >
            <TextInput
              id="contract-legal-entity"
              value={legalEntity}
              onChange={(event) => setLegalEntity(event.target.value)}
              placeholder="Anari Shanghai Co., Ltd."
            />
          </FormField>
          <FormField label="开始日期" htmlFor="contract-start">
            <TextInput
              id="contract-start"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              required
            />
          </FormField>
          <FormField label="结束日期（可选）" htmlFor="contract-end">
            <TextInput
              id="contract-end"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </FormField>
          <FormField label="币种" htmlFor="contract-currency">
            <TextInput
              id="contract-currency"
              value={currency}
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              required
            />
          </FormField>
          <FormField label="固定月薪" htmlFor="contract-salary">
            <TextInput
              id="contract-salary"
              type="number"
              min="0"
              step="0.01"
              value={fixedMonthlySalary}
              onChange={(event) => setFixedMonthlySalary(event.target.value)}
              placeholder="20000.00"
              required
            />
          </FormField>
          <FormField
            label="最低月薪"
            htmlFor="contract-minimum"
            hint="实发低于该值的行会被计算阻断。"
          >
            <TextInput
              id="contract-minimum"
              type="number"
              min="0"
              step="0.01"
              value={minimumMonthlyWage}
              onChange={(event) => setMinimumMonthlyWage(event.target.value)}
              placeholder="2690.00"
              required
            />
          </FormField>
          <FormField
            label="申报税率（%）"
            htmlFor="contract-tax"
            hint="在申报税率薪酬路径中按税前计。"
          >
            <TextInput
              id="contract-tax"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={taxRatePercent}
              onChange={(event) => setTaxRatePercent(event.target.value)}
            />
          </FormField>
          <FormField label="社保比例 (%)" htmlFor="contract-social">
            <TextInput
              id="contract-social"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={socialRatePercent}
              onChange={(event) => setSocialRatePercent(event.target.value)}
            />
          </FormField>
          <FormField
            label="扣款上限（税前 %）"
            htmlFor="contract-deduction-cap"
            hint="账本扣款超过该上限会阻断薪酬行。默认 20%。"
          >
            <TextInput
              id="contract-deduction-cap"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={deductionCapPercent}
              onChange={(event) => setDeductionCapPercent(event.target.value)}
            />
          </FormField>
          <FormField
            label="浮动占比上限（税前 %）"
            htmlFor="contract-variable-cap"
            hint="激励超过税前工资该比例将阻断薪酬行。默认 100%。"
          >
            <TextInput
              id="contract-variable-cap"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={variableCapPercent}
              onChange={(event) => setVariableCapPercent(event.target.value)}
            />
          </FormField>
          <FormField
            label="扣款顺序"
            htmlFor="contract-deduction-order"
            hint="逗号分隔类型；薪酬按此顺序归组扣款。"
          >
            <TextInput
              id="contract-deduction-order"
              value={deductionOrder}
              onChange={(event) => setDeductionOrder(event.target.value)}
            />
          </FormField>
          <FormField
            label="分类型扣款上限"
            htmlFor="contract-deduction-type-caps"
            hint="可选：类型=税前比例，如 RECOVERY=0.1；超出会阻断该行。"
          >
            <TextInput
              id="contract-deduction-type-caps"
              value={deductionTypeCaps}
              onChange={(event) =>
                setDeductionTypeCaps(event.target.value)
              }
            />
          </FormField>
          <FormField
            label="平滑阈值（变化 %）"
            htmlFor="contract-smoothing"
            hint="激励环比变化超过该阈值会阻断该行。"
          >
            <TextInput
              id="contract-smoothing"
              type="number"
              min="0"
              max="1000"
              step="0.01"
              value={smoothingPercent}
              onChange={(event) => setSmoothingPercent(event.target.value)}
            />
          </FormField>
          <FormField
            label="平滑模式"
            htmlFor="contract-smoothing-mode"
            hint="BLOCK：超阈值阻断；MOVING_AVERAGE：按历史均值平滑；RAMP：单期变化限幅；NONE：不平滑。"
          >
            <Select
              id="contract-smoothing-mode"
              value={smoothingMode}
              onChange={(event) => setSmoothingMode(event.target.value)}
            >
              <option value="BLOCK">阻断（BLOCK）</option>
              <option value="MOVING_AVERAGE">移动平均（MOVING_AVERAGE）</option>
              <option value="RAMP">限幅爬坡（RAMP）</option>
              <option value="NONE">不平滑（NONE）</option>
            </Select>
          </FormField>
          <FormField label="移动平均窗口（期）" htmlFor="contract-smoothing-window">
            <TextInput
              id="contract-smoothing-window"
              type="number"
              min="1"
              max="24"
              value={smoothingWindow}
              onChange={(event) => setSmoothingWindow(event.target.value)}
            />
          </FormField>
          <FormField label="单期最大变化（%）" htmlFor="contract-smoothing-step">
            <TextInput
              id="contract-smoothing-step"
              type="number"
              min="0"
              max="1000"
              step="0.01"
              value={smoothingMaxStep}
              onChange={(event) => setSmoothingMaxStep(event.target.value)}
            />
          </FormField>
          <FormField
            label="薪酬模板编码（可选）"
            htmlFor="contract-template"
            hint="设置后，生效模板会校验用工类型、币种与薪资区间。"
          >
            <TextInput
              id="contract-template"
              value={compensationTemplate}
              onChange={(event) => setCompensationTemplate(event.target.value)}
            />
          </FormField>
          <FormField label="银行账户引用" htmlFor="contract-bank">
            <TextInput
              id="contract-bank"
              value={bankAccountRef}
              onChange={(event) => setBankAccountRef(event.target.value)}
              placeholder="脱敏账户引用"
            />
          </FormField>
          <FormField
            label="同意/电子签引用"
            htmlFor="contract-consent"
            hint="员工同意薪酬方案的必要凭证。"
          >
            <TextInput
              id="contract-consent"
              value={consentSignatureRef}
              onChange={(event) => setConsentSignatureRef(event.target.value)}
              placeholder="ESIGN-2026-001"
              required
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(amendTarget)}
        title={
          amendTarget
            ? `Amend ${amendTarget.contractCode}`
            : "修订劳动合同"
        }
        description="新的薪酬方案版本需要员工同意凭证，并记入修订历史。"
        onClose={() => setAmendTarget(null)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setAmendTarget(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="amend-contract-form"
              loading={submitting}
            >
              记录修订
            </Button>
          </>
        }
      >
        <form id="amend-contract-form" onSubmit={amendContract} className="form-grid">
          {amendError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{amendError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="固定月薪" htmlFor="amend-salary">
            <TextInput
              id="amend-salary"
              type="number"
              min="0"
              step="0.01"
              value={amendSalary}
              onChange={(event) => setAmendSalary(event.target.value)}
              required
            />
          </FormField>
          <FormField label="最低月薪" htmlFor="amend-minimum">
            <TextInput
              id="amend-minimum"
              type="number"
              min="0"
              step="0.01"
              value={amendMinimum}
              onChange={(event) => setAmendMinimum(event.target.value)}
              required
            />
          </FormField>
          <FormField label="税率（%）" htmlFor="amend-tax">
            <TextInput
              id="amend-tax"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={amendTax}
              onChange={(event) => setAmendTax(event.target.value)}
            />
          </FormField>
          <FormField label="社保比例 (%)" htmlFor="amend-social">
            <TextInput
              id="amend-social"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={amendSocial}
              onChange={(event) => setAmendSocial(event.target.value)}
            />
          </FormField>
          <FormField label="扣款上限（%）" htmlFor="amend-cap">
            <TextInput
              id="amend-cap"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={amendCap}
              onChange={(event) => setAmendCap(event.target.value)}
            />
          </FormField>
          <FormField label="浮动占比上限（%）" htmlFor="amend-variable-cap">
            <TextInput
              id="amend-variable-cap"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={amendVariableCap}
              onChange={(event) => setAmendVariableCap(event.target.value)}
            />
          </FormField>
          <FormField
            label="扣款顺序"
            htmlFor="amend-deduction-order"
          >
            <TextInput
              id="amend-deduction-order"
              value={amendDeductionOrder}
              onChange={(event) =>
                setAmendDeductionOrder(event.target.value)
              }
            />
          </FormField>
          <FormField
            label="分类型扣款上限"
            htmlFor="amend-deduction-type-caps"
          >
            <TextInput
              id="amend-deduction-type-caps"
              value={amendDeductionTypeCaps}
              onChange={(event) =>
                setAmendDeductionTypeCaps(event.target.value)
              }
            />
          </FormField>
          <FormField label="平滑阈值（%）" htmlFor="amend-smoothing">
            <TextInput
              id="amend-smoothing"
              type="number"
              min="0"
              max="1000"
              step="0.01"
              value={amendSmoothingPercent}
              onChange={(event) =>
                setAmendSmoothingPercent(event.target.value)
              }
            />
          </FormField>
          <FormField
            label="薪酬模板编码"
            htmlFor="amend-template"
          >
            <TextInput
              id="amend-template"
              value={amendCompensationTemplate}
              onChange={(event) =>
                setAmendCompensationTemplate(event.target.value)
              }
            />
          </FormField>
          <FormField label="生效日期" htmlFor="amend-effective">
            <TextInput
              id="amend-effective"
              type="date"
              value={amendEffective}
              onChange={(event) => setAmendEffective(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="同意/电子签引用"
            htmlFor="amend-consent"
            className="field--full"
            hint="服务端会拒绝缺失同意引用与未来生效日期。"
          >
            <TextInput
              id="amend-consent"
              value={amendConsent}
              onChange={(event) => setAmendConsent(event.target.value)}
              required
            />
          </FormField>
          <FormField label="批准人" htmlFor="amend-approver">
            <PersonSelect
              id="amend-approver"
              value={amendApprover}
              onChange={setAmendApprover}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={esignOpen}
        title="登记电子签信封"
        description="供应商回调会把已签署同意引用写回合同。"
        onClose={() => setEsignOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEsignOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={createEsign}>
              登记
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {esignError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{esignError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="合同" htmlFor="esign-contract">
            <Select
              id="esign-contract"
              value={esignContractId}
              onChange={(event) => setEsignContractId(event.target.value)}
              required
            >
              <option value="">选择合同…</option>
              {contracts.map((contract) => (
                <option key={contract.id} value={contract.id}>
                  {contract.contractCode}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="供应商" htmlFor="esign-provider">
            <TextInput
              id="esign-provider"
              value={esignProvider}
              onChange={(event) => setEsignProvider(event.target.value)}
              placeholder="docusign"
              required
            />
          </FormField>
          <FormField label="信封引用" htmlFor="esign-ref">
            <TextInput
              id="esign-ref"
              value={esignRef}
              onChange={(event) => setEsignRef(event.target.value)}
              required
            />
          </FormField>
          <FormField label="文档哈希" htmlFor="esign-hash">
            <TextInput
              id="esign-hash"
              value={esignHash}
              onChange={(event) => setEsignHash(event.target.value)}
              placeholder="sha256:…"
              required
            />
          </FormField>
          <FormField label="签署人" htmlFor="esign-signer">
            <PersonSelect
              id="esign-signer"
              value={esignSigner}
              onChange={setEsignSigner}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={importOpen}
        title="批量导入劳动合同"
        description="上传或粘贴 CSV（表头：工号/人员ID，合同编号，开始日期，固定月薪；可选 结束日期/工作地点/币种/个税率/社保率/扣款上限率/浮动占比上限率/同意签名）。失败的行会逐条列出，不影响其他行。"
        onClose={() => setImportOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="contract-import-form"
              loading={importing}
              disabled={!importCsv.trim()}
            >
              解析并导入
            </Button>
          </>
        }
      >
        <form
          id="contract-import-form"
          onSubmit={submitContractImport}
          className="form-grid"
        >
          {importError ? (
            <div className="field--full">
              <InfoNotice tone="warning">
                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                  {importError}
                </pre>
              </InfoNotice>
            </div>
          ) : null}
          {importResult ? (
            <div className="field--full">
              <InfoNotice tone={importResult.failed > 0 ? "warning" : "success"}>
                成功 {importResult.created} 份，失败 {importResult.failed} 份。
                {importResult.failed > 0
                  ? `失败行：${importResult.errors
                      .slice(0, 10)
                      .map((item) => `第${item.row}行 ${item.error}`)
                      .join("；")}`
                  : ""}
                {importResult.defaultConsentRef
                  ? ` 未填写同意签名的行使用了占位引用 ${importResult.defaultConsentRef}，请尽快补录正式签署引用。`
                  : ""}
              </InfoNotice>
            </div>
          ) : null}
          <FormField
            label="CSV 文件"
            htmlFor="contract-import-file"
            className="field--full"
          >
            <input
              id="contract-import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) setImportCsv(await file.text());
              }}
            />
          </FormField>
          <FormField
            label="CSV 内容"
            htmlFor="contract-import-csv"
            className="field--full"
          >
            <Textarea
              id="contract-import-csv"
              value={importCsv}
              onChange={(event) => setImportCsv(event.target.value)}
              rows={8}
              placeholder={
                "工号,合同编号,开始日期,固定月薪,币种\nE001,HT-2026-001,2026-12-01,12000,CNY"
              }
              required
            />
          </FormField>
        </form>
      </Modal>
    </Panel>
  );
}

/* ------------------------------------------------------------- tax studio */

const IIT_BRACKETS = [
  { upTo: 36000, rate: 3, deduction: 0 },
  { upTo: 144000, rate: 10, deduction: 2520 },
  { upTo: 300000, rate: 20, deduction: 16920 },
  { upTo: 420000, rate: 25, deduction: 31920 },
  { upTo: 660000, rate: 30, deduction: 52920 },
  { upTo: 960000, rate: 35, deduction: 85920 },
  { upTo: Infinity, rate: 45, deduction: 181920 },
];

const BASIC_DEDUCTION = 5000;

function TaxStudio() {
  const toast = useToast();
  const [gross, setGross] = useState("20000");
  const [social, setSocial] = useState("2000");
  const [special, setSpecial] = useState("1000");
  const [months, setMonths] = useState("6");
  const [withheld, setWithheld] = useState("0");
  const [result, setResult] = useState<CnIitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const monthlyTaxable = Math.max(
    0,
    toNumber(gross) - toNumber(social) - toNumber(special) - BASIC_DEDUCTION,
  );
  const cumulative = monthlyTaxable * Math.max(1, Math.floor(toNumber(months)));

  const currentRate = result?.ratePercent ?? 0;

  function invalidate() {
    setResult(null);
    setError(null);
  }

  async function calculate(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const calculated = await api<CnIitResult>(
        "/api/v1/tax/cn-iit/calculate",
        {
          method: "POST",
          body: {
            cumulativeTaxableIncome: cumulative.toFixed(2),
            taxAlreadyWithheld: withheld || "0",
          },
        },
      );
      setResult(calculated);
      toast.success(
        "个税测算已更新",
        `本期预扣 ${formatMoney(calculated.taxForPeriod, "CNY")}`,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "计算失败。",
      );
    } finally {
      setLoading(false);
    }
  }

  const effectiveRate =
    result && toNumber(result.cumulativeTaxableIncome) > 0
      ? toNumber(result.annualTaxDue) / toNumber(result.cumulativeTaxableIncome)
      : 0;

  return (
    <div className="stack">
      <InfoNotice>
        <strong>法定口径估算，不构成税务意见。</strong> This applies the
        public annual cumulative withholding brackets for China resident
        comprehensive income (3%–45%) to a steady monthly taxable base. Actual
        filings depend on cumulative income, special additional deductions and
        the employer's registered withholding profile.
      </InfoNotice>

      <div className="calculator-grid">
        <Panel
          title="预扣计算器"
          subtitle="累计预扣法 · 每月基本减除 ¥5,000"
        >
          <form onSubmit={calculate} className="stack">
            <div className="form-grid">
              <FormField label="当月税前收入" htmlFor="tax-gross">
                <TextInput
                  id="tax-gross"
                  type="number"
                  min="0"
                  step="0.01"
                  value={gross}
                  onChange={(event) => {
                    setGross(event.target.value);
                    invalidate();
                  }}
                />
              </FormField>
              <FormField
                label="社保（每月）"
                htmlFor="tax-social"
                hint="税前扣除的个人缴纳部分。"
              >
                <TextInput
                  id="tax-social"
                  type="number"
                  min="0"
                  step="0.01"
                  value={social}
                  onChange={(event) => {
                    setSocial(event.target.value);
                    invalidate();
                  }}
                />
              </FormField>
              <FormField
                label="专项附加扣除"
                htmlFor="tax-special"
                hint="每月金额，如住房或教育。"
              >
                <TextInput
                  id="tax-special"
                  type="number"
                  min="0"
                  step="0.01"
                  value={special}
                  onChange={(event) => {
                    setSpecial(event.target.value);
                    invalidate();
                  }}
                />
              </FormField>
              <FormField
                label="纳税年度内已过月数"
                htmlFor="tax-months"
                hint="含当月的累计月数。"
              >
                <TextInput
                  id="tax-months"
                  type="number"
                  min="1"
                  max="12"
                  step="1"
                  value={months}
                  onChange={(event) => {
                    setMonths(event.target.value);
                    invalidate();
                  }}
                />
              </FormField>
              <FormField
                label="年度已预扣税额"
                htmlFor="tax-withheld"
                hint="之前已批准批次的税额合计。"
                className="field--full"
              >
                <TextInput
                  id="tax-withheld"
                  type="number"
                  min="0"
                  step="0.01"
                  value={withheld}
                  onChange={(event) => {
                    setWithheld(event.target.value);
                    invalidate();
                  }}
                />
              </FormField>
            </div>

            <div className="coverage-grid">
              <div className="coverage-cell">
                <div className="coverage-cell__label">当月应纳税所得</div>
                <div className="coverage-cell__value">
                  {formatMoney(monthlyTaxable, "CNY")}
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">累计应纳税所得</div>
                <div className="coverage-cell__value">
                  {formatMoney(cumulative, "CNY")}
                </div>
              </div>
            </div>

            {error ? <InfoNotice tone="warning">{error}</InfoNotice> : null}

            <div className="form-actions">
              <Button
                variant="primary"
                type="submit"
                icon="chart"
                loading={loading}
              >
                计算预扣
              </Button>
            </div>
          </form>
        </Panel>

        <Panel
          title="本期结果"
          subtitle="本月应预扣"
          action={
            result ? (
              <Badge tone="accent" dot={false}>
                {result.ratePercent}% bracket
              </Badge>
            ) : null
          }
        >
          {result ? (
            <div className="stack">
              <div className="calculator-result">
                <div className="calculator-result__label">
                  本期应纳税
                </div>
                <div className="calculator-result__value">
                  {formatMoney(result.taxForPeriod, "CNY", { decimals: 2 })}
                </div>
                <div className="calculator-result__row">
                  <span>累计应纳税所得额</span>
                  <strong>
                    {formatMoney(result.cumulativeTaxableIncome, "CNY", {
                      decimals: 2,
                    })}
                  </strong>
                </div>
                <div className="calculator-result__row">
                  <span>按档年度应纳税</span>
                  <strong>
                    {formatMoney(result.annualTaxDue, "CNY", { decimals: 2 })}
                  </strong>
                </div>
                <div className="calculator-result__row">
                  <span>已预扣</span>
                  <strong>
                    {formatMoney(result.taxAlreadyWithheld, "CNY", {
                      decimals: 2,
                    })}
                  </strong>
                </div>
                <div className="calculator-result__row">
                  <span>等效年税率</span>
                  <strong>{formatPercent(effectiveRate, 1)}</strong>
                </div>
              </div>
              <p className="subtle" style={{ fontSize: 11.5 }}>
                速算扣除数 {formatMoney(result.quickDeduction, "CNY")} ·
                仅供估算，使用前请以法定申报口径复核。
              </p>
            </div>
          ) : (
            <EmptyState
              icon="chart"
              title="尚无估算"
              description="录入收入与扣除后计算，即可看到税率档与本期预扣。"
            />
          )}

          <div className="detail-section section-gap">
            <div className="detail-section__title">年度累计税率表</div>
            <div className="bracket-list">
              <div className="bracket-row bracket-row--head">
                <span className="bracket-row__rate">税率</span>
                <span className="bracket-row__range">年度应纳税所得</span>
                <span className="bracket-row__deduction">速算扣除</span>
              </div>
              {IIT_BRACKETS.map((bracket) => (
                <div
                  key={bracket.rate}
                  className={`bracket-row ${currentRate === bracket.rate ? "is-current" : ""}`}
                >
                  <span className="bracket-row__rate">{bracket.rate}%</span>
                  <span className="bracket-row__range">
                    {bracket.upTo === Infinity
                      ? "Over ¥960,000"
                      : `Up to ¥${bracket.upTo.toLocaleString("en-US")}`}
                  </span>
                  <span className="bracket-row__deduction">
                    {formatMoney(bracket.deduction, "CNY")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}


function StatutoryDeductionStudio() {
  const toast = useToast();
  const types = useApiQuery<Array<Record<string, unknown>>>(
    "/api/v1/statutory-deduction-types",
  );
  const bases = useApiQuery<Record<string, unknown>>(
    "/api/v1/deduction-legal-bases",
  );
  const [typesText, setTypesText] = useState("");
  const [basesText, setBasesText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function loadTypes() {
    setTypesText(JSON.stringify(types.data ?? [], null, 2));
  }
  function loadBases() {
    setBasesText(JSON.stringify(bases.data ?? {}, null, 2));
  }

  async function saveTypes() {
    setError(null);
    try {
      await api("/api/v1/statutory-deduction-types", {
        method: "PUT",
        body: { types: JSON.parse(typesText) },
      });
      toast.success("法定扣款类型已保存");
      types.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "保存失败");
    }
  }

  async function saveBases() {
    setError(null);
    try {
      await api("/api/v1/deduction-legal-bases", {
        method: "PUT",
        body: { bases: JSON.parse(basesText) },
      });
      toast.success("执行令/同意依据已保存");
      bases.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "保存失败");
    }
  }

  return (
    <div className="stack">
      {error ? <InfoNotice tone="warning">{error}</InfoNotice> : null}
      <Panel
        title="法定扣款类型"
        subtitle="type / priority / capRate / requiresCourtOrder / requiresConsent / legalBasis"
        action={
          <Button size="sm" variant="secondary" onClick={loadTypes}>
            载入当前配置
          </Button>
        }
      >
        <FormField label="类型 JSON">
          <Textarea
            rows={10}
            value={typesText}
            onChange={(event) => setTypesText(event.target.value)}
            placeholder='[{"type":"COURT_ORDER","priority":0,"capRate":"0.5","requiresCourtOrder":true}]'
          />
        </FormField>
        <div className="form-actions">
          <Button onClick={() => void saveTypes()}>保存类型</Button>
        </div>
      </Panel>

      <Panel
        title="执行令 / 员工同意依据"
        subtitle="按扣款类型登记 courtOrderRef / consentRef；缺少依据时薪酬行会被阻断"
        action={
          <Button size="sm" variant="secondary" onClick={loadBases}>
            载入当前依据
          </Button>
        }
      >
        <FormField label="依据 JSON">
          <Textarea
            rows={8}
            value={basesText}
            onChange={(event) => setBasesText(event.target.value)}
            placeholder='{"COURT_ORDER":{"courtOrderRef":"(2026)粤0305执123号"}}'
          />
        </FormField>
        <div className="form-actions">
          <Button onClick={() => void saveBases()}>保存依据</Button>
        </div>
      </Panel>
    </div>
  );
}
