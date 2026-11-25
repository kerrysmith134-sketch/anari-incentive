/**
 * Integrations Mapping Studio：连接详情「字段映射」标签页。
 *
 * 只复用现有后端接口：
 * - GET  /api/v1/integration-connections/:id/mappings
 * - POST /api/v1/integration-connections/:id/mappings （版本化新增）
 * - POST /api/v1/integration-mappings/:id/retire （停用/退役）
 * - GET  /api/v1/integration-connections/:id/sync-runs （由页面传入，不重复请求）
 *
 * 后端没有 PATCH mapping 接口，且同名 mapping 只允许一个 ACTIVE 版本
 * （INTEGRATION_MAPPING_ALREADY_ACTIVE），因此「编辑保存」= 先退役当前版本，
 * 再用同名 v(n+1) 创建新版本——与后端测试中的版本化流程一致。
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
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
  Select,
  TextInput,
  Textarea,
} from "../ui.js";
import { useToast } from "../../contexts/ToastContext.js";
import { api, ApiError } from "../../lib/api.js";
import { formatDateTime, shortId } from "../../lib/format.js";
import type {
  IntegrationConnection,
  IntegrationMapping,
  MappingPreset,
  SyncRun,
} from "../../lib/types.js";
import { MappingPreview } from "./MappingPreview.js";
import {
  buildVersionedMappingConfig,
  fieldMapFromRows,
  isCanonicalRequiredField,
  newMappingRow,
  nextMappingVersion,
  requiredColumnsFromRows,
  requiredTargetsForMapping,
  rowsFromMapping,
  rowsMatchMapping,
  TRANSFORM_NAMES,
  validateRows,
  type MappingRowDraft,
} from "./mapping-fields.js";

interface MappingEditor {
  /** 打开编辑器时的 mapping 快照（退役后 base.status 仍可能是 ACTIVE）。 */
  base: IntegrationMapping;
  /** true = 保存时需要先退役当前版本；创建失败后重试不会再次退役。 */
  retireRequired: boolean;
  rows: MappingRowDraft[];
}

interface PreviewState {
  label: string;
  fieldMap: Record<string, string>;
  requiredTargets: Set<string>;
}

interface ActionError {
  title: string;
  message: string;
}

interface SyncRunCounters {
  recordsQuarantined?: number;
  recordsFailed?: number;
  recordsInvalid?: number;
}

type SyncRunWithCounters = SyncRun & SyncRunCounters;

/** POST /api/v1/sync-runs/:id/replay 的返回体。 */
interface SyncRunReplayResult {
  replayed: number;
  skipped: number;
  failed: number;
  rawRecordIds: string[];
}

/** FAILED / PARTIAL 的 run 才允许重放，其余状态后端会返回 409。 */
function isReplayableRun(run: SyncRun): boolean {
  return run.status === "FAILED" || run.status === "PARTIAL";
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "未知错误";
}

function numberOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasConfigObject(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0
  );
}

/* ------------------------------------------------------- failure & replay */

