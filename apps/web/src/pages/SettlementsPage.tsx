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
import {
  displayName,
  formatDateTime,
  formatMoney,
  formatRelative,
  shortId,
  sum,
  titleCase,
} from "../lib/format.js";
import type {
  BudgetAllocation,
  BudgetPool,
  EvaluationCycle,
  LedgerEntry,
  SettlementBatch,
  SettlementCommandResult,
} from "../lib/types.js";

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
    { command: "RECONCILE", label: "Reconcile", variant: "primary" },
    { command: "CANCEL", label: "Cancel", variant: "danger" },
  ],
  RECONCILING: [
    { command: "SUBMIT", label: "Submit for approval", variant: "primary" },
    { command: "REQUIRE_ADJUSTMENT", label: "Require adjustment", variant: "danger" },
    { command: "CANCEL", label: "Cancel", variant: "danger" },
  ],
  PENDING_APPROVAL: [
    { command: "APPROVE", label: "Approve", variant: "primary" },
    { command: "CANCEL", label: "Cancel", variant: "danger" },
  ],
  APPROVED: [{ command: "LOCK", label: "Lock batch", variant: "primary" }],
  LOCKED: [{ command: "EXPORT", label: "Export CSV", variant: "primary" }],
  EXPORTED: [
    { command: "ACKNOWLEDGE", label: "Acknowledge", variant: "primary" },
    { command: "REQUIRE_ADJUSTMENT", label: "Require adjustment", variant: "danger" },
  ],
  ACKNOWLEDGED: [
    { command: "REQUIRE_ADJUSTMENT", label: "Require adjustment", variant: "danger" },
  ],
  ADJUSTMENT_REQUIRED: [
    { command: "RECONCILE", label: "Reconcile again", variant: "primary" },
  ],
};

const COMMAND_COPY: Record<Command, { title: string; description: string }> = {
  RECONCILE: {
    title: "Reconcile settlement batch",
    description: "Verifies every line against the locked ledger before approval.",
  },
  SUBMIT: {
    title: "Submit for approval",
    description: "Moves the reconciled batch into the approval queue.",
  },
  APPROVE: {
    title: "Approve settlement batch",
    description: "Records approval; if configured, provide the matching approval request.",
  },
  LOCK: {
    title: "Lock settlement batch",
    description: "Locks lines and prevents further changes before export.",
  },
  EXPORT: {
    title: "Export settlement batch",
    description: "Generates the settlement CSV and records export evidence.",
  },
  ACKNOWLEDGE: {
    title: "Acknowledge settlement export",
    description: "Records the external receipt reference for the exported file.",
  },
  REQUIRE_ADJUSTMENT: {
    title: "Require adjustment",
    description: "Marks the batch as needing correction and records the reason.",
  },
  CANCEL: {
    title: "Cancel settlement batch",
    description: "Deactivates the batch lines. Accepted or locked money is not deleted.",
  },
};

