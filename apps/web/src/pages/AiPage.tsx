import { useState } from "react";
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
  Textarea,
} from "../components/ui.js";
import { PersonSelect, usePeople } from "../components/PersonSelect.js";
import { Icon } from "../components/Icon.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  displayName,
  formatDateTime,
  formatPercent,
  formatRelative,
  shortId,
  titleCase,
} from "../lib/format.js";
import type {
  AiScoreProposal,
  ModelEvaluationRun,
  ModelPrompt,
} from "../lib/types.js";

const TABS = [
  { id: "PENDING", label: "Pending" },
  { id: "ACCEPTED", label: "Accepted" },
  { id: "REJECTED", label: "Rejected" },
  { id: "ALL", label: "All" },
];

export function AiPage() {
  useDocumentTitle("AI assurance");
  const { session } = useAuth();
  const toast = useToast();
  const { people } = usePeople();
  const proposals = useApiQuery<AiScoreProposal[]>("/api/v1/ai-score-proposals");
  const prompts = useApiQuery<ModelPrompt[]>("/api/v1/model-prompts");
  const evaluations = useApiQuery<ModelEvaluationRun[]>(
    "/api/v1/model-evaluation-runs",
  );
  const [tab, setTab] = useState("proposals");
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [selected, setSelected] = useState<AiScoreProposal | null>(null);
  const [decision, setDecision] = useState<"ACCEPT" | "REJECT">("ACCEPT");
  const [decidedBy, setDecidedBy] = useState(session.personId);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [promptDetail, setPromptDetail] = useState<ModelPrompt | null>(null);
  const [evaluationDetail, setEvaluationDetail] =
    useState<ModelEvaluationRun | null>(null);

  const proposalList = proposals.data ?? [];
  const promptList = prompts.data ?? [];
  const evaluationList = evaluations.data ?? [];
  const harnessPassed = evaluationList.filter(
    (run) => run.metrics.harnessVersion === "ai-gate-v1" && run.passed,
  ).length;
  const visible =
    statusFilter === "ALL"
      ? proposalList
      : proposalList.filter((proposal) => proposal.status === statusFilter);
  const pending = proposalList.filter(
    (proposal) => proposal.status === "PENDING",
  );
  const averageConfidence =
    pending.length > 0
      ? pending.reduce((total, proposal) => total + proposal.confidence, 0) /
        pending.length
      : 0;

  function openReview(proposal: AiScoreProposal) {
    setSelected(proposal);
    setDecision("ACCEPT");
    setDecidedBy(session.personId);
    setNote("");
    setActionError(null);
  }

  async function submitDecision() {
    if (!selected) return;
    if (decision === "REJECT" && !note.trim()) {
      setActionError("A note is required when rejecting a score proposal.");
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      await api(`/api/v1/ai-score-proposals/${selected.id}/decide`, {
        method: "POST",
        body: {
          decision,
          decidedBy,
          note: note.trim() || undefined,
        },
      });
      toast.success(
        decision === "ACCEPT" ? "Score accepted" : "Score rejected",
        `${shortId(selected.id)} · ${selected.overallScore}/5`,
      );
      setSelected(null);
      proposals.reload();
    } catch (caught) {
      setActionError(
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

  return (
    <>
      <PageHeader
        eyebrow="Human-in-the-loop scoring"
        title="AI assurance"
        description="Model output is always a proposal. Numeric scores require a passed evaluation gate, evidence citations and an explicit human decision before they enter a formal evaluation."
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => {
              proposals.reload();
              prompts.reload();
              evaluations.reload();
            }}
            loading={proposals.loading || prompts.loading || evaluations.loading}
          >
            Refresh
          </Button>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--warning">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Awaiting review</span>
          </div>
          <div className="stat-tile__value">{pending.length}</div>
          <div className="stat-tile__detail">Proposals never auto-accept</div>
        </div>
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Mean confidence</span>
          </div>
          <div className="stat-tile__value">{formatPercent(averageConfidence)}</div>
          <div className="stat-tile__detail">Across pending proposals</div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Active prompts</span>
          </div>
          <div className="stat-tile__value">
            {promptList.filter((prompt) => prompt.status === "ACTIVE").length}
          </div>
          <div className="stat-tile__detail">
            {promptList.length} registered versions · {harnessPassed} harness
            passes
          </div>
        </div>
      </div>

      <Tabs
        items={[
          { id: "proposals", label: "Score proposals", count: proposalList.length },
          { id: "prompts", label: "Prompt registry", count: promptList.length },
          {
            id: "evaluations",
            label: "Evaluation runs",
            count: evaluationList.length,
          },
        ]}
        active={tab}
        onChange={setTab}
        label="AI assurance views"
      />

      <div className="tab-panel">
        {tab === "proposals" ? (
          <Panel
            title="Score proposals"
            subtitle="Numeric scores stay proposals until a human accepts them"
            action={
              <div className="toolbar__group">
                <Select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  aria-label="Filter proposal status"
                  style={{ width: 140, height: 34 }}
                >
                  {TABS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </div>
            }
            flush
          >
            {proposals.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={proposals.error} onRetry={proposals.reload} />
              </div>
            ) : proposals.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={4} />
              </div>
            ) : visible.length === 0 ? (
              <EmptyState
                icon="ai"
                title={statusFilter === "PENDING" ? "No proposal waiting" : "No proposal in this view"}
                description="Proposals are created only after a model evaluation gate passes. Accepted scores are attributed to the human reviewer."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Model</th>
                      <th className="cell-num">Score</th>
                      <th className="cell-num">Confidence</th>
                      <th>Evidence</th>
                      <th>Created</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((proposal) => (
                      <tr key={proposal.id}>
                        <td>
                          <span className="cell-primary">
                            {displayName(proposal.personId, people)}
                          </span>
                          <span className="cell-sub mono">
                            cycle {shortId(proposal.cycleId, 10)}
                          </span>
                        </td>
                        <td>
                          <span>{proposal.modelName}</span>
                          <span className="cell-sub">
                            {proposal.modelProvider} · {proposal.promptVersion}
                          </span>
                        </td>
                        <td className="cell-num">
                          {proposal.overallScore.toFixed(2)} / 5
                        </td>
                        <td className="cell-num">
                          {formatPercent(proposal.confidence)}
                        </td>
                        <td>{proposal.evidenceRefs.length} refs</td>
                        <td className="nowrap">
                          {formatRelative(proposal.createdAt)}
                        </td>
                        <td>
                          <Badge status={proposal.status} />
                        </td>
                        <td className="cell-actions">
                          {proposal.status === "PENDING" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => openReview(proposal)}
                            >
                              Review
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openReview(proposal)}
                            >
                              View
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
        ) : tab === "prompts" ? (
          <Panel
            title="Prompt registry"
            subtitle="Prompts activate only after an evaluation run passes"
            flush
          >
            {prompts.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={prompts.error} onRetry={prompts.reload} />
              </div>
            ) : prompts.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={3} />
              </div>
            ) : promptList.length === 0 ? (
              <EmptyState
                icon="policy"
                title="No prompt registered"
                description="Register a prompt version, run its evaluation, then activate it. Score proposals can only cite an active prompt."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Prompt</th>
                      <th>Purpose</th>
                      <th>Model</th>
                      <th>Template hash</th>
                      <th>Status</th>
                      <th>Activated</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {promptList.map((prompt) => (
                      <tr key={prompt.id}>
                        <td>
                          <span className="cell-primary">{prompt.promptCode}</span>
                          <span className="cell-sub">v{prompt.version}</span>
                        </td>
                        <td>{prompt.purpose}</td>
                        <td>
                          <span>{prompt.modelName}</span>
                          <span className="cell-sub">{prompt.modelProvider}</span>
                        </td>
                        <td>
                          <span className="chip mono">
                            {shortId(prompt.templateHash, 10)}
                          </span>
                        </td>
                        <td>
                          <Badge status={prompt.status} />
                        </td>
                        <td className="nowrap">
                          {prompt.activatedAt
                            ? formatRelative(prompt.activatedAt)
                            : "—"}
                        </td>
                        <td className="cell-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPromptDetail(prompt)}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : null}
        {tab === "evaluations" ? (
          <Panel
            title="Evaluation runs"
            subtitle="Pass/fail is computed by the gated harness; imported records cannot unlock activation or scoring"
            flush
          >
            {evaluations.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={evaluations.error} onRetry={evaluations.reload} />
              </div>
            ) : evaluations.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={4} />
              </div>
            ) : evaluationList.length === 0 ? (
              <EmptyState
                icon="chart"
                title="No evaluation run"
                description="Run the harness with a labelled gold set before activating a prompt or using numeric score proposals."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Evaluation</th>
                      <th>Model</th>
                      <th className="cell-num">Samples</th>
                      <th>Harness</th>
                      <th>Result</th>
                      <th>Evaluated</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {evaluationList.map((run) => (
                      <tr key={run.id}>
                        <td>
                          <span className="cell-primary">{run.evaluationType}</span>
                          <span className="cell-sub mono">
                            {run.datasetRef} · {shortId(run.id, 10)}
                          </span>
                        </td>
                        <td>
                          {run.modelName}
                          <span className="cell-sub">
                            {run.modelProvider} · prompt {run.promptVersion}
                          </span>
                        </td>
                        <td className="cell-num">{run.sampleSize}</td>
                        <td>
                          {run.metrics.harnessVersion === "ai-gate-v1" ? (
                            <Badge tone="accent">Verified</Badge>
                          ) : (
                            <Badge tone="warning">Imported</Badge>
                          )}
                        </td>
                        <td>
                          <Badge
                            tone={run.passed ? "success" : "danger"}
                          >
                            {run.passed ? "Passed" : "Blocked"}
                          </Badge>
                        </td>
                        <td className="nowrap">
                          {formatRelative(run.evaluatedAt)}
                        </td>
                        <td className="cell-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEvaluationDetail(run)}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : null}
      </div>

      <Modal
        open={Boolean(selected)}
        title="Score proposal"
        description={
          selected
            ? `${displayName(selected.personId, people)} · ${selected.modelProvider} ${selected.modelName}`
            : undefined
        }
        onClose={() => setSelected(null)}
        wide
        footer={
          selected?.status === "PENDING" ? (
            <>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Cancel
              </Button>
              <Button
                variant={decision === "REJECT" ? "danger" : "primary"}
                onClick={submitDecision}
                loading={submitting}
              >
                {decision === "REJECT" ? "Reject score" : "Accept score"}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Close
            </Button>
          )
        }
      >
        {selected ? (
          <div className="stack">
            {actionError ? (
              <InfoNotice tone="warning">{actionError}</InfoNotice>
            ) : null}
            <div className="coverage-grid">
              <div className="coverage-cell">
                <div className="coverage-cell__label">Overall score</div>
                <div className="coverage-cell__value">
                  {selected.overallScore.toFixed(2)} / 5
                </div>
                <div className="coverage-cell__sub">proposal only</div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">Confidence</div>
                <div className="coverage-cell__value">
                  {formatPercent(selected.confidence)}
                </div>
                <div className="coverage-cell__sub">evidence weighting</div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">Evidence</div>
                <div className="coverage-cell__value">
                  {selected.evidenceRefs.length}
                </div>
                <div className="coverage-cell__sub">cited references</div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">Status</div>
                <div className="coverage-cell__value" style={{ fontSize: 15 }}>
                  <Badge status={selected.status} />
                </div>
                <div className="coverage-cell__sub">
                  {selected.decidedAt
                    ? formatDateTime(selected.decidedAt)
                    : "awaiting review"}
                </div>
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section__title">Dimension scores</div>
              <div className="stack" style={{ gap: 4 }}>
                {Object.entries(selected.scores).map(([dimension, score]) => (
                  <div className="score-row" key={dimension}>
                    <span className="score-row__label">{titleCase(dimension)}</span>
                    <span className="score-row__track">
                      <span
                        className="score-row__fill"
                        style={{
                          display: "block",
                          width: `${Math.min(100, (score / 5) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="score-row__value">{score.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section__title">Rationale</div>
              <div className="reason-box">{selected.rationale}</div>
            </div>

            <div className="detail-section">
              <div className="detail-section__title">Evidence references</div>
              {selected.evidenceRefs.length === 0 ? (
                <p className="muted">No evidence reference recorded.</p>
              ) : (
                <div className="chip-row">
                  {selected.evidenceRefs.map((reference) => (
                    <span className="chip" key={reference}>
                      {reference}
                    </span>
                  ))}
                </div>
              )}
              <p className="subtle" style={{ fontSize: 11.5, marginTop: 8 }}>
                Snapshot {shortId(selected.evidenceSnapshotHash, 16)}
              </p>
            </div>

            <div className="detail-section">
              <div className="detail-section__title">Gate metrics</div>
              <pre className="code-block">
                {JSON.stringify(selected.gateMetrics ?? {}, null, 2)}
              </pre>
            </div>

            {selected.status === "PENDING" ? (
              <div className="detail-section">
                <div className="detail-section__title">Human decision</div>
                <div className="form-grid">
                  <FormField label="Decision" htmlFor="ai-decision">
                    <Select
                      id="ai-decision"
                      value={decision}
                      onChange={(event) =>
                        setDecision(event.target.value as "ACCEPT" | "REJECT")
                      }
                    >
                      <option value="ACCEPT">Accept proposal</option>
                      <option value="REJECT">Reject proposal</option>
                    </Select>
                  </FormField>
                  <FormField label="Decided by" htmlFor="ai-decider">
                    <PersonSelect
                      id="ai-decider"
                      value={decidedBy}
                      onChange={setDecidedBy}
                    />
                  </FormField>
                  <FormField
                    label={decision === "REJECT" ? "Note (required)" : "Note (optional)"}
                    htmlFor="ai-note"
                    className="field--full"
                  >
                    <Textarea
                      id="ai-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="What did you check before deciding?"
                    />
                  </FormField>
                </div>
              </div>
            ) : selected.decisionNote ? (
              <div className="detail-section">
                <div className="detail-section__title">Decision note</div>
                <div className="reason-box">{selected.decisionNote}</div>
                <p className="subtle" style={{ fontSize: 11.5, marginTop: 6 }}>
                  Decided by {displayName(selected.decidedBy, people)}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(promptDetail)}
        title={promptDetail ? `Prompt ${promptDetail.promptCode}` : "Prompt"}
        description={promptDetail?.purpose}
        onClose={() => setPromptDetail(null)}
        wide
        footer={
          <Button variant="secondary" onClick={() => setPromptDetail(null)}>
            Close
          </Button>
        }
      >
        {promptDetail ? (
          <div className="stack">
            <DefinitionList
              items={[
                {
                  label: "Model",
                  value: `${promptDetail.modelProvider} · ${promptDetail.modelName}`,
                },
                { label: "Version", value: `v${promptDetail.version}` },
                { label: "Status", value: <Badge status={promptDetail.status} /> },
                {
                  label: "Template hash",
                  value: <span className="mono">{promptDetail.templateHash}</span>,
                },
              ]}
            />
            <div className="detail-section">
              <div className="detail-section__title">Template</div>
              <pre className="code-block">{promptDetail.template}</pre>
            </div>
            <InfoNotice>
              <Icon name="shield" size={15} /> Prompt activation is gated by a
              passed model evaluation. Existing proposals keep their original
              prompt version.
            </InfoNotice>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(evaluationDetail)}
        title="Evaluation run"
        description={
          evaluationDetail
            ? `${evaluationDetail.modelProvider} ${evaluationDetail.modelName} · ${evaluationDetail.datasetRef}`
            : undefined
        }
        onClose={() => setEvaluationDetail(null)}
        wide
        footer={
          <Button variant="secondary" onClick={() => setEvaluationDetail(null)}>
            Close
          </Button>
        }
      >
        {evaluationDetail ? (
          <div className="stack">
            <DefinitionList
              items={[
                {
                  label: "Harness",
                  value:
                    evaluationDetail.metrics.harnessVersion === "ai-gate-v1"
                      ? "Verified (ai-gate-v1)"
                      : "Imported record",
                },
                {
                  label: "Result",
                  value: (
                    <Badge
                      tone={evaluationDetail.passed ? "success" : "danger"}
                    >
                      {evaluationDetail.passed ? "Passed" : "Blocked"}
                    </Badge>
                  ),
                },
                {
                  label: "Samples",
                  value: evaluationDetail.sampleSize,
                },
                {
                  label: "Evaluated",
                  value: formatDateTime(evaluationDetail.evaluatedAt),
                },
              ]}
            />
            {evaluationDetail.blockers.length > 0 ? (
              <div className="detail-section">
                <div className="detail-section__title">Blockers</div>
                <div className="chip-row">
                  {evaluationDetail.blockers.map((blocker) => (
                    <span className="chip" key={blocker}>
                      {blocker}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="detail-section">
              <div className="detail-section__title">Metrics</div>
              <pre className="code-block">
                {JSON.stringify(evaluationDetail.metrics, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
