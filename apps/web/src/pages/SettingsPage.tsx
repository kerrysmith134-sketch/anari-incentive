import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  CopyButton,
  DefinitionList,
  EmptyState,
  ErrorNotice,
  FormField,
  InfoNotice,
  LoadingRows,
  PageHeader,
  Panel,
  TextInput,
} from "../components/ui.js";
import { Icon } from "../components/Icon.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useTheme, type ThemePreference } from "../contexts/ThemeContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { DEFAULT_SESSION } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  formatDate,
  shortId,
  titleCase,
} from "../lib/format.js";
import type {
  DpiaRecord,
  DsarRequest,
  PlatformIdentity,
  RetentionPolicy,
} from "../lib/types.js";

export function SettingsPage() {
  useDocumentTitle("Settings");
  const { session, updateSession } = useAuth();
  const { preference, setPreference } = useTheme();
  const toast = useToast();
  const identity = useApiQuery<PlatformIdentity>("/api/v1/platform/identity");
  const health = useApiQuery<{ status: string }>("/health");
  const auditChain = useApiQuery<{ valid: boolean }>(
    "/api/v1/audit-events/verify",
  );
  const dpias = useApiQuery<DpiaRecord[]>("/api/v1/dpia-records");
  const dsars = useApiQuery<DsarRequest[]>("/api/v1/dsar-requests");
  const retention = useApiQuery<RetentionPolicy[]>("/api/v1/retention-policies");

  const [tenantId, setTenantId] = useState(session.tenantId);
  const [userId, setUserId] = useState(session.userId);
  const [personId, setPersonId] = useState(session.personId);
  const [token, setToken] = useState(session.token ?? "");

  function saveSession(event: FormEvent) {
    event.preventDefault();
    updateSession({
      tenantId: tenantId.trim(),
      userId: userId.trim(),
      personId: personId.trim(),
      token: token.trim(),
    });
    toast.success(
      "Session updated",
      "Reloading to apply the tenant and person context.",
    );
    window.setTimeout(() => window.location.reload(), 450);
  }

  function resetSession() {
    updateSession(DEFAULT_SESSION);
    setTenantId(DEFAULT_SESSION.tenantId);
    setUserId(DEFAULT_SESSION.userId);
    setPersonId(DEFAULT_SESSION.personId);
    setToken("");
    toast.success("Session reset", "Restored the development defaults.");
    window.setTimeout(() => window.location.reload(), 450);
  }

  const openDsars =
    dsars.data?.filter((request) => request.status === "OPEN") ?? [];
  const overdueDsars = openDsars.filter(
    (request) => request.dueAt && new Date(request.dueAt).getTime() < Date.now(),
  );
  const heldPolicies =
    retention.data?.filter((policy) => policy.legalHold) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Session identity, appearance and the assurance registers that govern this tenant's data."
      />

      <div className="split-grid">
        <Panel
          title="Session context"
          subtitle="Sent as x-tenant-id, x-user-id and x-person-id on every API call"
        >
          <form onSubmit={saveSession} className="stack">
            <FormField
              label="Tenant id"
              htmlFor="session-tenant"
              hint="In development this can be tenant-demo; in PostgreSQL mode use the tenant UUID."
            >
              <TextInput
                id="session-tenant"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                required
              />
            </FormField>
            <FormField label="User id" htmlFor="session-user">
              <TextInput
                id="session-user"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Person id"
              htmlFor="session-person"
              hint="Used for approval attribution, payroll separation of duties and person-scoped requests."
            >
              <TextInput
                id="session-person"
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="OIDC bearer token (optional)"
              htmlFor="session-token"
              hint="Used when the API runs with AUTH_MODE=oidc. It stays in this browser's local storage; prefer an edge-injected token in production."
            >
              <TextInput
                id="session-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="eyJhbGciOi…"
                autoComplete="off"
                spellCheck={false}
              />
            </FormField>
            <div className="form-actions">
              <Button variant="ghost" onClick={resetSession}>
                Reset defaults
              </Button>
              <Button variant="primary" type="submit" icon="check">
                Save session
              </Button>
            </div>
          </form>
          <InfoNotice tone="warning">
            <strong>Header authentication is for development.</strong> In OIDC
            mode the server ignores these headers and derives identity from the
            signed token.
          </InfoNotice>
        </Panel>

        <div className="stack">
          <Panel title="Appearance" subtitle="Theme is stored per browser">
            <div className="toolbar__group">
              {(
                [
                  { id: "light", label: "Light", icon: "sun" },
                  { id: "dark", label: "Dark", icon: "moon" },
                  { id: "system", label: "System", icon: "settings" },
                ] as Array<{ id: ThemePreference; label: string; icon: "sun" | "moon" | "settings" }>
              ).map((option) => (
                <Button
                  key={option.id}
                  variant={preference === option.id ? "primary" : "secondary"}
                  icon={option.icon}
                  onClick={() => setPreference(option.id)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
              Dark mode is a selected palette, not an inverted filter. Charts and
              status colours keep their validated contrast on both surfaces.
            </p>
          </Panel>

          <Panel title="Identity resolution" subtitle="What the server sees">
            {identity.error ? (
              <ErrorNotice error={identity.error} onRetry={identity.reload} />
            ) : identity.loading ? (
              <LoadingRows rows={3} />
            ) : identity.data ? (
              <DefinitionList
                items={[
                  { label: "User", value: <span className="mono">{identity.data.userId}</span> },
                  {
                    label: "Linked person",
                    value: identity.data.personId ? (
                      <span className="mono">{identity.data.personId}</span>
                    ) : (
                      "Not linked"
                    ),
                  },
                  {
                    label: "Membership roles",
                    value:
                      identity.data.roles.length > 0
                        ? identity.data.roles.join(", ")
                        : "None recorded",
                  },
                ]}
              />
            ) : null}
            <div className="row-actions section-gap" style={{ justifyContent: "flex-start" }}>
              <CopyButton value={session.tenantId} label="Copy tenant" />
              <CopyButton value={session.personId} label="Copy person" />
            </div>
          </Panel>

          <Panel title="System health" subtitle="Live probes from this browser">
            <DefinitionList
              items={[
                {
                  label: "API health",
                  value: health.loading ? (
                    "Checking…"
                  ) : health.error ? (
                    <Badge tone="danger">Unreachable</Badge>
                  ) : (
                    <Badge tone="success">
                      {titleCase(health.data?.status ?? "ok")}
                    </Badge>
                  ),
                },
                {
                  label: "Audit chain",
                  value: auditChain.loading ? (
                    "Checking…"
                  ) : auditChain.data?.valid ? (
                    <Badge tone="success">Verified</Badge>
                  ) : (
                    <Badge tone="danger">Needs attention</Badge>
                  ),
                },
                {
                  label: "Console origin",
                  value: <span className="mono">{window.location.origin}</span>,
                },
                {
                  label: "API base",
                  value: (
                    <span className="mono">
                      {import.meta.env.VITE_API_BASE || "same origin"}
                    </span>
                  ),
                },
              ]}
            />
          </Panel>
        </div>
      </div>

      <div className="section-gap">
        <PageHeader
          eyebrow="Registers"
          title="Assurance records"
          description="Read-only views of the privacy and retention artefacts that a formal cycle depends on."
        />
      </div>

      <div className="split-grid">
        <Panel
          title="DPIAs"
          subtitle="Data protection impact assessments"
          action={<Badge tone="neutral" dot={false}>{dpias.data?.length ?? 0}</Badge>}
          flush
        >
          {dpias.error ? (
            <div style={{ padding: 16 }}>
              <ErrorNotice error={dpias.error} onRetry={dpias.reload} />
            </div>
          ) : dpias.loading ? (
            <div style={{ padding: 16 }}>
              <LoadingRows rows={3} />
            </div>
          ) : (dpias.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="lock"
              title="No DPIA recorded"
              description="A policy version that touches employee data should reference an approved assessment."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Scope</th>
                    <th>Status</th>
                    <th>Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {dpias.data?.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <span className="cell-primary">
                          {record.assessmentType}
                        </span>
                        <span className="cell-sub mono">
                          {shortId(record.id, 10)}
                        </span>
                      </td>
                      <td>{record.scope}</td>
                      <td>
                        <Badge status={record.status} />
                      </td>
                      <td className="nowrap">
                        {record.approvedAt
                          ? formatDate(record.approvedAt)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Data subject requests"
          subtitle={`${openDsars.length} open · ${overdueDsars.length} overdue`}
          action={<Badge tone={overdueDsars.length > 0 ? "danger" : "neutral"} dot={false}>{dsars.data?.length ?? 0}</Badge>}
          flush
        >
          {dsars.error ? (
            <div style={{ padding: 16 }}>
              <ErrorNotice error={dsars.error} onRetry={dsars.reload} />
            </div>
          ) : dsars.loading ? (
            <div style={{ padding: 16 }}>
              <LoadingRows rows={3} />
            </div>
          ) : (dsars.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="user"
              title="No data subject request"
              description="Access, correction, deletion, explanation and objection requests appear here."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Person</th>
                    <th>Status</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {dsars.data?.slice(0, 8).map((request) => {
                    const overdue =
                      request.status === "OPEN" &&
                      Boolean(request.dueAt) &&
                      new Date(request.dueAt as string).getTime() < Date.now();
                    return (
                      <tr key={request.id}>
                        <td>
                          <span className="cell-primary">{request.requestType}</span>
                          <span className="cell-sub mono">
                            {shortId(request.id, 10)}
                          </span>
                        </td>
                        <td className="mono">{shortId(request.personId, 10)}</td>
                        <td>
                          <Badge status={request.status} />
                        </td>
                        <td className={overdue ? "text-danger nowrap" : "nowrap"}>
                          {request.dueAt ? formatDate(request.dueAt) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="Retention policies"
        subtitle={`${heldPolicies.length} under legal hold`}
        className="section-gap"
        flush
      >
        {retention.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={retention.error} onRetry={retention.reload} />
          </div>
        ) : retention.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : (retention.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="clock"
            title="No retention policy"
            description="Define retention months and a legal basis per data category. Automated deletion is intentionally not wired."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data category</th>
                  <th className="cell-num">Retention</th>
                  <th>Legal basis</th>
                  <th>Legal hold</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {retention.data?.map((policy) => (
                  <tr key={policy.id}>
                    <td>
                      <span className="cell-primary">{policy.dataCategory}</span>
                      <span className="cell-sub mono">{shortId(policy.id, 10)}</span>
                    </td>
                    <td className="cell-num">{policy.retentionMonths} months</td>
                    <td>{policy.legalBasis}</td>
                    <td>
                      <Badge tone={policy.legalHold ? "warning" : "neutral"}>
                        {policy.legalHold ? "Held" : "None"}
                      </Badge>
                    </td>
                    <td className="nowrap">{formatDate(policy.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <InfoNotice>
        <Icon name="shield" size={15} /> Automated retention deletion is not
        enabled. A retention policy records the rule and legal hold; disposal
        remains a reviewed, manual operation.
      </InfoNotice>

      <p className="subtle" style={{ fontSize: 11.5, marginTop: 18 }}>
        Session context is stored in this browser for development. Person{" "}
        {shortId(session.personId, 12)}.
      </p>
    </>
  );
}
