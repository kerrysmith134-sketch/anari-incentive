export type DenialMode = "OMIT" | "ZERO" | "REDACT";

export interface PolicyObject {
  allowRoles?: string[];
  allowSelf?: boolean;
  onDeny?: DenialMode;
  match?: Record<string, boolean>;
}

export type PolicyValue = string[] | PolicyObject;

export interface PolicyEditorRow {
  key: string;
  roles: string;
  allowSelf: boolean;
  onDeny: "" | DenialMode;
  match: Record<string, boolean>;
  overridden: boolean;
}

export interface NormalizedPolicy {
  roles: string;
  allowSelf: boolean;
  onDeny: "" | DenialMode;
  match: Record<string, boolean>;
}

/** Accept both the legacy role array and the object form from the API. */
export function normalizePolicyValue(value: PolicyValue | undefined): NormalizedPolicy {
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

/**
 * Build the PUT payload from editor rows. Only overridden rows are sent;
 * predicates set to false are omitted so the server evaluates no condition.
 */
export function buildConfiguredPolicies(
  rows: readonly PolicyEditorRow[],
): Record<string, PolicyValue> {
  const policies: Record<string, PolicyValue> = {};
  for (const row of rows) {
    if (!row.overridden) continue;
    const roles = row.roles
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean);
    const match = Object.fromEntries(
      Object.entries(row.match).filter(([, expected]) => expected),
    );
    policies[row.key] = {
      ...(roles.length > 0 ? { allowRoles: roles } : {}),
      allowSelf: row.allowSelf,
      ...(row.onDeny ? { onDeny: row.onDeny } : {}),
      ...(Object.keys(match).length > 0 ? { match } : {}),
    };
  }
  return policies;
}

/** Validate a `RESOURCE.field` key before adding a custom row. */
export function isValidPolicyKey(key: string): boolean {
  return /^[A-Z_][A-Z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/.test(key);
}
