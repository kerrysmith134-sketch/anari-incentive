/**
 * 数据质量（2026-11-21 集成审计后续）：连接详情「数据质量」面板。
 * 只读展示租户范围内未处置隔离记录与原因分布；真正的人工处置仍由
 * 「运营」面板（OpsSection）完成，这里只提供入口，避免复制处置逻辑。
 */
import { useMemo } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  InfoNotice,
  LoadingRows,
  StatTile,
} from "../ui.js";
import {
  formatDateTime,
  formatRelative,
  shortId,
  titleCase,
} from "../../lib/format.js";

export interface QuarantineRecordView {
  id: string;
  sourceSystem: string;
  externalRecordId?: string | null;
  reason: string;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  createdAt: string;
}

const REASON_LABELS: Record<string, string> = {
  UNRESOLVED_IDENTITY: "主体身份未解析",
  INVALID_CURRENCY: "币种无效",
  MISSING_RELATION: "关联对象缺失",
  SCHEMA_MISMATCH: "字段契约不匹配",
  OTHER: "其他",
};

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? titleCase(reason);
}

interface ReasonBucket {
  reason: string;
  count: number;
  latestAt: string;
}

export function DataQualitySection({
  records,
  loading,
  error,
  reload,
  onOpenOps,
}: {
  records: QuarantineRecordView[];
  loading: boolean;
  error: Error | undefined;
  reload: () => void;
  onOpenOps: () => void;
}) {
  const summary = useMemo(() => {
    const unresolved = records
      .filter((record) => !record.resolvedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const buckets = new Map<string, ReasonBucket>();
    for (const record of unresolved) {
      const current = buckets.get(record.reason);
      if (current) {
        current.count += 1;
        if (record.createdAt > current.latestAt) {
          current.latestAt = record.createdAt;
        }
      } else {
        buckets.set(record.reason, {
          reason: record.reason,
          count: 1,
          latestAt: record.createdAt,
        });
      }
    }

    const reasons = [...buckets.values()].sort(
      (a, b) =>
        b.count - a.count || b.latestAt.localeCompare(a.latestAt),
    );
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent24h = unresolved.filter(
      (record) => new Date(record.createdAt).getTime() >= cutoff,
    ).length;
    const sources = new Set(
      unresolved.map((record) => record.sourceSystem),
    );
    const oldest = unresolved.reduce<QuarantineRecordView | null>(
      (current, record) =>
        !current || record.createdAt < current.createdAt
          ? record
          : current,
      null,
    );

    return {
      unresolved,
      reasons,
      recent24h,
      sourceCount: sources.size,
      oldest,
      recent: unresolved.slice(0, 8),
    };
  }, [records]);

  return (
    <div className="stack">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          租户范围内所有来源的未处置隔离记录；处置在「运营」标签页完成。
        </span>
        <div className="row-actions">
          <Button size="sm" variant="ghost" icon="refresh" onClick={reload}>
            刷新
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="arrow-up-right"
            onClick={onOpenOps}
          >
            前往运营处置
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading ? (
        <LoadingRows rows={3} />
      ) : summary.unresolved.length === 0 ? (
        <EmptyState
          icon="check"
          title="隔离区为空"
          description="当前没有待处置的隔离记录。无法路由或校验失败的记录会先进入隔离区，再在这里汇总。"
          action={
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              onClick={reload}
            >
              刷新
            </Button>
          }
        />
      ) : (
        <>
          <div className="stat-grid">
            <StatTile
              label="未处置隔离"
              value={summary.unresolved.length}
              detail="需人工处置，处置留痕进入审计"
              tone="warning"
              icon="alert-circle"
            />
            <StatTile
              label="24 小时内新增"
              value={summary.recent24h}
              detail="按隔离创建时间统计"
              tone={summary.recent24h > 0 ? "warning" : "neutral"}
              icon="clock"
            />
            <StatTile
              label="涉及来源系统"
              value={summary.sourceCount}
              detail="按 sourceSystem 去重"
              tone="neutral"
              icon="server"
            />
            <StatTile
              label="最早未处置"
              value={
                summary.oldest
                  ? formatRelative(summary.oldest.createdAt)
                  : "—"
              }
              detail={
                summary.oldest
                  ? formatDateTime(summary.oldest.createdAt)
                  : "暂无待处置记录"
              }
              tone={summary.oldest ? "warning" : "good"}
              icon="clock"
            />
          </div>

          <div className="detail-section">
            <div className="detail-section__title">未处置原因分布</div>
            <div
              className="table-wrap"
              role="region"
              aria-label="未处置隔离原因分布"
              tabIndex={0}
            >
              <table className="data-table">
                <caption className="sr-only">
                  未处置隔离记录按原因分组
                </caption>
                <thead>
                  <tr>
                    <th scope="col">原因</th>
                    <th scope="col" className="cell-num">
                      未处置
                    </th>
                    <th scope="col">最近发生</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.reasons.map((bucket) => (
                    <tr key={bucket.reason}>
                      <td>
                        <Badge tone="warning" dot={false}>
                          {reasonLabel(bucket.reason)}
                        </Badge>
                        <span className="cell-sub mono">
                          {bucket.reason}
                        </span>
                      </td>
                      <td className="cell-num">{bucket.count}</td>
                      <td>
                        <span title={formatDateTime(bucket.latestAt)}>
                          {formatRelative(bucket.latestAt)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="detail-section">
            <div className="detail-section__title">最近隔离记录</div>
            <div
              className="table-wrap"
              role="region"
              aria-label="最近未处置隔离记录"
              tabIndex={0}
            >
              <table className="data-table">
                <caption className="sr-only">
                  最近未处置的隔离记录
                </caption>
                <thead>
                  <tr>
                    <th scope="col">来源</th>
                    <th scope="col">外部记录</th>
                    <th scope="col">原因</th>
                    <th scope="col">隔离时间</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recent.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <span className="cell-primary">
                          {record.sourceSystem}
                        </span>
                        <span
                          className="cell-sub mono"
                          title={record.id}
                        >
                          {shortId(record.id, 10)}
                        </span>
                      </td>
                      <td className="mono">
                        {record.externalRecordId ?? "—"}
                      </td>
                      <td>
                        <Badge tone="warning" dot={false}>
                          {reasonLabel(record.reason)}
                        </Badge>
                      </td>
                      <td>
                        <span title={formatDateTime(record.createdAt)}>
                          {formatRelative(record.createdAt)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {summary.unresolved.length > summary.recent.length ? (
              <p className="muted" style={{ fontSize: 12 }}>
                仅显示最近 {summary.recent.length} 条，共{" "}
                {summary.unresolved.length} 条未处置。
              </p>
            ) : null}
          </div>

          <InfoNotice>
            处置需在「运营」标签页逐条填写处置说明（至少 3 个字）后标记已处置；
            留痕进入审计。处置后可按新映射版本重放原始记录，无需重新拉取供应商数据。
          </InfoNotice>
        </>
      )}
    </div>
  );
}
