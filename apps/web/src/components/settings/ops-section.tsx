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
  const checkpoints = useApiQuery<Record<string, unknown>[]>(
    "/api/v1/sync-resources",
    "ops-resources-all",
  );
  void checkpoints;
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
            </li>
          ))}
        </ul>
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
    </div>
  );
}
