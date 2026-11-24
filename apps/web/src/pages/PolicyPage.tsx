import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  EmptyState,
  ErrorNotice,
  LoadingRows,
  PageHeader,
  Panel,
  Tabs,
} from "../components/ui.js";
import { AnnualReviewPanel } from "../components/policy/AnnualReviewPanel.js";
import { ConsultationPanel } from "../components/policy/ConsultationPanel.js";
import { CoveragePanel } from "../components/policy/CoveragePanel.js";
import { EmployeeNoticePanel } from "../components/policy/EmployeeNoticePanel.js";
import { PolicyNoticeLinkPanel } from "../components/policy/PolicyNoticeLinkPanel.js";
import { PolicyReadinessSection } from "../components/policy/PolicyReadinessSection.js";
import { RepresentationPanel } from "../components/policy/RepresentationPanel.js";
import { ReportsPanel } from "../components/policy/ReportsPanel.js";
import { RuleChangePanel } from "../components/policy/RuleChangePanel.js";
import { SimulationPanel } from "../components/policy/SimulationPanel.js";
import { TestCasePanel } from "../components/policy/TestCasePanel.js";
import { LegalGateModal } from "../components/policy/LegalGateModal.js";
import { RuleChangeModal } from "../components/policy/RuleChangeModal.js";
import {
  AcknowledgementModal,
  EmployeeNoticeModal,
  NoticeLinkModal,
} from "../components/policy/NoticeModals.js";
import {
  ConsultationConcludeModal,
  ConsultationModal,
  RepresentationModal,
} from "../components/policy/ConsultationModals.js";
import {
  MarginalSweepModal,
  SimulationModal,
} from "../components/policy/SimulationModals.js";
import { TestCaseModal } from "../components/policy/TestCaseModal.js";
import { usePeople } from "../components/PersonSelect.js";
import { useToast } from "../contexts/ToastContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { shortId, titleCase } from "../lib/format.js";
import type {
  OperationsCoverageReport,
  PolicyReadinessReport,
  PolicyReviewReport,
  PolicyTestCase,
  PolicyVersionSummary,
  SubgroupImpactReport,
  SuccessMetricsReport,
} from "../lib/types.js";
import type {
  EmployeeNoticeView,
  EmployeeRepresentationView,
  NoticeAcknowledgementView,
  PolicyConsultationView,
  PolicyNoticeLinkView,
  MarginalSimulationView,
  PolicySimulationResultView,
  RuleChangeOrderView,
} from "../lib/ops-types.js";
import type {
  ReviewerAgreementReport,
  ReviewSnapshot,
} from "../components/policy/ReportsPanel.js";

