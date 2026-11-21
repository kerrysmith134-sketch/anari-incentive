/**
 * NP-032 阶段 3（2026-11-21 审计）：治理域拆分——数据保护（DPIA/DSAR/保留处置/字段权限矩阵）。
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
import { Icon } from "../Icon.js";
import { PersonSelect } from "../PersonSelect.js";
import { BarChart } from "../charts.js";
import type {
  AuditRedaction,
  BudgetPool,
  CalibrationSession,
  ClawbackCase,
  ClawbackSchedule,
  DataClassification,
  DataMapReport,
  DiscretionaryPoolReview,
  DpiaRecord,
  DsarRequest,
  FairnessCommitment,
  FieldAccessPolicyMatrix,
  ManagerTrainingRecord,
  ModelProviderPolicy,
  PilotEnrollment,
  RetentionDisposalRequest,
  RetentionPolicy,
  RetentionRecommendation,
  RetentionRecommendationsReport,
  TrustSurveyReport,
  TrustSurveyRun,
} from "../../lib/types.js";

export function DataProtectionSection({
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
  const dpias = useApiQuery<DpiaRecord[]>(governPath("/api/v1/dpia-records"));
  const dsars = useApiQuery<DsarRequest[]>("/api/v1/dsar-requests");
  const [dpiaOpen, setDpiaOpen] = useState(false);
  const [dpiaType, setDpiaType] = useState("DPIA");
  const [dpiaScope, setDpiaScope] = useState("");
  const [dpiaRisk, setDpiaRisk] = useState("{}");
  const [dpiaError, setDpiaError] = useState<string | null>(null);
  const [dsarOpen, setDsarOpen] = useState(false);
  const [dsarPerson, setDsarPerson] = useState(session.personId);
  const [dsarType, setDsarType] = useState("ACCESS");
  const [dsarError, setDsarError] = useState<string | null>(null);
  const [resolveTarget, setResolveTarget] = useState<DsarRequest | null>(null);
  const [resolveStatus, setResolveStatus] = useState("RESOLVED");
  const [resolveRef, setResolveRef] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [fieldPolicyOpen, setFieldPolicyOpen] = useState(false);
  const [fieldPolicyJson, setFieldPolicyJson] = useState("{}");
  const [fieldPolicyError, setFieldPolicyError] = useState<string | null>(
    null,
  );
  const [fieldPolicySaving, setFieldPolicySaving] = useState(false);


  async function createDpia(event: FormEvent) {
    event.preventDefault();
    setDpiaError(null);
    try {
      await api("/api/v1/dpia-records", {
        method: "POST",
        body: {
          assessmentType: dpiaType,
          scope: dpiaScope.trim(),
          riskSummary: JSON.parse(dpiaRisk) as Record<string, unknown>,
        },
      });
      toast.success("评估已创建", dpiaScope.trim());
      setDpiaOpen(false);
      dpias.reload();
    } catch (caught) {
      setDpiaError(
        caught instanceof ApiError ? caught.message : "创建评估失败",
      );
    }
  }

  async function approveDpia(record: DpiaRecord) {
    try {
      await api(`/api/v1/dpia-records/${record.id}/approve`, {
        method: "POST",
        body: { approvedBy: session.personId },
      });
      toast.success("评估已批准", shortId(record.id, 8));
      dpias.reload();
    } catch (caught) {
      toast.error(
        "批准失败",
        caught instanceof ApiError ? caught.message : undefined,
      );
    }
  }

  async function createDsar(event: FormEvent) {
    event.preventDefault();
    setDsarError(null);
    try {
      await api("/api/v1/dsar-requests", {
        method: "POST",
        body: { personId: dsarPerson, requestType: dsarType },
      });
      toast.success("请求已创建", dsarType);
      setDsarOpen(false);
      dsars.reload();
    } catch (caught) {
      setDsarError(caught instanceof ApiError ? caught.message : "创建请求失败");
    }
  }

  async function resolveDsar(event: FormEvent) {
    event.preventDefault();
    if (!resolveTarget) return;
    setResolveError(null);
    try {
      await api(`/api/v1/dsar-requests/${resolveTarget.id}/resolve`, {
        method: "POST",
        body: { resolution: resolveStatus, resolutionRef: resolveRef.trim() },
      });
      toast.success("请求已处理", resolveStatus);
      setResolveTarget(null);
      dsars.reload();
    } catch (caught) {
      setResolveError(
        caught instanceof ApiError ? caught.message : "处理请求失败",
      );
    }
  }


  function openFieldPolicies() {
    setFieldPolicyJson(
      JSON.stringify(fieldPolicies.data?.configured ?? {}, null, 2),
    );
    setFieldPolicyError(null);
    setFieldPolicyOpen(true);
  }


  async function saveFieldPolicies() {
    setFieldPolicySaving(true);
    setFieldPolicyError(null);
    try {
      const parsed = JSON.parse(fieldPolicyJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("策略必须是 JSON 对象。");
      }
      await api("/api/v1/field-access-policies", {
        method: "PUT",
        body: { policies: parsed },
      });
      toast.success("字段权限矩阵已更新");
      setFieldPolicyOpen(false);
      fieldPolicies.reload();
    } catch (caught) {
      setFieldPolicyError(
        caught instanceof Error ? caught.message : "操作失败。",
      );
    } finally {
      setFieldPolicySaving(false);
    }
  }


  const retention = useApiQuery<RetentionPolicy[]>(
    governPath("/api/v1/retention-policies"),
  );
  const fieldPolicies = useApiQuery<FieldAccessPolicyMatrix>(
    governPath("/api/v1/field-access-policies"),
  );
  const disposals = useApiQuery<RetentionDisposalRequest[]>(
    governPath("/api/v1/retention-disposal-requests"),
  );
  const [disposalProcessing, setDisposalProcessing] = useState(false);
  const [disposalOpen, setDisposalOpen] = useState(false);
  const [disposalPolicy, setDisposalPolicy] = useState("");
  const [disposalReason, setDisposalReason] = useState("");
  const [disposalRequester, setDisposalRequester] = useState(
    session.personId,
  );
  const [disposalSaving, setDisposalSaving] = useState(false);
  const [disposalError, setDisposalError] = useState<string | null>(null);

  const openDsars =
    dsars.data?.filter((request) => request.status === "OPEN") ?? [];
  const overdueDsars = openDsars.filter(
    (request) => request.dueAt && new Date(request.dueAt).getTime() < Date.now(),
  );

  function openDisposalForm() {
    const policies = (retention.data ?? []).filter(
      (policy) => !policy.legalHold,
    );
    if (policies.length === 0) {
      toast.error(
        "没有可处置的保留策略",
        "Create a policy without a legal hold first.",
      );
      return;
    }
    setDisposalPolicy(policies[0]?.id ?? "");
    setDisposalReason("");
    setDisposalRequester(session.personId);
    setDisposalError(null);
    setDisposalOpen(true);
  }


  async function saveDisposal(event: FormEvent) {
    event.preventDefault();
    setDisposalSaving(true);
    setDisposalError(null);
    try {
      await api(
        `/api/v1/retention-policies/${disposalPolicy}/disposal-requests`,
        {
          method: "POST",
          body: {
            requestedBy: disposalRequester,
            reason: disposalReason.trim(),
          },
        },
      );
      toast.success(
        "处置请求已创建",
        "需另一人批准，随后进入宽限期。",
      );
      setDisposalOpen(false);
      disposals.reload();
    } catch (error) {
      setDisposalError(
        error instanceof Error
          ? error.message
          : "Could not create the disposal request.",
      );
    } finally {
      setDisposalSaving(false);
    }
  }


  async function approveDisposal(request: RetentionDisposalRequest) {
    setDisposalSaving(true);
    try {
      await api(
        `/api/v1/retention-disposal-requests/${request.id}/approve`,
        {
          method: "POST",
          body: { approvedBy: session.personId },
        },
      );
      toast.success("留存销毁已批准");
      disposals.reload();
    } catch (error) {
      toast.error(
        "审批处置失败",
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setDisposalSaving(false);
    }
  }


  async function processDueDisposals() {
    setDisposalProcessing(true);
    try {
      const result = await api<{
        processedCount: number;
        skipped: Array<{ requestId: string; reason: string }>;
      }>("/api/v1/retention-disposal-requests:process", {
        method: "POST",
        body: { actorPersonId: session.personId },
      });
      toast.success(
        "销毁处理完成",
        `已完成 ${result.processedCount} 项${
          result.skipped.length > 0
            ? `，跳过 ${result.skipped.length} 项（法务保全或门禁）`
            : ""
        }`,
      );
      disposals.reload();
    } catch (error) {
      toast.error(
        "处理销毁失败",
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setDisposalProcessing(false);
    }
  }


  return (
    <>
        {canGovern ? (<>
        <Panel
          title="DPIAs"
          subtitle="数据保护影响评估"
          action={
            <div className="row-actions">
              <Badge tone="neutral" dot={false}>{dpias.data?.length ?? 0}</Badge>
              <Button size="sm" variant="secondary" icon="plus" onClick={() => setDpiaOpen(true)}>
                新建评估
              </Button>
            </div>
          }
          flush
        >
          {dpias.error ? (
            <div style={{ padding: 16 }}>
              <ErrorNotice error={dpias.error} onRetry={dpias.reload} />
            </div>
          ) : dpias.loading ? (
            <div style={{ padding: 16 }}>
              <LoadingRows rows={3} />
            </div>
          ) : (dpias.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="lock"
              title="暂无 DPIA 记录"
              description="涉及员工数据的政策版本应引用已批准的评估。"
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>范围</th>
                    <th>状态</th>
                    <th>已批准</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {dpias.data?.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <span className="cell-primary">
                          {record.assessmentType}
                        </span>
                        <span className="cell-sub mono">
                          {shortId(record.id, 10)}
                        </span>
                      </td>
                      <td>{record.scope}</td>
                      <td>
                        <Badge status={record.status} />
                      </td>
                      <td className="nowrap">
                        {record.approvedAt
                          ? formatDate(record.approvedAt)
                          : "—"}
                      </td>
                      <td className="cell-actions">
                        {record.status === "DRAFT" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void approveDpia(record)}
                          >
                            批准
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

        <Panel
          title="个人数据请求"
          subtitle={`${openDsars.length} open · ${overdueDsars.length} overdue`}
          action={
            <div className="row-actions">
              <Badge tone={overdueDsars.length > 0 ? "danger" : "neutral"} dot={false}>{dsars.data?.length ?? 0}</Badge>
              <Button size="sm" variant="secondary" icon="plus" onClick={() => setDsarOpen(true)}>
                新建请求
              </Button>
            </div>
          }
          flush
        >
          {dsars.error ? (
            <div style={{ padding: 16 }}>
              <ErrorNotice error={dsars.error} onRetry={dsars.reload} />
            </div>
          ) : dsars.loading ? (
            <div style={{ padding: 16 }}>
              <LoadingRows rows={3} />
            </div>
          ) : (dsars.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="user"
              title="暂无个人数据请求"
              description="查询/更正/删除/说明/异议请求在此展示。"
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>人员</th>
                    <th>状态</th>
                    <th>截止</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {dsars.data?.slice(0, 8).map((request) => {
                    const overdue =
                      request.status === "OPEN" &&
                      Boolean(request.dueAt) &&
                      new Date(request.dueAt as string).getTime() < Date.now();
                    return (
                      <tr key={request.id}>
                        <td>
                          <span className="cell-primary">{request.requestType}</span>
                          <span className="cell-sub mono">
                            {shortId(request.id, 10)}
                          </span>
                        </td>
                        <td className="mono">{shortId(request.personId, 10)}</td>
                        <td>
                          <Badge status={request.status} />
                        </td>
                        <td className={overdue ? "text-danger nowrap" : "nowrap"}>
                          {request.dueAt ? formatDate(request.dueAt) : "—"}
                        </td>
                        <td className="cell-actions">
                          {request.status === "OPEN" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setResolveTarget(request);
                                setResolveStatus("RESOLVED");
                                setResolveRef("");
                                setResolveError(null);
                              }}
                            >
                              处理
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

      {canGovern ? (<>
      <Panel
        title="保留处置请求"
        subtitle="双人复核 + 宽限期的处置流程；无自动硬删除"
        className="section-gap"
        action={
          <div className="row-actions">
            <Button
              size="sm"
              variant="secondary"
              loading={disposalProcessing}
              onClick={() => void processDueDisposals()}
            >
              处理到期处置
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              onClick={openDisposalForm}
            >
              申请处置
            </Button>
          </div>
        }
        flush
      >
        {disposals.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={disposals.error} onRetry={disposals.reload} />
          </div>
        ) : disposals.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (disposals.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="clock"
            title="暂无处置请求"
            description="处置需要无保留的策略、理由、第二审批人与未来的宽限期。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>类别</th>
                  <th>原因</th>
                  <th>状态</th>
                  <th>已排期</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {disposals.data?.map((request) => (
                  <tr key={request.id}>
                    <td className="mono">{request.dataCategory}</td>
                    <td>{request.reason}</td>
                    <td>
                      <Badge status={request.status} />
                    </td>
                    <td className="nowrap">
                      {formatDateTime(request.scheduledFor)}
                    </td>
                    <td className="cell-actions">
                      {request.status === "REQUESTED" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void approveDisposal(request)}
                          loading={disposalSaving}
                        >
                          批准
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
        open={disposalOpen}
        title="申请保留处置"
        description="必须由另一人批准；未到宽限日期不可完成。"
        onClose={() => setDisposalOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDisposalOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="disposal-form"
              loading={disposalSaving}
            >
              请求
            </Button>
          </>
        }
      >
        <form id="disposal-form" className="stack" onSubmit={saveDisposal}>
          {disposalError ? (
            <InfoNotice tone="warning">{disposalError}</InfoNotice>
          ) : null}
          <FormField label="保留策略" htmlFor="disposal-policy">
            <Select
              id="disposal-policy"
              value={disposalPolicy}
              onChange={(event) => setDisposalPolicy(event.target.value)}
              required
            >
              <option value="">Select a policy…</option>
              {(retention.data ?? [])
                .filter((policy) => !policy.legalHold)
                .map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.dataCategory} · {policy.retentionMonths} months
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="发起人" htmlFor="disposal-requester">
            <PersonSelect
              id="disposal-requester"
              value={disposalRequester}
              onChange={setDisposalRequester}
            />
          </FormField>
          <FormField label="原因" htmlFor="disposal-reason">
            <Textarea
              id="disposal-reason"
              value={disposalReason}
              onChange={(event) => setDisposalReason(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      {canGovern ? (<>
      <Panel
        title="字段权限矩阵"
        subtitle="薪酬与计算资源的按角色脱敏"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={openFieldPolicies}
          >
            编辑矩阵
          </Button>
        }
        flush
      >
        {fieldPolicies.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice
              error={fieldPolicies.error}
              onRetry={fieldPolicies.reload}
            />
          </div>
        ) : fieldPolicies.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>RESOURCE.field</th>
                  <th>允许角色</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(fieldPolicies.data?.effective ?? {}).map(
                  ([key, roles]) => (
                    <tr key={key}>
                      <td className="mono">{key}</td>
                      <td>{roles.join(", ")}</td>
                      <td>
                        {Object.prototype.hasOwnProperty.call(
                          fieldPolicies.data?.configured ?? {},
                          key,
                        )
                          ? "Tenant override"
                          : "系统默认"}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      </>) : null}

      <Modal
        open={fieldPolicyOpen}
        title="编辑字段权限矩阵"
        description="JSON 对象，将 RESOURCE.field 映射到允许角色；缺失项使用系统默认。"
        onClose={() => setFieldPolicyOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setFieldPolicyOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => void saveFieldPolicies()}
              loading={fieldPolicySaving}
            >
              保存矩阵
            </Button>
          </>
        }
      >
        <div className="stack">
          {fieldPolicyError ? (
            <InfoNotice tone="warning">{fieldPolicyError}</InfoNotice>
          ) : null}
          <FormField label="已配置策略（JSON）" htmlFor="field-policy-json">
            <Textarea
              id="field-policy-json"
              value={fieldPolicyJson}
              onChange={(event) => setFieldPolicyJson(event.target.value)}
              className="mono"
            />
          </FormField>
        </div>
      </Modal>

      <InfoNotice>
        <Icon name="shield" size={15} /> 自动保留删除未启用；保留策略只记录规则与法务保留，
        实际处置仍需审批后人工执行。
      </InfoNotice>

      <Modal
        open={dpiaOpen}
        title="新建数据保护影响评估"
        onClose={() => setDpiaOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDpiaOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="dpia-form">
              创建
            </Button>
          </>
        }
      >
        <form id="dpia-form" onSubmit={createDpia} className="form-grid">
          {dpiaError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{dpiaError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="评估类型">
            <Select
              value={dpiaType}
              onChange={(event) => setDpiaType(event.target.value)}
            >
              <option value="DPIA">DPIA</option>
              <option value="PIPIA">PIPIA</option>
            </Select>
          </FormField>
          <FormField label="评估范围" className="field--full">
            <TextInput
              value={dpiaScope}
              onChange={(event) => setDpiaScope(event.target.value)}
              required
            />
          </FormField>
          <FormField label="风险摘要 JSON" className="field--full">
            <Textarea
              rows={5}
              value={dpiaRisk}
              onChange={(event) => setDpiaRisk(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={dsarOpen}
        title="新建个人数据请求"
        onClose={() => setDsarOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDsarOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="dsar-form">
              创建
            </Button>
          </>
        }
      >
        <form id="dsar-form" onSubmit={createDsar} className="form-grid">
          {dsarError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{dsarError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="人员">
            <PersonSelect value={dsarPerson} onChange={setDsarPerson} />
          </FormField>
          <FormField label="请求类型">
            <Select
              value={dsarType}
              onChange={(event) => setDsarType(event.target.value)}
            >
              <option value="ACCESS">查询</option>
              <option value="CORRECTION">更正</option>
              <option value="DELETION">删除</option>
              <option value="EXPLANATION">说明</option>
              <option value="OBJECTION">异议</option>
            </Select>
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(resolveTarget)}
        title="处理个人数据请求"
        onClose={() => setResolveTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResolveTarget(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="dsar-resolve-form">
              确认
            </Button>
          </>
        }
      >
        <form id="dsar-resolve-form" onSubmit={resolveDsar} className="form-grid">
          {resolveError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{resolveError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="处理结论">
            <Select
              value={resolveStatus}
              onChange={(event) => setResolveStatus(event.target.value)}
            >
              <option value="RESOLVED">已解决</option>
              <option value="REJECTED">驳回</option>
            </Select>
          </FormField>
          <FormField label="处理依据 / 引用" className="field--full">
            <TextInput
              value={resolveRef}
              onChange={(event) => setResolveRef(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>
    </>
  );
}
