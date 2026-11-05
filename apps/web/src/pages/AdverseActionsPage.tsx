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
  useDocumentTitle("不利决定");
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
      toast.success("不利决定案件已发起", actionType);
      setCreateOpen(false);
      actions.reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "无法发起案件。",
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
                ? "案件已完结"
                : "Case cancelled",
        shortId(record.id),
      );
      setAction(null);
      actions.reload();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "操作失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="仅人工的 HR 保障流程"
        title="不利决定"
        description="PIP, training/reassignment, demotion, pay reduction and termination are opened and decided by people, never auto-triggered by a score. Legal review and approval must be performed by different people."
        actions={
          <>
            <Button
              variant="secondary"
              icon="refresh"
              onClick={actions.reload}
              loading={actions.loading}
            >
              刷新
            </Button>
            <Button variant="primary" icon="plus" onClick={openCreate}>
              发起案件
            </Button>
          </>
        }
      />

      <div className="notice notice--warning" style={{ marginBottom: 18 }}>
        <div>
          <strong>没有任何自动化流水线写入本模块。</strong>
          <p>
            There is no evaluation-to-adverse-action automation. Opening a case
            requires a manager; legal review and approval each require a different
            person, and activation only happens after approval.
          </p>
        </div>
      </div>

      <Panel title="PIP / 不利决定案件" flush>
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
            description="低分绝不会自动打开本流程；必须由经理基于书面绩效依据显式发起。"
            action={
              <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                发起案件
              </Button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>人员</th>
                  <th>操作</th>
                  <th>状态</th>
                  <th>发起人</th>
                  <th>法律复核</th>
                  <th>更新时间</th>
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
                          待处理
                        </Button>
                        {record.status === "DRAFT" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openAction("review", record)}
                          >
                            法律复核
                          </Button>
                        ) : null}
                        {record.status === "LEGAL_REVIEW" ? (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => openAction("approve", record)}
                          >
                            批准
                          </Button>
                        ) : null}
                        {record.status === "APPROVED" ? (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => openAction("activate", record)}
                          >
                            激活
                          </Button>
                        ) : null}
                        {record.status === "ACTIVE" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openAction("complete", record)}
                          >
                            完成
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
                            取消
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
        title="发起不利决定案件"
        description="这是人工/HR/法务流程；系统仅作记录，评分不会自动触发。"
        onClose={() => setCreateOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-adverse-action-form"
              loading={submitting}
            >
              发起案件
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
          <FormField label="人员" htmlFor="adverse-person">
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
            label="原因"
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
            label="绩效依据"
            htmlFor="adverse-basis"
            className="field--full"
            hint="依据：事先复核、辅导或有记录的事实；绝不只凭原始分数。"
          >
            <Textarea
              id="adverse-basis"
              value={performanceBasis}
              onChange={(event) => setPerformanceBasis(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="证据引用（逗号分隔）"
            htmlFor="adverse-evidence"
            className="field--full"
          >
            <TextInput
              id="adverse-evidence"
              value={evidenceRefs}
              onChange={(event) => setEvidenceRefs(event.target.value)}
            />
          </FormField>
          <FormField label="发起人" htmlFor="adverse-requester">
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
            关闭
          </Button>
        }
      >
        {selected ? (
          <div className="stack">
            <DefinitionList
              items={[
                {
                  label: "发起人",
                  value: displayName(selected.requestedBy, people),
                },
                {
                  label: "法律复核人",
                  value: selected.legalReviewerId
                    ? displayName(selected.legalReviewerId, people)
                    : "待处理",
                },
                {
                  label: "批准人",
                  value: selected.approvedBy
                    ? displayName(selected.approvedBy, people)
                    : "待处理",
                },
                {
                  label: "生效",
                  value: selected.effectiveFrom
                    ? formatDate(selected.effectiveFrom)
                    : "Not active",
                },
              ]}
            />
            <div className="detail-section">
              <div className="detail-section__title">原因</div>
              <div className="reason-box">{selected.reason}</div>
            </div>
            <div className="detail-section">
              <div className="detail-section__title">绩效依据</div>
              <div className="reason-box">{selected.performanceBasis}</div>
            </div>
            {selected.cancelReason ? (
              <div className="detail-section">
                <div className="detail-section__title">取消原因</div>
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
              ? "法律复核"
              : action.kind === "approve"
                ? "批准不利决定"
                : action.kind === "activate"
                  ? "激活不利决定"
                  : action.kind === "complete"
                    ? "完结不利决定"
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
              取消
            </Button>
            <Button
              variant={action?.kind === "cancel" ? "danger" : "primary"}
              onClick={executeAction}
              loading={submitting}
            >
              确认
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
                <FormField label="决策" htmlFor="adverse-review-decision">
                  <Select
                    id="adverse-review-decision"
                    value={reviewDecision}
                    onChange={(event) =>
                      setReviewDecision(
                        event.target.value as "APPROVE" | "REJECT",
                      )
                    }
                  >
                    <option value="APPROVE">法律复核通过</option>
                    <option value="REJECT">法律复核驳回</option>
                  </Select>
                </FormField>
                <FormField label="法律复核人" htmlFor="adverse-reviewer">
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
              <FormField label="批准人" htmlFor="adverse-approver">
                <PersonSelect
                  id="adverse-approver"
                  value={approver}
                  onChange={setApprover}
                />
              </FormField>
            ) : null}
            {action.kind === "activate" ? (
              <FormField label="生效日期" htmlFor="adverse-effective">
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
              <FormField label="取消原因" htmlFor="adverse-cancel">
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
                完结即关闭案件；不会自动采取任何新动作。
              </InfoNotice>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
