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
import { ApiError, api, downloadJson } from "../lib/api.js";
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

export function CyclesPage() {
  useDocumentTitle("Cycles");
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
  const [exporting, setExporting] = useState(false);
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
      toast.success("Calculation run created", runMode);
      setRunOpen(false);
      runs.reload();
      readiness.reload();
    } catch (caught) {
      setRunError(
        caught instanceof ApiError ? caught.message : "Could not create the run",
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
        command === "approve" ? "Run approved" : "Run locked",
        shortId(runId),
      );
      runs.reload();
      readiness.reload();
    } catch (caught) {
      toast.error(
        command === "approve" ? "Approval failed" : "Lock failed",
        caught instanceof ApiError ? caught.message : "Request failed",
      );
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!selectedId && cycleList[0]?.id) setSelectedId(cycleList[0].id);
  }, [cycleList, selectedId]);

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
      toast.success("Cycle created", name);
      setCreateOpen(false);
      setSelectedId(created.id);
      cycles.reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Could not create the cycle.",
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
        `/api/v1/evidence-packages/${selectedId}`,
      );
      downloadJson(
        evidencePackage,
        `evidence-package-${selectedId}.json`,
      );
      toast.success(
        "Evidence package downloaded",
        "Includes legal gates, decisions, settlements, ledger and audit events.",
      );
    } catch (caught) {
      toast.error(
        "Could not build the evidence package",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setExporting(false);
    }
  }

  async function submitDraft(draft: EvaluationDraft) {
    setBusy(draft.id);
    try {
      await api(`/api/v1/evaluation-drafts/${draft.id}/submit`, {
        method: "POST",
      });
      toast.success("Draft submitted for review", shortId(draft.id));
      drafts.reload();
      setDetailDraft(null);
    } catch (caught) {
      toast.error(
        "Could not submit the draft",
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
        throw new Error("scores must be an object of numbers between 0 and 5");
      }
      scores = parsed as Record<string, number>;
    } catch (caught) {
      setReviewError(
        caught instanceof Error ? caught.message : "Scores must be valid JSON.",
      );
      return;
    }
    if (!reviewRubric) {
      setReviewError("A rubric version is required.");
      return;
    }
    if (rationale.trim().length < 3) {
      setReviewError("A rationale of at least 3 characters is required.");
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
        },
      });
      toast.success(
        decision === "APPROVE" ? "Evaluation approved" : "Draft rejected",
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
            : "Could not record the decision.",
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
        eyebrow="Evaluation operations"
        title="Cycles"
        description="Run evaluation periods, review evidence-bound drafts and issue human decisions. Drafts never become formal decisions without a reviewer."
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
              Refresh
            </Button>
            <Button
              variant="secondary"
              icon="download"
              onClick={exportEvidencePackage}
              loading={exporting}
              disabled={!selectedId}
            >
              Evidence pack
            </Button>
            <Button variant="primary" icon="plus" onClick={openCreate}>
              New cycle
            </Button>
          </>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Cycles</span>
          </div>
          <div className="stat-tile__value">{cycleList.length}</div>
          <div className="stat-tile__detail">
            {cycleList.filter((cycle) => !["CLOSED", "ARCHIVED"].includes(cycle.status))
              .length}{" "}
            not closed
          </div>
        </div>
        <div className="stat-tile stat-tile--warning">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Drafts in review</span>
          </div>
          <div className="stat-tile__value">{pendingDrafts.length}</div>
          <div className="stat-tile__detail">Submitted, awaiting a decision</div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Approved decisions</span>
          </div>
          <div className="stat-tile__value">{approvedDecisions.length}</div>
          <div className="stat-tile__detail">Versioned and reviewer-attributed</div>
        </div>
      </div>

      {cycles.error ? (
        <ErrorNotice error={cycles.error} onRetry={cycles.reload} />
      ) : cycles.loading ? (
        <Panel title="Cycles">
          <LoadingRows rows={4} />
        </Panel>
      ) : cycleList.length === 0 ? (
        <Panel>
          <EmptyState
            icon="layers"
            title="No evaluation cycle"
            description="Create a cycle to bind evaluation drafts, policy versions and settlement."
            action={
              <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                Create cycle
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="split-grid">
            <Panel title="Evaluation cycles" subtitle="Select a cycle to inspect its evidence" flush>
              <div className="table-wrap">
                <table className="data-table table-clickable">
                  <thead>
                    <tr>
                      <th>Cycle</th>
                      <th>Status</th>
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
              title={selected ? `${selected.name} readiness` : "Cycle readiness"}
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
                      ? "Settlement ready"
                      : "Not ready"}
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
                      <div className="coverage-cell__label">Calculations</div>
                      <div className="coverage-cell__value">
                        {readiness.data.calculations.total}
                      </div>
                      <div className="coverage-cell__sub">
                        {readiness.data.calculations.formalLocked} formal locked
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Legal gates</div>
                      <div className="coverage-cell__value">
                        {
                          readiness.data.legalGates.filter((gate) => gate.recorded)
                            .length
                        }
                        /{readiness.data.legalGates.length}
                      </div>
                      <div className="coverage-cell__sub">recorded</div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Settlement</div>
                      <div className="coverage-cell__value">
                        {readiness.data.settlement.total}
                      </div>
                      <div className="coverage-cell__sub">
                        {readiness.data.settlement.acknowledged} acknowledged
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Budgets</div>
                      <div className="coverage-cell__value">
                        {readiness.data.budgets.approved}/
                        {readiness.data.budgets.pools}
                      </div>
                      <div className="coverage-cell__sub">approved pools</div>
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
                        <strong>Settlement ready</strong>
                        <p>
                          A formal locked calculation satisfies the recorded
                          readiness checks.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="notice notice--warning section-gap">
                      <Icon name="alert-circle" size={18} />
                      <div>
                        <strong>Not settlement ready</strong>
                        <p>
                          No explicit blocker is recorded, but the cycle still
                          needs a formal locked calculation and its downstream
                          checks.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </Panel>
          </div>

          <div className="split-grid section-gap">
            <Panel
              title="Evaluation drafts"
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
                  title="No draft for this cycle"
                  description="Drafts are contributed by people or agents and must cite an evidence snapshot."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Source</th>
                        <th>Status</th>
                        <th>Updated</th>
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
                              Open
                            </Button>
                            {draft.status === "SUBMITTED" ? (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => openReview(draft)}
                              >
                                Review
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

            <Panel title="Approved decisions" subtitle="Human decisions only" flush>
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
                  title="No decision for this cycle"
                  description="Approving a submitted draft creates a versioned decision attributed to the reviewer."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Version</th>
                        <th>Status</th>
                        <th>Approved</th>
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
            title="Calculation runs"
            subtitle={selected ? `Formal and shadow runs for ${selected.name}` : undefined}
            flush
            action={
              <Button size="sm" variant="primary" icon="plus" onClick={openRunModal}>
                New run
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
                title="No calculation run for this cycle"
                description="Create a shadow or formal run once claims are decided and the legal gate is recorded."
                action={
                  <Button size="sm" variant="primary" icon="plus" onClick={openRunModal}>
                    Create run
                  </Button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Mode</th>
                      <th>Status</th>
                      <th>Lines</th>
                      <th>Blockers</th>
                      <th>Created</th>
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
                              {expandedRunId === run.id ? "Hide" : "Details"}
                            </Button>
                            {run.status === "CALCULATED" ? (
                              <Button
                                size="sm"
                                variant="primary"
                                loading={busy === `approve:${run.id}`}
                                onClick={() => runCommand(run.id, "approve")}
                              >
                                Approve
                              </Button>
                            ) : null}
                            {run.status === "APPROVED" ? (
                              <Button
                                size="sm"
                                variant="primary"
                                loading={busy === `lock:${run.id}`}
                                onClick={() => runCommand(run.id, "lock")}
                              >
                                Lock
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
                                      label: "Result hash",
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
                                          <th>Person</th>
                                          <th>Line</th>
                                          <th>Raw</th>
                                          <th>Rounded</th>
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
        title="New evaluation cycle"
        description="A cycle binds a policy version, rubric, evaluation drafts and settlement period."
        onClose={() => setCreateOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-cycle-form"
              loading={submitting}
            >
              Create cycle
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
          <FormField label="Name" htmlFor="cycle-name" className="field--full">
            <TextInput
              id="cycle-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="FY27 Q1 incentive cycle"
              required
            />
          </FormField>
          <FormField label="Cycle type" htmlFor="cycle-type">
            <Select
              id="cycle-type"
              value={cycleType}
              onChange={(event) => setCycleType(event.target.value)}
            >
              {CYCLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Timezone" htmlFor="cycle-timezone">
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
          <FormField label="Starts" htmlFor="cycle-start">
            <TextInput
              id="cycle-start"
              type="date"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Ends" htmlFor="cycle-end">
            <TextInput
              id="cycle-end"
              type="date"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Policy version" htmlFor="cycle-policy">
            <Select
              id="cycle-policy"
              value={policyVersionId}
              onChange={(event) => setPolicyVersionId(event.target.value)}
            >
              <option value="">Not bound yet</option>
              {(policies.data ?? []).map((policy) => (
                <option key={policy.policyVersionId} value={policy.policyVersionId}>
                  {policy.code} v{policy.version} · {policy.status}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Rubric version" htmlFor="cycle-rubric">
            <Select
              id="cycle-rubric"
              value={rubricVersionId}
              onChange={(event) => setRubricVersionId(event.target.value)}
            >
              <option value="">Not bound yet</option>
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
        open={runOpen}
        title="New calculation run"
        description="A legal gate must be recorded before a formal run. Participants must have decided claims."
        onClose={() => setRunOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setRunOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-run-form"
              loading={runSubmitting}
            >
              Create run
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
          <FormField label="Mode" htmlFor="run-mode">
            <Select
              id="run-mode"
              value={runMode}
              onChange={(event) =>
                setRunMode(event.target.value as "SHADOW" | "FORMAL")
              }
            >
              <option value="FORMAL">Formal</option>
              <option value="SHADOW">Shadow</option>
            </Select>
          </FormField>
          <FormField label="Policy version" htmlFor="run-policy">
            <Select
              id="run-policy"
              value={runPolicyVersionId}
              onChange={(event) => setRunPolicyVersionId(event.target.value)}
              required
            >
              <option value="">Select a policy version</option>
              {(policies.data ?? []).map((policy) => (
                <option key={policy.policyVersionId} value={policy.policyVersionId}>
                  {policy.code} v{policy.version}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Order id" htmlFor="run-order-id">
            <TextInput
              id="run-order-id"
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Order gross profit" htmlFor="run-order-profit">
            <TextInput
              id="run-order-profit"
              value={orderGrossProfit}
              onChange={(event) => setOrderGrossProfit(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Currency" htmlFor="run-order-currency">
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
              <strong>Participants</strong>
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
                Add participant
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
                <FormField label="Work package">
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
                    <option value="">Select a package</option>
                    {(workPackages.data ?? []).map((workPackage) => (
                      <option key={workPackage.id} value={workPackage.id}>
                        {workPackage.title}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Weight">
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
                <FormField label="Role">
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
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </form>
      </Modal>

      <Modal
        open={Boolean(detailDraft)}
        title="Evaluation draft"
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
                Close
              </Button>
              {detailDraft.status === "DRAFT" ? (
                <Button
                  variant="primary"
                  onClick={() => submitDraft(detailDraft)}
                  loading={busy === detailDraft.id}
                >
                  Submit for review
                </Button>
              ) : detailDraft.status === "SUBMITTED" ? (
                <Button variant="primary" onClick={() => openReview(detailDraft)}>
                  Review draft
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
                  label: "Source",
                  value: `${detailDraft.generatedByType}${
                    detailDraft.modelName
                      ? ` · ${detailDraft.modelProvider} ${detailDraft.modelName}`
                      : ""
                  }`,
                },
                {
                  label: "Evidence snapshot",
                  value: (
                    <span className="mono">
                      {shortId(detailDraft.evidenceSnapshotHash, 20)}
                    </span>
                  ),
                },
                { label: "Status", value: <Badge status={detailDraft.status} /> },
                {
                  label: "Updated",
                  value: formatDateTime(detailDraft.updatedAt),
                },
              ]}
            />
            {detailDraft.strengths.length > 0 ? (
              <div className="detail-section">
                <div className="detail-section__title">Strengths</div>
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
                <div className="detail-section__title">Counter-evidence</div>
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
                <div className="detail-section__title">Missing information</div>
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
              <div className="detail-section__title">Draft payload</div>
              <pre className="code-block">
                {JSON.stringify(detailDraft.draftPayload, null, 2)}
              </pre>
            </div>
            <div className="detail-section">
              <div className="detail-section__title">Uncertainty</div>
              <pre className="code-block">
                {JSON.stringify(detailDraft.uncertainty ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(reviewDraft)}
        title="Review evaluation draft"
        description="Approving writes a versioned decision. The reviewer must not be the draft subject."
        onClose={() => setReviewDraft(null)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewDraft(null)}>
              Cancel
            </Button>
            <Button
              variant={decision === "REJECT" ? "danger" : "primary"}
              onClick={submitDecision}
              loading={submitting}
            >
              {decision === "REJECT" ? "Reject draft" : "Approve evaluation"}
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
                  label: "Person",
                  value: displayName(reviewDraft.personId, people),
                },
                {
                  label: "Evidence",
                  value: (
                    <span className="mono">
                      {shortId(reviewDraft.evidenceSnapshotHash, 20)}
                    </span>
                  ),
                },
                {
                  label: "Draft version",
                  value: `v${reviewDraft.version}`,
                },
              ]}
            />
            <div className="form-grid">
              <FormField label="Decision" htmlFor="draft-decision">
                <Select
                  id="draft-decision"
                  value={decision}
                  onChange={(event) =>
                    setDecision(event.target.value as "APPROVE" | "REJECT")
                  }
                >
                  <option value="APPROVE">Approve</option>
                  <option value="REJECT">Reject</option>
                </Select>
              </FormField>
              <FormField label="Reviewer" htmlFor="draft-reviewer">
                <PersonSelect
                  id="draft-reviewer"
                  value={reviewer}
                  onChange={setReviewer}
                />
              </FormField>
              <FormField
                label="Rubric version"
                htmlFor="draft-rubric"
                className="field--full"
                hint="The decision records this exact rubric version."
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
                    placeholder="Rubric version UUID"
                    required
                  />
                )}
              </FormField>
              <FormField
                label="Scores (JSON)"
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
                label="Rationale"
                htmlFor="draft-rationale"
                className="field--full"
                hint="At least 3 characters; retained with the decision."
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