export function SettlementsPage() {
  useDocumentTitle("Settlements");
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
  const lockedTotal = sum(
    ledgerEntries
      .filter((entry) => entry.status === "LOCKED")
      .map((entry) => entry.amount),
  );

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
      toast.success("Settlement batch created", created.batchNo);
      setCreateOpen(false);
      setSelectedBatchId(created.id);
      batches.reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Could not create the batch.",
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
      setCommandError("An external receipt reference is required.");
      return;
    }
    if (command === "REQUIRE_ADJUSTMENT" && !commandReason.trim()) {
      setCommandError("A reason is required.");
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
            : "The command failed.",
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
      toast.success("Budget pool created", poolName);
      setSelectedPoolId(created.id);
      setPoolCreateOpen(false);
      pools.reload();
    } catch (caught) {
      setPoolError(
        caught instanceof Error ? caught.message : "Could not create the pool.",
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
      toast.success("Budget pool approved", approveTarget.name);
      setApproveTarget(null);
      pools.reload();
    } catch (caught) {
      toast.error(
        "Approval failed",
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
      toast.success("Allocation released", shortId(allocation.id));
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

  return (
    <>
      <PageHeader
        eyebrow="Money path"
        title="Settlements"
        description="Reconcile, approve, lock and export batches from locked ledger entries. The ledger hash chain and budget commitments stay visible beside the workflow."
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
            Refresh
          </Button>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Settlement batches</span>
          </div>
          <div className="stat-tile__value">{batchList.length}</div>
          <div className="stat-tile__detail">
            {batchList.filter((batch) => batch.status === "ACKNOWLEDGED").length}{" "}
            acknowledged
          </div>
        </div>
        <div className="stat-tile stat-tile--neutral">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Locked ledger total</span>
          </div>
          <div className="stat-tile__value">
            {formatMoney(lockedTotal, ledgerEntries[0]?.currency ?? "CNY", {
              compact: true,
            })}
          </div>
          <div className="stat-tile__detail">
            {ledgerEntries.filter((entry) => entry.status === "LOCKED").length}{" "}
            locked entries
          </div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Ledger chain</span>
          </div>
          <div className="stat-tile__value" style={{ fontSize: 22 }}>
            {ledgerVerify.loading ? (
              "Checking…"
            ) : ledgerVerify.data?.valid ? (
              <Badge tone="success">Verified</Badge>
            ) : (
              <Badge tone="danger">Attention</Badge>
            )}
          </div>
          <div className="stat-tile__detail">
            {ledgerEntries.length} append-only entries
          </div>
        </div>
      </div>

      <Tabs
        items={[
          { id: "batches", label: "Batches", count: batchList.length },
          { id: "ledger", label: "Ledger", count: ledgerEntries.length },
          { id: "budgets", label: "Budgets", count: poolList.length },
        ]}
        active={tab}
        onChange={setTab}
        label="Settlement views"
      />

      <div className="tab-panel">
        {tab === "batches" ? (
          <div className="payroll-detail-grid">
            <Panel
              title="Settlement batches"
              subtitle="Select a batch to run the money-path workflow"
              action={
                <Button size="sm" variant="primary" icon="plus" onClick={openCreate}>
                  New batch
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
                  title="No settlement batch"
                  description="Create a batch from a cycle with locked ledger entries."
                  action={
                    <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                      Create batch
                    </Button>
                  }
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table table-clickable">
                    <thead>
                      <tr>
                        <th>Batch</th>
                        <th>Status</th>
                        <th className="cell-num">Total</th>
                        <th className="cell-num">Lines</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchList.map((batch) => (
                        <tr
                          key={batch.id}
                          className={selectedBatchId === batch.id ? "is-selected" : ""}
                          onClick={() => setSelectedBatchId(batch.id)}
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
                <Panel title="Batch detail">
                  <EmptyState
                    icon="layers"
                    title="Select a batch"
                    description="Open a batch to reconcile, approve, lock or export it."
                  />
                </Panel>
              ) : detail.error ? (
                <Panel title="Batch detail">
                  <ErrorNotice error={detail.error} onRetry={detail.reload} />
                </Panel>
              ) : detail.loading || !detail.data ? (
                <Panel title="Batch detail">
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
                      <div className="coverage-cell__label">Total</div>
                      <div className="coverage-cell__value">
                        {formatMoney(detail.data.totalAmount, detail.data.currency)}
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Lines</div>
                      <div className="coverage-cell__value">
                        {detail.data.lineCount}
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Exported</div>
                      <div className="coverage-cell__value" style={{ fontSize: 14 }}>
                        {detail.data.exportedAt
                          ? formatRelative(detail.data.exportedAt)
                          : "Not yet"}
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Acknowledged</div>
                      <div className="coverage-cell__value" style={{ fontSize: 14 }}>
                        {detail.data.acknowledgedAt
                          ? formatRelative(detail.data.acknowledgedAt)
                          : "Not yet"}
                      </div>
                    </div>
                  </div>

                  <div className="detail-section">
                    <div className="detail-section__title">Commands</div>
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
                    <div className="detail-section__title">Lines</div>
                    {(detail.data.lines?.length ?? 0) === 0 ? (
                      <p className="muted">No lines in this batch.</p>
                    ) : (
                      <div className="table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Person</th>
                              <th className="cell-num">Amount</th>
                              <th>Status</th>
                              <th>Ledger</th>
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
                                    {line.active ? line.status : "Inactive"}
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
            title="Ledger entries"
            subtitle="Append-only; locked entries cannot be edited"
            action={
              <div className="toolbar__group">
                <SearchInput
                  value={ledgerSearch}
                  onChange={setLedgerSearch}
                  placeholder="Search person, cycle or entry"
                />
                <Select
                  value={ledgerStatus}
                  onChange={(event) => setLedgerStatus(event.target.value)}
                  aria-label="Ledger status"
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
                title="No ledger entry"
                description="Entries appear after a calculation run is approved and locked."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Entry</th>
                      <th>Person</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th className="cell-num">Amount</th>
                      <th>Created</th>
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
              title="Budget pools"
              subtitle="Approved pools fund formal calculations"
              action={
                <Button size="sm" variant="primary" icon="plus" onClick={openPoolCreate}>
                  New pool
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
                  title="No budget pool"
                  description="Create and approve a pool before budgeting formal incentives."
                  action={
                    <Button variant="primary" size="sm" icon="plus" onClick={openPoolCreate}>
                      Create pool
                    </Button>
                  }
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table table-clickable">
                    <thead>
                      <tr>
                        <th>Pool</th>
                        <th>Status</th>
                        <th className="cell-num">Approved</th>
                        <th className="cell-num">Committed</th>
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
                                Approve
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
              action={selectedPool ? <Badge status={selectedPool.status} /> : null}
            >
              {!selectedPool ? (
                <EmptyState
                  icon="chart"
                  title="No pool selected"
                  description="Open a pool to see committed allocations and release them when needed."
                />
              ) : (
                <>
                  <div className="coverage-grid">
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Approved</div>
                      <div className="coverage-cell__value">
                        {formatMoney(
                          selectedPool.approvedAmount,
                          selectedPool.currency,
                        )}
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Committed</div>
                      <div className="coverage-cell__value">
                        {formatMoney(
                          selectedPool.committedAmount,
                          selectedPool.currency,
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="detail-section">
                    <div className="detail-section__title">Allocations</div>
                    {allocations.error ? (
                      <ErrorNotice
                        error={allocations.error}
                        onRetry={allocations.reload}
                      />
                    ) : allocations.loading ? (
                      <LoadingRows rows={3} />
                    ) : (allocations.data?.length ?? 0) === 0 ? (
                      <p className="muted">No allocation recorded.</p>
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
                                Release
                              </Button>
                            ) : (
                              <Badge tone="neutral">Released</Badge>
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
        ) : null}
      </div>

      <Modal
        open={createOpen}
        title="New settlement batch"
        description="Batches collect locked ledger entries for a cycle."
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-batch-form"
              loading={submitting}
            >
              Create batch
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
          <FormField label="Cycle" htmlFor="batch-cycle" className="field--full">
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
              <option value="STANDARD">Standard</option>
              <option value="RECOVERY">Recovery</option>
            </Select>
          </FormField>
          <FormField label="Currency" htmlFor="batch-currency">
            <TextInput
              id="batch-currency"
              value={currency}
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
          </FormField>
          <FormField
            label="Batch number (optional)"
            htmlFor="batch-number"
            className="field--full"
            hint="Leave blank to use the generated number."
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
          commandTarget ? COMMAND_COPY[commandTarget.command].title : "Command"
        }
        description={
          commandTarget ? COMMAND_COPY[commandTarget.command].description : undefined
        }
        onClose={() => setCommandTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCommandTarget(null)}>
              Cancel
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
                { label: "Batch", value: commandTarget.batch.batchNo },
                {
                  label: "Total",
                  value: formatMoney(
                    commandTarget.batch.totalAmount,
                    commandTarget.batch.currency,
                  ),
                },
                {
                  label: "Status",
                  value: <Badge status={commandTarget.batch.status} />,
                },
              ]}
            />
            {commandTarget.command === "ACKNOWLEDGE" ? (
              <FormField
                label="External reference"
                htmlFor="command-reference"
                hint="Bank or payment-provider receipt."
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
                    ? "Reason (required)"
                    : "Reason (optional)"
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
                label="Approval request id (optional)"
                htmlFor="command-approval"
                hint="Required only when this action is configured for approval."
              >
                <TextInput
                  id="command-approval"
                  value={approvalRequestId}
                  onChange={(event) => setApprovalRequestId(event.target.value)}
                />
              </FormField>
            ) : null}
            {commandTarget.command !== "RECONCILE" ? (
              <FormField label="Actor person" htmlFor="command-actor">
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
        title="New budget pool"
        description="A pool becomes available to formal calculations after approval."
        onClose={() => setPoolCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPoolCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-pool-form"
              loading={submitting}
            >
              Create pool
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
          <FormField label="Cycle" htmlFor="pool-cycle" className="field--full">
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
          <FormField label="Code" htmlFor="pool-code">
            <TextInput
              id="pool-code"
              value={poolCode}
              onChange={(event) => setPoolCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Name" htmlFor="pool-name">
            <TextInput
              id="pool-name"
              value={poolName}
              onChange={(event) => setPoolName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Pool type" htmlFor="pool-type">
            <TextInput
              id="pool-type"
              value={poolType}
              onChange={(event) => setPoolType(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Currency" htmlFor="pool-currency">
            <TextInput
              id="pool-currency"
              value={poolCurrency}
              maxLength={3}
              onChange={(event) => setPoolCurrency(event.target.value.toUpperCase())}
              required
            />
          </FormField>
          <FormField label="Approved amount" htmlFor="pool-amount" className="field--full">
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
        title="Approve budget pool"
        description="Approval makes the pool available to formal calculations."
        onClose={() => setApproveTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setApproveTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={approvePool} loading={submitting}>
              Approve pool
            </Button>
          </>
        }
      >
        {approveTarget ? (
          <div className="stack">
            <DefinitionList
              items={[
                { label: "Pool", value: approveTarget.name },
                { label: "Code", value: approveTarget.code },
                {
                  label: "Amount",
                  value: formatMoney(
                    approveTarget.approvedAmount,
                    approveTarget.currency,
                  ),
                },
              ]}
            />
            <FormField label="Approved by" htmlFor="pool-approver">
              <PersonSelect
                id="pool-approver"
                value={approvedBy}
                onChange={setApprovedBy}
              />
            </FormField>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
