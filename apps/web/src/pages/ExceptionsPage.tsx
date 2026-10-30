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
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  displayName,
  formatDate,
  formatDateTime,
  formatRelative,
  shortId,
  titleCase,
} from "../lib/format.js";
import type { AppealCase, DataQualityIssue } from "../lib/types.js";

type DqCommand =
  | "ASSIGN"
  | "START"
  | "RESOLVE"
  | "WAIVE"
  | "REOPEN"
  | "ESCALATE";

const DQ_COMMANDS: Record<string, DqCommand[]> = {
  OPEN: ["ASSIGN", "RESOLVE", "WAIVE", "ESCALATE"],
  ASSIGNED: ["START", "WAIVE", "ESCALATE"],
  IN_PROGRESS: ["RESOLVE", "WAIVE", "ESCALATE"],
  RESOLVED: ["REOPEN"],
  WAIVED_WITH_APPROVAL: ["REOPEN"],
  REOPENED: ["ASSIGN", "START", "ESCALATE"],
};

const DQ_COMMAND_COPY: Record<DqCommand, string> = {
  ASSIGN: "Assign owner",
  START: "Start remediation",
  RESOLVE: "Resolve issue",
  WAIVE: "Waive with approval",
  REOPEN: "Reopen issue",
  ESCALATE: "Escalate",
};

