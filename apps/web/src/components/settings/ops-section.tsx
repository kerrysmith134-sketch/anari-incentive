/**
 * INT-209 运营闭环（Sprint 2.1 审计第七节）：连接详情「运营」面板——
 * 隔离区人工处置（resolve）+ 资源监控（checkpoint/租约状态一览）。
 */
import { useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  InfoNotice,
  LoadingRows,
  Panel,
  Textarea,
} from "../ui.js";
import { useApiQuery } from "../../lib/hooks.js";
import { api, ApiError } from "../../lib/api.js";
import { useToast } from "../../contexts/ToastContext.js";
import { formatDateTime, titleCase } from "../../lib/format.js";
interface QuarantineRecordView {
  id: string;
  sourceSystem: string;
  externalRecordId?: string | null;
  reason: string;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  createdAt: string;
}

interface SyncResourceView {
  id: string;
  resourceKey: string;
  status: string;
  leaseOwner?: string | null;
  leaseUntil?: string | null;
}

/** 连接的隔离区待处置列表 + 一键处置。 */
function QuarantineReview({ connectionId }: { connectionId: string }) {
  const toast = useToast();
  const quarantine = useApiQuery<QuarantineRecordView[]>(
    `/api/v1/ingestion-quarantine?unresolved=1`,
    `ops-quarantine-${connectionId}`,
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function resolve(id: string) {
    const note = (notes[id] ?? "").trim();
    if (note.length < 3) {
      toast.error("处置说明过短", "至少 3 个字符——处置留痕进入审计。");
      return;
    }
    setBusyId(id);
    try {
      await api(`/api/v1/ingestion-quarantine/${id}/resolve`, {
        method: "POST",
        body: { resolutionNote: note },
      });
      toast.success("隔离记录已处置", id.slice(0, 8));
      quarantine.reload();
    } catch (caught) {
      toast.error(
        "处置失败",
        caught instanceof ApiError ? caught.message : undefined,
      );
    } finally {
      setBusyId(null);
    }
  }

  const unresolved = quarantine.data ?? [];
  return (
    <div className="detail-section" style={{ marginTop: 0 }}>
      <div className="detail-section__title">隔离区待处置（{unresolved.length}）</div>
      {quarantine.error ? (
        <ErrorNotice error={quarantine.error} onRetry={quarantine.reload} />
      ) : quarantine.loading ? (
        <LoadingRows rows={2} />
      ) : unresolved.length === 0 ? (
        <EmptyState
          icon="check"
          title="隔离区为空"
          description="无法路由/校验失败的记录会出现在这里，处置后可基于原始记录重放。"
        />
      ) : (
        <ul className="stack-list">
          {unresolved.map((record) => (
            <li key={record.id}>
              <Badge status="NEEDS_EVIDENCE">{titleCase(record.reason)}</Badge>{" "}
              <span className="mono">{record.sourceSystem}#{record.externalRecordId ?? "—"}</span>{" "}
              <span className="muted">{formatDateTime(record.createdAt)}</span>
              <Textarea
                value={notes[record.id] ?? ""}
                onChange={(event) =>
                  setNotes((current) => ({ ...current, [record.id]: event.target.value }))
                }
                rows={2}
                aria-label={`处置说明-${record.id}`}
                placeholder="处置说明（≥3 字，进入审计）"
              />
              <Button
                size="sm"
                variant="secondary"
                loading={busyId === record.id}
                onClick={() => void resolve(record.id)}
              >
                标记已处置
              </Button>
            </li>
          ))}
        </ul>
      )}
      <InfoNotice>
        处置后的记录可基于其原始落地（加密 raw）按新映射版本重放——无需重新拉取供应商数据。
      </InfoNotice>
    </div>
  );
}

/** 资源监控：每条同步流的 cursor/watermark/租约状态。 */
function ResourceMonitor({ connectionId }: { connectionId: string }) {
  const resources = useApiQuery<SyncResourceView[]>(
    `/api/v1/sync-resources?connectionId=${connectionId}`,
    `ops-resources-${connectionId}`,
  );
  return (
    <div className="detail-section">
      <div className="detail-section__title">资源同步状态</div>
      {resources.error ? (
        <ErrorNotice error={resources.error} onRetry={resources.reload} />
      ) : resources.loading ? (
        <LoadingRows rows={2} />
      ) : (resources.data ?? []).length === 0 ? (
        <EmptyState
          icon="clock"
          title="暂无同步资源"
          description="每个字段映射会创建一条独立资源流（断点续跑与租约隔离的单位）。"
        />
      ) : (
        <>
          <ul className="stack-list">
            {(resources.data ?? []).map((resource) => (
              <li key={resource.id}>
                <Badge status={resource.status === "ACTIVE" ? "APPROVED" : "WAITING_APPROVAL"}>
                  {resource.status}
                </Badge>{" "}
                <span className="mono">{resource.resourceKey.slice(0, 12)}</span>{" "}
                {resource.leaseOwner ? (
                  <span className="muted">
                    租约中：{resource.leaseOwner.slice(0, 12)}
                    {resource.leaseUntil ? `（至 ${formatDateTime(resource.leaseUntil)}）` : ""}
                  </span>
                ) : (
                  <span className="muted">空闲</span>
                )}
                <CheckpointInspector resourceId={resource.id} />
              </li>
            ))}
          </ul>
          <SchemaDriftPanel connectionId={connectionId} />
        </>
      )}
      <InfoNotice>
        租约保证同一资源流同一时刻只有一个 worker 在同步；fencing token 防止过期 worker 写回。
      </InfoNotice>
    </div>
  );
}

export function OpsSection({ connection }: { connection: { id: string } }) {
  return (
    <div className="stack">
      <QuarantineReview connectionId={connection.id} />
      <ResourceMonitor connectionId={connection.id} />
      <RawRecordExplorer />
      <LineageQuery />
    </div>
  );
}

/** Checkpoint Inspector：cursor/watermark/overlap 明细（INT-206 运营可见）。 */
function CheckpointInspector({ resourceId }: { resourceId: string }) {
  const checkpoint = useApiQuery<
    | {
        cursor?: string | null;
        watermark?: string | null;
        overlapSeconds?: number;
        updatedAt?: string | null;
      }
    | { cursor: null }
  >(`/api/v1/sync-resources/${resourceId}/checkpoint`, `ops-cp-${resourceId}`);
  const data = "cursor" in (checkpoint.data ?? {}) ? checkpoint.data : undefined;
  return (
    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
      Checkpoint：cursor {data && "cursor" in data ? (data.cursor ?? "空") : "—"} ·
      watermark{" "}
      {data && "watermark" in data && data.watermark
        ? formatDateTime(data.watermark)
        : "—"}
      · overlap {data && "overlapSeconds" in data ? (data.overlapSeconds ?? 0) : 0}s
    </div>
  );
}

/** Raw Record Explorer：原始落地记录（元数据；密文永不展示）。 */
function RawRecordExplorer() {
  const raws = useApiQuery<
    Array<{
      id: string;
      sourceSystem: string;
      externalRecordId: string;
      sourceVersion: string;
      mappingVersion: number;
      retentionClass: string;
      replayedAt?: string | null;
      createdAt: string;
    }>
  >("/api/v1/raw-source-records", "ops-raw-records");
  return (
    <div className="detail-section">
      <div className="detail-section__title">
        Raw Record Explorer（密文元数据；payload 永不回显）
      </div>
      {raws.error ? (
        <ErrorNotice error={raws.error} onRetry={raws.reload} />
      ) : raws.loading ? (
        <LoadingRows rows={2} />
      ) : (raws.data ?? []).length === 0 ? (
        <p className="muted">暂无原始落地记录。</p>
      ) : (
        <ul className="stack-list">
          {(raws.data ?? []).slice(0, 20).map((record) => (
            <li key={record.id}>
              <span className="mono">
                {record.sourceSystem}#{record.externalRecordId}
              </span>{" "}
              <span className="muted">
                v{record.sourceVersion} · mapping v{record.mappingVersion} ·{" "}
                {record.retentionClass}
                {record.replayedAt ? " · 已重放" : ""}
              </span>{" "}
              <span className="muted">{formatDateTime(record.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Data Lineage 查询：原始记录 → 投影产物（证据/财务事实）。 */
function LineageQuery() {
  const [sourceSystem, setSourceSystem] = useState("");
  const [externalRecordId, setExternalRecordId] = useState("");
  const [result, setResult] = useState<{
    projections: Array<{ kind: string; id: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function query() {
    setError(null);
    setBusy(true);
    try {
      const data = await api<{
        raw: { id: string } | null;
        projections: Array<{ kind: string; id: string }>;
      }>(
        `/api/v1/raw-source-records/lineage?sourceSystem=${encodeURIComponent(
          sourceSystem,
        )}&externalRecordId=${encodeURIComponent(externalRecordId)}`,
      );
      setResult(data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "查询失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail-section">
      <div className="detail-section__title">数据血缘查询</div>
      <div className="toolbar__group">
        <input
          className="input"
          value={sourceSystem}
          onChange={(event) => setSourceSystem(event.target.value)}
          placeholder="来源系统"
          aria-label="血缘来源系统"
        />
        <input
          className="input"
          value={externalRecordId}
          onChange={(event) => setExternalRecordId(event.target.value)}
          placeholder="外部记录 ID"
          aria-label="血缘外部记录 ID"
        />
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          onClick={() => void query()}
        >
          查询血缘
        </Button>
      </div>
      {error ? <InfoNotice tone="warning">{error}</InfoNotice> : null}
      {result ? (
        result.projections.length === 0 ? (
          <p className="muted">无投影产物（未同步或已隔离）。</p>
        ) : (
          <ul className="stack-list">
            {result.projections.map((projection) => (
              <li key={`${projection.kind}-${projection.id}`}>
                <Badge status="APPROVED">{projection.kind}</Badge>{" "}
                <span className="mono">{projection.id.slice(0, 12)}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

/** Schema Drift：probe 真实样本与 ACTIVE 映射对比（供应商字段变化检测）。 */
function SchemaDriftPanel({ connectionId }: { connectionId: string }) {
  const [preview, setPreview] = useState<{
    fields: string[];
    drift: string[];
    mappedPreview: Record<string, string>;
    ok: boolean;
    detail?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function runPreview() {
    setBusy(true);
    try {
      const data = await api<{
        fields: string[];
        drift: string[];
        mappedPreview: Record<string, string>;
        ok: boolean;
        detail?: string;
      }>(`/api/v1/integration-connections/${connectionId}/schema-preview`, {
        method: "POST",
        body: {},
      });
      setPreview(data);
    } catch (caught) {
      toast.error(
        "Schema 预览失败",
        caught instanceof ApiError ? caught.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail-section">
      <div className="detail-section__title">Schema Drift 检测</div>
      <Button size="sm" variant="secondary" loading={busy} onClick={() => void runPreview()}>
        拉取样本并对比映射
      </Button>
      {preview ? (
        <>
          <InfoNotice tone={preview.ok ? "success" : "warning"}>
            {preview.ok
              ? `样本字段：${preview.fields.join("、")}`
              : `探测失败：${preview.detail ?? "未知"}`}
          </InfoNotice>
          {preview.drift.length > 0 ? (
            <InfoNotice tone="warning">
              Drift：{preview.drift.join("；")}
            </InfoNotice>
          ) : preview.ok ? (
            <InfoNotice tone="success">无 drift——样本字段与映射一致。</InfoNotice>
          ) : null}
          {Object.keys(preview.mappedPreview).length > 0 ? (
            <ul className="stack-list muted">
              {Object.entries(preview.mappedPreview).map(([column, value]) => (
                <li key={column}>
                  {column} → <span className="mono">{value}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

