import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  CopyButton,
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
import { Icon } from "../components/Icon.js";
import { Link } from "react-router-dom";
import {
  PersonSelect,
  usePeople,
} from "../components/PersonSelect.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useTheme, type ThemePreference } from "../contexts/ThemeContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { api, DEFAULT_SESSION } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  formatDate,
  formatMoney,
  shortId,
  titleCase,
} from "../lib/format.js";
import type {
  ConflictDeclaration,
  DataClassification,
  DataMapReport,
  DpiaRecord,
  FairnessCommitment,
  DsarRequest,
  PlatformIdentity,
  RetentionDisposalRequest,
  RetentionPolicy,
  TrustSurveyReport,
  TrustSurveyRun,
} from "../lib/types.js";

export function SettingsPage() {
  useDocumentTitle("Settings");
  const { session, updateSession } = useAuth();
  const { preference, setPreference } = useTheme();
  const toast = useToast();
  const identity = useApiQuery<PlatformIdentity>("/api/v1/platform/identity");
  const health = useApiQuery<{ status: string }>("/health");
  const auditChain = useApiQuery<{ valid: boolean }>(
    "/api/v1/audit-events/verify",
  );
  const dpias = useApiQuery<DpiaRecord[]>("/api/v1/dpia-records");
  const dsars = useApiQuery<DsarRequest[]>("/api/v1/dsar-requests");
  const retention = useApiQuery<RetentionPolicy[]>("/api/v1/retention-policies");
  const disposals = useApiQuery<RetentionDisposalRequest[]>(
    "/api/v1/retention-disposal-requests",
  );
  const dataMap = useApiQuery<DataMapReport>("/api/v1/data-map");
  const conflicts = useApiQuery<ConflictDeclaration[]>(
    "/api/v1/conflict-declarations",
  );
  const trustSurveys = useApiQuery<TrustSurveyRun[]>("/api/v1/trust-surveys");
  const commitments = useApiQuery<FairnessCommitment[]>(
    "/api/v1/fairness-commitments",
  );
  const training = useApiQuery<ManagerTrainingRecord[]>(
    "/api/v1/manager-training-records",
  );
  const calibrations = useApiQuery<CalibrationSession[]>(
    "/api/v1/calibration-sessions",
  );
  const pilots = useApiQuery<PilotEnrollment[]>("/api/v1/pilot-enrollments");
  const grants = useApiQuery<BreakGlassGrant[]>(
    "/api/v1/break-glass-grants",
  );
  const clawbacks = useApiQuery<ClawbackCase[]>("/api/v1/clawback-cases");
  const pools = useApiQuery<BudgetPool[]>("/api/v1/budget-pools");
  const poolReviews = useApiQuery<DiscretionaryPoolReview[]>(
    "/api/v1/discretionary-pool-reviews",
  );
  const providerPolicies = useApiQuery<ModelProviderPolicy[]>(
    "/api/v1/model-provider-policies",
  );
  const redactions = useApiQuery<AuditRedaction[]>("/api/v1/audit-redactions");
  const { people } = usePeople();

  const [tenantId, setTenantId] = useState(session.tenantId);
  const [userId, setUserId] = useState(session.userId);
  const [personId, setPersonId] = useState(session.personId);
  const [token, setToken] = useState(session.token ?? "");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceCode, setSourceCode] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceCategory, setSourceCategory] = useState("SALES");
  const [sourceOwner, setSourceOwner] = useState(session.personId);
  const [sourceSla, setSourceSla] = useState("24");
  const [sourceCriticality, setSourceCriticality] = useState<
    "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  >("MEDIUM");
  const [sourceRegion, setSourceRegion] = useState("cn-shanghai");
  const [sourcePersonal, setSourcePersonal] = useState(true);
  const [sourceCrossBorder, setSourceCrossBorder] = useState(false);
  const [sourceProcessors, setSourceProcessors] = useState("");
  const [sourceFields, setSourceFields] = useState<
    Array<{
      fieldName: string;
      classification: DataClassification;
      purpose: string;
      retentionMonths: string;
    }>
  >([
    {
      fieldName: "",
      classification: "INTERNAL",
      purpose: "",
      retentionMonths: "",
    },
  ]);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictSaving, setConflictSaving] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [conflictPerson, setConflictPerson] = useState(session.personId);
  const [conflictRelated, setConflictRelated] = useState("");
  const [conflictType, setConflictType] = useState("FAMILY");
  const [conflictDescription, setConflictDescription] = useState("");
  const [revokeTarget, setRevokeTarget] =
    useState<ConflictDeclaration | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [surveySaving, setSurveySaving] = useState(false);
  const [surveyError, setSurveyError] = useState<string | null>(null);
  const [surveyCode, setSurveyCode] = useState("TRUST_QUARTERLY");
  const [surveyPeriod, setSurveyPeriod] = useState("2026-Q4");
  const [surveyTitle, setSurveyTitle] = useState(
    "Quarterly trust and procedural fairness",
  );
  const [surveyQuestions, setSurveyQuestions] = useState<
    Array<{ code: string; prompt: string; dimension: string }>
  >([{ code: "FAIRNESS", prompt: "", dimension: "FAIRNESS" }]);
  const [respondTarget, setRespondTarget] = useState<TrustSurveyRun | null>(
    null,
  );
  const [respondentId, setRespondentId] = useState(session.personId);
  const [responseScores, setResponseScores] = useState<
    Record<string, string>
  >({});
  const [responseError, setResponseError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<TrustSurveyRun | null>(
    null,
  );
  const report = useApiQuery<TrustSurveyReport>(
    reportTarget
      ? `/api/v1/trust-surveys/${reportTarget.id}/report`
      : null,
  );
  const [commitmentOpen, setCommitmentOpen] = useState(false);
  const [commitmentSaving, setCommitmentSaving] = useState(false);
  const [commitmentError, setCommitmentError] = useState<string | null>(null);
  const [commitmentStatement, setCommitmentStatement] = useState("");
  const [commitmentOwner, setCommitmentOwner] = useState(session.personId);
  const [commitmentChannels, setCommitmentChannels] = useState(
    "INTRANET, TOWN_HALL",
  );
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [trainingSaving, setTrainingSaving] = useState(false);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [trainingPerson, setTrainingPerson] = useState(session.personId);
  const [trainingCode, setTrainingCode] = useState("FAIRNESS_101");
  const [trainingTitle, setTrainingTitle] = useState(
    "Fair incentive conversations",
  );
  const [trainingCompletedAt, setTrainingCompletedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [trainingExpiresAt, setTrainingExpiresAt] = useState("");
  const [trainingEvidence, setTrainingEvidence] = useState("");
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibrationSaving, setCalibrationSaving] = useState(false);
  const [calibrationError, setCalibrationError] = useState<string | null>(
    null,
  );
  const [calibrationCode, setCalibrationCode] = useState("CAL-2026-Q4");
  const [calibrationTitle, setCalibrationTitle] = useState(
    "Rating calibration",
  );
  const [calibrationHeldAt, setCalibrationHeldAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [calibrationFacilitator, setCalibrationFacilitator] = useState(
    session.personId,
  );
  const [calibrationAttendees, setCalibrationAttendees] = useState<string[]>(
    [],
  );
  const [calibrationNotes, setCalibrationNotes] = useState("");
  const [pilotOpen, setPilotOpen] = useState(false);
  const [pilotSaving, setPilotSaving] = useState(false);
  const [pilotError, setPilotError] = useState<string | null>(null);
  const [pilotPerson, setPilotPerson] = useState(session.personId);
  const [pilotCode, setPilotCode] = useState("PILOT-2026");
  const [pilotScope, setPilotScope] = useState("");
  const [pilotConsent, setPilotConsent] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantSaving, setGrantSaving] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [granteeId, setGranteeId] = useState(session.personId);
  const [grantedById, setGrantedById] = useState(session.personId);
  const [grantReason, setGrantReason] = useState("");
  const [grantHours, setGrantHours] = useState("1");
  const [clawbackOpen, setClawbackOpen] = useState(false);
  const [clawbackSaving, setClawbackSaving] = useState(false);
  const [clawbackError, setClawbackError] = useState<string | null>(null);
  const [clawbackPerson, setClawbackPerson] = useState(session.personId);
  const [clawbackAmount, setClawbackAmount] = useState("");
  const [clawbackReasonCode, setClawbackReasonCode] = useState("OVERPAYMENT");
  const [clawbackExplanation, setClawbackExplanation] = useState("");
  const [clawbackConsent, setClawbackConsent] = useState("");
  const [clawbackInstallments, setClawbackInstallments] = useState("1");
  const [clawbackHardship, setClawbackHardship] = useState(false);
  const [clawbackHardshipReason, setClawbackHardshipReason] = useState("");
  const [clawbackRequester, setClawbackRequester] = useState(
    session.personId,
  );
  const [waiveTarget, setWaiveTarget] = useState<ClawbackCase | null>(null);
  const [waiveReason, setWaiveReason] = useState("");
  const [poolReviewOpen, setPoolReviewOpen] = useState(false);
  const [poolReviewSaving, setPoolReviewSaving] = useState(false);
  const [poolReviewError, setPoolReviewError] = useState<string | null>(null);
  const [poolReviewPool, setPoolReviewPool] = useState("");
  const [poolReviewCommittee, setPoolReviewCommittee] = useState<string[]>(
    [],
  );
  const [poolReviewObserver, setPoolReviewObserver] = useState("");
  const [poolReviewCriteria, setPoolReviewCriteria] = useState("");
  const [poolReviewNotes, setPoolReviewNotes] = useState("");
  const [poolReviewReviewer, setPoolReviewReviewer] = useState(
    session.personId,
  );
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policyProvider, setPolicyProvider] = useState("anthropic");
  const [policyZeroRetention, setPolicyZeroRetention] = useState(true);
  const [policyDpa, setPolicyDpa] = useState("");
  const [policyRegion, setPolicyRegion] = useState("cn-shanghai");
  const [policyEgress, setPolicyEgress] = useState("api.anthropic.com");
  const [policyApprover, setPolicyApprover] = useState(session.personId);
  const [redactionOpen, setRedactionOpen] = useState(false);
  const [redactionSaving, setRedactionSaving] = useState(false);
  const [redactionError, setRedactionError] = useState<string | null>(null);
  const [redactionEventId, setRedactionEventId] = useState("");
  const [redactionReason, setRedactionReason] = useState("");
  const [redactionRequester, setRedactionRequester] = useState(
    session.personId,
  );
  const [redactionApprover, setRedactionApprover] = useState("");
  const [disposalOpen, setDisposalOpen] = useState(false);
  const [disposalPolicy, setDisposalPolicy] = useState("");
  const [disposalReason, setDisposalReason] = useState("");
  const [disposalRequester, setDisposalRequester] = useState(
    session.personId,
  );
  const [disposalSaving, setDisposalSaving] = useState(false);
  const [disposalError, setDisposalError] = useState<string | null>(null);

  function saveSession(event: FormEvent) {
    event.preventDefault();
    updateSession({
      tenantId: tenantId.trim(),
      userId: userId.trim(),
      personId: personId.trim(),
      token: token.trim(),
    });
    toast.success(
      "Session updated",
      "Reloading to apply the tenant and person context.",
    );
    window.setTimeout(() => window.location.reload(), 450);
  }

  function resetSession() {
    updateSession(DEFAULT_SESSION);
    setTenantId(DEFAULT_SESSION.tenantId);
    setUserId(DEFAULT_SESSION.userId);
    setPersonId(DEFAULT_SESSION.personId);
    setToken("");
    toast.success("Session reset", "Restored the development defaults.");
    window.setTimeout(() => window.location.reload(), 450);
  }

  const openDsars =
    dsars.data?.filter((request) => request.status === "OPEN") ?? [];
  const overdueDsars = openDsars.filter(
    (request) => request.dueAt && new Date(request.dueAt).getTime() < Date.now(),
  );
  const heldPolicies =
    retention.data?.filter((policy) => policy.legalHold) ?? [];

  function resetDataSourceForm() {
    setSourceCode("");
    setSourceName("");
    setSourceCategory("SALES");
    setSourceOwner(session.personId);
    setSourceSla("24");
    setSourceCriticality("MEDIUM");
    setSourceRegion("cn-shanghai");
    setSourcePersonal(true);
    setSourceCrossBorder(false);
    setSourceProcessors("");
    setSourceFields([
      {
        fieldName: "",
        classification: "INTERNAL",
        purpose: "",
        retentionMonths: "",
      },
    ]);
    setSourceError(null);
  }

  async function saveDataSource(event: FormEvent) {
    event.preventDefault();
    setSourceSaving(true);
    setSourceError(null);
    try {
      await api("/api/v1/data-sources", {
        method: "POST",
        body: {
          code: sourceCode.trim(),
          name: sourceName.trim(),
          category: sourceCategory.trim(),
          ownerPersonId: sourceOwner,
          slaHours: Number(sourceSla),
          criticality: sourceCriticality,
          containsPersonalData: sourcePersonal,
          storageRegion: sourceRegion.trim(),
          crossBorderTransfers: sourceCrossBorder,
          processorRefs: sourceProcessors
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          fields: sourceFields
            .filter((field) => field.fieldName.trim() && field.purpose.trim())
            .map((field) => ({
              fieldName: field.fieldName.trim(),
              classification: field.classification,
              purpose: field.purpose.trim(),
              retentionMonths: field.retentionMonths
                ? Number(field.retentionMonths)
                : undefined,
            })),
        },
      });
      toast.success("Data source registered", "The data map has been refreshed.");
      setSourceOpen(false);
      resetDataSourceForm();
      dataMap.reload();
    } catch (error) {
      setSourceError(
        error instanceof Error ? error.message : "Could not register the source.",
      );
    } finally {
      setSourceSaving(false);
    }
  }

  function openCommitmentForm() {
    setCommitmentStatement("");
    setCommitmentOwner(session.personId);
    setCommitmentChannels("INTRANET, TOWN_HALL");
    setCommitmentError(null);
    setCommitmentOpen(true);
  }

  async function publishCommitment(event: FormEvent) {
    event.preventDefault();
    setCommitmentSaving(true);
    setCommitmentError(null);
    try {
      await api("/api/v1/fairness-commitments", {
        method: "POST",
        body: {
          statement: commitmentStatement.trim(),
          ownerPersonId: commitmentOwner,
          channels: commitmentChannels
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        },
      });
      toast.success(
        "Commitment published",
        "The prior version is retained as superseded.",
      );
      setCommitmentOpen(false);
      commitments.reload();
    } catch (error) {
      setCommitmentError(
        error instanceof Error
          ? error.message
          : "Could not publish the commitment.",
      );
    } finally {
      setCommitmentSaving(false);
    }
  }

  function openSurveyForm() {
    setSurveyCode("TRUST_QUARTERLY");
    setSurveyPeriod("2026-Q4");
    setSurveyTitle("Quarterly trust and procedural fairness");
    setSurveyQuestions([{ code: "FAIRNESS", prompt: "", dimension: "FAIRNESS" }]);
    setSurveyError(null);
    setSurveyOpen(true);
  }

  async function saveSurvey(event: FormEvent) {
    event.preventDefault();
    setSurveySaving(true);
    setSurveyError(null);
    try {
      await api("/api/v1/trust-surveys", {
        method: "POST",
        body: {
          code: surveyCode.trim(),
          period: surveyPeriod.trim(),
          title: surveyTitle.trim(),
          questions: surveyQuestions
            .filter(
              (question) =>
                question.code.trim() &&
                question.prompt.trim() &&
                question.dimension.trim(),
            )
            .map((question) => ({
              code: question.code.trim(),
              prompt: question.prompt.trim(),
              dimension: question.dimension.trim(),
            })),
        },
      });
      toast.success("Trust survey created", "Open it when the questions are ready.");
      setSurveyOpen(false);
      trustSurveys.reload();
    } catch (error) {
      setSurveyError(
        error instanceof Error
          ? error.message
          : "Could not create the survey.",
      );
    } finally {
      setSurveySaving(false);
    }
  }

  async function changeSurveyStatus(
    survey: TrustSurveyRun,
    action: "open" | "close",
  ) {
    try {
      await api(`/api/v1/trust-surveys/${survey.id}/${action}`, {
        method: "POST",
      });
      toast.success(
        action === "open" ? "Survey opened" : "Survey closed",
        survey.title,
      );
      trustSurveys.reload();
    } catch (error) {
      toast.error(
        action === "open" ? "Could not open survey" : "Could not close survey",
        error instanceof Error ? error.message : "The action failed.",
      );
    }
  }

  function openRespond(survey: TrustSurveyRun) {
    setRespondTarget(survey);
    setRespondentId(session.personId);
    setResponseScores(
      Object.fromEntries(survey.questions.map((question) => [question.code, ""])),
    );
    setResponseError(null);
  }

  async function submitSurveyResponse(event: FormEvent) {
    event.preventDefault();
    if (!respondTarget) return;
    setSurveySaving(true);
    setResponseError(null);
    try {
      const scores: Record<string, number> = {};
      for (const question of respondTarget.questions) {
        const value = Number(responseScores[question.code]);
        if (!Number.isFinite(value) || value < 1 || value > 5) {
          throw new Error(
            `Enter a score from 1 to 5 for ${question.prompt}`,
          );
        }
        scores[question.code] = value;
      }
      await api(`/api/v1/trust-surveys/${respondTarget.id}/responses`, {
        method: "POST",
        body: { personId: respondentId, scores },
      });
      toast.success(
        "Response recorded",
        "Only a pseudonymous hash is stored with the scores.",
      );
      setRespondTarget(null);
      trustSurveys.reload();
    } catch (error) {
      setResponseError(
        error instanceof Error
          ? error.message
          : "Could not record the response.",
      );
    } finally {
      setSurveySaving(false);
    }
  }

  function openDisposalForm() {
    const policies = (retention.data ?? []).filter(
      (policy) => !policy.legalHold,
    );
    if (policies.length === 0) {
      toast.error(
        "No disposable retention policy",
        "Create a policy without a legal hold first.",
      );
      return;
    }
    setDisposalPolicy(policies[0]?.id ?? "");
    setDisposalReason("");
    setDisposalRequester(session.personId);
    setDisposalError(null);
    setDisposalOpen(true);
  }

  async function saveDisposal(event: FormEvent) {
    event.preventDefault();
    setDisposalSaving(true);
    setDisposalError(null);
    try {
      await api(
        `/api/v1/retention-policies/${disposalPolicy}/disposal-requests`,
        {
          method: "POST",
          body: {
            requestedBy: disposalRequester,
            reason: disposalReason.trim(),
          },
        },
      );
      toast.success(
        "Disposal request created",
        "A second person must approve it; the grace period then applies.",
      );
      setDisposalOpen(false);
      disposals.reload();
    } catch (error) {
      setDisposalError(
        error instanceof Error
          ? error.message
          : "Could not create the disposal request.",
      );
    } finally {
      setDisposalSaving(false);
    }
  }

  async function approveDisposal(request: RetentionDisposalRequest) {
    setDisposalSaving(true);
    try {
      await api(
        `/api/v1/retention-disposal-requests/${request.id}/approve`,
        {
          method: "POST",
          body: { approvedBy: session.personId },
        },
      );
      toast.success("Retention disposal approved");
      disposals.reload();
    } catch (error) {
      toast.error(
        "Could not approve disposal",
        error instanceof Error ? error.message : "The action failed.",
      );
    } finally {
      setDisposalSaving(false);
    }
  }

  function openRedactionForm() {
    setRedactionEventId("");
    setRedactionReason("");
    setRedactionRequester(session.personId);
    setRedactionApprover("");
    setRedactionError(null);
    setRedactionOpen(true);
  }

  async function saveRedaction(event: FormEvent) {
    event.preventDefault();
    setRedactionSaving(true);
    setRedactionError(null);
    try {
      await api(`/api/v1/audit-events/${redactionEventId.trim()}/redactions`, {
        method: "POST",
        body: {
          reason: redactionReason.trim(),
          requestedBy: redactionRequester,
          approvedBy: redactionApprover,
        },
      });
      toast.success("Audit redaction recorded");
      setRedactionOpen(false);
      redactions.reload();
    } catch (error) {
      setRedactionError(
        error instanceof Error
          ? error.message
          : "Could not record the redaction.",
      );
    } finally {
      setRedactionSaving(false);
    }
  }

  function openPolicyForm() {
    setPolicyProvider("anthropic");
    setPolicyZeroRetention(true);
    setPolicyDpa("");
    setPolicyRegion("cn-shanghai");
    setPolicyEgress("api.anthropic.com");
    setPolicyApprover(session.personId);
    setPolicyError(null);
    setPolicyOpen(true);
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    setPolicySaving(true);
    setPolicyError(null);
    try {
      await api("/api/v1/model-provider-policies", {
        method: "POST",
        body: {
          provider: policyProvider.trim(),
          zeroRetentionConfirmed: policyZeroRetention,
          dpaRef: policyDpa.trim(),
          inferenceRegion: policyRegion.trim(),
          egressAllowlist: policyEgress
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          approvedBy: policyApprover,
        },
      });
      toast.success("Provider policy recorded");
      setPolicyOpen(false);
      providerPolicies.reload();
    } catch (error) {
      setPolicyError(
        error instanceof Error
          ? error.message
          : "Could not record the policy.",
      );
    } finally {
      setPolicySaving(false);
    }
  }

  async function retirePolicy(policy: ModelProviderPolicy) {
    setPolicySaving(true);
    try {
      await api(`/api/v1/model-provider-policies/${policy.id}/retire`, {
        method: "POST",
      });
      toast.success("Provider policy retired");
      providerPolicies.reload();
    } catch (error) {
      toast.error(
        "Could not retire policy",
        error instanceof Error ? error.message : "The action failed.",
      );
    } finally {
      setPolicySaving(false);
    }
  }

  async function openPoolReviewForm() {
    const poolList = pools.data ?? [];
    if (poolList.length === 0) {
      toast.error("No budget pool", "Create a pool before reviewing it.");
      return;
    }
    setPoolReviewPool(poolList[0]?.id ?? "");
    setPoolReviewCommittee([]);
    setPoolReviewObserver("");
    setPoolReviewCriteria("");
    setPoolReviewNotes("");
    setPoolReviewReviewer(session.personId);
    setPoolReviewError(null);
    setPoolReviewOpen(true);
  }

  async function savePoolReview(event: FormEvent) {
    event.preventDefault();
    setPoolReviewSaving(true);
    setPoolReviewError(null);
    try {
      await api(
        `/api/v1/budget-pools/${poolReviewPool}/discretionary-reviews`,
        {
          method: "POST",
          body: {
            committeePersonIds: poolReviewCommittee,
            employeeObserverPersonId:
              poolReviewObserver || undefined,
            selectionCriteria: poolReviewCriteria.trim(),
            decisionNotes: poolReviewNotes.trim(),
            reviewedBy: poolReviewReviewer,
          },
        },
      );
      toast.success("Discretionary review recorded");
      setPoolReviewOpen(false);
      poolReviews.reload();
    } catch (error) {
      setPoolReviewError(
        error instanceof Error
          ? error.message
          : "Could not record the review.",
      );
    } finally {
      setPoolReviewSaving(false);
    }
  }

  function openClawbackForm() {
    setClawbackPerson(session.personId);
    setClawbackAmount("");
    setClawbackReasonCode("OVERPAYMENT");
    setClawbackExplanation("");
    setClawbackConsent("");
    setClawbackInstallments("1");
    setClawbackHardship(false);
    setClawbackHardshipReason("");
    setClawbackRequester(session.personId);
    setClawbackError(null);
    setClawbackOpen(true);
  }

  async function saveClawback(event: FormEvent) {
    event.preventDefault();
    setClawbackSaving(true);
    setClawbackError(null);
    try {
      await api("/api/v1/clawback-cases", {
        method: "POST",
        body: {
          personId: clawbackPerson,
          amount: clawbackAmount,
          currency: "CNY",
          reasonCode: clawbackReasonCode.trim(),
          explanation: clawbackExplanation.trim(),
          consentSignatureRef: clawbackConsent.trim(),
          installmentMonths: Number(clawbackInstallments),
          hardshipWaiver: clawbackHardship,
          hardshipReason: clawbackHardship
            ? clawbackHardshipReason.trim()
            : undefined,
          requestedBy: clawbackRequester,
        },
      });
      toast.success("Clawback case recorded");
      setClawbackOpen(false);
      clawbacks.reload();
    } catch (error) {
      setClawbackError(
        error instanceof Error
          ? error.message
          : "Could not record the clawback.",
      );
    } finally {
      setClawbackSaving(false);
    }
  }

  async function approveClawback(clawback: ClawbackCase) {
    setClawbackSaving(true);
    try {
      await api(`/api/v1/clawback-cases/${clawback.id}/approve`, {
        method: "POST",
        body: { approvedBy: session.personId },
      });
      toast.success("Clawback approved");
      clawbacks.reload();
    } catch (error) {
      toast.error(
        "Could not approve clawback",
        error instanceof Error ? error.message : "The action failed.",
      );
    } finally {
      setClawbackSaving(false);
    }
  }

  async function waiveClawback(event: FormEvent) {
    event.preventDefault();
    if (!waiveTarget) return;
    setClawbackSaving(true);
    try {
      await api(`/api/v1/clawback-cases/${waiveTarget.id}/waive`, {
        method: "POST",
        body: {
          reason: waiveReason.trim(),
          actorPersonId: session.personId,
        },
      });
      toast.success("Clawback waived");
      setWaiveTarget(null);
      setWaiveReason("");
      clawbacks.reload();
    } catch (error) {
      toast.error(
        "Could not waive clawback",
        error instanceof Error ? error.message : "The action failed.",
      );
    } finally {
      setClawbackSaving(false);
    }
  }

  function openGrantForm() {
    setGranteeId(session.personId);
    setGrantedById(session.personId);
    setGrantReason("");
    setGrantHours("1");
    setGrantError(null);
    setGrantOpen(true);
  }

  async function saveGrant(event: FormEvent) {
    event.preventDefault();
    setGrantSaving(true);
    setGrantError(null);
    try {
      await api("/api/v1/break-glass-grants", {
        method: "POST",
        body: {
          scope: "PAYROLL_BANK_ACCOUNT",
          granteePersonId: granteeId,
          grantedBy: grantedById,
          reason: grantReason.trim(),
          expiresAt: new Date(
            Date.now() + Number(grantHours) * 60 * 60 * 1000,
          ).toISOString(),
        },
      });
      toast.success("Break-glass grant created");
      setGrantOpen(false);
      grants.reload();
    } catch (error) {
      setGrantError(
        error instanceof Error
          ? error.message
          : "Could not create the grant.",
      );
    } finally {
      setGrantSaving(false);
    }
  }

  async function revokeGrant(grant: BreakGlassGrant) {
    setGrantSaving(true);
    try {
      await api(`/api/v1/break-glass-grants/${grant.id}/revoke`, {
        method: "POST",
      });
      toast.success("Break-glass grant revoked");
      grants.reload();
    } catch (error) {
      toast.error(
        "Could not revoke grant",
        error instanceof Error ? error.message : "The action failed.",
      );
    } finally {
      setGrantSaving(false);
    }
  }

  function openPilotForm() {
    setPilotPerson(session.personId);
    setPilotCode("PILOT-2026");
    setPilotScope("");
    setPilotConsent("");
    setPilotError(null);
    setPilotOpen(true);
  }

  async function savePilot(event: FormEvent) {
    event.preventDefault();
    setPilotSaving(true);
    setPilotError(null);
    try {
      await api("/api/v1/pilot-enrollments", {
        method: "POST",
        body: {
          personId: pilotPerson,
          pilotCode: pilotCode.trim(),
          scope: pilotScope.trim(),
          consentSignatureRef: pilotConsent.trim(),
        },
      });
      toast.success("Pilot enrollment recorded");
      setPilotOpen(false);
      pilots.reload();
    } catch (error) {
      setPilotError(
        error instanceof Error
          ? error.message
          : "Could not record the enrollment.",
      );
    } finally {
      setPilotSaving(false);
    }
  }

  async function withdrawPilot(enrollment: PilotEnrollment) {
    setPilotSaving(true);
    try {
      await api(`/api/v1/pilot-enrollments/${enrollment.id}/withdraw`, {
        method: "POST",
        body: {
          personId: enrollment.personId,
          reason: "Voluntary withdrawal from the console",
        },
      });
      toast.success("Pilot enrollment withdrawn");
      pilots.reload();
    } catch (error) {
      toast.error(
        "Could not withdraw enrollment",
        error instanceof Error ? error.message : "The action failed.",
      );
    } finally {
      setPilotSaving(false);
    }
  }

  function openTrainingForm() {
    setTrainingPerson(session.personId);
    setTrainingCode("FAIRNESS_101");
    setTrainingTitle("Fair incentive conversations");
    setTrainingCompletedAt(new Date().toISOString().slice(0, 10));
    setTrainingExpiresAt("");
    setTrainingEvidence("");
    setTrainingError(null);
    setTrainingOpen(true);
  }

  async function saveTraining(event: FormEvent) {
    event.preventDefault();
    setTrainingSaving(true);
    setTrainingError(null);
    try {
      await api("/api/v1/manager-training-records", {
        method: "POST",
        body: {
          personId: trainingPerson,
          trainingCode: trainingCode.trim(),
          title: trainingTitle.trim(),
          completedAt: new Date(`${trainingCompletedAt}T00:00:00Z`).toISOString(),
          expiresAt: trainingExpiresAt
            ? new Date(`${trainingExpiresAt}T00:00:00Z`).toISOString()
            : undefined,
          evidenceRef: trainingEvidence.trim() || undefined,
        },
      });
      toast.success("Training recorded");
      setTrainingOpen(false);
      training.reload();
    } catch (error) {
      setTrainingError(
        error instanceof Error
          ? error.message
          : "Could not record the training.",
      );
    } finally {
      setTrainingSaving(false);
    }
  }

  function openCalibrationForm() {
    setCalibrationCode("CAL-2026-Q4");
    setCalibrationTitle("Rating calibration");
    setCalibrationHeldAt(new Date().toISOString().slice(0, 10));
    setCalibrationFacilitator(session.personId);
    setCalibrationAttendees([]);
    setCalibrationNotes("");
    setCalibrationError(null);
    setCalibrationOpen(true);
  }

  async function saveCalibration(event: FormEvent) {
    event.preventDefault();
    setCalibrationSaving(true);
    setCalibrationError(null);
    try {
      await api("/api/v1/calibration-sessions", {
        method: "POST",
        body: {
          code: calibrationCode.trim(),
          title: calibrationTitle.trim(),
          heldAt: new Date(`${calibrationHeldAt}T00:00:00Z`).toISOString(),
          facilitatorPersonId: calibrationFacilitator,
          attendeePersonIds: calibrationAttendees,
          notes: calibrationNotes.trim() || undefined,
        },
      });
      toast.success("Calibration session recorded");
      setCalibrationOpen(false);
      calibrations.reload();
    } catch (error) {
      setCalibrationError(
        error instanceof Error
          ? error.message
          : "Could not record the calibration session.",
      );
    } finally {
      setCalibrationSaving(false);
    }
  }

  function openConflictForm() {
    setConflictPerson(session.personId);
    setConflictRelated("");
    setConflictType("FAMILY");
    setConflictDescription("");
    setConflictError(null);
    setConflictOpen(true);
  }

  async function saveConflict(event: FormEvent) {
    event.preventDefault();
    setConflictSaving(true);
    setConflictError(null);
    try {
      await api("/api/v1/conflict-declarations", {
        method: "POST",
        body: {
          personId: conflictPerson,
          relatedPersonId: conflictRelated,
          relationshipType: conflictType.trim(),
          description: conflictDescription.trim(),
        },
      });
      toast.success(
        "Conflict declared",
        "Adjudication involving this pair is now blocked.",
      );
      setConflictOpen(false);
      conflicts.reload();
    } catch (error) {
      setConflictError(
        error instanceof Error
          ? error.message
          : "Could not declare the conflict.",
      );
    } finally {
      setConflictSaving(false);
    }
  }

  async function revokeConflict(event: FormEvent) {
    event.preventDefault();
    if (!revokeTarget) return;
    setConflictSaving(true);
    setConflictError(null);
    try {
      await api(
        `/api/v1/conflict-declarations/${revokeTarget.id}/revoke`,
        {
          method: "POST",
          body: { reason: revokeReason.trim() },
        },
      );
      toast.success("Conflict declaration revoked");
      setRevokeTarget(null);
      setRevokeReason("");
      conflicts.reload();
    } catch (error) {
      setConflictError(
        error instanceof Error
          ? error.message
          : "Could not revoke the declaration.",
      );
    } finally {
      setConflictSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Session identity, appearance and the assurance registers that govern this tenant's data."
      />

      <div className="split-grid">
        <Panel
          title="Session context"
          subtitle="Sent as x-tenant-id, x-user-id and x-person-id on every API call"
        >
          <form onSubmit={saveSession} className="stack">
            <FormField
              label="Tenant id"
              htmlFor="session-tenant"
              hint="In development this can be tenant-demo; in PostgreSQL mode use the tenant UUID."
            >
              <TextInput
                id="session-tenant"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                required
              />
            </FormField>
            <FormField label="User id" htmlFor="session-user">
              <TextInput
                id="session-user"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Person id"
              htmlFor="session-person"
              hint="Used for approval attribution, payroll separation of duties and person-scoped requests."
            >
              <TextInput
                id="session-person"
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="OIDC bearer token (optional)"
              htmlFor="session-token"
              hint="Used when the API runs with AUTH_MODE=oidc. It stays in this browser's local storage; prefer an edge-injected token in production."
            >
              <TextInput
                id="session-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="eyJhbGciOi…"
                autoComplete="off"
                spellCheck={false}
              />
            </FormField>
            <div className="form-actions">
              <Button variant="ghost" onClick={resetSession}>
                Reset defaults
              </Button>
              <Button variant="primary" type="submit" icon="check">
                Save session
              </Button>
            </div>
          </form>
          <InfoNotice tone="warning">
            <strong>Header authentication is for development.</strong> In OIDC
            mode the server ignores these headers and derives identity from the
            signed token.
          </InfoNotice>
          <Link className="btn btn--secondary" to="/my-ai">
            <Icon name="ai" size={16} />
            <span>Open my AI record</span>
          </Link>
        </Panel>

        <div className="stack">
          <Panel title="Appearance" subtitle="Theme is stored per browser">
            <div className="toolbar__group">
              {(
                [
                  { id: "light", label: "Light", icon: "sun" },
                  { id: "dark", label: "Dark", icon: "moon" },
                  { id: "system", label: "System", icon: "settings" },
                ] as Array<{ id: ThemePreference; label: string; icon: "sun" | "moon" | "settings" }>
              ).map((option) => (
                <Button
                  key={option.id}
                  variant={preference === option.id ? "primary" : "secondary"}
                  icon={option.icon}
                  onClick={() => setPreference(option.id)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
              Dark mode is a selected palette, not an inverted filter. Charts and
              status colours keep their validated contrast on both surfaces.
            </p>
          </Panel>

          <Panel title="Identity resolution" subtitle="What the server sees">
            {identity.error ? (
              <ErrorNotice error={identity.error} onRetry={identity.reload} />
            ) : identity.loading ? (
              <LoadingRows rows={3} />
            ) : identity.data ? (
              <DefinitionList
                items={[
                  { label: "User", value: <span className="mono">{identity.data.userId}</span> },
                  {
                    label: "Linked person",
                    value: identity.data.personId ? (
                      <span className="mono">{identity.data.personId}</span>
                    ) : (
                      "Not linked"
                    ),
                  },
                  {
                    label: "Membership roles",
                    value:
                      identity.data.roles.length > 0
                        ? identity.data.roles.join(", ")
                        : "None recorded",
                  },
                ]}
              />
            ) : null}
            <div className="row-actions section-gap" style={{ justifyContent: "flex-start" }}>
              <CopyButton value={session.tenantId} label="Copy tenant" />
              <CopyButton value={session.personId} label="Copy person" />
            </div>
          </Panel>

          <Panel title="System health" subtitle="Live probes from this browser">
            <DefinitionList
              items={[
                {
                  label: "API health",
                  value: health.loading ? (
                    "Checking…"
                  ) : health.error ? (
                    <Badge tone="danger">Unreachable</Badge>
                  ) : (
                    <Badge tone="success">
                      {titleCase(health.data?.status ?? "ok")}
                    </Badge>
                  ),
                },
                {
                  label: "Audit chain",
                  value: auditChain.loading ? (
                    "Checking…"
                  ) : auditChain.data?.valid ? (
                    <Badge tone="success">Verified</Badge>
                  ) : (
                    <Badge tone="danger">Needs attention</Badge>
                  ),
                },
                {
                  label: "Console origin",
                  value: <span className="mono">{window.location.origin}</span>,
                },
                {
                  label: "API base",
                  value: (
                    <span className="mono">
                      {import.meta.env.VITE_API_BASE || "same origin"}
                    </span>
                  ),
                },
              ]}
            />
          </Panel>
        </div>
      </div>

      <div className="section-gap">
        <PageHeader
          eyebrow="Registers"
          title="Assurance records"
          description="Read-only views of the privacy and retention artefacts that a formal cycle depends on."
        />
      </div>

      <div className="split-grid">
        <Panel
          title="DPIAs"
          subtitle="Data protection impact assessments"
          action={<Badge tone="neutral" dot={false}>{dpias.data?.length ?? 0}</Badge>}
          flush
        >
          {dpias.error ? (
            <div style={{ padding: 16 }}>
              <ErrorNotice error={dpias.error} onRetry={dpias.reload} />
            </div>
          ) : dpias.loading ? (
            <div style={{ padding: 16 }}>
              <LoadingRows rows={3} />
            </div>
          ) : (dpias.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="lock"
              title="No DPIA recorded"
              description="A policy version that touches employee data should reference an approved assessment."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Scope</th>
                    <th>Status</th>
                    <th>Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {dpias.data?.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <span className="cell-primary">
                          {record.assessmentType}
                        </span>
                        <span className="cell-sub mono">
                          {shortId(record.id, 10)}
                        </span>
                      </td>
                      <td>{record.scope}</td>
                      <td>
                        <Badge status={record.status} />
                      </td>
                      <td className="nowrap">
                        {record.approvedAt
                          ? formatDate(record.approvedAt)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Data subject requests"
          subtitle={`${openDsars.length} open · ${overdueDsars.length} overdue`}
          action={<Badge tone={overdueDsars.length > 0 ? "danger" : "neutral"} dot={false}>{dsars.data?.length ?? 0}</Badge>}
          flush
        >
          {dsars.error ? (
            <div style={{ padding: 16 }}>
              <ErrorNotice error={dsars.error} onRetry={dsars.reload} />
            </div>
          ) : dsars.loading ? (
            <div style={{ padding: 16 }}>
              <LoadingRows rows={3} />
            </div>
          ) : (dsars.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="user"
              title="No data subject request"
              description="Access, correction, deletion, explanation and objection requests appear here."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Person</th>
                    <th>Status</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {dsars.data?.slice(0, 8).map((request) => {
                    const overdue =
                      request.status === "OPEN" &&
                      Boolean(request.dueAt) &&
                      new Date(request.dueAt as string).getTime() < Date.now();
                    return (
                      <tr key={request.id}>
                        <td>
                          <span className="cell-primary">{request.requestType}</span>
                          <span className="cell-sub mono">
                            {shortId(request.id, 10)}
                          </span>
                        </td>
                        <td className="mono">{shortId(request.personId, 10)}</td>
                        <td>
                          <Badge status={request.status} />
                        </td>
                        <td className={overdue ? "text-danger nowrap" : "nowrap"}>
                          {request.dueAt ? formatDate(request.dueAt) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="Retention policies"
        subtitle={`${heldPolicies.length} under legal hold`}
        className="section-gap"
        flush
      >
        {retention.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={retention.error} onRetry={retention.reload} />
          </div>
        ) : retention.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : (retention.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="clock"
            title="No retention policy"
            description="Define retention months and a legal basis per data category. Automated deletion is intentionally not wired."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data category</th>
                  <th className="cell-num">Retention</th>
                  <th>Legal basis</th>
                  <th>Legal hold</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {retention.data?.map((policy) => (
                  <tr key={policy.id}>
                    <td>
                      <span className="cell-primary">{policy.dataCategory}</span>
                      <span className="cell-sub mono">{shortId(policy.id, 10)}</span>
                    </td>
                    <td className="cell-num">{policy.retentionMonths} months</td>
                    <td>{policy.legalBasis}</td>
                    <td>
                      <Badge tone={policy.legalHold ? "warning" : "neutral"}>
                        {policy.legalHold ? "Held" : "None"}
                      </Badge>
                    </td>
                    <td className="nowrap">{formatDate(policy.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Data-source registry"
        subtitle="Owner, response SLA and field-level classification for every incentive data source"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => {
              resetDataSourceForm();
              setSourceOpen(true);
            }}
          >
            Register source
          </Button>
        }
        flush
      >
        {dataMap.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={dataMap.error} onRetry={dataMap.reload} />
          </div>
        ) : dataMap.loading || !dataMap.data ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={4} />
          </div>
        ) : dataMap.data.sources.length === 0 ? (
          <EmptyState
            icon="database"
            title="No data source registered"
            description="Register each system that supplies evidence, its accountable owner and the fields it contributes."
          />
        ) : (
          <>
            <div className="coverage-grid" style={{ padding: 16 }}>
              <div className="coverage-cell">
                <div className="coverage-cell__label">Active sources</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.activeSources}
                </div>
                <div className="coverage-cell__sub">
                  {dataMap.data.summary.sources} registered
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">Personal-data sources</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.personalSources}
                </div>
                <div className="coverage-cell__sub">
                  {dataMap.data.summary.fields} mapped fields ·{" "}
                  {dataMap.data.summary.minimization
                    ?.personalFieldsWithoutRetention ?? 0}{" "}
                  without retention
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">Cross-border</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.crossBorderSources}
                </div>
                <div className="coverage-cell__sub">
                  {dataMap.data.summary.processors.length} processors
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">Overdue reviews</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.overdueReviews}
                </div>
                <div className="coverage-cell__sub">
                  review cadence 90 days
                </div>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Owner</th>
                    <th className="cell-num">SLA</th>
                    <th>Criticality</th>
                    <th>Fields</th>
                    <th>Review</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dataMap.data.sources.map((source) => (
                    <tr key={source.id}>
                      <td>
                        <span className="cell-primary">{source.name}</span>
                        <span className="cell-sub mono">{source.code}</span>
                      </td>
                      <td className="mono">{shortId(source.ownerPersonId, 10)}</td>
                      <td className="cell-num">{source.slaHours}h</td>
                      <td>
                        <Badge
                          tone={
                            source.criticality === "CRITICAL"
                              ? "danger"
                              : source.criticality === "HIGH"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {titleCase(source.criticality)}
                        </Badge>
                      </td>
                      <td>
                        {source.fields.length}
                        {source.containsPersonalData ? (
                          <span className="cell-sub">personal data</span>
                        ) : null}
                      </td>
                      <td>
                        {source.reviewOverdue ? (
                          <Badge tone="danger">Overdue</Badge>
                        ) : (
                          <span className="nowrap">
                            {formatDate(source.reviewDueAt)}
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge status={source.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <Modal
        open={sourceOpen}
        title="Register data source"
        description="Accountable owner, response SLA and the minimum fields this source contributes."
        onClose={() => setSourceOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setSourceOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="data-source-form"
              icon="check"
              loading={sourceSaving}
            >
              Register source
            </Button>
          </>
        }
      >
        <form
          id="data-source-form"
          className="stack"
          onSubmit={saveDataSource}
        >
          <div className="form-grid">
            <FormField label="Code" htmlFor="source-code">
              <TextInput
                id="source-code"
                value={sourceCode}
                onChange={(event) => setSourceCode(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Name" htmlFor="source-name">
              <TextInput
                id="source-name"
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Category" htmlFor="source-category">
              <TextInput
                id="source-category"
                value={sourceCategory}
                onChange={(event) => setSourceCategory(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Owner" htmlFor="source-owner">
              <PersonSelect
                id="source-owner"
                value={sourceOwner}
                onChange={setSourceOwner}
              />
            </FormField>
            <FormField label="Response SLA (hours)" htmlFor="source-sla">
              <TextInput
                id="source-sla"
                type="number"
                min={1}
                max={8760}
                value={sourceSla}
                onChange={(event) => setSourceSla(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Criticality" htmlFor="source-criticality">
              <Select
                id="source-criticality"
                value={sourceCriticality}
                onChange={(event) =>
                  setSourceCriticality(
                    event.target.value as
                      | "LOW"
                      | "MEDIUM"
                      | "HIGH"
                      | "CRITICAL",
                  )
                }
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </Select>
            </FormField>
            <FormField label="Storage region" htmlFor="source-region">
              <TextInput
                id="source-region"
                value={sourceRegion}
                onChange={(event) => setSourceRegion(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Processors (comma separated)"
              htmlFor="source-processors"
            >
              <TextInput
                id="source-processors"
                value={sourceProcessors}
                onChange={(event) => setSourceProcessors(event.target.value)}
                placeholder="vendor-a, vendor-b"
              />
            </FormField>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={sourcePersonal}
              onChange={(event) => setSourcePersonal(event.target.checked)}
            />
            <span>This source contains personal data.</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={sourceCrossBorder}
              onChange={(event) => setSourceCrossBorder(event.target.checked)}
            />
            <span>Data is transferred outside mainland China.</span>
          </label>
          <div className="detail-section">
            <div className="detail-section__title">Field map</div>
            <div className="stack">
              {sourceFields.map((field, index) => (
                <div className="form-grid" key={index}>
                  <FormField label="Field" htmlFor={`source-field-${index}`}>
                    <TextInput
                      id={`source-field-${index}`}
                      value={field.fieldName}
                      onChange={(event) =>
                        setSourceFields((current) =>
                          current.map((candidate, fieldIndex) =>
                            fieldIndex === index
                              ? {
                                  ...candidate,
                                  fieldName: event.target.value,
                                }
                              : candidate,
                          ),
                        )
                      }
                      required
                    />
                  </FormField>
                  <FormField
                    label="Classification"
                    htmlFor={`source-class-${index}`}
                  >
                    <Select
                      id={`source-class-${index}`}
                      value={field.classification}
                      onChange={(event) =>
                        setSourceFields((current) =>
                          current.map((candidate, fieldIndex) =>
                            fieldIndex === index
                              ? {
                                  ...candidate,
                                  classification: event.target
                                    .value as DataClassification,
                                }
                              : candidate,
                          ),
                        )
                      }
                    >
                      <option value="PUBLIC">Public</option>
                      <option value="INTERNAL">Internal</option>
                      <option value="CONFIDENTIAL">Confidential</option>
                      <option value="PERSONAL">Personal</option>
                      <option value="SENSITIVE">Sensitive</option>
                    </Select>
                  </FormField>
                  <FormField
                    label="Purpose"
                    htmlFor={`source-purpose-${index}`}
                  >
                    <TextInput
                      id={`source-purpose-${index}`}
                      value={field.purpose}
                      onChange={(event) =>
                        setSourceFields((current) =>
                          current.map((candidate, fieldIndex) =>
                            fieldIndex === index
                              ? { ...candidate, purpose: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                      required
                    />
                  </FormField>
                  <FormField
                    label="Retention months"
                    htmlFor={`source-retention-${index}`}
                    hint="Required for PERSONAL/SENSITIVE fields."
                  >
                    <TextInput
                      id={`source-retention-${index}`}
                      type="number"
                      min={1}
                      value={field.retentionMonths}
                      onChange={(event) =>
                        setSourceFields((current) =>
                          current.map((candidate, fieldIndex) =>
                            fieldIndex === index
                              ? {
                                  ...candidate,
                                  retentionMonths: event.target.value,
                                }
                              : candidate,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={sourceFields.length === 1}
                    onClick={() =>
                      setSourceFields((current) =>
                        current.filter((_, fieldIndex) => fieldIndex !== index),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              icon="plus"
              onClick={() =>
                setSourceFields((current) => [
                  ...current,
                  {
                    fieldName: "",
                    classification: "INTERNAL",
                    purpose: "",
                    retentionMonths: "",
                  },
                ])
              }
            >
              Add field
            </Button>
          </div>
          {sourcePersonal ? (
            <InfoNotice>
              At least one field must be classified PERSONAL or SENSITIVE when
              the source contains personal data.
            </InfoNotice>
          ) : null}
          {sourceError ? (
            <InfoNotice tone="warning">{sourceError}</InfoNotice>
          ) : null}
        </form>
      </Modal>

      <Panel
        title="Conflict declarations"
        subtitle="Active related-party declarations block adjudication between the pair"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openConflictForm}
          >
            Declare conflict
          </Button>
        }
        flush
      >
        {conflicts.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={conflicts.error} onRetry={conflicts.reload} />
          </div>
        ) : conflicts.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : (conflicts.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="people"
            title="No conflict declared"
            description="Declare close personal or financial relationships that should prevent one person adjudicating another's contribution."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>People</th>
                  <th>Relationship</th>
                  <th>Status</th>
                  <th>Declared</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {conflicts.data?.map((declaration) => (
                  <tr key={declaration.id}>
                    <td>
                      <span className="cell-primary mono">
                        {shortId(declaration.personId, 10)} ↔{" "}
                        {shortId(declaration.relatedPersonId, 10)}
                      </span>
                      <span className="cell-sub">
                        {declaration.description}
                      </span>
                    </td>
                    <td>{titleCase(declaration.relationshipType)}</td>
                    <td>
                      <Badge status={declaration.status} />
                    </td>
                    <td className="nowrap">
                      {formatDate(declaration.declaredAt)}
                    </td>
                    <td className="cell-actions">
                      {declaration.status === "ACTIVE" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRevokeTarget(declaration);
                            setRevokeReason("");
                            setConflictError(null);
                          }}
                        >
                          Revoke
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

      <Modal
        open={conflictOpen}
        title="Declare conflict of interest"
        description="The pair cannot adjudicate each other's contribution while the declaration is active."
        onClose={() => setConflictOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConflictOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="conflict-form"
              loading={conflictSaving}
            >
              Declare
            </Button>
          </>
        }
      >
        <form id="conflict-form" className="stack" onSubmit={saveConflict}>
          {conflictError ? (
            <InfoNotice tone="warning">{conflictError}</InfoNotice>
          ) : null}
          <FormField label="Declaring person" htmlFor="conflict-person">
            <PersonSelect
              id="conflict-person"
              value={conflictPerson}
              onChange={setConflictPerson}
            />
          </FormField>
          <FormField label="Related person" htmlFor="conflict-related">
            <PersonSelect
              id="conflict-related"
              value={conflictRelated}
              onChange={setConflictRelated}
            />
          </FormField>
          <FormField label="Relationship" htmlFor="conflict-type">
            <TextInput
              id="conflict-type"
              value={conflictType}
              onChange={(event) => setConflictType(event.target.value)}
              placeholder="FAMILY, FINANCIAL, FORMER_MANAGER…"
              required
            />
          </FormField>
          <FormField label="Description" htmlFor="conflict-description">
            <TextInput
              id="conflict-description"
              value={conflictDescription}
              onChange={(event) =>
                setConflictDescription(event.target.value)
              }
              required
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(revokeTarget)}
        title="Revoke conflict declaration"
        onClose={() => setRevokeTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              type="submit"
              form="revoke-conflict-form"
              loading={conflictSaving}
            >
              Revoke
            </Button>
          </>
        }
      >
        <form
          id="revoke-conflict-form"
          className="stack"
          onSubmit={revokeConflict}
        >
          {conflictError ? (
            <InfoNotice tone="warning">{conflictError}</InfoNotice>
          ) : null}
          <FormField label="Revocation reason" htmlFor="revoke-reason">
            <TextInput
              id="revoke-reason"
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      <Panel
        title="Trust surveys"
        subtitle="Anonymous quarterly pulse on fairness, voice and confidence in the process"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openSurveyForm}
          >
            Create survey
          </Button>
        }
        flush
      >
        {trustSurveys.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice
              error={trustSurveys.error}
              onRetry={trustSurveys.reload}
            />
          </div>
        ) : trustSurveys.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : (trustSurveys.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="people"
            title="No trust survey"
            description="Create a survey, open it for responses, then close it to compare the dimension averages with the prior period."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Survey</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th className="cell-num">Questions</th>
                  <th>Window</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trustSurveys.data?.map((survey) => (
                  <tr key={survey.id}>
                    <td>
                      <span className="cell-primary">{survey.title}</span>
                      <span className="cell-sub mono">{survey.code}</span>
                    </td>
                    <td>{survey.period}</td>
                    <td>
                      <Badge status={survey.status} />
                    </td>
                    <td className="cell-num">{survey.questions.length}</td>
                    <td className="nowrap">
                      {survey.openedAt
                        ? formatDate(survey.openedAt)
                        : "Not opened"}
                      {survey.closedAt
                        ? ` – ${formatDate(survey.closedAt)}`
                        : ""}
                    </td>
                    <td className="cell-actions">
                      <div className="row-actions">
                        {survey.status === "DRAFT" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void changeSurveyStatus(survey, "open")}
                          >
                            Open
                          </Button>
                        ) : null}
                        {survey.status === "OPEN" ? (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => openRespond(survey)}
                            >
                              Respond
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void changeSurveyStatus(survey, "close")
                              }
                            >
                              Close
                            </Button>
                          </>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setReportTarget(survey)}
                        >
                          Report
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={surveyOpen}
        title="Create trust survey"
        description="Questions are scored 1–5. Responses store only a pseudonymous hash and the score set."
        onClose={() => setSurveyOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setSurveyOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="survey-form"
              loading={surveySaving}
            >
              Create survey
            </Button>
          </>
        }
      >
        <form id="survey-form" className="stack" onSubmit={saveSurvey}>
          {surveyError ? (
            <InfoNotice tone="warning">{surveyError}</InfoNotice>
          ) : null}
          <div className="form-grid">
            <FormField label="Code" htmlFor="survey-code">
              <TextInput
                id="survey-code"
                value={surveyCode}
                onChange={(event) => setSurveyCode(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Period" htmlFor="survey-period">
              <TextInput
                id="survey-period"
                value={surveyPeriod}
                onChange={(event) => setSurveyPeriod(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Title"
              htmlFor="survey-title"
              className="field--full"
            >
              <TextInput
                id="survey-title"
                value={surveyTitle}
                onChange={(event) => setSurveyTitle(event.target.value)}
                required
              />
            </FormField>
          </div>
          <div className="detail-section">
            <div className="detail-section__title">Questions</div>
            <div className="stack">
              {surveyQuestions.map((question, index) => (
                <div className="form-grid" key={index}>
                  <FormField
                    label="Code"
                    htmlFor={`survey-question-code-${index}`}
                  >
                    <TextInput
                      id={`survey-question-code-${index}`}
                      value={question.code}
                      onChange={(event) =>
                        setSurveyQuestions((current) =>
                          current.map((candidate, position) =>
                            position === index
                              ? { ...candidate, code: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                      required
                    />
                  </FormField>
                  <FormField
                    label="Prompt"
                    htmlFor={`survey-question-prompt-${index}`}
                  >
                    <TextInput
                      id={`survey-question-prompt-${index}`}
                      value={question.prompt}
                      onChange={(event) =>
                        setSurveyQuestions((current) =>
                          current.map((candidate, position) =>
                            position === index
                              ? {
                                  ...candidate,
                                  prompt: event.target.value,
                                }
                              : candidate,
                          ),
                        )
                      }
                      required
                    />
                  </FormField>
                  <FormField
                    label="Dimension"
                    htmlFor={`survey-question-dimension-${index}`}
                  >
                    <TextInput
                      id={`survey-question-dimension-${index}`}
                      value={question.dimension}
                      onChange={(event) =>
                        setSurveyQuestions((current) =>
                          current.map((candidate, position) =>
                            position === index
                              ? {
                                  ...candidate,
                                  dimension: event.target.value,
                                }
                              : candidate,
                          ),
                        )
                      }
                      required
                    />
                  </FormField>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={surveyQuestions.length === 1}
                    onClick={() =>
                      setSurveyQuestions((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              icon="plus"
              onClick={() =>
                setSurveyQuestions((current) => [
                  ...current,
                  { code: "", prompt: "", dimension: "" },
                ])
              }
            >
              Add question
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(respondTarget)}
        title="Respond to trust survey"
        onClose={() => setRespondTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRespondTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="survey-response-form"
              loading={surveySaving}
            >
              Submit response
            </Button>
          </>
        }
      >
        {respondTarget ? (
          <form
            id="survey-response-form"
            className="stack"
            onSubmit={submitSurveyResponse}
          >
            {responseError ? (
              <InfoNotice tone="warning">{responseError}</InfoNotice>
            ) : null}
            <DefinitionList
              items={[
                { label: "Survey", value: respondTarget.title },
                { label: "Period", value: respondTarget.period },
                {
                  label: "Anonymity",
                  value: "Only a pseudonymous hash is stored with scores.",
                },
              ]}
            />
            <FormField label="Respondent" htmlFor="survey-respondent">
              <PersonSelect
                id="survey-respondent"
                value={respondentId}
                onChange={setRespondentId}
              />
            </FormField>
            <div className="form-grid">
              {respondTarget.questions.map((question) => (
                <FormField
                  key={question.code}
                  label={question.prompt}
                  htmlFor={`survey-score-${question.code}`}
                  hint="1 = strongly disagree · 5 = strongly agree"
                >
                  <TextInput
                    id={`survey-score-${question.code}`}
                    type="number"
                    min={1}
                    max={5}
                    step={1}
                    value={responseScores[question.code] ?? ""}
                    onChange={(event) =>
                      setResponseScores((current) => ({
                        ...current,
                        [question.code]: event.target.value,
                      }))
                    }
                    required
                  />
                </FormField>
              ))}
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(reportTarget)}
        title={reportTarget ? `${reportTarget.title} · report` : "Survey report"}
        onClose={() => setReportTarget(null)}
        wide
      >
        {report.error ? (
          <ErrorNotice error={report.error} onRetry={report.reload} />
        ) : report.loading || !report.data ? (
          <LoadingRows rows={4} />
        ) : (
          <div className="stack">
            <DefinitionList
              items={[
                { label: "Period", value: report.data.survey.period },
                {
                  label: "Responses",
                  value: report.data.responseCount,
                },
                {
                  label: "Status",
                  value: <Badge status={report.data.survey.status} />,
                },
              ]}
            />
            <div className="detail-section">
              <div className="detail-section__title">Dimension averages</div>
              <div className="stack" style={{ gap: 6 }}>
                {Object.entries(report.data.dimensions).map(
                  ([dimension, score]) => {
                    const baseline =
                      report.data?.baseline?.dimensions[dimension];
                    return (
                      <div
                        key={dimension}
                        className="inline"
                        style={{ justifyContent: "space-between", width: "100%" }}
                      >
                        <span>{titleCase(dimension)}</span>
                        <span className="muted">
                          {score.toFixed(2)} / 5
                          {baseline !== undefined
                            ? ` · baseline ${baseline.toFixed(2)}`
                            : " · no baseline"}
                        </span>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
            <div className="detail-section">
              <div className="detail-section__title">Question averages</div>
              <div className="stack" style={{ gap: 6 }}>
                {report.data.survey.questions.map((question) => (
                  <div
                    key={question.code}
                    className="inline"
                    style={{ justifyContent: "space-between", width: "100%" }}
                  >
                    <span>{question.prompt}</span>
                    <span className="muted">
                      {report.data?.averages[question.code]?.toFixed(2) ?? "—"} /
                      5
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <InfoNotice>
              Result aggregation suppresses individual responses. Baseline
              compares the most recent closed survey with the same code.
            </InfoNotice>
          </div>
        )}
      </Modal>

      <Panel
        title="No-retaliation commitment"
        subtitle="Published fairness statement; publishing a new version supersedes the prior one"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openCommitmentForm}
          >
            Publish commitment
          </Button>
        }
        flush
      >
        {commitments.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={commitments.error} onRetry={commitments.reload} />
          </div>
        ) : commitments.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (commitments.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="shield"
            title="No fairness commitment"
            description="Publish a statement that good-faith concerns can be raised without retaliation."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Statement</th>
                  <th>Channels</th>
                  <th>Status</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {commitments.data?.map((commitment) => (
                  <tr key={commitment.id}>
                    <td className="mono">v{commitment.version}</td>
                    <td>
                      <span className="cell-primary">{commitment.statement}</span>
                      <span className="cell-sub mono">
                        {shortId(commitment.ownerPersonId, 10)}
                      </span>
                    </td>
                    <td>{commitment.channels.join(", ") || "—"}</td>
                    <td>
                      <Badge status={commitment.status} />
                    </td>
                    <td className="nowrap">
                      {formatDate(commitment.publishedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={commitmentOpen}
        title="Publish fairness commitment"
        description="Employees should be able to see this statement and the appeal statistics that accompany it."
        onClose={() => setCommitmentOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCommitmentOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="commitment-form"
              loading={commitmentSaving}
            >
              Publish
            </Button>
          </>
        }
      >
        <form id="commitment-form" className="stack" onSubmit={publishCommitment}>
          {commitmentError ? (
            <InfoNotice tone="warning">{commitmentError}</InfoNotice>
          ) : null}
          <FormField label="Statement" htmlFor="commitment-statement">
            <Textarea
              id="commitment-statement"
              value={commitmentStatement}
              onChange={(event) => setCommitmentStatement(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Owner" htmlFor="commitment-owner">
            <PersonSelect
              id="commitment-owner"
              value={commitmentOwner}
              onChange={setCommitmentOwner}
            />
          </FormField>
          <FormField
            label="Publication channels (comma separated)"
            htmlFor="commitment-channels"
          >
            <TextInput
              id="commitment-channels"
              value={commitmentChannels}
              onChange={(event) => setCommitmentChannels(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      <Panel
        title="Manager enablement"
        subtitle="Training completion and calibration sessions that support consistent review"
        className="section-gap"
        flush
      >
        <div className="split-grid" style={{ padding: 16 }}>
          <div className="detail-section" style={{ marginTop: 0 }}>
            <div className="detail-section__title">
              Training records
              <Button
                size="sm"
                variant="secondary"
                icon="plus"
                onClick={openTrainingForm}
              >
                Record
              </Button>
            </div>
            {training.error ? (
              <ErrorNotice error={training.error} onRetry={training.reload} />
            ) : training.loading ? (
              <LoadingRows rows={2} />
            ) : (training.data?.length ?? 0) === 0 ? (
              <p className="muted">No manager training recorded.</p>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {training.data?.map((record) => (
                  <div
                    key={record.id}
                    className="inline"
                    style={{ justifyContent: "space-between", width: "100%" }}
                  >
                    <span>
                      {record.title}
                      <span className="cell-sub">
                        {displayName(record.personId, people)} ·{" "}
                        {record.trainingCode}
                      </span>
                    </span>
                    <span className="muted nowrap">
                      {formatDate(record.completedAt)}
                      {record.expiresAt
                        ? ` → ${formatDate(record.expiresAt)}`
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="detail-section" style={{ marginTop: 0 }}>
            <div className="detail-section__title">
              Calibration sessions
              <Button
                size="sm"
                variant="secondary"
                icon="plus"
                onClick={openCalibrationForm}
              >
                Record
              </Button>
            </div>
            {calibrations.error ? (
              <ErrorNotice
                error={calibrations.error}
                onRetry={calibrations.reload}
              />
            ) : calibrations.loading ? (
              <LoadingRows rows={2} />
            ) : (calibrations.data?.length ?? 0) === 0 ? (
              <p className="muted">No calibration session recorded.</p>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {calibrations.data?.map((session) => (
                  <div
                    key={session.id}
                    className="inline"
                    style={{ justifyContent: "space-between", width: "100%" }}
                  >
                    <span>
                      {session.title}
                      <span className="cell-sub">
                        {session.attendeePersonIds.length} attendees ·{" "}
                        {session.code}
                      </span>
                    </span>
                    <span className="muted nowrap">
                      {formatDate(session.heldAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Panel>

      <Modal
        open={trainingOpen}
        title="Record manager training"
        onClose={() => setTrainingOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTrainingOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="training-form"
              loading={trainingSaving}
            >
              Record
            </Button>
          </>
        }
      >
        <form id="training-form" className="stack" onSubmit={saveTraining}>
          {trainingError ? (
            <InfoNotice tone="warning">{trainingError}</InfoNotice>
          ) : null}
          <FormField label="Person" htmlFor="training-person">
            <PersonSelect
              id="training-person"
              value={trainingPerson}
              onChange={setTrainingPerson}
            />
          </FormField>
          <div className="form-grid">
            <FormField label="Training code" htmlFor="training-code">
              <TextInput
                id="training-code"
                value={trainingCode}
                onChange={(event) => setTrainingCode(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Title" htmlFor="training-title">
              <TextInput
                id="training-title"
                value={trainingTitle}
                onChange={(event) => setTrainingTitle(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Completed" htmlFor="training-completed">
              <TextInput
                id="training-completed"
                type="date"
                value={trainingCompletedAt}
                onChange={(event) =>
                  setTrainingCompletedAt(event.target.value)
                }
                required
              />
            </FormField>
            <FormField label="Expires (optional)" htmlFor="training-expires">
              <TextInput
                id="training-expires"
                type="date"
                value={trainingExpiresAt}
                onChange={(event) => setTrainingExpiresAt(event.target.value)}
              />
            </FormField>
            <FormField
              label="Evidence reference"
              htmlFor="training-evidence"
            >
              <TextInput
                id="training-evidence"
                value={trainingEvidence}
                onChange={(event) => setTrainingEvidence(event.target.value)}
              />
            </FormField>
          </div>
        </form>
      </Modal>

      <Modal
        open={calibrationOpen}
        title="Record calibration session"
        description="Select the attendees who reviewed scoring anchors together."
        onClose={() => setCalibrationOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCalibrationOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="calibration-form"
              loading={calibrationSaving}
            >
              Record
            </Button>
          </>
        }
      >
        <form
          id="calibration-form"
          className="stack"
          onSubmit={saveCalibration}
        >
          {calibrationError ? (
            <InfoNotice tone="warning">{calibrationError}</InfoNotice>
          ) : null}
          <div className="form-grid">
            <FormField label="Code" htmlFor="calibration-code">
              <TextInput
                id="calibration-code"
                value={calibrationCode}
                onChange={(event) => setCalibrationCode(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Title" htmlFor="calibration-title">
              <TextInput
                id="calibration-title"
                value={calibrationTitle}
                onChange={(event) => setCalibrationTitle(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Held on" htmlFor="calibration-held">
              <TextInput
                id="calibration-held"
                type="date"
                value={calibrationHeldAt}
                onChange={(event) => setCalibrationHeldAt(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Facilitator" htmlFor="calibration-facilitator">
              <PersonSelect
                id="calibration-facilitator"
                value={calibrationFacilitator}
                onChange={setCalibrationFacilitator}
              />
            </FormField>
          </div>
          <div className="detail-section">
            <div className="detail-section__title">Attendees</div>
            <div className="stack">
              {people.map((person) => (
                <label className="checkbox" key={person.id}>
                  <input
                    type="checkbox"
                    checked={calibrationAttendees.includes(person.id)}
                    onChange={(event) =>
                      setCalibrationAttendees((current) =>
                        event.target.checked
                          ? [...current, person.id]
                          : current.filter((id) => id !== person.id),
                      )
                    }
                  />
                  <span>{person.displayName}</span>
                </label>
              ))}
            </div>
          </div>
          <FormField label="Notes" htmlFor="calibration-notes">
            <Textarea
              id="calibration-notes"
              value={calibrationNotes}
              onChange={(event) => setCalibrationNotes(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      <Panel
        title="Pilot enrollments"
        subtitle="Voluntary cohorts with evidence of consent and scope"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openPilotForm}
          >
            Enroll
          </Button>
        }
        flush
      >
        {pilots.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={pilots.error} onRetry={pilots.reload} />
          </div>
        ) : pilots.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (pilots.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="people"
            title="No pilot enrollment"
            description="Enroll volunteers with a consent signature reference and a defined pilot scope."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Pilot</th>
                  <th>Scope</th>
                  <th>Consent</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pilots.data?.map((enrollment) => (
                  <tr key={enrollment.id}>
                    <td>{displayName(enrollment.personId, people)}</td>
                    <td className="mono">{enrollment.pilotCode}</td>
                    <td>{enrollment.scope}</td>
                    <td className="mono">
                      {shortId(enrollment.consentSignatureRef, 12)}
                    </td>
                    <td>
                      <Badge status={enrollment.status} />
                    </td>
                    <td className="cell-actions">
                      {enrollment.status === "ACTIVE" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void withdrawPilot(enrollment)}
                          loading={pilotSaving}
                        >
                          Withdraw
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

      <Modal
        open={pilotOpen}
        title="Enroll in pilot"
        description="Only voluntary participation with a recorded consent reference is accepted."
        onClose={() => setPilotOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPilotOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="pilot-form"
              loading={pilotSaving}
            >
              Enroll
            </Button>
          </>
        }
      >
        <form id="pilot-form" className="stack" onSubmit={savePilot}>
          {pilotError ? (
            <InfoNotice tone="warning">{pilotError}</InfoNotice>
          ) : null}
          <FormField label="Person" htmlFor="pilot-person">
            <PersonSelect
              id="pilot-person"
              value={pilotPerson}
              onChange={setPilotPerson}
            />
          </FormField>
          <FormField label="Pilot code" htmlFor="pilot-code">
            <TextInput
              id="pilot-code"
              value={pilotCode}
              onChange={(event) => setPilotCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Scope" htmlFor="pilot-scope">
            <TextInput
              id="pilot-scope"
              value={pilotScope}
              onChange={(event) => setPilotScope(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="Consent / e-signature reference"
            htmlFor="pilot-consent"
          >
            <TextInput
              id="pilot-consent"
              value={pilotConsent}
              onChange={(event) => setPilotConsent(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      <Panel
        title="Break-glass grants"
        subtitle="Time-bound, reason-required access to sensitive payroll fields"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openGrantForm}
          >
            Grant access
          </Button>
        }
        flush
      >
        {grants.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={grants.error} onRetry={grants.reload} />
          </div>
        ) : grants.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (grants.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="lock"
            title="No break-glass grant"
            description="Sensitive payroll fields stay redacted for non-finance viewers unless an admin grants time-bound access."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Grantee</th>
                  <th>Scope</th>
                  <th>Reason</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {grants.data?.map((grant) => (
                  <tr key={grant.id}>
                    <td>{displayName(grant.granteePersonId, people)}</td>
                    <td>{titleCase(grant.scope)}</td>
                    <td>{grant.reason}</td>
                    <td className="nowrap">{formatDateTime(grant.expiresAt)}</td>
                    <td>
                      <Badge status={grant.status} />
                    </td>
                    <td className="cell-actions">
                      {grant.status === "ACTIVE" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void revokeGrant(grant)}
                          loading={grantSaving}
                        >
                          Revoke
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

      <Modal
        open={grantOpen}
        title="Grant break-glass access"
        description="Maximum 24 hours. The grantee cannot approve their own access."
        onClose={() => setGrantOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGrantOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="grant-form"
              loading={grantSaving}
            >
              Grant
            </Button>
          </>
        }
      >
        <form id="grant-form" className="stack" onSubmit={saveGrant}>
          {grantError ? (
            <InfoNotice tone="warning">{grantError}</InfoNotice>
          ) : null}
          <FormField label="Grantee" htmlFor="grant-grantee">
            <PersonSelect
              id="grant-grantee"
              value={granteeId}
              onChange={setGranteeId}
            />
          </FormField>
          <FormField label="Granted by" htmlFor="grant-granted-by">
            <PersonSelect
              id="grant-granted-by"
              value={grantedById}
              onChange={setGrantedById}
            />
          </FormField>
          <FormField label="Reason" htmlFor="grant-reason">
            <TextInput
              id="grant-reason"
              value={grantReason}
              onChange={(event) => setGrantReason(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Duration (hours, max 24)" htmlFor="grant-hours">
            <TextInput
              id="grant-hours"
              type="number"
              min={1}
              max={24}
              value={grantHours}
              onChange={(event) => setGrantHours(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      <Panel
        title="Clawback cases"
        subtitle="Consent, installment and hardship terms before any recovery settlement"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openClawbackForm}
          >
            Record clawback
          </Button>
        }
        flush
      >
        {clawbacks.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={clawbacks.error} onRetry={clawbacks.reload} />
          </div>
        ) : clawbacks.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (clawbacks.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="money"
            title="No clawback case"
            description="Record written consent, installment or hardship terms before recovering an incentive."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="cell-num">Amount</th>
                  <th>Reason</th>
                  <th className="cell-num">Installments</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {clawbacks.data?.map((clawback) => (
                  <tr key={clawback.id}>
                    <td>{displayName(clawback.personId, people)}</td>
                    <td className="cell-num">
                      {formatMoney(clawback.amount, clawback.currency)}
                    </td>
                    <td>
                      <span className="cell-primary">{clawback.reasonCode}</span>
                      <span className="cell-sub">{clawback.explanation}</span>
                    </td>
                    <td className="cell-num">{clawback.installmentMonths}</td>
                    <td>
                      <Badge status={clawback.status} />
                    </td>
                    <td className="cell-actions">
                      <div className="row-actions">
                        {clawback.status === "DRAFT" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void approveClawback(clawback)}
                            loading={clawbackSaving}
                          >
                            Approve
                          </Button>
                        ) : null}
                        {clawback.status === "DRAFT" ||
                        clawback.status === "APPROVED" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setWaiveTarget(clawback);
                              setWaiveReason("");
                            }}
                          >
                            Waive
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={clawbackOpen}
        title="Record clawback terms"
        description="Written consent is required. Recovery still requires a separate settlement-recovery batch."
        onClose={() => setClawbackOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setClawbackOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="clawback-form"
              loading={clawbackSaving}
            >
              Record
            </Button>
          </>
        }
      >
        <form id="clawback-form" className="stack" onSubmit={saveClawback}>
          {clawbackError ? (
            <InfoNotice tone="warning">{clawbackError}</InfoNotice>
          ) : null}
          <FormField label="Person" htmlFor="clawback-person">
            <PersonSelect
              id="clawback-person"
              value={clawbackPerson}
              onChange={setClawbackPerson}
            />
          </FormField>
          <div className="form-grid">
            <FormField label="Amount (CNY)" htmlFor="clawback-amount">
              <TextInput
                id="clawback-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={clawbackAmount}
                onChange={(event) => setClawbackAmount(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Reason code" htmlFor="clawback-reason-code">
              <TextInput
                id="clawback-reason-code"
                value={clawbackReasonCode}
                onChange={(event) =>
                  setClawbackReasonCode(event.target.value)
                }
                required
              />
            </FormField>
            <FormField
              label="Installments (1–12)"
              htmlFor="clawback-installments"
            >
              <TextInput
                id="clawback-installments"
                type="number"
                min={1}
                max={12}
                value={clawbackInstallments}
                onChange={(event) =>
                  setClawbackInstallments(event.target.value)
                }
                required
              />
            </FormField>
            <FormField label="Requester" htmlFor="clawback-requester">
              <PersonSelect
                id="clawback-requester"
                value={clawbackRequester}
                onChange={setClawbackRequester}
              />
            </FormField>
          </div>
          <FormField label="Explanation" htmlFor="clawback-explanation">
            <Textarea
              id="clawback-explanation"
              value={clawbackExplanation}
              onChange={(event) => setClawbackExplanation(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="Consent / e-signature reference"
            htmlFor="clawback-consent"
          >
            <TextInput
              id="clawback-consent"
              value={clawbackConsent}
              onChange={(event) => setClawbackConsent(event.target.value)}
              required
            />
          </FormField>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={clawbackHardship}
              onChange={(event) => setClawbackHardship(event.target.checked)}
            />
            <span>Apply a hardship waiver</span>
          </label>
          {clawbackHardship ? (
            <FormField
              label="Hardship reason"
              htmlFor="clawback-hardship"
            >
              <TextInput
                id="clawback-hardship"
                value={clawbackHardshipReason}
                onChange={(event) =>
                  setClawbackHardshipReason(event.target.value)
                }
                required
              />
            </FormField>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={Boolean(waiveTarget)}
        title="Waive clawback"
        onClose={() => setWaiveTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setWaiveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              type="submit"
              form="waive-form"
              loading={clawbackSaving}
            >
              Waive
            </Button>
          </>
        }
      >
        <form id="waive-form" className="stack" onSubmit={waiveClawback}>
          <FormField label="Waiver reason" htmlFor="waive-reason">
            <TextInput
              id="waive-reason"
              value={waiveReason}
              onChange={(event) => setWaiveReason(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      <Panel
        title="Discretionary pool reviews"
        subtitle="Committee decisions with an independent employee observer"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => void openPoolReviewForm()}
          >
            Record review
          </Button>
        }
        flush
      >
        {poolReviews.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice
              error={poolReviews.error}
              onRetry={poolReviews.reload}
            />
          </div>
        ) : poolReviews.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (poolReviews.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="budget"
            title="No discretionary review"
            description="Record the committee, employee observer and selection criteria used for a discretionary pool."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th>Committee</th>
                  <th>Observer</th>
                  <th>Criteria</th>
                  <th>Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {poolReviews.data?.map((review) => {
                  const pool = pools.data?.find(
                    (candidate) => candidate.id === review.poolId,
                  );
                  return (
                    <tr key={review.id}>
                      <td>
                        <span className="cell-primary">
                          {pool?.name ?? shortId(review.poolId, 10)}
                        </span>
                        <span className="cell-sub mono">
                          {pool?.code ?? ""}
                        </span>
                      </td>
                      <td>{review.committeePersonIds.length} members</td>
                      <td>
                        {review.employeeObserverPersonId
                          ? displayName(
                              review.employeeObserverPersonId,
                              people,
                            )
                          : "None"}
                      </td>
                      <td>{review.selectionCriteria}</td>
                      <td className="nowrap">
                        {formatDate(review.reviewedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={poolReviewOpen}
        title="Record discretionary pool review"
        description="At least two committee members and an optional independent employee observer."
        onClose={() => setPoolReviewOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setPoolReviewOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="pool-review-form"
              loading={poolReviewSaving}
            >
              Record review
            </Button>
          </>
        }
      >
        <form
          id="pool-review-form"
          className="stack"
          onSubmit={savePoolReview}
        >
          {poolReviewError ? (
            <InfoNotice tone="warning">{poolReviewError}</InfoNotice>
          ) : null}
          <FormField label="Budget pool" htmlFor="pool-review-pool">
            <Select
              id="pool-review-pool"
              value={poolReviewPool}
              onChange={(event) => setPoolReviewPool(event.target.value)}
              required
            >
              <option value="">Select a pool…</option>
              {pools.data?.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.name} · {pool.code}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="detail-section">
            <div className="detail-section__title">
              Committee (select at least two)
            </div>
            <div className="stack">
              {people.map((person) => (
                <label className="checkbox" key={person.id}>
                  <input
                    type="checkbox"
                    checked={poolReviewCommittee.includes(person.id)}
                    onChange={(event) =>
                      setPoolReviewCommittee((current) =>
                        event.target.checked
                          ? [...current, person.id]
                          : current.filter((id) => id !== person.id),
                      )
                    }
                  />
                  <span>{person.displayName}</span>
                </label>
              ))}
            </div>
          </div>
          <FormField
            label="Employee observer (independent, optional)"
            htmlFor="pool-review-observer"
          >
            <Select
              id="pool-review-observer"
              value={poolReviewObserver}
              onChange={(event) => setPoolReviewObserver(event.target.value)}
            >
              <option value="">No observer</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Reviewed by" htmlFor="pool-review-reviewer">
            <PersonSelect
              id="pool-review-reviewer"
              value={poolReviewReviewer}
              onChange={setPoolReviewReviewer}
            />
          </FormField>
          <FormField
            label="Selection criteria"
            htmlFor="pool-review-criteria"
          >
            <Textarea
              id="pool-review-criteria"
              value={poolReviewCriteria}
              onChange={(event) => setPoolReviewCriteria(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Decision notes" htmlFor="pool-review-notes">
            <Textarea
              id="pool-review-notes"
              value={poolReviewNotes}
              onChange={(event) => setPoolReviewNotes(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      <Panel
        title="Model provider policies"
        subtitle="Zero-retention, DPA, inference region and egress allowlist per provider"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openPolicyForm}
          >
            Record policy
          </Button>
        }
        flush
      >
        {providerPolicies.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice
              error={providerPolicies.error}
              onRetry={providerPolicies.reload}
            />
          </div>
        ) : providerPolicies.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (providerPolicies.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="ai"
            title="No provider policy"
            description="Record zero-retention confirmation, DPA reference, region and egress allowlist before enabling provider-policy enforcement."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Zero retention</th>
                  <th>DPA</th>
                  <th>Region</th>
                  <th>Egress</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {providerPolicies.data?.map((policy) => (
                  <tr key={policy.id}>
                    <td className="mono">{policy.provider}</td>
                    <td>
                      <Badge
                        tone={
                          policy.zeroRetentionConfirmed ? "success" : "danger"
                        }
                      >
                        {policy.zeroRetentionConfirmed ? "Confirmed" : "Missing"}
                      </Badge>
                    </td>
                    <td className="mono">{policy.dpaRef}</td>
                    <td>{policy.inferenceRegion}</td>
                    <td>{policy.egressAllowlist.join(", ")}</td>
                    <td>
                      <Badge status={policy.status} />
                    </td>
                    <td className="cell-actions">
                      {policy.status === "ACTIVE" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void retirePolicy(policy)}
                          loading={policySaving}
                        >
                          Retire
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

      <Modal
        open={policyOpen}
        title="Record model-provider policy"
        description="Enforcement is enabled per tenant with requireModelProviderPolicy."
        onClose={() => setPolicyOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPolicyOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="provider-policy-form"
              loading={policySaving}
            >
              Record policy
            </Button>
          </>
        }
      >
        <form
          id="provider-policy-form"
          className="stack"
          onSubmit={savePolicy}
        >
          {policyError ? (
            <InfoNotice tone="warning">{policyError}</InfoNotice>
          ) : null}
          <div className="form-grid">
            <FormField label="Provider" htmlFor="policy-provider">
              <TextInput
                id="policy-provider"
                value={policyProvider}
                onChange={(event) => setPolicyProvider(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Inference region" htmlFor="policy-region">
              <TextInput
                id="policy-region"
                value={policyRegion}
                onChange={(event) => setPolicyRegion(event.target.value)}
                required
              />
            </FormField>
            <FormField label="DPA reference" htmlFor="policy-dpa">
              <TextInput
                id="policy-dpa"
                value={policyDpa}
                onChange={(event) => setPolicyDpa(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Approver" htmlFor="policy-approver">
              <PersonSelect
                id="policy-approver"
                value={policyApprover}
                onChange={setPolicyApprover}
              />
            </FormField>
          </div>
          <FormField
            label="Egress allowlist (comma separated)"
            htmlFor="policy-egress"
          >
            <TextInput
              id="policy-egress"
              value={policyEgress}
              onChange={(event) => setPolicyEgress(event.target.value)}
              required
            />
          </FormField>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={policyZeroRetention}
              onChange={(event) =>
                setPolicyZeroRetention(event.target.checked)
              }
            />
            <span>Provider contract confirms zero retention.</span>
          </label>
        </form>
      </Modal>

      <Panel
        title="Audit redactions"
        subtitle="Two-person overlay for sensitive free-text reasons; hash chain stays intact"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openRedactionForm}
          >
            Redact event
          </Button>
        }
        flush
      >
        {redactions.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={redactions.error} onRetry={redactions.reload} />
          </div>
        ) : redactions.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (redactions.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="lock"
            title="No audit redaction"
            description="Only redact free-text reasons when they contain unrelated personal or sensitive data; the original event hash remains unchanged."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Audit event</th>
                  <th>Replacement</th>
                  <th>Reason</th>
                  <th>Requested / approved</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {redactions.data?.map((redaction) => (
                  <tr key={redaction.id}>
                    <td className="mono">
                      {shortId(redaction.auditEventId, 12)}
                    </td>
                    <td className="mono">{redaction.replacement}</td>
                    <td>{redaction.reason}</td>
                    <td className="mono">
                      {shortId(redaction.requestedBy, 8)} /{" "}
                      {shortId(redaction.approvedBy, 8)}
                    </td>
                    <td className="nowrap">
                      {formatDateTime(redaction.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={redactionOpen}
        title="Redact audit reason"
        description="Two different people must request and approve the redaction."
        onClose={() => setRedactionOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRedactionOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="redaction-form"
              loading={redactionSaving}
            >
              Redact
            </Button>
          </>
        }
      >
        <form id="redaction-form" className="stack" onSubmit={saveRedaction}>
          {redactionError ? (
            <InfoNotice tone="warning">{redactionError}</InfoNotice>
          ) : null}
          <FormField label="Audit event id" htmlFor="redaction-event">
            <TextInput
              id="redaction-event"
              value={redactionEventId}
              onChange={(event) => setRedactionEventId(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Reason" htmlFor="redaction-reason">
            <TextInput
              id="redaction-reason"
              value={redactionReason}
              onChange={(event) => setRedactionReason(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Requested by" htmlFor="redaction-requester">
            <PersonSelect
              id="redaction-requester"
              value={redactionRequester}
              onChange={setRedactionRequester}
            />
          </FormField>
          <FormField label="Approved by" htmlFor="redaction-approver">
            <PersonSelect
              id="redaction-approver"
              value={redactionApprover}
              onChange={setRedactionApprover}
            />
          </FormField>
        </form>
      </Modal>

      <Panel
        title="Retention disposal requests"
        subtitle="Reviewed, two-person, grace-period workflow; no automatic hard delete"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openDisposalForm}
          >
            Request disposal
          </Button>
        }
        flush
      >
        {disposals.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={disposals.error} onRetry={disposals.reload} />
          </div>
        ) : disposals.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (disposals.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="clock"
            title="No disposal request"
            description="Disposal requires a non-held retention policy, a reason, a second approver and a future grace date."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Scheduled</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {disposals.data?.map((request) => (
                  <tr key={request.id}>
                    <td className="mono">{request.dataCategory}</td>
                    <td>{request.reason}</td>
                    <td>
                      <Badge status={request.status} />
                    </td>
                    <td className="nowrap">
                      {formatDateTime(request.scheduledFor)}
                    </td>
                    <td className="cell-actions">
                      {request.status === "REQUESTED" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void approveDisposal(request)}
                          loading={disposalSaving}
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

      <Modal
        open={disposalOpen}
        title="Request retention disposal"
        description="A different person must approve; the request cannot complete before its scheduled grace date."
        onClose={() => setDisposalOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDisposalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="disposal-form"
              loading={disposalSaving}
            >
              Request
            </Button>
          </>
        }
      >
        <form id="disposal-form" className="stack" onSubmit={saveDisposal}>
          {disposalError ? (
            <InfoNotice tone="warning">{disposalError}</InfoNotice>
          ) : null}
          <FormField label="Retention policy" htmlFor="disposal-policy">
            <Select
              id="disposal-policy"
              value={disposalPolicy}
              onChange={(event) => setDisposalPolicy(event.target.value)}
              required
            >
              <option value="">Select a policy…</option>
              {(retention.data ?? [])
                .filter((policy) => !policy.legalHold)
                .map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.dataCategory} · {policy.retentionMonths} months
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="Requested by" htmlFor="disposal-requester">
            <PersonSelect
              id="disposal-requester"
              value={disposalRequester}
              onChange={setDisposalRequester}
            />
          </FormField>
          <FormField label="Reason" htmlFor="disposal-reason">
            <Textarea
              id="disposal-reason"
              value={disposalReason}
              onChange={(event) => setDisposalReason(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      <InfoNotice>
        <Icon name="shield" size={15} /> Automated retention deletion is not
        enabled. A retention policy records the rule and legal hold; disposal
        remains a reviewed, manual operation.
      </InfoNotice>

      <p className="subtle" style={{ fontSize: 11.5, marginTop: 18 }}>
        Session context is stored in this browser for development. Person{" "}
        {shortId(session.personId, 12)}.
      </p>
    </>
  );
}
