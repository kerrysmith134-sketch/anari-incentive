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

export function RunsSection({
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

