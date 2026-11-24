/**
 * 运行健康（2026-11-21 集成审计后续）：连接详情「运行健康」面板。
 * 复用页面已有的 sync-runs 数据，不新增后端端点；展示最近成功/失败与
 * raw / created / duplicate / quarantined / failed 精确计数，并对成功运行做计数对账。
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
} from "../../lib/format.js";
import type { SyncRun } from "../../lib/types.js";

/**
 * sync-runs API 已返回、但 web 端 SyncRun 类型（lib/types.ts）尚未覆盖的
 * 精确计数（NP-016 / INT-211）。只读消费，不改后端契约。
 */
interface SyncRunMetricFields {
  recordsFetched?: number;
  recordsRawPersisted?: number;
  recordsCreated?: number;
  recordsUpdated?: number;
  recordsDuplicate?: number;
  recordsInvalid?: number;
  recordsQuarantined?: number;
  recordsFailed?: number;
}

type SyncRunWithMetrics = SyncRun & SyncRunMetricFields;

interface RunMetrics {
  fetched: number | null;
  rawPersisted: number | null;
  created: number | null;
  updated: number | null;
  duplicate: number | null;
  invalid: number | null;
  quarantined: number | null;
  failed: number | null;
  diff: number | null;
}

const RECENT_LIMIT = 8;

