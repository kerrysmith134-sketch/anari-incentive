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
  Textarea,
  TextInput,
} from "../components/ui.js";
import { PersonSelect, usePeople } from "../components/PersonSelect.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  displayName,
  formatDate,
  formatDateTime,
  shortId,
  titleCase,
  toIsoDate,
} from "../lib/format.js";
import type {
  AdverseActionCase,
  AdverseActionType,
} from "../lib/types.js";

const ACTION_TYPES: AdverseActionType[] = [
  "PIP",
  "TRAINING",
  "REASSIGNMENT",
  "DEMOTION",
  "PAY_REDUCTION",
  "TERMINATION",
];

type ActionKind = "review" | "approve" | "activate" | "complete" | "cancel";

export function AdverseActionsPage() {
  useDocumentTitle("Adverse actions");
  const { session } = useAuth();
  const toast = useToast();
  const { people } = usePeople();
  const actions = useApiQuery<AdverseActionCase[]>("/api/v1/adverse-actions");
  const [createOpen, setCreateOpen] = useState(false);
  const [personId, setPersonId] = useState("");
  const [actionType, setActionType] = useState<AdverseActionType>("PIP");
  const [reason, setReason] = useState("");
  const [performanceBasis, setPerformanceBasis] = useState("");
  const [evidenceRefs, setEvidenceRefs] = useState("");
  const [requestedBy, setRequestedBy] = useState(session.personId);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<AdverseActionCase | null>(null);
  const [action, setAction] = useState<{
    kind: ActionKind;
    record: AdverseActionCase;
  } | null>(null);
  const [legalReviewer, setLegalReviewer] = useState(session.personId);
  const [legalReviewRef, setLegalReviewRef] = useState("");
  const [reviewDecision, setReviewDecision] = useState<"APPROVE" | "REJECT">(
    "APPROVE",
  );
  const [approver, setApprover] = useState(session.personId);
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [cancelReason, setCancelReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const list = actions.data ?? [];

  function openCreate() {
    setPersonId(people[0]?.id ?? session.personId);
    setActionType("PIP");
    setReason("");
    setPerformanceBasis("");
    setEvidenceRefs("");
    setRequestedBy(session.personId);
    setFormError(null);
    setCreateOpen(true);
  }

  async function createCase(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api("/api/v1/adverse-actions", {
        method: "POST",
        body: {
          personId,
          actionType,
          reason: reason.trim(),
          performanceBasis: performanceBasis.trim(),
          evidenceRefs: evidenceRefs
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          requestedBy,
        },
      });
      toast.success("Adverse-action case opened", actionType);
      setCreateOpen(false);
      actions.reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Could not open the case.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function openAction(kind: ActionKind, record: AdverseActionCase) {
    setAction({ kind, record });
    setLegalReviewer(session.personId);
    setLegalReviewRef("");
    setReviewDecision("APPROVE");
    setApprover(session.personId);
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setCancelReason("");
    setActionError(null);
  }

  async function executeAction() {
    if (!action) return;
    const { kind, record } = action;
    setSubmitting(true);
    setActionError(null);
    try {
      let path = "";
      let body: unknown;
      if (kind === "review") {
        path = "legal-review";
        body = {
          legalReviewerId: legalReviewer,
          legalReviewRef: legalReviewRef.trim(),
          decision: reviewDecision,
        };
      } else if (kind === "approve") {
        path = "approve";
        body = { approvedBy: approver };
      } else if (kind === "activate") {
        path = "activate";
        body = { effectiveFrom: toIsoDate(effectiveFrom) };
      } else if (kind === "cancel") {
        path = "cancel";
        body = { reason: cancelReason.trim() };
      } else {
        path = "complete";
      }
      await api(`/api/v1/adverse-actions/${record.id}/${path}`, {
        method: "POST",
        body,
      });
      toast.success(
        kind === "review"
          ? "Legal review recorded"
          : kind === "approve"
            ? "Case approved"
            : kind === "activate"
              ? "Case activated"
              : kind === "complete"
                ? "Case completed"
                : "Case cancelled",
        shortId(record.id),
      );
      setAction(null);
      actions.reload();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "The action failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Human-only HR safeguard"
        title="Adverse actions"
        description="PIP, training/reassignment, demotion, pay reduction and termination are opened and decided by people, never auto-triggered by a score. Legal review and approval must be performed by different people."
        actions={
          <>
            <Button
              variant="secondary"
              icon="refresh"
              onClick={actions.reload}
              loading={actions.loading}
            >
              Refresh
            </Button>
            <Button variant="primary" icon="plus" onClick={openCreate}>
              Open case
            </Button>
          </>
        }
      />

      <div className="notice notice--warning" style={{ marginBottom: 18 }}>
        <div>
          <strong>No automated pipeline writes to this module.</strong>
          <p>
            There is no evaluation-to-adverse-action automation. Opening a case
            requires a manager; legal review and approval each require a different
            person, and activation only happens after approval.
          </p>
        </div>
      </div>

      <Panel title="PIP / adverse-action cases" flush>
        {actions.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={actions.error} onRetry={actions.reload} />
          </div>
        ) : actions.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={4} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon="shield"
            title="No adverse-action case"
            description="Low scores never open this workflow automatically. A manager must explicitly open a case with a documented performance basis."
            action={
              <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                Open case
              </Button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Requester</th>
                  <th>Legal review</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <span className="cell-primary">
                        {displayName(record.personId, people)}
                      </span>
                      <span className="cell-sub mono">
                        {shortId(record.id, 10)}
                      </span>
                    </td>
                    <td>{titleCase(record.actionType)}</td>
                    <td>
                      <Badge status={record.status} />
                    </td>
                    <td>{displayName(record.requestedBy, people)}</td>
                    <td>
                      {record.legalReviewerId ? (
                        <>
                          {displayName(record.legalReviewerId, people)}
                          <span className="cell-sub">
                            {record.legalReviewRef}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="nowrap">
                      {formatDateTime(record.updatedAt)}
                    </td>
                    <td className="cell-actions">
                      <div className="row-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelected(record)}
                        >
                          Open
                        </Button>
                        {record.status === "DRAFT" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openAction("review", record)}
                          >
                            Legal review
                          </Button>
                        ) : null}
                        {record.status === "LEGAL_REVIEW" ? (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => openAction("approve", record)}
                          >
                            Approve
                          </Button>
                        ) : null}
                        {record.status === "APPROVED" ? (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => openAction("activate", record)}
                          >
                            Activate
                          </Button>
                        ) : null}
                        {record.status === "ACTIVE" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openAction("complete", record)}
                          >
                            Complete
                          </Button>
                        ) : null}
                        {["DRAFT", "LEGAL_REVIEW", "APPROVED", "ACTIVE"].includes(
                          record.status,
                        ) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openAction("cancel", record)}
                          >
                            Cancel
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
        open={createOpen}
        title="Open adverse-action case"
        description="This is a human/HR/legal process. The system records it; evaluation scores do not trigger it."
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
              form="create-adverse-action-form"
              loading={submitting}
            >
              Open case
            </Button>
          </>
        }
      >
        <form id="create-adverse-action-form" onSubmit={createCase} className="form-grid">
          {formError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{formError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="Person" htmlFor="adverse-person">
            <PersonSelect
              id="adverse-person"
              value={personId}
              onChange={setPersonId}
            />
          </FormField>
          <FormField label="Action type" htmlFor="adverse-type">
            <Select
              id="adverse-type"
              value={actionType}
              onChange={(event) =>
                setActionType(event.target.value as AdverseActionType)
              }
            >
              {ACTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Reason"
            htmlFor="adverse-reason"
            className="field--full"
          >
            <Textarea
              id="adverse-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="Performance basis"
            htmlFor="adverse-basis"
            className="field--full"
            hint="Prior review, coaching or documented facts; not a raw score alone."
          >
            <Textarea
              id="adverse-basis"
              value={performanceBasis}
              onChange={(event) => setPerformanceBasis(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="Evidence refs (comma separated)"
            htmlFor="adverse-evidence"
            className="field--full"
          >
            <TextInput
              id="adverse-evidence"
              value={evidenceRefs}
              onChange={(event) => setEvidenceRefs(event.target.value)}
            />
          </FormField>
          <FormField label="Requested by" htmlFor="adverse-requester">
            <PersonSelect
              id="adverse-requester"
              value={requestedBy}
              onChange={setRequestedBy}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(selected)}
        title={selected ? titleCase(selected.actionType) : "Case detail"}
        description={
          selected
            ? `${displayName(selected.personId, people)} · ${selected.status}`
            : undefined
        }
        onClose={() => setSelected(null)}
        wide
        footer={
          <Button variant="secondary" onClick={() => setSelected(null)}>
            Close
          </Button>
        }
      >
        {selected ? (
          <div className="stack">
            <DefinitionList
              items={[
                {
                  label: "Requested by",
                  value: displayName(selected.requestedBy, people),
                },
                {
                  label: "Legal reviewer",
                  value: selected.legalReviewerId
                    ? displayName(selected.legalReviewerId, people)
                    : "Pending",
                },
                {
                  label: "Approved by",
                  value: selected.approvedBy
                    ? displayName(selected.approvedBy, people)
                    : "Pending",
                },
                {
                  label: "Effective",
                  value: selected.effectiveFrom
                    ? formatDate(selected.effectiveFrom)
                    : "Not active",
                },
              ]}
            />
            <div className="detail-section">
              <div className="detail-section__title">Reason</div>
              <div className="reason-box">{selected.reason}</div>
            </div>
            <div className="detail-section">
              <div className="detail-section__title">Performance basis</div>
              <div className="reason-box">{selected.performanceBasis}</div>
            </div>
            {selected.cancelReason ? (
              <div className="detail-section">
                <div className="detail-section__title">Cancellation reason</div>
                <div className="reason-box">{selected.cancelReason}</div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(action)}
        title={
          action
            ? action.kind === "review"
              ? "Legal review"
              : action.kind === "approve"
                ? "Approve adverse action"
                : action.kind === "activate"
                  ? "Activate adverse action"
                  : action.kind === "complete"
                    ? "Complete adverse action"
                    : "Cancel adverse action"
            : ""
        }
        description={
          action
            ? `${titleCase(action.record.actionType)} · requester ${displayName(action.record.requestedBy, people)}`
            : undefined
        }
        onClose={() => setAction(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              variant={action?.kind === "cancel" ? "danger" : "primary"}
              onClick={executeAction}
              loading={submitting}
            >
              Confirm
            </Button>
          </>
        }
      >
        {action ? (
          <div className="stack">
            {actionError ? (
              <InfoNotice tone="warning">{actionError}</InfoNotice>
            ) : null}
            {action.kind === "review" ? (
              <div className="form-grid">
                <FormField label="Decision" htmlFor="adverse-review-decision">
                  <Select
                    id="adverse-review-decision"
                    value={reviewDecision}
                    onChange={(event) =>
                      setReviewDecision(
                        event.target.value as "APPROVE" | "REJECT",
                      )
                    }
                  >
                    <option value="APPROVE">Pass legal review</option>
                    <option value="REJECT">Reject at legal review</option>
                  </Select>
                </FormField>
                <FormField label="Legal reviewer" htmlFor="adverse-reviewer">
                  <PersonSelect
                    id="adverse-reviewer"
                    value={legalReviewer}
                    onChange={setLegalReviewer}
                  />
                </FormField>
                <FormField
                  label="Legal review reference"
                  htmlFor="adverse-review-ref"
                  className="field--full"
                >
                  <TextInput
                    id="adverse-review-ref"
                    value={legalReviewRef}
                    onChange={(event) => setLegalReviewRef(event.target.value)}
                    required
                  />
                </FormField>
              </div>
            ) : null}
            {action.kind === "approve" ? (
              <FormField label="Approved by" htmlFor="adverse-approver">
                <PersonSelect
                  id="adverse-approver"
                  value={approver}
                  onChange={setApprover}
                />
              </FormField>
            ) : null}
            {action.kind === "activate" ? (
              <FormField label="Effective date" htmlFor="adverse-effective">
                <TextInput
                  id="adverse-effective"
                  type="date"
                  value={effectiveFrom}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                  required
                />
              </FormField>
            ) : null}
            {action.kind === "cancel" ? (
              <FormField label="Cancellation reason" htmlFor="adverse-cancel">
                <Textarea
                  id="adverse-cancel"
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  required
                />
              </FormField>
            ) : null}
            {action.kind === "complete" ? (
              <InfoNotice>
                Completion closes the case. No new action is taken automatically.
              </InfoNotice>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
