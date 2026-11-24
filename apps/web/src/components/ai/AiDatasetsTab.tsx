/**
 * AI 保障 · 金标集 tab：金标集列表、登记/刷新/导入模态。
 * 查询由页面容器持有（props 传入）；表单状态自持。
 */
import { useState } from "react";
import type { FormEvent } from "react";
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
  Textarea,
  TextInput,
} from "../ui.js";
import { PersonSelect } from "../PersonSelect.js";
import { useToast } from "../../contexts/ToastContext.js";
import { ApiError, api } from "../../lib/api.js";
import type { QueryState } from "../../lib/hooks.js";
import { formatDateTime } from "../../lib/format.js";
import type { ModelEvaluationDataset } from "../../lib/types.js";

export function AiDatasetsTab({
  datasets,
  datasetsDue,
  personId,
}: {
  datasets: QueryState<ModelEvaluationDataset[]>;
  datasetsDue: QueryState<ModelEvaluationDataset[]>;
  personId: string;
}) {
  const toast = useToast();
  const [datasetOpen, setDatasetOpen] = useState(false);
  const [datasetSaving, setDatasetSaving] = useState(false);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [datasetCode, setDatasetCode] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [datasetVersion, setDatasetVersion] = useState("1");
  const [datasetName, setDatasetName] = useState("");
  const [datasetSample, setDatasetSample] = useState("100");
  const [datasetHoldout, setDatasetHoldout] = useState("20");
  const [datasetLabelSource, setDatasetLabelSource] =
    useState("DOUBLE_ANNOTATION");
  const [datasetOwner, setDatasetOwner] = useState(personId);
  const [datasetRefreshDue, setDatasetRefreshDue] = useState("");
  const [refreshTarget, setRefreshTarget] =
    useState<ModelEvaluationDataset | null>(null);
  const [refreshVersion, setRefreshVersion] = useState("2");
  const [refreshSample, setRefreshSample] = useState("");
  const [refreshHoldout, setRefreshHoldout] = useState("");
  const [refreshDue, setRefreshDue] = useState("");
  const [refreshSaving, setRefreshSaving] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  function openRefresh(dataset: ModelEvaluationDataset) {
    setRefreshTarget(dataset);
    setRefreshVersion(String(dataset.version + 1));
    setRefreshSample(String(dataset.sampleSize));
    setRefreshHoldout(String(dataset.holdoutSize));
    setRefreshDue("");
    setRefreshError(null);
  }

  async function saveRefresh(event: FormEvent) {
    event.preventDefault();
    if (!refreshTarget) return;
    setRefreshSaving(true);
    setRefreshError(null);
    try {
      await api(
        `/api/v1/model-evaluation-datasets/${refreshTarget.id}/refresh`,
        {
          method: "POST",
          body: {
            version: Number(refreshVersion),
            sampleSize: Number(refreshSample),
            holdoutSize: Number(refreshHoldout),
            nextRefreshDueAt: refreshDue
              ? new Date(`${refreshDue}T00:00:00Z`).toISOString()
              : undefined,
          },
        },
      );
      toast.success("金标集已刷新");
      setRefreshTarget(null);
      datasets.reload();
    } catch (error) {
      setRefreshError(
        error instanceof Error
          ? error.message
          : "无法刷新金标集。",
      );
    } finally {
      setRefreshSaving(false);
    }
  }

  async function importGoldSet(event: FormEvent) {
    event.preventDefault();
    setImportError(null);
    try {
      const payload = JSON.parse(importText) as Record<string, unknown>;
      await api("/api/v1/model-evaluation-datasets:import", {
        method: "POST",
        body: payload,
      });
      toast.success("金标集已导入", "样本已落库，可直接按 datasetRef 复跑");
      setImportOpen(false);
      datasets.reload();
    } catch (caught) {
      setImportError(
        caught instanceof ApiError ? caught.message : "导入失败",
      );
    }
  }

  function openDatasetForm() {
    setDatasetCode("");
    setDatasetVersion("1");
    setDatasetName("");
    setDatasetSample("100");
    setDatasetHoldout("20");
    setDatasetLabelSource("DOUBLE_ANNOTATION");
    setDatasetOwner(personId);
    setDatasetRefreshDue("");
    setDatasetError(null);
    setDatasetOpen(true);
  }

  async function saveDataset(event: FormEvent) {
    event.preventDefault();
    setDatasetSaving(true);
    setDatasetError(null);
    try {
      await api("/api/v1/model-evaluation-datasets", {
        method: "POST",
        body: {
          code: datasetCode.trim(),
          version: Number(datasetVersion),
          name: datasetName.trim(),
          sampleSize: Number(datasetSample),
          holdoutSize: Number(datasetHoldout),
          labelSource: datasetLabelSource.trim(),
          ownerPersonId: datasetOwner,
          nextRefreshDueAt: datasetRefreshDue
            ? new Date(`${datasetRefreshDue}T00:00:00Z`).toISOString()
            : undefined,
        },
      });
      toast.success("金标集已登记");
      setDatasetOpen(false);
      datasets.reload();
    } catch (error) {
      setDatasetError(
        error instanceof Error
          ? error.message
          : "无法登记金标集。",
      );
    } finally {
      setDatasetSaving(false);
    }
  }

  async function retireDataset(dataset: ModelEvaluationDataset) {
    try {
      await api(`/api/v1/model-evaluation-datasets/${dataset.id}/retire`, {
        method: "POST",
      });
      toast.success("金标集已退役");
      datasets.reload();
    } catch (error) {
      toast.error(
        "无法退役金标集",
        error instanceof Error ? error.message : "操作失败。",
      );
    }
  }

  return (
    <>
      <Panel
        title="金标集"
        subtitle="带留出集与刷新跟踪的版本化评测数据集"
        action={
          <div className="row-actions">
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              onClick={openDatasetForm}
            >
              登记金标集
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setImportText("");
                setImportError(null);
                setImportOpen(true);
              }}
            >
              导入金标集
            </Button>
          </div>
        }
        flush
      >
        {datasetsDue.data && datasetsDue.data.length > 0 ? (
          <div style={{ padding: "14px 16px 0" }}>
            <InfoNotice tone="warning">
              {datasetsDue.data.length} gold set(s) due for refresh within 30
              days:{" "}
              {datasetsDue.data
                .map((dataset) => `${dataset.code} v${dataset.version}`)
                .join(", ")}
              .
            </InfoNotice>
          </div>
        ) : null}
        {datasets.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={datasets.error} onRetry={datasets.reload} />
          </div>
        ) : datasets.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : (datasets.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="chart"
            title="暂无金标集"
            description="启用金标集强制前，先登记带留出集与季度刷新日期的标注数据集。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>金标集</th>
                  <th className="cell-num">样本</th>
                  <th className="cell-num">留出集</th>
                  <th>标签</th>
                  <th>待刷新</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {datasets.data?.map((dataset) => (
                  <tr key={dataset.id}>
                    <td>
                      <span className="cell-primary">
                        {dataset.code} · v{dataset.version}
                      </span>
                      <span className="cell-sub">{dataset.name}</span>
                    </td>
                    <td className="cell-num">{dataset.sampleSize}</td>
                    <td className="cell-num">{dataset.holdoutSize}</td>
                    <td>{dataset.labelSource}</td>
                    <td className="nowrap">
                      {dataset.nextRefreshDueAt
                        ? formatDateTime(dataset.nextRefreshDueAt)
                        : "—"}
                      {dataset.nextRefreshDueAt &&
                      new Date(dataset.nextRefreshDueAt).getTime() <
                        Date.now() ? (
                        <span className="cell-sub">
                          <Badge tone="warning">待刷新</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <Badge status={dataset.status} />
                    </td>
                    <td className="cell-actions">
                      {dataset.status === "ACTIVE" ? (
                        <div className="row-actions">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openRefresh(dataset)}
                          >
                            刷新
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void retireDataset(dataset)}
                          >
                            退役
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={datasetOpen}
        title="登记金标集"
        description="留出集必须小于样本；刷新请新建版本。"
        onClose={() => setDatasetOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDatasetOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="dataset-form"
              loading={datasetSaving}
            >
              登记
            </Button>
          </>
        }
      >
        <form id="dataset-form" className="stack" onSubmit={saveDataset}>
          {datasetError ? (
            <InfoNotice tone="warning">{datasetError}</InfoNotice>
          ) : null}
          <div className="form-grid">
            <FormField label="编码" htmlFor="dataset-code">
              <TextInput
                id="dataset-code"
                value={datasetCode}
                onChange={(event) => setDatasetCode(event.target.value)}
                required
              />
            </FormField>
            <FormField label="版本" htmlFor="dataset-version">
              <TextInput
                id="dataset-version"
                type="number"
                min={1}
                value={datasetVersion}
                onChange={(event) => setDatasetVersion(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="名称"
              htmlFor="dataset-name"
              className="field--full"
            >
              <TextInput
                id="dataset-name"
                value={datasetName}
                onChange={(event) => setDatasetName(event.target.value)}
                required
              />
            </FormField>
            <FormField label="样本量" htmlFor="dataset-sample">
              <TextInput
                id="dataset-sample"
                type="number"
                min={2}
                value={datasetSample}
                onChange={(event) => setDatasetSample(event.target.value)}
                required
              />
            </FormField>
            <FormField label="留出集" htmlFor="dataset-holdout">
              <TextInput
                id="dataset-holdout"
                type="number"
                min={1}
                value={datasetHoldout}
                onChange={(event) => setDatasetHoldout(event.target.value)}
                required
              />
            </FormField>
            <FormField label="标注来源" htmlFor="dataset-label">
              <TextInput
                id="dataset-label"
                value={datasetLabelSource}
                onChange={(event) =>
                  setDatasetLabelSource(event.target.value)
                }
                required
              />
            </FormField>
            <FormField label="负责人" htmlFor="dataset-owner">
              <PersonSelect
                id="dataset-owner"
                value={datasetOwner}
                onChange={setDatasetOwner}
              />
            </FormField>
            <FormField
              label="下次刷新"
              htmlFor="dataset-refresh"
            >
              <TextInput
                id="dataset-refresh"
                type="date"
                value={datasetRefreshDue}
                onChange={(event) => setDatasetRefreshDue(event.target.value)}
              />
            </FormField>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(refreshTarget)}
        title="刷新金标集"
        description="创建新生效版本并退役当前版本。"
        onClose={() => setRefreshTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRefreshTarget(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="refresh-dataset-form"
              loading={refreshSaving}
            >
              刷新
            </Button>
          </>
        }
      >
        <form
          id="refresh-dataset-form"
          className="stack"
          onSubmit={saveRefresh}
        >
          {refreshError ? (
            <InfoNotice tone="warning">{refreshError}</InfoNotice>
          ) : null}
          <div className="form-grid">
            <FormField label="版本" htmlFor="refresh-version">
              <TextInput
                id="refresh-version"
                type="number"
                min={1}
                value={refreshVersion}
                onChange={(event) => setRefreshVersion(event.target.value)}
                required
              />
            </FormField>
            <FormField label="样本量" htmlFor="refresh-sample">
              <TextInput
                id="refresh-sample"
                type="number"
                min={2}
                value={refreshSample}
                onChange={(event) => setRefreshSample(event.target.value)}
                required
              />
            </FormField>
            <FormField label="留出集" htmlFor="refresh-holdout">
              <TextInput
                id="refresh-holdout"
                type="number"
                min={1}
                value={refreshHoldout}
                onChange={(event) => setRefreshHoldout(event.target.value)}
                required
              />
            </FormField>
            <FormField label="下次刷新" htmlFor="refresh-due">
              <TextInput
                id="refresh-due"
                type="date"
                value={refreshDue}
                onChange={(event) => setRefreshDue(event.target.value)}
              />
            </FormField>
          </div>
        </form>
      </Modal>

      <Modal
        open={importOpen}
        title="导入金标集样本"
        onClose={() => setImportOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="gold-import-form">
              导入
            </Button>
          </>
        }
      >
        <form id="gold-import-form" onSubmit={importGoldSet} className="form-grid">
          {importError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{importError}</InfoNotice>
            </div>
          ) : null}
          <FormField
            label="导入 JSON"
            className="field--full"
            hint="包含 code/name/labelSource/ownerPersonId/refreshedAt/nextRefreshDueAt/samples（至少 2 条）"
          >
            <Textarea
              rows={14}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder='{"code":"GOLD-2026Q4","name":"Q4金标集","labelSource":"专家双评","ownerPersonId":"…","refreshedAt":"2026-11-01T00:00:00Z","nextRefreshDueAt":"2027-02-01T00:00:00Z","samples":[…] }'
            />
          </FormField>
        </form>
      </Modal>
    </>
  );
}
