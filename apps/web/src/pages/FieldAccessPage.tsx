import { useEffect, useState } from "react";
import {
  Badge,
  Button,
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
import { useToast } from "../contexts/ToastContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { ApiError, api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import type { WorkforceSubgroupAttributeView } from "../lib/ops-types.js";
import {
  buildConfiguredPolicies,
  isValidPolicyKey,
  normalizePolicyValue,
  type PolicyEditorRow,
  type PolicyValue,
} from "../lib/field-policy.js";

interface MatrixResponse {
  defaults: Record<string, PolicyValue>;
  configured: Record<string, PolicyValue>;
  effective: Record<string, PolicyValue>;
}

const RESOURCES = [
  "PAYROLL_LINE",
  "CALCULATION_LINE",
  "EMPLOYMENT_CONTRACT",
  "EVIDENCE",
  "SETTLEMENT_LINE",
  "AI_PROPOSAL",
];

const PREDICATES = [
  "isSubjectManager",
  "sameOrgNode",
  "sameLegalEntity",
  "legalHoldActive",
  "subjectEmploymentActive",
  "viewerEmploymentActive",
];

const DENY_MODES: Array<"" | "OMIT" | "ZERO" | "REDACT"> = [
  "",
  "OMIT",
  "ZERO",
  "REDACT",
];

export function FieldAccessPage() {
  useDocumentTitle("字段权限");
  const toast = useToast();
  const matrix = useApiQuery<MatrixResponse>("/api/v1/field-access-policies");
  const [rows, setRows] = useState<PolicyEditorRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newResource, setNewResource] = useState(RESOURCES[0] as string);
  const [newField, setNewField] = useState("");
  const { session } = useAuth();
  const attributes = useApiQuery<WorkforceSubgroupAttributeView[]>(
    "/api/v1/workforce-subgroup-attributes",
  );
  const [attributeOpen, setAttributeOpen] = useState(false);
  const [attributePersonId, setAttributePersonId] = useState("");
  const [attributeDimension, setAttributeDimension] = useState("GENDER");
  const [attributeValue, setAttributeValue] = useState("");
  const [attributeConsentRef, setAttributeConsentRef] = useState("");
  const [attributeConsentedAt, setAttributeConsentedAt] = useState("");
  const [attributeExpiresAt, setAttributeExpiresAt] = useState("");
  const [attributeError, setAttributeError] = useState<string | null>(null);
  const [withdrawTarget, setWithdrawTarget] =
    useState<WorkforceSubgroupAttributeView | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  useEffect(() => {
    const data = matrix.data;
    if (!data) return;
    setRows(
      Object.entries(data.effective)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => ({
          key,
          ...normalizePolicyValue(value),
          overridden: key in data.configured,
        })),
    );
  }, [matrix.data]);

  function updateRow(key: string, patch: Partial<PolicyEditorRow>) {
    setRows((current) =>
      current.map((row) =>
        row.key === key ? { ...row, ...patch, overridden: true } : row,
      ),
    );
  }

  function resetRow(key: string) {
    if (!matrix.data) return;
    const base = matrix.data.defaults[key];
    if (!base) {
      setRows((current) => current.filter((row) => row.key !== key));
      return;
    }
    setRows((current) =>
      current.map((row) =>
        row.key === key
          ? { ...row, ...normalizePolicyValue(base), overridden: false }
          : row,
      ),
    );
  }

  function addRow() {
    const key = `${newResource}.${newField.trim()}`;
    if (!isValidPolicyKey(key) || rows.some((row) => row.key === key)) {
      setError("为资源输入唯一的 RESOURCE.field 名称。");
      return;
    }
    setRows((current) => [
      ...current,
      {
        key,
        roles: "finance, admin",
        allowSelf: true,
        onDeny: "",
        match: {},
        overridden: true,
      },
    ]);
    setNewField("");
    setError(null);
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const policies = buildConfiguredPolicies(rows);
      await api("/api/v1/field-access-policies", {
        method: "PUT",
        body: { policies },
      });
      toast.success(
        "Field matrix saved",
        `${Object.keys(policies).length} override(s)`,
      );
      matrix.reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "保存矩阵失败",
      );
    } finally {
      setSaving(false);
    }
  }

  function openAttribute() {
    setAttributePersonId("");
    setAttributeDimension("GENDER");
    setAttributeValue("");
    setAttributeConsentRef("");
    setAttributeConsentedAt(new Date().toISOString().slice(0, 10));
    setAttributeExpiresAt("");
    setAttributeError(null);
    setAttributeOpen(true);
  }

  async function recordAttribute() {
    setAttributeError(null);
    try {
      await api("/api/v1/workforce-subgroup-attributes", {
        method: "POST",
        body: {
          personId: attributePersonId.trim(),
          dimension: attributeDimension,
          value: attributeValue.trim(),
          consentRef: attributeConsentRef.trim(),
          consentedAt: new Date(attributeConsentedAt).toISOString(),
          expiresAt: attributeExpiresAt
            ? new Date(attributeExpiresAt).toISOString()
            : undefined,
          recordedBy: session.personId,
        },
      });
      toast.success("Subgroup label recorded", attributeDimension);
      setAttributeOpen(false);
      attributes.reload();
    } catch (caught) {
      setAttributeError(
        caught instanceof ApiError ? caught.message : "Could not record label",
      );
    }
  }

  async function withdrawAttribute() {
    if (!withdrawTarget) return;
    setWithdrawError(null);
    try {
      await api("/api/v1/workforce-subgroup-attributes/withdraw", {
        method: "POST",
        body: {
          personId: withdrawTarget.personId,
          dimension: withdrawTarget.dimension,
          actorPersonId: session.personId,
          reason: withdrawReason.trim(),
        },
      });
      toast.success("标签已撤回", withdrawTarget.dimension);
      setWithdrawTarget(null);
      attributes.reload();
    } catch (caught) {
      setWithdrawError(
        caught instanceof ApiError ? caught.message : "撤回标签失败",
      );
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="安全态势"
        title="字段权限"
        description="字段级角色白名单，可选服务端谓词。条件只收窄访问；管理员与本人始终放行。未知谓词会被拒绝。"
        actions={
          <Button variant="primary" onClick={save} loading={saving}>
            保存覆盖
          </Button>
        }
      />

      {error ? <InfoNotice tone="warning">{error}</InfoNotice> : null}

      <Panel
        title="生效矩阵"
        subtitle="编辑行可创建租户覆盖；重置则回退系统默认"
        flush
      >
        {matrix.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={matrix.error} onRetry={matrix.reload} />
          </div>
        ) : matrix.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={5} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="shield"
            title="暂无字段策略"
            description="在下方添加资源字段以开始保护。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>字段</th>
                  <th>允许角色</th>
                  <th>本人</th>
                  <th>拒绝时</th>
                  <th>谓词</th>
                  <th>来源</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <span className="cell-primary mono">{row.key}</span>
                    </td>
                    <td>
                      <TextInput
                        value={row.roles}
                        onChange={(event) =>
                          updateRow(row.key, { roles: event.target.value })
                        }
                        placeholder="财务、管理员"
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.allowSelf}
                        onChange={(event) =>
                          updateRow(row.key, {
                            allowSelf: event.target.checked,
                          })
                        }
                      />
                    </td>
                    <td>
                      <Select
                        value={row.onDeny}
                        onChange={(event) =>
                          updateRow(row.key, {
                            onDeny: event.target
                              .value as PolicyEditorRow["onDeny"],
                          })
                        }
                      >
                        {DENY_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode || "infer"}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      <div className="chip-row">
                        {PREDICATES.map((predicate) => (
                          <label key={predicate} className="chip">
                            <input
                              type="checkbox"
                              checked={row.match[predicate] === true}
                              onChange={(event) =>
                                updateRow(row.key, {
                                  match: {
                                    ...row.match,
                                    [predicate]: event.target.checked,
                                  },
                                })
                              }
                            />{" "}
                            {predicate}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Badge tone={row.overridden ? "warning" : "neutral"}>
                        {row.overridden ? "改判" : "Default"}
                      </Badge>
                    </td>
                    <td className="cell-actions">
                      {row.overridden ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => resetRow(row.key)}
                        >
                          重置
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

      <Panel title="添加受保护字段" subtitle="RESOURCE.field 必须匹配受控资源">
        <div className="form-grid">
          <FormField label="资源" htmlFor="new-resource">
            <Select
              id="new-resource"
              value={newResource}
              onChange={(event) => setNewResource(event.target.value)}
            >
              {RESOURCES.map((resource) => (
                <option key={resource} value={resource}>
                  {resource}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="字段" htmlFor="new-field">
            <TextInput
              id="new-field"
              value={newField}
              onChange={(event) => setNewField(event.target.value)}
              placeholder="bankAccountRef"
            />
          </FormField>
          <div className="inline" style={{ alignItems: "end" }}>
            <Button variant="secondary" icon="plus" onClick={addRow}>
              添加行
            </Button>
          </div>
        </div>
      </Panel>

      <Panel
        title="经同意的子群体标签"
        subtitle="可选的、需单独同意的标签，仅用于群体公平性审查；绝不用于个人决策"
        flush
        action={
          <Button
            size="sm"
            variant="primary"
            icon="plus"
            onClick={openAttribute}
          >
            记录标签
          </Button>
        }
      >
        {attributes.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={attributes.error} onRetry={attributes.reload} />
          </div>
        ) : attributes.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (attributes.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="shield"
            title="暂无子群体标签"
            description="标签需要单独的同意引用，可随时撤回。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>人员</th>
                  <th>维度</th>
                  <th>值</th>
                  <th>同意</th>
                  <th>过期时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(attributes.data ?? []).map((attribute) => (
                  <tr key={attribute.id}>
                    <td className="mono">{attribute.personId.slice(0, 10)}</td>
                    <td>{attribute.dimension}</td>
                    <td>{attribute.value}</td>
                    <td className="mono">{attribute.consentRef}</td>
                    <td className="nowrap">{attribute.expiresAt ?? "—"}</td>
                    <td className="cell-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setWithdrawTarget(attribute);
                          setWithdrawReason("");
                          setWithdrawError(null);
                        }}
                      >
                        撤回
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={attributeOpen}
        title="记录子群体标签"
        description="需单独同意；标签为假名化，仅在抑制后的聚合中使用。"
        onClose={() => setAttributeOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAttributeOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={recordAttribute}>
              记录标签
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {attributeError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{attributeError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="人员 ID" htmlFor="attribute-person">
            <TextInput
              id="attribute-person"
              value={attributePersonId}
              onChange={(event) => setAttributePersonId(event.target.value)}
              required
            />
          </FormField>
          <FormField label="维度" htmlFor="attribute-dimension">
            <Select
              id="attribute-dimension"
              value={attributeDimension}
              onChange={(event) => setAttributeDimension(event.target.value)}
            >
              {[
                "GENDER",
                "AGE_BAND",
                "REGION",
                "TENURE_BAND",
                "EMPLOYMENT_TYPE",
              ].map((dimension) => (
                <option key={dimension} value={dimension}>
                  {dimension}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="值" htmlFor="attribute-value">
            <TextInput
              id="attribute-value"
              value={attributeValue}
              onChange={(event) => setAttributeValue(event.target.value)}
              required
            />
          </FormField>
          <FormField label="同意引用" htmlFor="attribute-consent">
            <TextInput
              id="attribute-consent"
              value={attributeConsentRef}
              onChange={(event) => setAttributeConsentRef(event.target.value)}
              required
            />
          </FormField>
          <FormField label="同意时间" htmlFor="attribute-consented">
            <TextInput
              id="attribute-consented"
              type="date"
              value={attributeConsentedAt}
              onChange={(event) => setAttributeConsentedAt(event.target.value)}
              required
            />
          </FormField>
          <FormField label="过期时间（可选）" htmlFor="attribute-expires">
            <TextInput
              id="attribute-expires"
              type="date"
              value={attributeExpiresAt}
              onChange={(event) => setAttributeExpiresAt(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={Boolean(withdrawTarget)}
        title="撤回子群体标签"
        description="撤回即删除标签；聚合回退为不可用。"
        onClose={() => setWithdrawTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawTarget(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={withdrawAttribute}>
              撤回
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {withdrawError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{withdrawError}</InfoNotice>
            </div>
          ) : null}
          <FormField
            label="原因"
            htmlFor="attribute-withdraw-reason"
            className="field--full"
          >
            <Textarea
              id="attribute-withdraw-reason"
              value={withdrawReason}
              onChange={(event) => setWithdrawReason(event.target.value)}
              required
            />
          </FormField>
        </div>
      </Modal>
    </>
  );
}
