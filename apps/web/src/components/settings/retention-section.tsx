/**
 * NP-032 阶段 3（2026-11-21 审计）：治理域拆分——保留策略与数据源登记簿。
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

export function RetentionSection({
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
  const retention = useApiQuery<RetentionPolicy[]>(
    governPath("/api/v1/retention-policies"),
  );
  const retentionReport = useApiQuery<{
    generatedAt: string;
    policies: Array<
      RetentionPolicy & {
        cutoffDate: string;
        eligibleForDisposal: boolean;
      }
    >;
  }>("/api/v1/retention-policies/report");
  const retentionRecommendations =
    useApiQuery<RetentionRecommendationsReport>(
      governPath("/api/v1/retention-policies/recommended"),
    );

  const dataMap = useApiQuery<DataMapReport>(governPath("/api/v1/data-map"));

  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceCode, setSourceCode] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceCategory, setSourceCategory] = useState("SALES");
  const [sourceOwner, setSourceOwner] = useState(session.personId);
  const [sourceSla, setSourceSla] = useState("24");
  const [sourceCriticality, setSourceCriticality] = useState<
    "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  >("MEDIUM");
  const [sourceRegion, setSourceRegion] = useState("cn-shanghai");
  const [sourcePersonal, setSourcePersonal] = useState(true);
  const [sourceCrossBorder, setSourceCrossBorder] = useState(false);
  const [sourceProcessors, setSourceProcessors] = useState("");
  const [sourceFields, setSourceFields] = useState<
    Array<{
      fieldName: string;
      classification: DataClassification;
      purpose: string;
      retentionMonths: string;
    }>
  >([
    {
      fieldName: "",
      classification: "INTERNAL",
      purpose: "",
      retentionMonths: "",
    },
  ]);

  const [retentionOpen, setRetentionOpen] = useState(false);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [retentionCategory, setRetentionCategory] = useState("");
  const [retentionMonths, setRetentionMonths] = useState("");
  const [retentionBasis, setRetentionBasis] = useState("");

  function resetDataSourceForm() {
    setSourceCode("");
    setSourceName("");
    setSourceCategory("SALES");
    setSourceOwner(session.personId);
    setSourceSla("24");
    setSourceCriticality("MEDIUM");
    setSourceRegion("cn-shanghai");
    setSourcePersonal(true);
    setSourceCrossBorder(false);
    setSourceProcessors("");
    setSourceFields([
      {
        fieldName: "",
        classification: "INTERNAL",
        purpose: "",
        retentionMonths: "",
      },
    ]);
    setSourceError(null);
  }


  function openRetentionForm(preset?: RetentionRecommendation) {
    setRetentionCategory(preset?.dataCategory ?? "");
    setRetentionMonths(preset ? String(preset.retentionMonths) : "");
    setRetentionBasis(preset?.legalBasis ?? "");
    setRetentionError(null);
    setRetentionOpen(true);
  }


  async function saveRetention(event: FormEvent) {
    event.preventDefault();
    setRetentionSaving(true);
    setRetentionError(null);
    try {
      await api("/api/v1/retention-policies", {
        method: "POST",
        body: {
          dataCategory: retentionCategory.trim(),
          retentionMonths: Number(retentionMonths),
          legalBasis: retentionBasis.trim(),
          legalHold: false,
        },
      });
      toast.success("保留策略已创建");
      setRetentionOpen(false);
      retention.reload();
      retentionRecommendations.reload();
    } catch (caught) {
      setRetentionError(
        caught instanceof Error ? caught.message : "操作失败。",
      );
    } finally {
      setRetentionSaving(false);
    }
  }

  async function saveDataSource(event: FormEvent) {
    event.preventDefault();
    setSourceSaving(true);
    setSourceError(null);
    try {
      await api("/api/v1/data-sources", {
        method: "POST",
        body: {
          code: sourceCode.trim(),
          name: sourceName.trim(),
          category: sourceCategory.trim(),
          ownerPersonId: sourceOwner,
          slaHours: Number(sourceSla),
          criticality: sourceCriticality,
          containsPersonalData: sourcePersonal,
          storageRegion: sourceRegion.trim(),
          crossBorderTransfers: sourceCrossBorder,
          processorRefs: sourceProcessors
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          fields: sourceFields
            .filter((field) => field.fieldName.trim() && field.purpose.trim())
            .map((field) => ({
              fieldName: field.fieldName.trim(),
              classification: field.classification,
              purpose: field.purpose.trim(),
              retentionMonths: field.retentionMonths
                ? Number(field.retentionMonths)
                : undefined,
            })),
        },
      });
      toast.success("数据源已登记", "数据映射已刷新。");
      setSourceOpen(false);
      resetDataSourceForm();
      dataMap.reload();
    } catch (error) {
      setSourceError(
        error instanceof Error ? error.message : "Could not register the source.",
      );
    } finally {
      setSourceSaving(false);
    }
  }



  const heldPolicies =
    retention.data?.filter((policy) => policy.legalHold) ?? [];

  return (
    <>
      {canGovern ? (<>
      <Panel
        title="保留策略"
        subtitle={`${heldPolicies.length} under legal hold`}
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => openRetentionForm()}
          >
            新增策略
          </Button>
        }
        flush
      >
        {retention.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={retention.error} onRetry={retention.reload} />
          </div>
        ) : retention.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : (retention.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="clock"
            title="暂无保留策略"
            description="按数据类别定义保留月数与法律依据；自动删除被有意关闭。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>数据类别</th>
                  <th className="cell-num">保留</th>
                  <th>法律依据</th>
                  <th>法务保留</th>
                  <th>截止日</th>
                  <th>处置</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {retention.data?.map((policy) => {
                  const report = retentionReport.data?.policies.find(
                    (entry) => entry.id === policy.id,
                  );
                  return (
                    <tr key={policy.id}>
                      <td>
                        <span className="cell-primary">
                          {policy.dataCategory}
                        </span>
                        <span className="cell-sub mono">
                          {shortId(policy.id, 10)}
                        </span>
                      </td>
                      <td className="cell-num">
                        {policy.retentionMonths} months
                      </td>
                      <td>{policy.legalBasis}</td>
                      <td>
                        <Badge tone={policy.legalHold ? "warning" : "neutral"}>
                          {policy.legalHold ? "Held" : "无"}
                        </Badge>
                      </td>
                      <td className="nowrap">{report?.cutoffDate ?? "—"}</td>
                      <td>
                        {report ? (
                          <Badge
                            tone={
                              report.eligibleForDisposal ? "warning" : "neutral"
                            }
                          >
                            {report.eligibleForDisposal
                              ? "Eligible"
                              : "已阻断"}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="nowrap">{formatDate(policy.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {retentionRecommendations.data ? (
          <div style={{ padding: "14px 16px 18px" }}>
            <div className="detail-section__title">系统推荐</div>
            <p className="muted" style={{ marginTop: 4 }}>
              {retentionRecommendations.data.note}
            </p>
            <div className="chip-row">
              {retentionRecommendations.data.recommendations.map(
                (recommendation) => (
                  <button
                    key={recommendation.dataCategory}
                    type="button"
                    className="chip"
                    onClick={() => openRetentionForm(recommendation)}
                    title={recommendation.legalBasis}
                  >
                    {recommendation.dataCategory} ·{" "}
                    {recommendation.retentionMonths}m
                    {recommendation.configured ? " · configured" : ""}
                  </button>
                ),
              )}
            </div>
          </div>
        ) : null}
      </Panel>
      </>) : null}

      <Modal
        open={retentionOpen}
        title="添加保留策略"
        description="保守的系统默认；请确认你所在法域的法律依据，法务保留始终优先。"
        onClose={() => setRetentionOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRetentionOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="retention-form"
              loading={retentionSaving}
            >
              创建策略
            </Button>
          </>
        }
      >
        <form id="retention-form" className="stack" onSubmit={saveRetention}>
          {retentionError ? (
            <InfoNotice tone="warning">{retentionError}</InfoNotice>
          ) : null}
          <FormField label="推荐类别" htmlFor="retention-preset">
            <Select
              id="retention-preset"
              value={retentionCategory}
              onChange={(event) => {
                const selected =
                  retentionRecommendations.data?.recommendations.find(
                    (row) => row.dataCategory === event.target.value,
                  );
                if (selected) {
                  setRetentionCategory(selected.dataCategory);
                  setRetentionMonths(String(selected.retentionMonths));
                  setRetentionBasis(selected.legalBasis);
                } else {
                  setRetentionCategory(event.target.value);
                }
              }}
            >
              <option value="">自定义类别</option>
              {retentionRecommendations.data?.recommendations.map(
                (recommendation) => (
                  <option
                    key={recommendation.dataCategory}
                    value={recommendation.dataCategory}
                  >
                    {recommendation.dataCategory} ·{" "}
                    {recommendation.retentionMonths} months
                  </option>
                ),
              )}
            </Select>
          </FormField>
          <FormField label="数据类别" htmlFor="retention-category">
            <TextInput
              id="retention-category"
              value={retentionCategory}
              onChange={(event) => setRetentionCategory(event.target.value)}
              placeholder="PAYROLL_RECORDS"
              required
            />
          </FormField>
          <FormField label="保留月数" htmlFor="retention-months">
            <TextInput
              id="retention-months"
              type="number"
              min="1"
              value={retentionMonths}
              onChange={(event) => setRetentionMonths(event.target.value)}
              required
            />
          </FormField>
          <FormField label="法律依据" htmlFor="retention-basis">
            <Textarea
              id="retention-basis"
              value={retentionBasis}
              onChange={(event) => setRetentionBasis(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      {canGovern ? (<>
      <Panel
        title="数据源登记簿"
        subtitle="每个激励数据源的责任人、响应 SLA 与字段级分类"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => {
              resetDataSourceForm();
              setSourceOpen(true);
            }}
          >
            登记数据源
          </Button>
        }
        flush
      >
        {dataMap.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={dataMap.error} onRetry={dataMap.reload} />
          </div>
        ) : dataMap.loading || !dataMap.data ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={4} />
          </div>
        ) : dataMap.data.sources.length === 0 ? (
          <EmptyState
            icon="server"
            title="暂无数据源"
            description="登记每个供证系统、责任人与其贡献的字段。"
          />
        ) : (
          <>
            <div className="coverage-grid" style={{ padding: 16 }}>
              <div className="coverage-cell">
                <div className="coverage-cell__label">活跃数据源</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.activeSources}
                </div>
                <div className="coverage-cell__sub">
                  {dataMap.data.summary.sources} registered
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">个人数据源</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.personalSources}
                </div>
                <div className="coverage-cell__sub">
                  {dataMap.data.summary.fields} mapped fields ·{" "}
                  {dataMap.data.summary.minimization
                    ?.personalFieldsWithoutRetention ?? 0}{" "}
                  without retention
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">跨境</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.crossBorderSources}
                </div>
                <div className="coverage-cell__sub">
                  {dataMap.data.summary.processors.length} processors
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">逾期复核</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.overdueReviews}
                </div>
                <div className="coverage-cell__sub">
                  复核周期 90 天
                </div>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>来源</th>
                    <th>负责人</th>
                    <th className="cell-num">SLA</th>
                    <th>关键级</th>
                    <th>字段</th>
                    <th>复核</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {dataMap.data.sources.map((source) => (
                    <tr key={source.id}>
                      <td>
                        <span className="cell-primary">{source.name}</span>
                        <span className="cell-sub mono">{source.code}</span>
                      </td>
                      <td className="mono">{shortId(source.ownerPersonId, 10)}</td>
                      <td className="cell-num">{source.slaHours}h</td>
                      <td>
                        <Badge
                          tone={
                            source.criticality === "CRITICAL"
                              ? "danger"
                              : source.criticality === "HIGH"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {titleCase(source.criticality)}
                        </Badge>
                      </td>
                      <td>
                        {source.fields.length}
                        {source.containsPersonalData ? (
                          <span className="cell-sub">个人数据</span>
                        ) : null}
                      </td>
                      <td>
                        {source.reviewOverdue ? (
                          <Badge tone="danger">已逾期</Badge>
                        ) : (
                          <span className="nowrap">
                            {formatDate(source.reviewDueAt)}
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge status={source.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
      </>) : null}

      <Modal
        open={sourceOpen}
        title="登记数据源"
        description="责任人、响应 SLA 与本数据源贡献的最小字段集。"
        onClose={() => setSourceOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setSourceOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="data-source-form"
              icon="check"
              loading={sourceSaving}
            >
              登记数据源
            </Button>
          </>
        }
      >
        <form
          id="data-source-form"
          className="stack"
          onSubmit={saveDataSource}
        >
          <div className="form-grid">
            <FormField label="编码" htmlFor="source-code">
              <TextInput
                id="source-code"
                value={sourceCode}
                onChange={(event) => setSourceCode(event.target.value)}
                required
              />
            </FormField>
            <FormField label="名称" htmlFor="source-name">
              <TextInput
                id="source-name"
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
                required
              />
            </FormField>
            <FormField label="类别" htmlFor="source-category">
              <TextInput
                id="source-category"
                value={sourceCategory}
                onChange={(event) => setSourceCategory(event.target.value)}
                required
              />
            </FormField>
            <FormField label="负责人" htmlFor="source-owner">
              <PersonSelect
                id="source-owner"
                value={sourceOwner}
                onChange={setSourceOwner}
              />
            </FormField>
            <FormField label="响应 SLA（小时）" htmlFor="source-sla">
              <TextInput
                id="source-sla"
                type="number"
                min={1}
                max={8760}
                value={sourceSla}
                onChange={(event) => setSourceSla(event.target.value)}
                required
              />
            </FormField>
            <FormField label="关键级" htmlFor="source-criticality">
              <Select
                id="source-criticality"
                value={sourceCriticality}
                onChange={(event) =>
                  setSourceCriticality(
                    event.target.value as
                      | "LOW"
                      | "MEDIUM"
                      | "HIGH"
                      | "CRITICAL",
                  )
                }
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">中</option>
                <option value="HIGH">高</option>
                <option value="CRITICAL">严重</option>
              </Select>
            </FormField>
            <FormField label="存储区域" htmlFor="source-region">
              <TextInput
                id="source-region"
                value={sourceRegion}
                onChange={(event) => setSourceRegion(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="处理者（逗号分隔）"
              htmlFor="source-processors"
            >
              <TextInput
                id="source-processors"
                value={sourceProcessors}
                onChange={(event) => setSourceProcessors(event.target.value)}
                placeholder="vendor-a, vendor-b"
              />
            </FormField>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={sourcePersonal}
              onChange={(event) => setSourcePersonal(event.target.checked)}
            />
            <span>该数据源包含个人数据。</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={sourceCrossBorder}
              onChange={(event) => setSourceCrossBorder(event.target.checked)}
            />
            <span>数据出境（中国大陆以外）。</span>
          </label>
          <div className="detail-section">
            <div className="detail-section__title">字段映射</div>
            <div className="stack">
              {sourceFields.map((field, index) => (
                <div className="form-grid" key={index}>
                  <FormField label="字段" htmlFor={`source-field-${index}`}>
                    <TextInput
                      id={`source-field-${index}`}
                      value={field.fieldName}
                      onChange={(event) =>
                        setSourceFields((current) =>
                          current.map((candidate, fieldIndex) =>
                            fieldIndex === index
                              ? {
                                  ...candidate,
                                  fieldName: event.target.value,
                                }
                              : candidate,
                          ),
                        )
                      }
                      required
                    />
                  </FormField>
                  <FormField
                    label="分类"
                    htmlFor={`source-class-${index}`}
                  >
                    <Select
                      id={`source-class-${index}`}
                      value={field.classification}
                      onChange={(event) =>
                        setSourceFields((current) =>
                          current.map((candidate, fieldIndex) =>
                            fieldIndex === index
                              ? {
                                  ...candidate,
                                  classification: event.target
                                    .value as DataClassification,
                                }
                              : candidate,
                          ),
                        )
                      }
                    >
                      <option value="PUBLIC">公开</option>
                      <option value="INTERNAL">内部</option>
                      <option value="CONFIDENTIAL">内部保密</option>
                      <option value="PERSONAL">个人</option>
                      <option value="SENSITIVE">敏感</option>
                    </Select>
                  </FormField>
                  <FormField
                    label="用途"
                    htmlFor={`source-purpose-${index}`}
                  >
                    <TextInput
                      id={`source-purpose-${index}`}
                      value={field.purpose}
                      onChange={(event) =>
                        setSourceFields((current) =>
                          current.map((candidate, fieldIndex) =>
                            fieldIndex === index
                              ? { ...candidate, purpose: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                      required
                    />
                  </FormField>
                  <FormField
                    label="保留月数"
                    htmlFor={`source-retention-${index}`}
                    hint="PERSONAL/SENSITIVE 字段必填。"
                  >
                    <TextInput
                      id={`source-retention-${index}`}
                      type="number"
                      min={1}
                      value={field.retentionMonths}
                      onChange={(event) =>
                        setSourceFields((current) =>
                          current.map((candidate, fieldIndex) =>
                            fieldIndex === index
                              ? {
                                  ...candidate,
                                  retentionMonths: event.target.value,
                                }
                              : candidate,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={sourceFields.length === 1}
                    onClick={() =>
                      setSourceFields((current) =>
                        current.filter((_, fieldIndex) => fieldIndex !== index),
                      )
                    }
                  >
                    移除
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              icon="plus"
              onClick={() =>
                setSourceFields((current) => [
                  ...current,
                  {
                    fieldName: "",
                    classification: "INTERNAL",
                    purpose: "",
                    retentionMonths: "",
                  },
                ])
              }
            >
              添加字段
            </Button>
          </div>
          {sourcePersonal ? (
            <InfoNotice>
              At least one field must be classified PERSONAL or SENSITIVE when
              the source contains personal data.
            </InfoNotice>
          ) : null}
          {sourceError ? (
            <InfoNotice tone="warning">{sourceError}</InfoNotice>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
