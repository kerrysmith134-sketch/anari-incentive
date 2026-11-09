import { useEffect, useState, type FormEvent } from "react";
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
  Tabs,
  TextInput,
  Select,
  Textarea,
} from "../components/ui.js";
import { Icon } from "../components/Icon.js";
import { useToast } from "../contexts/ToastContext.js";
import { PersonSelect, usePeople } from "../components/PersonSelect.js";
import { api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { useAuth } from "../contexts/AuthContext.js";
import {
  displayName,
  formatDate,
  formatDateTime,
  formatPercent,
  shortId,
  titleCase,
} from "../lib/format.js";
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
  const reviewSnapshots = useApiQuery<
    Array<{ id: string; status?: string; period?: string; createdAt: string }>
  >("/api/v1/reports/policy-review/snapshots");
  const reviewerAgreement = useApiQuery<{
    pairCount: number;
    exactAgreementRate: number | null;
    withinOneRate: number | null;
    cohenKappa: number | null;
    insufficient: boolean;
    pairs: Array<{
      personId: string;
      cycleId: string;
      reviewerA: string;
      reviewerB: string;
      exactAgreementRate: number;
      withinOneRate: number;
    }>;
  }>("/api/v1/reports/reviewer-agreement");
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
      toast.success("Legal gate recorded", selected?.code);
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
      toast.success("Rule change order created", rulePolicyCode);
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
      toast.success("Notice published", noticeTitle);
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
      toast.success("Notice linked to policy", shortId(linkNoticeId));
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
        <div className="split-grid">
          <Panel
            title="政策版本"
            subtitle={`${list.length} published or seeded version${list.length === 1 ? "" : "s"}`}
            flush
          >
            <div className="table-wrap">
              <table className="data-table table-clickable">
                <thead>
                  <tr>
                    <th>政策</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((version) => (
                    <tr
                      key={version.policyVersionId}
                      className={
                        version.policyVersionId === selectedId ? "is-selected" : ""
                      }
                      onClick={() => setSelectedId(version.policyVersionId)}
                    >
                      <td>
                        <span className="cell-primary" style={{ overflowWrap: "anywhere" }}>
                          {version.code}
                        </span>
                        <span className="cell-sub">
                          v{version.version}
                          {version.effectiveFrom
                            ? ` · effective ${formatDate(version.effectiveFrom)}`
                            : ""}
                        </span>
                        <span className="cell-sub mono">
                          {shortId(version.policyVersionId, 10)}
                        </span>
                      </td>
                      <td>
                        <Badge status={version.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="政策就绪度"
            subtitle={
              selected
                ? `${selected.code} v${selected.version} · ${formatDateTime(readiness.data?.generatedAt)}`
                : undefined
            }
            action={
              <div className="row-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={openGate}
                  disabled={!selectedId}
                >
                  记录门禁
                </Button>
                {readiness.data ? (
                  <Badge
                    tone={readiness.data.ready ? "success" : "danger"}
                  >
                    {readiness.data.ready ? "Ready" : "已阻断"}
                  </Badge>
                ) : null}
              </div>
            }
          >
            {readiness.error ? (
              <ErrorNotice error={readiness.error} onRetry={readiness.reload} />
            ) : readiness.loading || !readiness.data ? (
              <LoadingRows rows={4} />
            ) : (
              <>
                {selected?.applicability ? (
                  <div className="chip-row" style={{ marginBottom: 14 }}>
                    <span className="chip">
                      {selected.applicability.legalEntity}
                    </span>
                    <span className="chip">
                      {selected.applicability.jurisdictions.join(", ")}
                    </span>
                    <span className="chip">
                      {selected.applicability.workLocations.join(", ")}
                    </span>
                    <span className="chip">
                      {selected.applicability.employeeCategories.join(", ")}
                    </span>
                    <span className="chip">
                      {selected.applicability.workTimeTypes.join(", ")}
                    </span>
                  </div>
                ) : (
                  <InfoNotice tone="warning">
                    This policy has no recorded applicability. New publications
                    require legal entity, jurisdictions, work locations, employee
                    categories and work-time types.
                  </InfoNotice>
                )}
                <div className="coverage-grid">
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">法律门禁</div>
                    <div className="coverage-cell__value" style={{ fontSize: 15 }}>
                      {readiness.data.legalGate.approved ? (
                        <Badge tone="success">已批准</Badge>
                      ) : readiness.data.legalGate.recorded ? (
                        <Badge tone="warning">已记录</Badge>
                      ) : (
                        <Badge tone="danger">缺失</Badge>
                      )}
                    </div>
                    <div className="coverage-cell__sub">
                      {readiness.data.legalGate.blockers.length} blocker
                      {readiness.data.legalGate.blockers.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">用例通过</div>
                    <div className="coverage-cell__value">
                      {readiness.data.tests.passed}/{readiness.data.tests.active}
                    </div>
                    <div className="coverage-cell__sub">
                      {readiness.data.tests.failed} failed ·{" "}
                      {readiness.data.tests.notRun} not run
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Notice complete</div>
                    <div className="coverage-cell__value">
                      {readiness.data.notices.complete}/{readiness.data.notices.linked}
                    </div>
                    <div className="coverage-cell__sub">
                      {readiness.data.notices.acknowledgementRequired} require ack
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">DPIA</div>
                    <div className="coverage-cell__value" style={{ fontSize: 15 }}>
                      {readiness.data.dpia.approved ? (
                        <Badge tone="success">已批准</Badge>
                      ) : readiness.data.dpia.referenced ? (
                        <Badge tone="warning">
                          {titleCase(readiness.data.dpia.status ?? "referenced")}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">未引用</Badge>
                      )}
                    </div>
                    <div className="coverage-cell__sub">
                      {readiness.data.consultations.concluded} consultation
                      {readiness.data.consultations.concluded === 1 ? "" : "s"} concluded
                    </div>
                  </div>
                </div>

                {readiness.data.blockers.length > 0 ? (
                  <div className="notice notice--danger section-gap">
                    <Icon name="alert-circle" size={18} />
                    <div>
                      <strong>{readiness.data.blockers.length} readiness blocker(s)</strong>
                      <div className="chip-row" style={{ marginTop: 6 }}>
                        {readiness.data.blockers.map((blocker) => (
                          <span className="chip" key={blocker}>
                            {blocker}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="notice notice--success section-gap">
                    <Icon name="check-circle" size={18} />
                    <div>
                      <strong>无就绪度阻断</strong>
                      <p>本版本可用于正式计算。</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </Panel>
        </div>
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
          <Panel
            title="回归用例集"
            subtitle="所选版本的边界/异常/历史用例"
            action={
              <div className="row-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  icon="plus"
                  onClick={() => {
                    setTestError(null);
                    setTestOpen(true);
                  }}
                  disabled={!selectedId}
                >
                  新建用例
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="play"
                  onClick={runSuite}
                  loading={running}
                  disabled={!selectedId}
                >
                  运行用例集
                </Button>
              </div>
            }
            flush
          >
            {tests.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={tests.error} onRetry={tests.reload} />
              </div>
            ) : tests.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={4} />
              </div>
            ) : (tests.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon="policy"
                title="暂无用例"
                description="没有回归用例的政策无法自证行为；请为本版本补充测试用例。"
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>案件</th>
                      <th>类别</th>
                      <th>状态</th>
                      <th>结果</th>
                      <th>最近运行</th>
                      <th>哈希</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tests.data?.map((testCase) => (
                      <tr key={testCase.id}>
                        <td>
                          <span className="cell-primary">{testCase.caseCode}</span>
                          <span className="cell-sub mono">
                            {shortId(testCase.id, 10)}
                          </span>
                        </td>
                        <td>{titleCase(testCase.category)}</td>
                        <td>
                          <Badge status={testCase.status} />
                        </td>
                        <td>
                          {testCase.lastRunPassed === undefined ? (
                            <Badge tone="neutral">未运行</Badge>
                          ) : testCase.lastRunPassed ? (
                            <Badge tone="success">通过</Badge>
                          ) : (
                            <Badge tone="danger">失败</Badge>
                          )}
                        </td>
                        <td className="nowrap">
                          {testCase.lastRunAt
                            ? formatDateTime(testCase.lastRunAt)
                            : "—"}
                        </td>
                        <td>
                          <span className="chip mono">
                            {testCase.lastRunResultHash
                              ? shortId(testCase.lastRunResultHash, 10)
                              : "—"}
                          </span>
                        </td>
                        <td className="cell-actions">
                          <div className="row-actions">
                            {testCase.status !== "RETIRED" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  loading={testBusy === testCase.id}
                                  onClick={() => void runTestCase(testCase)}
                                >
                                  运行
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  loading={testBusy === testCase.id}
                                  onClick={() => void retireTestCase(testCase)}
                                >
                                  停用
                                </Button>
                              </>
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
        ) : tab === "coverage" ? (
          <Panel
            title="运营覆盖"
            subtitle="跨模块证据与数据质量态势"
          >
            {coverage.error ? (
              <ErrorNotice error={coverage.error} onRetry={coverage.reload} />
            ) : coverage.loading || !coverage.data ? (
              <LoadingRows rows={4} />
            ) : (
              <>
                <div className="coverage-grid">
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">证据覆盖率</div>
                    <div className="coverage-cell__value">
                      {formatPercent(coverage.data.workPackages.evidenceCoverageRate)}
                    </div>
                    <div className="coverage-cell__sub">
                      {coverage.data.workPackages.withEvidence} of{" "}
                      {coverage.data.workPackages.accepted} accepted
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">申报</div>
                    <div className="coverage-cell__value">
                      {coverage.data.claims.total}
                    </div>
                    <div className="coverage-cell__sub">
                      {coverage.data.claims.confirmed} confirmed ·{" "}
                      {coverage.data.claims.rejected} rejected
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">交付物</div>
                    <div className="coverage-cell__value">
                      {coverage.data.deliverables.total}
                    </div>
                    <div className="coverage-cell__sub">
                      {coverage.data.deliverables.pendingAcceptance} pending
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">数据质量</div>
                    <div className="coverage-cell__value">
                      {coverage.data.dataQuality.open}
                    </div>
                    <div className="coverage-cell__sub">
                      {coverage.data.dataQuality.overdue} overdue ·{" "}
                      {coverage.data.dataQuality.escalated} escalated
                    </div>
                  </div>
                </div>
                <div className="detail-section">
                  <div className="detail-section__title">申诉与争议</div>
                  <div className="coverage-grid">
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">未结申诉</div>
                      <div className="coverage-cell__value">
                        {coverage.data.appeals?.open ?? 0}
                      </div>
                      <div className="coverage-cell__sub">
                        {coverage.data.appeals?.overdue ?? 0} past SLA
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">申诉率</div>
                      <div className="coverage-cell__value">
                        {formatPercent(coverage.data.appeals?.appealRate ?? 0, 1)}
                      </div>
                      <div className="coverage-cell__sub">
                        of {coverage.data.claims.total} claims
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">已结申诉</div>
                      <div className="coverage-cell__value">
                        {coverage.data.appeals?.closed ?? 0}
                      </div>
                      <div className="coverage-cell__sub">已裁决并关闭</div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">SLA 状态</div>
                      <div className="coverage-cell__value" style={{ fontSize: 15 }}>
                        {(coverage.data.appeals?.overdue ?? 0) > 0 ? (
                          <Badge tone="danger">已违反</Badge>
                        ) : (
                          <Badge tone="success">SLA 内</Badge>
                        )}
                      </div>
                      <div className="coverage-cell__sub">
                        申诉创建时配置
                      </div>
                    </div>
                  </div>
                </div>
                <div className="detail-section">
                  <div className="detail-section__title">周期耗时</div>
                  <div className="coverage-grid">
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">
                        工作包验收
                      </div>
                      <div className="coverage-cell__value">
                        {(
                          coverage.data.cycleTimes
                            ?.workPackageAcceptanceHours ?? 0
                        ).toFixed(1)}
                        h
                      </div>
                      <div className="coverage-cell__sub">
                        created → accepted
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">
                        申报决策
                      </div>
                      <div className="coverage-cell__value">
                        {(
                          coverage.data.cycleTimes?.claimDecisionHours ?? 0
                        ).toFixed(1)}
                        h
                      </div>
                      <div className="coverage-cell__sub">
                        submitted → decision
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">
                        员工确认
                      </div>
                      <div className="coverage-cell__value">
                        {(
                          coverage.data.cycleTimes?.confirmationHours ?? 0
                        ).toFixed(1)}
                        h
                      </div>
                      <div className="coverage-cell__sub">
                        calculated → confirmed / objected
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">
                        薪酬审批
                      </div>
                      <div className="coverage-cell__value">
                        {(
                          coverage.data.cycleTimes?.payrollApprovalHours ?? 0
                        ).toFixed(1)}
                        h
                      </div>
                      <div className="coverage-cell__sub">
                        created → approved
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">
                        申诉裁决
                      </div>
                      <div className="coverage-cell__value">
                        {(
                          coverage.data.cycleTimes?.appealResolutionHours ?? 0
                        ).toFixed(1)}
                        h
                      </div>
                      <div className="coverage-cell__sub">
                        submitted → resolved
                      </div>
                    </div>
                  </div>
                  {coverage.data.cycleTimes?.byResponsibility?.length ? (
                    <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                      {coverage.data.cycleTimes.byResponsibility.map((row) => (
                        <div
                          key={row.responsibilityCode}
                          className="inline"
                          style={{
                            justifyContent: "space-between",
                            width: "100%",
                          }}
                        >
                          <span>{titleCase(row.responsibilityCode)}</span>
                          <span className="muted">
                            {[
                              `acceptance ${row.workPackageAcceptanceHours.toFixed(1)}h (${row.workPackageSamples})`,
                              `decision ${row.claimDecisionHours.toFixed(1)}h (${row.claimSamples})`,
                              `confirm ${row.confirmationHours.toFixed(1)}h (${row.confirmationSamples})`,
                              `payroll ${row.payrollApprovalHours.toFixed(1)}h (${row.payrollSamples})`,
                              `appeal ${row.appealResolutionHours.toFixed(1)}h (${row.appealSamples})`,
                            ].join(" · ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                {successMetrics.data ? (
                  <div className="detail-section">
                    <div className="detail-section__title">
                      PRD success metrics · {successMetrics.data.overall}
                    </div>
                    <div className="stack" style={{ gap: 6 }}>
                      {successMetrics.data.metrics.map((metric) => (
                        <div
                          key={metric.id}
                          className="inline"
                          style={{
                            justifyContent: "space-between",
                            width: "100%",
                          }}
                        >
                          <span>{metric.label}</span>
                          <span className="muted">
                            {metric.value === null
                              ? "unavailable"
                              : metric.unit === "RATIO"
                                ? formatPercent(metric.value)
                                : metric.value}
                            {metric.unit === "HOURS"
                              ? "h"
                              : metric.unit === "MINUTES"
                                ? "m"
                                : ""}{" "}
                            · target {metric.comparator}{" "}
                            {metric.unit === "RATIO"
                              ? formatPercent(metric.target)
                              : metric.target}{" "}
                            · {metric.status}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="subtle" style={{ fontSize: 11.5 }}>
                      Employee evidence supplement time is unavailable because
                      the product does not time sessions.
                    </p>
                  </div>
                ) : null}
                <div className="split-grid section-gap">
                  <div className="detail-section" style={{ marginTop: 0 }}>
                    <div className="detail-section__title">
                      按职责覆盖率
                    </div>
                    {coverage.data.workPackages.coverageByResponsibility.length === 0 ? (
                      <p className="muted">暂无带角色的已验收工作包。</p>
                    ) : (
                      <div className="stack" style={{ gap: 6 }}>
                        {coverage.data.workPackages.coverageByResponsibility.map(
                          (row) => (
                            <div
                              key={row.responsibilityCode}
                              className="inline"
                              style={{ justifyContent: "space-between", width: "100%" }}
                            >
                              <span>{titleCase(row.responsibilityCode)}</span>
                              <span className="muted">
                                {formatPercent(row.coverageRate)} ·{" "}
                                {row.withEvidence}/{row.total}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                  <div className="detail-section" style={{ marginTop: 0 }}>
                    <div className="detail-section__title">
                      按订单类型覆盖率
                    </div>
                    {coverage.data.workPackages.coverageByOrderType.length === 0 ? (
                      <p className="muted">暂无关联计算的工作包。</p>
                    ) : (
                      <div className="stack" style={{ gap: 6 }}>
                        {coverage.data.workPackages.coverageByOrderType.map((row) => (
                          <div
                            key={row.orderType}
                            className="inline"
                            style={{ justifyContent: "space-between", width: "100%" }}
                          >
                            <span>{titleCase(row.orderType)}</span>
                            <span className="muted">
                              {formatPercent(row.coverageRate)} ·{" "}
                              {row.withEvidence}/{row.total}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="detail-section" style={{ marginTop: 0 }}>
                    <div className="detail-section__title">
                      按任务类型覆盖率
                    </div>
                    {coverage.data.workPackages.coverageByPackageType.length === 0 ? (
                      <p className="muted">暂无已验收的工作包。</p>
                    ) : (
                      <div className="stack" style={{ gap: 6 }}>
                        {coverage.data.workPackages.coverageByPackageType.map((row) => (
                          <div
                            key={row.packageType}
                            className="inline"
                            style={{ justifyContent: "space-between", width: "100%" }}
                          >
                            <span>{titleCase(row.packageType)}</span>
                            <span className="muted">
                              {formatPercent(row.coverageRate)} ·{" "}
                              {row.withEvidence}/{row.total}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="detail-section">
                  <div className="detail-section__title">
                    按月覆盖趋势
                  </div>
                  {coverage.data.workPackages.coverageTrend.length === 0 ? (
                    <p className="muted">暂无已验收的工作包。</p>
                  ) : (
                    <div className="stack" style={{ gap: 6 }}>
                      {coverage.data.workPackages.coverageTrend
                        .slice(-6)
                        .map((row) => (
                          <div
                            key={row.period}
                            className="inline"
                            style={{
                              justifyContent: "space-between",
                              width: "100%",
                            }}
                          >
                            <span>{row.period}</span>
                            <span className="muted">
                              {formatPercent(row.coverageRate)} ·{" "}
                              {row.withEvidence}/{row.total}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                  {coverage.data.workPackages.coverageTrendByPackageType.length ? (
                    <div className="stack" style={{ gap: 4, marginTop: 10 }}>
                      {coverage.data.workPackages.coverageTrendByPackageType.map(
                        (series) => (
                          <div
                            key={series.packageType}
                            className="inline"
                            style={{
                              justifyContent: "space-between",
                              width: "100%",
                            }}
                          >
                            <span>{titleCase(series.packageType)}</span>
                            <span className="muted">
                              {series.periods
                                .slice(-6)
                                .map(
                                  (period) =>
                                    `${period.period} ${formatPercent(
                                      period.coverageRate,
                                    )}`,
                                )
                                .join(" · ")}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
                <InfoNotice>
                  Generated {formatDateTime(coverage.data.generatedAt)}. Coverage is
                  recomputed from live tenant records on refresh.
                </InfoNotice>
              </>
            )}
          </Panel>
        ) : tab === "annual" ? (
          <Panel
            title="年度政策审查"
            subtitle="政策/申诉/AI 复核/隐私证据的滚动 12 个月视图"
          >
            {review.error ? (
              <ErrorNotice error={review.error} onRetry={review.reload} />
            ) : review.loading || !review.data ? (
              <LoadingRows rows={4} />
            ) : (
              <>
                <div className="coverage-grid">
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">已发布政策</div>
                    <div className="coverage-cell__value">
                      {review.data.policies.published}
                    </div>
                    <div className="coverage-cell__sub">
                      {review.data.policies.versionsInScope} versions in scope
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Notice acknowledgement</div>
                    <div className="coverage-cell__value">
                      {review.data.notices.complete}/{review.data.notices.total}
                    </div>
                    <div className="coverage-cell__sub">
                      {review.data.notices.incomplete} incomplete
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">未结申诉</div>
                    <div className="coverage-cell__value">
                      {review.data.appeals.open}
                    </div>
                    <div className="coverage-cell__sub">
                      {review.data.appeals.overdue} past SLA ·{" "}
                      {review.data.appeals.closed} closed
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">AI 采纳率</div>
                    <div className="coverage-cell__value">
                      {formatPercent(review.data.aiReview.acceptanceRate, 1)}
                    </div>
                    <div className="coverage-cell__sub">
                      {review.data.aiReview.accepted} of{" "}
                      {review.data.aiReview.decided} decided
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">人工改判</div>
                    <div className="coverage-cell__value">
                      {review.data.aiReview.overrides}
                    </div>
                    <div className="coverage-cell__sub">
                      {review.data.aiReview.blindReviews} independent-first reviews
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">数据质量</div>
                    <div className="coverage-cell__value">
                      {review.data.dataQuality.open}
                    </div>
                    <div className="coverage-cell__sub">
                      {review.data.dataQuality.overdue} overdue ·{" "}
                      {review.data.dataQuality.escalated} escalated
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">评价决策</div>
                    <div className="coverage-cell__value">
                      {review.data.evaluations.decisions}
                    </div>
                    <div className="coverage-cell__sub">
                      {review.data.evaluations.drafts} AI drafts
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">隐私</div>
                    <div className="coverage-cell__value">
                      {review.data.privacy.approvedDpias}/
                      {review.data.privacy.dpias}
                    </div>
                    <div className="coverage-cell__sub">
                      {review.data.privacy.openDsars} open data requests
                    </div>
                  </div>
                </div>
                <div className="split-grid section-gap">
                  <div className="detail-section" style={{ marginTop: 0 }}>
                    <div className="detail-section__title">申诉结果</div>
                    {Object.keys(review.data.appeals.outcomes).length === 0 ? (
                      <p className="muted">区间内无已结申诉。</p>
                    ) : (
                      <div className="stack" style={{ gap: 6 }}>
                        {Object.entries(review.data.appeals.outcomes).map(
                          ([outcome, count]) => (
                            <div
                              key={outcome}
                              className="inline"
                              style={{ justifyContent: "space-between", width: "100%" }}
                            >
                              <span>{titleCase(outcome)}</span>
                              <span className="muted">{count}</span>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                  <div className="detail-section" style={{ marginTop: 0 }}>
                    <div className="detail-section__title">评测证据</div>
                    <div className="stack" style={{ gap: 6 }}>
                      <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                        <span>评测台运行</span>
                        <span className="muted">
                          {review.data.aiReview.harnessEvaluations}
                        </span>
                      </div>
                      <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                        <span>已决 AI 提案</span>
                        <span className="muted">
                          {review.data.aiReview.decided}/{review.data.aiReview.total}
                        </span>
                      </div>
                      <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                        <span>高风险提案</span>
                        <span className="muted">
                          {review.data.aiReview.highRiskProposals}
                        </span>
                      </div>
                      <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                        <span>第二复核 SLA</span>
                        <span className="muted">
                          {review.data.aiReview.secondReviewOverdue} overdue ·{" "}
                          {review.data.aiReview.secondReviewSlaBreaches} breached
                        </span>
                      </div>
                      <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                        <span>已认定申报数</span>
                        <span className="muted">
                          {review.data.claims.decided}/{review.data.claims.total}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                {review.data.trustSurvey.available ? (
                  <div className="detail-section">
                    <div className="detail-section__title">
                      Trust and procedural fairness ·{" "}
                      {review.data.trustSurvey.period} ·{" "}
                      {review.data.trustSurvey.responseCount} responses
                    </div>
                    <div className="stack" style={{ gap: 6 }}>
                      {Object.entries(
                        review.data.trustSurvey.dimensions,
                      ).map(([dimension, score]) => {
                        const baseline =
                          review.data?.trustSurvey.available
                            ? review.data.trustSurvey.baseline?.dimensions[
                                dimension
                              ]
                            : undefined;
                        return (
                          <div
                            key={dimension}
                            className="inline"
                            style={{
                              justifyContent: "space-between",
                              width: "100%",
                            }}
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
                      })}
                    </div>
                  </div>
                ) : (
                  <InfoNotice tone="warning">
                    {review.data.trustSurvey.note}
                  </InfoNotice>
                )}
                <div className="detail-section">
                  <div className="detail-section__title">
                    Reviewer consistency ·{" "}
                    {review.data.reviewConsistency.claimsDecided} claims decided
                  </div>
                  {review.data.reviewConsistency.reviewers.length === 0 ? (
                    <p className="muted">区间内无认定决策。</p>
                  ) : (
                    <div className="stack" style={{ gap: 6 }}>
                      {review.data.reviewConsistency.reviewers.map(
                        (reviewer) => (
                          <div
                            key={reviewer.reviewerPersonId}
                            className="inline"
                            style={{
                              justifyContent: "space-between",
                              width: "100%",
                            }}
                          >
                            <span className="mono">
                              {shortId(reviewer.reviewerPersonId, 10)}
                            </span>
                            <span className="muted">
                              {reviewer.decisions} decisions ·{" "}
                              {formatPercent(reviewer.confirmedRate)} confirmed ·{" "}
                              {formatPercent(reviewer.rejectedRate)} rejected ·{" "}
                              {reviewer.averageDaysToDecision.toFixed(1)}d avg
                            </span>
                          </div>
                        ),
                      )}
                      <div
                        className="inline"
                        style={{
                          justifyContent: "space-between",
                          width: "100%",
                        }}
                      >
                        <span>重复决策</span>
                        <span className="muted">
                          {review.data.reviewConsistency.claimsWithMultipleDecisions}{" "}
                          · {review.data.reviewConsistency.claimsWithChangedOutcome}{" "}
                          changed outcome
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="detail-section">
                  <div className="detail-section__title">
                    Subgroup fairness · aggregate-only
                  </div>
                  {!subgroup.data?.available ? (
                    <InfoNotice tone="warning">
                      {subgroup.data?.note ??
                        "No consent-backed subgroup labels are available."}
                    </InfoNotice>
                  ) : (
                    <div className="stack">
                      <p className="muted">
                        Groups below {subgroup.data.thresholds.minimumReportableGroupSize} are
                        suppressed; groups below{" "}
                        {subgroup.data.thresholds.minimumQuantitativeGroupSize} are
                        qualitative only. Protected labels are never used for an
                        individual decision.
                      </p>
                      {Object.entries(subgroup.data.dimensions).map(
                        ([dimension, summary]) => (
                          <div key={dimension} className="detail-section">
                            <div className="detail-section__title">
                              {titleCase(dimension)} · {summary.reportedGroups} groups
                              {summary.suppressedGroups > 0
                                ? ` · ${summary.suppressedGroups} suppressed`
                                : ""}
                            </div>
                            <div className="stack" style={{ gap: 6 }}>
                              {summary.groups.map((group) => (
                                <div
                                  key={group.value}
                                  className="inline"
                                  style={{
                                    justifyContent: "space-between",
                                    width: "100%",
                                  }}
                                >
                                  <span>{group.value}</span>
                                  <span className="muted">
                                    n={group.headcount}
                                    {!summary.outcomesAvailable
                                      ? " · outcomes unavailable"
                                      : group.quantitative && group.metrics
                                        ? ` · mean ${group.metrics.meanIncentiveAmount.toFixed(2)} · selection ${formatPercent(group.metrics.positivePayoutRate)} · ratio ${group.metrics.adverseImpactRatio?.toFixed(2) ?? "—"}`
                                        : " · qualitative review only"}
                                    {group.flags.includes(
                                      "ADVERSE_IMPACT_BELOW_FOUR_FIFTHS",
                                    )
                                      ? " · below four-fifths"
                                      : ""}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
                <p className="subtle" style={{ fontSize: 11.5 }}>
                  Window {formatDate(review.data.from)} – {formatDate(review.data.to)}.
                  Generated {formatDateTime(review.data.generatedAt)}.
                </p>
              </>
            )}
          </Panel>
        ) : tab === "governance" ? (
          <>
            <Panel
              title="政策模拟"
              subtitle="以代表性输入重放当前与拟议政策；仅作决策支持"
              action={
                <div className="row-actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="play"
                    onClick={openMarginal}
                  >
                    边际扫描
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon="play"
                    onClick={openSimulation}
                  >
                    运行模拟
                  </Button>
                </div>
              }
            >
              {simResult ? (
                <>
                  <div className="coverage-grid">
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">当前总额</div>
                      <div className="coverage-cell__value">
                        {simResult.currentTotal}
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">拟调整总额</div>
                      <div className="coverage-cell__value">
                        {simResult.proposedTotal}
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">差额</div>
                      <div className="coverage-cell__value">
                        {simResult.deltaTotal}
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">影响人数</div>
                      <div className="coverage-cell__value">
                        {simResult.affectedPeople}
                      </div>
                    </div>
                  </div>
                  {simResult.blockers.length > 0 ? (
                    <div className="chip-row section-gap">
                      {simResult.blockers.map((blocker) => (
                        <span className="chip" key={blocker}>
                          {blocker}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="table-wrap section-gap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>人员</th>
                          <th>当前</th>
                          <th>拟调整</th>
                          <th>差额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {simResult.lines.map((line) => (
                          <tr key={line.personId}>
                            <td className="mono">
                              {shortId(line.personId, 10)}
                            </td>
                            <td>{line.currentAmount}</td>
                            <td>{line.proposedAmount}</td>
                            <td>{line.delta}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="muted">
                  Paste representative calculation inputs to compare the current
                  policy with a proposed definition. No ledger or policy is
                  written.
                </p>
              )}
            </Panel>

            <Panel
              title="政策-告知关联"
              subtitle="将告知绑定到政策版本以纳入就绪度覆盖"
              flush
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  icon="plus"
                  onClick={() => {
                    setLinkPolicyVersionId(selectedId ?? "");
                    setLinkNoticeId((notices.data ?? [])[0]?.id ?? "");
                    setLinkError(null);
                    setLinkOpen(true);
                  }}
                >
                  关联告知
                </Button>
              }
            >
              {policyNotices.error ? (
                <div style={{ padding: 16 }}>
                  <ErrorNotice
                    error={policyNotices.error}
                    onRetry={policyNotices.reload}
                  />
                </div>
              ) : policyNotices.loading ? (
                <div style={{ padding: 16 }}>
                  <LoadingRows rows={2} />
                </div>
              ) : (policyNotices.data?.length ?? 0) === 0 ? (
                <EmptyState
                  icon="policy"
                  title="暂无关联告知"
                  description="政策就绪度会校验关联通知的签收覆盖。"
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>政策版本</th>
                        <th>通知</th>
                        <th>已关联</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(policyNotices.data ?? []).map((link) => (
                        <tr key={link.id}>
                          <td className="mono">
                            {shortId(link.policyVersionId, 10)}
                          </td>
                          <td>
                            {notices.data?.find(
                              (notice) => notice.id === link.noticeId,
                            )?.title ?? shortId(link.noticeId, 10)}
                          </td>
                          <td className="nowrap">
                            {formatDateTime(link.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel
              title="规则变更单"
              subtitle="草稿 → 批准/驳回 → 公示，带用例门禁"
              flush
              action={
                <Button
                  size="sm"
                  variant="primary"
                  icon="plus"
                  onClick={openRuleChange}
                >
                  新建变更单
                </Button>
              }
            >
              {ruleChanges.error ? (
                <div style={{ padding: 16 }}>
                  <ErrorNotice
                    error={ruleChanges.error}
                    onRetry={ruleChanges.reload}
                  />
                </div>
              ) : ruleChanges.loading ? (
                <div style={{ padding: 16 }}>
                  <LoadingRows rows={3} />
                </div>
              ) : (ruleChanges.data?.length ?? 0) === 0 ? (
                <EmptyState
                  icon="policy"
                  title="暂无规则变更单"
                  description="规则变更在发布前记录变更前后版本、原因与影响模拟。"
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>变更单</th>
                        <th>变更</th>
                        <th>状态</th>
                        <th>生效</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(ruleChanges.data ?? []).map((order) => (
                        <tr key={order.id}>
                          <td>
                            <span className="cell-primary">
                              {order.policyCode}
                            </span>
                            <span className="cell-sub mono">
                              {shortId(order.id, 10)}
                            </span>
                          </td>
                          <td>
                            {order.changeType}
                            <span className="cell-sub">
                              {shortId(order.toPolicyVersionId, 10)}
                            </span>
                          </td>
                          <td>
                            <Badge status={order.status} />
                          </td>
                          <td className="nowrap">
                            {formatDate(order.effectiveFrom)}
                          </td>
                          <td className="cell-actions">
                            {order.status === "DRAFT" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  loading={ruleBusy === `approve:${order.id}`}
                                  onClick={() =>
                                    ruleAction(order, "approve")
                                  }
                                >
                                  批准
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  loading={ruleBusy === `reject:${order.id}`}
                                  onClick={() => ruleAction(order, "reject")}
                                >
                                  驳回
                                </Button>
                              </>
                            ) : null}
                            {order.status === "APPROVED" ? (
                              <Button
                                size="sm"
                                variant="primary"
                                loading={ruleBusy === `publicize:${order.id}`}
                                onClick={() =>
                                  ruleAction(order, "publicize")
                                }
                              >
                                公示
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
              title="员工告知"
              subtitle="已发布告知与逐人签收覆盖"
              flush
              action={
                <Button
                  size="sm"
                  variant="primary"
                  icon="plus"
                  onClick={openNotice}
                >
                  发布告知
                </Button>
              }
            >
              {notices.error ? (
                <div style={{ padding: 16 }}>
                  <ErrorNotice error={notices.error} onRetry={notices.reload} />
                </div>
              ) : notices.loading ? (
                <div style={{ padding: 16 }}>
                  <LoadingRows rows={3} />
                </div>
              ) : (notices.data?.length ?? 0) === 0 ? (
                <EmptyState
                  icon="policy"
                  title="暂无员工告知"
                  description="告知记录了向员工告知的内容、生效时间与签收人。"
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>通知</th>
                        <th>类型</th>
                        <th>生效</th>
                        <th>签收</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(notices.data ?? []).map((notice) => (
                        <tr key={notice.id}>
                          <td>
                            <span className="cell-primary">{notice.title}</span>
                            <span className="cell-sub mono">
                              {shortId(notice.id, 10)} · {notice.bodyRef}
                            </span>
                          </td>
                          <td>{titleCase(notice.noticeType)}</td>
                          <td className="nowrap">
                            {formatDate(notice.effectiveFrom)}
                          </td>
                          <td>
                            {notice.acknowledgementRequired
                              ? "必填"
                              : "Not required"}
                          </td>
                          <td className="cell-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => openAck(notice)}
                            >
                              记录
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setAckNoticeId(
                                  ackNoticeId === notice.id ? null : notice.id,
                                )
                              }
                            >
                              {ackNoticeId === notice.id ? "隐藏" : "Acks"}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            {ackNoticeId ? (
              <Panel title="告知签收" flush>
                {acknowledgements.error ? (
                  <div style={{ padding: 16 }}>
                    <ErrorNotice
                      error={acknowledgements.error}
                      onRetry={acknowledgements.reload}
                    />
                  </div>
                ) : acknowledgements.loading ? (
                  <div style={{ padding: 16 }}>
                    <LoadingRows rows={2} />
                  </div>
                ) : (acknowledgements.data?.length ?? 0) === 0 ? (
                  <p className="muted" style={{ padding: 16 }}>
                    本告知尚无签收记录。
                  </p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>人员</th>
                          <th>结果</th>
                          <th>已记录</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(acknowledgements.data ?? []).map((ack) => (
                          <tr key={ack.id}>
                            <td>{displayName(ack.personId, people)}</td>
                            <td>
                              {ack.acknowledgedAt
                                ? "已签收"
                                : ack.declinedAt
                                  ? `Declined · ${ack.declineReason ?? ""}`
                                  : "待处理"}
                            </td>
                            <td className="nowrap">
                              {formatDateTime(
                                ack.acknowledgedAt ??
                                  ack.declinedAt ??
                                  ack.createdAt,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            ) : null}

            <Panel
              title="政策咨询"
              subtitle="与员工代表的讨论、意见征集与协商"
              flush
              action={
                <Button
                  size="sm"
                  variant="primary"
                  icon="plus"
                  onClick={openConsultation}
                >
                  记录咨询
                </Button>
              }
            >
              {consultations.error ? (
                <div style={{ padding: 16 }}>
                  <ErrorNotice
                    error={consultations.error}
                    onRetry={consultations.reload}
                  />
                </div>
              ) : consultations.loading ? (
                <div style={{ padding: 16 }}>
                  <LoadingRows rows={2} />
                </div>
              ) : (consultations.data?.length ?? 0) === 0 ? (
                <EmptyState
                  icon="people"
                  title="暂无咨询记录"
                  description="记录法律门禁引用的民主程序证据。"
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>类型</th>
                        <th>已开始</th>
                        <th>结论</th>
                        <th>纪要</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(consultations.data ?? []).map((consultation) => (
                        <tr key={consultation.id}>
                          <td>{titleCase(consultation.consultationType)}</td>
                          <td className="nowrap">
                            {formatDateTime(consultation.startedAt)}
                          </td>
                          <td>
                            <Badge status={consultation.outcome} />
                          </td>
                          <td className="mono">
                            {consultation.minutesRef ?? "—"}
                          </td>
                          <td className="cell-actions">
                            {consultation.outcome === "PENDING" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => openConclude(consultation)}
                              >
                                结论
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
              title="员工代表"
              subtitle="法律门禁引用的职工代表大会、工会与职工代表"
              flush
              action={
                <Button
                  size="sm"
                  variant="primary"
                  icon="plus"
                  onClick={openRepresentation}
                >
                  添加员工代表
                </Button>
              }
            >
              {representations.error ? (
                <div style={{ padding: 16 }}>
                  <ErrorNotice
                    error={representations.error}
                    onRetry={representations.reload}
                  />
                </div>
              ) : representations.loading ? (
                <div style={{ padding: 16 }}>
                  <LoadingRows rows={2} />
                </div>
              ) : (representations.data?.length ?? 0) === 0 ? (
                <EmptyState
                  icon="people"
                  title="暂无员工代表记录"
                  description="记录政策变更咨询的职工机构。"
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>机构</th>
                        <th>类型</th>
                        <th>法域</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(representations.data ?? []).map((body) => (
                        <tr key={body.id}>
                          <td>{body.bodyName}</td>
                          <td>{titleCase(body.bodyType)}</td>
                          <td>{body.jurisdiction}</td>
                          <td>
                            <Badge
                              tone={body.active ? "success" : "neutral"}
                            >
                              {body.active ? "生效中" : "未启用"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        ) : tab === "reports" ? (
          <div className="stack">
            <Panel
              title="年度审查快照"
              subtitle="生成不可变快照；记录报告哈希与签核人"
              action={
                <Button
                  size="sm"
                  variant="primary"
                  loading={reportBusy === "annual"}
                  onClick={() => void finalizeAnnualReport()}
                  disabled={!reviewReports.data}
                >
                  生成年度快照
                </Button>
              }
              flush
            >
              {reviewSnapshots.loading ? (
                <div style={{ padding: 16 }}><LoadingRows /></div>
              ) : (reviewSnapshots.data ?? []).length === 0 ? (
                <EmptyState
                  icon="policy"
                  title="暂无年度快照"
                  description="年度审查完成后生成快照，供审计/仲裁导出。"
                />
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>周期</th><th>状态</th><th>生成时间</th><th /></tr>
                  </thead>
                  <tbody>
                    {(reviewSnapshots.data ?? []).map((record) => (
                      <tr key={record.id}>
                        <td>{record.period ?? "—"}</td>
                        <td><Badge status={record.status} /></td>
                        <td className="nowrap">{formatDateTime(record.createdAt)}</td>
                        <td className="cell-actions">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              window.open(
                                `/api/v1/reports/policy-review/snapshots/${record.id}/export`,
                                "_blank",
                              )
                            }
                          >
                            导出 HTML
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel
              title="评审人一致性（ATT-09）"
              subtitle="同一对象多评审的成对一致率与 Cohen's kappa"
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  loading={reportBusy === "agreement"}
                  onClick={() => void snapshotAgreement()}
                >
                  保存一致性快照
                </Button>
              }
            >
              {reviewerAgreement.loading ? (
                <LoadingRows />
              ) : reviewerAgreement.data?.insufficient ? (
                <InfoNotice tone="warning">
                  配对评审样本不足，无法计算 kappa。需同一周期同一对象至少两名不同评审人。
                </InfoNotice>
              ) : (
                <>
                  <div className="stat-grid stat-grid--three">
                    <div className="stat-card"><span>配对数</span><strong>{reviewerAgreement.data?.pairCount ?? 0}</strong></div>
                    <div className="stat-card"><span>完全一致率</span><strong>{reviewerAgreement.data?.exactAgreementRate ?? "—"}</strong></div>
                    <div className="stat-card"><span>Cohen's kappa</span><strong>{reviewerAgreement.data?.cohenKappa ?? "—"}</strong></div>
                  </div>
                  <table className="table">
                    <thead>
                      <tr><th>对象</th><th>周期</th><th>评审人 A</th><th>评审人 B</th><th>完全一致</th><th>±1 一致</th></tr>
                    </thead>
                    <tbody>
                      {(reviewerAgreement.data?.pairs ?? []).map((pair, index) => (
                        <tr key={`${pair.personId}-${pair.reviewerA}-${pair.reviewerB}-${index}`}>
                          <td className="mono">{pair.personId.slice(0, 8)}</td>
                          <td className="mono">{pair.cycleId.slice(0, 8)}</td>
                          <td className="mono">{pair.reviewerA.slice(0, 8)}</td>
                          <td className="mono">{pair.reviewerB.slice(0, 8)}</td>
                          <td>{pair.exactAgreementRate}</td>
                          <td>{pair.withinOneRate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </Panel>
          </div>
        ) : null}
      </div>

      <Modal
        open={gateOpen}
        title="记录法律门禁"
        description={
          selected
            ? `${selected.code} v${selected.version} · this is assurance evidence, not a legal opinion.`
            : undefined
        }
        onClose={() => setGateOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setGateOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={recordGate}
              loading={gateSubmitting}
            >
              记录门禁
            </Button>
          </>
        }
      >
        <div className="stack">
          {gateError ? (
            <InfoNotice tone="warning">{gateError}</InfoNotice>
          ) : null}
          <div className="notice notice--warning">
            The legal gate records the controls you confirmed. Referencing a
            notice, consultation or DPIA by id triggers server-side coverage
            checks; free-text references are retained as evidence only.
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={policyApproved}
              onChange={(event) => setPolicyApproved(event.target.checked)}
            />
            <span>政策内容已经授权机构批准。</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={minimumWageChecked}
              onChange={(event) =>
                setMinimumWageChecked(event.target.checked)
              }
            />
            <span>已核对最低工资与薪酬处理。</span>
          </label>
          <div className="form-grid">
            <FormField
              label="民主程序引用"
              htmlFor="gate-democratic"
            >
              <TextInput
                id="gate-democratic"
                value={democraticRef}
                onChange={(event) => setDemocraticRef(event.target.value)}
                placeholder="咨询纪要/决议 ID"
              />
            </FormField>
            <FormField
              label="员工告知引用"
              htmlFor="gate-notice"
            >
              <TextInput
                id="gate-notice"
                value={noticeRef}
                onChange={(event) => setNoticeRef(event.target.value)}
                placeholder="告知引用"
              />
            </FormField>
            <FormField
              label="DPIA 引用"
              htmlFor="gate-dpia"
            >
              <TextInput
                id="gate-dpia"
                value={dpiaRef}
                onChange={(event) => setDpiaRef(event.target.value)}
                placeholder="评估引用"
              />
            </FormField>
            <FormField label="记录人" htmlFor="gate-recorder">
              <PersonSelect
                id="gate-recorder"
                value={recordedBy}
                onChange={setRecordedBy}
              />
            </FormField>
            <FormField
              label="审批请求 ID（可选）"
              htmlFor="gate-approval"
              className="field--full"
              hint="仅当 LEGAL_GATE 配置为需审批时必填。"
            >
              <TextInput
                id="gate-approval"
                value={gateApprovalId}
                onChange={(event) => setGateApprovalId(event.target.value)}
              />
            </FormField>
          </div>
        </div>
      </Modal>

      <Modal
        open={ruleOpen}
        title="新建规则变更单"
        description="规则变更经批准、测试并公示后方可生效。"
        onClose={() => setRuleOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setRuleOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={submitRuleChange}>
              创建变更单
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {ruleError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{ruleError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="政策编码" htmlFor="rule-policy-code">
            <TextInput
              id="rule-policy-code"
              value={rulePolicyCode}
              onChange={(event) => setRulePolicyCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="变更类型" htmlFor="rule-change-type">
            <TextInput
              id="rule-change-type"
              value={ruleChangeType}
              onChange={(event) => setRuleChangeType(event.target.value)}
              placeholder="比例或上限"
              required
            />
          </FormField>
          <FormField label="来源版本（可选）" htmlFor="rule-from">
            <Select
              id="rule-from"
              value={ruleFromVersionId}
              onChange={(event) => setRuleFromVersionId(event.target.value)}
            >
              <option value="">无</option>
              {list.map((version) => (
                <option
                  key={version.policyVersionId}
                  value={version.policyVersionId}
                >
                  {version.code} v{version.version}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="目标版本" htmlFor="rule-to">
            <Select
              id="rule-to"
              value={ruleToVersionId}
              onChange={(event) => setRuleToVersionId(event.target.value)}
              required
            >
              <option value="">选择版本…</option>
              {list.map((version) => (
                <option
                  key={version.policyVersionId}
                  value={version.policyVersionId}
                >
                  {version.code} v{version.version}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="生效自" htmlFor="rule-effective">
            <TextInput
              id="rule-effective"
              type="datetime-local"
              value={ruleEffectiveFrom}
              onChange={(event) => setRuleEffectiveFrom(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="原因"
            htmlFor="rule-reason"
            className="field--full"
          >
            <Textarea
              id="rule-reason"
              value={ruleReason}
              onChange={(event) => setRuleReason(event.target.value)}
              required
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={noticeOpen}
        title="发布员工告知"
        description="记录向员工告知的内容与生效时间。"
        onClose={() => setNoticeOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNoticeOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={submitNotice}>
              发布
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {noticeError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{noticeError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="类型" htmlFor="notice-type">
            <Select
              id="notice-type"
              value={noticeType}
              onChange={(event) =>
                setNoticeType(event.target.value as EmployeeNoticeView["noticeType"])
              }
            >
              {["POLICY", "PAY_PLAN", "AI_USE", "DATA_PROCESSING", "OTHER"].map(
                (type) => (
                  <option key={type} value={type}>
                    {titleCase(type)}
                  </option>
                ),
              )}
            </Select>
          </FormField>
          <FormField label="标题" htmlFor="notice-title">
            <TextInput
              id="notice-title"
              value={noticeTitle}
              onChange={(event) => setNoticeTitle(event.target.value)}
              required
            />
          </FormField>
          <FormField label="机构引用" htmlFor="notice-body">
            <TextInput
              id="notice-body"
              value={noticeBodyRef}
              onChange={(event) => setNoticeBodyRef(event.target.value)}
              placeholder="内部文档引用"
              required
            />
          </FormField>
          <FormField label="政策版本（可选）" htmlFor="notice-policy">
            <Select
              id="notice-policy"
              value={noticePolicyVersionId}
              onChange={(event) => setNoticePolicyVersionId(event.target.value)}
            >
              <option value="">无</option>
              {list.map((version) => (
                <option
                  key={version.policyVersionId}
                  value={version.policyVersionId}
                >
                  {version.code} v{version.version}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="生效自" htmlFor="notice-effective">
            <TextInput
              id="notice-effective"
              type="datetime-local"
              value={noticeEffectiveFrom}
              onChange={(event) => setNoticeEffectiveFrom(event.target.value)}
              required
            />
          </FormField>
          <label className="checkbox field--full">
            <input
              type="checkbox"
              checked={noticeAckRequired}
              onChange={(event) => setNoticeAckRequired(event.target.checked)}
            />
            <span>员工必须签收本告知。</span>
          </label>
        </div>
      </Modal>

      <Modal
        open={Boolean(ackOpen)}
        title="记录告知反馈"
        description={ackOpen?.title}
        onClose={() => setAckOpen(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAckOpen(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={submitAck}>
              记录
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
          <FormField label="人员" htmlFor="ack-person">
            <PersonSelect id="ack-person" value={ackPerson} onChange={setAckPerson} />
          </FormField>
          <FormField label="决策" htmlFor="ack-decision">
            <Select
              id="ack-decision"
              value={ackDecision}
              onChange={(event) =>
                setAckDecision(
                  event.target.value as "ACKNOWLEDGE" | "DECLINE",
                )
              }
            >
              <option value="ACKNOWLEDGE">签收</option>
              <option value="DECLINE">婉拒</option>
            </Select>
          </FormField>
          <FormField label="签名引用（可选）" htmlFor="ack-signature">
            <TextInput
              id="ack-signature"
              value={ackSignatureRef}
              onChange={(event) => setAckSignatureRef(event.target.value)}
            />
          </FormField>
          {ackDecision === "DECLINE" ? (
            <FormField
              label="婉拒原因"
              htmlFor="ack-decline-reason"
              className="field--full"
            >
              <Textarea
                id="ack-decline-reason"
                value={ackDeclineReason}
                onChange={(event) => setAckDeclineReason(event.target.value)}
                required
              />
            </FormField>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={repOpen}
        title="添加员工代表"
        description="政策变更咨询的机构。"
        onClose={() => setRepOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRepOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={submitRepresentation}>
              添加
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {repError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{repError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="机构名称" htmlFor="rep-name">
            <TextInput
              id="rep-name"
              value={repName}
              onChange={(event) => setRepName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="机构类型" htmlFor="rep-type">
            <Select
              id="rep-type"
              value={repType}
              onChange={(event) =>
                setRepType(
                  event.target.value as EmployeeRepresentationView["bodyType"],
                )
              }
            >
              {["WORKS_COUNCIL", "UNION", "EMPLOYEE_REP", "ALL_EMPLOYEES"].map(
                (type) => (
                  <option key={type} value={type}>
                    {titleCase(type)}
                  </option>
                ),
              )}
            </Select>
          </FormField>
          <FormField label="法域" htmlFor="rep-jurisdiction">
            <TextInput
              id="rep-jurisdiction"
              value={repJurisdiction}
              onChange={(event) => setRepJurisdiction(event.target.value)}
              placeholder="CN"
              required
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={consultOpen}
        title="记录政策咨询"
        onClose={() => setConsultOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConsultOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={submitConsultation}>
              记录
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {consultError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{consultError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="政策版本" htmlFor="consult-policy">
            <Select
              id="consult-policy"
              value={consultPolicyVersionId}
              onChange={(event) => setConsultPolicyVersionId(event.target.value)}
              required
            >
              <option value="">选择版本…</option>
              {list.map((version) => (
                <option
                  key={version.policyVersionId}
                  value={version.policyVersionId}
                >
                  {version.code} v{version.version}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="类型" htmlFor="consult-type">
            <Select
              id="consult-type"
              value={consultType}
              onChange={(event) =>
                setConsultType(
                  event.target.value as PolicyConsultationView["consultationType"],
                )
              }
            >
              {["DISCUSSION", "COMMENT_PERIOD", "NEGOTIATION", "INFORMATION"].map(
                (type) => (
                  <option key={type} value={type}>
                    {titleCase(type)}
                  </option>
                ),
              )}
            </Select>
          </FormField>
          <FormField label="代表机构 ID（可选）" htmlFor="consult-rep">
            <TextInput
              id="consult-rep"
              value={consultRepresentationId}
              onChange={(event) => setConsultRepresentationId(event.target.value)}
              placeholder="UUID"
            />
          </FormField>
          <FormField label="开始时间" htmlFor="consult-start">
            <TextInput
              id="consult-start"
              type="datetime-local"
              value={consultStartedAt}
              onChange={(event) => setConsultStartedAt(event.target.value)}
              required
            />
          </FormField>
          <FormField label="会议纪要引用" htmlFor="consult-minutes">
            <TextInput
              id="consult-minutes"
              value={consultMinutesRef}
              onChange={(event) => setConsultMinutesRef(event.target.value)}
            />
          </FormField>
          <FormField
            label="意见汇总"
            htmlFor="consult-feedback"
            className="field--full"
          >
            <Textarea
              id="consult-feedback"
              value={consultFeedback}
              onChange={(event) => setConsultFeedback(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={Boolean(concludeTarget)}
        title="结论咨询"
        onClose={() => setConcludeTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConcludeTarget(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={submitConclude}>
              结论
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {concludeError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{concludeError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="结论" htmlFor="conclude-outcome">
            <Select
              id="conclude-outcome"
              value={concludeOutcome}
              onChange={(event) =>
                setConcludeOutcome(
                  event.target.value as
                    | "AGREED"
                    | "NO_AGREEMENT"
                    | "INFORMATION_ONLY"
                    | "CLOSED",
                )
              }
            >
              {["AGREED", "NO_AGREEMENT", "INFORMATION_ONLY", "CLOSED"].map(
                (outcome) => (
                  <option key={outcome} value={outcome}>
                    {titleCase(outcome)}
                  </option>
                ),
              )}
            </Select>
          </FormField>
          <FormField label="会议纪要引用" htmlFor="conclude-minutes">
            <TextInput
              id="conclude-minutes"
              value={concludeMinutesRef}
              onChange={(event) => setConcludeMinutesRef(event.target.value)}
            />
          </FormField>
          <FormField
            label="意见汇总"
            htmlFor="conclude-feedback"
            className="field--full"
          >
            <Textarea
              id="conclude-feedback"
              value={concludeFeedback}
              onChange={(event) => setConcludeFeedback(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={simOpen}
        title="政策模拟"
        description="当前政策从所选版本载入；粘贴拟议定义与代表性输入即可模拟。"
        onClose={() => setSimOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setSimOpen(false)}>
              关闭
            </Button>
            <Button
              variant="primary"
              onClick={runSimulation}
              loading={simRunning}
              disabled={!simCurrentId}
            >
              模拟
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {simError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{simError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="当前政策版本" htmlFor="sim-current">
            <Select
              id="sim-current"
              value={simCurrentId}
              onChange={(event) => setSimCurrentId(event.target.value)}
              required
            >
              <option value="">选择版本…</option>
              {list.map((version) => (
                <option
                  key={version.policyVersionId}
                  value={version.policyVersionId}
                >
                  {version.code} v{version.version}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="拟议政策（JSON）"
            htmlFor="sim-proposed"
            className="field--full"
          >
            <Textarea
              id="sim-proposed"
              value={simProposed}
              onChange={(event) => setSimProposed(event.target.value)}
              rows={12}
              spellCheck={false}
            />
          </FormField>
          <FormField
            label="Samples (JSON: [{ personId, input }])"
            htmlFor="sim-samples"
            className="field--full"
            hint="使用计算批次输入结构；至少一个样本。"
          >
            <Textarea
              id="sim-samples"
              value={simSamples}
              onChange={(event) => setSimSamples(event.target.value)}
              rows={8}
              spellCheck={false}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={linkOpen}
        title="将告知关联到政策版本"
        onClose={() => setLinkOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLinkOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={linkNotice}>
              关联
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {linkError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{linkError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="政策版本" htmlFor="link-policy">
            <Select
              id="link-policy"
              value={linkPolicyVersionId}
              onChange={(event) => setLinkPolicyVersionId(event.target.value)}
              required
            >
              <option value="">选择版本…</option>
              {list.map((version) => (
                <option
                  key={version.policyVersionId}
                  value={version.policyVersionId}
                >
                  {version.code} v{version.version}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="通知" htmlFor="link-notice">
            <Select
              id="link-notice"
              value={linkNoticeId}
              onChange={(event) => setLinkNoticeId(event.target.value)}
              required
            >
              <option value="">选择告知…</option>
              {(notices.data ?? []).map((notice) => (
                <option key={notice.id} value={notice.id}>
                  {notice.title}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      </Modal>

      <Modal
        open={marginalOpen}
        title="边际阈值扫描"
        description="对参与人字段做小幅步进，暴露金额跳档效应。"
        onClose={() => setMarginalOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setMarginalOpen(false)}>
              关闭
            </Button>
            <Button
              variant="primary"
              onClick={runMarginal}
              loading={marginalRunning}
            >
              扫描
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {marginalError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{marginalError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="参与人序号" htmlFor="marginal-index">
            <TextInput
              id="marginal-index"
              value={marginalIndex}
              onChange={(event) => setMarginalIndex(event.target.value)}
            />
          </FormField>
          <FormField label="字段" htmlFor="marginal-field">
            <Select
              id="marginal-field"
              value={marginalField}
              onChange={(event) =>
                setMarginalField(
                  event.target.value as
                    | "attributionWeight"
                    | "evaluationMultiplier",
                )
              }
            >
              <option value="attributionWeight">认定权重</option>
              <option value="evaluationMultiplier">评价乘数</option>
            </Select>
          </FormField>
          <FormField label="From" htmlFor="marginal-from">
            <TextInput
              id="marginal-from"
              value={marginalFrom}
              onChange={(event) => setMarginalFrom(event.target.value)}
              required
            />
          </FormField>
          <FormField label="To" htmlFor="marginal-to">
            <TextInput
              id="marginal-to"
              value={marginalTo}
              onChange={(event) => setMarginalTo(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Step" htmlFor="marginal-step">
            <TextInput
              id="marginal-step"
              value={marginalStep}
              onChange={(event) => setMarginalStep(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="样本（JSON）"
            htmlFor="marginal-sample"
            className="field--full"
          >
            <Textarea
              id="marginal-sample"
              value={marginalSample}
              onChange={(event) => setMarginalSample(event.target.value)}
              rows={8}
              spellCheck={false}
            />
          </FormField>
        </div>
        {marginalResult ? (
          <div className="detail-section">
            <DefinitionList
              items={[
                {
                  label: "扫描",
                  value: `${marginalResult.field} ${marginalResult.from} → ${marginalResult.to} (step ${marginalResult.step})`,
                },
                {
                  label: "Max target delta",
                  value: marginalResult.maxDelta,
                },
              ]}
            />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>值</th>
                    <th>合计</th>
                    <th>目标金额</th>
                    <th>目标差额</th>
                  </tr>
                </thead>
                <tbody>
                  {marginalResult.points.map((point) => (
                    <tr key={point.value}>
                      <td className="mono">{point.value}</td>
                      <td>{point.total}</td>
                      <td>{point.targetAmount}</td>
                      <td>
                        <Badge
                          tone={
                            point.targetDelta === "0" ? "neutral" : "warning"
                          }
                        >
                          {point.targetDelta}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="subtle" style={{ fontSize: 11.5 }}>
              {marginalResult.note}
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={testOpen}
        title="新建回归用例"
        onClose={() => setTestOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTestOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="test-case-form">
              创建
            </Button>
          </>
        }
      >
        <form id="test-case-form" onSubmit={createTestCase} className="form-grid">
          {testError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{testError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="用例编码">
            <TextInput
              value={testCode}
              onChange={(event) => setTestCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="类别">
            <Select
              value={testCategory}
              onChange={(event) => setTestCategory(event.target.value)}
            >
              <option value="NORMAL">正常</option>
              <option value="BOUNDARY">边界</option>
              <option value="EXCEPTION">异常</option>
              <option value="HISTORICAL">历史回放</option>
            </Select>
          </FormField>
          <FormField label="输入 JSON" className="field--full">
            <Textarea
              rows={6}
              value={testInput}
              onChange={(event) => setTestInput(event.target.value)}
            />
          </FormField>
          <FormField label="期望输出 JSON" className="field--full">
            <Textarea
              rows={6}
              value={testExpected}
              onChange={(event) => setTestExpected(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

    </>
  );
}