function SyncFailurePanel({
  runs,
  loading,
  error,
  reload,
}: {
  runs: SyncRun[];
  loading: boolean;
  error: Error | undefined;
  reload: (() => void) | undefined;
}) {
  const recent = useMemo(() => {
    const sorted = [...runs] as SyncRunWithCounters[];
    sorted.sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );
    return sorted.slice(0, 5);
  }, [runs]);
  const latest = recent[0];
  const latestFailed = latest ? numberOrNull(latest.recordsFailed) : null;
  const latestQuarantined = latest
    ? numberOrNull(latest.recordsQuarantined)
    : null;

  const toast = useToast();
  const [replaying, setReplaying] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replaySummary, setReplaySummary] = useState<string | null>(null);
  /** 最近一次可重放的运行；没有则按钮保持禁用并说明原因。 */
  const replayable = useMemo(
    () =>
      [...runs]
        .filter(isReplayableRun)
        .sort(
          (left, right) =>
            Date.parse(right.createdAt) - Date.parse(left.createdAt),
        )[0],
    [runs],
  );

  async function replayFailedRecords(): Promise<void> {
    if (!replayable || replaying) return;
    setReplaying(true);
    setReplayError(null);
    try {
      const result = await api<SyncRunReplayResult>(
        `/api/v1/sync-runs/${replayable.id}/replay`,
        { method: "POST" },
      );
      const summary = `replayed ${result.replayed} · skipped ${result.skipped} · failed ${result.failed}`;
      setReplaySummary(summary);
      if (result.failed > 0) {
        toast.error("重放部分失败", summary);
      } else if (result.replayed > 0) {
        toast.success("重放完成", summary);
      } else {
        toast.success("没有需要重放的记录", summary);
      }
      reload?.();
    } catch (caught) {
      const message =
        caught instanceof ApiError && caught.status === 403
          ? "当前账号没有重放权限（需要 admin 或 integration 角色）"
          : errorMessage(caught);
      setReplayError(message);
      toast.error("重放失败", message);
    } finally {
      setReplaying(false);
    }
  }

  return (
    <section
      className="section-gap"
      aria-labelledby="mapping-sync-failure-heading"
    >
      <div className="toolbar">
        <div>
          <h3
            id="mapping-sync-failure-heading"
            style={{ margin: 0, fontSize: 15 }}
          >
            同步失败与重放
          </h3>
          <p className="muted" style={{ margin: "3px 0 0", fontSize: 12 }}>
            最近 sync run 的 failed / quarantined 计数；没有后端重放接口时只说明，不伪造操作。
          </p>
        </div>
        {reload ? (
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            onClick={reload}
            loading={loading}
          >
            刷新运行
          </Button>
        ) : null}
      </div>

      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {!error && loading && runs.length === 0 ? (
        <LoadingRows rows={2} />
      ) : null}
      {!error && !loading && runs.length === 0 ? (
        <EmptyState
          icon="server"
          title="暂无同步运行"
          description="排队一次同步后，这里会显示最近运行的 failed / quarantined 计数。"
        />
      ) : null}

      {recent.length > 0 ? (
        <>
          <p className="muted" style={{ fontSize: 12 }}>
            最近一次运行{" "}
            {latest ? formatDateTime(latest.createdAt) : "—"} · failed{" "}
            <strong>{latestFailed ?? "—"}</strong> · quarantined{" "}
            <strong>{latestQuarantined ?? "—"}</strong>
            {latest?.errorSummary ? ` · ${latest.errorSummary}` : ""}
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">
                最近五次同步运行的 failed 与 quarantined 计数
              </caption>
              <thead>
                <tr>
                  <th scope="col">运行</th>
                  <th scope="col">状态</th>
                  <th scope="col">failed</th>
                  <th scope="col">quarantined</th>
                  <th scope="col">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((run) => {
                  const failed = numberOrNull(run.recordsFailed);
                  const quarantined = numberOrNull(run.recordsQuarantined);
                  return (
                    <tr key={run.id}>
                      <td>
                        <span className="mono cell-primary">
                          {shortId(run.id, 12)}
                        </span>
                        {run.errorSummary ? (
                          <span className="cell-sub">{run.errorSummary}</span>
                        ) : null}
                      </td>
                      <td>
                        <Badge status={run.status} />
                      </td>
                      <td className="cell-num">
                        {failed === null ? (
                          <span
                            className="subtle"
                            title="这次运行没有返回精确计数"
                          >
                            —
                          </span>
                        ) : (
                          failed
                        )}
                      </td>
                      <td className="cell-num">
                        {quarantined === null ? (
                          <span
                            className="subtle"
                            title="这次运行没有返回精确计数"
                          >
                            —
                          </span>
                        ) : (
                          quarantined
                        )}
                      </td>
                      <td>{formatDateTime(run.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div
        className="row-actions section-gap"
        style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}
      >
        <Button
          size="sm"
          variant="secondary"
          icon="play"
          loading={replaying}
          disabled={!replayable}
          aria-describedby="mapping-replay-scope"
          onClick={() => void replayFailedRecords()}
        >
          重放失败记录
        </Button>
        <span
          id="mapping-replay-scope"
          className="muted"
          style={{ fontSize: 12, maxWidth: "78ch", lineHeight: 1.5 }}
        >
          {replayable ? (
            <>
              将重放{" "}
              <span className="mono">{shortId(replayable.id, 12)}</span>（
              {replayable.status}）运行期间落地的原始记录：只重做目标写入，
              不重置 checkpoint、不新建 run；已重放记录自动跳过。
            </>
          ) : (
            "最近没有 FAILED / PARTIAL 的同步运行，暂无可重放的失败记录。"
          )}
        </span>
      </div>
      {replayError ? (
        <ErrorNotice title="重放失败" error={new Error(replayError)} />
      ) : null}
      {replaySummary ? (
        <p className="muted" role="status" style={{ fontSize: 12, margin: 0 }}>
          最近一次重放：{replaySummary}
        </p>
      ) : null}
    </section>
  );
}

/* --------------------------------------------------------------- studio */

export function MappingStudio({
  connection,
  mappings,
  loading,
  error,
  presets,
  reload,
  runs,
  runsLoading = false,
  runsError,
  reloadRuns,
}: {
  connection: IntegrationConnection;
  mappings: IntegrationMapping[];
  loading: boolean;
  error: Error | undefined;
  presets: MappingPreset[];
  reload: () => void;
  runs: SyncRun[];
  runsLoading?: boolean;
  runsError?: Error;
  reloadRuns?: () => void;
}) {
  const toast = useToast();
  const listRef = useRef<HTMLDivElement>(null);
  /** 同步防重入：保存包含「退役 + 创建」两次写操作，不能靠异步 state 防抖。 */
  const savingRef = useRef(false);
  const fieldMapHintId = useId();
  const fieldMapErrorId = useId();
  const configHintId = useId();
  const configErrorId = useId();

  const [editor, setEditor] = useState<MappingEditor | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingStage, setSavingStage] = useState<"retire" | "create" | null>(
    null,
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [mappingType, setMappingType] = useState("HTTP_JSON");
  const [sourceSystem, setSourceSystem] = useState("");
  const [targetType, setTargetType] = useState("EVIDENCE");
  const [fieldMapText, setFieldMapText] = useState("");
  const [configText, setConfigText] = useState("{}");
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldMapError, setFieldMapError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [retireTarget, setRetireTarget] = useState<IntegrationMapping | null>(
    null,
  );
  const [retireError, setRetireError] = useState<string | null>(null);

  /**
   * Modal 的 effect 依赖 onClose；如果传入内联箭头函数，父组件每次输入重渲染
   * 都会让 effect 重跑并把焦点抢回第一个可聚焦元素。这里固定回调。
   */
  const closeCreateModal = useCallback(() => setCreateOpen(false), []);
  const closeRetireModal = useCallback(() => setRetireTarget(null), []);
  const closePreviewModal = useCallback(() => setPreview(null), []);

  const activeCount = mappings.filter(
    (mapping) => mapping.status === "ACTIVE",
  ).length;

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

  /** 打开编辑器后把焦点放到第一行目标字段（键盘用户不必再找位置）。 */
  useEffect(() => {
    if (!editor) return;
    const firstRow = editor.rows[0];
    if (!firstRow) {
      document.getElementById("mapping-add-field")?.focus();
      return;
    }
    document.getElementById(`${firstRow.id}-target`)?.focus();
    // 只在切换到另一条映射时聚焦；行内增删不抢焦点。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor?.base.id]);

  function focusList() {
    // 等 Modal 的 cleanup 与列表刷新落地后，再把焦点交给列表区域。
    window.setTimeout(() => listRef.current?.focus(), 150);
  }

  function startEdit(mapping: IntegrationMapping) {
    if (mapping.status !== "ACTIVE") return;
    if (
      editor &&
      editor.base.id !== mapping.id &&
      !rowsMatchMapping(editor.base.fieldMap, editor.base.config, editor.rows)
    ) {
      const confirmed = window.confirm(
        "当前映射有未保存的改动，切换后将丢弃。继续？",
      );
      if (!confirmed) return;
    }
    setActionError(null);
    setEditor({
      base: mapping,
      retireRequired: true,
      rows: rowsFromMapping(mapping),
    });
  }

  function cancelEdit() {
    const mappingId = editor?.base.id;
    setEditor(null);
    if (mappingId) {
      window.setTimeout(() => {
        const editButton = document.getElementById(
          `mapping-edit-${mappingId}`,
        );
        if (editButton) editButton.focus();
        else listRef.current?.focus();
      }, 0);
    }
  }

  function updateRow(
    rowId: string,
    patch: Partial<Omit<MappingRowDraft, "id">>,
  ) {
    setEditor((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              row.id === rowId ? { ...row, ...patch } : row,
            ),
          }
        : current,
    );
  }

  function addRow() {
    if (!editor) return;
    const row = newMappingRow();
    setEditor((current) =>
      current ? { ...current, rows: [...current.rows, row] } : current,
    );
    window.setTimeout(
      () => document.getElementById(`${row.id}-target`)?.focus(),
      0,
    );
  }

  function removeRow(rowId: string) {
    setEditor((current) =>
      current
        ? { ...current, rows: current.rows.filter((row) => row.id !== rowId) }
        : current,
    );
    window.setTimeout(
      () => document.getElementById("mapping-add-field")?.focus(),
      0,
    );
  }

  function openMappingPreview(mapping: IntegrationMapping) {
    setPreview({
      label: `${mapping.name} · v${mapping.version}`,
      fieldMap: mapping.fieldMap ?? {},
      requiredTargets: requiredTargetsForMapping(mapping),
    });
  }

  function openDraftPreview() {
    if (!editor) return;
    setPreview({
      label: `${editor.base.name} · 草稿 v${nextMappingVersion(
        mappings,
        editor.base.name,
        editor.base.version,
      )}`,
      fieldMap: fieldMapFromRows(editor.rows),
      requiredTargets: new Set(requiredColumnsFromRows(editor.rows)),
    });
  }

  async function saveNewVersion() {
    if (!editor || savingRef.current) return;
    const current = editor;
    const validation = validateRows(current.rows);
    if (validation.errorCount > 0) {
      setActionError({
        title: "映射未通过校验，未做任何修改",
        message:
          "请先修正行内错误与缺失的契约必填字段，再保存新版本。",
      });
      return;
    }
    const configBuild = buildVersionedMappingConfig(
      current.base,
      current.rows,
    );
    if (!configBuild.ok) {
      setActionError({
        title: "无法安全回写 mapping config",
        message: configBuild.reason,
      });
      return;
    }

    const fieldMap = fieldMapFromRows(current.rows);
    const version = nextMappingVersion(
      mappings,
      current.base.name,
      current.base.version,
    );
    const mappingPath = `/api/v1/integration-connections/${connection.id}/mappings`;
    savingRef.current = true;
    setActionError(null);
    setSavingId(current.base.id);

    try {
      // 1) 退役当前 ACTIVE 版本（同名只允许一个 ACTIVE 版本）。
      if (current.retireRequired) {
        setSavingStage("retire");
        try {
          await api(
            `/api/v1/integration-mappings/${current.base.id}/retire`,
            { method: "POST" },
          );
        } catch (caught) {
          setActionError({
            title: "退役当前版本失败，未创建新版本",
            message: errorMessage(caught),
          });
          return;
        }
        setEditor((state) =>
          state && state.base.id === current.base.id
            ? { ...state, retireRequired: false }
            : state,
        );
      }

      // 2) 创建同名 v(n+1)。失败时旧版本已退役，草稿保留可重试。
      setSavingStage("create");
      try {
        const created = await api<IntegrationMapping>(mappingPath, {
          method: "POST",
          body: {
            name: current.base.name,
            mappingType: current.base.mappingType,
            sourceSystem: current.base.sourceSystem,
            targetType: current.base.targetType,
            fieldMap,
            config: configBuild.config,
            version,
          },
        });
        toast.success(
          "映射已保存为新版本",
          `${current.base.name} · v${created.version}`,
        );
        setEditor(null);
        reload();
        focusList();
      } catch (caught) {
        setActionError({
          title: `v${version} 创建失败，旧版本已退役`,
          message:
            `当前版本 v${current.base.version} 已退役，草稿仍保留；` +
            `修正后再次保存只会创建新版本，不会重复退役。错误：${errorMessage(caught)}`,
        });
        reload();
      }
    } finally {
      savingRef.current = false;
      setSavingId(null);
      setSavingStage(null);
    }
  }

  async function retireMapping() {
    if (!retireTarget) return;
    setSubmitting(true);
    setRetireError(null);
    try {
      await api(`/api/v1/integration-mappings/${retireTarget.id}/retire`, {
        method: "POST",
      });
      toast.success("映射已退役", retireTarget.name);
      if (editor?.base.id === retireTarget.id) setEditor(null);
      setRetireTarget(null);
      reload();
      focusList();
    } catch (caught) {
      setRetireError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  function openCreate(preset?: MappingPreset) {
    setName(preset ? preset.name : "");
    setMappingType(preset?.mappingType ?? "HTTP_JSON");
    setSourceSystem(preset?.sourceSystem ?? connection.provider);
    setTargetType(preset?.targetType ?? "EVIDENCE");
    setFieldMapText(
      JSON.stringify(
        preset?.fieldMap ?? {
          sourceRecordId: "id",
          eventType: "event_type",
          subjectType: "=ORDER",
          subjectId: "id",
          evidenceType: "=ACTIVITY",
        },
        null,
        2,
      ),
    );
    setConfigText(JSON.stringify(preset?.config ?? {}, null, 2));
    setFormError(null);
    setFieldMapError(null);
    setConfigError(null);
    setCreateOpen(true);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldMapError(null);
    setConfigError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError("名称不能为空。");
      return;
    }
    if (
      mappings.some(
        (mapping) =>
          mapping.status === "ACTIVE" && mapping.name === trimmedName,
      )
    ) {
      setFormError(
        `同名映射 ${trimmedName} 已有 ACTIVE 版本；请在列表中编辑，保存为新版本。`,
      );
      return;
    }

    let parsedFieldMap: unknown;
    try {
      parsedFieldMap = JSON.parse(fieldMapText);
    } catch {
      setFieldMapError("字段映射必须是合法 JSON。");
      return;
    }
    if (
      !parsedFieldMap ||
      typeof parsedFieldMap !== "object" ||
      Array.isArray(parsedFieldMap) ||
      Object.values(parsedFieldMap).some((value) => typeof value !== "string")
    ) {
      setFieldMapError("字段映射必须是 JSON 对象且值为字符串。");
      return;
    }
    if (Object.keys(parsedFieldMap).length === 0) {
      setFieldMapError("字段映射至少需要一条。");
      return;
    }

    let parsedConfig: unknown = {};
    if (configText.trim()) {
      try {
        parsedConfig = JSON.parse(configText);
      } catch {
        setConfigError("配置必须是合法 JSON。");
        return;
      }
    }
    if (
      !parsedConfig ||
      typeof parsedConfig !== "object" ||
      Array.isArray(parsedConfig)
    ) {
      setConfigError("配置必须是 JSON 对象。");
      return;
    }

    setSubmitting(true);
    try {
      await api(
        `/api/v1/integration-connections/${connection.id}/mappings`,
        {
          method: "POST",
          body: {
            name: trimmedName,
            mappingType,
            sourceSystem: sourceSystem.trim(),
            targetType: targetType.trim(),
            fieldMap: parsedFieldMap,
            config: parsedConfig,
            version: nextMappingVersion(mappings, trimmedName),
          },
        },
      );
      toast.success("映射已创建", trimmedName);
      setCreateOpen(false);
      reload();
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  function renderEditor(current: MappingEditor) {
    const validation = validateRows(current.rows);
    const dirty = !rowsMatchMapping(
      current.base.fieldMap,
      current.base.config,
      current.rows,
    );
    const configBuild = buildVersionedMappingConfig(
      current.base,
      current.rows,
    );
    const nextVersion = nextMappingVersion(
      mappings,
      current.base.name,
      current.base.version,
    );
    const saveDisabled =
      !dirty ||
      !configBuild.ok ||
      validation.errorCount > 0 ||
      savingId === current.base.id;
    const saveLabel =
      savingStage === "retire"
        ? "退役旧版本…"
        : savingStage === "create"
          ? "创建新版本…"
          : !dirty
            ? "无改动"
            : !configBuild.ok || validation.errorCount > 0
              ? "修正后保存"
              : "保存为新版本";
    const overlayKeys = ["constants", "transforms"].filter((key) =>
      hasConfigObject(
        (current.base.config as Record<string, unknown>)[key],
      ),
    );

    return (
      <section
        className="section-gap"
        aria-labelledby="mapping-editor-heading"
        style={{
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: 16,
          background: "var(--surface)",
        }}
      >
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <div>
            <h3
              id="mapping-editor-heading"
              style={{ margin: 0, fontSize: 15 }}
            >
              编辑映射：{current.base.name}
            </h3>
            <p className="muted" style={{ margin: "3px 0 0", fontSize: 12 }}>
              v{current.base.version} → v{nextVersion} ·{" "}
              {current.retireRequired
                ? "保存会先退役当前版本，再创建同名新版本"
                : "当前版本已退役，保存只创建新版本"}
              ；历史版本保留供审计。
            </p>
          </div>
          <div className="row-actions">
            <Button size="sm" variant="ghost" onClick={cancelEdit}>
              取消
            </Button>
            <Button size="sm" variant="secondary" onClick={openDraftPreview}>
              预览草稿
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void saveNewVersion()}
              loading={savingId === current.base.id}
              disabled={saveDisabled}
            >
              {saveLabel}
            </Button>
          </div>
        </div>

        {!configBuild.ok ? (
          <div style={{ marginBottom: 10 }}>
            <InfoNotice tone="warning">
              <strong>无法安全保存为新版本</strong>
              <p>{configBuild.reason}</p>
            </InfoNotice>
          </div>
        ) : null}

        {overlayKeys.length > 0 ? (
          <div style={{ marginBottom: 10 }}>
            <InfoNotice tone="info">
              该映射 config 还含{" "}
              <span className="mono">{overlayKeys.join(" / ")}</span>{" "}
              覆盖层。本编辑器只修改 fieldMap，保存会原样保留它们；解析预览不叠加这些覆盖层。
            </InfoNotice>
          </div>
        ) : null}

        {validation.formErrors.length > 0 ? (
          <div role="alert" style={{ marginBottom: 10 }}>
            <InfoNotice tone="warning">
              <strong>映射不完整</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {validation.formErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </InfoNotice>
          </div>
        ) : null}

        <p className="muted" style={{ fontSize: 12 }}>
          {dirty
            ? `保存将以 v${nextVersion} 新建同名版本；旧版本不可回滚。`
            : "未修改。"}
        </p>

        <datalist id="mapping-transform-options">
          {TRANSFORM_NAMES.map((transform) => (
            <option key={transform} value={transform} />
          ))}
        </datalist>

        <div className="table-wrap">
          <table className="data-table">
            <caption className="sr-only">
              {current.base.name} 的字段映射编辑表
            </caption>
            <thead>
              <tr>
                <th scope="col">目标字段</th>
                <th scope="col">来源字段 / 常量</th>
                <th scope="col">转换管道</th>
                <th scope="col">必填</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {current.rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <p className="muted" style={{ fontSize: 12 }}>
                      还没有字段。添加字段并补齐五项契约必填字段后才能保存。
                    </p>
                  </td>
                </tr>
              ) : (
                current.rows.map((row, index) => {
                  const target = row.targetField.trim();
                  const rowErrors = validation.rowErrors[row.id] ?? {};
                  const canonicalRequired =
                    isCanonicalRequiredField(target);
                  const targetHintId = `${row.id}-target-hint`;
                  const targetErrorId = `${row.id}-target-error`;
                  const sourceHintId = `${row.id}-source-hint`;
                  const sourceErrorId = `${row.id}-source-error`;
                  const transformHintId = `${row.id}-transform-hint`;
                  const transformErrorId = `${row.id}-transform-error`;
                  const requiredHintId = `${row.id}-required-hint`;

                  return (
                    <tr key={row.id}>
                      <td>
                        <label
                          className="sr-only"
                          htmlFor={`${row.id}-target`}
                        >
                          第 {index + 1} 行目标字段
                        </label>
                        <TextInput
                          id={`${row.id}-target`}
                          className="mono"
                          value={row.targetField}
                          onChange={(event) =>
                            updateRow(row.id, {
                              targetField: event.target.value,
                            })
                          }
                          placeholder="sourceRecordId"
                          autoComplete="off"
                          spellCheck={false}
                          style={
                            rowErrors.target
                              ? { borderColor: "var(--critical)" }
                              : undefined
                          }
                          aria-invalid={
                            rowErrors.target ? true : undefined
                          }
                          aria-describedby={
                            rowErrors.target
                              ? `${targetHintId} ${targetErrorId}`
                              : targetHintId
                          }
                        />
                        <span className="sr-only" id={targetHintId}>
                          canonical 目标列名
                        </span>
                        {rowErrors.target ? (
                          <span
                            className="field__error"
                            id={targetErrorId}
                            role="alert"
                          >
                            {rowErrors.target}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <label
                          className="sr-only"
                          htmlFor={`${row.id}-source`}
                        >
                          第 {index + 1} 行来源字段或常量
                        </label>
                        <TextInput
                          id={`${row.id}-source`}
                          className="mono"
                          value={row.sourceField}
                          onChange={(event) =>
                            updateRow(row.id, {
                              sourceField: event.target.value,
                            })
                          }
                          placeholder="properties.dealname 或 =ORDER"
                          autoComplete="off"
                          spellCheck={false}
                          style={
                            rowErrors.source
                              ? { borderColor: "var(--critical)" }
                              : undefined
                          }
                          aria-invalid={
                            rowErrors.source ? true : undefined
                          }
                          aria-describedby={
                            rowErrors.source
                              ? `${sourceHintId} ${sourceErrorId}`
                              : sourceHintId
                          }
                        />
                        <span className="sr-only" id={sourceHintId}>
                          点路径，或以 = 开头表示常量
                        </span>
                        {rowErrors.source ? (
                          <span
                            className="field__error"
                            id={sourceErrorId}
                            role="alert"
                          >
                            {rowErrors.source}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <label
                          className="sr-only"
                          htmlFor={`${row.id}-transform`}
                        >
                          第 {index + 1} 行转换管道
                        </label>
                        <TextInput
                          id={`${row.id}-transform`}
                          className="mono"
                          value={row.transform}
                          onChange={(event) =>
                            updateRow(row.id, {
                              transform: event.target.value,
                            })
                          }
                          placeholder="trim|upper"
                          list="mapping-transform-options"
                          autoComplete="off"
                          spellCheck={false}
                          style={
                            rowErrors.transform
                              ? { borderColor: "var(--critical)" }
                              : undefined
                          }
                          aria-invalid={
                            rowErrors.transform ? true : undefined
                          }
                          aria-describedby={
                            rowErrors.transform
                              ? `${transformHintId} ${transformErrorId}`
                              : transformHintId
                          }
                        />
                        <span className="sr-only" id={transformHintId}>
                          可用 {TRANSFORM_NAMES.join(" / ")}，多个用 | 连接
                        </span>
                        {rowErrors.transform ? (
                          <span
                            className="field__error"
                            id={transformErrorId}
                            role="alert"
                          >
                            {rowErrors.transform}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {canonicalRequired ? (
                          <>
                            <Badge tone="neutral" dot={false}>
                              契约必填
                            </Badge>
                            <span className="sr-only" id={requiredHintId}>
                              该列是 connector 契约必填字段，不能关闭
                            </span>
                          </>
                        ) : (
                          <>
                            <label
                              className="inline"
                              htmlFor={`${row.id}-required`}
                            >
                              <input
                                id={`${row.id}-required`}
                                type="checkbox"
                                checked={row.required}
                                onChange={(event) =>
                                  updateRow(row.id, {
                                    required: event.target.checked,
                                  })
                                }
                                aria-describedby={requiredHintId}
                              />
                              <span>必填</span>
                            </label>
                            <span className="sr-only" id={requiredHintId}>
                              勾选后预览会把该字段视为必填，并写入
                              config.requiredColumns
                            </span>
                          </>
                        )}
                      </td>
                      <td className="cell-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeRow(row.id)}
                          aria-label={`删除字段 ${
                            target || `第 ${index + 1} 行`
                          }`}
                        >
                          删除
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          目标字段填 canonical 列名；来源字段填点路径或以 = 开头的常量；转换可用{" "}
          {TRANSFORM_NAMES.join(" / ")}，多个用 | 连接。
        </p>

        <div className="toolbar" style={{ marginBottom: 0, marginTop: 10 }}>
          <Button
            id="mapping-add-field"
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={addRow}
          >
            添加字段
          </Button>
          <span className="muted" style={{ fontSize: 12 }}>
            「必填」会写入{" "}
            <span className="mono">config.requiredColumns</span>
            ，服务端实际强制的仍是五项契约必填字段。
          </span>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="toolbar">
        <span className="muted" style={{ fontSize: 12 }}>
          {activeCount} 个 ACTIVE 映射 · 保存即新建版本
        </span>
        <div className="row-actions">
          <Button
            size="sm"
            variant="secondary"
            icon="refresh"
            onClick={reload}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="plus"
            onClick={() => openCreate()}
          >
            新建映射
          </Button>
        </div>
      </div>

      {actionError ? (
        <div role="alert" style={{ marginBottom: 14 }}>
          <InfoNotice tone="warning">
            <strong>{actionError.title}</strong>
            <p>{actionError.message}</p>
            <div style={{ marginTop: 8 }}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setActionError(null)}
              >
                关闭提示
              </Button>
            </div>
          </InfoNotice>
        </div>
      ) : null}

      {editor ? renderEditor(editor) : null}

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading && mappings.length === 0 ? (
        <LoadingRows rows={3} />
      ) : mappings.length === 0 ? (
        <EmptyState
          icon="layers"
          title="暂无字段映射"
          description="将来源字段映射到证据契约。预设覆盖 HubSpot 交易、飞书多维表格与 ERP 订单。"
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => openCreate()}
            >
              新建映射
            </Button>
          }
        />
      ) : (
        <div
          ref={listRef}
          role="region"
          aria-label="字段映射列表"
          tabIndex={-1}
        >
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">
                {connection.connectionName} 的字段映射列表
              </caption>
              <thead>
                <tr>
                  <th scope="col">映射</th>
                  <th scope="col">类型</th>
                  <th scope="col">Source → target</th>
                  <th scope="col">字段</th>
                  <th scope="col">版本</th>
                  <th scope="col">状态</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr
                    key={mapping.id}
                    className={
                      editor?.base.id === mapping.id ? "is-selected" : ""
                    }
                  >
                    <td>
                      <span className="cell-primary">{mapping.name}</span>
                      <span className="cell-sub mono">
                        {shortId(mapping.id, 12)}
                      </span>
                    </td>
                    <td>{mapping.mappingType}</td>
                    <td>
                      {mapping.sourceSystem} → {mapping.targetType}
                    </td>
                    <td>
                      {Object.keys(mapping.fieldMap ?? {}).length}
                    </td>
                    <td>v{mapping.version}</td>
                    <td>
                      <Badge status={mapping.status} />
                    </td>
                    <td className="cell-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openMappingPreview(mapping)}
                        aria-label={`预览映射 ${mapping.name} v${mapping.version}`}
                      >
                        预览
                      </Button>
                      {mapping.status === "ACTIVE" ? (
                        <>
                          <Button
                            id={`mapping-edit-${mapping.id}`}
                            size="sm"
                            variant="secondary"
                            onClick={() => startEdit(mapping)}
                            aria-label={`编辑映射 ${mapping.name} v${mapping.version}`}
                          >
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => {
                              setRetireError(null);
                              setRetireTarget(mapping);
                            }}
                            aria-label={`退役映射 ${mapping.name} v${mapping.version}`}
                          >
                            退役
                          </Button>
                        </>
                      ) : (
                        <span className="subtle">只读</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SyncFailurePanel
        runs={runs}
        loading={runsLoading}
        error={runsError}
        reload={reloadRuns}
      />

      <Modal
        open={createOpen}
        title="新建字段映射"
        description="预设只是起点——创建版本前请逐项核对。"
        onClose={closeCreateModal}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={closeCreateModal}>
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
        <form
          id="create-mapping-form"
          onSubmit={submitCreate}
          className="stack"
        >
          {formError ? (
            <div role="alert">
              <InfoNotice tone="warning">{formError}</InfoNotice>
            </div>
          ) : null}
          {availablePresets.length > 0 ? (
            <div>
              <div className="form-section__title">供应商预设</div>
              <div className="preset-grid">
                {availablePresets.map((preset) => (
                  <button
                    type="button"
                    className="preset-card"
                    key={preset.code}
                    onClick={() => openCreate(preset)}
                  >
                    <strong>{preset.name}</strong>
                    <span>
                      {preset.sourceSystem} → {preset.targetType} ·{" "}
                      {preset.code}
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
                autoComplete="off"
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
                autoComplete="off"
                required
              />
            </FormField>
            <FormField label="对象类型" htmlFor="mapping-target">
              <TextInput
                id="mapping-target"
                value={targetType}
                onChange={(event) => setTargetType(event.target.value)}
                autoComplete="off"
                required
              />
            </FormField>
            <div className="field field--full">
              <label className="field__label" htmlFor="mapping-fields">
                字段映射（JSON）
              </label>
              <Textarea
                id="mapping-fields"
                value={fieldMapText}
                onChange={(event) => {
                  setFieldMapText(event.target.value);
                  if (fieldMapError) setFieldMapError(null);
                }}
                className="input mono"
                spellCheck={false}
                autoComplete="off"
                style={
                  fieldMapError
                    ? { borderColor: "var(--critical)" }
                    : undefined
                }
                aria-invalid={fieldMapError ? true : undefined}
                aria-describedby={
                  fieldMapError
                    ? `${fieldMapHintId} ${fieldMapErrorId}`
                    : fieldMapHintId
                }
              />
              <span className="field__hint" id={fieldMapHintId}>
                键为 canonical 目标字段；值为来源路径、=常量或 | 转换管道。
              </span>
              {fieldMapError ? (
                <span
                  className="field__error"
                  id={fieldMapErrorId}
                  role="alert"
                >
                  {fieldMapError}
                </span>
              ) : null}
            </div>
            <div className="field field--full">
              <label className="field__label" htmlFor="mapping-config">
                配置（JSON）
              </label>
              <Textarea
                id="mapping-config"
                value={configText}
                onChange={(event) => {
                  setConfigText(event.target.value);
                  if (configError) setConfigError(null);
                }}
                className="input mono"
                spellCheck={false}
                autoComplete="off"
                style={
                  configError
                    ? { borderColor: "var(--critical)" }
                    : undefined
                }
                aria-invalid={configError ? true : undefined}
                aria-describedby={
                  configError
                    ? `${configHintId} ${configErrorId}`
                    : configHintId
                }
              />
              <span className="field__hint" id={configHintId}>
                原样提交；含 headers/token 等敏感键时不会回显。
              </span>
              {configError ? (
                <span
                  className="field__error"
                  id={configErrorId}
                  role="alert"
                >
                  {configError}
                </span>
              ) : null}
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(retireTarget)}
        title="退役映射"
        description="退役映射保留可读供审计，但不再接受新同步；同名版本可继续新建。"
        onClose={closeRetireModal}
        footer={
          <>
            <Button variant="ghost" onClick={closeRetireModal}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => void retireMapping()}
              loading={submitting}
            >
              退役映射
            </Button>
          </>
        }
      >
        {retireTarget ? (
          <div className="stack">
            {retireError ? (
              <div role="alert">
                <InfoNotice tone="warning">{retireError}</InfoNotice>
              </div>
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

      <Modal
        open={Boolean(preview)}
        title={preview ? `解析预览 · ${preview.label}` : "解析预览"}
        description="按当前 fieldMap 本地解析示例 payload；不会调用后端接口。"
        onClose={closePreviewModal}
        wide
        footer={
          <Button variant="ghost" onClick={closePreviewModal}>
            关闭
          </Button>
        }
      >
        {preview ? (
          <MappingPreview
            key={preview.label}
            mappingLabel={preview.label}
            fieldMap={preview.fieldMap}
            requiredTargets={preview.requiredTargets}
          />
        ) : null}
      </Modal>
    </>
  );
}
