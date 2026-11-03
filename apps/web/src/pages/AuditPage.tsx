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
import { downloadJson } from "../lib/api.js";
import {
  formatDateTime,
  formatRelative,
  shortId,
  titleCase,
} from "../lib/format.js";
import type { AuditEvent } from "../lib/types.js";

export function AuditPage() {
  useDocumentTitle("Audit");
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
        eyebrow="Append-only trail"
        title="Audit"
        description="Every sensitive command writes a hash-chained event. Verification recomputes the chain; exceptions are visible immediately."
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
            Refresh
          </Button>
        }
      />

      {durability.data ? (
        <InfoNotice tone={durability.data.ready ? "success" : "warning"}>
          {durability.data.ready
            ? "External durability configuration is complete."
            : "External durability is incomplete."}{" "}
          {durability.data.note}
        </InfoNotice>
      ) : null}

      <Panel
        title="External anchor manifest"
        subtitle="Submit rootHash to an independent TSA or append-only ledger and archive the receipt"
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
              Download
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="refresh"
              onClick={anchor.reload}
              loading={anchor.loading}
            >
              Refresh
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
                  label: "Sequence window",
                  value: `${anchor.data.window.fromSequence ?? "—"} → ${anchor.data.window.toSequence ?? "—"} (${anchor.data.window.eventCount} events)`,
                },
                {
                  label: "First event hash",
                  value: anchor.data.firstEventHash ?? "—",
                },
                {
                  label: "Last event hash",
                  value: anchor.data.lastEventHash ?? "—",
                },
                {
                  label: "Generated",
                  value: formatDateTime(anchor.data.generatedAt),
                },
              ]}
            />
            <p className="subtle" style={{ fontSize: 11.5 }}>
              {anchor.data.note}
            </p>
          </>
        )}
      </Panel>

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Recorded events</span>
          </div>
          <div className="stat-tile__value">{list.length}</div>
          <div className="stat-tile__detail">Latest 250 in this tenant</div>
        </div>
        <div className="stat-tile stat-tile--neutral">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Latest sequence</span>
          </div>
          <div className="stat-tile__value">
            {list.reduce((max, event) => Math.max(max, event.sequence), 0)}
          </div>
          <div className="stat-tile__detail">Monotonic per tenant</div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Chain verification</span>
          </div>
          <div className="stat-tile__value" style={{ fontSize: 22 }}>
            {verify.loading ? (
              "Checking…"
            ) : verify.data?.valid ? (
              <Badge tone="success">Verified</Badge>
            ) : (
              <Badge tone="danger">Attention</Badge>
            )}
          </div>
          <div className="stat-tile__detail">Recomputed from stored hashes</div>
        </div>
      </div>

      <Panel
        title="Event log"
        subtitle="Newest first; select an event to inspect its hashes"
        action={
          <div className="toolbar__group">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search action, actor or object"
            />
            <Select
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
              aria-label="Filter audit action"
              style={{ width: 190, height: 34 }}
            >
              <option value="ALL">All actions</option>
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
            title={list.length === 0 ? "No audit event" : "No match"}
            description={
              list.length === 0
                ? "Sensitive commands such as policy publication, legal gates, calculation locks and settlement transitions append events here."
                : "Try another action or clear the search."
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Seq</th>
                  <th>Action</th>
                  <th>Object</th>
                  <th>Actor</th>
                  <th>Occurred</th>
                  <th>Hash</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((event) => (
                  <tr
                    key={event.id}
                    className="table-clickable"
                    onClick={() => setSelected(event)}
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
        title={selected ? titleCase(selected.action) : "Audit event"}
        description={
          selected
            ? `Sequence ${selected.sequence} · ${formatDateTime(selected.occurredAt)}`
            : undefined
        }
        onClose={() => setSelected(null)}
        wide
        footer={
          <Button variant="secondary" onClick={() => setSelected(null)}>
            Close
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
