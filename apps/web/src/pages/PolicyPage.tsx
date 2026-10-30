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
} from "../components/ui.js";
import { Icon } from "../components/Icon.js";
import { useToast } from "../contexts/ToastContext.js";
import { PersonSelect, usePeople } from "../components/PersonSelect.js";
import { api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { useAuth } from "../contexts/AuthContext.js";
import {
  formatDate,
  formatDateTime,
  formatPercent,
  shortId,
  titleCase,
} from "../lib/format.js";
import type {
  OperationsCoverageReport,
  PolicyReadinessReport,
  PolicyTestCase,
  PolicyVersionSummary,
} from "../lib/types.js";

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
        ) : (
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
                </div>
                <InfoNotice>
                  Generated {formatDateTime(coverage.data.generatedAt)}. Coverage is
                  recomputed from live tenant records on refresh.
                </InfoNotice>
              </>
            )}
          </Panel>
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

    </>
  );
}
