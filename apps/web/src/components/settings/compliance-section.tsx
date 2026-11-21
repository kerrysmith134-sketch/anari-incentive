/**
 * NP-032 阶段 3（2026-11-21 审计）：治理域拆分——利益冲突申报与紧急授权。
 * 自持查询与状态；页面容器仅传 session/governPath/people/canGovern。
 */
import { useState } from "react";
import type { FormEvent } from "react";
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
  Panel,
  Select,
  StatTile,
  TextInput,
  Textarea,
} from "../ui.js";
import { Icon } from "../Icon.js";
import { useApiQuery } from "../../lib/hooks.js";
import { api, ApiError } from "../../lib/api.js";
import { useToast } from "../../contexts/ToastContext.js";
import {
  displayName,
  formatDate,
  formatDateTime,
  formatMoney,
  shortId,
  titleCase,
} from "../../lib/format.js";
import { zhClawbackReason, zhStatus } from "../../lib/zh.js";
import { PersonSelect } from "../PersonSelect.js";
import type {
  BreakGlassGrant,
  ConflictDeclaration,
} from "../../lib/types.js";

export function ComplianceSection({
  session,
  governPath,
  people,
  canGovern,
}: {
  session: { personId: string };
  governPath: (path: string) => string | null;
  /** 人员目录（展示名解析）。 */
  people: Array<{ id: string; displayName: string }>;
  canGovern: boolean;
}) {
  const toast = useToast();
  const conflicts = useApiQuery<ConflictDeclaration[]>(
    governPath("/api/v1/conflict-declarations"),
  );
  const grants = useApiQuery<BreakGlassGrant[]>(
    governPath("/api/v1/break-glass-grants"),
  );
  const [revokeReason, setRevokeReason] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantSaving, setGrantSaving] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [granteeId, setGranteeId] = useState(session.personId);
  const [grantedById, setGrantedById] = useState(session.personId);
  const [grantReason, setGrantReason] = useState("");
  const [grantHours, setGrantHours] = useState("1");

  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictSaving, setConflictSaving] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [conflictPerson, setConflictPerson] = useState(session.personId);
  const [conflictRelated, setConflictRelated] = useState("");
  const [conflictType, setConflictType] = useState("FAMILY");
  const [conflictDescription, setConflictDescription] = useState("");
  const [revokeTarget, setRevokeTarget] =
    useState<ConflictDeclaration | null>(null);

  function openGrantForm() {
    setGranteeId(session.personId);
    setGrantedById(session.personId);
    setGrantReason("");
    setGrantHours("1");
    setGrantError(null);
    setGrantOpen(true);
  }

  async function saveGrant(event: FormEvent) {
    event.preventDefault();
    setGrantSaving(true);
    setGrantError(null);
    try {
      await api("/api/v1/break-glass-grants", {
        method: "POST",
        body: {
          scope: "PAYROLL_BANK_ACCOUNT",
          granteePersonId: granteeId,
          grantedBy: grantedById,
          reason: grantReason.trim(),
          expiresAt: new Date(
            Date.now() + Number(grantHours) * 60 * 60 * 1000,
          ).toISOString(),
        },
      });
      toast.success("紧急授权已创建");
      setGrantOpen(false);
      grants.reload();
    } catch (error) {
      setGrantError(
        error instanceof Error
          ? error.message
          : "创建授予失败。",
      );
    } finally {
      setGrantSaving(false);
    }
  }

  async function revokeGrant(grant: BreakGlassGrant) {
    setGrantSaving(true);
    try {
      await api(`/api/v1/break-glass-grants/${grant.id}/revoke`, {
        method: "POST",
      });
      toast.success("紧急授权已撤销");
      grants.reload();
    } catch (error) {
      toast.error(
        "撤销破窗授权失败",
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setGrantSaving(false);
    }
  }


  function openConflictForm() {
    setConflictPerson(session.personId);
    setConflictRelated("");
    setConflictType("FAMILY");
    setConflictDescription("");
    setConflictError(null);
    setConflictOpen(true);
  }

  async function saveConflict(event: FormEvent) {
    event.preventDefault();
    setConflictSaving(true);
    setConflictError(null);
    try {
      await api("/api/v1/conflict-declarations", {
        method: "POST",
        body: {
          personId: conflictPerson,
          relatedPersonId: conflictRelated,
          relationshipType: conflictType.trim(),
          description: conflictDescription.trim(),
        },
      });
      toast.success(
        "冲突已申报",
        "该两人之间的贡献认定已被阻断。",
      );
      setConflictOpen(false);
      conflicts.reload();
    } catch (error) {
      setConflictError(
        error instanceof Error
          ? error.message
          : "Could not declare the conflict.",
      );
    } finally {
      setConflictSaving(false);
    }
  }

  async function revokeConflict(event: FormEvent) {
    event.preventDefault();
    if (!revokeTarget) return;
    setConflictSaving(true);
    setConflictError(null);
    try {
      await api(
        `/api/v1/conflict-declarations/${revokeTarget.id}/revoke`,
        {
          method: "POST",
          body: { reason: revokeReason.trim() },
        },
      );
      toast.success("冲突申报已撤回");
      setRevokeTarget(null);
      setRevokeReason("");
      conflicts.reload();
    } catch (error) {
      setConflictError(
        error instanceof Error
          ? error.message
          : "Could not revoke the declaration.",
      );
    } finally {
      setConflictSaving(false);
    }
  }


  return (
    <>
      {canGovern ? (<>
      <Panel
        title="利益冲突申报"
        subtitle="生效的关联方申报会阻断两人互相认定"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openConflictForm}
          >
            申报冲突
          </Button>
        }
        flush
      >
        {conflicts.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={conflicts.error} onRetry={conflicts.reload} />
          </div>
        ) : conflicts.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : (conflicts.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="people"
            title="暂无冲突申报"
            description="申报应回避认定对方贡献的近亲属或财务关系。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>人员</th>
                  <th>关系</th>
                  <th>状态</th>
                  <th>已申报</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {conflicts.data?.map((declaration) => (
                  <tr key={declaration.id}>
                    <td>
                      <span className="cell-primary mono">
                        {shortId(declaration.personId, 10)} ↔{" "}
                        {shortId(declaration.relatedPersonId, 10)}
                      </span>
                      <span className="cell-sub">
                        {declaration.description}
                      </span>
                    </td>
                    <td>{titleCase(declaration.relationshipType)}</td>
                    <td>
                      <Badge status={declaration.status} />
                    </td>
                    <td className="nowrap">
                      {formatDate(declaration.declaredAt)}
                    </td>
                    <td className="cell-actions">
                      {declaration.status === "ACTIVE" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRevokeTarget(declaration);
                            setRevokeReason("");
                            setConflictError(null);
                          }}
                        >
                          撤销
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
      </>) : null}

      <Modal
        open={conflictOpen}
        title="申报利益冲突"
        description="申报生效期间，双方不能认定彼此的贡献。"
        onClose={() => setConflictOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConflictOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="conflict-form"
              loading={conflictSaving}
            >
              申报
            </Button>
          </>
        }
      >
        <form id="conflict-form" className="stack" onSubmit={saveConflict}>
          {conflictError ? (
            <InfoNotice tone="warning">{conflictError}</InfoNotice>
          ) : null}
          <FormField label="申报人" htmlFor="conflict-person">
            <PersonSelect
              id="conflict-person"
              value={conflictPerson}
              onChange={setConflictPerson}
            />
          </FormField>
          <FormField label="关联人" htmlFor="conflict-related">
            <PersonSelect
              id="conflict-related"
              value={conflictRelated}
              onChange={setConflictRelated}
            />
          </FormField>
          <FormField label="关系" htmlFor="conflict-type">
            <TextInput
              id="conflict-type"
              value={conflictType}
              onChange={(event) => setConflictType(event.target.value)}
              placeholder="家庭 / 财务 / 前上级…"
              required
            />
          </FormField>
          <FormField label="说明" htmlFor="conflict-description">
            <TextInput
              id="conflict-description"
              value={conflictDescription}
              onChange={(event) =>
                setConflictDescription(event.target.value)
              }
              required
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(revokeTarget)}
        title="撤回冲突申报"
        onClose={() => setRevokeTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              type="submit"
              form="revoke-conflict-form"
              loading={conflictSaving}
            >
              撤销
            </Button>
          </>
        }
      >
        <form
          id="revoke-conflict-form"
          className="stack"
          onSubmit={revokeConflict}
        >
          {conflictError ? (
            <InfoNotice tone="warning">{conflictError}</InfoNotice>
          ) : null}
          <FormField label="撤回原因" htmlFor="revoke-reason">
            <TextInput
              id="revoke-reason"
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>


      {canGovern ? (<>
      <Panel
        title="紧急授权"
        subtitle="限时、需理由的敏感薪酬字段访问"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openGrantForm}
          >
            授予访问
          </Button>
        }
        flush
      >
        {grants.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={grants.error} onRetry={grants.reload} />
          </div>
        ) : grants.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (grants.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="lock"
            title="暂无紧急授权"
            description="非财务角色默认看不到敏感薪酬字段，除非管理员授予限时访问。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>被授权人</th>
                  <th>范围</th>
                  <th>原因</th>
                  <th>过期时间</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {grants.data?.map((grant) => (
                  <tr key={grant.id}>
                    <td>{displayName(grant.granteePersonId, people)}</td>
                    <td>{titleCase(grant.scope)}</td>
                    <td>{grant.reason}</td>
                    <td className="nowrap">{formatDateTime(grant.expiresAt)}</td>
                    <td>
                      <Badge status={grant.status} />
                    </td>
                    <td className="cell-actions">
                      {grant.status === "ACTIVE" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void revokeGrant(grant)}
                          loading={grantSaving}
                        >
                          撤销
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
      </>) : null}

      <Modal
        open={grantOpen}
        title="授予紧急访问"
        description="最长 24 小时；被授权人不能批准自己的访问。"
        onClose={() => setGrantOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGrantOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="grant-form"
              loading={grantSaving}
            >
              授予
            </Button>
          </>
        }
      >
        <form id="grant-form" className="stack" onSubmit={saveGrant}>
          {grantError ? (
            <InfoNotice tone="warning">{grantError}</InfoNotice>
          ) : null}
          <FormField label="被授权人" htmlFor="grant-grantee">
            <PersonSelect
              id="grant-grantee"
              value={granteeId}
              onChange={setGranteeId}
            />
          </FormField>
          <FormField label="授予人" htmlFor="grant-granted-by">
            <PersonSelect
              id="grant-granted-by"
              value={grantedById}
              onChange={setGrantedById}
            />
          </FormField>
          <FormField label="原因" htmlFor="grant-reason">
            <TextInput
              id="grant-reason"
              value={grantReason}
              onChange={(event) => setGrantReason(event.target.value)}
              required
            />
          </FormField>
          <FormField label="时长（小时，最长 24）" htmlFor="grant-hours">
            <TextInput
              id="grant-hours"
              type="number"
              min={1}
              max={24}
              value={grantHours}
              onChange={(event) => setGrantHours(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>
    </>
  );
}
