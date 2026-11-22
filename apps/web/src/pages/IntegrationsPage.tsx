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
  PageHeader,
  Panel,
  Select,
  Tabs,
  TextInput,
  Textarea,
} from "../components/ui.js";
import { IntegrationWizard } from "../components/integration-wizard.js";
import { useAuth } from "../contexts/AuthContext.js";
import { OpsSection } from "../components/settings/ops-section.js";
import { Icon } from "../components/Icon.js";
import { useToast } from "../contexts/ToastContext.js";
import { api, ApiError } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  formatDateTime,
  formatRelative,
  shortId,
} from "../lib/format.js";
import type {
  IntegrationConnection,
  IntegrationMapping,
  MappingPreset,
  SyncRun,
  SyncSchedule,
} from "../lib/types.js";
import type { ExternalIdentityView } from "../lib/ops-types.js";

export function IntegrationsPage() {
  const { session } = useAuth();
  useDocumentTitle("集成");
  const toast = useToast();
  const connections = useApiQuery<IntegrationConnection[]>(
    "/api/v1/integration-connections",
  );
  const presets = useApiQuery<MappingPreset[]>("/api/v1/integration-mapping-presets");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState("mappings");
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    checks: Array<{ name: string; ok: boolean; detail?: string }>;
    testedAt: string;
  } | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const list = connections.data ?? [];
  const selected = list.find((connection) => connection.id === selectedId);

  useEffect(() => {
    if (!selectedId && list[0]?.id) setSelectedId(list[0].id);
    if (selectedId && !list.some((item) => item.id === selectedId)) {
      setSelectedId(list[0]?.id ?? null);
    }
  }, [list, selectedId]);

  const mappings = useApiQuery<IntegrationMapping[]>(
    selected ? `/api/v1/integration-connections/${selected.id}/mappings` : null,
    selected?.id,
  );
  const schedules = useApiQuery<SyncSchedule[]>(
    selected ? `/api/v1/integration-connections/${selected.id}/schedules` : null,
    selected?.id,
  );
  const syncRuns = useApiQuery<SyncRun[]>(
    selected ? `/api/v1/integration-connections/${selected.id}/sync-runs` : null,
    selected?.id,
  );

  function openCreate() {
    setCreateOpen(true);
  }

    async function testConnection(connectionId: string) {
    setTestBusy(true);
    try {
      const result = await api<{
        ok: boolean;
        checks: Array<{ name: string; ok: boolean; detail?: string }>;
        testedAt: string;
      }>(`/api/v1/integration-connections/${connectionId}/test`);
      setTestResult(result);
      toast.success(
        result.ok ? "连接检查通过" : "连接检查未通过",
        result.checks.map((check) => check.name).join(" / "),
      );
    } catch (caught) {
      toast.error(
        caught instanceof ApiError ? caught.message : "测试失败",
      );
    } finally {
      setTestBusy(false);
    }
  }

  async function toggleStatus(connection: IntegrationConnection) {
    setStatusBusy(true);
    setActionError(null);
    const next = connection.status.toUpperCase() === "ACTIVE" ? "DISCONNECTED" : "ACTIVE";
    try {
      await api(`/api/v1/integration-connections/${connection.id}/status`, {
        method: "POST",
        body: { status: next },
      });
      toast.success(
        next === "ACTIVE" ? "连接已启用" : "连接已断开",
        connection.connectionName,
      );
      connections.reload();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "修改状态失败。",
      );
    } finally {
      setStatusBusy(false);
    }
  }

  async function queueSync(connection: IntegrationConnection) {
    setStatusBusy(true);
    setActionError(null);
    try {
      await api(`/api/v1/integration-connections/${connection.id}/sync-runs`, {
        method: "POST",
        body: { status: "QUEUED" },
      });
      toast.success("同步已排队", connection.connectionName);
      syncRuns.reload();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "排队同步失败。",
      );
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="数据通道"
        title="集成"
        description="连接、版本化字段映射与到期计划认领。凭据只存引用；映射修改即新建版本。"
        actions={
          <>
            <Button
              variant="secondary"
              icon="refresh"
              onClick={() => connections.reload()}
              loading={connections.loading}
            >
              刷新
            </Button>
            <Button variant="primary" icon="plus" onClick={openCreate}>
              连接
            </Button>
          </>
        }
      />

      {actionError ? (
        <div style={{ marginBottom: 16 }}>
          <InfoNotice tone="warning">{actionError}</InfoNotice>
        </div>
      ) : null}

      <Panel
        title="飞书通讯录同步"
        subtitle="部门→组织节点、成员→人员、负责人→汇报线；职务从不影响角色"
      >
        <FeishuSyncPanel />
      </Panel>

      {connections.error ? (
        <ErrorNotice error={connections.error} onRetry={connections.reload} />
      ) : connections.loading ? (
        <Panel title="连接">
          <LoadingRows rows={3} />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon="integrations"
            title="暂无集成连接"
            description="先添加供应商连接，再挂接版本化映射与同步计划。"
            action={
              <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                新建连接（向导）
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="connection-grid">
            {list.map((connection) => (
              <button
                type="button"
                key={connection.id}
                className={`connection-card ${selectedId === connection.id ? "is-selected" : ""}`}
                onClick={() => setSelectedId(connection.id)}
              >
                <div className="connection-card__top">
                  <div className="inline">
                    <span className="connection-card__icon">
                      <Icon name="integrations" size={17} />
                    </span>
                    <div>
                      <h3>{connection.connectionName}</h3>
                      <div className="connection-card__provider">
                        {connection.provider}
                      </div>
                    </div>
                  </div>
                  <Badge status={connection.status} />
                </div>
                <div className="connection-card__meta">
                  <span>
                    Last sync{" "}
                    <strong>
                      {connection.lastSyncAt
                        ? formatRelative(connection.lastSyncAt)
                        : "never"}
                    </strong>
                  </span>
                  <span className="chip">{shortId(connection.id, 8)}</span>
                </div>
              </button>
            ))}
          </div>

          {selected ? (
            <div className="integration-detail section-gap">
              <Panel
                title={selected.connectionName}
                subtitle={`${selected.provider} · 凭据引用 ${selected.credentialRef}`}
                action={
                  <div className="row-actions">
                    <Badge status={selected.status} />
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={testBusy}
                      onClick={() => void testConnection(selected.id)}
                    >
                      测试连接
                    </Button>
                  </div>
                }
              >
                <Tabs
                  items={[
                    {
                      id: "mappings",
                      label: "字段映射",
                      count: mappings.data?.length ?? 0,
                    },
                    {
                      id: "schedules",
                      label: "同步计划",
                      count: schedules.data?.length ?? 0,
                    },
                    {
                      id: "runs",
                      label: "同步运行",
                      count: syncRuns.data?.length ?? 0,
                    },
                    { id: "identities", label: "身份映射" },
                    { id: "ops", label: "运营" },
                  ]}
                  active={detailTab}
                  onChange={setDetailTab}
                  label="连接详情"
                />
                {testResult ? (
                  <div
                    className="section-gap"
                    style={{ padding: "0 16px 12px" }}
                  >
                    <InfoNotice tone={testResult.ok ? "success" : "warning"}>
                      {testResult.ok ? "✅ 连接检查通过" : "⚠️ 连接检查未通过"}
                      {" · "}
                      {testResult.checks
                        .map(
                          (check) =>
                            `${check.name}：${check.ok ? "通过" : check.detail ?? "未通过"}`,
                        )
                        .join("；")}
                    </InfoNotice>
                  </div>
                ) : null}
                <div className="tab-panel">
                  {detailTab === "mappings" ? (
                    <MappingsSection
                      connection={selected}
                      mappings={mappings.data ?? []}
                      loading={mappings.loading}
                      error={
                        mappings.error instanceof Error
                          ? mappings.error
                          : undefined
                      }
                      presets={presets.data ?? []}
                      reload={mappings.reload}
                    />
                  ) : null}
                  {detailTab === "schedules" ? (
                    <SchedulesSection
                      connection={selected}
                      schedules={schedules.data ?? []}
                      loading={schedules.loading}
                      error={
                        schedules.error instanceof Error
                          ? schedules.error
                          : undefined
                      }
                      reload={schedules.reload}
                    />
                  ) : null}
                  {detailTab === "runs" ? (
                    <RunsSection
                      connection={selected}
                      runs={syncRuns.data ?? []}
                      loading={syncRuns.loading}
                      error={
                        syncRuns.error instanceof Error ? syncRuns.error : undefined
                      }
                      reload={syncRuns.reload}
                      onQueue={() => void queueSync(selected)}
                      busy={statusBusy}
                    />
                  ) : null}
                  {detailTab === "identities" ? (
                    <IdentitiesSection />
                  ) : null}
                  {detailTab === "ops" ? (
                    <OpsSection connection={selected} session={session} />
                  ) : null}
                </div>
              </Panel>

              <div className="stack">
                <Panel title="连接">
                  <DefinitionList
                    items={[
                      { label: "供应商", value: selected.provider },
                      {
                        label: "凭据引用",
                        value: (
                          <span className="mono">{selected.credentialRef}</span>
                        ),
                      },
                      {
                        label: "最近同步",
                        value: selected.lastSyncAt
                          ? formatDateTime(selected.lastSyncAt)
                          : "从未",
                      },
                      {
                        label: "创建时间",
                        value: formatDateTime(selected.createdAt),
                      },
                    ]}
                  />
                  <div className="row-actions section-gap" style={{ flexWrap: "wrap" }}>
                    <Button
                      size="sm"
                      variant={
                        selected.status.toUpperCase() === "ACTIVE"
                          ? "danger"
                          : "primary"
                      }
                      loading={statusBusy}
                      onClick={() => void toggleStatus(selected)}
                    >
                      {selected.status.toUpperCase() === "ACTIVE"
                        ? "Disconnect"
                        : "激活"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="play"
                      loading={statusBusy}
                      onClick={() => void queueSync(selected)}
                    >
                      排队同步
                    </Button>
                  </div>
                </Panel>

                <Panel title="配置" subtitle="非敏感连接配置">
                  <pre className="code-block">
                    {JSON.stringify(selected.config ?? {}, null, 2)}
                  </pre>
                </Panel>
              </div>
            </div>
          ) : null}
        </>
      )}

      <IntegrationWizard
        open={createOpen}
        presets={presets.data ?? []}
        onClose={() => setCreateOpen(false)}
        onCreated={() => connections.reload()}
      />
    </>
  );
}

/* -------------------------------------------------------------- mappings */

function MappingsSection({
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

function SchedulesSection({
  connection,
  schedules,
  loading,
  error,
  reload,
}: {
  connection: IntegrationConnection;
  schedules: SyncSchedule[];
  loading: boolean;
  error: Error | undefined;
  reload: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const [startAt, setStartAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  function openForm() {
    setName(`${connection.provider} sync`);
    setIntervalMinutes("60");
    setStartAt("");
    setFormError(null);
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api(`/api/v1/integration-connections/${connection.id}/schedules`, {
        method: "POST",
        body: {
          name: name.trim(),
          intervalMinutes: Math.max(1, Math.floor(Number(intervalMinutes))),
          startAt: startAt ? new Date(startAt).toISOString() : undefined,
        },
      });
      toast.success("计划已创建", name);
      setOpen(false);
      reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "创建计划失败。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function toggle(schedule: SyncSchedule) {
    setToggling(schedule.id);
    try {
      await api(`/api/v1/sync-schedules/${schedule.id}/status`, {
        method: "POST",
        body: { enabled: !schedule.enabled },
      });
      toast.success(
        schedule.enabled ? "Schedule paused" : "Schedule enabled",
        schedule.name,
      );
      reload();
    } catch (caught) {
      toast.error(
        "修改计划失败",
        caught instanceof Error ? caught.message : undefined,
      );
    } finally {
      setToggling(null);
    }
  }

  return (
    <>
      <div className="toolbar">
        <span className="muted" style={{ fontSize: 12 }}>
          同步执行器原子认领到期计划。
        </span>
        <Button size="sm" variant="primary" icon="plus" onClick={openForm}>
          新建计划
        </Button>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading ? (
        <LoadingRows rows={2} />
      ) : schedules.length === 0 ? (
        <EmptyState
          icon="clock"
          title="暂无同步计划"
          description="设置重复间隔，执行器才能认领并排队同步。"
          action={
            <Button variant="primary" size="sm" onClick={openForm}>
              新建计划
            </Button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>计划</th>
                <th>间隔</th>
                <th>下次运行</th>
                <th>最近运行</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schedules.map((schedule) => (
                <tr key={schedule.id}>
                  <td>
                    <span className="cell-primary">{schedule.name}</span>
                    <span className="cell-sub mono">{shortId(schedule.id, 10)}</span>
                  </td>
                  <td>{schedule.intervalMinutes} min</td>
                  <td>{formatDateTime(schedule.nextRunAt)}</td>
                  <td>{schedule.lastRunAt ? formatRelative(schedule.lastRunAt) : "从未"}</td>
                  <td>
                    <Badge
                      tone={schedule.enabled ? "success" : "warning"}
                    >
                      {schedule.enabled ? "Enabled" : "Paused"}
                    </Badge>
                  </td>
                  <td className="cell-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={toggling === schedule.id}
                      onClick={() => void toggle(schedule)}
                    >
                      {schedule.enabled ? "Pause" : "Enable"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        title="新建同步计划"
        description="间隔单位为分钟；到期后由同步执行器认领。"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-schedule-form"
              loading={submitting}
            >
              创建计划
            </Button>
          </>
        }
      >
        <form id="create-schedule-form" onSubmit={submit} className="form-grid">
          {formError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{formError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="名称" htmlFor="schedule-name" className="field--full">
            <TextInput
              id="schedule-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="间隔（分钟）" htmlFor="schedule-interval">
            <TextInput
              id="schedule-interval"
              type="number"
              min="1"
              step="1"
              value={intervalMinutes}
              onChange={(event) => setIntervalMinutes(event.target.value)}
              required
            />
          </FormField>
          <FormField label="首次运行（可选）" htmlFor="schedule-start">
            <TextInput
              id="schedule-start"
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------- sync runs */

function RunsSection({
  connection,
  runs,
  loading,
  error,
  reload,
  onQueue,
  busy,
}: {
  connection: IntegrationConnection;
  runs: SyncRun[];
  loading: boolean;
  error: Error | undefined;
  reload: () => void;
  onQueue: () => void;
  busy: boolean;
}) {
  return (
    <>
      <div className="toolbar">
        <span className="muted" style={{ fontSize: 12 }}>
          Sync runs for {connection.connectionName}
        </span>
        <div className="row-actions">
          <Button size="sm" variant="secondary" icon="refresh" onClick={reload}>
            刷新
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="play"
            loading={busy}
            onClick={onQueue}
          >
            排队同步
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading ? (
        <LoadingRows rows={3} />
      ) : runs.length === 0 ? (
        <EmptyState
          icon="server"
          title="暂无同步运行"
          description="可手动排队一次同步，或由执行器认领到期计划。"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>运行</th>
                <th>状态</th>
                <th className="cell-num">已见</th>
                <th className="cell-num">已写入</th>
                <th>创建时间</th>
                <th>已完成</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <span className="cell-primary mono">{shortId(run.id, 14)}</span>
                    {run.errorSummary ? (
                      <span className="cell-sub text-danger">{run.errorSummary}</span>
                    ) : null}
                  </td>
                  <td>
                    <Badge status={run.status} />
                  </td>
                  <td className="cell-num">{run.recordsSeen}</td>
                  <td className="cell-num">{run.recordsUpserted}</td>
                  <td>{formatDateTime(run.createdAt)}</td>
                  <td>
                    {run.finishedAt ? formatRelative(run.finishedAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------ identities */

function IdentitiesSection() {
  const toast = useToast();
  const identities = useApiQuery<ExternalIdentityView[]>(
    "/api/v1/external-identities",
  );
  const [open, setOpen] = useState(false);
  const [sourceSystem, setSourceSystem] = useState("");
  const [externalId, setExternalId] = useState("");
  const [objectType, setObjectType] = useState("PERSON");
  const [personId, setPersonId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openForm() {
    setSourceSystem("");
    setExternalId("");
    setObjectType("PERSON");
    setPersonId("");
    setError(null);
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/v1/external-identities", {
        method: "POST",
        body: {
          sourceSystem: sourceSystem.trim(),
          externalId: externalId.trim(),
          objectType: objectType.trim(),
          personId: personId.trim() || undefined,
        },
      });
      toast.success("外部身份已映射", externalId);
      setOpen(false);
      identities.reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "映射身份失败",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        className="inline"
        style={{ justifyContent: "space-between", width: "100%", marginBottom: 10 }}
      >
        <span className="muted">
          来源系统标识映射到内部人员。
        </span>
        <Button size="sm" variant="secondary" icon="plus" onClick={openForm}>
          映射身份
        </Button>
      </div>
      {identities.error ? (
        <ErrorNotice error={identities.error} onRetry={identities.reload} />
      ) : identities.loading ? (
        <LoadingRows rows={3} />
      ) : (identities.data?.length ?? 0) === 0 ? (
        <p className="muted">尚无外部身份映射。</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>来源</th>
                <th>外部 ID</th>
                <th>对象</th>
                <th>人员</th>
              </tr>
            </thead>
            <tbody>
              {(identities.data ?? []).map((identity) => (
                <tr key={identity.id}>
                  <td>{identity.sourceSystem}</td>
                  <td className="mono">{identity.externalId}</td>
                  <td>{identity.objectType}</td>
                  <td className="mono">
                    {identity.personId
                      ? shortId(identity.personId, 10)
                      : "unmapped"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        title="映射外部身份"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="identity-form"
              loading={busy}
            >
              映射身份
            </Button>
          </>
        }
      >
        <form id="identity-form" onSubmit={submit} className="form-grid">
          {error ? (
            <div className="field--full">
              <InfoNotice tone="warning">{error}</InfoNotice>
            </div>
          ) : null}
          <FormField label="来源系统" htmlFor="identity-source">
            <TextInput
              id="identity-source"
              value={sourceSystem}
              onChange={(event) => setSourceSystem(event.target.value)}
              required
            />
          </FormField>
          <FormField label="外部 ID" htmlFor="identity-external">
            <TextInput
              id="identity-external"
              value={externalId}
              onChange={(event) => setExternalId(event.target.value)}
              required
            />
          </FormField>
          <FormField label="对象类型" htmlFor="identity-object">
            <TextInput
              id="identity-object"
              value={objectType}
              onChange={(event) => setObjectType(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="人员 ID（可选）"
            htmlFor="identity-person"
            className="field--full"
          >
            <TextInput
              id="identity-person"
              value={personId}
              onChange={(event) => setPersonId(event.target.value)}
              placeholder="UUID"
            />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}


interface FeishuSyncResultView {
  dryRun: boolean;
  departments: Array<{
    externalId: string;
    name: string;
    action: string;
  }>;
  users: Array<{
    openId: string;
    name: string;
    email?: string;
    jobTitle?: string;
    action: string;
  }>;
  managersLinked: number;
  orgAssignmentsCreated: number;
  warnings: string[];
}

function FeishuSyncPanel() {
  const toast = useToast();
  const [result, setResult] = useState<FeishuSyncResultView | null>(null);
  const [allowCreate, setAllowCreate] = useState(false);
  const [busy, setBusy] = useState(false);

  async function runSync(dryRun: boolean) {
    setBusy(true);
    try {
      const response = await api<FeishuSyncResultView>(
        "/api/v1/platform/feishu/sync-directory",
        { method: "POST", body: { dryRun, allowCreate } },
      );
      setResult(response);
      toast.success(
        dryRun ? "Preview ready" : "通讯录已同步",
        `${response.departments.length} departments · ${response.users.length} people · ${response.managersLinked} reporting lines`,
      );
    } catch (caught) {
      toast.error(
        caught instanceof ApiError ? caught.message : "通讯录同步失败",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <InfoNotice>
        Preview first: dry-run lists what would be created without writing.
        Provisioning only grants the basic employee role; elevated roles stay
        with an administrator. Requires FEISHU_APP_ID/FEISHU_APP_SECRET on the
        server (501 otherwise).
      </InfoNotice>
      <div className="row-actions">
        <Button
          variant="secondary"
          loading={busy}
          onClick={() => void runSync(true)}
        >
          预览（试运行）
        </Button>
        <Button
          variant="primary"
          loading={busy}
          onClick={() => void runSync(false)}
        >
          执行同步
        </Button>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={allowCreate}
            onChange={(event) => setAllowCreate(event.target.checked)}
          />{" "}
          自动补建缺失人员（仅基础角色）
        </label>
      </div>
      {result ? (
        <div className="stack">
          <div className="stat-grid stat-grid--three">
            <div>
              <div className="stat-label">部门</div>
              <div className="stat-value">
                {result.departments.filter((d) => d.action === "CREATE").length}{" "}
                new / {result.departments.length}
              </div>
            </div>
            <div>
              <div className="stat-label">人员</div>
              <div className="stat-value">
                {
                  result.users.filter((u) => u.action === "PROVISION" || u.action === "LINK_PERSON")
                    .length
                }{" "}
                new / {result.users.length}
              </div>
            </div>
            <div>
              <div className="stat-label">汇报线</div>
              <div className="stat-value">{result.managersLinked}</div>
            </div>
          </div>
          {result.warnings.length > 0 ? (
            <InfoNotice tone="warning">
              {result.warnings.slice(0, 3).join(" · ")}
              {result.warnings.length > 3 ? ` (+${result.warnings.length - 3} more)` : ""}
            </InfoNotice>
          ) : null}
          <table className="table">
            <thead>
              <tr>
                <th>人员</th>
                <th>标题</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {result.users.slice(0, 12).map((user) => (
                <tr key={user.openId}>
                  <td>
                    {user.name}
                    {user.email ? (
                      <span className="hint"> · {user.email}</span>
                    ) : null}
                  </td>
                  <td>{user.jobTitle ?? "—"}</td>
                  <td>
                    <Badge
                      tone={
                        user.action === "PROVISION" || user.action === "LINK_PERSON"
                          ? "info"
                          : user.action === "SKIPPED_NO_PROVISIONING"
                            ? "neutral"
                            : "success"
                      }
                    >
                      {user.action}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
