import { useState, type FormEvent } from "react";
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
  TextInput,
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
  AiReviewMetrics,
  AiScoreProposal,
  ModelCanaryRun,
  ModelEvaluationDataset,
  ModelEvaluationRun,
  ModelRedTeamRun,
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
  const datasets = useApiQuery<ModelEvaluationDataset[]>(
    "/api/v1/model-evaluation-datasets",
  );
  const datasetsDue = useApiQuery<ModelEvaluationDataset[]>(
    "/api/v1/model-evaluation-datasets/refresh-due?withinDays=30",
  );
  const canaries = useApiQuery<ModelCanaryRun[]>(
    "/api/v1/model-canary-runs",
  );
  const redTeam = useApiQuery<ModelRedTeamRun[]>(
    "/api/v1/model-red-team-runs",
  );
  const reviewMetrics = useApiQuery<AiReviewMetrics>(
    "/api/v1/ai-review-metrics",
  );
  const [tab, setTab] = useState("proposals");
  const auditQueue = useApiQuery<AiScoreProposal[]>(
    tab === "audit" ? "/api/v1/ai-score-proposals/audit-queue" : null,
  );
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [selected, setSelected] = useState<AiScoreProposal | null>(null);
  const [decision, setDecision] = useState<"ACCEPT" | "REJECT">("ACCEPT");
  const [decidedBy, setDecidedBy] = useState(session.personId);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [reviewStartedAt, setReviewStartedAt] = useState("");
  const [independentScores, setIndependentScores] = useState<
    Record<string, string>
  >({});
  const [independentRationale, setIndependentRationale] = useState("");
  const [evidenceOpened, setEvidenceOpened] = useState(0);
  const [blindReview, setBlindReview] = useState(true);
  const [overrideReason, setOverrideReason] = useState("");
  const [secondReviewer, setSecondReviewer] = useState("");
  const [secondScores, setSecondScores] = useState<Record<string, string>>(
    {},
  );
  const [secondRationale, setSecondRationale] = useState("");
  const [secondStartedAt, setSecondStartedAt] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [promptDetail, setPromptDetail] = useState<ModelPrompt | null>(null);
  const [evaluationDetail, setEvaluationDetail] =
    useState<ModelEvaluationRun | null>(null);
  const [auditTarget, setAuditTarget] = useState<AiScoreProposal | null>(null);
  const [auditReviewer, setAuditReviewer] = useState(session.personId);
  const [auditScores, setAuditScores] = useState<Record<string, string>>({});
  const [auditRationale, setAuditRationale] = useState("");
  const [auditEvidenceOpened, setAuditEvidenceOpened] = useState(0);
  const [auditStartedAt, setAuditStartedAt] = useState("");
  const [auditError, setAuditError] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryDimensions, setSummaryDimensions] = useState("QUALITY, TIMELINESS");
  const [summaryEvidenceRefs, setSummaryEvidenceRefs] = useState("");
  const [summaryRubric, setSummaryRubric] = useState("");
  const [summaryResult, setSummaryResult] = useState<{
    summary: string;
    dimensionScores: Record<string, number>;
    confidence: number;
    model: string;
  } | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const evidenceNodes = useApiQuery<
    Array<{ id: string; evidenceType: string; qualityStatus: string }>
  >("/api/v1/evidence");
  const [auditSubmitting, setAuditSubmitting] = useState(false);
  const [datasetOpen, setDatasetOpen] = useState(false);
  const [datasetSaving, setDatasetSaving] = useState(false);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [datasetCode, setDatasetCode] = useState("");
  const [datasetVersion, setDatasetVersion] = useState("1");
  const [datasetName, setDatasetName] = useState("");
  const [datasetSample, setDatasetSample] = useState("100");
  const [datasetHoldout, setDatasetHoldout] = useState("20");
  const [datasetLabelSource, setDatasetLabelSource] =
    useState("DOUBLE_ANNOTATION");
  const [datasetOwner, setDatasetOwner] = useState(session.personId);
  const [datasetRefreshDue, setDatasetRefreshDue] = useState("");
  const [redTeamOpen, setRedTeamOpen] = useState(false);
  const [redTeamSaving, setRedTeamSaving] = useState(false);
  const [redTeamError, setRedTeamError] = useState<string | null>(null);
  const [redTeamProvider, setRedTeamProvider] = useState("anthropic");
  const [redTeamModel, setRedTeamModel] = useState("claude");
  const [redTeamVersion, setRedTeamVersion] = useState("v1");
  const [redTeamScope, setRedTeamScope] = useState(
    "Prompt injection and data exfiltration",
  );
  const [redTeamTests, setRedTeamTests] = useState("10");
  const [redTeamPassed, setRedTeamPassed] = useState(true);
  const [redTeamFindings, setRedTeamFindings] = useState("");
  const [redTeamArtifact, setRedTeamArtifact] = useState("");
  const [redTeamCreator, setRedTeamCreator] = useState(session.personId);
  const [refreshTarget, setRefreshTarget] =
    useState<ModelEvaluationDataset | null>(null);
  const [refreshVersion, setRefreshVersion] = useState("2");
  const [refreshSample, setRefreshSample] = useState("");
  const [refreshHoldout, setRefreshHoldout] = useState("");
  const [refreshDue, setRefreshDue] = useState("");
  const [refreshSaving, setRefreshSaving] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [harnessOpen, setHarnessOpen] = useState(false);
  const [harnessType, setHarnessType] = useState("SCORE_AGREEMENT");
  const [harnessProvider, setHarnessProvider] = useState("anthropic");
  const [harnessModel, setHarnessModel] = useState("claude");
  const [harnessPromptVersion, setHarnessPromptVersion] = useState("v1");
  const [harnessDatasetRef, setHarnessDatasetRef] = useState("gold-set-1");
  const [harnessSamples, setHarnessSamples] = useState("[]");
  const [harnessThresholds, setHarnessThresholds] = useState("{}");
  const [harnessError, setHarnessError] = useState<string | null>(null);
  const [harnessRunning, setHarnessRunning] = useState(false);

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

  function openRefresh(dataset: ModelEvaluationDataset) {
    setRefreshTarget(dataset);
    setRefreshVersion(String(dataset.version + 1));
    setRefreshSample(String(dataset.sampleSize));
    setRefreshHoldout(String(dataset.holdoutSize));
    setRefreshDue("");
    setRefreshError(null);
  }

    async function runModelSummary() {
    setSummaryError(null);
    setSummaryResult(null);
    setSummaryBusy(true);
    try {
      const response = await api<{
        suggestionLogId: string;
        summary: {
          summary: string;
          dimensionScores: Record<string, number>;
          confidence: number;
          model: string;
        };
      }>("/api/v1/ai/model-summary", {
        method: "POST",
        body: {
          dimensions: summaryDimensions
            .split(",")
            .map((dimension) => dimension.trim())
            .filter(Boolean),
          evidenceRefs: summaryEvidenceRefs
            .split(/[\n,]/)
            .map((ref) => ref.trim())
            .filter(Boolean),
          rubric: summaryRubric.trim() || undefined,
        },
      });
      setSummaryResult(response.summary);
      toast.success(
        "Model summary generated",
        "Logged as an advisory AI suggestion; it never enters money paths.",
      );
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "The action failed.",
      );
    } finally {
      setSummaryBusy(false);
    }
  }

