import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  Tabs,
  TextInput,
  Textarea,
} from "../ui.js";
import { Icon } from "../Icon.js";
import { useToast } from "../../contexts/ToastContext.js";
import { api, ApiError } from "../../lib/api.js";
import { useApiQuery } from "../../lib/hooks.js";
import { formatDateTime, formatRelative, shortId } from "../../lib/format.js";
import type {
  IntegrationConnection,
  IntegrationMapping,
  MappingPreset,
  SyncRun,
  SyncSchedule,
} from "../../lib/types.js";
import type { ExternalIdentityView } from "../../lib/ops-types.js";

export function MappingsSection({
  connection,
  mappings,
  loading,
  error,
  presets,
  reload,
}: {
  connection: IntegrationConnection;
  mappings: IntegrationMapping[];
  loading: boolean;
  error: Error | undefined;
  presets: MappingPreset[];
  reload: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mappingType, setMappingType] = useState("HTTP_JSON");
  const [sourceSystem, setSourceSystem] = useState("");
  const [targetType, setTargetType] = useState("EVIDENCE");
  const [fieldMap, setFieldMap] = useState("");
  const [config, setConfig] = useState("{}");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retireTarget, setRetireTarget] = useState<IntegrationMapping | null>(null);
  const [retireError, setRetireError] = useState<string | null>(null);

  const availablePresets = useMemo(
    () =>
      presets.filter(
        (preset) =>
          !preset.provider ||
          preset.provider === connection.provider ||
          connection.provider.includes(preset.provider),
      ),
    [presets, connection.provider],
  );

  function openForm(preset?: MappingPreset) {
    setName(preset ? `${preset.name}` : "");
    setMappingType(preset?.mappingType ?? "HTTP_JSON");
    setSourceSystem(preset?.sourceSystem ?? connection.provider);
    setTargetType(preset?.targetType ?? "EVIDENCE");
    setFieldMap(
      JSON.stringify(preset?.fieldMap ?? { sourceRecordId: "id", subjectId: "id" }, null, 2),
    );
    setConfig(JSON.stringify(preset?.config ?? {}, null, 2));
    setFormError(null);
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    let parsedFieldMap: unknown;
    let parsedConfig: unknown = {};
    try {
      parsedFieldMap = JSON.parse(fieldMap);
      parsedConfig = config.trim() ? JSON.parse(config) : {};
    } catch {
      setFormError("字段映射与配置必须是合法 JSON。");
      return;
    }
    if (
      !parsedFieldMap ||
      typeof parsedFieldMap !== "object" ||
      Array.isArray(parsedFieldMap) ||
      Object.values(parsedFieldMap).some((value) => typeof value !== "string")
    ) {
      setFormError("字段映射必须是 JSON 对象且值为字符串。");
      return;
    }
    setSubmitting(true);
    try {
      await api(`/api/v1/integration-connections/${connection.id}/mappings`, {
        method: "POST",
        body: {
          name: name.trim(),
          mappingType,
          sourceSystem: sourceSystem.trim(),
          targetType: targetType.trim(),
          fieldMap: parsedFieldMap,
          config: parsedConfig,
          version: 1,
        },
      });
      toast.success("映射已创建", name);
      setOpen(false);
      reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "创建映射失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function retire() {
    if (!retireTarget) return;
    setSubmitting(true);
    setRetireError(null);
    try {
      await api(`/api/v1/integration-mappings/${retireTarget.id}/retire`, {
        method: "POST",
      });
      toast.success("映射已退役", retireTarget.name);
      setRetireTarget(null);
      reload();
    } catch (caught) {
      setRetireError(
        caught instanceof Error ? caught.message : "退役映射失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <span className="muted" style={{ fontSize: 12 }}>
          {mappings.filter((mapping) => mapping.status === "ACTIVE").length} active
          mapping{mappings.filter((mapping) => mapping.status === "ACTIVE").length === 1 ? "" : "s"}
        </span>
        <Button size="sm" variant="primary" icon="plus" onClick={() => openForm()}>
          新建映射
        </Button>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading ? (
        <LoadingRows rows={3} />
      ) : mappings.length === 0 ? (
        <EmptyState
          icon="layers"
          title="暂无字段映射"
          description="将来源字段映射到证据契约。预设覆盖 HubSpot 交易、飞书多维表格与 ERP 订单。"
          action={
            <Button variant="primary" size="sm" onClick={() => openForm()}>
              新建映射
            </Button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>映射</th>
                <th>类型</th>
                <th>Source → target</th>
                <th>字段</th>
                <th>版本</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr key={mapping.id}>
                  <td>
                    <span className="cell-primary">{mapping.name}</span>
                    <span className="cell-sub mono">{shortId(mapping.id, 12)}</span>
                  </td>
                  <td>{mapping.mappingType}</td>
                  <td>
                    {mapping.sourceSystem} → {mapping.targetType}
                  </td>
                  <td>{Object.keys(mapping.fieldMap ?? {}).length}</td>
                  <td>v{mapping.version}</td>
                  <td>
                    <Badge status={mapping.status} />
                  </td>
                  <td className="cell-actions">
                    {mapping.status === "ACTIVE" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRetireError(null);
                          setRetireTarget(mapping);
                        }}
                      >
                        退役
                      </Button>
                    ) : (
                      <span className="subtle">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        title="新建字段映射"
        description="预设只是起点——创建版本前请逐项核对。"
        onClose={() => setOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-mapping-form"
              loading={submitting}
            >
              创建映射
            </Button>
          </>
        }
      >
        <form id="create-mapping-form" onSubmit={submit} className="stack">
          {formError ? <InfoNotice tone="warning">{formError}</InfoNotice> : null}
          {availablePresets.length > 0 ? (
            <div>
              <div className="form-section__title">供应商预设</div>
              <div className="preset-grid">
                {availablePresets.map((preset) => (
                  <button
                    type="button"
                    className="preset-card"
                    key={preset.code}
                    onClick={() => openForm(preset)}
                  >
                    <strong>{preset.name}</strong>
                    <span>
                      {preset.sourceSystem} → {preset.targetType} · {preset.code}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="form-grid">
            <FormField label="名称" htmlFor="mapping-name">
              <TextInput
                id="mapping-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </FormField>
            <FormField label="映射类型" htmlFor="mapping-type">
              <Select
                id="mapping-type"
                value={mappingType}
                onChange={(event) => setMappingType(event.target.value)}
              >
                <option value="HTTP_JSON">HTTP JSON</option>
                <option value="CSV">CSV</option>
              </Select>
            </FormField>
            <FormField label="来源系统" htmlFor="mapping-source">
              <TextInput
                id="mapping-source"
                value={sourceSystem}
                onChange={(event) => setSourceSystem(event.target.value)}
                required
              />
            </FormField>
            <FormField label="对象类型" htmlFor="mapping-target">
              <TextInput
                id="mapping-target"
                value={targetType}
                onChange={(event) => setTargetType(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="字段映射（JSON）"
              htmlFor="mapping-fields"
              className="field--full"
              hint="键为目标字段；值为来源路径。"
            >
              <Textarea
                id="mapping-fields"
                value={fieldMap}
                onChange={(event) => setFieldMap(event.target.value)}
                className="input mono"
                spellCheck={false}
              />
            </FormField>
            <FormField
              label="配置（JSON）"
              htmlFor="mapping-config"
              className="field--full"
            >
              <Textarea
                id="mapping-config"
                value={config}
                onChange={(event) => setConfig(event.target.value)}
                className="input mono"
                spellCheck={false}
              />
            </FormField>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(retireTarget)}
        title="退役映射"
        description="退役映射保留可读供审计，但不再接受新同步。"
        onClose={() => setRetireTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRetireTarget(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={retire} loading={submitting}>
              退役映射
            </Button>
          </>
        }
      >
        {retireTarget ? (
          <div className="stack">
            {retireError ? (
              <InfoNotice tone="warning">{retireError}</InfoNotice>
            ) : null}
            <DefinitionList
              items={[
                { label: "映射", value: retireTarget.name },
                { label: "版本", value: `v${retireTarget.version}` },
                { label: "来源", value: retireTarget.sourceSystem },
              ]}
            />
          </div>
        ) : null}
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------- schedules */

