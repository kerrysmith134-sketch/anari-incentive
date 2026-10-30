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
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
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

const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACTOR"] as const;

type RunAction = "calculate" | "approve" | "pay" | "reverse" | "cancel";

const ACTION_COPY: Record<
  RunAction,
  { title: string; description: string; confirm: string; danger?: boolean }
> = {
  calculate: {
    title: "Calculate payroll run",
    description:
      "Recalculate from active contracts and locked ledger entries. Existing lines for this run are replaced.",
    confirm: "Calculate run",
  },
  approve: {
    title: "Approve payroll run",
    description:
      "Approval locks the calculated totals. The preparer cannot approve their own run.",
    confirm: "Approve run",
  },
  pay: {
    title: "Mark payroll paid",
    description:
      "Mark this run paid after the bank file has been executed. Reversal remains possible afterwards.",
    confirm: "Mark paid",
    danger: true,
  },
  reverse: {
    title: "Reverse payroll run",
    description:
      "Reversal is an append-only correction. The reason is retained against the run.",
    confirm: "Reverse run",
    danger: true,
  },
  cancel: {
    title: "Cancel payroll run",
    description:
      "Cancel an unapproved run. Paid runs must be reversed instead of cancelled.",
    confirm: "Cancel run",
    danger: true,
  },
};

