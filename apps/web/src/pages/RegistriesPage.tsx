import { useState } from "react";
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
  TextInput,
} from "../components/ui.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { formatDate, shortId, titleCase } from "../lib/format.js";
import type {
  CompensationTemplateView,
  MetricDefinitionView,
} from "../lib/ops-types.js";

export function RegistriesPage() {
  useDocumentTitle("登记簿");
  const toast = useToast();
  const metrics = useApiQuery<MetricDefinitionView[]>(
    "/api/v1/metric-definitions",
  );
  const templates = useApiQuery<CompensationTemplateView[]>(
    "/api/v1/compensation-templates",
  );
  const [metricOpen, setMetricOpen] = useState(false);
  const [metricCode, setMetricCode] = useState("");
  const [metricVersion, setMetricVersion] = useState("1");
  const [metricName, setMetricName] = useState("");
  const [metricDescription, setMetricDescription] = useState("");
  const [metricDataType, setMetricDataType] = useState("DECIMAL");
  const [metricUnit, setMetricUnit] = useState("");
  const [metricAggregation, setMetricAggregation] = useState("SUM");
  const [metricEffectiveFrom, setMetricEffectiveFrom] = useState("");
  const [metricError, setMetricError] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateCode, setTemplateCode] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateRoleCode, setTemplateRoleCode] = useState("");
  const [templateEmploymentType, setTemplateEmploymentType] =
    useState("FULL_TIME");
  const [templateCurrency, setTemplateCurrency] = useState("CNY");
  const [templateMin, setTemplateMin] = useState("");
  const [templateMax, setTemplateMax] = useState("");
  const [templateCap, setTemplateCap] = useState("0.2");
  const [templateVariableCap, setTemplateVariableCap] = useState("1");
  const [templateSmoothing, setTemplateSmoothing] = useState("1");
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const metricList = metrics.data ?? [];
  const templateList = templates.data ?? [];

  function openMetric() {
    setMetricCode("");
    setMetricVersion("1");
    setMetricName("");
    setMetricDescription("");
    setMetricDataType("DECIMAL");
    setMetricUnit("");
    setMetricAggregation("SUM");
    setMetricEffectiveFrom(new Date().toISOString().slice(0, 10));
    setMetricError(null);
    setMetricOpen(true);
  }

  async function createMetric() {
    setMetricError(null);
    try {
      await api("/api/v1/metric-definitions", {
        method: "POST",
        body: {
          code: metricCode.trim(),
          version: Number(metricVersion),
          name: metricName.trim(),
          description: metricDescription.trim() || undefined,
          dataType: metricDataType.trim(),
          unit: metricUnit.trim() || undefined,
          aggregationMethod: metricAggregation.trim() || undefined,
          effectiveFrom: metricEffectiveFrom,
        },
      });
      toast.success("指标定义已创建", metricCode);
      setMetricOpen(false);
      metrics.reload();
    } catch (caught) {
      setMetricError(
        caught instanceof ApiError ? caught.message : "创建指标失败",
      );
    }
  }

  function openTemplate() {
    setTemplateCode("");
    setTemplateName("");
    setTemplateRoleCode("");
    setTemplateEmploymentType("FULL_TIME");
    setTemplateCurrency("CNY");
    setTemplateMin("");
    setTemplateMax("");
    setTemplateCap("0.2");
    setTemplateVariableCap("1");
    setTemplateSmoothing("1");
    setTemplateError(null);
    setTemplateOpen(true);
  }

  async function createTemplate() {
    setTemplateError(null);
    try {
      await api("/api/v1/compensation-templates", {
        method: "POST",
        body: {
          code: templateCode.trim(),
          name: templateName.trim(),
          roleCode: templateRoleCode.trim(),
          employmentType: templateEmploymentType,
          currency: templateCurrency.toUpperCase(),
          fixedSalaryMin: templateMin,
          fixedSalaryMax: templateMax,
          deductionCapRate: templateCap,
          variableShareCapRate: templateVariableCap,
          smoothingThresholdRate: templateSmoothing,
        },
      });
      toast.success("薪酬模板已创建", templateCode);
      setTemplateOpen(false);
      templates.reload();
    } catch (caught) {
      setTemplateError(
        caught instanceof ApiError
          ? caught.message
          : "创建模板失败",
      );
    }
  }

  async function retire(
    kind: "metric" | "template",
    id: string,
    label: string,
  ) {
    setBusy(`${kind}:${id}`);
    try {
      await api(
        `/api/v1/${kind === "metric" ? "metric-definitions" : "compensation-templates"}/${id}/retire`,
        { method: "POST" },
      );
      toast.success("已退役", label);
      if (kind === "metric") metrics.reload();
      else templates.reload();
    } catch (caught) {
      toast.error(
        "退役失败",
        caught instanceof ApiError ? caught.message : undefined,
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="参考数据"
        title="登记簿"
        description="版本化指标定义与岗位薪酬模板；合同按编码引用模板并按其区间校验。"
      />

      <div className="split-grid">
        <Panel
          title="指标定义"
          subtitle="带生效日期的版本化度量"
          flush
          action={
            <Button size="sm" variant="primary" icon="plus" onClick={openMetric}>
              新建指标
            </Button>
          }
        >
          {metrics.error ? (
            <div style={{ padding: 16 }}>
              <ErrorNotice error={metrics.error} onRetry={metrics.reload} />
            </div>
          ) : metrics.loading ? (
            <div style={{ padding: 16 }}>
              <LoadingRows rows={3} />
            </div>
          ) : metricList.length === 0 ? (
            <EmptyState
              icon="chart"
              title="暂无指标定义"
              description="定义度量对象、单位与生效窗口。"
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>指标</th>
                    <th>类型</th>
                    <th>生效</th>
                    <th>状态</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {metricList.map((metric) => (
                    <tr key={metric.id}>
                      <td>
                        <span className="cell-primary">{metric.code}</span>
                        <span className="cell-sub">
                          {metric.name} · v{metric.version}
                        </span>
                      </td>
                      <td>
                        {metric.dataType}
                        {metric.unit ? ` · ${metric.unit}` : ""}
                      </td>
                      <td className="nowrap">
                        {formatDate(metric.effectiveFrom)}
                      </td>
                      <td>
                        <Badge tone={metric.active ? "success" : "neutral"}>
                          {metric.active ? "生效中" : "已退役"}
                        </Badge>
                      </td>
                      <td className="cell-actions">
                        {metric.active ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busy === `metric:${metric.id}`}
                            onClick={() =>
                              retire("metric", metric.id, metric.code)
                            }
                          >
                            退役
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

        <Panel
          title="薪酬模板"
          subtitle="岗位、用工类型与薪资区间"
          flush
          action={
            <Button
              size="sm"
              variant="primary"
              icon="plus"
              onClick={openTemplate}
            >
              新建模板
            </Button>
          }
        >
          {templates.error ? (
            <div style={{ padding: 16 }}>
              <ErrorNotice error={templates.error} onRetry={templates.reload} />
            </div>
          ) : templates.loading ? (
            <div style={{ padding: 16 }}>
              <LoadingRows rows={3} />
            </div>
          ) : templateList.length === 0 ? (
            <EmptyState
              icon="payroll"
              title="暂无薪酬模板"
              description="模板保证各合同的岗位薪酬结构一致。"
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>模板</th>
                    <th>角色</th>
                    <th>区间</th>
                    <th>状态</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {templateList.map((template) => (
                    <tr key={template.id}>
                      <td>
                        <span className="cell-primary">{template.code}</span>
                        <span className="cell-sub">{template.name}</span>
                      </td>
                      <td>
                        {template.roleCode}
                        <span className="cell-sub">
                          {titleCase(template.employmentType)}
                        </span>
                      </td>
                      <td>
                        {template.fixedSalaryMin} – {template.fixedSalaryMax}{" "}
                        {template.currency}
                      </td>
                      <td>
                        <Badge
                          tone={
                            template.status === "ACTIVE" ? "success" : "neutral"
                          }
                        >
                          {titleCase(template.status)}
                        </Badge>
                      </td>
                      <td className="cell-actions">
                        {template.status === "ACTIVE" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busy === `template:${template.id}`}
                            onClick={() =>
                              retire("template", template.id, template.code)
                            }
                          >
                            退役
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
      </div>

      <Modal
        open={metricOpen}
        title="新建指标定义"
        onClose={() => setMetricOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMetricOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={createMetric}>
              创建指标
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {metricError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{metricError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="编码" htmlFor="metric-code">
            <TextInput
              id="metric-code"
              value={metricCode}
              onChange={(event) => setMetricCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="版本" htmlFor="metric-version">
            <TextInput
              id="metric-version"
              value={metricVersion}
              onChange={(event) => setMetricVersion(event.target.value)}
              required
            />
          </FormField>
          <FormField label="名称" htmlFor="metric-name">
            <TextInput
              id="metric-name"
              value={metricName}
              onChange={(event) => setMetricName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="数据类型" htmlFor="metric-datatype">
            <TextInput
              id="metric-datatype"
              value={metricDataType}
              onChange={(event) => setMetricDataType(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Unit" htmlFor="metric-unit">
            <TextInput
              id="metric-unit"
              value={metricUnit}
              onChange={(event) => setMetricUnit(event.target.value)}
            />
          </FormField>
          <FormField label="聚合方式" htmlFor="metric-aggregation">
            <TextInput
              id="metric-aggregation"
              value={metricAggregation}
              onChange={(event) => setMetricAggregation(event.target.value)}
            />
          </FormField>
          <FormField label="生效自" htmlFor="metric-effective">
            <TextInput
              id="metric-effective"
              type="date"
              value={metricEffectiveFrom}
              onChange={(event) => setMetricEffectiveFrom(event.target.value)}
              required
            />
          </FormField>
          <FormField label="说明" htmlFor="metric-description">
            <TextInput
              id="metric-description"
              value={metricDescription}
              onChange={(event) => setMetricDescription(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={templateOpen}
        title="新建薪酬模板"
        description="引用该模板的合同必须匹配其用工类型、币种与薪资区间。"
        onClose={() => setTemplateOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setTemplateOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={createTemplate}>
              创建模板
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {templateError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{templateError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="编码" htmlFor="template-code">
            <TextInput
              id="template-code"
              value={templateCode}
              onChange={(event) => setTemplateCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="名称" htmlFor="template-name">
            <TextInput
              id="template-name"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="岗位编码" htmlFor="template-role">
            <TextInput
              id="template-role"
              value={templateRoleCode}
              onChange={(event) => setTemplateRoleCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="用工类型" htmlFor="template-type">
            <Select
              id="template-type"
              value={templateEmploymentType}
              onChange={(event) => setTemplateEmploymentType(event.target.value)}
            >
              {["FULL_TIME", "PART_TIME", "CONTRACTOR"].map((type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="币种" htmlFor="template-currency">
            <TextInput
              id="template-currency"
              value={templateCurrency}
              maxLength={3}
              onChange={(event) =>
                setTemplateCurrency(event.target.value.toUpperCase())
              }
              required
            />
          </FormField>
          <FormField label="薪资下限" htmlFor="template-min">
            <TextInput
              id="template-min"
              value={templateMin}
              onChange={(event) => setTemplateMin(event.target.value)}
              required
            />
          </FormField>
          <FormField label="薪资上限" htmlFor="template-max">
            <TextInput
              id="template-max"
              value={templateMax}
              onChange={(event) => setTemplateMax(event.target.value)}
              required
            />
          </FormField>
          <FormField label="扣款上限" htmlFor="template-cap">
            <TextInput
              id="template-cap"
              value={templateCap}
              onChange={(event) => setTemplateCap(event.target.value)}
              required
            />
          </FormField>
          <FormField label="浮动占比上限" htmlFor="template-variable">
            <TextInput
              id="template-variable"
              value={templateVariableCap}
              onChange={(event) => setTemplateVariableCap(event.target.value)}
              required
            />
          </FormField>
          <FormField label="平滑阈值" htmlFor="template-smoothing">
            <TextInput
              id="template-smoothing"
              value={templateSmoothing}
              onChange={(event) => setTemplateSmoothing(event.target.value)}
              required
            />
          </FormField>
        </div>
      </Modal>
    </>
  );
}
