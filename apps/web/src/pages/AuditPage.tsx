import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  DefinitionList,
  EmptyState,
  ErrorNotice,
  InfoNotice,
  LoadingRows,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  Select,
} from "../components/ui.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { clickableRowProps } from "../lib/a11y.js";
import { downloadJson } from "../lib/api.js";
import {
  formatDateTime,
  formatRelative,
  shortId,
  titleCase,
} from "../lib/format.js";
import type { AuditEvent } from "../lib/types.js";

export function AuditPage() {
  useDocumentTitle("审计");
  const events = useApiQuery<AuditEvent[]>("/api/v1/audit-events?limit=250");
  const verify = useApiQuery<{ valid: boolean }>("/api/v1/audit-events/verify");
  const durability = useApiQuery<{
    ready: boolean;
    checks: Record<string, boolean | string | null>;
    note: string;
  }>("/api/v1/audit-events/durability");
  const anchor = useApiQuery<{
    tenantId: string;
    generatedAt: string;
    window: {
      fromSequence: number | null;
      toSequence: number | null;
      eventCount: number;
    };
    rootHash: string;
    firstEventHash: string | null;
    lastEventHash: string | null;
    note: string;
  }>("/api/v1/audit-events/anchor");
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const list = events.data ?? [];
  const actions = useMemo(
    () => [...new Set(list.map((event) => event.action))].sort(),
    [list],
  );
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return list
      .filter(
        (event) => actionFilter === "ALL" || event.action === actionFilter,
      )
      .filter((event) => {
        if (!query) return true;
        return [
          event.action,
          event.objectType,
          event.objectId,
          event.actorType,
          event.actorId,
          event.sequence,
          event.id,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      });
  }, [list, search, actionFilter]);

  return (
    <>
      <PageHeader
        eyebrow="追加式留痕"
        title="审计"
        description="每个敏感命令写入哈希链事件；校验会重算整链，异常立即可见。"
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => {
              events.reload();
              verify.reload();
              durability.reload();
              anchor.reload();
            }}
            loading={events.loading}
          >
            刷新
          </Button>
        }
      />

      {durability.data ? (
        <InfoNotice tone={durability.data.ready ? "success" : "warning"}>
          {durability.data.ready
            ? "外部耐久性配置已就绪。"
            : "外部耐久性配置不完整。"}{" "}
          {durability.data.note}
        </InfoNotice>
      ) : null}

      <Panel
        title="外部锚点清单"
        subtitle="将 rootHash 提交给独立 TSA 或追加式账本，并归档回执"
        action={
          <div className="row-actions">
            <Button
              size="sm"
              variant="secondary"
              icon="download"
              disabled={!anchor.data}
              onClick={() =>
                downloadJson(
                  anchor.data,
                  `audit-anchor-${anchor.data?.generatedAt ?? "export"}.json`,
                )
              }
            >
              下载
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="refresh"
              onClick={anchor.reload}
              loading={anchor.loading}
            >
              刷新
            </Button>
          </div>
        }
      >
        {anchor.error ? (
          <ErrorNotice error={anchor.error} onRetry={anchor.reload} />
        ) : anchor.loading || !anchor.data ? (
          <LoadingRows rows={2} />
        ) : (
          <>
            <DefinitionList
              items={[
                { label: "Root hash", value: anchor.data.rootHash },
                {
                  label: "序列区间",
                  value: `${anchor.data.window.fromSequence ?? "—"} → ${anchor.data.window.toSequence ?? "—"} (${anchor.data.window.eventCount} events)`,
                },
                {
                  label: "首事件哈希",
                  value: anchor.data.firstEventHash ?? "—",
                },
                {
                  label: "尾事件哈希",
                  value: anchor.data.lastEventHash ?? "—",
                },
                {
                  label: "Generated",
                  value: formatDateTime(anchor.data.generatedAt),
                },
              ]}
            />
            <p className="subtle" style={{ fontSize: 12 }}>
              {anchor.data.note}
            </p>
          </>
        )}
      </Panel>

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">已记录事件</span>
          </div>
          <div className="stat-tile__value">{list.length}</div>
          <div className="stat-tile__detail">本租户最近 250 条</div>
        </div>
        <div className="stat-tile stat-tile--neutral">
          <div className="stat-tile__top">
            <span className="stat-tile__label">最新序列</span>
          </div>
          <div className="stat-tile__value">
            {list.reduce((max, event) => Math.max(max, event.sequence), 0)}
          </div>
          <div className="stat-tile__detail">按租户单调递增</div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">链校验</span>
          </div>
          <div className="stat-tile__value" style={{ fontSize: 22 }}>
            {verify.loading ? (
              "检查中…"
            ) : verify.data?.valid ? (
              <Badge tone="success">已验证</Badge>
            ) : (
              <Badge tone="danger">关注</Badge>
            )}
          </div>
          <div className="stat-tile__detail">基于存储哈希重算</div>
        </div>
      </div>

      <Panel
        title="事件日志"
        subtitle="最新在前；选择事件查看哈希"
        action={
          <div className="toolbar__group">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="搜索动作、操作人或对象"
            />
            <Select
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
              aria-label="筛选审计动作"
              style={{ width: 190, height: 34 }}
            >
              <option value="ALL">全部动作</option>
              {actions.map((action) => (
                <option key={action} value={action}>
                  {titleCase(action)}
                </option>
              ))}
            </Select>
          </div>
        }
        flush
      >
        {events.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={events.error} onRetry={events.reload} />
          </div>
        ) : events.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={6} />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon="clock"
            title={list.length === 0 ? "暂无审计事件" : "无匹配"}
            description={
              list.length === 0
                ? "政策发布、法律门禁、计算锁定与结算状态变更等敏感操作都会在这里追加审计事件。"
                : "换个动作或清空搜索试试。"
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Seq</th>
                  <th>操作</th>
                  <th>对象</th>
                  <th>操作人</th>
                  <th>发生时间</th>
                  <th>哈希</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((event) => (
                  <tr
                    key={event.id}
                    className="table-clickable"
                    {...clickableRowProps(() => setSelected(event))}
                  >
                    <td className="cell-mono">{event.sequence}</td>
                    <td>
                      <span className="cell-primary">
                        {titleCase(event.action)}
                      </span>
                    </td>
                    <td>
                      <span>{titleCase(event.objectType)}</span>
                      {event.objectId ? (
                        <span className="cell-sub mono">
                          {shortId(event.objectId, 12)}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {event.actorType}
                      {event.actorId ? (
                        <span className="cell-sub mono">
                          {shortId(event.actorId, 10)}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span>{formatRelative(event.occurredAt)}</span>
                      <span className="cell-sub">
                        {formatDateTime(event.occurredAt)}
                      </span>
                    </td>
                    <td className="cell-mono">
                      {shortId(
                        typeof event.eventHash === "string"
                          ? event.eventHash
                          : undefined,
                        12,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={Boolean(selected)}
        title={selected ? titleCase(selected.action) : "审计事件"}
        description={
          selected
            ? `Sequence ${selected.sequence} · ${formatDateTime(selected.occurredAt)}`
            : undefined
        }
        onClose={() => setSelected(null)}
        wide
        footer={
          <Button variant="secondary" onClick={() => setSelected(null)}>
            关闭
          </Button>
        }
      >
        {selected ? (
          <pre className="code-block" style={{ maxHeight: 480 }}>
            {JSON.stringify(selected, null, 2)}
          </pre>
        ) : null}
      </Modal>
    </>
  );
}
