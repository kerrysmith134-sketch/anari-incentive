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
  Modal,
  PageHeader,
  Panel,
  Select,
  Textarea,
  TextInput,
} from "../components/ui.js";
import { Icon } from "../components/Icon.js";
import { Link } from "react-router-dom";
import { PersonSelect } from "../components/PersonSelect.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useTheme, type ThemePreference } from "../contexts/ThemeContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { api, DEFAULT_SESSION } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  formatDate,
  shortId,
  titleCase,
} from "../lib/format.js";
import type {
  ConflictDeclaration,
  DataClassification,
  DataMapReport,
  DpiaRecord,
  FairnessCommitment,
  DsarRequest,
  PlatformIdentity,
  RetentionPolicy,
  TrustSurveyReport,
  TrustSurveyRun,
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
  const dataMap = useApiQuery<DataMapReport>("/api/v1/data-map");
  const conflicts = useApiQuery<ConflictDeclaration[]>(
    "/api/v1/conflict-declarations",
  );
  const trustSurveys = useApiQuery<TrustSurveyRun[]>("/api/v1/trust-surveys");
  const commitments = useApiQuery<FairnessCommitment[]>(
    "/api/v1/fairness-commitments",
  );

  const [tenantId, setTenantId] = useState(session.tenantId);
  const [userId, setUserId] = useState(session.userId);
  const [personId, setPersonId] = useState(session.personId);
  const [token, setToken] = useState(session.token ?? "");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceCode, setSourceCode] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceCategory, setSourceCategory] = useState("SALES");
  const [sourceOwner, setSourceOwner] = useState(session.personId);
  const [sourceSla, setSourceSla] = useState("24");
  const [sourceCriticality, setSourceCriticality] = useState<
    "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  >("MEDIUM");
  const [sourceRegion, setSourceRegion] = useState("cn-shanghai");
  const [sourcePersonal, setSourcePersonal] = useState(true);
  const [sourceCrossBorder, setSourceCrossBorder] = useState(false);
  const [sourceProcessors, setSourceProcessors] = useState("");
  const [sourceFields, setSourceFields] = useState<
    Array<{
      fieldName: string;
      classification: DataClassification;
      purpose: string;
    }>
  >([
    {
      fieldName: "",
      classification: "INTERNAL",
      purpose: "",
    },
  ]);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictSaving, setConflictSaving] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [conflictPerson, setConflictPerson] = useState(session.personId);
  const [conflictRelated, setConflictRelated] = useState("");
  const [conflictType, setConflictType] = useState("FAMILY");
  const [conflictDescription, setConflictDescription] = useState("");
  const [revokeTarget, setRevokeTarget] =
    useState<ConflictDeclaration | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [surveySaving, setSurveySaving] = useState(false);
  const [surveyError, setSurveyError] = useState<string | null>(null);
  const [surveyCode, setSurveyCode] = useState("TRUST_QUARTERLY");
  const [surveyPeriod, setSurveyPeriod] = useState("2026-Q4");
  const [surveyTitle, setSurveyTitle] = useState(
    "Quarterly trust and procedural fairness",
  );
  const [surveyQuestions, setSurveyQuestions] = useState<
    Array<{ code: string; prompt: string; dimension: string }>
  >([{ code: "FAIRNESS", prompt: "", dimension: "FAIRNESS" }]);
  const [respondTarget, setRespondTarget] = useState<TrustSurveyRun | null>(
    null,
  );
  const [respondentId, setRespondentId] = useState(session.personId);
  const [responseScores, setResponseScores] = useState<
    Record<string, string>
  >({});
  const [responseError, setResponseError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<TrustSurveyRun | null>(
    null,
  );
  const report = useApiQuery<TrustSurveyReport>(
    reportTarget
      ? `/api/v1/trust-surveys/${reportTarget.id}/report`
      : null,
  );
  const [commitmentOpen, setCommitmentOpen] = useState(false);
  const [commitmentSaving, setCommitmentSaving] = useState(false);
  const [commitmentError, setCommitmentError] = useState<string | null>(null);
  const [commitmentStatement, setCommitmentStatement] = useState("");
  const [commitmentOwner, setCommitmentOwner] = useState(session.personId);
  const [commitmentChannels, setCommitmentChannels] = useState(
    "INTRANET, TOWN_HALL",
  );

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

  function resetDataSourceForm() {
    setSourceCode("");
    setSourceName("");
    setSourceCategory("SALES");
    setSourceOwner(session.personId);
    setSourceSla("24");
    setSourceCriticality("MEDIUM");
    setSourceRegion("cn-shanghai");
    setSourcePersonal(true);
    setSourceCrossBorder(false);
    setSourceProcessors("");
    setSourceFields([
      { fieldName: "", classification: "INTERNAL", purpose: "" },
    ]);
    setSourceError(null);
  }

  async function saveDataSource(event: FormEvent) {
    event.preventDefault();
    setSourceSaving(true);
    setSourceError(null);
    try {
      await api("/api/v1/data-sources", {
        method: "POST",
        body: {
          code: sourceCode.trim(),
          name: sourceName.trim(),
          category: sourceCategory.trim(),
          ownerPersonId: sourceOwner,
          slaHours: Number(sourceSla),
          criticality: sourceCriticality,
          containsPersonalData: sourcePersonal,
          storageRegion: sourceRegion.trim(),
          crossBorderTransfers: sourceCrossBorder,
          processorRefs: sourceProcessors
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          fields: sourceFields
            .filter((field) => field.fieldName.trim() && field.purpose.trim())
            .map((field) => ({
              fieldName: field.fieldName.trim(),
              classification: field.classification,
              purpose: field.purpose.trim(),
            })),
        },
      });
      toast.success("Data source registered", "The data map has been refreshed.");
      setSourceOpen(false);
      resetDataSourceForm();
      dataMap.reload();
    } catch (error) {
      setSourceError(
        error instanceof Error ? error.message : "Could not register the source.",
      );
    } finally {
      setSourceSaving(false);
    }
  }

  function openCommitmentForm() {
    setCommitmentStatement("");
    setCommitmentOwner(session.personId);
    setCommitmentChannels("INTRANET, TOWN_HALL");
    setCommitmentError(null);
    setCommitmentOpen(true);
  }

  async function publishCommitment(event: FormEvent) {
    event.preventDefault();
    setCommitmentSaving(true);
    setCommitmentError(null);
    try {
      await api("/api/v1/fairness-commitments", {
        method: "POST",
        body: {
          statement: commitmentStatement.trim(),
          ownerPersonId: commitmentOwner,
          channels: commitmentChannels
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        },
      });
      toast.success(
        "Commitment published",
        "The prior version is retained as superseded.",
      );
      setCommitmentOpen(false);
      commitments.reload();
    } catch (error) {
      setCommitmentError(
        error instanceof Error
          ? error.message
          : "Could not publish the commitment.",
      );
    } finally {
      setCommitmentSaving(false);
    }
  }

  function openSurveyForm() {
    setSurveyCode("TRUST_QUARTERLY");
    setSurveyPeriod("2026-Q4");
    setSurveyTitle("Quarterly trust and procedural fairness");
    setSurveyQuestions([{ code: "FAIRNESS", prompt: "", dimension: "FAIRNESS" }]);
    setSurveyError(null);
    setSurveyOpen(true);
  }

  async function saveSurvey(event: FormEvent) {
    event.preventDefault();
    setSurveySaving(true);
    setSurveyError(null);
    try {
      await api("/api/v1/trust-surveys", {
        method: "POST",
        body: {
          code: surveyCode.trim(),
          period: surveyPeriod.trim(),
          title: surveyTitle.trim(),
          questions: surveyQuestions
            .filter(
              (question) =>
                question.code.trim() &&
                question.prompt.trim() &&
                question.dimension.trim(),
            )
            .map((question) => ({
              code: question.code.trim(),
              prompt: question.prompt.trim(),
              dimension: question.dimension.trim(),
            })),
        },
      });
      toast.success("Trust survey created", "Open it when the questions are ready.");
      setSurveyOpen(false);
      trustSurveys.reload();
    } catch (error) {
      setSurveyError(
        error instanceof Error
          ? error.message
          : "Could not create the survey.",
      );
    } finally {
      setSurveySaving(false);
    }
  }

  async function changeSurveyStatus(
    survey: TrustSurveyRun,
    action: "open" | "close",
  ) {
    try {
      await api(`/api/v1/trust-surveys/${survey.id}/${action}`, {
        method: "POST",
      });
      toast.success(
        action === "open" ? "Survey opened" : "Survey closed",
        survey.title,
      );
      trustSurveys.reload();
    } catch (error) {
      toast.error(
        action === "open" ? "Could not open survey" : "Could not close survey",
        error instanceof Error ? error.message : "The action failed.",
      );
    }
  }

  function openRespond(survey: TrustSurveyRun) {
    setRespondTarget(survey);
    setRespondentId(session.personId);
    setResponseScores(
      Object.fromEntries(survey.questions.map((question) => [question.code, ""])),
    );
    setResponseError(null);
  }

  async function submitSurveyResponse(event: FormEvent) {
    event.preventDefault();
    if (!respondTarget) return;
    setSurveySaving(true);
    setResponseError(null);
    try {
      const scores: Record<string, number> = {};
      for (const question of respondTarget.questions) {
        const value = Number(responseScores[question.code]);
        if (!Number.isFinite(value) || value < 1 || value > 5) {
          throw new Error(
            `Enter a score from 1 to 5 for ${question.prompt}`,
          );
        }
        scores[question.code] = value;
      }
      await api(`/api/v1/trust-surveys/${respondTarget.id}/responses`, {
        method: "POST",
        body: { personId: respondentId, scores },
      });
      toast.success(
        "Response recorded",
        "Only a pseudonymous hash is stored with the scores.",
      );
      setRespondTarget(null);
      trustSurveys.reload();
    } catch (error) {
      setResponseError(
        error instanceof Error
          ? error.message
          : "Could not record the response.",
      );
    } finally {
      setSurveySaving(false);
    }
  }

  function openConflictForm() {
    setConflictPerson(session.personId);
    setConflictRelated("");
    setConflictType("FAMILY");
    setConflictDescription("");
    setConflictError(null);
    setConflictOpen(true);
  }

  async function saveConflict(event: FormEvent) {
    event.preventDefault();
    setConflictSaving(true);
    setConflictError(null);
    try {
      await api("/api/v1/conflict-declarations", {
        method: "POST",
        body: {
          personId: conflictPerson,
          relatedPersonId: conflictRelated,
          relationshipType: conflictType.trim(),
          description: conflictDescription.trim(),
        },
      });
      toast.success(
        "Conflict declared",
        "Adjudication involving this pair is now blocked.",
      );
      setConflictOpen(false);
      conflicts.reload();
    } catch (error) {
      setConflictError(
        error instanceof Error
          ? error.message
          : "Could not declare the conflict.",
      );
    } finally {
      setConflictSaving(false);
    }
  }

  async function revokeConflict(event: FormEvent) {
    event.preventDefault();
    if (!revokeTarget) return;
    setConflictSaving(true);
    setConflictError(null);
    try {
      await api(
        `/api/v1/conflict-declarations/${revokeTarget.id}/revoke`,
        {
          method: "POST",
          body: { reason: revokeReason.trim() },
        },
      );
      toast.success("Conflict declaration revoked");
      setRevokeTarget(null);
      setRevokeReason("");
      conflicts.reload();
    } catch (error) {
      setConflictError(
        error instanceof Error
          ? error.message
          : "Could not revoke the declaration.",
      );
    } finally {
      setConflictSaving(false);
    }
  }

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
          <Link className="btn btn--secondary" to="/my-ai">
            <Icon name="ai" size={16} />
            <span>Open my AI record</span>
          </Link>
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

      <Panel
        title="Data-source registry"
        subtitle="Owner, response SLA and field-level classification for every incentive data source"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => {
              resetDataSourceForm();
              setSourceOpen(true);
            }}
          >
            Register source
          </Button>
        }
        flush
      >
        {dataMap.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={dataMap.error} onRetry={dataMap.reload} />
          </div>
        ) : dataMap.loading || !dataMap.data ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={4} />
          </div>
        ) : dataMap.data.sources.length === 0 ? (
          <EmptyState
            icon="database"
            title="No data source registered"
            description="Register each system that supplies evidence, its accountable owner and the fields it contributes."
          />
        ) : (
          <>
            <div className="coverage-grid" style={{ padding: 16 }}>
              <div className="coverage-cell">
                <div className="coverage-cell__label">Active sources</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.activeSources}
                </div>
                <div className="coverage-cell__sub">
                  {dataMap.data.summary.sources} registered
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">Personal-data sources</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.personalSources}
                </div>
                <div className="coverage-cell__sub">
                  {dataMap.data.summary.fields} mapped fields
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">Cross-border</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.crossBorderSources}
                </div>
                <div className="coverage-cell__sub">
                  {dataMap.data.summary.processors.length} processors
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">Overdue reviews</div>
                <div className="coverage-cell__value">
                  {dataMap.data.summary.overdueReviews}
                </div>
                <div className="coverage-cell__sub">
                  review cadence 90 days
                </div>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Owner</th>
                    <th className="cell-num">SLA</th>
                    <th>Criticality</th>
                    <th>Fields</th>
                    <th>Review</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dataMap.data.sources.map((source) => (
                    <tr key={source.id}>
                      <td>
                        <span className="cell-primary">{source.name}</span>
                        <span className="cell-sub mono">{source.code}</span>
                      </td>
                      <td className="mono">{shortId(source.ownerPersonId, 10)}</td>
                      <td className="cell-num">{source.slaHours}h</td>
                      <td>
                        <Badge
                          tone={
                            source.criticality === "CRITICAL"
                              ? "danger"
                              : source.criticality === "HIGH"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {titleCase(source.criticality)}
                        </Badge>
                      </td>
                      <td>
                        {source.fields.length}
                        {source.containsPersonalData ? (
                          <span className="cell-sub">personal data</span>
                        ) : null}
                      </td>
                      <td>
                        {source.reviewOverdue ? (
                          <Badge tone="danger">Overdue</Badge>
                        ) : (
                          <span className="nowrap">
                            {formatDate(source.reviewDueAt)}
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge status={source.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <Modal
        open={sourceOpen}
        title="Register data source"
        description="Accountable owner, response SLA and the minimum fields this source contributes."
        onClose={() => setSourceOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setSourceOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="data-source-form"
              icon="check"
              loading={sourceSaving}
            >
              Register source
            </Button>
          </>
        }
      >
        <form
          id="data-source-form"
          className="stack"
          onSubmit={saveDataSource}
        >
          <div className="form-grid">
            <FormField label="Code" htmlFor="source-code">
              <TextInput
                id="source-code"
                value={sourceCode}
                onChange={(event) => setSourceCode(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Name" htmlFor="source-name">
              <TextInput
                id="source-name"
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Category" htmlFor="source-category">
              <TextInput
                id="source-category"
                value={sourceCategory}
                onChange={(event) => setSourceCategory(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Owner" htmlFor="source-owner">
              <PersonSelect
                id="source-owner"
                value={sourceOwner}
                onChange={setSourceOwner}
              />
            </FormField>
            <FormField label="Response SLA (hours)" htmlFor="source-sla">
              <TextInput
                id="source-sla"
                type="number"
                min={1}
                max={8760}
                value={sourceSla}
                onChange={(event) => setSourceSla(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Criticality" htmlFor="source-criticality">
              <Select
                id="source-criticality"
                value={sourceCriticality}
                onChange={(event) =>
                  setSourceCriticality(
                    event.target.value as
                      | "LOW"
                      | "MEDIUM"
                      | "HIGH"
                      | "CRITICAL",
                  )
                }
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </Select>
            </FormField>
            <FormField label="Storage region" htmlFor="source-region">
              <TextInput
                id="source-region"
                value={sourceRegion}
                onChange={(event) => setSourceRegion(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Processors (comma separated)"
              htmlFor="source-processors"
            >
              <TextInput
                id="source-processors"
                value={sourceProcessors}
                onChange={(event) => setSourceProcessors(event.target.value)}
                placeholder="vendor-a, vendor-b"
              />
            </FormField>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={sourcePersonal}
              onChange={(event) => setSourcePersonal(event.target.checked)}
            />
            <span>This source contains personal data.</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={sourceCrossBorder}
              onChange={(event) => setSourceCrossBorder(event.target.checked)}
            />
            <span>Data is transferred outside mainland China.</span>
          </label>
          <div className="detail-section">
            <div className="detail-section__title">Field map</div>
            <div className="stack">
              {sourceFields.map((field, index) => (
                <div className="form-grid" key={index}>
                  <FormField label="Field" htmlFor={`source-field-${index}`}>
                    <TextInput
                      id={`source-field-${index}`}
                      value={field.fieldName}
                      onChange={(event) =>
                        setSourceFields((current) =>
                          current.map((candidate, fieldIndex) =>
                            fieldIndex === index
                              ? {
                                  ...candidate,
                                  fieldName: event.target.value,
                                }
                              : candidate,
                          ),
                        )
                      }
                      required
                    />
                  </FormField>
                  <FormField
                    label="Classification"
                    htmlFor={`source-class-${index}`}
                  >
                    <Select
                      id={`source-class-${index}`}
                      value={field.classification}
                      onChange={(event) =>
                        setSourceFields((current) =>
                          current.map((candidate, fieldIndex) =>
                            fieldIndex === index
                              ? {
                                  ...candidate,
                                  classification: event.target
                                    .value as DataClassification,
                                }
                              : candidate,
                          ),
                        )
                      }
                    >
                      <option value="PUBLIC">Public</option>
                      <option value="INTERNAL">Internal</option>
                      <option value="CONFIDENTIAL">Confidential</option>
                      <option value="PERSONAL">Personal</option>
                      <option value="SENSITIVE">Sensitive</option>
                    </Select>
                  </FormField>
                  <FormField
                    label="Purpose"
                    htmlFor={`source-purpose-${index}`}
                  >
                    <TextInput
                      id={`source-purpose-${index}`}
                      value={field.purpose}
                      onChange={(event) =>
                        setSourceFields((current) =>
                          current.map((candidate, fieldIndex) =>
                            fieldIndex === index
                              ? { ...candidate, purpose: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                      required
                    />
                  </FormField>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={sourceFields.length === 1}
                    onClick={() =>
                      setSourceFields((current) =>
                        current.filter((_, fieldIndex) => fieldIndex !== index),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              icon="plus"
              onClick={() =>
                setSourceFields((current) => [
                  ...current,
                  {
                    fieldName: "",
                    classification: "INTERNAL",
                    purpose: "",
                  },
                ])
              }
            >
              Add field
            </Button>
          </div>
          {sourcePersonal ? (
            <InfoNotice>
              At least one field must be classified PERSONAL or SENSITIVE when
              the source contains personal data.
            </InfoNotice>
          ) : null}
          {sourceError ? (
            <InfoNotice tone="warning">{sourceError}</InfoNotice>
          ) : null}
        </form>
      </Modal>

      <Panel
        title="Conflict declarations"
        subtitle="Active related-party declarations block adjudication between the pair"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openConflictForm}
          >
            Declare conflict
          </Button>
        }
        flush
      >
        {conflicts.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={conflicts.error} onRetry={conflicts.reload} />
          </div>
        ) : conflicts.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : (conflicts.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="people"
            title="No conflict declared"
            description="Declare close personal or financial relationships that should prevent one person adjudicating another's contribution."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>People</th>
                  <th>Relationship</th>
                  <th>Status</th>
                  <th>Declared</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {conflicts.data?.map((declaration) => (
                  <tr key={declaration.id}>
                    <td>
                      <span className="cell-primary mono">
                        {shortId(declaration.personId, 10)} ↔{" "}
                        {shortId(declaration.relatedPersonId, 10)}
                      </span>
                      <span className="cell-sub">
                        {declaration.description}
                      </span>
                    </td>
                    <td>{titleCase(declaration.relationshipType)}</td>
                    <td>
                      <Badge status={declaration.status} />
                    </td>
                    <td className="nowrap">
                      {formatDate(declaration.declaredAt)}
                    </td>
                    <td className="cell-actions">
                      {declaration.status === "ACTIVE" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRevokeTarget(declaration);
                            setRevokeReason("");
                            setConflictError(null);
                          }}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={conflictOpen}
        title="Declare conflict of interest"
        description="The pair cannot adjudicate each other's contribution while the declaration is active."
        onClose={() => setConflictOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConflictOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="conflict-form"
              loading={conflictSaving}
            >
              Declare
            </Button>
          </>
        }
      >
        <form id="conflict-form" className="stack" onSubmit={saveConflict}>
          {conflictError ? (
            <InfoNotice tone="warning">{conflictError}</InfoNotice>
          ) : null}
          <FormField label="Declaring person" htmlFor="conflict-person">
            <PersonSelect
              id="conflict-person"
              value={conflictPerson}
              onChange={setConflictPerson}
            />
          </FormField>
          <FormField label="Related person" htmlFor="conflict-related">
            <PersonSelect
              id="conflict-related"
              value={conflictRelated}
              onChange={setConflictRelated}
            />
          </FormField>
          <FormField label="Relationship" htmlFor="conflict-type">
            <TextInput
              id="conflict-type"
              value={conflictType}
              onChange={(event) => setConflictType(event.target.value)}
              placeholder="FAMILY, FINANCIAL, FORMER_MANAGER…"
              required
            />
          </FormField>
          <FormField label="Description" htmlFor="conflict-description">
            <TextInput
              id="conflict-description"
              value={conflictDescription}
              onChange={(event) =>
                setConflictDescription(event.target.value)
              }
              required
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(revokeTarget)}
        title="Revoke conflict declaration"
        onClose={() => setRevokeTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              type="submit"
              form="revoke-conflict-form"
              loading={conflictSaving}
            >
              Revoke
            </Button>
          </>
        }
      >
        <form
          id="revoke-conflict-form"
          className="stack"
          onSubmit={revokeConflict}
        >
          {conflictError ? (
            <InfoNotice tone="warning">{conflictError}</InfoNotice>
          ) : null}
          <FormField label="Revocation reason" htmlFor="revoke-reason">
            <TextInput
              id="revoke-reason"
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              required
            />
          </FormField>
        </form>
      </Modal>

      <Panel
        title="Trust surveys"
        subtitle="Anonymous quarterly pulse on fairness, voice and confidence in the process"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openSurveyForm}
          >
            Create survey
          </Button>
        }
        flush
      >
        {trustSurveys.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice
              error={trustSurveys.error}
              onRetry={trustSurveys.reload}
            />
          </div>
        ) : trustSurveys.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : (trustSurveys.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="people"
            title="No trust survey"
            description="Create a survey, open it for responses, then close it to compare the dimension averages with the prior period."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Survey</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th className="cell-num">Questions</th>
                  <th>Window</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trustSurveys.data?.map((survey) => (
                  <tr key={survey.id}>
                    <td>
                      <span className="cell-primary">{survey.title}</span>
                      <span className="cell-sub mono">{survey.code}</span>
                    </td>
                    <td>{survey.period}</td>
                    <td>
                      <Badge status={survey.status} />
                    </td>
                    <td className="cell-num">{survey.questions.length}</td>
                    <td className="nowrap">
                      {survey.openedAt
                        ? formatDate(survey.openedAt)
                        : "Not opened"}
                      {survey.closedAt
                        ? ` – ${formatDate(survey.closedAt)}`
                        : ""}
                    </td>
                    <td className="cell-actions">
                      <div className="row-actions">
                        {survey.status === "DRAFT" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void changeSurveyStatus(survey, "open")}
                          >
                            Open
                          </Button>
                        ) : null}
                        {survey.status === "OPEN" ? (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => openRespond(survey)}
                            >
                              Respond
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void changeSurveyStatus(survey, "close")
                              }
                            >
                              Close
                            </Button>
                          </>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setReportTarget(survey)}
                        >
                          Report
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={surveyOpen}
        title="Create trust survey"
        description="Questions are scored 1–5. Responses store only a pseudonymous hash and the score set."
        onClose={() => setSurveyOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setSurveyOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="survey-form"
              loading={surveySaving}
            >
              Create survey
            </Button>
          </>
        }
      >
        <form id="survey-form" className="stack" onSubmit={saveSurvey}>
          {surveyError ? (
            <InfoNotice tone="warning">{surveyError}</InfoNotice>
          ) : null}
          <div className="form-grid">
            <FormField label="Code" htmlFor="survey-code">
              <TextInput
                id="survey-code"
                value={surveyCode}
                onChange={(event) => setSurveyCode(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Period" htmlFor="survey-period">
              <TextInput
                id="survey-period"
                value={surveyPeriod}
                onChange={(event) => setSurveyPeriod(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Title"
              htmlFor="survey-title"
              className="field--full"
            >
              <TextInput
                id="survey-title"
                value={surveyTitle}
                onChange={(event) => setSurveyTitle(event.target.value)}
                required
              />
            </FormField>
          </div>
          <div className="detail-section">
            <div className="detail-section__title">Questions</div>
            <div className="stack">
              {surveyQuestions.map((question, index) => (
                <div className="form-grid" key={index}>
                  <FormField
                    label="Code"
                    htmlFor={`survey-question-code-${index}`}
                  >
                    <TextInput
                      id={`survey-question-code-${index}`}
                      value={question.code}
                      onChange={(event) =>
                        setSurveyQuestions((current) =>
                          current.map((candidate, position) =>
                            position === index
                              ? { ...candidate, code: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                      required
                    />
                  </FormField>
                  <FormField
                    label="Prompt"
                    htmlFor={`survey-question-prompt-${index}`}
                  >
                    <TextInput
                      id={`survey-question-prompt-${index}`}
                      value={question.prompt}
                      onChange={(event) =>
                        setSurveyQuestions((current) =>
                          current.map((candidate, position) =>
                            position === index
                              ? {
                                  ...candidate,
                                  prompt: event.target.value,
                                }
                              : candidate,
                          ),
                        )
                      }
                      required
                    />
                  </FormField>
                  <FormField
                    label="Dimension"
                    htmlFor={`survey-question-dimension-${index}`}
                  >
                    <TextInput
                      id={`survey-question-dimension-${index}`}
                      value={question.dimension}
                      onChange={(event) =>
                        setSurveyQuestions((current) =>
                          current.map((candidate, position) =>
                            position === index
                              ? {
                                  ...candidate,
                                  dimension: event.target.value,
                                }
                              : candidate,
                          ),
                        )
                      }
                      required
                    />
                  </FormField>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={surveyQuestions.length === 1}
                    onClick={() =>
                      setSurveyQuestions((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              icon="plus"
              onClick={() =>
                setSurveyQuestions((current) => [
                  ...current,
                  { code: "", prompt: "", dimension: "" },
                ])
              }
            >
              Add question
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(respondTarget)}
        title="Respond to trust survey"
        onClose={() => setRespondTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRespondTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="survey-response-form"
              loading={surveySaving}
            >
              Submit response
            </Button>
          </>
        }
      >
        {respondTarget ? (
          <form
            id="survey-response-form"
            className="stack"
            onSubmit={submitSurveyResponse}
          >
            {responseError ? (
              <InfoNotice tone="warning">{responseError}</InfoNotice>
            ) : null}
            <DefinitionList
              items={[
                { label: "Survey", value: respondTarget.title },
                { label: "Period", value: respondTarget.period },
                {
                  label: "Anonymity",
                  value: "Only a pseudonymous hash is stored with scores.",
                },
              ]}
            />
            <FormField label="Respondent" htmlFor="survey-respondent">
              <PersonSelect
                id="survey-respondent"
                value={respondentId}
                onChange={setRespondentId}
              />
            </FormField>
            <div className="form-grid">
              {respondTarget.questions.map((question) => (
                <FormField
                  key={question.code}
                  label={question.prompt}
                  htmlFor={`survey-score-${question.code}`}
                  hint="1 = strongly disagree · 5 = strongly agree"
                >
                  <TextInput
                    id={`survey-score-${question.code}`}
                    type="number"
                    min={1}
                    max={5}
                    step={1}
                    value={responseScores[question.code] ?? ""}
                    onChange={(event) =>
                      setResponseScores((current) => ({
                        ...current,
                        [question.code]: event.target.value,
                      }))
                    }
                    required
                  />
                </FormField>
              ))}
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(reportTarget)}
        title={reportTarget ? `${reportTarget.title} · report` : "Survey report"}
        onClose={() => setReportTarget(null)}
        wide
      >
        {report.error ? (
          <ErrorNotice error={report.error} onRetry={report.reload} />
        ) : report.loading || !report.data ? (
          <LoadingRows rows={4} />
        ) : (
          <div className="stack">
            <DefinitionList
              items={[
                { label: "Period", value: report.data.survey.period },
                {
                  label: "Responses",
                  value: report.data.responseCount,
                },
                {
                  label: "Status",
                  value: <Badge status={report.data.survey.status} />,
                },
              ]}
            />
            <div className="detail-section">
              <div className="detail-section__title">Dimension averages</div>
              <div className="stack" style={{ gap: 6 }}>
                {Object.entries(report.data.dimensions).map(
                  ([dimension, score]) => {
                    const baseline =
                      report.data?.baseline?.dimensions[dimension];
                    return (
                      <div
                        key={dimension}
                        className="inline"
                        style={{ justifyContent: "space-between", width: "100%" }}
                      >
                        <span>{titleCase(dimension)}</span>
                        <span className="muted">
                          {score.toFixed(2)} / 5
                          {baseline !== undefined
                            ? ` · baseline ${baseline.toFixed(2)}`
                            : " · no baseline"}
                        </span>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
            <div className="detail-section">
              <div className="detail-section__title">Question averages</div>
              <div className="stack" style={{ gap: 6 }}>
                {report.data.survey.questions.map((question) => (
                  <div
                    key={question.code}
                    className="inline"
                    style={{ justifyContent: "space-between", width: "100%" }}
                  >
                    <span>{question.prompt}</span>
                    <span className="muted">
                      {report.data?.averages[question.code]?.toFixed(2) ?? "—"} /
                      5
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <InfoNotice>
              Result aggregation suppresses individual responses. Baseline
              compares the most recent closed survey with the same code.
            </InfoNotice>
          </div>
        )}
      </Modal>

      <Panel
        title="No-retaliation commitment"
        subtitle="Published fairness statement; publishing a new version supersedes the prior one"
        className="section-gap"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={openCommitmentForm}
          >
            Publish commitment
          </Button>
        }
        flush
      >
        {commitments.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={commitments.error} onRetry={commitments.reload} />
          </div>
        ) : commitments.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (commitments.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="shield"
            title="No fairness commitment"
            description="Publish a statement that good-faith concerns can be raised without retaliation."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Statement</th>
                  <th>Channels</th>
                  <th>Status</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {commitments.data?.map((commitment) => (
                  <tr key={commitment.id}>
                    <td className="mono">v{commitment.version}</td>
                    <td>
                      <span className="cell-primary">{commitment.statement}</span>
                      <span className="cell-sub mono">
                        {shortId(commitment.ownerPersonId, 10)}
                      </span>
                    </td>
                    <td>{commitment.channels.join(", ") || "—"}</td>
                    <td>
                      <Badge status={commitment.status} />
                    </td>
                    <td className="nowrap">
                      {formatDate(commitment.publishedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={commitmentOpen}
        title="Publish fairness commitment"
        description="Employees should be able to see this statement and the appeal statistics that accompany it."
        onClose={() => setCommitmentOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCommitmentOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="commitment-form"
              loading={commitmentSaving}
            >
              Publish
            </Button>
          </>
        }
      >
        <form id="commitment-form" className="stack" onSubmit={publishCommitment}>
          {commitmentError ? (
            <InfoNotice tone="warning">{commitmentError}</InfoNotice>
          ) : null}
          <FormField label="Statement" htmlFor="commitment-statement">
            <Textarea
              id="commitment-statement"
              value={commitmentStatement}
              onChange={(event) => setCommitmentStatement(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Owner" htmlFor="commitment-owner">
            <PersonSelect
              id="commitment-owner"
              value={commitmentOwner}
              onChange={setCommitmentOwner}
            />
          </FormField>
          <FormField
            label="Publication channels (comma separated)"
            htmlFor="commitment-channels"
          >
            <TextInput
              id="commitment-channels"
              value={commitmentChannels}
              onChange={(event) => setCommitmentChannels(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>

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