export function ExceptionsPage() {
  useDocumentTitle("Exceptions");
  const { session } = useAuth();
  const toast = useToast();
  const { people } = usePeople();
  const issues = useApiQuery<DataQualityIssue[]>("/api/v1/data-quality-issues");
  const appeals = useApiQuery<AppealCase[]>("/api/v1/appeals");
  const [tab, setTab] = useState("quality");
  const [dqTarget, setDqTarget] = useState<DataQualityIssue | null>(null);
  const [dqCommand, setDqCommand] = useState<DqCommand>("ASSIGN");
  const [assignee, setAssignee] = useState(session.personId);
  const [dqActor, setDqActor] = useState(session.personId);
  const [dqReason, setDqReason] = useState("");
  const [dqError, setDqError] = useState<string | null>(null);
  const [appealTarget, setAppealTarget] = useState<AppealCase | null>(null);
  const [reviewer, setReviewer] = useState(session.personId);
  const [resolution, setResolution] = useState<"UPHOLD" | "CHANGE" | "REJECT">(
    "UPHOLD",
  );
  const [appealRationale, setAppealRationale] = useState("");
  const [appealError, setAppealError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const issueList = issues.data ?? [];
  const appealList = appeals.data ?? [];
  const openIssues = issueList.filter(
    (issue) => issue.status !== "RESOLVED" && issue.status !== "WAIVED_WITH_APPROVAL",
  );
  const blocking = openIssues.filter((issue) => issue.severity === "BLOCKING");
  const openAppeals = appealList.filter((appeal) => appeal.status !== "CLOSED");

  function openDq(issue: DataQualityIssue) {
    setDqTarget(issue);
    setDqCommand(DQ_COMMANDS[issue.status]?.[0] ?? "RESOLVE");
    setAssignee(issue.assignedTo ?? session.personId);
    setDqActor(session.personId);
    setDqReason("");
    setDqError(null);
  }

  async function executeDq() {
    if (!dqTarget) return;
    if (dqCommand === "WAIVE" && (!dqActor || !dqReason.trim())) {
      setDqError("Waiving requires an approver and a reason.");
      return;
    }
    setSubmitting(true);
    setDqError(null);
    try {
      await api(`/api/v1/data-quality-issues/${dqTarget.id}/commands`, {
        method: "POST",
        body: {
          command: dqCommand,
          assignedTo: dqCommand === "ASSIGN" ? assignee : undefined,
          actorPersonId: dqActor || undefined,
          reason: dqReason.trim() || undefined,
        },
      });
      toast.success(DQ_COMMAND_COPY[dqCommand], dqTarget.issueCode);
      setDqTarget(null);
      issues.reload();
    } catch (caught) {
      setDqError(
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

  function openAppeal(appeal: AppealCase) {
    setAppealTarget(appeal);
    setReviewer(
      people.find((person) => person.id !== appeal.appellantPersonId)?.id ??
        session.personId,
    );
    setResolution("UPHOLD");
    setAppealRationale("");
    setAppealError(null);
  }

  async function executeAppeal() {
    if (!appealTarget) return;
    setSubmitting(true);
    setAppealError(null);
    try {
      if (appealTarget.status === "OPEN") {
        await api(`/api/v1/appeals/${appealTarget.id}/triage`, {
          method: "POST",
          body: { reviewerPersonId: reviewer },
        });
        toast.success("Appeal triaged", shortId(appealTarget.id));
      } else if (appealTarget.status === "TRIAGED") {
        await api(`/api/v1/appeals/${appealTarget.id}/review`, {
          method: "POST",
        });
        toast.success("Appeal moved to review", shortId(appealTarget.id));
      } else if (appealTarget.status === "UNDER_REVIEW") {
        if (appealRationale.trim().length < 3) {
          setAppealError("A resolution rationale is required.");
          setSubmitting(false);
          return;
        }
        await api(`/api/v1/appeals/${appealTarget.id}/resolve`, {
          method: "POST",
          body: {
            reviewerPersonId: reviewer,
            resolution,
            rationale: appealRationale.trim(),
          },
        });
        toast.success("Appeal resolved", `${resolution}`);
      }
      setAppealTarget(null);
      appeals.reload();
    } catch (caught) {
      setAppealError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "The appeal action failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Remediation and appeals"
        title="Exceptions"
        description="Blocking data-quality issues stop formal calculations; appeals challenge attribution or evaluation with a reviewer separate from the appellant."
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => {
              issues.reload();
              appeals.reload();
            }}
            loading={issues.loading || appeals.loading}
          >
            Refresh
          </Button>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--warning">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Open data issues</span>
          </div>
          <div className="stat-tile__value">{openIssues.length}</div>
          <div className="stat-tile__detail">{blocking.length} blocking</div>
        </div>
        <div className="stat-tile stat-tile--critical">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Overdue remediation</span>
          </div>
          <div className="stat-tile__value">
            {
              openIssues.filter(
                (issue) =>
                  issue.dueAt && new Date(issue.dueAt).getTime() < Date.now(),
              ).length
            }
          </div>
          <div className="stat-tile__detail">Past the declared due date</div>
        </div>
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Open appeals</span>
          </div>
          <div className="stat-tile__value">{openAppeals.length}</div>
          <div className="stat-tile__detail">
            {appealList.filter((appeal) => appeal.status === "UNDER_REVIEW").length}{" "}
            under review
          </div>
        </div>
      </div>

      <Tabs
        items={[
          { id: "quality", label: "Data quality", count: issueList.length },
          { id: "appeals", label: "Appeals", count: appealList.length },
        ]}
        active={tab}
        onChange={setTab}
        label="Exception views"
      />

      <div className="tab-panel">
        {tab === "quality" ? (
          <Panel
            title="Data-quality issues"
            subtitle="Blocking issues gate formal calculations until resolved or waived"
            flush
          >
            {issues.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={issues.error} onRetry={issues.reload} />
              </div>
            ) : issues.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={5} />
              </div>
            ) : issueList.length === 0 ? (
              <EmptyState
                icon="shield"
                title="No data-quality issue"
                description="Issues are raised by ingestion, validations or the data-quality agent."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Issue</th>
                      <th>Object</th>
                      <th>Severity</th>
                      <th>Status</th>
                      <th>Due</th>
                      <th>Assignee</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {issueList.map((issue) => {
                      const overdue =
                        Boolean(issue.dueAt) &&
                        new Date(issue.dueAt as string).getTime() < Date.now() &&
                        issue.status !== "RESOLVED" &&
                        issue.status !== "WAIVED_WITH_APPROVAL";
                      return (
                        <tr key={issue.id}>
                          <td>
                            <span className="cell-primary">{issue.issueCode}</span>
                            <span className="cell-sub mono">
                              {shortId(issue.id, 10)}
                            </span>
                          </td>
                          <td>
                            {titleCase(issue.objectType)}
                            <span className="cell-sub mono">
                              {shortId(issue.objectId, 10)}
                            </span>
                          </td>
                          <td>
                            <Badge
                              tone={
                                issue.severity === "BLOCKING"
                                  ? "danger"
                                  : issue.severity === "WARNING"
                                    ? "warning"
                                    : "neutral"
                              }
                            >
                              {issue.severity}
                            </Badge>
                          </td>
                          <td>
                            <Badge status={issue.status} />
                            {issue.escalatedAt ? (
                              <span className="cell-sub text-danger">Escalated</span>
                            ) : null}
                          </td>
                          <td className={overdue ? "text-danger nowrap" : "nowrap"}>
                            {issue.dueAt ? formatDate(issue.dueAt) : "—"}
                          </td>
                          <td>
                            {issue.assignedTo
                              ? displayName(issue.assignedTo, people)
                              : "—"}
                          </td>
                          <td className="cell-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => openDq(issue)}
                              disabled={!DQ_COMMANDS[issue.status]}
                            >
                              Command
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : (
          <Panel
            title="Appeals"
            subtitle="Open → triaged → under review → decided"
            flush
          >
            {appeals.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={appeals.error} onRetry={appeals.reload} />
              </div>
            ) : appeals.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={4} />
              </div>
            ) : appealList.length === 0 ? (
              <EmptyState
                icon="approvals"
                title="No appeal"
                description="Employees can challenge attribution, evaluation or ledger outcomes."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Appeal</th>
                      <th>Appellant</th>
                      <th>Target</th>
                      <th>Status</th>
                      <th>Due</th>
                      <th>Reviewer</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {appealList.map((appeal) => (
                      <tr key={appeal.id}>
                        <td>
                          <span className="cell-primary">
                            {appeal.reasonCode}
                          </span>
                          <span className="cell-sub">
                            {appeal.statement.slice(0, 80)}
                          </span>
                        </td>
                        <td>{displayName(appeal.appellantPersonId, people)}</td>
                        <td>
                          {titleCase(appeal.targetType)}
                          <span className="cell-sub mono">
                            {shortId(appeal.targetId, 10)}
                          </span>
                        </td>
                        <td>
                          <Badge status={appeal.status} />
                          <span className="cell-sub">
                            opened {formatRelative(appeal.createdAt)}
                          </span>
                        </td>
                        <td
                          className={
                            appeal.dueAt &&
                            new Date(appeal.dueAt).getTime() < Date.now() &&
                            !["CLOSED", "DECIDED"].includes(appeal.status)
                              ? "text-danger nowrap"
                              : "nowrap"
                          }
                        >
                          {appeal.dueAt ? formatDate(appeal.dueAt) : "No SLA"}
                        </td>
                        <td>
                          {appeal.reviewerPersonId
                            ? displayName(appeal.reviewerPersonId, people)
                            : "—"}
                        </td>
                        <td className="cell-actions">
                          {["OPEN", "TRIAGED", "UNDER_REVIEW"].includes(
                            appeal.status,
                          ) ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => openAppeal(appeal)}
                            >
                              {appeal.status === "OPEN"
                                ? "Triage"
                                : appeal.status === "TRIAGED"
                                  ? "Review"
                                  : "Resolve"}
                            </Button>
                          ) : (
                            <span className="subtle">
                              {appeal.resolution ?? "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}
      </div>

      <Modal
        open={Boolean(dqTarget)}
        title="Data-quality command"
        description={
          dqTarget ? `${dqTarget.issueCode} · ${titleCase(dqTarget.status)}` : undefined
        }
        onClose={() => setDqTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDqTarget(null)}>
              Cancel
            </Button>
            <Button
              variant={dqCommand === "WAIVE" ? "danger" : "primary"}
              onClick={executeDq}
              loading={submitting}
            >
              {DQ_COMMAND_COPY[dqCommand]}
            </Button>
          </>
        }
      >
        {dqTarget ? (
          <div className="stack">
            {dqError ? (
              <InfoNotice tone="warning">{dqError}</InfoNotice>
            ) : null}
            <DefinitionList
              items={[
                { label: "Object", value: `${titleCase(dqTarget.objectType)} ${shortId(dqTarget.objectId, 12)}` },
                { label: "Severity", value: dqTarget.severity },
                { label: "Status", value: <Badge status={dqTarget.status} /> },
                {
                  label: "Due",
                  value: dqTarget.dueAt ? formatDateTime(dqTarget.dueAt) : "—",
                },
              ]}
            />
            <div className="form-grid">
              <FormField label="Command" htmlFor="dq-command">
                <Select
                  id="dq-command"
                  value={dqCommand}
                  onChange={(event) =>
                    setDqCommand(event.target.value as DqCommand)
                  }
                >
                  {(DQ_COMMANDS[dqTarget.status] ?? []).map((command) => (
                    <option key={command} value={command}>
                      {DQ_COMMAND_COPY[command]}
                    </option>
                  ))}
                </Select>
              </FormField>
              {dqCommand === "ASSIGN" ? (
                <FormField label="Assign to" htmlFor="dq-assignee">
                  <PersonSelect
                    id="dq-assignee"
                    value={assignee}
                    onChange={setAssignee}
                  />
                </FormField>
              ) : null}
              {["WAIVE", "ESCALATE", "REOPEN"].includes(dqCommand) ? (
                <>
                  <FormField label="Actor" htmlFor="dq-actor">
                    <PersonSelect
                      id="dq-actor"
                      value={dqActor}
                      onChange={setDqActor}
                    />
                  </FormField>
                  <FormField
                    label={
                      dqCommand === "WAIVE" ? "Reason (required)" : "Reason"
                    }
                    htmlFor="dq-reason"
                    className="field--full"
                  >
                    <Textarea
                      id="dq-reason"
                      value={dqReason}
                      onChange={(event) => setDqReason(event.target.value)}
                    />
                  </FormField>
                </>
              ) : null}
            </div>
            {dqTarget.details && Object.keys(dqTarget.details).length > 0 ? (
              <div className="detail-section">
                <div className="detail-section__title">Details</div>
                <pre className="code-block">
                  {JSON.stringify(dqTarget.details, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(appealTarget)}
        title={
          appealTarget
            ? appealTarget.status === "OPEN"
              ? "Triage appeal"
              : appealTarget.status === "TRIAGED"
                ? "Start appeal review"
                : "Resolve appeal"
            : ""
        }
        description="The reviewer must be independent of the appellant."
        onClose={() => setAppealTarget(null)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setAppealTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={executeAppeal} loading={submitting}>
              {appealTarget?.status === "OPEN"
                ? "Triage"
                : appealTarget?.status === "TRIAGED"
                  ? "Start review"
                  : "Resolve"}
            </Button>
          </>
        }
      >
        {appealTarget ? (
          <div className="stack">
            {appealError ? (
              <InfoNotice tone="warning">{appealError}</InfoNotice>
            ) : null}
            <div className="reason-box">{appealTarget.statement}</div>
            <DefinitionList
              items={[
                {
                  label: "Appellant",
                  value: displayName(appealTarget.appellantPersonId, people),
                },
                {
                  label: "Target",
                  value: `${titleCase(appealTarget.targetType)} ${shortId(appealTarget.targetId, 12)}`,
                },
                { label: "Status", value: <Badge status={appealTarget.status} /> },
                {
                  label: "SLA due",
                  value: appealTarget.dueAt
                    ? formatDateTime(appealTarget.dueAt)
                    : "No SLA recorded",
                },
              ]}
            />
            {appealTarget.evidenceRefs && appealTarget.evidenceRefs.length > 0 ? (
              <div className="chip-row">
                {appealTarget.evidenceRefs.map((reference) => (
                  <span className="chip" key={reference}>
                    {reference}
                  </span>
                ))}
              </div>
            ) : null}
            {appealTarget.status !== "TRIAGED" ? (
              <FormField label="Reviewer" htmlFor="appeal-reviewer">
                <PersonSelect
                  id="appeal-reviewer"
                  value={reviewer}
                  onChange={setReviewer}
                />
              </FormField>
            ) : null}
            {reviewer === appealTarget.appellantPersonId ? (
              <InfoNotice tone="warning">
                The appellant cannot review their own appeal. Choose an
                independent reviewer.
              </InfoNotice>
            ) : null}
            {appealTarget.status === "UNDER_REVIEW" ? (
              <div className="form-grid">
                <FormField label="Resolution" htmlFor="appeal-resolution">
                  <Select
                    id="appeal-resolution"
                    value={resolution}
                    onChange={(event) =>
                      setResolution(
                        event.target.value as "UPHOLD" | "CHANGE" | "REJECT",
                      )
                    }
                  >
                    <option value="UPHOLD">Uphold the original decision</option>
                    <option value="CHANGE">Change the decision</option>
                    <option value="REJECT">Reject the appeal</option>
                  </Select>
                </FormField>
                <FormField
                  label="Rationale"
                  htmlFor="appeal-rationale"
                  className="field--full"
                >
                  <Textarea
                    id="appeal-rationale"
                    value={appealRationale}
                    onChange={(event) => setAppealRationale(event.target.value)}
                    required
                  />
                </FormField>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
