/**
 * 会计期间关闭/重开：双人审批工作台。
 * 请求人创建 PENDING；另一名财务/管理员批准后才执行。
 */
import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  Panel,
  Select,
  TextInput,
} from "../ui.js";
import { api, ApiError } from "../../lib/api.js";
import { useApiQuery } from "../../lib/hooks.js";
import { useAuth } from "../../contexts/AuthContext.js";
import { useToast } from "../../contexts/ToastContext.js";
import { displayName, formatDateTime } from "../../lib/format.js";
import { usePeople } from "../PersonSelect.js";

interface AccountingPeriodView {
  id: string;
  legalEntityId: string;
  period: string;
  status: "OPEN" | "CLOSED";
  closedAt?: string;
  reopeningRef?: string | null;
}

interface ChangeRequestView {
  id: string;
  legalEntityId: string;
  period: string;
  action: "CLOSE" | "REOPEN";
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedBy: string;
  requestedAt: string;
  reason?: string | null;
  reopeningRef?: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
}

interface ApproverView {
  tenantId: string;
  personId: string;
  active: boolean;
  createdAt: string;
  displayName?: string;
}

interface ApproverResolution {
  approvers: ApproverView[];
  source: "DIRECTORY" | "ROLE_FALLBACK";
}

export function AccountingPeriodPanel() {
  const { session } = useAuth();
  const toast = useToast();
  const { people } = usePeople();
  const periods = useApiQuery<AccountingPeriodView[]>("/api/v1/accounting-periods");
  const pending = useApiQuery<ChangeRequestView[]>(
    "/api/v1/accounting-periods/change-requests?status=PENDING",
  );
  const approvers = useApiQuery<ApproverResolution>(
    "/api/v1/accounting-period-approvers",
  );
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"CLOSE" | "REOPEN">("CLOSE");
  const [legalEntityId, setLegalEntityId] = useState("");
  const [period, setPeriod] = useState("");
  const [reason, setReason] = useState("");
  const [reopeningRef, setReopeningRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedApprovers, setSelectedApprovers] = useState<string[]>([]);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [savingApprovers, setSavingApprovers] = useState(false);

  const effectiveApprovers = approvers.data?.approvers ?? [];

  function notifiedCount(request: ChangeRequestView): number {
    // 创建请求时通知除请求人外的全部有效审批人。
    return effectiveApprovers.filter(
      (approver) => approver.personId !== request.requestedBy,
    ).length;
  }

  function openApproverEditor() {
    setSelectedApprovers(effectiveApprovers.map((approver) => approver.personId));
    setEditorError(null);
    setEditorOpen(true);
  }

  async function saveApprovers(event: FormEvent) {
    event.preventDefault();
    if (selectedApprovers.length === 0) {
      setEditorError("至少选择 1 名审批人");
      return;
    }
    setSavingApprovers(true);
    setEditorError(null);
    try {
      await api("/api/v1/accounting-period-approvers", {
        method: "PUT",
        body: { personIds: selectedApprovers },
      });
      toast.success("审批人已更新");
      setEditorOpen(false);
      approvers.reload();
    } catch (caught) {
      setEditorError(
        caught instanceof ApiError ? caught.message : "保存审批人失败",
      );
    } finally {
      setSavingApprovers(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(
        action === "CLOSE"
          ? "/api/v1/accounting-periods/close"
          : "/api/v1/accounting-periods/reopen",
        {
          method: "POST",
          body: {
            legalEntityId,
            period,
            actorPersonId: session.personId,
            reason: reason || undefined,
            reopeningRef: action === "REOPEN" ? reopeningRef : undefined,
          },
        },
      );
      toast.success("变更请求已提交", "需另一名财务/管理员批准后执行。");
      setOpen(false);
      setReason("");
      setReopeningRef("");
      pending.reload();
      periods.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, decision: "APPROVE" | "REJECT") {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/accounting-periods/change-requests/${id}/decide`, {
        method: "POST",
        body: {
          decision,
          approverPersonId: session.personId,
          note: decision === "APPROVE" ? "approved in finance workbench" : "rejected",
        },
      });
      toast.success(decision === "APPROVE" ? "已批准并执行" : "已驳回");
      pending.reload();
      periods.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "审批失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="会计期间"
      subtitle="关闭/重开需双人审批：请求人与审批人不得为同一人"
      action={
        <Button size="sm" variant="secondary" icon="plus" onClick={() => setOpen(true)}>
          发起变更
        </Button>
      }
    >
      {error ? (
        <div style={{ marginBottom: 12 }}>
          <InfoNotice tone="warning">{error}</InfoNotice>
        </div>
      ) : null}

      {periods.error ? (
        <ErrorNotice error={periods.error} onRetry={periods.reload} />
      ) : periods.loading ? (
        <LoadingRows rows={2} />
      ) : (periods.data ?? []).length === 0 ? (
        <EmptyState
          icon="clock"
          title="暂无会计期间"
          description="首次 POSTED 财务事实会自动开期；也可直接发起关闭。"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>法人</th>
                <th>期间</th>
                <th>状态</th>
                <th>关闭时间</th>
                <th>重开凭证</th>
              </tr>
            </thead>
            <tbody>
              {(periods.data ?? []).map((entry) => (
                <tr key={entry.id}>
                  <td className="mono">{entry.legalEntityId}</td>
                  <td className="mono">{entry.period}</td>
                  <td><Badge status={entry.status} /></td>
                  <td>{entry.closedAt ? formatDateTime(entry.closedAt) : "—"}</td>
                  <td className="mono">{entry.reopeningRef ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="detail-section" style={{ marginTop: 20 }}>
        <div className="detail-section__title">期间审批人</div>
        {approvers.error ? (
          <ErrorNotice error={approvers.error} onRetry={approvers.reload} />
        ) : approvers.loading ? (
          <LoadingRows rows={1} />
        ) : effectiveApprovers.length === 0 ? (
          <p className="muted">
            目录为空且没有可回退的 admin/finance 人员；期间变更仍可提交。
          </p>
        ) : (
          <>
            <div className="chip-row">
              {effectiveApprovers.map((approver) => (
                <span className="chip" key={approver.personId}>
                  {approver.displayName ??
                    displayName(approver.personId, people)}
                </span>
              ))}
            </div>
            {approvers.data?.source === "ROLE_FALLBACK" ? (
              <p className="muted" style={{ marginTop: 8 }}>
                目录为空，当前按租户 admin/finance 角色回退；保存目录后以目录为准。
              </p>
            ) : null}
          </>
        )}
        <div className="row-actions" style={{ marginTop: 10 }}>
          <Button size="sm" variant="secondary" onClick={openApproverEditor}>
            编辑审批人
          </Button>
          <Button size="sm" variant="ghost" onClick={approvers.reload}>
            刷新
          </Button>
        </div>
      </div>

      <div className="detail-section" style={{ marginTop: 20 }}>
        <div className="detail-section__title">
          待审批请求（{(pending.data ?? []).length}）
        </div>
        {pending.error ? (
          <ErrorNotice error={pending.error} onRetry={pending.reload} />
        ) : pending.loading ? (
          <LoadingRows rows={2} />
        ) : (pending.data ?? []).length === 0 ? (
          <p className="muted">没有待审批的期间变更。</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>动作</th>
                  <th>法人 / 期间</th>
                  <th>请求人</th>
                  <th>原因</th>
                  <th>通知</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {(pending.data ?? []).map((request) => (
                  <tr key={request.id}>
                    <td><Badge status={request.action} /></td>
                    <td className="mono">
                      {request.legalEntityId} / {request.period}
                    </td>
                    <td className="mono">{request.requestedBy.slice(0, 8)}</td>
                    <td>{request.reason ?? "—"}</td>
                    <td>已通知 {notifiedCount(request)} 人</td>
                    <td>
                      <div className="row-actions">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void decide(request.id, "APPROVE")}
                        >
                          批准
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void decide(request.id, "REJECT")}
                        >
                          驳回
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={open}
        title="发起会计期间变更"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" type="submit" form="period-change-form" loading={busy}>
              提交审批
            </Button>
          </>
        }
      >
        <form id="period-change-form" onSubmit={submit}>
          <FormField label="动作" htmlFor="period-action">
            <Select
              id="period-action"
              value={action}
              onChange={(event) => setAction(event.target.value as "CLOSE" | "REOPEN")}
            >
              <option value="CLOSE">关闭期间</option>
              <option value="REOPEN">重开期间</option>
            </Select>
          </FormField>
          <FormField label="法人主体" htmlFor="period-legal-entity">
            <TextInput
              id="period-legal-entity"
              value={legalEntityId}
              required
              onChange={(event) => setLegalEntityId(event.target.value)}
            />
          </FormField>
          <FormField label="会计期间" hint="YYYY-MM" htmlFor="period-value">
            <TextInput
              id="period-value"
              value={period}
              required
              placeholder="2026-10"
              onChange={(event) => setPeriod(event.target.value)}
            />
          </FormField>
          {action === "REOPEN" ? (
            <FormField label="重开凭证号" htmlFor="period-reopening-ref">
              <TextInput
                id="period-reopening-ref"
                value={reopeningRef}
                required
                onChange={(event) => setReopeningRef(event.target.value)}
              />
            </FormField>
          ) : null}
          <FormField label="原因" htmlFor="period-reason">
            <TextInput
              id="period-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={editorOpen}
        title="编辑会计期间审批人"
        onClose={() => setEditorOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="period-approver-form"
              loading={savingApprovers}
              disabled={selectedApprovers.length === 0}
            >
              保存审批人
            </Button>
          </>
        }
      >
        <form id="period-approver-form" onSubmit={saveApprovers}>
          <p className="muted">
            至少选择 1 名审批人；仅同租户在职人员可被选中。变更后新请求会通知这些人。
          </p>
          {editorError ? (
            <div style={{ marginBottom: 12 }}>
              <InfoNotice tone="warning">{editorError}</InfoNotice>
            </div>
          ) : null}
          {people.filter(
            (person) => person.employmentStatus !== "INACTIVE",
          ).length === 0 ? (
            <p className="muted">没有可选的同租户在职人员。</p>
          ) : (
            <div className="stack">
              {people
                .filter((person) => person.employmentStatus !== "INACTIVE")
                .map((person) => (
                  <label className="checkbox" key={person.id}>
                    <input
                      type="checkbox"
                      checked={selectedApprovers.includes(person.id)}
                      onChange={(event) =>
                        setSelectedApprovers((current) =>
                          event.target.checked
                            ? [...current, person.id]
                            : current.filter((id) => id !== person.id),
                        )
                      }
                    />
                    <span>
                      {person.employeeCode} · {person.displayName}
                    </span>
                  </label>
                ))}
            </div>
          )}
        </form>
      </Modal>
    </Panel>
  );
}
