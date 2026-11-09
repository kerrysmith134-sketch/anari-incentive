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
import { ApiError, api, DEFAULT_SESSION } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  displayName,
  formatDate,
  formatDateTime,
  formatMoney,
  shortId,
  titleCase,
} from "../lib/format.js";
import type {
  AuditRedaction,
  BreakGlassGrant,
  BudgetPool,
  CalibrationSession,
  ClawbackCase,
  ClawbackSchedule,
  ConflictDeclaration,
  DataClassification,
  DataMapReport,
  DiscretionaryPoolReview,
  DpiaRecord,
  FairnessCommitment,
  FieldAccessPolicyMatrix,
  DsarRequest,
  ManagerTrainingRecord,
  ModelProviderPolicy,
  PilotEnrollment,
  PlatformIdentity,
  RetentionDisposalRequest,
  RetentionPolicy,
  RetentionRecommendation,
  RetentionRecommendationsReport,
  TrustSurveyReport,
  TrustSurveyRun,
} from "../lib/types.js";

export function SettingsPage() {
  useDocumentTitle("设置");
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
  const [dpiaOpen, setDpiaOpen] = useState(false);
  const [dpiaType, setDpiaType] = useState("DPIA");
  const [dpiaScope, setDpiaScope] = useState("");
  const [dpiaRisk, setDpiaRisk] = useState("{}");
  const [dpiaError, setDpiaError] = useState<string | null>(null);
  const [dsarOpen, setDsarOpen] = useState(false);
  const [dsarPerson, setDsarPerson] = useState(session.personId);
  const [dsarType, setDsarType] = useState("ACCESS");
  const [dsarError, setDsarError] = useState<string | null>(null);
  const [resolveTarget, setResolveTarget] = useState<DsarRequest | null>(null);
  const [resolveStatus, setResolveStatus] = useState("RESOLVED");
  const [resolveRef, setResolveRef] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const retention = useApiQuery<RetentionPolicy[]>("/api/v1/retention-policies");
  const retentionReport = useApiQuery<{
    generatedAt: string;
    policies: Array<
      RetentionPolicy & {
        cutoffDate: string;
        eligibleForDisposal: boolean;
      }
    >;
  }>("/api/v1/retention-policies/report");
  const retentionRecommendations =
    useApiQuery<RetentionRecommendationsReport>(
      "/api/v1/retention-policies/recommended",
    );
  const fieldPolicies = useApiQuery<FieldAccessPolicyMatrix>(
    "/api/v1/field-access-policies",
  );
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
    "季度信任与程序公平调查",
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
    "公平激励沟通",
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
    "评级校准",
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
  const [scheduleTarget, setScheduleTarget] = useState<ClawbackCase | null>(
    null,
  );
  const [schedule, setSchedule] = useState<ClawbackSchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
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
  const subscription = useApiQuery<
    import("../lib/ops-types.js").TenantSubscriptionView | null
  >("/api/v1/me/subscription");
  const myInvoices = useApiQuery<
    import("../lib/ops-types.js").TenantInvoiceView[]
  >("/api/v1/me/invoices");
  const [recoveryTarget, setRecoveryTarget] = useState<ClawbackCase | null>(
    null,
  );
  const [recoveryCycleId, setRecoveryCycleId] = useState("");
  const [recoveryLedgerId, setRecoveryLedgerId] = useState("");
  const [recoveryCreateBatch, setRecoveryCreateBatch] = useState(true);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [disposalProcessing, setDisposalProcessing] = useState(false);
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
      "会话已更新",
      "正在刷新以应用租户与人员上下文。",
    );
    window.setTimeout(() => window.location.reload(), 450);
  }

  function resetSession() {
    updateSession(DEFAULT_SESSION);
    setTenantId(DEFAULT_SESSION.tenantId);
    setUserId(DEFAULT_SESSION.userId);
    setPersonId(DEFAULT_SESSION.personId);
    setToken("");
    toast.success("会话已重置", "已恢复开发默认值。");
    window.setTimeout(() => window.location.reload(), 450);
  }

  const openDsars =
    dsars.data?.filter((request) => request.status === "OPEN") ?? [];
  const overdueDsars = openDsars.filter(
    (request) => request.dueAt && new Date(request.dueAt).getTime() < Date.now(),
  );
  const heldPolicies =
    retention.data?.filter((policy) => policy.legalHold) ?? [];
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [retentionCategory, setRetentionCategory] = useState("");
  const [retentionMonths, setRetentionMonths] = useState("");
  const [retentionBasis, setRetentionBasis] = useState("");
  const [fieldPolicyOpen, setFieldPolicyOpen] = useState(false);
  const [fieldPolicyJson, setFieldPolicyJson] = useState("{}");
  const [fieldPolicyError, setFieldPolicyError] = useState<string | null>(
    null,
  );
  const [fieldPolicySaving, setFieldPolicySaving] = useState(false);

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

  async function createDpia(event: FormEvent) {
    event.preventDefault();
    setDpiaError(null);
    try {
      await api("/api/v1/dpia-records", {
        method: "POST",
        body: {
          assessmentType: dpiaType,
          scope: dpiaScope.trim(),
          riskSummary: JSON.parse(dpiaRisk) as Record<string, unknown>,
        },
      });
      toast.success("评估已创建", dpiaScope.trim());
      setDpiaOpen(false);
      dpias.reload();
    } catch (caught) {
      setDpiaError(
        caught instanceof ApiError ? caught.message : "创建评估失败",
      );
    }
  }

  async function approveDpia(record: DpiaRecord) {
    try {
      await api(`/api/v1/dpia-records/${record.id}/approve`, {
        method: "POST",
        body: { approvedBy: session.personId },
      });
      toast.success("评估已批准", shortId(record.id, 8));
      dpias.reload();
    } catch (caught) {
      toast.error(
        "批准失败",
        caught instanceof ApiError ? caught.message : undefined,
      );
    }
  }

  async function createDsar(event: FormEvent) {
    event.preventDefault();
    setDsarError(null);
    try {
      await api("/api/v1/dsar-requests", {
        method: "POST",
        body: { personId: dsarPerson, requestType: dsarType },
      });
      toast.success("请求已创建", dsarType);
      setDsarOpen(false);
      dsars.reload();
    } catch (caught) {
      setDsarError(caught instanceof ApiError ? caught.message : "创建请求失败");
    }
  }

  async function resolveDsar(event: FormEvent) {
    event.preventDefault();
    if (!resolveTarget) return;
    setResolveError(null);
    try {
      await api(`/api/v1/dsar-requests/${resolveTarget.id}/resolve`, {
        method: "POST",
        body: { resolution: resolveStatus, resolutionRef: resolveRef.trim() },
      });
      toast.success("请求已处理", resolveStatus);
      setResolveTarget(null);
      dsars.reload();
    } catch (caught) {
      setResolveError(
        caught instanceof ApiError ? caught.message : "处理请求失败",
      );
    }
  }

  function openRetentionForm(preset?: RetentionRecommendation) {
    setRetentionCategory(preset?.dataCategory ?? "");
    setRetentionMonths(preset ? String(preset.retentionMonths) : "");
    setRetentionBasis(preset?.legalBasis ?? "");
    setRetentionError(null);
    setRetentionOpen(true);
  }

  function openFieldPolicies() {
    setFieldPolicyJson(
      JSON.stringify(fieldPolicies.data?.configured ?? {}, null, 2),
    );
    setFieldPolicyError(null);
    setFieldPolicyOpen(true);
  }

  async function saveFieldPolicies() {
    setFieldPolicySaving(true);
    setFieldPolicyError(null);
    try {
      const parsed = JSON.parse(fieldPolicyJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("策略必须是 JSON 对象。");
      }
      await api("/api/v1/field-access-policies", {
        method: "PUT",
        body: { policies: parsed },
      });
      toast.success("字段权限矩阵已更新");
      setFieldPolicyOpen(false);
      fieldPolicies.reload();
    } catch (caught) {
      setFieldPolicyError(
        caught instanceof Error ? caught.message : "操作失败。",
      );
    } finally {
      setFieldPolicySaving(false);
    }
  }

  async function saveRetention(event: FormEvent) {
    event.preventDefault();
    setRetentionSaving(true);
    setRetentionError(null);
    try {
      await api("/api/v1/retention-policies", {
        method: "POST",
        body: {
          dataCategory: retentionCategory.trim(),
          retentionMonths: Number(retentionMonths),
          legalBasis: retentionBasis.trim(),
          legalHold: false,
        },
      });
      toast.success("保留策略已创建");
      setRetentionOpen(false);
      retention.reload();
      retentionRecommendations.reload();
    } catch (caught) {
      setRetentionError(
        caught instanceof Error ? caught.message : "操作失败。",
      );
    } finally {
      setRetentionSaving(false);
    }
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
        "承诺已发布",
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
    setSurveyTitle("季度信任与程序公平调查");
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
        error instanceof Error ? error.message : "操作失败。",
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
        "需另一人批准，随后进入宽限期。",
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
        error instanceof Error ? error.message : "操作失败。",
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
      toast.success("审计脱敏已记录");
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
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setPolicySaving(false);
    }
  }

  async function openPoolReviewForm() {
    const poolList = pools.data ?? [];
    if (poolList.length === 0) {
      toast.error("暂无预算池", "Create a pool before reviewing it.");
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
      toast.success("追回案例已记录");
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

  async function generateRecovery(event: FormEvent) {
    event.preventDefault();
    if (!recoveryTarget) return;
    setRecoveryError(null);
    setRecoveryBusy(true);
    try {
      await api(
        `/api/v1/clawback-cases/${recoveryTarget.id}/generate-recovery`,
        {
          method: "POST",
          body: {
            cycleId: recoveryCycleId.trim(),
            ledgerEntryId: recoveryLedgerId.trim(),
            createBatch: recoveryCreateBatch,
          },
        },
      );
      toast.success(
        "Recovery generated",
        recoveryCreateBatch
          ? "已创建 RECOVERY 结算批次；受影响人员须确认后才能锁定。"
          : "The locked ledger adjustment was appended.",
      );
      setRecoveryTarget(null);
      clawbacks.reload();
    } catch (error) {
      setRecoveryError(
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function processDueDisposals() {
    setDisposalProcessing(true);
    try {
      const result = await api<{
        processedCount: number;
        skipped: Array<{ requestId: string; reason: string }>;
      }>("/api/v1/retention-disposal-requests:process", {
        method: "POST",
        body: { actorPersonId: session.personId },
      });
      toast.success(
        "Disposals processed",
        `${result.processedCount} completed${
          result.skipped.length > 0
            ? `, ${result.skipped.length} skipped (legal hold or guards)`
            : ""
        }`,
      );
      disposals.reload();
    } catch (error) {
      toast.error(
        "Could not process disposals",
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setDisposalProcessing(false);
    }
  }

  async function approveClawback(clawback: ClawbackCase) {
    setClawbackSaving(true);
    try {
      await api(`/api/v1/clawback-cases/${clawback.id}/approve`, {
        method: "POST",
        body: { approvedBy: session.personId },
      });
      toast.success("追回已批准");
      clawbacks.reload();
    } catch (error) {
      toast.error(
        "批准追回失败",
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setClawbackSaving(false);
    }
  }

  async function openSchedule(clawback: ClawbackCase) {
    setScheduleTarget(clawback);
    setSchedule(null);
    setScheduleError(null);
    setScheduleLoading(true);
    try {
      setSchedule(
        await api<ClawbackSchedule>(
          `/api/v1/clawback-cases/${clawback.id}/schedule`,
        ),
      );
    } catch (error) {
      setScheduleError(
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setScheduleLoading(false);
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
      toast.success("追回已豁免");
      setWaiveTarget(null);
      setWaiveReason("");
      clawbacks.reload();
    } catch (error) {
      toast.error(
        "Could not waive clawback",
        error instanceof Error ? error.message : "操作失败。",
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
      toast.success("紧急授权已创建");
      setGrantOpen(false);
      grants.reload();
    } catch (error) {
      setGrantError(
        error instanceof Error
          ? error.message
          : "创建授予失败。",
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
      toast.success("紧急授权已撤销");
      grants.reload();
    } catch (error) {
      toast.error(
        "Could not revoke grant",
        error instanceof Error ? error.message : "操作失败。",
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
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setPilotSaving(false);
    }
  }

  function openTrainingForm() {
    setTrainingPerson(session.personId);
    setTrainingCode("FAIRNESS_101");
    setTrainingTitle("公平激励沟通");
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
      toast.success("培训已记录");
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
    setCalibrationTitle("评级校准");
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
        "冲突已申报",
        "该两人之间的贡献认定已被阻断。",
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
      toast.success("冲突申报已撤回");
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
        eyebrow="工作区"
        title="设置"
        description="会话身份、外观与本租户的保障登记簿。"
      />

      <div className="split-grid">
        <Panel
          title="会话上下文"
          subtitle="每次 API 调用以 x-tenant-id / x-user-id / x-person-id 发送"
        >
          <form onSubmit={saveSession} className="stack">
            <FormField
              label="租户 ID"
              htmlFor="session-tenant"
              hint="开发模式可用 tenant-demo；PostgreSQL 模式请用租户 UUID。"
            >
              <TextInput
                id="session-tenant"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                required
              />
            </FormField>
            <FormField label="用户 ID" htmlFor="session-user">
              <TextInput
                id="session-user"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="人员 ID"
              htmlFor="session-person"
              hint="用于审批归属、薪酬职责分离与个人范围请求。"
            >
              <TextInput
                id="session-person"
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="OIDC Bearer 令牌（可选）"
              htmlFor="session-token"
              hint="API 以 AUTH_MODE=oidc 运行时使用；仅存本浏览器，生产建议网关注入。"
            >
              <TextInput
                id="session-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="eyJhbGciOi…"
                autoComplete="关"
                spellCheck={false}
              />
            </FormField>
            <div className="form-actions">
              <Button variant="ghost" onClick={resetSession}>
                重置默认
              </Button>
              <Button variant="primary" type="submit" icon="check">
                保存会话
              </Button>
            </div>
          </form>
          <InfoNotice tone="warning">
            <strong>请求头认证仅用于开发环境。</strong> In OIDC
            mode the server ignores these headers and derives identity from the
            signed token.
          </InfoNotice>
          <Link className="btn btn--secondary" to="/my-ai">
            <Icon name="ai" size={16} />
            <span>打开我的 AI 记录</span>
          </Link>
        </Panel>

        <div className="stack">
          <Panel title="外观" subtitle="主题按浏览器记忆">
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

          <Panel title="身份解析" subtitle="服务端所见">
            {identity.error ? (
              <ErrorNotice error={identity.error} onRetry={identity.reload} />
            ) : identity.loading ? (
              <LoadingRows rows={3} />
            ) : identity.data ? (
              <DefinitionList
                items={[
                  { label: "用户", value: <span className="mono">{identity.data.userId}</span> },
                  {
                    label: "Linked person",
                    value: identity.data.personId ? (
                      <span className="mono">{identity.data.personId}</span>
                    ) : (
                      "未绑定"
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
              <CopyButton value={session.tenantId} label="复制租户" />
              <CopyButton value={session.personId} label="复制人员" />
            </div>
          </Panel>

          <Panel title="系统健康" subtitle="来自本浏览器的实时探测">
            <DefinitionList
              items={[
                {
                  label: "API health",
                  value: health.loading ? (
                    "检查中…"
                  ) : health.error ? (
                    <Badge tone="danger">不可达</Badge>
                  ) : (
                    <Badge tone="success">
                      {titleCase(health.data?.status ?? "ok")}
                    </Badge>
                  ),
                },
                {
                  label: "审计链",
                  value: auditChain.loading ? (
                    "检查中…"
                  ) : auditChain.data?.valid ? (
                    <Badge tone="success">已验证</Badge>
                  ) : (
                    <Badge tone="danger">需要关注</Badge>
                  ),
                },
                {
                  label: "控制台来源",
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
          eyebrow="登记簿"
          title="保障记录"
          description="正式周期依赖的隐私与保留物证的只读视图。"
        />
      </div>

      <div className="split-grid">
        <Panel
          title="DPIAs"
          subtitle="数据保护影响评估"
          action={
            <div className="row-actions">
              <Badge tone="neutral" dot={false}>{dpias.data?.length ?? 0}</Badge>
              <Button size="sm" variant="secondary" icon="plus" onClick={() => setDpiaOpen(true)}>
                新建评估
              </Button>
            </div>
          }
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
              title="暂无 DPIA 记录"
              description="涉及员工数据的政策版本应引用已批准的评估。"
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>范围</th>
                    <th>状态</th>
                    <th>已批准</th>
                    <th />
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
                      <td className="cell-actions">
                        {record.status === "DRAFT" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void approveDpia(record)}
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
          title="个人数据请求"
          subtitle={`${openDsars.length} open · ${overdueDsars.length} overdue`}
          action={
            <div className="row-actions">
              <Badge tone={overdueDsars.length > 0 ? "danger" : "neutral"} dot={false}>{dsars.data?.length ?? 0}</Badge>
              <Button size="sm" variant="secondary" icon="plus" onClick={() => setDsarOpen(true)}>
                新建请求
              </Button>
            </div>
          }
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
              title="暂无个人数据请求"
              description="查询/更正/删除/说明/异议请求在此展示。"
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>人员</th>
                    <th>状态</th>
                    <th>截止</th>
                    <th />
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
                        <td className="cell-actions">
                          {request.status === "OPEN" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setResolveTarget(request);
                                setResolveStatus("RESOLVED");
                                setResolveRef("");
                                setResolveError(null);
                              }}
                            >
                              处理
                            </Button>
                          ) : null}
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
        title="订阅"
        subtitle="本租户的套餐、席位与发票（只读；由平台运营方管理）"
        className="section-gap"
      >
        {subscription.error ? (
          <div style={{ padding: 16 }}>
            <InfoNotice>
              No subscription is attached to this tenant. Onboarding and seat
              limits are unrestricted until the platform operator assigns a
              plan.
            </InfoNotice>
          </div>
        ) : subscription.data ? (
          <div style={{ padding: 16 }} className="stack">
            <DefinitionList
              items={[
                {
                  label: "套餐",
                  value: `${subscription.data.planName} (${subscription.data.planCode})`,
                },
                { label: "状态", value: subscription.data.status },
                { label: "席位", value: String(subscription.data.seats) },
                {
                  label: "周期结束",
                  value: formatDateTime(subscription.data.currentPeriodEnd),
                },
              ]}
            />
            {(myInvoices.data ?? []).length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>发票</th>
                    <th>状态</th>
                    <th>合计</th>
                    <th>截止</th>
                  </tr>
                </thead>
                <tbody>
                  {(myInvoices.data ?? []).map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <code>{invoice.number}</code>
                      </td>
                      <td>{invoice.status}</td>
                      <td>
                        {invoice.totalAmount} {invoice.currency}
                      </td>
                      <td>{invoice.dueDate ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="hint">暂无发票</p>
            )}
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        )}
      </Panel>

      <Panel
        title="保留策略"
        subtitle={`${heldPolicies.length} under legal hold`}
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => openRetentionForm()}
          >
            新增策略
          </Button>
        }
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
            title="暂无保留策略"
            description="按数据类别定义保留月数与法律依据；自动删除被有意关闭。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>数据类别</th>
                  <th className="cell-num">保留</th>
                  <th>法律依据</th>
                  <th>法务保留</th>
                  <th>截止日</th>
                  <th>处置</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {retention.data?.map((policy) => {
                  const report = retentionReport.data?.policies.find(
                    (entry) => entry.id === policy.id,
                  );
                  return (
                    <tr key={policy.id}>
                      <td>
                        <span className="cell-primary">
                          {policy.dataCategory}
                        </span>
                        <span className="cell-sub mono">
                          {shortId(policy.id, 10)}
                        </span>
                      </td>
                      <td className="cell-num">
                        {policy.retentionMonths} months
                      </td>
                      <td>{policy.legalBasis}</td>
                      <td>
                        <Badge tone={policy.legalHold ? "warning" : "neutral"}>
                          {policy.legalHold ? "Held" : "无"}
                        </Badge>
                      </td>
                      <td className="nowrap">{report?.cutoffDate ?? "—"}</td>
                      <td>
                        {report ? (
                          <Badge
                            tone={
                              report.eligibleForDisposal ? "warning" : "neutral"
                            }
                          >
                            {report.eligibleForDisposal
                              ? "Eligible"
                              : "已阻断"}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="nowrap">{formatDate(policy.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {retentionRecommendations.data ? (
          <div style={{ padding: "14px 16px 18px" }}>
            <div className="detail-section__title">系统推荐</div>
            <p className="muted" style={{ marginTop: 4 }}>
              {retentionRecommendations.data.note}
            </p>
            <div className="chip-row">
              {retentionRecommendations.data.recommendations.map(
                (recommendation) => (
                  <button
                    key={recommendation.dataCategory}
                    type="button"
                    className="chip"
                    onClick={() => openRetentionForm(recommendation)}
                    title={recommendation.legalBasis}
                  >
                    {recommendation.dataCategory} ·{" "}
                    {recommendation.retentionMonths}m
                    {recommendation.configured ? " · configured" : ""}
                  </button>
                ),
              )}
            </div>
          </div>
        ) : null}
      </Panel>

      <Modal
        open={retentionOpen}
        title="添加保留策略"
        description="保守的系统默认；请确认你所在法域的法律依据，法务保留始终优先。"
        onClose={() => setRetentionOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRetentionOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="retention-form"
              loading={retentionSaving}
            >
              创建策略
            </Button>
          </>
        }
      >
        <form id="retention-form" className="stack" onSubmit={saveRetention}>
          {retentionError ? (
            <InfoNotice tone="warning">{retentionError}</InfoNotice>
          ) : null}
          <FormField label="推荐类别" htmlFor="retention-preset">
            <Select
              id="retention-preset"
              value={retentionCategory}
              onChange={(event) => {
                const selected =
                  retentionRecommendations.data?.recommendations.find(
                    (row) => row.dataCategory === event.target.value,
                  );
                if (selected) {
                  setRetentionCategory(selected.dataCategory);
                  setRetentionMonths(String(selected.retentionMonths));
                  setRetentionBasis(selected.legalBasis);
                } else {
                  setRetentionCategory(event.target.value);
                }
              }}
            >
              <option value="">自定义类别</option>
              {retentionRecommendations.data?.recommendations.map(
                (recommendation) => (
                  <option
                    key={recommendation.dataCategory}
                    value={recommendation.dataCategory}
                  >
                    {recommendation.dataCategory} ·{" "}
                    {recommendation.retentionMonths} months
                  </option>
                ),
              )}
            </Select>
          </FormField>
          <FormField label="数据类别" htmlFor="retention-category">
            <TextInput
              id="retention-category"
              value={retentionCategory}
              onChange={(event) => setRetentionCategory(event.target.value)}
              placeholder="PAYROLL_RECORDS"
              required
            />
          </FormField>
          <FormField label="保留月数" htmlFor="retention-months">
            <TextInput
              id="retention-months"
              type="number"
              min="1"
              value={retentionMonths}
              onChange={(event) => setRetentionMonths(event.target.value)}
              required
            />
          </FormField>
          <FormField label="法律依据" htmlFor="retention-basis">
            <Textarea
              id="retention-basis"
              value={retentionBasis}
              onChange={(event) => setRetentionBasis(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      <Panel
        title="数据源登记簿"
        subtitle="每个激励数据源的责任人、响应 SLA 与字段级分类"
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
            登记数据源
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
            icon="server"
            title="暂无数据源"
            description="登记每个供证系统、责任人与其贡献的字段。"
          />
        ) : (
          <>
            <div className="coverage-grid" style={{ padding: 16 }}>
              <div className="coverage-cell">
                <div className="coverage-cell__label">活跃数据源</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.activeSources}
                </div>
                <div className="coverage-cell__sub">
                  {dataMap.data.summary.sources} registered
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">个人数据源</div>
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
                <div className="coverage-cell__label">跨境</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.crossBorderSources}
                </div>
                <div className="coverage-cell__sub">
                  {dataMap.data.summary.processors.length} processors
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">逾期复核</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.overdueReviews}
                </div>
                <div className="coverage-cell__sub">
                  复核周期 90 天
                </div>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>来源</th>
                    <th>负责人</th>
                    <th className="cell-num">SLA</th>
                    <th>关键级</th>
                    <th>字段</th>
                    <th>复核</th>
                    <th>状态</th>
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
                          <span className="cell-sub">个人数据</span>
                        ) : null}
                      </td>
                      <td>
                        {source.reviewOverdue ? (
                          <Badge tone="danger">已逾期</Badge>
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
        title="登记数据源"
        description="责任人、响应 SLA 与本数据源贡献的最小字段集。"
        onClose={() => setSourceOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setSourceOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="data-source-form"
              icon="check"
              loading={sourceSaving}
            >
              登记数据源
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
            <FormField label="编码" htmlFor="source-code">
              <TextInput
                id="source-code"
                value={sourceCode}
                onChange={(event) => setSourceCode(event.target.value)}
                required
              />
            </FormField>
            <FormField label="名称" htmlFor="source-name">
              <TextInput
                id="source-name"
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
                required
              />
            </FormField>
            <FormField label="类别" htmlFor="source-category">
              <TextInput
                id="source-category"
                value={sourceCategory}
                onChange={(event) => setSourceCategory(event.target.value)}
                required
              />
            </FormField>
            <FormField label="负责人" htmlFor="source-owner">
              <PersonSelect
                id="source-owner"
                value={sourceOwner}
                onChange={setSourceOwner}
              />
            </FormField>
            <FormField label="响应 SLA（小时）" htmlFor="source-sla">
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
            <FormField label="关键级" htmlFor="source-criticality">
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
                <option value="MEDIUM">中</option>
                <option value="HIGH">高</option>
                <option value="CRITICAL">严重</option>
              </Select>
            </FormField>
            <FormField label="存储区域" htmlFor="source-region">
              <TextInput
                id="source-region"
                value={sourceRegion}
                onChange={(event) => setSourceRegion(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="处理者（逗号分隔）"
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
            <span>该数据源包含个人数据。</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={sourceCrossBorder}
              onChange={(event) => setSourceCrossBorder(event.target.checked)}
            />
            <span>数据出境（中国大陆以外）。</span>
          </label>
          <div className="detail-section">
            <div className="detail-section__title">字段映射</div>
            <div className="stack">
              {sourceFields.map((field, index) => (
                <div className="form-grid" key={index}>
                  <FormField label="字段" htmlFor={`source-field-${index}`}>
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
                    label="分类"
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
                      <option value="PUBLIC">公开</option>
                      <option value="INTERNAL">内部</option>
                      <option value="CONFIDENTIAL">内部保密</option>
                      <option value="PERSONAL">个人</option>
                      <option value="SENSITIVE">敏感</option>
                    </Select>
                  </FormField>
                  <FormField
                    label="用途"
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
                    label="保留月数"
                    htmlFor={`source-retention-${index}`}
                    hint="PERSONAL/SENSITIVE 字段必填。"
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
                    移除
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
              添加字段
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
        title="利益冲突申报"
        subtitle="生效的关联方申报会阻断两人互相认定"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openConflictForm}
          >
            申报冲突
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
            title="暂无冲突申报"
            description="申报应回避认定对方贡献的近亲属或财务关系。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>人员</th>
                  <th>关系</th>
                  <th>状态</th>
                  <th>已申报</th>
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
                          撤销
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
        title="申报利益冲突"
        description="申报生效期间，双方不能认定彼此的贡献。"
        onClose={() => setConflictOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConflictOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="conflict-form"
              loading={conflictSaving}
            >
              申报
            </Button>
          </>
        }
      >
        <form id="conflict-form" className="stack" onSubmit={saveConflict}>
          {conflictError ? (
            <InfoNotice tone="warning">{conflictError}</InfoNotice>
          ) : null}
          <FormField label="申报人" htmlFor="conflict-person">
            <PersonSelect
              id="conflict-person"
              value={conflictPerson}
              onChange={setConflictPerson}
            />
          </FormField>
          <FormField label="关联人" htmlFor="conflict-related">
            <PersonSelect
              id="conflict-related"
              value={conflictRelated}
              onChange={setConflictRelated}
            />
          </FormField>
          <FormField label="关系" htmlFor="conflict-type">
            <TextInput
              id="conflict-type"
              value={conflictType}
              onChange={(event) => setConflictType(event.target.value)}
              placeholder="家庭 / 财务 / 前上级…"
              required
            />
          </FormField>
          <FormField label="说明" htmlFor="conflict-description">
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
        title="撤回冲突申报"
        onClose={() => setRevokeTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              type="submit"
              form="revoke-conflict-form"
              loading={conflictSaving}
            >
              撤销
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
          <FormField label="撤回原因" htmlFor="revoke-reason">
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
        title="信任调查"
        subtitle="关于公平、发声与流程信心的匿名季度调查"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openSurveyForm}
          >
            创建调查
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
            title="暂无信任调查"
            description="创建调查→开放作答→关闭后与上期对比维度均值。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>调查</th>
                  <th>周期</th>
                  <th>状态</th>
                  <th className="cell-num">题目</th>
                  <th>窗口</th>
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
                            待处理
                          </Button>
                        ) : null}
                        {survey.status === "OPEN" ? (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => openRespond(survey)}
                            >
                              作答
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void changeSurveyStatus(survey, "close")
                              }
                            >
                              关闭
                            </Button>
                          </>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setReportTarget(survey)}
                        >
                          报告
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
        title="创建调查"
        description="题目按 1–5 分作答；响应仅存假名哈希与得分。"
        onClose={() => setSurveyOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setSurveyOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="survey-form"
              loading={surveySaving}
            >
              创建调查
            </Button>
          </>
        }
      >
        <form id="survey-form" className="stack" onSubmit={saveSurvey}>
          {surveyError ? (
            <InfoNotice tone="warning">{surveyError}</InfoNotice>
          ) : null}
          <div className="form-grid">
            <FormField label="编码" htmlFor="survey-code">
              <TextInput
                id="survey-code"
                value={surveyCode}
                onChange={(event) => setSurveyCode(event.target.value)}
                required
              />
            </FormField>
            <FormField label="周期" htmlFor="survey-period">
              <TextInput
                id="survey-period"
                value={surveyPeriod}
                onChange={(event) => setSurveyPeriod(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="标题"
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
            <div className="detail-section__title">题目</div>
            <div className="stack">
              {surveyQuestions.map((question, index) => (
                <div className="form-grid" key={index}>
                  <FormField
                    label="编码"
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
                    label="提示词"
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
                    label="维度"
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
                    移除
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
              添加题目
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(respondTarget)}
        title="参与调查"
        onClose={() => setRespondTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRespondTarget(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="survey-response-form"
              loading={surveySaving}
            >
              提交作答
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
                { label: "调查", value: respondTarget.title },
                { label: "周期", value: respondTarget.period },
                {
                  label: "Anonymity",
                  value: "Only a pseudonymous hash is stored with scores.",
                },
              ]}
            />
            <FormField label="作答人" htmlFor="survey-respondent">
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
                  hint="1 = 非常不同意 · 5 = 非常同意"
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
                { label: "周期", value: report.data.survey.period },
                {
                  label: "Responses",
                  value: report.data.responseCount,
                },
                {
                  label: "状态",
                  value: <Badge status={report.data.survey.status} />,
                },
              ]}
            />
            <div className="detail-section">
              <div className="detail-section__title">维度均值</div>
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
              <div className="detail-section__title">题目均值</div>
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
        title="无报复承诺"
        subtitle="已发布的公平声明；新版本发布即替代旧版"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openCommitmentForm}
          >
            发布承诺
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
            title="暂无公平承诺"
            description="发布声明：善意反馈不受报复。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>版本</th>
                  <th>声明</th>
                  <th>渠道</th>
                  <th>状态</th>
                  <th>已发布</th>
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
        title="发布公平承诺"
        description="员工应能看到本声明及配套的申诉统计。"
        onClose={() => setCommitmentOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCommitmentOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="commitment-form"
              loading={commitmentSaving}
            >
              发布
            </Button>
          </>
        }
      >
        <form id="commitment-form" className="stack" onSubmit={publishCommitment}>
          {commitmentError ? (
            <InfoNotice tone="warning">{commitmentError}</InfoNotice>
          ) : null}
          <FormField label="声明" htmlFor="commitment-statement">
            <Textarea
              id="commitment-statement"
              value={commitmentStatement}
              onChange={(event) => setCommitmentStatement(event.target.value)}
              required
            />
          </FormField>
          <FormField label="负责人" htmlFor="commitment-owner">
            <PersonSelect
              id="commitment-owner"
              value={commitmentOwner}
              onChange={setCommitmentOwner}
            />
          </FormField>
          <FormField
            label="发布渠道（逗号分隔）"
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
        title="经理赋能"
        subtitle="支持一致复核的培训完成与校准会"
        className="section-gap"
        flush
      >
        <div className="split-grid" style={{ padding: 16 }}>
          <div className="detail-section" style={{ marginTop: 0 }}>
            <div className="detail-section__title">
              培训记录
              <Button
                size="sm"
                variant="secondary"
                icon="plus"
                onClick={openTrainingForm}
              >
                记录
              </Button>
            </div>
            {training.error ? (
              <ErrorNotice error={training.error} onRetry={training.reload} />
            ) : training.loading ? (
              <LoadingRows rows={2} />
            ) : (training.data?.length ?? 0) === 0 ? (
              <p className="muted">暂无经理培训记录。</p>
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
              校准会
              <Button
                size="sm"
                variant="secondary"
                icon="plus"
                onClick={openCalibrationForm}
              >
                记录
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
              <p className="muted">暂无校准会记录。</p>
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
        title="记录经理培训"
        onClose={() => setTrainingOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTrainingOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="training-form"
              loading={trainingSaving}
            >
              记录
            </Button>
          </>
        }
      >
        <form id="training-form" className="stack" onSubmit={saveTraining}>
          {trainingError ? (
            <InfoNotice tone="warning">{trainingError}</InfoNotice>
          ) : null}
          <FormField label="人员" htmlFor="training-person">
            <PersonSelect
              id="training-person"
              value={trainingPerson}
              onChange={setTrainingPerson}
            />
          </FormField>
          <div className="form-grid">
            <FormField label="培训编码" htmlFor="training-code">
              <TextInput
                id="training-code"
                value={trainingCode}
                onChange={(event) => setTrainingCode(event.target.value)}
                required
              />
            </FormField>
            <FormField label="标题" htmlFor="training-title">
              <TextInput
                id="training-title"
                value={trainingTitle}
                onChange={(event) => setTrainingTitle(event.target.value)}
                required
              />
            </FormField>
            <FormField label="已完成" htmlFor="training-completed">
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
            <FormField label="到期（可选）" htmlFor="training-expires">
              <TextInput
                id="training-expires"
                type="date"
                value={trainingExpiresAt}
                onChange={(event) => setTrainingExpiresAt(event.target.value)}
              />
            </FormField>
            <FormField
              label="证据引用"
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
        title="记录校准会"
        description="选择共同校准评分锚点的参加人。"
        onClose={() => setCalibrationOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCalibrationOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="calibration-form"
              loading={calibrationSaving}
            >
              记录
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
            <FormField label="编码" htmlFor="calibration-code">
              <TextInput
                id="calibration-code"
                value={calibrationCode}
                onChange={(event) => setCalibrationCode(event.target.value)}
                required
              />
            </FormField>
            <FormField label="标题" htmlFor="calibration-title">
              <TextInput
                id="calibration-title"
                value={calibrationTitle}
                onChange={(event) => setCalibrationTitle(event.target.value)}
                required
              />
            </FormField>
            <FormField label="举办于" htmlFor="calibration-held">
              <TextInput
                id="calibration-held"
                type="date"
                value={calibrationHeldAt}
                onChange={(event) => setCalibrationHeldAt(event.target.value)}
                required
              />
            </FormField>
            <FormField label="主持人" htmlFor="calibration-facilitator">
              <PersonSelect
                id="calibration-facilitator"
                value={calibrationFacilitator}
                onChange={setCalibrationFacilitator}
              />
            </FormField>
          </div>
          <div className="detail-section">
            <div className="detail-section__title">参加人</div>
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
        title="试点登记"
        subtitle="有同意凭证与范围的自愿群体"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openPilotForm}
          >
            加入试点
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
            title="暂无试点登记"
            description="以同意签名引用与明确的试点范围登记自愿者。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>人员</th>
                  <th>试点</th>
                  <th>范围</th>
                  <th>同意</th>
                  <th>状态</th>
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
                          撤回
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
        title="加入试点"
        description="仅接受有同意引用记录的自愿参与。"
        onClose={() => setPilotOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPilotOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="pilot-form"
              loading={pilotSaving}
            >
              加入试点
            </Button>
          </>
        }
      >
        <form id="pilot-form" className="stack" onSubmit={savePilot}>
          {pilotError ? (
            <InfoNotice tone="warning">{pilotError}</InfoNotice>
          ) : null}
          <FormField label="人员" htmlFor="pilot-person">
            <PersonSelect
              id="pilot-person"
              value={pilotPerson}
              onChange={setPilotPerson}
            />
          </FormField>
          <FormField label="试点编码" htmlFor="pilot-code">
            <TextInput
              id="pilot-code"
              value={pilotCode}
              onChange={(event) => setPilotCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="范围" htmlFor="pilot-scope">
            <TextInput
              id="pilot-scope"
              value={pilotScope}
              onChange={(event) => setPilotScope(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="同意/电子签引用"
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
        title="紧急授权"
        subtitle="限时、需理由的敏感薪酬字段访问"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openGrantForm}
          >
            授予访问
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
            title="暂无紧急授权"
            description="非财务角色默认看不到敏感薪酬字段，除非管理员授予限时访问。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>被授权人</th>
                  <th>范围</th>
                  <th>原因</th>
                  <th>过期时间</th>
                  <th>状态</th>
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
                          撤销
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
        title="授予紧急访问"
        description="最长 24 小时；被授权人不能批准自己的访问。"
        onClose={() => setGrantOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGrantOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="grant-form"
              loading={grantSaving}
            >
              授予
            </Button>
          </>
        }
      >
        <form id="grant-form" className="stack" onSubmit={saveGrant}>
          {grantError ? (
            <InfoNotice tone="warning">{grantError}</InfoNotice>
          ) : null}
          <FormField label="被授权人" htmlFor="grant-grantee">
            <PersonSelect
              id="grant-grantee"
              value={granteeId}
              onChange={setGranteeId}
            />
          </FormField>
          <FormField label="授予人" htmlFor="grant-granted-by">
            <PersonSelect
              id="grant-granted-by"
              value={grantedById}
              onChange={setGrantedById}
            />
          </FormField>
          <FormField label="原因" htmlFor="grant-reason">
            <TextInput
              id="grant-reason"
              value={grantReason}
              onChange={(event) => setGrantReason(event.target.value)}
              required
            />
          </FormField>
          <FormField label="时长（小时，最长 24）" htmlFor="grant-hours">
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
        title="追回案例"
        subtitle="追回结算前的同意、分期与困难条款"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openClawbackForm}
          >
            记录追回
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
            icon="wallet"
            title="暂无追回案例"
            description="追回激励前先记录书面同意、分期或困难条款。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>人员</th>
                  <th className="cell-num">金额</th>
                  <th>原因</th>
                  <th className="cell-num">分期</th>
                  <th>状态</th>
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
                      {clawback.recovery?.batchNo ? (
                        <span className="cell-sub">
                          {clawback.recovery.batchNo} ·{" "}
                          {clawback.recovery.batchStatus ?? "待分批"}
                        </span>
                      ) : null}
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
                            批准
                          </Button>
                        ) : null}
                        {clawback.status === "APPROVED" ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void openSchedule(clawback)}
                            >
                              计划
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setRecoveryTarget(clawback);
                                setRecoveryCycleId("");
                                setRecoveryLedgerId("");
                                setRecoveryCreateBatch(true);
                                setRecoveryError(null);
                              }}
                            >
                              生成追回
                            </Button>
                          </>
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
                            豁免
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
        title="记录追回条款"
        description="书面同意必填；追回仍需单独的 RECOVERY 结算批次。"
        onClose={() => setClawbackOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setClawbackOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="clawback-form"
              loading={clawbackSaving}
            >
              记录
            </Button>
          </>
        }
      >
        <form id="clawback-form" className="stack" onSubmit={saveClawback}>
          {clawbackError ? (
            <InfoNotice tone="warning">{clawbackError}</InfoNotice>
          ) : null}
          <FormField label="人员" htmlFor="clawback-person">
            <PersonSelect
              id="clawback-person"
              value={clawbackPerson}
              onChange={setClawbackPerson}
            />
          </FormField>
          <div className="form-grid">
            <FormField label="金额（元）" htmlFor="clawback-amount">
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
            <FormField label="原因码" htmlFor="clawback-reason-code">
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
              label="分期（1–12）"
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
            <FormField label="发起人" htmlFor="clawback-requester">
              <PersonSelect
                id="clawback-requester"
                value={clawbackRequester}
                onChange={setClawbackRequester}
              />
            </FormField>
          </div>
          <FormField label="说明" htmlFor="clawback-explanation">
            <Textarea
              id="clawback-explanation"
              value={clawbackExplanation}
              onChange={(event) => setClawbackExplanation(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="同意/电子签引用"
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
            <span>困难豁免</span>
          </label>
          {clawbackHardship ? (
            <FormField
              label="困难原因"
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
        title="豁免追回"
        description={
          waiveTarget?.recovery
            ? `该案已生成追回（批次 ${waiveTarget.recovery.batchNo ?? "未分批"}，状态 ${waiveTarget.recovery.batchStatus ?? "待分批"}）。豁免将冲销一笔 +${waiveTarget.amount} ${waiveTarget.currency} 并取消对应结算批次；批次已锁定则会被拒绝。`
            : "该案尚未生成追回；豁免只关闭案件，不影响账本。"
        }
        onClose={() => setWaiveTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setWaiveTarget(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              type="submit"
              form="waive-form"
              loading={clawbackSaving}
            >
              豁免
            </Button>
          </>
        }
      >
        <form id="waive-form" className="stack" onSubmit={waiveClawback}>
          <FormField label="豁免理由" htmlFor="waive-reason">
            <TextInput
              id="waive-reason"
              value={waiveReason}
              onChange={(event) => setWaiveReason(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(scheduleTarget)}
        title="追回分期排期"
        description="逐期校验生效合同的扣款上限与最低工资下限。"
        onClose={() => {
          setScheduleTarget(null);
          setSchedule(null);
          setScheduleError(null);
        }}
        wide
        footer={
          <Button
            variant="ghost"
            onClick={() => {
              setScheduleTarget(null);
              setSchedule(null);
              setScheduleError(null);
            }}
          >
            关闭
          </Button>
        }
      >
        {scheduleLoading ? (
          <LoadingRows rows={3} />
        ) : scheduleError ? (
          <ErrorNotice
            error={new Error(scheduleError)}
            onRetry={
              scheduleTarget
                ? () => void openSchedule(scheduleTarget)
                : undefined
            }
          />
        ) : !schedule ? null : !schedule.available ? (
          <InfoNotice tone="warning">
            No active contract in {scheduleTarget?.currency} is available for
            this person, so the minimum-wage and deduction-cap checks cannot be
            completed. Do not collect before an authorised review.
          </InfoNotice>
        ) : (
          <div className="stack">
            <InfoNotice
              tone={
                schedule.blockedCount && schedule.blockedCount > 0
                  ? "warning"
                  : "success"
              }
            >
              {schedule.blockedCount} blocked installment(s) · cap{" "}
              {formatMoney(
                schedule.deductionCapAmount ?? "0",
                schedule.currency ?? "CNY",
              )}{" "}
              · minimum wage{" "}
              {formatMoney(
                schedule.minimumMonthlyWage ?? "0",
                schedule.currency ?? "CNY",
              )}
            </InfoNotice>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="cell-num">#</th>
                    <th>截止</th>
                    <th className="cell-num">金额</th>
                    <th className="cell-num">剩余工资</th>
                    <th>检查</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.installments.map((installment) => (
                    <tr key={installment.sequence}>
                      <td className="cell-num">{installment.sequence}</td>
                      <td>{formatDate(installment.dueDate)}</td>
                      <td className="cell-num">
                        {formatMoney(
                          installment.amount,
                          schedule.currency ?? "CNY",
                        )}
                      </td>
                      <td className="cell-num">
                        {formatMoney(
                          installment.remainingWage,
                          schedule.currency ?? "CNY",
                        )}
                      </td>
                      <td>
                        <Badge
                          status={
                            installment.minimumWagePassed &&
                            installment.deductionCapPassed
                              ? "PASSED"
                              : "BLOCKED"
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {schedule.scheduleHash ? (
              <p className="subtle" style={{ fontSize: 11.5 }}>
                Schedule hash {schedule.scheduleHash.slice(0, 24)}…
              </p>
            ) : null}
          </div>
        )}
      </Modal>

      <Panel
        title="机动池评审"
        subtitle="委员会决策 + 独立员工观察员"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => void openPoolReviewForm()}
          >
            记录复核
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
            icon="wallet"
            title="暂无机动池评审"
            description="记录机动池的评审委员会、员工观察员与评选标准。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>资金池</th>
                  <th>评审委员会</th>
                  <th>员工观察员</th>
                  <th>评选标准</th>
                  <th>已复核</th>
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
                          : "无"}
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
        title="记录机动池评审"
        description="至少两名委员会成员与可选的独立员工观察员。"
        onClose={() => setPoolReviewOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setPoolReviewOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="pool-review-form"
              loading={poolReviewSaving}
            >
              记录复核
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
          <FormField label="预算池" htmlFor="pool-review-pool">
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
              评审委员会（至少选两人）
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
            label="员工观察员（独立，可选）"
            htmlFor="pool-review-observer"
          >
            <Select
              id="pool-review-observer"
              value={poolReviewObserver}
              onChange={(event) => setPoolReviewObserver(event.target.value)}
            >
              <option value="">无观察员</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="评审人" htmlFor="pool-review-reviewer">
            <PersonSelect
              id="pool-review-reviewer"
              value={poolReviewReviewer}
              onChange={setPoolReviewReviewer}
            />
          </FormField>
          <FormField
            label="评选标准"
            htmlFor="pool-review-criteria"
          >
            <Textarea
              id="pool-review-criteria"
              value={poolReviewCriteria}
              onChange={(event) => setPoolReviewCriteria(event.target.value)}
              required
            />
          </FormField>
          <FormField label="决策说明" htmlFor="pool-review-notes">
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
        title="模型供应商策略"
        subtitle="每个供应商的零留存、DPA、推理区域与出口白名单"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openPolicyForm}
          >
            记录策略
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
            title="暂无供应商策略"
            description="启用供应商策略强制前，登记零留存确认、DPA 引用、区域与出口白名单。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>供应商</th>
                  <th>零留存</th>
                  <th>DPA</th>
                  <th>推理区域</th>
                  <th>出口白名单</th>
                  <th>状态</th>
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
                        {policy.zeroRetentionConfirmed ? "Confirmed" : "缺失"}
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
                          退役
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
        title="记录供应商策略"
        description="租户通过 requireModelProviderPolicy 启用强制。"
        onClose={() => setPolicyOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPolicyOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="provider-policy-form"
              loading={policySaving}
            >
              记录策略
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
            <FormField label="供应商" htmlFor="policy-provider">
              <TextInput
                id="policy-provider"
                value={policyProvider}
                onChange={(event) => setPolicyProvider(event.target.value)}
                required
              />
            </FormField>
            <FormField label="推理区域" htmlFor="policy-region">
              <TextInput
                id="policy-region"
                value={policyRegion}
                onChange={(event) => setPolicyRegion(event.target.value)}
                required
              />
            </FormField>
            <FormField label="DPA 引用" htmlFor="policy-dpa">
              <TextInput
                id="policy-dpa"
                value={policyDpa}
                onChange={(event) => setPolicyDpa(event.target.value)}
                required
              />
            </FormField>
            <FormField label="审批人" htmlFor="policy-approver">
              <PersonSelect
                id="policy-approver"
                value={policyApprover}
                onChange={setPolicyApprover}
              />
            </FormField>
          </div>
          <FormField
            label="出口白名单（逗号分隔）"
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
            <span>供应商合同确认零留存。</span>
          </label>
        </form>
      </Modal>

      <Panel
        title="审计脱敏"
        subtitle="敏感自由文本原因的双人脱敏；哈希链不变"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openRedactionForm}
          >
            脱敏事件
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
            title="暂无审计脱敏"
            description="仅当自由文本原因含无关个人/敏感数据时脱敏；原事件哈希保持不变。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>审计事件</th>
                  <th>替换文本</th>
                  <th>原因</th>
                  <th>申请 / 批准</th>
                  <th>创建时间</th>
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
        title="脱敏审计原因"
        description="请求与批准脱敏必须为不同两人。"
        onClose={() => setRedactionOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRedactionOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="redaction-form"
              loading={redactionSaving}
            >
              脱敏
            </Button>
          </>
        }
      >
        <form id="redaction-form" className="stack" onSubmit={saveRedaction}>
          {redactionError ? (
            <InfoNotice tone="warning">{redactionError}</InfoNotice>
          ) : null}
          <FormField label="审计事件 ID" htmlFor="redaction-event">
            <TextInput
              id="redaction-event"
              value={redactionEventId}
              onChange={(event) => setRedactionEventId(event.target.value)}
              required
            />
          </FormField>
          <FormField label="原因" htmlFor="redaction-reason">
            <TextInput
              id="redaction-reason"
              value={redactionReason}
              onChange={(event) => setRedactionReason(event.target.value)}
              required
            />
          </FormField>
          <FormField label="发起人" htmlFor="redaction-requester">
            <PersonSelect
              id="redaction-requester"
              value={redactionRequester}
              onChange={setRedactionRequester}
            />
          </FormField>
          <FormField label="批准人" htmlFor="redaction-approver">
            <PersonSelect
              id="redaction-approver"
              value={redactionApprover}
              onChange={setRedactionApprover}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(recoveryTarget)}
        title="生成追回"
        onClose={() => setRecoveryTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRecoveryTarget(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="generate-recovery-form"
              loading={recoveryBusy}
              disabled={
                !recoveryCycleId.trim() || !recoveryLedgerId.trim()
              }
            >
              生成追回
            </Button>
          </>
        }
      >
        <form id="generate-recovery-form" onSubmit={generateRecovery}>
          {recoveryError ? (
            <div className="section-gap">
              <InfoNotice tone="warning">{recoveryError}</InfoNotice>
            </div>
          ) : null}
          <DefinitionList
            items={[
              {
                label: "案件",
                value: `${recoveryTarget?.amount ?? ""} ${recoveryTarget?.currency ?? ""} · ${recoveryTarget?.reasonCode ?? ""}`,
              },
              {
                label: "Effect",
                value:
                  "追加一笔锁定负向账本调整（按案例幂等）。已确认的结算周期拒绝追溯调整。",
              },
            ]}
          />
          <FormField
            label="周期 ID"
            htmlFor="recovery-cycle"
            hint="承载调整的 RECOVERY 结算批次所属周期。"
          >
            <TextInput
              id="recovery-cycle"
              value={recoveryCycleId}
              onChange={(event) => setRecoveryCycleId(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="账本条目 ID"
            htmlFor="recovery-ledger"
            hint="要调整的原锁定激励条目（在「结算」账本视图查找）。"
          >
            <TextInput
              id="recovery-ledger"
              value={recoveryLedgerId}
              onChange={(event) => setRecoveryLedgerId(event.target.value)}
              required
            />
          </FormField>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={recoveryCreateBatch}
              onChange={(event) => setRecoveryCreateBatch(event.target.checked)}
            />{" "}
            Open a RECOVERY settlement batch (affected people must confirm
            before locking)
          </label>
        </form>
      </Modal>

      <Panel
        title="保留处置请求"
        subtitle="双人复核 + 宽限期的处置流程；无自动硬删除"
        className="section-gap"
        action={
          <div className="row-actions">
            <Button
              size="sm"
              variant="secondary"
              loading={disposalProcessing}
              onClick={() => void processDueDisposals()}
            >
              处理到期处置
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              onClick={openDisposalForm}
            >
              申请处置
            </Button>
          </div>
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
            title="暂无处置请求"
            description="处置需要无保留的策略、理由、第二审批人与未来的宽限期。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>类别</th>
                  <th>原因</th>
                  <th>状态</th>
                  <th>已排期</th>
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

      <Modal
        open={disposalOpen}
        title="申请保留处置"
        description="必须由另一人批准；未到宽限日期不可完成。"
        onClose={() => setDisposalOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDisposalOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="disposal-form"
              loading={disposalSaving}
            >
              请求
            </Button>
          </>
        }
      >
        <form id="disposal-form" className="stack" onSubmit={saveDisposal}>
          {disposalError ? (
            <InfoNotice tone="warning">{disposalError}</InfoNotice>
          ) : null}
          <FormField label="保留策略" htmlFor="disposal-policy">
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
          <FormField label="发起人" htmlFor="disposal-requester">
            <PersonSelect
              id="disposal-requester"
              value={disposalRequester}
              onChange={setDisposalRequester}
            />
          </FormField>
          <FormField label="原因" htmlFor="disposal-reason">
            <Textarea
              id="disposal-reason"
              value={disposalReason}
              onChange={(event) => setDisposalReason(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      <Panel
        title="字段权限矩阵"
        subtitle="薪酬与计算资源的按角色脱敏"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={openFieldPolicies}
          >
            编辑矩阵
          </Button>
        }
        flush
      >
        {fieldPolicies.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice
              error={fieldPolicies.error}
              onRetry={fieldPolicies.reload}
            />
          </div>
        ) : fieldPolicies.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>RESOURCE.field</th>
                  <th>允许角色</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(fieldPolicies.data?.effective ?? {}).map(
                  ([key, roles]) => (
                    <tr key={key}>
                      <td className="mono">{key}</td>
                      <td>{roles.join(", ")}</td>
                      <td>
                        {Object.prototype.hasOwnProperty.call(
                          fieldPolicies.data?.configured ?? {},
                          key,
                        )
                          ? "Tenant override"
                          : "System default"}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={fieldPolicyOpen}
        title="编辑字段权限矩阵"
        description="JSON 对象，将 RESOURCE.field 映射到允许角色；缺失项使用系统默认。"
        onClose={() => setFieldPolicyOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setFieldPolicyOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => void saveFieldPolicies()}
              loading={fieldPolicySaving}
            >
              保存矩阵
            </Button>
          </>
        }
      >
        <div className="stack">
          {fieldPolicyError ? (
            <InfoNotice tone="warning">{fieldPolicyError}</InfoNotice>
          ) : null}
          <FormField label="已配置策略（JSON）" htmlFor="field-policy-json">
            <Textarea
              id="field-policy-json"
              value={fieldPolicyJson}
              onChange={(event) => setFieldPolicyJson(event.target.value)}
              className="mono"
            />
          </FormField>
        </div>
      </Modal>

      <InfoNotice>
        <Icon name="shield" size={15} /> 自动保留删除未启用；保留策略只记录规则与法务保留，
        实际处置仍需审批后人工执行。
      </InfoNotice>

      <Modal
        open={dpiaOpen}
        title="新建数据保护影响评估"
        onClose={() => setDpiaOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDpiaOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="dpia-form">
              创建
            </Button>
          </>
        }
      >
        <form id="dpia-form" onSubmit={createDpia} className="form-grid">
          {dpiaError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{dpiaError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="评估类型">
            <Select
              value={dpiaType}
              onChange={(event) => setDpiaType(event.target.value)}
            >
              <option value="DPIA">DPIA</option>
              <option value="PIPIA">PIPIA</option>
            </Select>
          </FormField>
          <FormField label="评估范围" className="field--full">
            <TextInput
              value={dpiaScope}
              onChange={(event) => setDpiaScope(event.target.value)}
              required
            />
          </FormField>
          <FormField label="风险摘要 JSON" className="field--full">
            <Textarea
              rows={5}
              value={dpiaRisk}
              onChange={(event) => setDpiaRisk(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={dsarOpen}
        title="新建个人数据请求"
        onClose={() => setDsarOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDsarOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="dsar-form">
              创建
            </Button>
          </>
        }
      >
        <form id="dsar-form" onSubmit={createDsar} className="form-grid">
          {dsarError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{dsarError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="人员">
            <PersonSelect value={dsarPerson} onChange={setDsarPerson} />
          </FormField>
          <FormField label="请求类型">
            <Select
              value={dsarType}
              onChange={(event) => setDsarType(event.target.value)}
            >
              <option value="ACCESS">查询</option>
              <option value="CORRECTION">更正</option>
              <option value="DELETION">删除</option>
              <option value="EXPLANATION">说明</option>
              <option value="OBJECTION">异议</option>
            </Select>
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(resolveTarget)}
        title="处理个人数据请求"
        onClose={() => setResolveTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResolveTarget(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="dsar-resolve-form">
              确认
            </Button>
          </>
        }
      >
        <form id="dsar-resolve-form" onSubmit={resolveDsar} className="form-grid">
          {resolveError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{resolveError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="处理结论">
            <Select
              value={resolveStatus}
              onChange={(event) => setResolveStatus(event.target.value)}
            >
              <option value="RESOLVED">已解决</option>
              <option value="REJECTED">驳回</option>
            </Select>
          </FormField>
          <FormField label="处理依据 / 引用" className="field--full">
            <TextInput
              value={resolveRef}
              onChange={(event) => setResolveRef(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>
    </>
  );
}