export function PayrollPage() {
  useDocumentTitle("Payroll");
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

  return (
    <>
      <PageHeader
        eyebrow="Reward settlement"
        title="Payroll"
        description="Declared contracts, minimum-wage gates, tax withholding and bank-ready settlement — with a statutory IIT calculator for China."
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
            Refresh
          </Button>
        }
      />

      <Tabs
        items={[
          { id: "runs", label: "Payroll runs", count: runList.length },
          { id: "contracts", label: "Contracts", count: contractList.length },
          { id: "tax", label: "Tax studio" },
        ]}
        active={tab}
        onChange={setTab}
        label="Payroll views"
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
      setFormError("A cycle id is required. Create an evaluation cycle first.");
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
      toast.success("Draft payroll run created", shortId(created.id));
      setCreateOpen(false);
      onSelect(created.id);
      reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Could not create the run.",
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
      setActionError("A reversal reason is required.");
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
            : "The action failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function exportRun(
    run: PayrollRun,
    kind: "export" | "bank-file",
  ): Promise<void> {
    setDownloading(`${run.id}:${kind}`);
    try {
      await downloadFile(
        `/api/v1/payroll-runs/${run.id}/${kind}`,
        kind === "export"
          ? `payroll-${shortId(run.id, 12)}.csv`
          : `payroll-bank-${shortId(run.id, 12)}.csv`,
      );
    } catch (caught) {
      toast.error(
        "Export failed",
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
        "Payslip download failed",
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
          title="Runs"
          subtitle="Draft → calculated → approved → paid. Blocked runs require remediation."
          action={
            <Button size="sm" variant="primary" icon="plus" onClick={openCreate}>
              New run
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
              title="No payroll run yet"
              description="Create a draft run, then calculate it against active contracts and locked ledger entries."
              action={
                <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                  Create first run
                </Button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table table-clickable">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Status</th>
                    <th className="cell-num">Gross</th>
                    <th className="cell-num">Net</th>
                    <th>Updated</th>
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
                            Open
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
            <Panel title="Run detail">
              <EmptyState
                icon="approvals"
                title="Select a run"
                description="Open a payroll run to inspect lines, apply workflow actions and export settlement files."
              />
            </Panel>
          ) : detail.error ? (
            <Panel title="Run detail">
              <ErrorNotice error={detail.error} onRetry={detail.reload} />
            </Panel>
          ) : detail.loading || !selected ? (
            <Panel title="Run detail">
              <LoadingRows rows={4} />
            </Panel>
          ) : (
            <>
              <Panel
                title="Run detail"
                subtitle={`${formatDate(selected.periodStart)} – ${formatDate(selected.periodEnd)} · ${shortId(selected.id)}`}
                action={<Badge status={selected.status} />}
              >
                <div className="coverage-grid">
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Gross</div>
                    <div className="coverage-cell__value">
                      {formatMoney(selected.totalGross, selected.currency)}
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Net</div>
                    <div className="coverage-cell__value">
                      {formatMoney(selected.totalNet, selected.currency)}
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Withholding</div>
                    <div className="coverage-cell__value">
                      {formatMoney(selected.totalTax, selected.currency)}
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Social insurance</div>
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
                      label: "Prepared by",
                      value: displayName(selected.preparedBy, people),
                    },
                    {
                      label: "Approved by",
                      value: selected.approvedBy
                        ? displayName(selected.approvedBy, people)
                        : "—",
                    },
                    {
                      label: "Blocked lines",
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
                          label: "Reversal reason",
                          value: selected.reversalReason,
                        }
                      : { label: "Version", value: `v${selected.version}` },
                  ]}
                />

                <div className="detail-section">
                  <div className="detail-section__title">Workflow</div>
                  <div className="row-actions" style={{ flexWrap: "wrap" }}>
                    {["DRAFT", "CALCULATED", "BLOCKED"].includes(selected.status) ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="play"
                        onClick={() => openAction("calculate", selected)}
                      >
                        Calculate
                      </Button>
                    ) : null}
                    {selected.status === "CALCULATED" ? (
                      <Button
                        size="sm"
                        variant="primary"
                        icon="check"
                        onClick={() => openAction("approve", selected)}
                      >
                        Approve
                      </Button>
                    ) : null}
                    {selected.status === "APPROVED" ? (
                      <Button
                        size="sm"
                        variant="primary"
                        icon="wallet"
                        onClick={() => openAction("pay", selected)}
                      >
                        Mark paid
                      </Button>
                    ) : null}
                    {["APPROVED", "PAID"].includes(selected.status) ? (
                      <Button
                        size="sm"
                        variant="danger"
                        icon="undo"
                        onClick={() => openAction("reverse", selected)}
                      >
                        Reverse
                      </Button>
                    ) : null}
                    {!["PAID", "REVERSED", "CANCELLED"].includes(selected.status) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openAction("cancel", selected)}
                      >
                        Cancel
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
                  <div className="detail-section__title">Exports</div>
                  <div className="row-actions" style={{ flexWrap: "wrap" }}>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="download"
                      loading={downloading === `${selected.id}:export`}
                      onClick={() => void exportRun(selected, "export")}
                    >
                      Payroll CSV
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="download"
                      loading={downloading === `${selected.id}:bank-file`}
                      onClick={() => void exportRun(selected, "bank-file")}
                    >
                      Bank file
                    </Button>
                  </div>
                </div>
              </Panel>

              <Panel
                title="Lines"
                subtitle={`${selected.lines?.length ?? 0} employee lines`}
                flush
              >
                {(selected.lines?.length ?? 0) === 0 ? (
                  <EmptyState
                    icon="layers"
                    title="No lines calculated"
                    description="Run calculation to pull active contracts and locked ledger entries into this period."
                    action={
                      <Button
                        size="sm"
                        variant="primary"
                        icon="play"
                        onClick={() => openAction("calculate", selected)}
                      >
                        Calculate now
                      </Button>
                    }
                  />
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Person</th>
                          <th className="cell-num">Gross</th>
                          <th className="cell-num">Tax</th>
                          <th className="cell-num">Net</th>
                          <th>Gate</th>
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
                              {formatMoney(line.grossAmount, line.currency)}
                            </td>
                            <td className="cell-num">
                              {formatMoney(line.taxAmount, line.currency)}
                            </td>
                            <td className="cell-num">
                              {formatMoney(line.netAmount, line.currency)}
                            </td>
                            <td>
                              <Badge
                                tone={line.minimumWagePassed ? "success" : "danger"}
                              >
                                {line.minimumWagePassed ? "Passed" : "Blocked"}
                              </Badge>
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
                                Payslip
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
        title="New payroll run"
        description="Draft a settlement period. Calculation happens as a separate gated step."
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-run-form"
              loading={submitting}
            >
              Create draft
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
            label="Evaluation cycle"
            htmlFor="run-cycle"
            hint={
              cycles.length === 0
                ? "No cycle exists yet — paste an existing cycle UUID."
                : "Links this settlement to a cycle."
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
          <FormField label="Period start" htmlFor="run-start">
            <TextInput
              id="run-start"
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Period end" htmlFor="run-end">
            <TextInput
              id="run-end"
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Currency" htmlFor="run-currency">
            <TextInput
              id="run-currency"
              value={currency}
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              required
            />
          </FormField>
          <FormField
            label="Prepared by"
            htmlFor="run-preparer"
            hint="The preparer cannot approve this run."
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
              Close
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
              {pendingAction ? ACTION_COPY[pendingAction.kind].confirm : "Confirm"}
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
                  label: "Run",
                  value: `${shortId(pendingAction.run.id, 14)} · v${pendingAction.run.version}`,
                },
                {
                  label: "Period",
                  value: `${formatDate(pendingAction.run.periodStart)} – ${formatDate(pendingAction.run.periodEnd)}`,
                },
                {
                  label: "Current status",
                  value: <Badge status={pendingAction.run.status} />,
                },
              ]}
            />
            {pendingAction.kind === "approve" ? (
              <FormField
                label="Approver person"
                htmlFor="run-approver"
                hint={
                  pendingAction.run.preparedBy === approvedBy
                    ? "This is the preparer — separation of duties will reject it."
                    : "Attribution is recorded against this person."
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
                <FormField label="Reversed by" htmlFor="run-reverser">
                  <PersonSelect
                    id="run-reverser"
                    value={reversedBy}
                    onChange={setReversedBy}
                  />
                </FormField>
                <FormField
                  label="Reason (required)"
                  htmlFor="run-reason"
                  hint="Retained permanently against the run."
                >
                  <Textarea
                    id="run-reason"
                    value={actionReason}
                    onChange={(event) => setActionReason(event.target.value)}
                    placeholder="Why is this settlement being reversed?"
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
  const [currency, setCurrency] = useState("CNY");
  const [fixedMonthlySalary, setFixedMonthlySalary] = useState("");
  const [minimumMonthlyWage, setMinimumMonthlyWage] = useState("");
  const [taxRatePercent, setTaxRatePercent] = useState("0");
  const [socialRatePercent, setSocialRatePercent] = useState("0");
  const [bankAccountRef, setBankAccountRef] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
          currency: currency.toUpperCase(),
          fixedMonthlySalary,
          minimumMonthlyWage,
          taxRate: String(toNumber(taxRatePercent) / 100),
          socialInsuranceRate: String(toNumber(socialRatePercent) / 100),
          bankAccountRef: bankAccountRef.trim() || undefined,
        },
      });
      toast.success("Contract created", contractCode);
      setOpen(false);
      reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Could not create the contract.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel
      title="Employment contracts"
      subtitle="Declared fixed salary, minimum wage and withholding rates. Statutory calculation is available in Tax studio."
      action={
        <Button size="sm" variant="primary" icon="plus" onClick={openForm}>
          New contract
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
      ) : contracts.length === 0 ? (
        <EmptyState
          icon="people"
          title="No declared contract"
          description="Payroll only sees active contracts. Create one to include a person in the next calculation."
          action={
            <Button variant="primary" size="sm" icon="plus" onClick={openForm}>
              Create contract
            </Button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Person</th>
                <th>Type</th>
                <th className="cell-num">Fixed salary</th>
                <th className="cell-num">Minimum wage</th>
                <th className="cell-num">Tax</th>
                <th className="cell-num">Social</th>
                <th>Status</th>
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
                      {contract.workLocation}
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        title="New employment contract"
        description="Declare the legal minimum and withholding rates used by payroll."
        onClose={() => setOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-contract-form"
              loading={submitting}
            >
              Create contract
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
          <FormField label="Person" htmlFor="contract-person">
            <PersonSelect
              id="contract-person"
              value={personId}
              onChange={setPersonId}
            />
          </FormField>
          <FormField label="Contract code" htmlFor="contract-code">
            <TextInput
              id="contract-code"
              value={contractCode}
              onChange={(event) => setContractCode(event.target.value)}
              placeholder="CTR-2026-001"
              required
            />
          </FormField>
          <FormField label="Employment type" htmlFor="contract-type">
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
          <FormField label="Work location" htmlFor="contract-location">
            <TextInput
              id="contract-location"
              value={workLocation}
              onChange={(event) => setWorkLocation(event.target.value)}
              placeholder="Shanghai"
              required
            />
          </FormField>
          <FormField label="Start date" htmlFor="contract-start">
            <TextInput
              id="contract-start"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              required
            />
          </FormField>
          <FormField label="End date (optional)" htmlFor="contract-end">
            <TextInput
              id="contract-end"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </FormField>
          <FormField label="Currency" htmlFor="contract-currency">
            <TextInput
              id="contract-currency"
              value={currency}
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              required
            />
          </FormField>
          <FormField label="Fixed monthly salary" htmlFor="contract-salary">
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
            label="Minimum monthly wage"
            htmlFor="contract-minimum"
            hint="The calculation blocks any line whose net falls below this."
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
            label="Declared tax rate (%)"
            htmlFor="contract-tax"
            hint="Applied to gross in this declared-rate payroll path."
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
          <FormField label="Social insurance rate (%)" htmlFor="contract-social">
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
          <FormField label="Bank account reference" htmlFor="contract-bank">
            <TextInput
              id="contract-bank"
              value={bankAccountRef}
              onChange={(event) => setBankAccountRef(event.target.value)}
              placeholder="masked account reference"
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
        "Tax estimate updated",
        `Period withholding ${formatMoney(calculated.taxForPeriod, "CNY")}`,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Calculation failed.",
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
        <strong>Statutory estimate, not tax advice.</strong> This applies the
        public annual cumulative withholding brackets for China resident
        comprehensive income (3%–45%) to a steady monthly taxable base. Actual
        filings depend on cumulative income, special additional deductions and
        the employer's registered withholding profile.
      </InfoNotice>

      <div className="calculator-grid">
        <Panel
          title="Withholding calculator"
          subtitle="Cumulative method · basic deduction ¥5,000 per month"
        >
          <form onSubmit={calculate} className="stack">
            <div className="form-grid">
              <FormField label="Monthly gross income" htmlFor="tax-gross">
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
                label="Social insurance (monthly)"
                htmlFor="tax-social"
                hint="Employee contribution deducted before tax."
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
                label="Special additional deductions"
                htmlFor="tax-special"
                hint="Monthly amount, e.g. housing or education."
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
                label="Months elapsed in tax year"
                htmlFor="tax-months"
                hint="Cumulative months including the current one."
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
                label="Tax already withheld YTD"
                htmlFor="tax-withheld"
                hint="Sum of taxAmount on prior approved runs."
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
                <div className="coverage-cell__label">Monthly taxable</div>
                <div className="coverage-cell__value">
                  {formatMoney(monthlyTaxable, "CNY")}
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">Cumulative taxable</div>
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
                Calculate withholding
              </Button>
            </div>
          </form>
        </Panel>

        <Panel
          title="Period result"
          subtitle="Withholding due for the current month"
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
                  Tax due this period
                </div>
                <div className="calculator-result__value">
                  {formatMoney(result.taxForPeriod, "CNY", { decimals: 2 })}
                </div>
                <div className="calculator-result__row">
                  <span>Cumulative taxable income</span>
                  <strong>
                    {formatMoney(result.cumulativeTaxableIncome, "CNY", {
                      decimals: 2,
                    })}
                  </strong>
                </div>
                <div className="calculator-result__row">
                  <span>Annual tax due at bracket</span>
                  <strong>
                    {formatMoney(result.annualTaxDue, "CNY", { decimals: 2 })}
                  </strong>
                </div>
                <div className="calculator-result__row">
                  <span>Already withheld</span>
                  <strong>
                    {formatMoney(result.taxAlreadyWithheld, "CNY", {
                      decimals: 2,
                    })}
                  </strong>
                </div>
                <div className="calculator-result__row">
                  <span>Effective annual rate</span>
                  <strong>{formatPercent(effectiveRate, 1)}</strong>
                </div>
              </div>
              <p className="subtle" style={{ fontSize: 11.5 }}>
                Quick deduction {formatMoney(result.quickDeduction, "CNY")} ·
                Estimate only; verify against the statutory filing before use.
              </p>
            </div>
          ) : (
            <EmptyState
              icon="chart"
              title="No estimate yet"
              description="Enter income and deductions, then calculate to see the bracket and period withholding."
            />
          )}

          <div className="detail-section section-gap">
            <div className="detail-section__title">Annual cumulative brackets</div>
            <div className="bracket-list">
              <div className="bracket-row bracket-row--head">
                <span className="bracket-row__rate">Rate</span>
                <span className="bracket-row__range">Annual taxable income</span>
                <span className="bracket-row__deduction">Quick deduction</span>
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
