import { useEffect, useState } from "react";
import {
  Badge,
  Button,
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
import { useToast } from "../contexts/ToastContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { ApiError, api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import type { WorkforceSubgroupAttributeView } from "../lib/ops-types.js";

interface PolicyObject {
  allowRoles?: string[];
  allowSelf?: boolean;
  onDeny?: "OMIT" | "ZERO" | "REDACT";
  match?: Record<string, boolean>;
}
type PolicyValue = string[] | PolicyObject;

interface MatrixResponse {
  defaults: Record<string, PolicyValue>;
  configured: Record<string, PolicyValue>;
  effective: Record<string, PolicyValue>;
}

const RESOURCES = [
  "PAYROLL_LINE",
  "CALCULATION_LINE",
  "EMPLOYMENT_CONTRACT",
  "EVIDENCE",
  "SETTLEMENT_LINE",
  "AI_PROPOSAL",
];

const PREDICATES = [
  "isSubjectManager",
  "sameOrgNode",
  "sameLegalEntity",
  "legalHoldActive",
  "subjectEmploymentActive",
  "viewerEmploymentActive",
];

const DENY_MODES: Array<"" | "OMIT" | "ZERO" | "REDACT"> = [
  "",
  "OMIT",
  "ZERO",
  "REDACT",
];

interface Row {
  key: string;
  roles: string;
  allowSelf: boolean;
  onDeny: "" | "OMIT" | "ZERO" | "REDACT";
  match: Record<string, boolean>;
  overridden: boolean;
}

function normalize(value: PolicyValue | undefined): {
  roles: string;
  allowSelf: boolean;
  onDeny: "" | "OMIT" | "ZERO" | "REDACT";
  match: Record<string, boolean>;
} {
  if (Array.isArray(value)) {
    return { roles: value.join(", "), allowSelf: true, onDeny: "", match: {} };
  }
  return {
    roles: (value?.allowRoles ?? []).join(", "),
    allowSelf: value?.allowSelf ?? true,
    onDeny: value?.onDeny ?? "",
    match: { ...(value?.match ?? {}) },
  };
}

export function FieldAccessPage() {
  useDocumentTitle("Field access");
  const toast = useToast();
  const matrix = useApiQuery<MatrixResponse>("/api/v1/field-access-policies");
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newResource, setNewResource] = useState(RESOURCES[0] as string);
  const [newField, setNewField] = useState("");
  const { session } = useAuth();
  const attributes = useApiQuery<WorkforceSubgroupAttributeView[]>(
    "/api/v1/workforce-subgroup-attributes",
  );
  const [attributeOpen, setAttributeOpen] = useState(false);
  const [attributePersonId, setAttributePersonId] = useState("");
  const [attributeDimension, setAttributeDimension] = useState("GENDER");
  const [attributeValue, setAttributeValue] = useState("");
  const [attributeConsentRef, setAttributeConsentRef] = useState("");
  const [attributeConsentedAt, setAttributeConsentedAt] = useState("");
  const [attributeExpiresAt, setAttributeExpiresAt] = useState("");
  const [attributeError, setAttributeError] = useState<string | null>(null);
  const [withdrawTarget, setWithdrawTarget] =
    useState<WorkforceSubgroupAttributeView | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  useEffect(() => {
    const data = matrix.data;
    if (!data) return;
    setRows(
      Object.entries(data.effective)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => ({
          key,
          ...normalize(value),
          overridden: key in data.configured,
        })),
    );
  }, [matrix.data]);

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row) =>
        row.key === key ? { ...row, ...patch, overridden: true } : row,
      ),
    );
  }

  function resetRow(key: string) {
    if (!matrix.data) return;
    const base = matrix.data.defaults[key];
    if (!base) {
      setRows((current) => current.filter((row) => row.key !== key));
      return;
    }
    setRows((current) =>
      current.map((row) =>
        row.key === key
          ? { ...row, ...normalize(base), overridden: false }
          : row,
      ),
    );
  }

  function addRow() {
    const key = `${newResource}.${newField.trim()}`;
    if (!newField.trim() || rows.some((row) => row.key === key)) {
      setError("Enter a unique field name for the resource.");
      return;
    }
    setRows((current) => [
      ...current,
      {
        key,
        roles: "finance, admin",
        allowSelf: true,
        onDeny: "",
        match: {},
        overridden: true,
      },
    ]);
    setNewField("");
    setError(null);
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const policies: Record<string, PolicyValue> = {};
      for (const row of rows) {
        if (!row.overridden) continue;
        const match = Object.fromEntries(
          Object.entries(row.match).filter(([, expected]) => expected),
        );
        policies[row.key] = {
          ...(row.roles.trim()
            ? {
                allowRoles: row.roles
                  .split(",")
                  .map((role) => role.trim())
                  .filter(Boolean),
              }
            : {}),
          allowSelf: row.allowSelf,
          ...(row.onDeny ? { onDeny: row.onDeny } : {}),
          ...(Object.keys(match).length > 0 ? { match } : {}),
        };
      }
      await api("/api/v1/field-access-policies", {
        method: "PUT",
        body: { policies },
      });
      toast.success(
        "Field matrix saved",
        `${Object.keys(policies).length} override(s)`,
      );
      matrix.reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not save the matrix",
      );
    } finally {
      setSaving(false);
    }
  }

  function openAttribute() {
    setAttributePersonId("");
    setAttributeDimension("GENDER");
    setAttributeValue("");
    setAttributeConsentRef("");
    setAttributeConsentedAt(new Date().toISOString().slice(0, 10));
    setAttributeExpiresAt("");
    setAttributeError(null);
    setAttributeOpen(true);
  }

  async function recordAttribute() {
    setAttributeError(null);
    try {
      await api("/api/v1/workforce-subgroup-attributes", {
        method: "POST",
        body: {
          personId: attributePersonId.trim(),
          dimension: attributeDimension,
          value: attributeValue.trim(),
          consentRef: attributeConsentRef.trim(),
          consentedAt: new Date(attributeConsentedAt).toISOString(),
          expiresAt: attributeExpiresAt
            ? new Date(attributeExpiresAt).toISOString()
            : undefined,
          recordedBy: session.personId,
        },
      });
      toast.success("Subgroup label recorded", attributeDimension);
      setAttributeOpen(false);
      attributes.reload();
    } catch (caught) {
      setAttributeError(
        caught instanceof ApiError ? caught.message : "Could not record label",
      );
    }
  }

  async function withdrawAttribute() {
    if (!withdrawTarget) return;
    setWithdrawError(null);
    try {
      await api("/api/v1/workforce-subgroup-attributes/withdraw", {
        method: "POST",
        body: {
          personId: withdrawTarget.personId,
          dimension: withdrawTarget.dimension,
          actorPersonId: session.personId,
          reason: withdrawReason.trim(),
        },
      });
      toast.success("Subgroup label withdrawn", withdrawTarget.dimension);
      setWithdrawTarget(null);
      attributes.reload();
    } catch (caught) {
      setWithdrawError(
        caught instanceof ApiError ? caught.message : "Could not withdraw label",
      );
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Security posture"
        title="Field access"
        description="Per-field role allow-lists with optional server-side predicates. Conditions only narrow access; admin and self access stay unconditional. Unknown predicates are rejected."
        actions={
          <Button variant="primary" onClick={save} loading={saving}>
            Save overrides
          </Button>
        }
      />

      {error ? <InfoNotice tone="warning">{error}</InfoNotice> : null}

      <Panel
        title="Effective matrix"
        subtitle="Edit a row to create a tenant override; reset to fall back to the system default"
        flush
      >
        {matrix.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={matrix.error} onRetry={matrix.reload} />
          </div>
        ) : matrix.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={5} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="shield"
            title="No field policy"
            description="Add a resource field below to start protecting it."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Allowed roles</th>
                  <th>Self</th>
                  <th>On deny</th>
                  <th>Predicates</th>
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <span className="cell-primary mono">{row.key}</span>
                    </td>
                    <td>
                      <TextInput
                        value={row.roles}
                        onChange={(event) =>
                          updateRow(row.key, { roles: event.target.value })
                        }
                        placeholder="finance, admin"
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.allowSelf}
                        onChange={(event) =>
                          updateRow(row.key, {
                            allowSelf: event.target.checked,
                          })
                        }
                      />
                    </td>
                    <td>
                      <Select
                        value={row.onDeny}
                        onChange={(event) =>
                          updateRow(row.key, {
                            onDeny: event.target.value as Row["onDeny"],
                          })
                        }
                      >
                        {DENY_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode || "infer"}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      <div className="chip-row">
                        {PREDICATES.map((predicate) => (
                          <label key={predicate} className="chip">
                            <input
                              type="checkbox"
                              checked={row.match[predicate] === true}
                              onChange={(event) =>
                                updateRow(row.key, {
                                  match: {
                                    ...row.match,
                                    [predicate]: event.target.checked,
                                  },
                                })
                              }
                            />{" "}
                            {predicate}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Badge tone={row.overridden ? "warning" : "neutral"}>
                        {row.overridden ? "Override" : "Default"}
                      </Badge>
                    </td>
                    <td className="cell-actions">
                      {row.overridden ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => resetRow(row.key)}
                        >
                          Reset
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

      <Panel title="Add protected field" subtitle="Resource.field must match an enforced resource">
        <div className="form-grid">
          <FormField label="Resource" htmlFor="new-resource">
            <Select
              id="new-resource"
              value={newResource}
              onChange={(event) => setNewResource(event.target.value)}
            >
              {RESOURCES.map((resource) => (
                <option key={resource} value={resource}>
                  {resource}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Field" htmlFor="new-field">
            <TextInput
              id="new-field"
              value={newField}
              onChange={(event) => setNewField(event.target.value)}
              placeholder="bankAccountRef"
            />
          </FormField>
          <div className="inline" style={{ alignItems: "end" }}>
            <Button variant="secondary" icon="plus" onClick={addRow}>
              Add row
            </Button>
          </div>
        </div>
      </Panel>

      <Panel
        title="Consent-backed subgroup labels"
        subtitle="Optional, separately consented labels used only for aggregate fairness review; never for individual decisions"
        flush
        action={
          <Button
            size="sm"
            variant="primary"
            icon="plus"
            onClick={openAttribute}
          >
            Record label
          </Button>
        }
      >
        {attributes.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={attributes.error} onRetry={attributes.reload} />
          </div>
        ) : attributes.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={2} />
          </div>
        ) : (attributes.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="shield"
            title="No subgroup label"
            description="Labels require a separate consent reference and can be withdrawn at any time."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Dimension</th>
                  <th>Value</th>
                  <th>Consent</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(attributes.data ?? []).map((attribute) => (
                  <tr key={attribute.id}>
                    <td className="mono">{attribute.personId.slice(0, 10)}</td>
                    <td>{attribute.dimension}</td>
                    <td>{attribute.value}</td>
                    <td className="mono">{attribute.consentRef}</td>
                    <td className="nowrap">{attribute.expiresAt ?? "—"}</td>
                    <td className="cell-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setWithdrawTarget(attribute);
                          setWithdrawReason("");
                          setWithdrawError(null);
                        }}
                      >
                        Withdraw
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={attributeOpen}
        title="Record subgroup label"
        description="Requires separate consent; the label is pseudonymous and used only in suppressed aggregates."
        onClose={() => setAttributeOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAttributeOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={recordAttribute}>
              Record label
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {attributeError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{attributeError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="Person id" htmlFor="attribute-person">
            <TextInput
              id="attribute-person"
              value={attributePersonId}
              onChange={(event) => setAttributePersonId(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Dimension" htmlFor="attribute-dimension">
            <Select
              id="attribute-dimension"
              value={attributeDimension}
              onChange={(event) => setAttributeDimension(event.target.value)}
            >
              {[
                "GENDER",
                "AGE_BAND",
                "REGION",
                "TENURE_BAND",
                "EMPLOYMENT_TYPE",
              ].map((dimension) => (
                <option key={dimension} value={dimension}>
                  {dimension}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Value" htmlFor="attribute-value">
            <TextInput
              id="attribute-value"
              value={attributeValue}
              onChange={(event) => setAttributeValue(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Consent reference" htmlFor="attribute-consent">
            <TextInput
              id="attribute-consent"
              value={attributeConsentRef}
              onChange={(event) => setAttributeConsentRef(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Consented at" htmlFor="attribute-consented">
            <TextInput
              id="attribute-consented"
              type="date"
              value={attributeConsentedAt}
              onChange={(event) => setAttributeConsentedAt(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Expires at (optional)" htmlFor="attribute-expires">
            <TextInput
              id="attribute-expires"
              type="date"
              value={attributeExpiresAt}
              onChange={(event) => setAttributeExpiresAt(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={Boolean(withdrawTarget)}
        title="Withdraw subgroup label"
        description="Withdrawal deletes the label; aggregates fall back to unavailable."
        onClose={() => setWithdrawTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={withdrawAttribute}>
              Withdraw
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {withdrawError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{withdrawError}</InfoNotice>
            </div>
          ) : null}
          <FormField
            label="Reason"
            htmlFor="attribute-withdraw-reason"
            className="field--full"
          >
            <Textarea
              id="attribute-withdraw-reason"
              value={withdrawReason}
              onChange={(event) => setWithdrawReason(event.target.value)}
              required
            />
          </FormField>
        </div>
      </Modal>
    </>
  );
}
