import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  FormField,
  InfoNotice,
  LoadingRows,
  PageHeader,
  Panel,
  Select,
  TextInput,
} from "../components/ui.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";

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
    </>
  );
}
