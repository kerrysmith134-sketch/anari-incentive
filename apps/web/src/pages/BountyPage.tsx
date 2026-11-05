import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  EmptyState,
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
import { PersonSelect } from "../components/PersonSelect.js";
import { useToast } from "../contexts/ToastContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { api, ApiError } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";

interface BountyView {
  id: string;
  title: string;
  description: string;
  rewardAmount: string;
  currency: string;
  status: string;
  assigneePersonId?: string;
  createdBy: string;
  dueAt?: string;
}

type BountyAction = "claim" | "submit" | "accept" | "cancel";

/** 悬赏任务：发布 → 认领 → 提交 → 验收（验收人≠领受人）。 */
export function BountyPage() {
  useDocumentTitle("悬赏任务");
  const toast = useToast();
  const { session } = useAuth();
  const bounties = useApiQuery<BountyView[]>("/api/v1/bounties");

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reward, setReward] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [dueAt, setDueAt] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [action, setAction] = useState<{
    kind: BountyAction;
    bounty: BountyView;
  } | null>(null);
  const [actionPerson, setActionPerson] = useState(session.personId);
  const [submissionRef, setSubmissionRef] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const bountyList = bounties.data ?? [];
  const statusLabel: Record<string, string> = {
    OPEN: "待认领",
    CLAIMED: "已认领",
    SUBMITTED: "已提交",
    ACCEPTED: "已验收",
    CANCELLED: "已取消",
  };

  async function createBounty(event: FormEvent) {
    event.preventDefault();
    setCreateError(null);
    setSaving(true);
    try {
      await api("/api/v1/bounties", {
        method: "POST",
        body: {
          title: title.trim(),
          description: description.trim(),
          rewardAmount: reward,
          currency: currency.toUpperCase(),
          createdBy: session.personId,
          dueAt: dueAt ? new Date(`${dueAt}T00:00:00Z`).toISOString() : undefined,
        },
      });
      toast.success("悬赏已发布", title);
      setCreateOpen(false);
      bounties.reload();
    } catch (caught) {
      setCreateError(caught instanceof ApiError ? caught.message : "发布失败");
    } finally {
      setSaving(false);
    }
  }

  async function runAction(event: FormEvent) {
    event.preventDefault();
    if (!action) return;
    setActionError(null);
    try {
      const { kind, bounty } = action;
      if (kind === "claim") {
        await api(`/api/v1/bounties/${bounty.id}/claim`, {
          method: "POST",
          body: { personId: actionPerson },
        });
      } else if (kind === "submit") {
        await api(`/api/v1/bounties/${bounty.id}/submit`, {
          method: "POST",
          body: { personId: actionPerson, submissionRef: submissionRef.trim() },
        });
      } else if (kind === "accept") {
        await api(`/api/v1/bounties/${bounty.id}/accept`, {
          method: "POST",
          body: { reviewerPersonId: actionPerson },
        });
      } else {
        await api(`/api/v1/bounties/${bounty.id}/cancel`, {
          method: "POST",
          body: { actorPersonId: actionPerson, reason: "发布人取消悬赏" },
        });
      }
      toast.success(
        { claim: "已认领", submit: "已提交成果", accept: "已验收发放", cancel: "已取消" }[kind],
      );
      setAction(null);
      bounties.reload();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "操作失败");
    }
  }

  function openAction(kind: BountyAction, bounty: BountyView) {
    setAction({ kind, bounty });
    setActionPerson(session.personId);
    setSubmissionRef("");
    setActionError(null);
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="核心业务"
        title="悬赏任务"
        description="发布带奖金的任务，员工认领并提交成果；验收人不能是领受人本人，奖金发放全程留痕。"
        actions={
          <Button variant="secondary" onClick={() => bounties.reload()}>
            刷新
          </Button>
        }
      />
      <Panel
        title="悬赏列表"
        action={<Button onClick={() => setCreateOpen(true)}>发布悬赏</Button>}
        flush
      >
        {bounties.loading && bounties.data === undefined ? (
          <LoadingRows rows={4} />
        ) : bountyList.length === 0 ? (
          <EmptyState
            icon="rewards"
            title="暂无悬赏任务"
            description="发布一个悬赏：设定奖金与说明，团队成员即可认领并提交成果。"
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>任务</th>
                <th>奖金</th>
                <th>状态</th>
                <th>领受人</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {bountyList.map((bounty) => (
                <tr key={bounty.id}>
                  <td>
                    <strong>{bounty.title}</strong>
                    <div className="hint">{bounty.description}</div>
                  </td>
                  <td className="mono">
                    {bounty.rewardAmount} {bounty.currency}
                  </td>
                  <td>
                    <Badge
                      tone={
                        bounty.status === "ACCEPTED"
                          ? "success"
                          : bounty.status === "OPEN"
                            ? "info"
                            : "neutral"
                      }
                    >
                      {statusLabel[bounty.status] ?? bounty.status}
                    </Badge>
                  </td>
                  <td>
                    {bounty.assigneePersonId ? (
                      <code>{bounty.assigneePersonId.slice(0, 8)}</code>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="cell-actions">
                    <div className="row-actions">
                      {bounty.status === "OPEN" ? (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => openAction("claim", bounty)}
                        >
                          认领
                        </Button>
                      ) : null}
                      {bounty.status === "CLAIMED" ? (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => openAction("submit", bounty)}
                        >
                          提交成果
                        </Button>
                      ) : null}
                      {bounty.status === "SUBMITTED" ? (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => openAction("accept", bounty)}
                        >
                          验收
                        </Button>
                      ) : null}
                      {bounty.status === "OPEN" || bounty.status === "CLAIMED" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openAction("cancel", bounty)}
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
        )}
      </Panel>

      {/* 发布悬赏 */}
      <Modal
        open={createOpen}
        title="发布悬赏"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="bounty-form" loading={saving}>
              发布
            </Button>
          </>
        }
      >
        <form id="bounty-form" onSubmit={createBounty} className="form-grid">
          {createError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{createError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="任务标题" htmlFor="bounty-title">
            <TextInput
              id="bounty-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </FormField>
          <FormField label="任务说明" htmlFor="bounty-description">
            <Textarea
              id="bounty-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
            />
          </FormField>
          <FormField label="奖金金额" htmlFor="bounty-reward">
            <TextInput
              id="bounty-reward"
              value={reward}
              onChange={(event) => setReward(event.target.value)}
              placeholder="2000"
              required
            />
          </FormField>
          <FormField label="币种" htmlFor="bounty-currency">
            <TextInput
              id="bounty-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            />
          </FormField>
          <FormField label="截止日期（可选）" htmlFor="bounty-due">
            <TextInput
              id="bounty-due"
              type="date"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      {/* 认领 / 提交 / 验收 / 取消 */}
      <Modal
        open={Boolean(action)}
        title={
          action
            ? ({
                claim: "认领悬赏",
                submit: "提交成果",
                accept: "验收悬赏",
                cancel: "取消悬赏",
              } as const)[action.kind]
            : ""
        }
        onClose={() => setAction(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="bounty-action-form">
              确认
            </Button>
          </>
        }
      >
        <form id="bounty-action-form" onSubmit={runAction} className="form-grid">
          {actionError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{actionError}</InfoNotice>
            </div>
          ) : null}
          {action ? (
            <div className="field--full">
              <p className="hint">
                {action.bounty.title} · {action.bounty.rewardAmount}{" "}
                {action.bounty.currency}
              </p>
            </div>
          ) : null}
          {action?.kind !== "cancel" ? (
            <FormField
              label={action?.kind === "accept" ? "验收人" : "操作人"}
              htmlFor="bounty-person"
            >
              <PersonSelect
                id="bounty-person"
                value={actionPerson}
                onChange={setActionPerson}
              />
            </FormField>
          ) : null}
          {action?.kind === "submit" ? (
            <FormField label="成果引用" htmlFor="bounty-ref">
              <TextInput
                id="bounty-ref"
                value={submissionRef}
                onChange={(event) => setSubmissionRef(event.target.value)}
                placeholder="PR 链接 / 文档编号"
                required
              />
            </FormField>
          ) : null}
        </form>
      </Modal>
    </div>
  );
}