async function saveRefresh(event: FormEvent) {
    event.preventDefault();
    if (!refreshTarget) return;
    setRefreshSaving(true);
    setRefreshError(null);
    try {
      await api(
        `/api/v1/model-evaluation-datasets/${refreshTarget.id}/refresh`,
        {
          method: "POST",
          body: {
            version: Number(refreshVersion),
            sampleSize: Number(refreshSample),
            holdoutSize: Number(refreshHoldout),
            nextRefreshDueAt: refreshDue
              ? new Date(`${refreshDue}T00:00:00Z`).toISOString()
              : undefined,
          },
        },
      );
      toast.success("Gold set refreshed");
      setRefreshTarget(null);
      datasets.reload();
    } catch (error) {
      setRefreshError(
        error instanceof Error
          ? error.message
          : "Could not refresh the gold set.",
      );
    } finally {
      setRefreshSaving(false);
    }
  }

  function openRedTeamForm() {
    setRedTeamProvider("anthropic");
    setRedTeamModel("claude");
    setRedTeamVersion("v1");
    setRedTeamScope("Prompt injection and data exfiltration");
    setRedTeamTests("10");
    setRedTeamPassed(true);
    setRedTeamFindings("");
    setRedTeamArtifact("");
    setRedTeamCreator(session.personId);
    setRedTeamError(null);
    setRedTeamOpen(true);
  }

  async function saveRedTeam(event: FormEvent) {
    event.preventDefault();
    setRedTeamSaving(true);
    setRedTeamError(null);
    try {
      await api("/api/v1/model-red-team-runs", {
        method: "POST",
        body: {
          modelProvider: redTeamProvider.trim(),
          modelName: redTeamModel.trim(),
          promptVersion: redTeamVersion.trim(),
          scope: redTeamScope.trim(),
          testsRun: Number(redTeamTests),
          passed: redTeamPassed,
          findings: redTeamFindings
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean),
          artifactRef: redTeamArtifact.trim() || undefined,
          createdBy: redTeamCreator,
        },
      });
      toast.success("Red-team run recorded");
      setRedTeamOpen(false);
      redTeam.reload();
    } catch (error) {
      setRedTeamError(
        error instanceof Error
          ? error.message
          : "Could not record the red-team run.",
      );
    } finally {
      setRedTeamSaving(false);
    }
  }

  function openDatasetForm() {
    setDatasetCode("");
    setDatasetVersion("1");
    setDatasetName("");
    setDatasetSample("100");
    setDatasetHoldout("20");
    setDatasetLabelSource("DOUBLE_ANNOTATION");
    setDatasetOwner(session.personId);
    setDatasetRefreshDue("");
    setDatasetError(null);
    setDatasetOpen(true);
  }

  async function saveDataset(event: FormEvent) {
    event.preventDefault();
    setDatasetSaving(true);
    setDatasetError(null);
    try {
      await api("/api/v1/model-evaluation-datasets", {
        method: "POST",
        body: {
          code: datasetCode.trim(),
          version: Number(datasetVersion),
          name: datasetName.trim(),
          sampleSize: Number(datasetSample),
          holdoutSize: Number(datasetHoldout),
          labelSource: datasetLabelSource.trim(),
          ownerPersonId: datasetOwner,
          nextRefreshDueAt: datasetRefreshDue
            ? new Date(`${datasetRefreshDue}T00:00:00Z`).toISOString()
            : undefined,
        },
      });
      toast.success("Gold set registered");
      setDatasetOpen(false);
      datasets.reload();
    } catch (error) {
      setDatasetError(
        error instanceof Error
          ? error.message
          : "Could not register the gold set.",
      );
    } finally {
      setDatasetSaving(false);
    }
  }

  async function retireDataset(dataset: ModelEvaluationDataset) {
    try {
      await api(`/api/v1/model-evaluation-datasets/${dataset.id}/retire`, {
        method: "POST",
      });
      toast.success("Gold set retired");
      datasets.reload();
    } catch (error) {
      toast.error(
        "Could not retire gold set",
        error instanceof Error ? error.message : "The action failed.",
      );
    }
  }

  function openReview(proposal: AiScoreProposal) {
    setSelected(proposal);
    setDecision("ACCEPT");
    setDecidedBy(session.personId);
    setNote("");
    setActionError(null);
    setRevealed(proposal.status !== "PENDING");
    setReviewStartedAt(
      proposal.reviewStartedAt ?? new Date().toISOString(),
    );
    setIndependentScores(
      Object.fromEntries(
        proposal.dimensions.map((dimension) => [
          dimension,
          proposal.independentScores?.[dimension] !== undefined
            ? String(proposal.independentScores[dimension])
            : "",
        ]),
      ),
    );
    setIndependentRationale(proposal.independentRationale ?? "");
    setSecondReviewer(proposal.secondReviewerPersonId ?? "");
    setSecondScores(
      Object.fromEntries(
        proposal.dimensions.map((dimension) => [
          dimension,
          proposal.secondIndependentScores?.[dimension] !== undefined
            ? String(proposal.secondIndependentScores[dimension])
            : "",
        ]),
      ),
    );
    setSecondRationale(proposal.secondIndependentRationale ?? "");
    setSecondStartedAt(
      proposal.secondReviewStartedAt ?? new Date().toISOString(),
    );
    setEvidenceOpened(proposal.evidenceOpened ?? 0);
    setBlindReview(proposal.blindReview ?? true);
    setOverrideReason(proposal.overrideReason ?? "");
  }

  function currentOverride(proposal: AiScoreProposal): boolean {
    return proposal.dimensions.some(
      (dimension) =>
        Math.abs(
          Number(independentScores[dimension] ?? 0) -
            (proposal.scores[dimension] ?? 0),
        ) > 0.05,
    );
  }

  function revealAiProposal() {
    if (!selected) return;
    const missing = selected.dimensions.some(
      (dimension) =>
        independentScores[dimension]?.trim() === "" ||
        !Number.isFinite(Number(independentScores[dimension])) ||
        Number(independentScores[dimension]) < 0 ||
        Number(independentScores[dimension]) > 5,
    );
    if (missing) {
      setActionError("Score every dimension from 0 to 5 before revealing AI output.");
      return;
    }
    if (independentRationale.trim().length < 3) {
      setActionError("Record your independent rationale before revealing AI output.");
      return;
    }
    setActionError(null);
    setRevealed(true);
  }

  function openAudit(proposal: AiScoreProposal) {
    setAuditTarget(proposal);
    setAuditReviewer(session.personId);
    setAuditScores(
      Object.fromEntries(
        proposal.dimensions.map((dimension) => [dimension, ""]),
      ),
    );
    setAuditRationale("");
    setAuditEvidenceOpened(0);
    setAuditStartedAt(new Date().toISOString());
    setAuditError(null);
  }

  async function submitAuditReview() {
    if (!auditTarget) return;
    setAuditError(null);
    const scores: Record<string, number> = {};
    for (const dimension of auditTarget.dimensions) {
      const value = Number(auditScores[dimension]);
      if (!Number.isFinite(value) || value < 0 || value > 5) {
        setAuditError(
          `Enter a second-review score between 0 and 5 for ${titleCase(dimension)}.`,
        );
        return;
      }
      scores[dimension] = value;
    }
    if (auditRationale.trim().length < 3) {
      setAuditError("A short second-review rationale is required.");
      return;
    }
    setAuditSubmitting(true);
    try {
      await api(
        `/api/v1/ai-score-proposals/${auditTarget.id}/audit-review`,
        {
          method: "POST",
          body: {
            reviewerPersonId: auditReviewer,
            scores,
            rationale: auditRationale.trim(),
            reviewStartedAt: auditStartedAt,
            evidenceOpened: auditEvidenceOpened,
          },
        },
      );
      toast.success(
        "Audit review recorded",
        "The second review is stored without changing the original decision.",
      );
      setAuditTarget(null);
      auditQueue.reload();
      reviewMetrics.reload();
    } catch (caught) {
      setAuditError(
        caught instanceof Error
          ? caught.message
          : "Could not record the audit review.",
      );
    } finally {
      setAuditSubmitting(false);
    }
  }

  async function submitDecision() {
    if (!selected) return;
    if (!revealed) {
      setActionError("Reveal the AI proposal only after recording your independent judgment.");
      return;
    }
    if (decision === "REJECT" && !note.trim()) {
      setActionError("A note is required when rejecting a score proposal.");
      return;
    }
    if (currentOverride(selected) && !overrideReason.trim()) {
      setActionError("Explain why your independent score differs from the AI proposal.");
      return;
    }
    if (selected.secondReviewRequired) {
      if (!secondReviewer) {
        setActionError("Select a second reviewer for this high-risk proposal.");
        return;
      }
      if (secondRationale.trim().length < 3) {
        setActionError("A second-review rationale is required.");
        return;
      }
      for (const dimension of selected.dimensions) {
        const value = Number(secondScores[dimension]);
        if (!Number.isFinite(value) || value < 0 || value > 5) {
          setActionError(
            `Enter a second-review score for ${titleCase(dimension)}.`,
          );
          return;
        }
      }
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
          independentScores: Object.fromEntries(
            selected.dimensions.map((dimension) => [
              dimension,
              Number(independentScores[dimension]),
            ]),
          ),
          independentRationale: independentRationale.trim() || undefined,
          reviewStartedAt,
          evidenceOpened,
          overrideReason: overrideReason.trim() || undefined,
          blindReview,
          ...(selected.secondReviewRequired
            ? {
                secondReviewerPersonId: secondReviewer,
                secondIndependentScores: Object.fromEntries(
                  selected.dimensions.map((dimension) => [
                    dimension,
                    Number(secondScores[dimension]),
                  ]),
                ),
                secondIndependentRationale: secondRationale.trim(),
                secondReviewStartedAt: secondStartedAt,
              }
            : {}),
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

  function openHarness() {
    setHarnessType("SCORE_AGREEMENT");
    setHarnessProvider("anthropic");
    setHarnessModel("claude");
    setHarnessPromptVersion("v1");
    setHarnessDatasetRef(datasets.data?.[0]?.code ?? "gold-set-1");
    setHarnessSamples("[]");
    setHarnessThresholds("{}");
    setHarnessError(null);
    setHarnessOpen(true);
  }

  async function runHarness() {
    setHarnessError(null);
    setHarnessRunning(true);
    try {
      const samples = JSON.parse(harnessSamples) as unknown[];
      const thresholds = JSON.parse(harnessThresholds) as Record<
        string,
        unknown
      >;
      await api("/api/v1/model-evaluation-runs:evaluate", {
        method: "POST",
        body: {
          evaluationType: harnessType.trim(),
          modelProvider: harnessProvider.trim(),
          modelName: harnessModel.trim(),
          promptVersion: harnessPromptVersion.trim(),
          datasetRef: harnessDatasetRef.trim(),
          samples,
          thresholds,
        },
      });
      toast.success("Harness evaluation recorded", harnessType);
      setHarnessOpen(false);
      evaluations.reload();
      datasets.reload();
    } catch (caught) {
      setHarnessError(
        caught instanceof Error ? caught.message : "Harness evaluation failed",
      );
    } finally {
      setHarnessRunning(false);
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
              reviewMetrics.reload();
            }}
            loading={
              proposals.loading ||
              prompts.loading ||
              evaluations.loading ||
              reviewMetrics.loading
            }
          >
            Refresh
          </Button>
        }
      />

      <div className="stat-grid">
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
        <div
          className={`stat-tile ${
            reviewMetrics.data?.rubberStampAlert
              ? "stat-tile--critical"
              : "stat-tile--neutral"
          }`}
        >
          <div className="stat-tile__top">
            <span className="stat-tile__label">Review oversight</span>
          </div>
          <div className="stat-tile__value" style={{ fontSize: 22 }}>
            {reviewMetrics.data?.rubberStampAlert ? (
              <Badge tone="danger">Review needed</Badge>
            ) : (
              <Badge tone="success">Within policy</Badge>
            )}
          </div>
          <div className="stat-tile__detail">
            {reviewMetrics.data
              ? `${reviewMetrics.data.decided} decided · ${formatPercent(
                  reviewMetrics.data.overrideRate,
                )} override · ${formatPercent(
                  reviewMetrics.data.acceptanceRate,
                )} accepted`
              : "No review metrics yet"}
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
          {
            id: "audit",
            label: "Audit queue",
            count: reviewMetrics.data?.auditPendingCount ?? 0,
          },
          {
            id: "datasets",
            label: "Gold sets",
            count: datasets.data?.length ?? 0,
          },
          {
            id: "canary",
            label: "Canary",
            count: canaries.data?.length ?? 0,
          },
          {
            id: "redteam",
            label: "Red team",
            count: redTeam.data?.length ?? 0,
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
            {reviewMetrics.data?.rubberStampAlert ? (
              <div style={{ padding: "14px 20px 0" }}>
                <InfoNotice tone="warning">
                  Adoption exceeds 95% across {reviewMetrics.data.decided}{" "}
                  decisions. Sample and review the queue for rubber-stamping
                  before accepting more proposals.
                </InfoNotice>
              </div>
            ) : null}
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
            action={
              <Button size="sm" variant="primary" icon="play" onClick={openHarness}>
                Run harness
              </Button>
            }
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
        {tab === "audit" ? (
          <Panel
            title="Second-review audit queue"
            subtitle="Every override is sampled, plus a configurable random share of other decisions"
            flush
          >
            {reviewMetrics.data ? (
              <div style={{ padding: "14px 20px 0" }}>
                <InfoNotice>
                  Sampled {reviewMetrics.data.auditSampledCount} · reviewed{" "}
                  {reviewMetrics.data.auditReviewedCount} · pending{" "}
                  {reviewMetrics.data.auditPendingCount} · agreement{" "}
                  {formatPercent(reviewMetrics.data.auditAgreementRate)}. Avg
                  review{" "}
                  {Math.round(
                    reviewMetrics.data.averageReviewDurationSeconds,
                  )}
                  s · evidence opened{" "}
                  {reviewMetrics.data.averageEvidenceOpened.toFixed(1)} · blind{" "}
                  {reviewMetrics.data.blindReviewCount}. The second reviewer does
                  not see the first independent scores.
                </InfoNotice>
              </div>
            ) : null}
            {auditQueue.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice
                  error={auditQueue.error}
                  onRetry={auditQueue.reload}
                />
              </div>
            ) : auditQueue.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={3} />
              </div>
            ) : (auditQueue.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon="shield"
                title="No pending audit"
                description="Overrides are always sampled; other decisions enter the queue at the configured audit rate."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Model score</th>
                      <th>First decision</th>
                      <th>First reviewer</th>
                      <th>Sampled</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {auditQueue.data?.map((proposal) => (
                      <tr key={proposal.id}>
                        <td>
                          <span className="cell-primary">
                            {displayName(proposal.personId, people)}
                          </span>
                          <span className="cell-sub mono">
                            {shortId(proposal.id, 10)}
                          </span>
                        </td>
                        <td>
                          {proposal.overallScore.toFixed(2)}
                          <span className="cell-sub">
                            confidence {formatPercent(proposal.confidence)}
                          </span>
                        </td>
                        <td>
                          <Badge status={proposal.status} />
                          {proposal.override ? (
                            <span className="cell-sub">
                              <Badge tone="warning">Override</Badge>
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {proposal.decidedBy
                            ? displayName(proposal.decidedBy, people)
                            : "—"}
                        </td>
                        <td className="nowrap">
                          {proposal.auditSampledAt
                            ? formatRelative(proposal.auditSampledAt)
                            : "—"}
                        </td>
                        <td className="cell-actions">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openAudit(proposal)}
                          >
                            Audit
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
        {tab === "datasets" ? (
          <Panel
            title="Gold sets"
            subtitle="Versioned evaluation datasets with holdout and refresh tracking"
            action={
              <Button
                size="sm"
                variant="secondary"
                icon="plus"
                onClick={openDatasetForm}
              >
                Register gold set
              </Button>
            }
            flush
          >
            {datasetsDue.data && datasetsDue.data.length > 0 ? (
              <div style={{ padding: "14px 16px 0" }}>
                <InfoNotice tone="warning">
                  {datasetsDue.data.length} gold set(s) due for refresh within 30
                  days:{" "}
                  {datasetsDue.data
                    .map((dataset) => `${dataset.code} v${dataset.version}`)
                    .join(", ")}
                  .
                </InfoNotice>
              </div>
            ) : null}
            {datasets.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={datasets.error} onRetry={datasets.reload} />
              </div>
            ) : datasets.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={3} />
              </div>
            ) : (datasets.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon="chart"
                title="No gold set registered"
                description="Register a labelled dataset with its holdout and quarterly refresh date before enabling registered-gold-set enforcement."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Gold set</th>
                      <th className="cell-num">Sample</th>
                      <th className="cell-num">Holdout</th>
                      <th>Labels</th>
                      <th>Refresh due</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {datasets.data?.map((dataset) => (
                      <tr key={dataset.id}>
                        <td>
                          <span className="cell-primary">
                            {dataset.code} · v{dataset.version}
                          </span>
                          <span className="cell-sub">{dataset.name}</span>
                        </td>
                        <td className="cell-num">{dataset.sampleSize}</td>
                        <td className="cell-num">{dataset.holdoutSize}</td>
                        <td>{dataset.labelSource}</td>
                        <td className="nowrap">
                          {dataset.nextRefreshDueAt
                            ? formatDateTime(dataset.nextRefreshDueAt)
                            : "—"}
                          {dataset.nextRefreshDueAt &&
                          new Date(dataset.nextRefreshDueAt).getTime() <
                            Date.now() ? (
                            <span className="cell-sub">
                              <Badge tone="warning">Refresh due</Badge>
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <Badge status={dataset.status} />
                        </td>
                        <td className="cell-actions">
                          {dataset.status === "ACTIVE" ? (
                            <div className="row-actions">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => openRefresh(dataset)}
                              >
                                Refresh
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void retireDataset(dataset)}
                              >
                                Retire
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
        {tab === "canary" ? (
          <Panel
            title="Canary comparisons"
            subtitle="Candidate vs baseline harness metrics before a provider/model rollout"
            flush
          >
            {canaries.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={canaries.error} onRetry={canaries.reload} />
              </div>
            ) : canaries.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={3} />
              </div>
            ) : (canaries.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon="chart"
                title="No canary comparison"
                description="Compare a baseline and candidate evaluation run on the same gold set before promoting a model or provider change."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Dataset</th>
                      <th>Baseline</th>
                      <th>Candidate</th>
                      <th className="cell-num">Traffic</th>
                      <th>Result</th>
                      <th>Blockers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {canaries.data?.map((canary) => (
                      <tr key={canary.id}>
                        <td className="mono">{canary.datasetRef}</td>
                        <td className="mono">
                          {shortId(canary.baselineEvaluationRunId, 10)}
                        </td>
                        <td className="mono">
                          {shortId(canary.candidateEvaluationRunId, 10)}
                        </td>
                        <td className="cell-num">
                          {canary.trafficPercent}%
                        </td>
                        <td>
                          <Badge
                            tone={canary.passed ? "success" : "danger"}
                          >
                            {canary.passed ? "Passed" : "Blocked"}
                          </Badge>
                        </td>
                        <td>
                          {canary.blockers.length === 0
                            ? "—"
                            : canary.blockers.join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : null}
        {tab === "summary" ? (
          <Panel
            title="Model-backed evidence summary"
            subtitle="Advisory only: the configured model summarises evidence and proposes 0-5 dimension scores; results are logged as AI suggestions"
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setSummaryOpen(true);
                  setSummaryResult(null);
                  setSummaryError(null);
                }}
              >
                New summary
              </Button>
            }
          >
            <InfoNotice>
              Requires a configured model provider (MODEL_SCORING_* on the
              server); unconfigured deployments return
              MODEL_PROVIDER_NOT_CONFIGURED. Evidence is passed to the model
              as untrusted data with an injection-resistant scaffold, and the
              JSON output is schema-validated before anything is logged.
            </InfoNotice>
            {summaryResult ? (
              <div className="stack">
                <DefinitionList
                  items={Object.entries(
                    summaryResult.dimensionScores,
                  ).map(([dimension, score]) => ({
                    label: dimension,
                    value: `${score}/5`,
                  }))}
                />
                <DefinitionList
                  items={[
                    {
                      label: "Confidence",
                      value: `${Math.round(summaryResult.confidence * 100)}%`,
                    },
                    { label: "Model", value: summaryResult.model },
                  ]}
                />
                <p>{summaryResult.summary}</p>
              </div>
            ) : (
              <EmptyState
                icon="ai"
                title="No summary yet"
                description="Pick evidence references and dimensions to request an advisory model summary."
              />
            )}
          </Panel>
        ) : null}
        {tab === "redteam" ? (
          <Panel
            title="Red-team runs"
            subtitle="Adversarial evidence required before prompt activation when the tenant enables it"
            action={
              <Button
                size="sm"
                variant="secondary"
                icon="plus"
                onClick={openRedTeamForm}
              >
                Record run
              </Button>
            }
            flush
          >
            {redTeam.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={redTeam.error} onRetry={redTeam.reload} />
              </div>
            ) : redTeam.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={3} />
              </div>
            ) : (redTeam.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon="shield"
                title="No red-team run"
                description="Record prompt-injection and exfiltration testing before activating a prompt when enforcement is enabled."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Version</th>
                      <th>Scope</th>
                      <th className="cell-num">Tests</th>
                      <th>Result</th>
                      <th>Findings</th>
                      <th>Artifact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {redTeam.data?.map((run) => (
                      <tr key={run.id}>
                        <td>
                          {run.modelName}
                          <span className="cell-sub">{run.modelProvider}</span>
                        </td>
                        <td className="mono">{run.promptVersion}</td>
                        <td>{run.scope}</td>
                        <td className="cell-num">{run.testsRun}</td>
                        <td>
                          <Badge tone={run.passed ? "success" : "danger"}>
                            {run.passed ? "Passed" : "Findings"}
                          </Badge>
                        </td>
                        <td>
                          {run.findings.length === 0
                            ? "—"
                            : run.findings.join("; ")}
                        </td>
                        <td className="mono">
                          {run.artifactRef ?? "—"}
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
        open={redTeamOpen}
        title="Record red-team run"
        description="A failed run must list its findings."
        onClose={() => setRedTeamOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setRedTeamOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="red-team-form"
              loading={redTeamSaving}
            >
              Record run
            </Button>
          </>
        }
      >
        <form id="red-team-form" className="stack" onSubmit={saveRedTeam}>
          {redTeamError ? (
            <InfoNotice tone="warning">{redTeamError}</InfoNotice>
          ) : null}
          <div className="form-grid">
            <FormField label="Provider" htmlFor="red-team-provider">
              <TextInput
                id="red-team-provider"
                value={redTeamProvider}
                onChange={(event) => setRedTeamProvider(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Model" htmlFor="red-team-model">
              <TextInput
                id="red-team-model"
                value={redTeamModel}
                onChange={(event) => setRedTeamModel(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Prompt version" htmlFor="red-team-version">
              <TextInput
                id="red-team-version"
                value={redTeamVersion}
                onChange={(event) => setRedTeamVersion(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Tests run" htmlFor="red-team-tests">
              <TextInput
                id="red-team-tests"
                type="number"
                min={1}
                value={redTeamTests}
                onChange={(event) => setRedTeamTests(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Created by" htmlFor="red-team-creator">
              <PersonSelect
                id="red-team-creator"
                value={redTeamCreator}
                onChange={setRedTeamCreator}
              />
            </FormField>
            <FormField label="Artifact reference" htmlFor="red-team-artifact">
              <TextInput
                id="red-team-artifact"
                value={redTeamArtifact}
                onChange={(event) => setRedTeamArtifact(event.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Scope" htmlFor="red-team-scope">
            <TextInput
              id="red-team-scope"
              value={redTeamScope}
              onChange={(event) => setRedTeamScope(event.target.value)}
              required
            />
          </FormField>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={redTeamPassed}
              onChange={(event) => setRedTeamPassed(event.target.checked)}
            />
            <span>The red-team run passed without unresolved findings.</span>
          </label>
          <FormField
            label="Findings (one per line)"
            htmlFor="red-team-findings"
          >
            <Textarea
              id="red-team-findings"
              value={redTeamFindings}
              onChange={(event) => setRedTeamFindings(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={datasetOpen}
        title="Register gold set"
        description="Holdout must be smaller than the sample. Use a new version for a refresh."
        onClose={() => setDatasetOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDatasetOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="dataset-form"
              loading={datasetSaving}
            >
              Register
            </Button>
          </>
        }
      >
        <form id="dataset-form" className="stack" onSubmit={saveDataset}>
          {datasetError ? (
            <InfoNotice tone="warning">{datasetError}</InfoNotice>
          ) : null}
          <div className="form-grid">
            <FormField label="Code" htmlFor="dataset-code">
              <TextInput
                id="dataset-code"
                value={datasetCode}
                onChange={(event) => setDatasetCode(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Version" htmlFor="dataset-version">
              <TextInput
                id="dataset-version"
                type="number"
                min={1}
                value={datasetVersion}
                onChange={(event) => setDatasetVersion(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Name"
              htmlFor="dataset-name"
              className="field--full"
            >
              <TextInput
                id="dataset-name"
                value={datasetName}
                onChange={(event) => setDatasetName(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Sample size" htmlFor="dataset-sample">
              <TextInput
                id="dataset-sample"
                type="number"
                min={2}
                value={datasetSample}
                onChange={(event) => setDatasetSample(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Holdout size" htmlFor="dataset-holdout">
              <TextInput
                id="dataset-holdout"
                type="number"
                min={1}
                value={datasetHoldout}
                onChange={(event) => setDatasetHoldout(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Label source" htmlFor="dataset-label">
              <TextInput
                id="dataset-label"
                value={datasetLabelSource}
                onChange={(event) =>
                  setDatasetLabelSource(event.target.value)
                }
                required
              />
            </FormField>
            <FormField label="Owner" htmlFor="dataset-owner">
              <PersonSelect
                id="dataset-owner"
                value={datasetOwner}
                onChange={setDatasetOwner}
              />
            </FormField>
            <FormField
              label="Next refresh due"
              htmlFor="dataset-refresh"
            >
              <TextInput
                id="dataset-refresh"
                type="date"
                value={datasetRefreshDue}
                onChange={(event) => setDatasetRefreshDue(event.target.value)}
              />
            </FormField>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(refreshTarget)}
        title="Refresh gold set"
        description="Creates a new active version and retires the current one."
        onClose={() => setRefreshTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRefreshTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="refresh-dataset-form"
              loading={refreshSaving}
            >
              Refresh
            </Button>
          </>
        }
      >
        <form
          id="refresh-dataset-form"
          className="stack"
          onSubmit={saveRefresh}
        >
          {refreshError ? (
            <InfoNotice tone="warning">{refreshError}</InfoNotice>
          ) : null}
          <div className="form-grid">
            <FormField label="Version" htmlFor="refresh-version">
              <TextInput
                id="refresh-version"
                type="number"
                min={1}
                value={refreshVersion}
                onChange={(event) => setRefreshVersion(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Sample size" htmlFor="refresh-sample">
              <TextInput
                id="refresh-sample"
                type="number"
                min={2}
                value={refreshSample}
                onChange={(event) => setRefreshSample(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Holdout size" htmlFor="refresh-holdout">
              <TextInput
                id="refresh-holdout"
                type="number"
                min={1}
                value={refreshHoldout}
                onChange={(event) => setRefreshHoldout(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Next refresh due" htmlFor="refresh-due">
              <TextInput
                id="refresh-due"
                type="date"
                value={refreshDue}
                onChange={(event) => setRefreshDue(event.target.value)}
              />
            </FormField>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(selected)}
        title="Score proposal"
        description={
          selected
            ? selected.status === "PENDING" && !revealed
              ? `${displayName(selected.personId, people)} · record your independent judgment first`
              : `${displayName(selected.personId, people)} · ${selected.modelProvider} ${selected.modelName}`
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
              {!revealed ? (
                <Button variant="primary" onClick={revealAiProposal}>
                  Reveal AI proposal
                </Button>
              ) : (
                <Button
                  variant={decision === "REJECT" ? "danger" : "primary"}
                  onClick={submitDecision}
                  loading={submitting}
                >
                  {decision === "REJECT" ? "Reject score" : "Accept score"}
                </Button>
              )}
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
            <DefinitionList
              items={[
                {
                  label: "Person",
                  value: displayName(selected.personId, people),
                },
                { label: "Status", value: <Badge status={selected.status} /> },
                {
                  label: "Evidence",
                  value: `${selected.evidenceRefs.length} cited references`,
                },
              ]}
            />

            {!revealed ? (
              <>
                <InfoNotice>
                  <strong>Independent judgment first.</strong> Enter your own
                  dimension scores and rationale before the AI proposal is
                  revealed. The backend records the review duration and evidence
                  count, and requires a reason for each override.
                </InfoNotice>
                <div className="form-grid">
                  {selected.dimensions.map((dimension) => (
                    <FormField
                      key={dimension}
                      label={`${titleCase(dimension)} score (0–5)`}
                      htmlFor={`independent-${dimension}`}
                    >
                      <TextInput
                        id={`independent-${dimension}`}
                        type="number"
                        min="0"
                        max="5"
                        step="0.01"
                        value={independentScores[dimension] ?? ""}
                        onChange={(event) =>
                          setIndependentScores((current) => ({
                            ...current,
                            [dimension]: event.target.value,
                          }))
                        }
                      />
                    </FormField>
                  ))}
                  <FormField
                    label="Independent rationale"
                    htmlFor="independent-rationale"
                    className="field--full"
                    hint="At least 3 characters; recorded before AI output is shown."
                  >
                    <Textarea
                      id="independent-rationale"
                      value={independentRationale}
                      onChange={(event) =>
                        setIndependentRationale(event.target.value)
                      }
                    />
                  </FormField>
                </div>
                <div className="detail-section">
                  <div className="detail-section__title">
                    Evidence review ({evidenceOpened} opened)
                  </div>
                  {selected.evidenceRefs.length === 0 ? (
                    <p className="muted">No evidence reference recorded.</p>
                  ) : (
                    <div className="chip-row">
                      {selected.evidenceRefs.map((reference) => (
                        <button
                          type="button"
                          className="chip"
                          key={reference}
                          onClick={() => setEvidenceOpened((count) => count + 1)}
                        >
                          {reference}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="checkbox" style={{ marginTop: 12 }}>
                    <input
                      type="checkbox"
                      checked={blindReview}
                      onChange={(event) => setBlindReview(event.target.checked)}
                    />
                    <span>
                      Mark this review as a blind-audit sample. AI output is not
                      shown before the independent scores are recorded.
                    </span>
                  </label>
                </div>
              </>
            ) : (
              <>
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
                    <div className="coverage-cell__label">Evidence opened</div>
                    <div className="coverage-cell__value">{evidenceOpened}</div>
                    <div className="coverage-cell__sub">during this review</div>
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
                        <span className="score-row__label">
                          {titleCase(dimension)}
                        </span>
                        <span className="score-row__track">
                          <span
                            className="score-row__fill"
                            style={{
                              display: "block",
                              width: `${Math.min(100, (score / 5) * 100)}%`,
                            }}
                          />
                        </span>
                        <span className="score-row__value">
                          {score.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="detail-section">
                  <div className="detail-section__title">AI rationale</div>
                  <div className="reason-box">{selected.rationale}</div>
                </div>

                <div className="detail-section">
                  <div className="detail-section__title">Evidence references</div>
                  <div className="chip-row">
                    {selected.evidenceRefs.map((reference) => (
                      <span className="chip" key={reference}>
                        {reference}
                      </span>
                    ))}
                  </div>
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

                <div className="detail-section">
                  <div className="detail-section__title">Your independent review</div>
                  <div className="reason-box">
                    {selected.dimensions
                      .map(
                        (dimension) =>
                          `${titleCase(dimension)}: ${independentScores[dimension] ?? "—"}`,
                      )
                      .join(" · ")}
                    {independentRationale ? ` — ${independentRationale}` : ""}
                  </div>
                  {(selected.status === "PENDING"
                    ? currentOverride(selected)
                    : selected.override) ? (
                    <InfoNotice tone="warning">
                      Your score differs from the AI proposal. A written override
                      reason is required and will be retained.
                    </InfoNotice>
                  ) : (
                    <InfoNotice tone="success">
                      Your independent score matches the AI proposal within
                      tolerance.
                    </InfoNotice>
                  )}
                </div>

                {selected.secondReviewRequired ? (
                  <div className="detail-section">
                    <div className="detail-section__title">
                      High-risk second review
                    </div>
                    <InfoNotice tone="warning">
                      This proposal is marked {titleCase(selected.riskTier)} risk.
                      A second reviewer must independently score every dimension
                      and agree with the decision before it can be recorded.
                      {selected.secondReviewDueAt
                        ? ` Second review due ${new Date(selected.secondReviewDueAt).toLocaleString()}.`
                        : ""}
                    </InfoNotice>
                    {selected.riskReasons?.length ? (
                      <p className="muted">
                        Risk signals: {selected.riskReasons.map(titleCase).join(" · ")}
                      </p>
                    ) : null}
                    <FormField
                      label="Second reviewer"
                      htmlFor="ai-second-reviewer"
                    >
                      <PersonSelect
                        id="ai-second-reviewer"
                        value={secondReviewer}
                        onChange={setSecondReviewer}
                      />
                    </FormField>
                    <div className="form-grid">
                      {selected.dimensions.map((dimension) => (
                        <FormField
                          key={dimension}
                          label={`${titleCase(dimension)} score (0–5)`}
                          htmlFor={`second-${dimension}`}
                        >
                          <TextInput
                            id={`second-${dimension}`}
                            type="number"
                            min="0"
                            max="5"
                            step="0.01"
                            value={secondScores[dimension] ?? ""}
                            onChange={(event) =>
                              setSecondScores((current) => ({
                                ...current,
                                [dimension]: event.target.value,
                              }))
                            }
                          />
                        </FormField>
                      ))}
                    </div>
                    <FormField
                      label="Second-review rationale"
                      htmlFor="second-rationale"
                    >
                      <Textarea
                        id="second-rationale"
                        value={secondRationale}
                        onChange={(event) =>
                          setSecondRationale(event.target.value)
                        }
                      />
                    </FormField>
                  </div>
                ) : null}

                {selected.status === "PENDING" ? (
                  <div className="detail-section">
                    <div className="detail-section__title">Human decision</div>
                    <div className="form-grid">
                      <FormField label="Decision" htmlFor="ai-decision">
                        <Select
                          id="ai-decision"
                          value={decision}
                          onChange={(event) =>
                            setDecision(
                              event.target.value as "ACCEPT" | "REJECT",
                            )
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
                        label={
                          decision === "REJECT"
                            ? "Decision note (required)"
                            : "Decision note (optional)"
                        }
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
                      {currentOverride(selected) ? (
                        <FormField
                          label="Override reason (required)"
                          htmlFor="ai-override"
                          className="field--full"
                        >
                          <Textarea
                            id="ai-override"
                            value={overrideReason}
                            onChange={(event) =>
                              setOverrideReason(event.target.value)
                            }
                          />
                        </FormField>
                      ) : null}
                    </div>
                  </div>
                ) : selected.decisionNote || selected.independentRationale ? (
                  <div className="detail-section">
                    <div className="detail-section__title">Decision record</div>
                    {selected.independentRationale ? (
                      <div className="reason-box">
                        <strong>Independent rationale:</strong>{" "}
                        {selected.independentRationale}
                      </div>
                    ) : null}
                    {selected.decisionNote ? (
                      <div className="reason-box" style={{ marginTop: 8 }}>
                        <strong>Decision note:</strong> {selected.decisionNote}
                      </div>
                    ) : null}
                    <p className="subtle" style={{ fontSize: 11.5, marginTop: 6 }}>
                      Decided by {displayName(selected.decidedBy, people)}
                      {selected.reviewDurationSeconds !== undefined
                        ? ` · review ${selected.reviewDurationSeconds}s`
                        : ""}
                      {selected.override ? " · override" : ""}
                    </p>
                  </div>
                ) : null}
              </>
            )}
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

      <Modal
        open={Boolean(auditTarget)}
        title="Second-review audit"
        description="Score independently before comparing with the first review."
        onClose={() => setAuditTarget(null)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setAuditTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submitAuditReview}
              loading={auditSubmitting}
            >
              Record audit review
            </Button>
          </>
        }
      >
        {auditTarget ? (
          <div className="stack">
            {auditError ? (
              <InfoNotice tone="warning">{auditError}</InfoNotice>
            ) : null}
            <DefinitionList
              items={[
                {
                  label: "Person",
                  value: displayName(auditTarget.personId, people),
                },
                {
                  label: "First decision",
                  value: <Badge status={auditTarget.status} />,
                },
                {
                  label: "Sampled",
                  value: auditTarget.auditSampledAt
                    ? formatDateTime(auditTarget.auditSampledAt)
                    : "—",
                },
              ]}
            />
            <FormField label="Second reviewer" htmlFor="audit-reviewer">
              <PersonSelect
                id="audit-reviewer"
                value={auditReviewer}
                onChange={setAuditReviewer}
              />
            </FormField>
            <div className="form-grid">
              {auditTarget.dimensions.map((dimension) => (
                <FormField
                  key={dimension}
                  label={`${titleCase(dimension)} score (0–5)`}
                  htmlFor={`audit-score-${dimension}`}
                >
                  <TextInput
                    id={`audit-score-${dimension}`}
                    type="number"
                    min="0"
                    max="5"
                    step="0.01"
                    value={auditScores[dimension] ?? ""}
                    onChange={(event) =>
                      setAuditScores((current) => ({
                        ...current,
                        [dimension]: event.target.value,
                      }))
                    }
                  />
                </FormField>
              ))}
              <FormField
                label="Evidence opened"
                htmlFor="audit-evidence"
              >
                <TextInput
                  id="audit-evidence"
                  type="number"
                  min={0}
                  value={auditEvidenceOpened}
                  onChange={(event) =>
                    setAuditEvidenceOpened(Number(event.target.value))
                  }
                />
              </FormField>
            </div>
            <FormField
              label="Second-review rationale"
              htmlFor="audit-rationale"
            >
              <Textarea
                id="audit-rationale"
                value={auditRationale}
                onChange={(event) => setAuditRationale(event.target.value)}
              />
            </FormField>
            <InfoNotice>
              The second reviewer must differ from the requester and the first
              reviewer. Agreement is computed by comparing the second scores
              with the model scores, then with the recorded decision.
            </InfoNotice>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={harnessOpen}
        title="Run evaluation harness"
        description="Samples are labelled pairs of human scores plus the model score. Pass/fail and blockers are computed server-side."
        onClose={() => setHarnessOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setHarnessOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={runHarness}
              loading={harnessRunning}
            >
              Run harness
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {harnessError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{harnessError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="Evaluation type" htmlFor="harness-type">
            <TextInput
              id="harness-type"
              value={harnessType}
              onChange={(event) => setHarnessType(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Model provider" htmlFor="harness-provider">
            <TextInput
              id="harness-provider"
              value={harnessProvider}
              onChange={(event) => setHarnessProvider(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Model name" htmlFor="harness-model">
            <TextInput
              id="harness-model"
              value={harnessModel}
              onChange={(event) => setHarnessModel(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Prompt version" htmlFor="harness-prompt">
            <TextInput
              id="harness-prompt"
              value={harnessPromptVersion}
              onChange={(event) =>
                setHarnessPromptVersion(event.target.value)
              }
              required
            />
          </FormField>
          <FormField label="Dataset reference" htmlFor="harness-dataset">
            <TextInput
              id="harness-dataset"
              value={harnessDatasetRef}
              onChange={(event) => setHarnessDatasetRef(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="Samples (JSON)"
            htmlFor="harness-samples"
            className="field--full"
            hint="[{ sampleId, subgroup, humanScoreA, humanScoreB, aiScore, counterfactualScores, promptInjectionPassed, holdout }]"
          >
            <Textarea
              id="harness-samples"
              value={harnessSamples}
              onChange={(event) => setHarnessSamples(event.target.value)}
              rows={10}
              spellCheck={false}
            />
          </FormField>
          <FormField
            label="Thresholds (JSON, optional)"
            htmlFor="harness-thresholds"
            className="field--full"
          >
            <Textarea
              id="harness-thresholds"
              value={harnessThresholds}
              onChange={(event) => setHarnessThresholds(event.target.value)}
              rows={4}
              spellCheck={false}
            />
          </FormField>
        </div>
      </Modal>
      <Modal
        open={summaryOpen}
        title="Request a model summary"
        onClose={() => setSummaryOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSummaryOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              loading={summaryBusy}
              disabled={
                summaryEvidenceRefs.trim().length === 0 ||
                summaryDimensions.trim().length === 0
              }
              onClick={() => void runModelSummary()}
            >
              Generate summary
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {summaryError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{summaryError}</InfoNotice>
            </div>
          ) : null}
          <FormField
            label="Dimensions (comma separated)"
            htmlFor="summary-dimensions"
            hint="Each dimension receives a 0-5 advisory score."
          >
            <TextInput
              id="summary-dimensions"
              value={summaryDimensions}
              onChange={(event) => setSummaryDimensions(event.target.value)}
            />
          </FormField>
          <FormField
            label="Evidence references"
            htmlFor="summary-evidence"
            hint="One evidence node id per line (see the Contribution evidence table)."
          >
            <Textarea
              id="summary-evidence"
              rows={5}
              value={summaryEvidenceRefs}
              onChange={(event) => setSummaryEvidenceRefs(event.target.value)}
              spellCheck={false}
            />
          </FormField>
          <FormField label="Rubric (optional)" htmlFor="summary-rubric">
            <TextInput
              id="summary-rubric"
              value={summaryRubric}
              onChange={(event) => setSummaryRubric(event.target.value)}
            />
          </FormField>
          {evidenceNodes.data && evidenceNodes.data.length > 0 ? (
            <div className="field--full">
              <p className="hint">
                Recent evidence:{" "}
                {evidenceNodes.data
                  .slice(0, 5)
                  .map((node) => node.id)
                  .join(", ")}
              </p>
            </div>
          ) : null}
          {summaryResult ? (
            <div className="field--full">
              <DefinitionList
                items={Object.entries(summaryResult.dimensionScores).map(
                  ([dimension, score]) => ({
                    label: dimension,
                    value: `${score}/5`,
                  }),
                )}
              />
              <p>{summaryResult.summary}</p>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