export function PolicyPage() {
  useDocumentTitle("政策");
  const toast = useToast();
  const { session } = useAuth();
  const { people } = usePeople();
  const versions = useApiQuery<PolicyVersionSummary[]>("/api/v1/policy-versions");
  const coverage = useApiQuery<OperationsCoverageReport>(
    "/api/v1/reports/operations-coverage",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState("readiness");
  const [running, setRunning] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testCode, setTestCode] = useState("");
  const [testCategory, setTestCategory] = useState("BOUNDARY");
  const [testInput, setTestInput] = useState("{}");
  const [testExpected, setTestExpected] = useState("{}");
  const [testError, setTestError] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState<string | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [policyApproved, setPolicyApproved] = useState(false);
  const [minimumWageChecked, setMinimumWageChecked] = useState(false);
  const [democraticRef, setDemocraticRef] = useState("");
  const [noticeRef, setNoticeRef] = useState("");
  const [dpiaRef, setDpiaRef] = useState("");
  const [recordedBy, setRecordedBy] = useState(session.personId);
  const [gateApprovalId, setGateApprovalId] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateSubmitting, setGateSubmitting] = useState(false);
  const ruleChanges = useApiQuery<RuleChangeOrderView[]>(
    "/api/v1/rule-change-orders",
  );
  const notices = useApiQuery<EmployeeNoticeView[]>("/api/v1/notices");
  const representations = useApiQuery<EmployeeRepresentationView[]>(
    "/api/v1/employee-representations",
  );
  const [ruleOpen, setRuleOpen] = useState(false);
  const [rulePolicyCode, setRulePolicyCode] = useState("");
  const [ruleFromVersionId, setRuleFromVersionId] = useState("");
  const [ruleToVersionId, setRuleToVersionId] = useState("");
  const [ruleChangeType, setRuleChangeType] = useState("");
  const [ruleReason, setRuleReason] = useState("");
  const [ruleEffectiveFrom, setRuleEffectiveFrom] = useState("");
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [ruleBusy, setRuleBusy] = useState<string | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeType, setNoticeType] = useState<EmployeeNoticeView["noticeType"]>(
    "POLICY",
  );
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeBodyRef, setNoticeBodyRef] = useState("");
  const [noticePolicyVersionId, setNoticePolicyVersionId] = useState("");
  const [noticeEffectiveFrom, setNoticeEffectiveFrom] = useState("");
  const [noticeAckRequired, setNoticeAckRequired] = useState(true);
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const [ackOpen, setAckOpen] = useState<EmployeeNoticeView | null>(null);
  const [ackPerson, setAckPerson] = useState(session.personId);
  const [ackDecision, setAckDecision] = useState<"ACKNOWLEDGE" | "DECLINE">(
    "ACKNOWLEDGE",
  );
  const [ackSignatureRef, setAckSignatureRef] = useState("");
  const [ackDeclineReason, setAckDeclineReason] = useState("");
  const [ackError, setAckError] = useState<string | null>(null);
  const [ackNoticeId, setAckNoticeId] = useState<string | null>(null);
  const acknowledgements = useApiQuery<NoticeAcknowledgementView[]>(
    ackNoticeId
      ? `/api/v1/notices/${encodeURIComponent(ackNoticeId)}/acknowledgements`
      : null,
    ackNoticeId,
  );
  const [repOpen, setRepOpen] = useState(false);
  const [repName, setRepName] = useState("");
  const [repType, setRepType] =
    useState<EmployeeRepresentationView["bodyType"]>("WORKS_COUNCIL");
  const [repJurisdiction, setRepJurisdiction] = useState("");
  const [repError, setRepError] = useState<string | null>(null);
  const consultations = useApiQuery<PolicyConsultationView[]>(
    "/api/v1/policy-consultations",
  );
  const [consultOpen, setConsultOpen] = useState(false);
  const [consultPolicyVersionId, setConsultPolicyVersionId] = useState("");
  const [consultRepresentationId, setConsultRepresentationId] = useState("");
  const [consultType, setConsultType] =
    useState<PolicyConsultationView["consultationType"]>("DISCUSSION");
  const [consultStartedAt, setConsultStartedAt] = useState("");
  const [consultMinutesRef, setConsultMinutesRef] = useState("");
  const [consultFeedback, setConsultFeedback] = useState("");
  const [consultError, setConsultError] = useState<string | null>(null);
  const [concludeTarget, setConcludeTarget] =
    useState<PolicyConsultationView | null>(null);
  const [concludeOutcome, setConcludeOutcome] =
    useState<"AGREED" | "NO_AGREEMENT" | "INFORMATION_ONLY" | "CLOSED">(
      "AGREED",
    );
  const [concludeMinutesRef, setConcludeMinutesRef] = useState("");
  const [concludeFeedback, setConcludeFeedback] = useState("");
  const [concludeError, setConcludeError] = useState<string | null>(null);
  const policyNotices = useApiQuery<PolicyNoticeLinkView[]>(
    "/api/v1/policy-notices",
  );
  const [simOpen, setSimOpen] = useState(false);
  const [simCurrentId, setSimCurrentId] = useState("");
  const [simProposed, setSimProposed] = useState("{}");
  const [simSamples, setSimSamples] = useState("[]");
  const [simError, setSimError] = useState<string | null>(null);
  const [simRunning, setSimRunning] = useState(false);
  const [simResult, setSimResult] =
    useState<PolicySimulationResultView | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkPolicyVersionId, setLinkPolicyVersionId] = useState("");
  const [linkNoticeId, setLinkNoticeId] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [marginalOpen, setMarginalOpen] = useState(false);
  const [marginalSample, setMarginalSample] = useState("{}");
  const [marginalIndex, setMarginalIndex] = useState("0");
  const [marginalField, setMarginalField] = useState<
    "attributionWeight" | "evaluationMultiplier"
  >("attributionWeight");
  const [marginalFrom, setMarginalFrom] = useState("0.9");
  const [marginalTo, setMarginalTo] = useState("1.1");
  const [marginalStep, setMarginalStep] = useState("0.01");
  const [marginalError, setMarginalError] = useState<string | null>(null);
  const [marginalRunning, setMarginalRunning] = useState(false);
  const [marginalResult, setMarginalResult] =
    useState<MarginalSimulationView | null>(null);

  const list = versions.data ?? [];

  useEffect(() => {
    if (!selectedId && list[0]?.policyVersionId) {
      setSelectedId(list[0].policyVersionId);
    }
  }, [list, selectedId]);

  const selected = list.find(
    (version) => version.policyVersionId === selectedId,
  );
  const readiness = useApiQuery<PolicyReadinessReport>(
    selectedId
      ? `/api/v1/reports/policy-readiness?policyVersionId=${encodeURIComponent(selectedId)}`
      : null,
    selectedId,
  );
  const tests = useApiQuery<PolicyTestCase[]>(
    selectedId
      ? `/api/v1/policy-test-cases?policyVersionId=${encodeURIComponent(selectedId)}`
      : null,
    selectedId,
  );
  const reviewReports = useApiQuery<PolicyReviewReport>(
    "/api/v1/reports/policy-review",
  );
  const reviewSnapshots = useApiQuery<ReviewSnapshot[]>(
    "/api/v1/reports/policy-review/snapshots",
  );
  const reviewerAgreement = useApiQuery<ReviewerAgreementReport>(
    "/api/v1/reports/reviewer-agreement",
  );
  const [reportBusy, setReportBusy] = useState<string | null>(null);
  const review = useApiQuery<PolicyReviewReport>(
    tab === "annual" ? "/api/v1/reports/policy-review" : null,
  );
  const subgroup = useApiQuery<SubgroupImpactReport>(
    tab === "annual" ? "/api/v1/reports/subgroup-impact" : null,
  );
  const successMetrics = useApiQuery<SuccessMetricsReport>(
    "/api/v1/reports/success-metrics",
  );

  function openGate() {
    setPolicyApproved(false);
    setMinimumWageChecked(false);
    setDemocraticRef("");
    setNoticeRef("");
    setDpiaRef("");
    setRecordedBy(session.personId);
    setGateApprovalId("");
    setGateError(null);
    setGateOpen(true);
  }

  async function recordGate() {
    if (!selectedId) return;
    setGateSubmitting(true);
    setGateError(null);
    try {
      await api(`/api/v1/policy-versions/${selectedId}/legal-gate`, {
        method: "POST",
        body: {
          policyApproved,
          minimumWageChecked,
          democraticProcedureRef: democraticRef.trim() || undefined,
          employeeNoticeRef: noticeRef.trim() || undefined,
          dataProtectionAssessmentRef: dpiaRef.trim() || undefined,
          recordedBy,
          approvalRequestId: gateApprovalId.trim() || undefined,
        },
      });
      toast.success("法律门禁已记录", selected?.code);
      setGateOpen(false);
      readiness.reload();
    } catch (caught) {
      setGateError(
        caught instanceof Error
          ? caught.message
          : "记录法律门禁失败。",
      );
    } finally {
      setGateSubmitting(false);
    }
  }

  async function runSuite() {
    if (!selectedId) return;
    setRunning(true);
    try {
      const result = await api<{
        total: number;
        passedCount: number;
        failedCount: number;
        passed: boolean;
      }>(`/api/v1/policy-versions/${selectedId}/test-runs`, {
        method: "POST",
      });
      toast.success(
        result.passed ? "Policy test suite passed" : "Policy test suite failed",
        `${result.passedCount}/${result.total} cases passed`,
      );
      tests.reload();
      readiness.reload();
    } catch (caught) {
      toast.error(
        "运行用例集失败",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setRunning(false);
    }
  }

  async function createTestCase(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    setTestError(null);
    try {
      await api("/api/v1/policy-test-cases", {
        method: "POST",
        body: {
          policyVersionId: selectedId,
          caseCode: testCode.trim(),
          category: testCategory,
          input: JSON.parse(testInput) as Record<string, unknown>,
          expectedOutput: JSON.parse(testExpected) as Record<string, unknown>,
        },
      });
      toast.success("回归用例已创建", testCode.trim());
      setTestOpen(false);
      setTestCode("");
      tests.reload();
      readiness.reload();
    } catch (caught) {
      setTestError(caught instanceof Error ? caught.message : "创建失败");
    }
  }

  async function runTestCase(testCase: PolicyTestCase) {
    setTestBusy(testCase.id);
    try {
      await api(`/api/v1/policy-test-cases/${testCase.id}/run`, {
        method: "POST",
      });
      toast.success("用例已运行", testCase.caseCode);
      tests.reload();
      readiness.reload();
    } catch (caught) {
      toast.error(
        "用例运行失败",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setTestBusy(null);
    }
  }

  async function retireTestCase(testCase: PolicyTestCase) {
    setTestBusy(testCase.id);
    try {
      await api(`/api/v1/policy-test-cases/${testCase.id}/retire`, {
        method: "POST",
      });
      toast.success("用例已停用", testCase.caseCode);
      tests.reload();
      readiness.reload();
    } catch (caught) {
      toast.error(
        "停用失败",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setTestBusy(null);
    }
  }

  function openRuleChange() {
    setRulePolicyCode(selected?.code ?? "");
    setRuleFromVersionId(selectedId ?? "");
    setRuleToVersionId(selectedId ?? "");
    setRuleChangeType("");
    setRuleReason("");
    setRuleEffectiveFrom(
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
    );
    setRuleError(null);
    setRuleOpen(true);
  }

  async function submitRuleChange() {
    setRuleError(null);
    try {
      await api("/api/v1/rule-change-orders", {
        method: "POST",
        body: {
          policyCode: rulePolicyCode.trim(),
          fromPolicyVersionId: ruleFromVersionId.trim() || undefined,
          toPolicyVersionId: ruleToVersionId.trim(),
          changeType: ruleChangeType.trim(),
          reason: ruleReason.trim(),
          effectiveFrom: new Date(ruleEffectiveFrom).toISOString(),
          requestedBy: session.personId,
        },
      });
      toast.success("规则变更单已创建", rulePolicyCode);
      setRuleOpen(false);
      ruleChanges.reload();
    } catch (caught) {
      setRuleError(
        caught instanceof Error ? caught.message : "创建变更单失败",
      );
    }
  }

  async function ruleAction(
    order: RuleChangeOrderView,
    action: "approve" | "reject" | "publicize",
  ) {
    setRuleBusy(`${action}:${order.id}`);
    try {
      await api(`/api/v1/rule-change-orders/${order.id}/${action}`, {
        method: "POST",
        body:
          action === "publicize"
            ? {}
            : { approvedBy: session.personId },
      });
      toast.success(`Rule change ${action}d`, shortId(order.id));
      ruleChanges.reload();
    } catch (caught) {
      toast.error(
        `Could not ${action} the rule change`,
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setRuleBusy(null);
    }
  }

  function openNotice() {
    setNoticeType("POLICY");
    setNoticeTitle("");
    setNoticeBodyRef("");
    setNoticePolicyVersionId(selectedId ?? "");
    setNoticeEffectiveFrom(
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
    );
    setNoticeAckRequired(true);
    setNoticeError(null);
    setNoticeOpen(true);
  }

  async function submitNotice() {
    setNoticeError(null);
    try {
      await api("/api/v1/notices", {
        method: "POST",
        body: {
          noticeType,
          title: noticeTitle.trim(),
          bodyRef: noticeBodyRef.trim(),
          policyVersionId: noticePolicyVersionId.trim() || undefined,
          effectiveFrom: new Date(noticeEffectiveFrom).toISOString(),
          acknowledgementRequired: noticeAckRequired,
        },
      });
      toast.success("通知已发布", noticeTitle);
      setNoticeOpen(false);
      notices.reload();
    } catch (caught) {
      setNoticeError(
        caught instanceof Error ? caught.message : "发布告知失败",
      );
    }
  }

  function openAck(notice: EmployeeNoticeView) {
    setAckOpen(notice);
    setAckPerson(session.personId);
    setAckDecision("ACKNOWLEDGE");
    setAckSignatureRef("");
    setAckDeclineReason("");
    setAckError(null);
  }

  async function submitAck() {
    if (!ackOpen) return;
    setAckError(null);
    try {
      await api(`/api/v1/notices/${ackOpen.id}/acknowledgements`, {
        method: "POST",
        body: {
          personId: ackPerson,
          decision: ackDecision,
          signatureRef: ackSignatureRef.trim() || undefined,
          declineReason:
            ackDecision === "DECLINE"
              ? ackDeclineReason.trim()
              : undefined,
        },
      });
      toast.success(
        ackDecision === "ACKNOWLEDGE" ? "签收已记录" : "婉拒已记录",
        ackOpen.title,
      );
      setAckOpen(null);
      setAckNoticeId(ackOpen.id);
      acknowledgements.reload();
    } catch (caught) {
      setAckError(
        caught instanceof Error ? caught.message : "记录反馈失败",
      );
    }
  }

  function openRepresentation() {
    setRepName("");
    setRepType("WORKS_COUNCIL");
    setRepJurisdiction("");
    setRepError(null);
    setRepOpen(true);
  }

  async function submitRepresentation() {
    setRepError(null);
    try {
      await api("/api/v1/employee-representations", {
        method: "POST",
        body: {
          bodyName: repName.trim(),
          bodyType: repType,
          jurisdiction: repJurisdiction.trim(),
        },
      });
      toast.success("员工代表已记录", repName);
      setRepOpen(false);
      representations.reload();
    } catch (caught) {
      setRepError(
        caught instanceof Error
          ? caught.message
          : "记录员工代表失败",
      );
    }
  }

  function openConsultation() {
    setConsultPolicyVersionId(selectedId ?? "");
    setConsultRepresentationId("");
    setConsultType("DISCUSSION");
    setConsultStartedAt(new Date().toISOString().slice(0, 16));
    setConsultMinutesRef("");
    setConsultFeedback("");
    setConsultError(null);
    setConsultOpen(true);
  }

  async function submitConsultation() {
    setConsultError(null);
    try {
      await api("/api/v1/policy-consultations", {
        method: "POST",
        body: {
          policyVersionId: consultPolicyVersionId,
          representationId: consultRepresentationId.trim() || undefined,
          consultationType: consultType,
          startedAt: new Date(consultStartedAt).toISOString(),
          minutesRef: consultMinutesRef.trim() || undefined,
          feedbackSummary: consultFeedback.trim() || undefined,
        },
      });
      toast.success("咨询已记录", titleCase(consultType));
      setConsultOpen(false);
      consultations.reload();
    } catch (caught) {
      setConsultError(
        caught instanceof Error ? caught.message : "记录咨询失败",
      );
    }
  }

  function openConclude(consultation: PolicyConsultationView) {
    setConcludeTarget(consultation);
    setConcludeOutcome("AGREED");
    setConcludeMinutesRef(consultation.minutesRef ?? "");
    setConcludeFeedback(consultation.feedbackSummary ?? "");
    setConcludeError(null);
  }

  async function submitConclude() {
    if (!concludeTarget) return;
    setConcludeError(null);
    try {
      await api(
        `/api/v1/policy-consultations/${concludeTarget.id}/conclude`,
        {
          method: "POST",
          body: {
            endedAt: new Date().toISOString(),
            outcome: concludeOutcome,
            minutesRef: concludeMinutesRef.trim() || undefined,
            feedbackSummary: concludeFeedback.trim() || undefined,
          },
        },
      );
      toast.success("咨询已结论", titleCase(concludeOutcome));
      setConcludeTarget(null);
      consultations.reload();
    } catch (caught) {
      setConcludeError(
        caught instanceof Error
          ? caught.message
          : "咨询结论失败",
      );
    }
  }

  async function openSimulation() {
    const currentId = selectedId ?? list[0]?.policyVersionId ?? "";
    setSimCurrentId(currentId);
    setSimProposed("{}");
    setSimSamples("[]");
    setSimResult(null);
    setSimError(null);
    setSimOpen(true);
    if (!currentId) return;
    try {
      const policy = await api<Record<string, unknown>>(
        `/api/v1/policy-versions/${currentId}`,
      );
      setSimProposed(JSON.stringify(policy, null, 2));
    } catch (caught) {
      setSimError(
        caught instanceof Error
          ? caught.message
          : "载入当前政策失败",
      );
    }
  }

  async function runSimulation() {
    setSimError(null);
    setSimRunning(true);
    try {
      const proposedPolicy = JSON.parse(simProposed) as Record<string, unknown>;
      const samples = JSON.parse(simSamples) as Array<{
        personId: string;
        input: Record<string, unknown>;
      }>;
      const result = await api<PolicySimulationResultView>(
        "/api/v1/policy-simulations",
        {
          method: "POST",
          body: {
            currentPolicyVersionId: simCurrentId,
            proposedPolicy,
            samples,
          },
        },
      );
      setSimResult(result);
    } catch (caught) {
      setSimError(
        caught instanceof Error ? caught.message : "Simulation failed",
      );
    } finally {
      setSimRunning(false);
    }
  }

  async function linkNotice() {
    setLinkError(null);
    try {
      await api("/api/v1/policy-notices", {
        method: "POST",
        body: {
          policyVersionId: linkPolicyVersionId,
          noticeId: linkNoticeId,
          audience: {},
        },
      });
      toast.success("通知已关联政策", shortId(linkNoticeId));
      setLinkOpen(false);
      policyNotices.reload();
    } catch (caught) {
      setLinkError(
        caught instanceof Error
          ? caught.message
          : "关联告知失败",
      );
    }
  }

  function openMarginal() {
    setMarginalOpen(true);
    setMarginalSample("{}");
    setMarginalIndex("0");
    setMarginalField("attributionWeight");
    setMarginalFrom("0.9");
    setMarginalTo("1.1");
    setMarginalStep("0.01");
    setMarginalResult(null);
    setMarginalError(null);
  }

  async function runMarginal() {
    if (!selectedId) {
      setMarginalError("Select a policy version first.");
      return;
    }
    setMarginalError(null);
    setMarginalRunning(true);
    try {
      const sample = JSON.parse(marginalSample) as Record<string, unknown>;
      const result = await api<MarginalSimulationView>(
        "/api/v1/policy-simulations:marginal",
        {
          method: "POST",
          body: {
            policyVersionId: selectedId,
            sample,
            participantIndex: Number(marginalIndex),
            field: marginalField,
            from: marginalFrom,
            to: marginalTo,
            step: marginalStep,
          },
        },
      );
      setMarginalResult(result);
    } catch (caught) {
      setMarginalError(
        caught instanceof Error ? caught.message : "Marginal sweep failed",
      );
    } finally {
      setMarginalRunning(false);
    }
  }

  async function finalizeAnnualReport() {
    if (!reviewReports.data) return;
    setReportBusy("annual");
    try {
      const now = new Date();
      await api("/api/v1/reports/policy-review:finalize", {
        method: "POST",
        body: {
          from: new Date(now.getTime() - 365 * 864e5).toISOString(),
          to: now.toISOString(),
          report: reviewReports.data,
          signedOffBy: session.personId,
        },
      });
      toast.success("年度审查快照已生成", "已记录哈希与签核人");
      reviewSnapshots.reload();
    } catch (caught) {
      toast.error(
        "生成失败",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setReportBusy(null);
    }
  }

  async function snapshotAgreement() {
    setReportBusy("agreement");
    try {
      await api("/api/v1/reports/reviewer-agreement:snapshot", {
        method: "POST",
      });
      toast.success("评审一致性快照已生成");
      reviewerAgreement.reload();
    } catch (caught) {
      toast.error(
        "生成失败",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setReportBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="规则与就绪度"
        title="政策"
        description="版本化政策定义，配套用例集、法律门禁、告知签收与 DPIA 证据；阻断项全部清除前，版本不能用于结算。"
        actions={
          <>
            <Button
              variant="secondary"
              icon="refresh"
              onClick={() => {
                versions.reload();
                readiness.reload();
                tests.reload();
              }}
              loading={versions.loading}
            >
              刷新
            </Button>
            <Button
              variant="primary"
              icon="play"
              onClick={runSuite}
              loading={running}
              disabled={!selectedId}
            >
              运行用例集
            </Button>
          </>
        }
      />

      {versions.error ? (
        <ErrorNotice error={versions.error} onRetry={versions.reload} />
      ) : versions.loading ? (
        <Panel title="政策版本">
          <LoadingRows rows={3} />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon="policy"
            title="暂无政策版本"
            description="发布或导入政策版本后，就绪度报告与测试用例方可使用。"
          />
        </Panel>
      ) : (
        <PolicyReadinessSection
          list={list}
          openGate={openGate}
          readiness={readiness}
          selected={selected}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
        />
      )}

      <Tabs
        items={[
          {
            id: "readiness",
            label: "测试用例",
            count: tests.data?.length ?? 0,
          },
          { id: "coverage", label: "运营覆盖" },
          { id: "annual", label: "年度审查" },
          { id: "reports", label: "审计报告" },
          { id: "governance", label: "治理" },
        ]}
        active={tab}
        onChange={setTab}
        label="政策视图"
      />

      <div className="tab-panel">
        {tab === "readiness" ? (
          <TestCasePanel
            retireTestCase={retireTestCase}
            runSuite={runSuite}
            runTestCase={runTestCase}
            running={running}
            selectedId={selectedId}
            setTestError={setTestError}
            setTestOpen={setTestOpen}
            testBusy={testBusy}
            tests={tests}
          />
        ) : tab === "coverage" ? (
          <CoveragePanel
            coverage={coverage}
            successMetrics={successMetrics}
          />
        ) : tab === "annual" ? (
          <AnnualReviewPanel
            review={review}
            subgroup={subgroup}
          />
        ) : tab === "governance" ? (
          <>
            <SimulationPanel
              openMarginal={openMarginal}
              openSimulation={openSimulation}
              simResult={simResult}
            />

            <PolicyNoticeLinkPanel
              notices={notices}
              policyNotices={policyNotices}
              selectedId={selectedId}
              setLinkError={setLinkError}
              setLinkNoticeId={setLinkNoticeId}
              setLinkOpen={setLinkOpen}
              setLinkPolicyVersionId={setLinkPolicyVersionId}
            />

            <RuleChangePanel
              openRuleChange={openRuleChange}
              ruleAction={ruleAction}
              ruleBusy={ruleBusy}
              ruleChanges={ruleChanges}
            />

            <EmployeeNoticePanel
              ackNoticeId={ackNoticeId}
              acknowledgements={acknowledgements}
              notices={notices}
              openAck={openAck}
              openNotice={openNotice}
              people={people}
              setAckNoticeId={setAckNoticeId}
            />

            <ConsultationPanel
              consultations={consultations}
              openConclude={openConclude}
              openConsultation={openConsultation}
            />

            <RepresentationPanel
              openRepresentation={openRepresentation}
              representations={representations}
            />
          </>
        ) : tab === "reports" ? (
          <ReportsPanel
            finalizeAnnualReport={finalizeAnnualReport}
            reportBusy={reportBusy}
            reviewReports={reviewReports}
            reviewSnapshots={reviewSnapshots}
            reviewerAgreement={reviewerAgreement}
            snapshotAgreement={snapshotAgreement}
          />
        ) : null}
      </div>

      <LegalGateModal
        democraticRef={democraticRef}
        dpiaRef={dpiaRef}
        gateApprovalId={gateApprovalId}
        gateError={gateError}
        gateOpen={gateOpen}
        gateSubmitting={gateSubmitting}
        minimumWageChecked={minimumWageChecked}
        noticeRef={noticeRef}
        policyApproved={policyApproved}
        recordGate={recordGate}
        recordedBy={recordedBy}
        selected={selected}
        setDemocraticRef={setDemocraticRef}
        setDpiaRef={setDpiaRef}
        setGateApprovalId={setGateApprovalId}
        setGateOpen={setGateOpen}
        setMinimumWageChecked={setMinimumWageChecked}
        setNoticeRef={setNoticeRef}
        setPolicyApproved={setPolicyApproved}
        setRecordedBy={setRecordedBy}
      />

      <RuleChangeModal
        list={list}
        ruleChangeType={ruleChangeType}
        ruleEffectiveFrom={ruleEffectiveFrom}
        ruleError={ruleError}
        ruleFromVersionId={ruleFromVersionId}
        ruleOpen={ruleOpen}
        rulePolicyCode={rulePolicyCode}
        ruleReason={ruleReason}
        ruleToVersionId={ruleToVersionId}
        setRuleChangeType={setRuleChangeType}
        setRuleEffectiveFrom={setRuleEffectiveFrom}
        setRuleFromVersionId={setRuleFromVersionId}
        setRuleOpen={setRuleOpen}
        setRulePolicyCode={setRulePolicyCode}
        setRuleReason={setRuleReason}
        setRuleToVersionId={setRuleToVersionId}
        submitRuleChange={submitRuleChange}
      />

      <EmployeeNoticeModal
        list={list}
        noticeAckRequired={noticeAckRequired}
        noticeBodyRef={noticeBodyRef}
        noticeEffectiveFrom={noticeEffectiveFrom}
        noticeError={noticeError}
        noticeOpen={noticeOpen}
        noticePolicyVersionId={noticePolicyVersionId}
        noticeTitle={noticeTitle}
        noticeType={noticeType}
        setNoticeAckRequired={setNoticeAckRequired}
        setNoticeBodyRef={setNoticeBodyRef}
        setNoticeEffectiveFrom={setNoticeEffectiveFrom}
        setNoticeOpen={setNoticeOpen}
        setNoticePolicyVersionId={setNoticePolicyVersionId}
        setNoticeTitle={setNoticeTitle}
        setNoticeType={setNoticeType}
        submitNotice={submitNotice}
      />

      <AcknowledgementModal
        ackDecision={ackDecision}
        ackDeclineReason={ackDeclineReason}
        ackError={ackError}
        ackOpen={ackOpen}
        ackPerson={ackPerson}
        ackSignatureRef={ackSignatureRef}
        setAckDecision={setAckDecision}
        setAckDeclineReason={setAckDeclineReason}
        setAckOpen={setAckOpen}
        setAckPerson={setAckPerson}
        setAckSignatureRef={setAckSignatureRef}
        submitAck={submitAck}
      />

      <RepresentationModal
        repError={repError}
        repJurisdiction={repJurisdiction}
        repName={repName}
        repOpen={repOpen}
        repType={repType}
        setRepJurisdiction={setRepJurisdiction}
        setRepName={setRepName}
        setRepOpen={setRepOpen}
        setRepType={setRepType}
        submitRepresentation={submitRepresentation}
      />

      <ConsultationModal
        consultError={consultError}
        consultFeedback={consultFeedback}
        consultMinutesRef={consultMinutesRef}
        consultOpen={consultOpen}
        consultPolicyVersionId={consultPolicyVersionId}
        consultRepresentationId={consultRepresentationId}
        consultStartedAt={consultStartedAt}
        consultType={consultType}
        list={list}
        setConsultFeedback={setConsultFeedback}
        setConsultMinutesRef={setConsultMinutesRef}
        setConsultOpen={setConsultOpen}
        setConsultPolicyVersionId={setConsultPolicyVersionId}
        setConsultRepresentationId={setConsultRepresentationId}
        setConsultStartedAt={setConsultStartedAt}
        setConsultType={setConsultType}
        submitConsultation={submitConsultation}
      />

      <ConsultationConcludeModal
        concludeError={concludeError}
        concludeFeedback={concludeFeedback}
        concludeMinutesRef={concludeMinutesRef}
        concludeOutcome={concludeOutcome}
        concludeTarget={concludeTarget}
        setConcludeFeedback={setConcludeFeedback}
        setConcludeMinutesRef={setConcludeMinutesRef}
        setConcludeOutcome={setConcludeOutcome}
        setConcludeTarget={setConcludeTarget}
        submitConclude={submitConclude}
      />

      <SimulationModal
        list={list}
        runSimulation={runSimulation}
        setSimCurrentId={setSimCurrentId}
        setSimOpen={setSimOpen}
        setSimProposed={setSimProposed}
        setSimSamples={setSimSamples}
        simCurrentId={simCurrentId}
        simError={simError}
        simOpen={simOpen}
        simProposed={simProposed}
        simRunning={simRunning}
        simSamples={simSamples}
      />

      <NoticeLinkModal
        linkError={linkError}
        linkNotice={linkNotice}
        linkNoticeId={linkNoticeId}
        linkOpen={linkOpen}
        linkPolicyVersionId={linkPolicyVersionId}
        list={list}
        notices={notices}
        setLinkNoticeId={setLinkNoticeId}
        setLinkOpen={setLinkOpen}
        setLinkPolicyVersionId={setLinkPolicyVersionId}
      />

      <MarginalSweepModal
        marginalError={marginalError}
        marginalField={marginalField}
        marginalFrom={marginalFrom}
        marginalIndex={marginalIndex}
        marginalOpen={marginalOpen}
        marginalResult={marginalResult}
        marginalRunning={marginalRunning}
        marginalSample={marginalSample}
        marginalStep={marginalStep}
        marginalTo={marginalTo}
        runMarginal={runMarginal}
        setMarginalField={setMarginalField}
        setMarginalFrom={setMarginalFrom}
        setMarginalIndex={setMarginalIndex}
        setMarginalOpen={setMarginalOpen}
        setMarginalSample={setMarginalSample}
        setMarginalStep={setMarginalStep}
        setMarginalTo={setMarginalTo}
      />

      <TestCaseModal
        createTestCase={createTestCase}
        setTestCategory={setTestCategory}
        setTestCode={setTestCode}
        setTestExpected={setTestExpected}
        setTestInput={setTestInput}
        setTestOpen={setTestOpen}
        testCategory={testCategory}
        testCode={testCode}
        testError={testError}
        testExpected={testExpected}
        testInput={testInput}
        testOpen={testOpen}
      />
    </>
  );
}
