import { useEffect, useMemo, useState } from "react";
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
  SearchInput,
  Select,
  Tabs,
  Textarea,
} from "../components/ui.js";
import { PersonSelect } from "../components/PersonSelect.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  formatDateTime,
  formatRelative,
  shortId,
  titleCase,
} from "../lib/format.js";
import type {
  ApprovalDecision,
  ApprovalRequest,
} from "../lib/types.js";

const TABS = [
  { id: "PENDING", label: "Pending" },
  { id: "APPROVED", label: "Approved" },
  { id: "REJECTED", label: "Rejected" },
  { id: "ALL", label: "All" },
];

function riskTone(riskTier: string): "neutral" | "warning" | "danger" {
  const tier = riskTier.toUpperCase();
  if (tier === "T3" || tier === "CRITICAL" || tier === "HIGH") return "danger";
  if (tier === "T2" || tier === "MEDIUM") return "warning";
  return "neutral";
}

export function ApprovalsPage() {
  useDocumentTitle("Approvals");
  const { session } = useAuth();
  const toast = useToast();
  const approvals = useApiQuery<ApprovalRequest[]>("/api/v1/approval-requests");
  const [tab, setTab] = useState("PENDING");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ApprovalRequest | null>(null);
  const [consumeTarget, setConsumeTarget] = useState<ApprovalRequest | null>(
    null,
  );
  const [decision, setDecision] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [approver, setApprover] = useState(session.personId);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const decisions = useApiQuery<ApprovalDecision[]>(
    selected
      ? `/api/v1/approval-requests/${selected.id}/decisions`
      : null,
    selected?.id,
  );

  useEffect(() => {
    if (!selected) return;
    setDecision("APPROVE");
    setApprover(session.personId);
    setReason("");
    setActionError(null);
  }, [selected, session.personId]);

  const all = approvals.data ?? [];
  const counts = useMemo(
    () => ({
      PENDING: all.filter((item) => item.status === "PENDING").length,
      APPROVED: all.filter((item) => item.status === "APPROVED").length,
      REJECTED: all.filter((item) => item.status === "REJECTED").length,
      ALL: all.length,
    }),
    [all],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return all
      .filter((item) => tab === "ALL" || item.status === tab)
      .filter((item) => {
        if (!query) return true;
        return [
          item.actionType,
          item.targetType,
          item.targetId,
          item.riskTier,
          item.id,
          item.requestedById,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [all, tab, search]);

  const pending = counts.PENDING;
  const highRisk = all.filter(
    (item) =>
      item.status === "PENDING" &&
      ["T2", "T3", "HIGH", "CRITICAL"].includes(item.riskTier.toUpperCase()),
  ).length;

  async function submitDecision() {
    if (!selected) return;
    if (decision === "REJECT" && !reason.trim()) {
      setActionError("A reason is required when rejecting a request.");
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      await api(`/api/v1/approval-requests/${selected.id}/decide`, {
        method: "POST",
        body: {
          decision,
          approverPersonId: approver,
          payloadHash: selected.payloadHash,
          reason: reason.trim() || undefined,
          authContext: {},
        },
      });
      toast.success(
        decision === "APPROVE" ? "Approval recorded" : "Request rejected",
        `${titleCase(selected.actionType)} · ${shortId(selected.id)}`,
      );
      setSelected(null);
      approvals.reload();
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

  async function consume() {
    if (!consumeTarget) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await api(`/api/v1/approval-requests/${consumeTarget.id}/consume`, {
        method: "POST",
        body: { consumedBy: session.personId },
      });
      toast.success("Approval consumed", shortId(consumeTarget.id));
      setConsumeTarget(null);
      approvals.reload();
    } catch (caught) {
      setActionError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Could not consume the approval.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Human gates"
        title="Approvals"
        description="High-risk actions stop here. Review the payload hash, risk tier and approval count before deciding — approvals are append-only and attributed."
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => approvals.reload()}
            loading={approvals.loading}
          >
            Refresh
          </Button>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--warning">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Waiting for a decision</span>
          </div>
          <div className="stat-tile__value">{pending}</div>
          <div className="stat-tile__detail">Across all action types</div>
        </div>
        <div className="stat-tile stat-tile--critical">
          <div className="stat-tile__top">
            <span className="stat-tile__label">T2 and above</span>
          </div>
          <div className="stat-tile__value">{highRisk}</div>
          <div className="stat-tile__detail">Requires senior reviewer</div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Approved</span>
          </div>
          <div className="stat-tile__value">{counts.APPROVED}</div>
          <div className="stat-tile__detail">Ready to consume or already consumed</div>
        </div>
      </div>

      <Panel
        title="Request ledger"
        subtitle="Every gate keeps its target version and payload hash"
        action={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search action, target or id"
          />
        }
      >
        <Tabs
          items={TABS.map((item) => ({
            ...item,
            count: counts[item.id as keyof typeof counts],
          }))}
          active={tab}
          onChange={setTab}
          label="Approval status"
        />

        <div className="tab-panel">
          {approvals.error ? (
            <ErrorNotice error={approvals.error} onRetry={approvals.reload} />
          ) : approvals.loading ? (
            <LoadingRows rows={5} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon="approvals"
              title={tab === "PENDING" ? "Nothing waiting" : "No requests in this view"}
              description={
                tab === "PENDING"
                  ? "The approval queue is clear. New gated actions will land here automatically."
                  : "Try another status or clear the search."
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Target</th>
                    <th>Risk</th>
                    <th>Approvals</th>
                    <th>Requested</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((request) => (
                    <tr key={request.id}>
                      <td>
                        <span className="cell-primary">
                          {titleCase(request.actionType)}
                        </span>
                        <span className="cell-sub">
                          {request.requestedByType}
                          {request.requestedById
                            ? ` · ${shortId(request.requestedById)}`
                            : ""}
                        </span>
                      </td>
                      <td>
                        <span>{titleCase(request.targetType)}</span>
                        <span className="cell-sub">
                          <span className="cell-mono">{shortId(request.targetId, 12)}</span>
                          {" · v"}
                          {request.targetVersion}
                        </span>
                      </td>
                      <td>
                        <Badge
                          tone={riskTone(request.riskTier)}
                          dot={false}
                        >
                          {request.riskTier}
                        </Badge>
                      </td>
                      <td>
                        <span className="num">
                          {request.approvedCount}/{request.requiredApprovals}
                        </span>
                      </td>
                      <td>
                        <span>{formatRelative(request.createdAt)}</span>
                        <span className="cell-sub">
                          {request.expiresAt
                            ? `Expires ${formatDateTime(request.expiresAt)}`
                            : "No expiry"}
                        </span>
                      </td>
                      <td>
                        <Badge status={request.status} />
                      </td>
                      <td className="cell-actions">
                        {request.status === "PENDING" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setSelected(request)}
                          >
                            Review
                          </Button>
                        ) : request.status === "APPROVED" && !request.consumedAt ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setActionError(null);
                              setConsumeTarget(request);
                            }}
                          >
                            Consume
                          </Button>
                        ) : (
                          <span className="subtle">
                            {request.consumedAt ? "Consumed" : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>

      <Modal
        open={Boolean(selected)}
        title="Review approval request"
        description={
          selected
            ? `${titleCase(selected.actionType)} · ${selected.riskTier} risk`
            : undefined
        }
        onClose={() => setSelected(null)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button
              variant={decision === "REJECT" ? "danger" : "primary"}
              onClick={submitDecision}
              loading={submitting}
            >
              {decision === "REJECT" ? "Reject request" : "Approve request"}
            </Button>
          </>
        }
      >
        {selected ? (
          <div className="stack">
            {actionError ? (
              <InfoNotice tone="warning">{actionError}</InfoNotice>
            ) : null}
            <DefinitionList
              items={[
                { label: "Action", value: titleCase(selected.actionType) },
                {
                  label: "Target",
                  value: (
                    <span>
                      {titleCase(selected.targetType)} ·{" "}
                      <span className="mono">{shortId(selected.targetId, 12)}</span> · v
                      {selected.targetVersion}
                    </span>
                  ),
                },
                {
                  label: "Payload hash",
                  value: <span className="mono">{selected.payloadHash}</span>,
                },
                {
                  label: "Approvals",
                  value: `${selected.approvedCount} of ${selected.requiredApprovals}`,
                },
                {
                  label: "Requested",
                  value: `${formatDateTime(selected.createdAt)} · ${selected.requestedByType}`,
                },
              ]}
            />

            <div className="detail-section">
              <div className="detail-section__title">Prior decisions</div>
              {decisions.loading ? (
                <div className="loading-inline">
                  <span className="spinner" /> Loading decisions…
                </div>
              ) : decisions.data && decisions.data.length > 0 ? (
                <div className="stack" style={{ gap: 8 }}>
                  {decisions.data.map((item) => (
                    <div key={item.id} className="reason-box">
                      <div className="inline" style={{ justifyContent: "space-between" }}>
                        <strong>{item.decision}</strong>
                        <span className="subtle">
                          {formatDateTime(item.decidedAt)}
                        </span>
                      </div>
                      <div className="subtle mono">
                        {shortId(item.approverPersonId, 14)}
                      </div>
                      {item.reason ? <p style={{ marginTop: 4 }}>{item.reason}</p> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No decision recorded yet.</p>
              )}
            </div>

            <div className="form-grid">
              <FormField label="Decision" htmlFor="approval-decision">
                <Select
                  id="approval-decision"
                  value={decision}
                  onChange={(event) =>
                    setDecision(event.target.value as "APPROVE" | "REJECT")
                  }
                >
                  <option value="APPROVE">Approve</option>
                  <option value="REJECT">Reject</option>
                </Select>
              </FormField>
              <FormField
                label="Approver person"
                htmlFor="approval-approver"
                hint="Attribution is recorded against this person."
              >
                <PersonSelect
                  id="approval-approver"
                  value={approver}
                  onChange={setApprover}
                />
              </FormField>
              <FormField
                label={decision === "REJECT" ? "Reason (required)" : "Reason (optional)"}
                htmlFor="approval-reason"
                className="field--full"
              >
                <Textarea
                  id="approval-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Explain the decision for the audit trail…"
                />
              </FormField>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(consumeTarget)}
        title="Consume approval"
        description="Consumption binds this approval to one action. It cannot be reused."
        onClose={() => setConsumeTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConsumeTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={consume} loading={submitting}>
              Consume approval
            </Button>
          </>
        }
      >
        {consumeTarget ? (
          <div className="stack">
            {actionError ? (
              <InfoNotice tone="warning">{actionError}</InfoNotice>
            ) : null}
            <DefinitionList
              items={[
                { label: "Action", value: titleCase(consumeTarget.actionType) },
                { label: "Target", value: shortId(consumeTarget.targetId, 16) },
                {
                  label: "Consumed by",
                  value: <span className="mono">{session.personId}</span>,
                },
              ]}
            />
            <InfoNotice>
              Only consume this approval when you are executing the matching
              action now. The backend will reject a mismatched target or version.
            </InfoNotice>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