function numeric(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function isSucceeded(status: string): boolean {
  const normalized = status.toUpperCase();
  return normalized === "SUCCEEDED" || normalized === "COMPLETED";
}

function isFailed(status: string): boolean {
  return status.toUpperCase() === "FAILED";
}

/**
 * 对账口径（packages/connectors/src/sync-runner.ts SyncCounters 契约）：
 * fetched = created + updated + duplicate + quarantined + failed；
 * invalid 是 quarantined 的子集，不重复计入。
 */
function metricsFor(run: SyncRunWithMetrics): RunMetrics {
  const fetched =
    numeric(run.recordsFetched) ?? numeric(run.recordsSeen);
  const rawPersisted = numeric(run.recordsRawPersisted);
  const created = numeric(run.recordsCreated);
  const updated = numeric(run.recordsUpdated);
  const duplicate = numeric(run.recordsDuplicate);
  const invalid = numeric(run.recordsInvalid);
  const quarantined = numeric(run.recordsQuarantined);
  const failed = numeric(run.recordsFailed);

  const diff =
    fetched !== null &&
    created !== null &&
    updated !== null &&
    duplicate !== null &&
    quarantined !== null &&
    failed !== null
      ? fetched -
        (created + updated + duplicate + quarantined + failed)
      : null;

  return {
    fetched,
    rawPersisted,
    created,
    updated,
    duplicate,
    invalid,
    quarantined,
    failed,
    diff,
  };
}

function ReconciliationCell({
  run,
  metrics,
}: {
  run: SyncRun;
  metrics: RunMetrics;
}) {
  if (metrics.diff === null) {
    return <span className="subtle">—</span>;
  }
  if (!isSucceeded(run.status)) {
    return isFailed(run.status) ? (
      <span
        className="subtle"
        title="运行中断，未处理的 fetched 记录不计入对平"
      >
        中断
      </span>
    ) : (
      <span className="subtle">—</span>
    );
  }
  return metrics.diff === 0 ? (
    <Badge tone="success" dot={false}>
      已对平
    </Badge>
  ) : (
    <Badge tone="warning" dot={false}>
      差 {metrics.diff}
    </Badge>
  );
}

export function HealthSection({
  runs,
  loading,
  error,
  reload,
  onOpenRuns,
}: {
  runs: SyncRun[];
  loading: boolean;
  error: Error | undefined;
  reload: () => void;
  onOpenRuns: () => void;
}) {
  const stats = useMemo(() => {
    const detailed: SyncRunWithMetrics[] = runs;
    const succeeded = detailed.filter((run) =>
      isSucceeded(run.status),
    ).length;
    const failed = detailed.filter((run) => isFailed(run.status)).length;
    const completed = succeeded + failed;
    const successRate =
      completed > 0
        ? Math.round((succeeded / completed) * 1000) / 10
        : null;

    const entries = detailed.map((run) => ({
      run,
      metrics: metricsFor(run),
    }));
    const checkable = entries.filter(
      (entry) =>
        entry.metrics.diff !== null && isSucceeded(entry.run.status),
    );
    const reconciled = checkable.filter(
      (entry) => entry.metrics.diff === 0,
    ).length;
    const totals = entries.reduce(
      (acc, entry) => ({
        raw: acc.raw + (entry.metrics.rawPersisted ?? 0),
        created: acc.created + (entry.metrics.created ?? 0),
        duplicate: acc.duplicate + (entry.metrics.duplicate ?? 0),
        quarantined:
          acc.quarantined + (entry.metrics.quarantined ?? 0),
        failed: acc.failed + (entry.metrics.failed ?? 0),
      }),
      { raw: 0, created: 0, duplicate: 0, quarantined: 0, failed: 0 },
    );

    return {
      detailed,
      latest: detailed[0],
      succeeded,
      failed,
      completed,
      successRate,
      checkable: checkable.length,
      reconciled,
      totals,
      recent: entries.slice(0, RECENT_LIMIT),
    };
  }, [runs]);

  const latest = stats.latest;

  return (
    <div className="stack">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {stats.detailed.length > RECENT_LIMIT
            ? `显示最近 ${RECENT_LIMIT} / ${stats.detailed.length} 次运行。`
            : `当前连接共 ${stats.detailed.length} 次运行。`}
          数据来自 sync-runs 精确计数。
        </span>
        <div className="row-actions">
          <Button size="sm" variant="ghost" icon="refresh" onClick={reload}>
            刷新
          </Button>
          <Button size="sm" variant="secondary" onClick={onOpenRuns}>
            同步运行
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading ? (
        <LoadingRows rows={3} />
      ) : stats.detailed.length === 0 ? (
        <EmptyState
          icon="server"
          title="暂无同步运行"
          description="排队一次同步后，这里会显示每次运行的 raw / created / duplicate / quarantined / failed 计数与对账结果。"
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
              label="最近运行"
              value={
                latest ? (
                  <Badge
                    status={latest.status}
                    tone={
                      isSucceeded(latest.status)
                        ? "success"
                        : isFailed(latest.status)
                          ? "danger"
                          : undefined
                    }
                  />
                ) : (
                  "—"
                )
              }
              detail={
                latest
                  ? latest.finishedAt
                    ? `完成于 ${formatRelative(latest.finishedAt)}`
                    : `创建于 ${formatRelative(latest.createdAt)}`
                  : "—"
              }
              tone={
                latest && isFailed(latest.status)
                  ? "critical"
                  : latest && isSucceeded(latest.status)
                    ? "good"
                    : "neutral"
              }
              icon="server"
            />
            <StatTile
              label="成功率"
              value={
                stats.successRate === null
                  ? "—"
                  : `${stats.successRate}%`
              }
              detail={`${stats.succeeded} 成功 / ${stats.failed} 失败（全部运行）`}
              tone={
                stats.completed === 0
                  ? "neutral"
                  : stats.failed === 0
                    ? "good"
                    : "warning"
              }
              icon="trend-up"
            />
            <StatTile
              label="计数对平"
              value={
                stats.checkable === 0
                  ? "—"
                  : `${stats.reconciled}/${stats.checkable}`
              }
              detail={
                stats.checkable === 0
                  ? "成功运行尚无完整的精确计数"
                  : stats.reconciled === stats.checkable
                    ? "全部成功运行 fetched 与逐条结果一致"
                    : `${stats.checkable - stats.reconciled} 次成功运行存在差额`
              }
              tone={
                stats.checkable > 0 &&
                stats.reconciled === stats.checkable
                  ? "good"
                  : stats.checkable > 0
                    ? "warning"
                    : "neutral"
              }
              icon="check"
            />
            <StatTile
              label="隔离 / 失败（合计）"
              value={`${stats.totals.quarantined} / ${stats.totals.failed}`}
              detail={`raw ${stats.totals.raw} · created ${stats.totals.created} · duplicate ${stats.totals.duplicate}`}
              tone={
                stats.totals.failed > 0
                  ? "critical"
                  : stats.totals.quarantined > 0
                    ? "warning"
                    : "good"
              }
              icon="alert-circle"
            />
          </div>

          <div className="detail-section">
            <div className="detail-section__title">
              逐次运行计数与对账
            </div>
            <div
              className="table-wrap"
              role="region"
              aria-label="最近同步运行计数与对账"
              tabIndex={0}
            >
              <table className="data-table">
                <caption className="sr-only">
                  最近同步运行的 raw、created、duplicate、quarantined、failed
                  计数与对账结果
                </caption>
                <thead>
                  <tr>
                    <th scope="col">运行</th>
                    <th scope="col">状态</th>
                    <th scope="col" className="cell-num">
                      Raw
                    </th>
                    <th scope="col" className="cell-num">
                      Created
                    </th>
                    <th scope="col" className="cell-num">
                      Duplicate
                    </th>
                    <th scope="col" className="cell-num">
                      Quarantined
                    </th>
                    <th scope="col" className="cell-num">
                      Failed
                    </th>
                    <th scope="col">对账</th>
                    <th scope="col">完成</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent.map(({ run, metrics }) => (
                    <tr key={run.id}>
                      <td>
                        <span
                          className="cell-primary mono"
                          title={run.id}
                        >
                          {shortId(run.id, 14)}
                        </span>
                        {run.errorSummary ? (
                          <span className="cell-sub text-danger">
                            {run.errorSummary}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <Badge
                          status={run.status}
                          tone={
                            isSucceeded(run.status)
                              ? "success"
                              : isFailed(run.status)
                                ? "danger"
                                : undefined
                          }
                        />
                      </td>
                      <td className="cell-num">
                        {metrics.rawPersisted === null
                          ? "—"
                          : metrics.rawPersisted}
                      </td>
                      <td className="cell-num">
                        {metrics.created === null
                          ? "—"
                          : metrics.created}
                        {metrics.updated === null ? null : (
                          <span className="cell-sub">
                            +{metrics.updated} 更新
                          </span>
                        )}
                      </td>
                      <td className="cell-num">
                        {metrics.duplicate === null
                          ? "—"
                          : metrics.duplicate}
                      </td>
                      <td className="cell-num">
                        {metrics.quarantined === null
                          ? "—"
                          : metrics.quarantined}
                        {metrics.invalid !== null &&
                        metrics.invalid > 0 ? (
                          <span className="cell-sub">
                            {metrics.invalid} invalid
                          </span>
                        ) : null}
                      </td>
                      <td className="cell-num">
                        {metrics.failed === null
                          ? "—"
                          : metrics.failed}
                      </td>
                      <td>
                        <ReconciliationCell
                          run={run}
                          metrics={metrics}
                        />
                      </td>
                      <td>
                        {run.finishedAt ? (
                          <span
                            title={formatDateTime(run.finishedAt)}
                          >
                            {formatRelative(run.finishedAt)}
                          </span>
                        ) : (
                          <span className="subtle">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <InfoNotice>
            对账口径：{" "}
            <span className="mono">
              fetched = created + updated + duplicate + quarantined + failed
            </span>
            。invalid 是 quarantined 的子集，不重复计入；失败运行可能因中断
            留下未处理记录，因此只对成功运行判定「已对平」。早期运行缺少精确
            字段时显示 —。
          </InfoNotice>
        </>
      )}
    </div>
  );
}
