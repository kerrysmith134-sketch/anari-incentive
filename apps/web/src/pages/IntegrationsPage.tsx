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
import { Icon } from "../components/Icon.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api } from "../lib/api.js";
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

export function IntegrationsPage() {
  useDocumentTitle("Integrations");
  const toast = useToast();
  const connections = useApiQuery<IntegrationConnection[]>(
    "/api/v1/integration-connections",
  );
  const presets = useApiQuery<MappingPreset[]>("/api/v1/integration-mapping-presets");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState("mappings");
  const [createOpen, setCreateOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const [connectionName, setConnectionName] = useState("");
  const [credentialRef, setCredentialRef] = useState("");
  const [config, setConfig] = useState("{}");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
    setProvider("");
    setConnectionName("");
    setCredentialRef("");
    setConfig("{}");
    setFormError(null);
    setCreateOpen(true);
  }

  async function createConnection(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    let parsedConfig: unknown = {};
    try {
      parsedConfig = config.trim() ? JSON.parse(config) : {};
    } catch {
      setFormError("Config must be valid JSON.");
      return;
    }
    if (
      typeof parsedConfig !== "object" ||
      parsedConfig === null ||
      Array.isArray(parsedConfig)
    ) {
      setFormError("Config must be a JSON object.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await api<IntegrationConnection>(
        "/api/v1/integration-connections",
        {
          method: "POST",
          body: {
            provider: provider.trim(),
            connectionName: connectionName.trim(),
            credentialRef: credentialRef.trim(),
            config: parsedConfig,
          },
        },
      );
      toast.success("Connection created", connectionName);
      setCreateOpen(false);
      setSelectedId(created.id);
      connections.reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Could not create connection.",
      );
    } finally {
      setSubmitting(false);
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
        next === "ACTIVE" ? "Connection activated" : "Connection disconnected",
        connection.connectionName,
      );
      connections.reload();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "Could not change status.",
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
      toast.success("Sync queued", connection.connectionName);
      syncRuns.reload();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "Could not queue a sync.",
      );
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Payload plumbing"
        title="Integrations"
        description="Connections, versioned field mappings and due-schedule claiming. Credentials stay behind references; mapping edits create a new version."
        actions={
          <>
            <Button
              variant="secondary"
              icon="refresh"
              onClick={() => connections.reload()}
              loading={connections.loading}
            >
              Refresh
            </Button>
            <Button variant="primary" icon="plus" onClick={openCreate}>
              Connection
            </Button>
          </>
        }
      />

      {actionError ? (
        <div style={{ marginBottom: 16 }}>
          <InfoNotice tone="warning">{actionError}</InfoNotice>
        </div>
      ) : null}

      {connections.error ? (
        <ErrorNotice error={connections.error} onRetry={connections.reload} />
      ) : connections.loading ? (
        <Panel title="Connections">
          <LoadingRows rows={3} />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon="integrations"
            title="No integration connection"
            description="Add a provider connection, then attach a versioned mapping and a sync schedule."
            action={
              <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                Create connection
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
                subtitle={`${selected.provider} · credential ${selected.credentialRef}`}
                action={<Badge status={selected.status} />}
              >
                <Tabs
                  items={[
                    {
                      id: "mappings",
                      label: "Mappings",
                      count: mappings.data?.length ?? 0,
                    },
                    {
                      id: "schedules",
                      label: "Schedules",
                      count: schedules.data?.length ?? 0,
                    },
                    {
                      id: "runs",
                      label: "Sync runs",
                      count: syncRuns.data?.length ?? 0,
                    },
                  ]}
                  active={detailTab}
                  onChange={setDetailTab}
                  label="Connection detail"
                />
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
                </div>
              </Panel>

              <div className="stack">
                <Panel title="Connection">
                  <DefinitionList
                    items={[
                      { label: "Provider", value: selected.provider },
                      {
                        label: "Credential ref",
                        value: (
                          <span className="mono">{selected.credentialRef}</span>
                        ),
                      },
                      {
                        label: "Last sync",
                        value: selected.lastSyncAt
                          ? formatDateTime(selected.lastSyncAt)
                          : "Never",
                      },
                      {
                        label: "Created",
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
                        : "Activate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="play"
                      loading={statusBusy}
                      onClick={() => void queueSync(selected)}
                    >
                      Queue sync
                    </Button>
                  </div>
                </Panel>

                <Panel title="Config" subtitle="Non-secret connection settings">
                  <pre className="code-block">
                    {JSON.stringify(selected.config ?? {}, null, 2)}
                  </pre>
                </Panel>
              </div>
            </div>
          ) : null}
        </>
      )}

      <Modal
        open={createOpen}
        title="New integration connection"
        description="Store only a credential reference — never the secret itself."
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-connection-form"
              loading={submitting}
            >
              Create connection
            </Button>
          </>
        }
      >
        <form id="create-connection-form" onSubmit={createConnection} className="form-grid">
          {formError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{formError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="Provider" htmlFor="connection-provider">
            <TextInput
              id="connection-provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              placeholder="hubspot"
              required
            />
          </FormField>
          <FormField label="Connection name" htmlFor="connection-name">
            <TextInput
              id="connection-name"
              value={connectionName}
              onChange={(event) => setConnectionName(event.target.value)}
              placeholder="Revenue CRM"
              required
            />
          </FormField>
          <FormField
            label="Credential reference"
            htmlFor="connection-credential"
            className="field--full"
            hint="A vault path or secret name, not the credential value."
          >
            <TextInput
              id="connection-credential"
              value={credentialRef}
              onChange={(event) => setCredentialRef(event.target.value)}
              placeholder="vault://integrations/hubspot"
              required
            />
          </FormField>
          <FormField
            label="Config JSON"
            htmlFor="connection-config"
            className="field--full"
            hint="Optional non-secret settings, e.g. base URL or portal id."
          >
            <Textarea
              id="connection-config"
              value={config}
              onChange={(event) => setConfig(event.target.value)}
              className="input mono"
              spellCheck={false}
            />
          </FormField>
        </form>
      </Modal>
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
      setFormError("Field map and config must be valid JSON.");
      return;
    }
    if (
      !parsedFieldMap ||
      typeof parsedFieldMap !== "object" ||
      Array.isArray(parsedFieldMap) ||
      Object.values(parsedFieldMap).some((value) => typeof value !== "string")
    ) {
      setFormError("Field map must be a JSON object whose values are strings.");
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
      toast.success("Mapping created", name);
      setOpen(false);
      reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Could not create the mapping.",
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
      toast.success("Mapping retired", retireTarget.name);
      setRetireTarget(null);
      reload();
    } catch (caught) {
      setRetireError(
        caught instanceof Error ? caught.message : "Could not retire mapping.",
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
          New mapping
        </Button>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading ? (
        <LoadingRows rows={3} />
      ) : mappings.length === 0 ? (
        <EmptyState
          icon="layers"
          title="No field mapping"
          description="Map source fields to the evidence contract. Presets cover HubSpot deals, Feishu Bitable and ERP orders."
          action={
            <Button variant="primary" size="sm" onClick={() => openForm()}>
              New mapping
            </Button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mapping</th>
                <th>Type</th>
                <th>Source → target</th>
                <th>Fields</th>
                <th>Version</th>
                <th>Status</th>
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
                        Retire
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
        title="New field mapping"
        description="Preset values are a starting point — review every field before creating the version."
        onClose={() => setOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-mapping-form"
              loading={submitting}
            >
              Create mapping
            </Button>
          </>
        }
      >
        <form id="create-mapping-form" onSubmit={submit} className="stack">
          {formError ? <InfoNotice tone="warning">{formError}</InfoNotice> : null}
          {availablePresets.length > 0 ? (
            <div>
              <div className="form-section__title">Provider presets</div>
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
            <FormField label="Name" htmlFor="mapping-name">
              <TextInput
                id="mapping-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Mapping type" htmlFor="mapping-type">
              <Select
                id="mapping-type"
                value={mappingType}
                onChange={(event) => setMappingType(event.target.value)}
              >
                <option value="HTTP_JSON">HTTP JSON</option>
                <option value="CSV">CSV</option>
              </Select>
            </FormField>
            <FormField label="Source system" htmlFor="mapping-source">
              <TextInput
                id="mapping-source"
                value={sourceSystem}
                onChange={(event) => setSourceSystem(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Target type" htmlFor="mapping-target">
              <TextInput
                id="mapping-target"
                value={targetType}
                onChange={(event) => setTargetType(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Field map (JSON)"
              htmlFor="mapping-fields"
              className="field--full"
              hint="Keys are target fields; values are source paths."
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
              label="Config (JSON)"
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
        title="Retire mapping"
        description="Retired mappings stay readable for audit but stop accepting new sync work."
        onClose={() => setRetireTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRetireTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={retire} loading={submitting}>
              Retire mapping
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
                { label: "Mapping", value: retireTarget.name },
                { label: "Version", value: `v${retireTarget.version}` },
                { label: "Source", value: retireTarget.sourceSystem },
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
      toast.success("Schedule created", name);
      setOpen(false);
      reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Could not create the schedule.",
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
        "Could not change schedule",
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
          The sync runner claims due schedules atomically.
        </span>
        <Button size="sm" variant="primary" icon="plus" onClick={openForm}>
          New schedule
        </Button>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading ? (
        <LoadingRows rows={2} />
      ) : schedules.length === 0 ? (
        <EmptyState
          icon="clock"
          title="No sync schedule"
          description="Create a recurring interval so the runner can claim and queue sync work."
          action={
            <Button variant="primary" size="sm" onClick={openForm}>
              New schedule
            </Button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Schedule</th>
                <th>Interval</th>
                <th>Next run</th>
                <th>Last run</th>
                <th>State</th>
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
                  <td>{schedule.lastRunAt ? formatRelative(schedule.lastRunAt) : "Never"}</td>
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
        title="New sync schedule"
        description="Intervals are minutes; the schedule is claimed by the sync runner when due."
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-schedule-form"
              loading={submitting}
            >
              Create schedule
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
          <FormField label="Name" htmlFor="schedule-name" className="field--full">
            <TextInput
              id="schedule-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Interval (minutes)" htmlFor="schedule-interval">
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
          <FormField label="First run (optional)" htmlFor="schedule-start">
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
            Refresh
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="play"
            loading={busy}
            onClick={onQueue}
          >
            Queue sync
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
          title="No sync run"
          description="Queue a run manually, or let the runner claim a due schedule."
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Status</th>
                <th className="cell-num">Seen</th>
                <th className="cell-num">Upserted</th>
                <th>Created</th>
                <th>Finished</th>
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
