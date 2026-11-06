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
  { id: "PENDING", label: "待处理" },
  { id: "APPROVED", label: "已批准" },
  { id: "REJECTED", label: "已驳回" },
  { id: "ALL", label: "全部" },
];

function riskTone(riskTier: string): "neutral" | "warning" | "danger" {
  const tier = riskTier.toUpperCase();
  if (tier === "T3" || tier === "CRITICAL" || tier === "HIGH") return "danger";
  if (tier === "T2" || tier === "MEDIUM") return "warning";
  return "neutral";
}

export function ApprovalsPage() {
  useDocumentTitle("审批");
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
      setActionError("驳回时必须填写理由。");
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
            : "无法记录决策。",
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
            : "无法消费审批。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="人工门禁"
        title="审批"
        description="高风险动作在此等待。决策前核对负载哈希、风险级与审批数——审批只追加、归属到人。"
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => approvals.reload()}
            loading={approvals.loading}
          >
            刷新
          </Button>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--warning">
          <div className="stat-tile__top">
            <span className="stat-tile__label">等待决策</span>
          </div>
          <div className="stat-tile__value">{pending}</div>
          <div className="stat-tile__detail">跨全部动作类型</div>
        </div>
        <div className="stat-tile stat-tile--critical">
          <div className="stat-tile__top">
            <span className="stat-tile__label">T2 及以上</span>
          </div>
          <div className="stat-tile__value">{highRisk}</div>
          <div className="stat-tile__detail">需资深复核人</div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">已批准</span>
          </div>
          <div className="stat-tile__value">{counts.APPROVED}</div>
          <div className="stat-tile__detail">可消费或已消费</div>
        </div>
      </div>

      <Panel
        title="审批台账"
        subtitle="每个门禁保留目标版本与负载哈希"
        action={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="搜索动作、对象或 ID"
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
          label="审批状态"
        />

        <div className="tab-panel">
          {approvals.error ? (
            <ErrorNotice error={approvals.error} onRetry={approvals.reload} />
          ) : approvals.loading ? (
            <LoadingRows rows={5} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon="approvals"
              title={tab === "PENDING" ? "Nothing waiting" : "当前视图暂无请求"}
              description={
                tab === "PENDING"
                  ? "审批队列为空。新的受门禁动作会自动进入此处。"
                  : "换个状态或清空搜索试试。"
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>操作</th>
                    <th>对象</th>
                    <th>风险</th>
                    <th>审批</th>
                    <th>已发起</th>
                    <th>状态</th>
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
                            复核
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
                            消费
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
        title="复核审批请求"
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
              取消
            </Button>
            <Button
              variant={decision === "REJECT" ? "danger" : "primary"}
              onClick={submitDecision}
              loading={submitting}
            >
              {decision === "REJECT" ? "驳回请求" : "批准请求"}
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
                { label: "操作", value: titleCase(selected.actionType) },
                {
                  label: "对象",
                  value: (
                    <span>
                      {titleCase(selected.targetType)} ·{" "}
                      <span className="mono">{shortId(selected.targetId, 12)}</span> · v
                      {selected.targetVersion}
                    </span>
                  ),
                },
                {
                  label: "负载哈希",
                  value: <span className="mono">{selected.payloadHash}</span>,
                },
                {
                  label: "审批",
                  value: `${selected.approvedCount} of ${selected.requiredApprovals}`,
                },
                {
                  label: "已发起",
                  value: `${formatDateTime(selected.createdAt)} · ${selected.requestedByType}`,
                },
              ]}
            />

            <div className="detail-section">
              <div className="detail-section__title">历史决策</div>
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
                <p className="muted">暂无决策记录。</p>
              )}
            </div>

            <div className="form-grid">
              <FormField label="决策" htmlFor="approval-decision">
                <Select
                  id="approval-decision"
                  value={decision}
                  onChange={(event) =>
                    setDecision(event.target.value as "APPROVE" | "REJECT")
                  }
                >
                  <option value="APPROVE">批准</option>
                  <option value="REJECT">驳回</option>
                </Select>
              </FormField>
              <FormField
                label="审批人"
                htmlFor="approval-approver"
                hint="贡献认定将记录到该人员名下。"
              >
                <PersonSelect
                  id="approval-approver"
                  value={approver}
                  onChange={setApprover}
                />
              </FormField>
              <FormField
                label={decision === "REJECT" ? "原因（必填）" : "原因（可选）"}
                htmlFor="approval-reason"
                className="field--full"
              >
                <Textarea
                  id="approval-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="为审计留痕填写决策说明…"
                />
              </FormField>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(consumeTarget)}
        title="消费审批"
        description="消费会把本审批绑定到一个动作，不可复用。"
        onClose={() => setConsumeTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConsumeTarget(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={consume} loading={submitting}>
              消费审批
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
                { label: "操作", value: titleCase(consumeTarget.actionType) },
                { label: "对象", value: shortId(consumeTarget.targetId, 16) },
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
