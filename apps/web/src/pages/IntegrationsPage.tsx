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

import { MappingsSection } from "../components/integrations/MappingsSection.js";
import { SchedulesSection } from "../components/integrations/SchedulesSection.js";
import { RunsSection } from "../components/integrations/RunsSection.js";
import { IdentitiesSection } from "../components/integrations/IdentitiesSection.js";
import { FeishuSyncPanel } from "../components/integrations/FeishuSyncPanel.js";
import { IntegrationSummary } from "../components/integrations/IntegrationSummary.js";

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

      <IntegrationSummary
        connections={list}
        mappings={mappings.data?.length ?? 0}
        runs={syncRuns.data ?? []}
      />

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
