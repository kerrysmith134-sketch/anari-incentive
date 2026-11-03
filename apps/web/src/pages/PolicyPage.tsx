import { useEffect, useState } from "react";
import {
  Badge,
  Button,
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
  PolicySimulationResultView,
  RuleChangeOrderView,
} from "../lib/ops-types.js";

export function PolicyPage() {
  useDocumentTitle("Policy");
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
          : "Could not record the legal gate.",
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
        "Could not run the suite",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setRunning(false);
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
        caught instanceof Error ? caught.message : "Could not create order",
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
        caught instanceof Error ? caught.message : "Could not publish notice",
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
        ackDecision === "ACKNOWLEDGE" ? "Acknowledgement recorded" : "Decline recorded",
        ackOpen.title,
      );
      setAckOpen(null);
      setAckNoticeId(ackOpen.id);
      acknowledgements.reload();
    } catch (caught) {
      setAckError(
        caught instanceof Error ? caught.message : "Could not record the response",
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
      toast.success("Employee representation recorded", repName);
      setRepOpen(false);
      representations.reload();
    } catch (caught) {
      setRepError(
        caught instanceof Error
          ? caught.message
          : "Could not record representation",
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
      toast.success("Consultation recorded", titleCase(consultType));
      setConsultOpen(false);
      consultations.reload();
    } catch (caught) {
      setConsultError(
        caught instanceof Error ? caught.message : "Could not record consultation",
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
      toast.success("Consultation concluded", titleCase(concludeOutcome));
      setConcludeTarget(null);
      consultations.reload();
    } catch (caught) {
      setConcludeError(
        caught instanceof Error
          ? caught.message
          : "Could not conclude consultation",
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
          : "Could not load the current policy",
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
          : "Could not link the notice",
      );
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Rules and readiness"
        title="Policy"
        description="Versioned policy definitions with test suites, legal gates, notice acknowledgement and DPIA evidence. A version is not settlement-ready until every blocker clears."
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
              Refresh
            </Button>
            <Button
              variant="primary"
              icon="play"
              onClick={runSuite}
              loading={running}
              disabled={!selectedId}
            >
              Run test suite
            </Button>
          </>
        }
      />

      {versions.error ? (
        <ErrorNotice error={versions.error} onRetry={versions.reload} />
      ) : versions.loading ? (
        <Panel title="Policy versions">
          <LoadingRows rows={3} />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon="policy"
            title="No policy version"
            description="Publish or seed a policy version to unlock readiness reports and test cases."
          />
        </Panel>
      ) : (
        <div className="split-grid">
          <Panel
            title="Policy versions"
            subtitle={`${list.length} published or seeded version${list.length === 1 ? "" : "s"}`}
            flush
          >
            <div className="table-wrap">
              <table className="data-table table-clickable">
                <thead>
                  <tr>
                    <th>Policy</th>
                    <th>Status</th>
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
            title="Policy readiness"
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
                  Record gate
                </Button>
                {readiness.data ? (
                  <Badge
                    tone={readiness.data.ready ? "success" : "danger"}
                  >
                    {readiness.data.ready ? "Ready" : "Blocked"}
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
                    <div className="coverage-cell__label">Legal gate</div>
                    <div className="coverage-cell__value" style={{ fontSize: 15 }}>
                      {readiness.data.legalGate.approved ? (
                        <Badge tone="success">Approved</Badge>
                      ) : readiness.data.legalGate.recorded ? (
                        <Badge tone="warning">Recorded</Badge>
                      ) : (
                        <Badge tone="danger">Missing</Badge>
                      )}
                    </div>
                    <div className="coverage-cell__sub">
                      {readiness.data.legalGate.blockers.length} blocker
                      {readiness.data.legalGate.blockers.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Tests passed</div>
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
                        <Badge tone="success">Approved</Badge>
                      ) : readiness.data.dpia.referenced ? (
                        <Badge tone="warning">
                          {titleCase(readiness.data.dpia.status ?? "referenced")}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Not referenced</Badge>
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
                      <strong>No readiness blocker</strong>
                      <p>This version can back a formal calculation.</p>
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
            label: "Test cases",
            count: tests.data?.length ?? 0,
          },
          { id: "coverage", label: "Operations coverage" },
          { id: "annual", label: "Annual review" },
          { id: "governance", label: "Governance" },
        ]}
        active={tab}
        onChange={setTab}
        label="Policy views"
      />

      <div className="tab-panel">
        {tab === "readiness" ? (
          <Panel
            title="Regression suite"
            subtitle="Boundary, exception and historical cases for the selected version"
            action={
              <Button
                size="sm"
                variant="secondary"
                icon="play"
                onClick={runSuite}
                loading={running}
                disabled={!selectedId}
              >
                Run suite
              </Button>
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
                title="No test case"
                description="A policy without a regression suite cannot prove its behaviour. Seed or add test cases for this version."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Category</th>
                      <th>Status</th>
                      <th>Result</th>
                      <th>Last run</th>
                      <th>Hash</th>
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
                            <Badge tone="neutral">Not run</Badge>
                          ) : testCase.lastRunPassed ? (
                            <Badge tone="success">Passed</Badge>
                          ) : (
                            <Badge tone="danger">Failed</Badge>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : tab === "coverage" ? (
          <Panel
            title="Operations coverage"
            subtitle="Cross-module evidence and data-quality posture"
          >
            {coverage.error ? (
              <ErrorNotice error={coverage.error} onRetry={coverage.reload} />
            ) : coverage.loading || !coverage.data ? (
              <LoadingRows rows={4} />
            ) : (
              <>
                <div className="coverage-grid">
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Evidence coverage</div>
                    <div className="coverage-cell__value">
                      {formatPercent(coverage.data.workPackages.evidenceCoverageRate)}
                    </div>
                    <div className="coverage-cell__sub">
                      {coverage.data.workPackages.withEvidence} of{" "}
                      {coverage.data.workPackages.accepted} accepted
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Claims</div>
                    <div className="coverage-cell__value">
                      {coverage.data.claims.total}
                    </div>
                    <div className="coverage-cell__sub">
                      {coverage.data.claims.confirmed} confirmed ·{" "}
                      {coverage.data.claims.rejected} rejected
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Deliverables</div>
                    <div className="coverage-cell__value">
                      {coverage.data.deliverables.total}
                    </div>
                    <div className="coverage-cell__sub">
                      {coverage.data.deliverables.pendingAcceptance} pending
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Data quality</div>
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
                  <div className="detail-section__title">Appeals and disputes</div>
                  <div className="coverage-grid">
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Open appeals</div>
                      <div className="coverage-cell__value">
                        {coverage.data.appeals?.open ?? 0}
                      </div>
                      <div className="coverage-cell__sub">
                        {coverage.data.appeals?.overdue ?? 0} past SLA
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Appeal rate</div>
                      <div className="coverage-cell__value">
                        {formatPercent(coverage.data.appeals?.appealRate ?? 0, 1)}
                      </div>
                      <div className="coverage-cell__sub">
                        of {coverage.data.claims.total} claims
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Closed appeals</div>
                      <div className="coverage-cell__value">
                        {coverage.data.appeals?.closed ?? 0}
                      </div>
                      <div className="coverage-cell__sub">resolved and closed</div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">SLA status</div>
                      <div className="coverage-cell__value" style={{ fontSize: 15 }}>
                        {(coverage.data.appeals?.overdue ?? 0) > 0 ? (
                          <Badge tone="danger">Breached</Badge>
                        ) : (
                          <Badge tone="success">Within SLA</Badge>
                        )}
                      </div>
                      <div className="coverage-cell__sub">
                        configured at appeal creation
                      </div>
                    </div>
                  </div>
                </div>
                <div className="detail-section">
                  <div className="detail-section__title">Cycle time</div>
                  <div className="coverage-grid">
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">
                        Package acceptance
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
                        Claim decision
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
                        Employee confirmation
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
                        Payroll approval
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
                        Appeal resolution
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
                      Coverage by responsibility
                    </div>
                    {coverage.data.workPackages.coverageByResponsibility.length === 0 ? (
                      <p className="muted">No accepted package with a role yet.</p>
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
                      Coverage by order type
                    </div>
                    {coverage.data.workPackages.coverageByOrderType.length === 0 ? (
                      <p className="muted">No calculation-linked package yet.</p>
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
                      Coverage by task type
                    </div>
                    {coverage.data.workPackages.coverageByPackageType.length === 0 ? (
                      <p className="muted">No accepted package yet.</p>
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
                    Coverage trend by month
                  </div>
                  {coverage.data.workPackages.coverageTrend.length === 0 ? (
                    <p className="muted">No accepted package yet.</p>
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
            title="Annual policy review"
            subtitle="Rolling 12-month view of policy, appeal, AI-review and privacy evidence"
          >
            {review.error ? (
              <ErrorNotice error={review.error} onRetry={review.reload} />
            ) : review.loading || !review.data ? (
              <LoadingRows rows={4} />
            ) : (
              <>
                <div className="coverage-grid">
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Policies published</div>
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
                    <div className="coverage-cell__label">Open appeals</div>
                    <div className="coverage-cell__value">
                      {review.data.appeals.open}
                    </div>
                    <div className="coverage-cell__sub">
                      {review.data.appeals.overdue} past SLA ·{" "}
                      {review.data.appeals.closed} closed
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">AI acceptance</div>
                    <div className="coverage-cell__value">
                      {formatPercent(review.data.aiReview.acceptanceRate, 1)}
                    </div>
                    <div className="coverage-cell__sub">
                      {review.data.aiReview.accepted} of{" "}
                      {review.data.aiReview.decided} decided
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Human overrides</div>
                    <div className="coverage-cell__value">
                      {review.data.aiReview.overrides}
                    </div>
                    <div className="coverage-cell__sub">
                      {review.data.aiReview.blindReviews} independent-first reviews
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Data quality</div>
                    <div className="coverage-cell__value">
                      {review.data.dataQuality.open}
                    </div>
                    <div className="coverage-cell__sub">
                      {review.data.dataQuality.overdue} overdue ·{" "}
                      {review.data.dataQuality.escalated} escalated
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Evaluation decisions</div>
                    <div className="coverage-cell__value">
                      {review.data.evaluations.decisions}
                    </div>
                    <div className="coverage-cell__sub">
                      {review.data.evaluations.drafts} AI drafts
                    </div>
                  </div>
                  <div className="coverage-cell">
                    <div className="coverage-cell__label">Privacy</div>
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
                    <div className="detail-section__title">Appeal outcomes</div>
                    {Object.keys(review.data.appeals.outcomes).length === 0 ? (
                      <p className="muted">No resolved appeal in this window.</p>
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
                    <div className="detail-section__title">Harness evidence</div>
                    <div className="stack" style={{ gap: 6 }}>
                      <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                        <span>Harness evaluations</span>
                        <span className="muted">
                          {review.data.aiReview.harnessEvaluations}
                        </span>
                      </div>
                      <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                        <span>AI proposals decided</span>
                        <span className="muted">
                          {review.data.aiReview.decided}/{review.data.aiReview.total}
                        </span>
                      </div>
                      <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                        <span>High-risk proposals</span>
                        <span className="muted">
                          {review.data.aiReview.highRiskProposals}
                        </span>
                      </div>
                      <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                        <span>Second-review SLA</span>
                        <span className="muted">
                          {review.data.aiReview.secondReviewOverdue} overdue ·{" "}
                          {review.data.aiReview.secondReviewSlaBreaches} breached
                        </span>
                      </div>
                      <div className="inline" style={{ justifyContent: "space-between", width: "100%" }}>
                        <span>Contribution claims decided</span>
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
                    <p className="muted">No attribution decision in this window.</p>
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
                        <span>Repeated decisions</span>
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
        ) : (
          <>
            <Panel
              title="Policy simulation"
              subtitle="Replay representative inputs through the current and proposed policies; decision support only"
              action={
                <Button
                  size="sm"
                  variant="primary"
                  icon="play"
                  onClick={openSimulation}
                >
                  Run simulation
                </Button>
              }
            >
              {simResult ? (
                <>
                  <div className="coverage-grid">
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Current total</div>
                      <div className="coverage-cell__value">
                        {simResult.currentTotal}
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Proposed total</div>
                      <div className="coverage-cell__value">
                        {simResult.proposedTotal}
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Delta</div>
                      <div className="coverage-cell__value">
                        {simResult.deltaTotal}
                      </div>
                    </div>
                    <div className="coverage-cell">
                      <div className="coverage-cell__label">Affected people</div>
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
                          <th>Person</th>
                          <th>Current</th>
                          <th>Proposed</th>
                          <th>Delta</th>
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
              title="Policy notice links"
              subtitle="Bind notices to a policy version for readiness coverage"
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
                  Link notice
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
                  title="No notice linked"
                  description="Policy readiness checks acknowledgement coverage for linked notices."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Policy version</th>
                        <th>Notice</th>
                        <th>Linked</th>
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
              title="Rule change orders"
              subtitle="Draft → approved or rejected → publicized, with policy-test gating"
              flush
              action={
                <Button
                  size="sm"
                  variant="primary"
                  icon="plus"
                  onClick={openRuleChange}
                >
                  New order
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
                  title="No rule change order"
                  description="A rule change records the from/to policy versions, reason and impact simulation before publication."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Change</th>
                        <th>Status</th>
                        <th>Effective</th>
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
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  loading={ruleBusy === `reject:${order.id}`}
                                  onClick={() => ruleAction(order, "reject")}
                                >
                                  Reject
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
                                Publicize
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
              title="Employee notices"
              subtitle="Published notices and per-person acknowledgement coverage"
              flush
              action={
                <Button
                  size="sm"
                  variant="primary"
                  icon="plus"
                  onClick={openNotice}
                >
                  Publish notice
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
                  title="No employee notice"
                  description="Notices document what employees were told, when it took effect and who acknowledged it."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Notice</th>
                        <th>Type</th>
                        <th>Effective</th>
                        <th>Acknowledgement</th>
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
                              ? "Required"
                              : "Not required"}
                          </td>
                          <td className="cell-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => openAck(notice)}
                            >
                              Record
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
                              {ackNoticeId === notice.id ? "Hide" : "Acks"}
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
              <Panel title="Notice acknowledgements" flush>
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
                    No acknowledgement recorded for this notice.
                  </p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Person</th>
                          <th>Result</th>
                          <th>Recorded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(acknowledgements.data ?? []).map((ack) => (
                          <tr key={ack.id}>
                            <td>{displayName(ack.personId, people)}</td>
                            <td>
                              {ack.acknowledgedAt
                                ? "Acknowledged"
                                : ack.declinedAt
                                  ? `Declined · ${ack.declineReason ?? ""}`
                                  : "Pending"}
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
              title="Policy consultations"
              subtitle="Discussion, comment periods and negotiation with employee representatives"
              flush
              action={
                <Button
                  size="sm"
                  variant="primary"
                  icon="plus"
                  onClick={openConsultation}
                >
                  Record consultation
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
                  title="No consultation recorded"
                  description="Record the democratic procedure evidence referenced by the legal gate."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Started</th>
                        <th>Outcome</th>
                        <th>Minutes</th>
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
                                Conclude
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
              title="Employee representation"
              subtitle="Works councils, unions and elected representatives referenced by the legal gate"
              flush
              action={
                <Button
                  size="sm"
                  variant="primary"
                  icon="plus"
                  onClick={openRepresentation}
                >
                  Add representation
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
                  title="No representation recorded"
                  description="Record the employee body consulted for policy changes."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Body</th>
                        <th>Type</th>
                        <th>Jurisdiction</th>
                        <th>Status</th>
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
                              {body.active ? "Active" : "Inactive"}
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
        )}
      </div>

      <Modal
        open={gateOpen}
        title="Record legal gate"
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
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={recordGate}
              loading={gateSubmitting}
            >
              Record gate
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
            <span>Policy content is approved by the authorised body.</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={minimumWageChecked}
              onChange={(event) =>
                setMinimumWageChecked(event.target.checked)
              }
            />
            <span>Minimum-wage and payroll treatment has been checked.</span>
          </label>
          <div className="form-grid">
            <FormField
              label="Democratic procedure reference"
              htmlFor="gate-democratic"
            >
              <TextInput
                id="gate-democratic"
                value={democraticRef}
                onChange={(event) => setDemocraticRef(event.target.value)}
                placeholder="Consultation minutes / resolution id"
              />
            </FormField>
            <FormField
              label="Employee notice reference"
              htmlFor="gate-notice"
            >
              <TextInput
                id="gate-notice"
                value={noticeRef}
                onChange={(event) => setNoticeRef(event.target.value)}
                placeholder="Notice reference"
              />
            </FormField>
            <FormField
              label="DPIA reference"
              htmlFor="gate-dpia"
            >
              <TextInput
                id="gate-dpia"
                value={dpiaRef}
                onChange={(event) => setDpiaRef(event.target.value)}
                placeholder="Assessment reference"
              />
            </FormField>
            <FormField label="Recorded by" htmlFor="gate-recorder">
              <PersonSelect
                id="gate-recorder"
                value={recordedBy}
                onChange={setRecordedBy}
              />
            </FormField>
            <FormField
              label="Approval request id (optional)"
              htmlFor="gate-approval"
              className="field--full"
              hint="Required only when LEGAL_GATE is configured as approval-gated."
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
        title="New rule change order"
        description="A rule change is not effective until approved, tested and publicized."
        onClose={() => setRuleOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setRuleOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitRuleChange}>
              Create order
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
          <FormField label="Policy code" htmlFor="rule-policy-code">
            <TextInput
              id="rule-policy-code"
              value={rulePolicyCode}
              onChange={(event) => setRulePolicyCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Change type" htmlFor="rule-change-type">
            <TextInput
              id="rule-change-type"
              value={ruleChangeType}
              onChange={(event) => setRuleChangeType(event.target.value)}
              placeholder="RATE_OR_CAP"
              required
            />
          </FormField>
          <FormField label="From version (optional)" htmlFor="rule-from">
            <Select
              id="rule-from"
              value={ruleFromVersionId}
              onChange={(event) => setRuleFromVersionId(event.target.value)}
            >
              <option value="">None</option>
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
          <FormField label="To version" htmlFor="rule-to">
            <Select
              id="rule-to"
              value={ruleToVersionId}
              onChange={(event) => setRuleToVersionId(event.target.value)}
              required
            >
              <option value="">Select a version</option>
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
          <FormField label="Effective from" htmlFor="rule-effective">
            <TextInput
              id="rule-effective"
              type="datetime-local"
              value={ruleEffectiveFrom}
              onChange={(event) => setRuleEffectiveFrom(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="Reason"
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
        title="Publish employee notice"
        description="Record what employees were told and when it takes effect."
        onClose={() => setNoticeOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNoticeOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitNotice}>
              Publish
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
          <FormField label="Type" htmlFor="notice-type">
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
          <FormField label="Title" htmlFor="notice-title">
            <TextInput
              id="notice-title"
              value={noticeTitle}
              onChange={(event) => setNoticeTitle(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Body reference" htmlFor="notice-body">
            <TextInput
              id="notice-body"
              value={noticeBodyRef}
              onChange={(event) => setNoticeBodyRef(event.target.value)}
              placeholder="Internal document reference"
              required
            />
          </FormField>
          <FormField label="Policy version (optional)" htmlFor="notice-policy">
            <Select
              id="notice-policy"
              value={noticePolicyVersionId}
              onChange={(event) => setNoticePolicyVersionId(event.target.value)}
            >
              <option value="">None</option>
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
          <FormField label="Effective from" htmlFor="notice-effective">
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
            <span>Employees must acknowledge this notice.</span>
          </label>
        </div>
      </Modal>

      <Modal
        open={Boolean(ackOpen)}
        title="Record notice response"
        description={ackOpen?.title}
        onClose={() => setAckOpen(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAckOpen(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitAck}>
              Record
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
          <FormField label="Person" htmlFor="ack-person">
            <PersonSelect id="ack-person" value={ackPerson} onChange={setAckPerson} />
          </FormField>
          <FormField label="Decision" htmlFor="ack-decision">
            <Select
              id="ack-decision"
              value={ackDecision}
              onChange={(event) =>
                setAckDecision(
                  event.target.value as "ACKNOWLEDGE" | "DECLINE",
                )
              }
            >
              <option value="ACKNOWLEDGE">Acknowledge</option>
              <option value="DECLINE">Decline</option>
            </Select>
          </FormField>
          <FormField label="Signature reference (optional)" htmlFor="ack-signature">
            <TextInput
              id="ack-signature"
              value={ackSignatureRef}
              onChange={(event) => setAckSignatureRef(event.target.value)}
            />
          </FormField>
          {ackDecision === "DECLINE" ? (
            <FormField
              label="Decline reason"
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
        title="Add employee representation"
        description="The body consulted for policy changes."
        onClose={() => setRepOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRepOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitRepresentation}>
              Add
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
          <FormField label="Body name" htmlFor="rep-name">
            <TextInput
              id="rep-name"
              value={repName}
              onChange={(event) => setRepName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Body type" htmlFor="rep-type">
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
          <FormField label="Jurisdiction" htmlFor="rep-jurisdiction">
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
        title="Record policy consultation"
        onClose={() => setConsultOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConsultOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitConsultation}>
              Record
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
          <FormField label="Policy version" htmlFor="consult-policy">
            <Select
              id="consult-policy"
              value={consultPolicyVersionId}
              onChange={(event) => setConsultPolicyVersionId(event.target.value)}
              required
            >
              <option value="">Select a version</option>
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
          <FormField label="Type" htmlFor="consult-type">
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
          <FormField label="Representation id (optional)" htmlFor="consult-rep">
            <TextInput
              id="consult-rep"
              value={consultRepresentationId}
              onChange={(event) => setConsultRepresentationId(event.target.value)}
              placeholder="UUID"
            />
          </FormField>
          <FormField label="Started at" htmlFor="consult-start">
            <TextInput
              id="consult-start"
              type="datetime-local"
              value={consultStartedAt}
              onChange={(event) => setConsultStartedAt(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Minutes reference" htmlFor="consult-minutes">
            <TextInput
              id="consult-minutes"
              value={consultMinutesRef}
              onChange={(event) => setConsultMinutesRef(event.target.value)}
            />
          </FormField>
          <FormField
            label="Feedback summary"
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
        title="Conclude consultation"
        onClose={() => setConcludeTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConcludeTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitConclude}>
              Conclude
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
          <FormField label="Outcome" htmlFor="conclude-outcome">
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
          <FormField label="Minutes reference" htmlFor="conclude-minutes">
            <TextInput
              id="conclude-minutes"
              value={concludeMinutesRef}
              onChange={(event) => setConcludeMinutesRef(event.target.value)}
            />
          </FormField>
          <FormField
            label="Feedback summary"
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
        title="Policy simulation"
        description="The current policy is loaded from the selected version; paste a proposed definition and representative inputs."
        onClose={() => setSimOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setSimOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={runSimulation}
              loading={simRunning}
              disabled={!simCurrentId}
            >
              Simulate
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
          <FormField label="Current policy version" htmlFor="sim-current">
            <Select
              id="sim-current"
              value={simCurrentId}
              onChange={(event) => setSimCurrentId(event.target.value)}
              required
            >
              <option value="">Select a version</option>
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
            label="Proposed policy (JSON)"
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
            hint="Uses the calculation-run input shape; at least one sample."
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
        title="Link notice to policy version"
        onClose={() => setLinkOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={linkNotice}>
              Link
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
          <FormField label="Policy version" htmlFor="link-policy">
            <Select
              id="link-policy"
              value={linkPolicyVersionId}
              onChange={(event) => setLinkPolicyVersionId(event.target.value)}
              required
            >
              <option value="">Select a version</option>
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
          <FormField label="Notice" htmlFor="link-notice">
            <Select
              id="link-notice"
              value={linkNoticeId}
              onChange={(event) => setLinkNoticeId(event.target.value)}
              required
            >
              <option value="">Select a notice</option>
              {(notices.data ?? []).map((notice) => (
                <option key={notice.id} value={notice.id}>
                  {notice.title}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      </Modal>

    </>
  );
}
