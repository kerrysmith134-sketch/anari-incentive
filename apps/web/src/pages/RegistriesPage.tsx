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
  useDocumentTitle("Registries");
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
      toast.success("Metric definition created", metricCode);
      setMetricOpen(false);
      metrics.reload();
    } catch (caught) {
      setMetricError(
        caught instanceof ApiError ? caught.message : "Could not create metric",
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
      toast.success("Compensation template created", templateCode);
      setTemplateOpen(false);
      templates.reload();
    } catch (caught) {
      setTemplateError(
        caught instanceof ApiError
          ? caught.message
          : "Could not create template",
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
      toast.success("Retired", label);
      if (kind === "metric") metrics.reload();
      else templates.reload();
    } catch (caught) {
      toast.error(
        "Could not retire",
        caught instanceof ApiError ? caught.message : undefined,
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Reference data"
        title="Registries"
        description="Versioned metric definitions and role compensation templates. Contracts reference a template by code and are validated against its range."
      />

      <div className="split-grid">
        <Panel
          title="Metric definitions"
          subtitle="Versioned measures with effective dates"
          flush
          action={
            <Button size="sm" variant="primary" icon="plus" onClick={openMetric}>
              New metric
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
              title="No metric definition"
              description="Define what is measured, its unit and effective window."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Type</th>
                    <th>Effective</th>
                    <th>Status</th>
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
                          {metric.active ? "Active" : "Retired"}
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
                            Retire
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
          title="Compensation templates"
          subtitle="Role, employment type and salary band"
          flush
          action={
            <Button
              size="sm"
              variant="primary"
              icon="plus"
              onClick={openTemplate}
            >
              New template
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
              title="No compensation template"
              description="Templates keep role pay structures consistent across contracts."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Template</th>
                    <th>Role</th>
                    <th>Band</th>
                    <th>Status</th>
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
                            Retire
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
        title="New metric definition"
        onClose={() => setMetricOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMetricOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createMetric}>
              Create metric
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
          <FormField label="Code" htmlFor="metric-code">
            <TextInput
              id="metric-code"
              value={metricCode}
              onChange={(event) => setMetricCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Version" htmlFor="metric-version">
            <TextInput
              id="metric-version"
              value={metricVersion}
              onChange={(event) => setMetricVersion(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Name" htmlFor="metric-name">
            <TextInput
              id="metric-name"
              value={metricName}
              onChange={(event) => setMetricName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Data type" htmlFor="metric-datatype">
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
          <FormField label="Aggregation" htmlFor="metric-aggregation">
            <TextInput
              id="metric-aggregation"
              value={metricAggregation}
              onChange={(event) => setMetricAggregation(event.target.value)}
            />
          </FormField>
          <FormField label="Effective from" htmlFor="metric-effective">
            <TextInput
              id="metric-effective"
              type="date"
              value={metricEffectiveFrom}
              onChange={(event) => setMetricEffectiveFrom(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Description" htmlFor="metric-description">
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
        title="New compensation template"
        description="Contracts referencing this template must match its type, currency and salary band."
        onClose={() => setTemplateOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setTemplateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createTemplate}>
              Create template
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
          <FormField label="Code" htmlFor="template-code">
            <TextInput
              id="template-code"
              value={templateCode}
              onChange={(event) => setTemplateCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Name" htmlFor="template-name">
            <TextInput
              id="template-name"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Role code" htmlFor="template-role">
            <TextInput
              id="template-role"
              value={templateRoleCode}
              onChange={(event) => setTemplateRoleCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Employment type" htmlFor="template-type">
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
          <FormField label="Currency" htmlFor="template-currency">
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
          <FormField label="Salary min" htmlFor="template-min">
            <TextInput
              id="template-min"
              value={templateMin}
              onChange={(event) => setTemplateMin(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Salary max" htmlFor="template-max">
            <TextInput
              id="template-max"
              value={templateMax}
              onChange={(event) => setTemplateMax(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Deduction cap" htmlFor="template-cap">
            <TextInput
              id="template-cap"
              value={templateCap}
              onChange={(event) => setTemplateCap(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Variable share cap" htmlFor="template-variable">
            <TextInput
              id="template-variable"
              value={templateVariableCap}
              onChange={(event) => setTemplateVariableCap(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Smoothing threshold" htmlFor="template-smoothing">
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
