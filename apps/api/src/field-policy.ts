/**
 * 字段级访问控制与脱敏（从 app.ts 拆分，行为不变）。
 */
import type { FieldAccessMatch, FieldAccessPolicy } from "@anari/contracts";
import type {
  AuditEvent,
  AuditRedaction,
  CalculationRun,
  PayrollLine,
  PayrollRun,
  SettlementBatch,
} from "@anari/domain";
import {
  DEFAULT_FIELD_ACCESS_POLICIES,
  DEFAULT_PAYROLL_FIELD_POLICIES,
} from "./field-access-defaults.js";

export function redactContractAmendmentTerms<
  T extends {
    beforeTerms: Record<string, unknown>;
    afterTerms: Record<string, unknown>;
  },
>(
  amendment: T,
  viewer: {
    personId?: string;
    recordPersonId?: string;
    roles: string[];
    policies?: Record<string, FieldAccessPolicy>;
    matchContext?: FieldAccessMatchContext;
  },
): T & { redactedFields?: string[] } {
  const before = redactResourceFields(
    amendment.beforeTerms,
    "EMPLOYMENT_CONTRACT",
    viewer,
  );
  const after = redactResourceFields(
    amendment.afterTerms,
    "EMPLOYMENT_CONTRACT",
    viewer,
  );
  const redactedFields = [
    ...new Set([...(before.redactedFields ?? []), ...(after.redactedFields ?? [])]),
  ];
  if (redactedFields.length === 0) return amendment;
  return {
    ...amendment,
    beforeTerms: before,
    afterTerms: after,
    redactedFields,
  };
}

/** Employee view of a run: own lines only, no pool trace or order economics. */

/**
 * Employees may only see their own rows and must carry a person identity.
 * Privileged roles see the tenant and get no filter.
 */
/** Recalculation targets must exist before a request can be recorded. */
/** Apply tenant redaction overlays without changing the hash-chained event. */
export function applyAuditRedactions(
  events: AuditEvent[],
  redactions: AuditRedaction[],
): AuditEvent[] {
  const byEvent = new Map(
    redactions.map((redaction) => [redaction.auditEventId, redaction]),
  );
  return events.map((event) => {
    const redaction = byEvent.get(event.id);
    if (!redaction) return event;
    return {
      ...event,
      reason: redaction.replacement,
      redacted: true,
      redactionId: redaction.id,
    };
  });
}

export const RETENTION_CATEGORIES_BY_RESOURCE: Record<string, string[]> = {
  EMPLOYMENT_CONTRACT: ["LABOR_CONTRACTS"],
  PAYROLL_LINE: ["PAYROLL_RECORDS"],
  CALCULATION_LINE: ["ACCOUNTING_RECORDS"],
  SETTLEMENT_LINE: ["ACCOUNTING_RECORDS"],
  EVIDENCE: ["AI_EVALUATION_EVIDENCE"],
  AI_PROPOSAL: ["AI_EVALUATION_EVIDENCE"],
};

interface NormalizedFieldPolicy {
  roles: string[];
  allowSelf: boolean;
  onDeny?: DenialMode;
  match?: FieldAccessMatch;
}

const DECIMAL_STRING_PATTERN = /^-?\d+(\.\d+)?$/;


type DenialMode = "OMIT" | "ZERO" | "REDACT";

export interface FieldAccessMatchContext {
  viewerPersonId?: string;
  managerByPerson: Map<string, string | undefined>;
  activePersons: Set<string>;
  orgNodesByPerson: Map<string, Set<string>>;
  legalEntityByPerson: Map<string, string | undefined>;
  /** Retention categories currently under legal hold. */
  heldCategories: Set<string>;
}

interface NormalizedFieldPolicy {
  roles: string[];
  allowSelf: boolean;
  onDeny?: DenialMode;
  match?: FieldAccessMatch;
}

/** Accept both the legacy role array and the object form from ADR-009. */
export function normalizeFieldPolicy(
  value: unknown,
): NormalizedFieldPolicy | undefined {
  if (Array.isArray(value)) {
    return {
      roles: value.filter((role): role is string => typeof role === "string"),
      allowSelf: true,
    };
  }
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as {
    allowRoles?: unknown;
    allowSelf?: unknown;
    onDeny?: unknown;
    match?: unknown;
  };
  const roles = Array.isArray(candidate.allowRoles)
    ? candidate.allowRoles.filter(
        (role): role is string => typeof role === "string",
      )
    : [];
  const allowSelf =
    typeof candidate.allowSelf === "boolean" ? candidate.allowSelf : true;
  const onDeny =
    candidate.onDeny === "OMIT" ||
    candidate.onDeny === "ZERO" ||
    candidate.onDeny === "REDACT"
      ? candidate.onDeny
      : undefined;
  const match =
    candidate.match && typeof candidate.match === "object"
      ? (candidate.match as FieldAccessMatch)
      : undefined;
  if (roles.length === 0 && candidate.allowSelf === undefined) {
    return undefined;
  }
  return { roles, allowSelf, onDeny, match };
}

export function fieldPolicyAllows(
  policy: NormalizedFieldPolicy,
  roles: string[],
  isSelf: boolean,
): boolean {
  if (roles.includes("admin")) return true;
  if (isSelf && policy.allowSelf) return true;
  return policy.roles.some((role) => roles.includes(role));
}

/**
 * Admin and self-access are unconditional grants; predicates only narrow the
 * role-based path. This keeps a manager's own record visible under a
 * subject-manager policy.
 */
export function fieldPolicyAllowsWithMatch(
  policy: NormalizedFieldPolicy,
  roles: string[],
  isSelf: boolean,
  context: FieldAccessMatchContext | undefined,
  subjectPersonId: string | undefined,
  resourceName: string,
): boolean {
  if (roles.includes("admin")) return true;
  if (isSelf && policy.allowSelf) return true;
  if (!policy.roles.some((role) => roles.includes(role))) return false;
  return fieldPolicyMatches(policy, context, subjectPersonId, resourceName);
}

function evaluateFieldPredicate(
  predicate: keyof FieldAccessMatch,
  context: FieldAccessMatchContext,
  subjectPersonId?: string,
  resourceName?: string,
): boolean {
  switch (predicate) {
    case "viewerEmploymentActive":
      return Boolean(
        context.viewerPersonId &&
          context.activePersons.has(context.viewerPersonId),
      );
    case "subjectEmploymentActive":
      return Boolean(
        subjectPersonId && context.activePersons.has(subjectPersonId),
      );
    case "legalHoldActive": {
      const categories = resourceName
        ? (RETENTION_CATEGORIES_BY_RESOURCE[resourceName] ?? [])
        : [];
      return categories.some((category) =>
        context.heldCategories.has(category),
      );
    }
    case "isSubjectManager":
      return Boolean(
        subjectPersonId &&
          context.viewerPersonId &&
          context.managerByPerson.get(subjectPersonId) ===
            context.viewerPersonId,
      );
    case "sameOrgNode": {
      if (!subjectPersonId || !context.viewerPersonId) return false;
      const viewerNodes = context.orgNodesByPerson.get(
        context.viewerPersonId,
      );
      const subjectNodes = context.orgNodesByPerson.get(subjectPersonId);
      if (!viewerNodes?.size || !subjectNodes?.size) return false;
      return [...viewerNodes].some((node) => subjectNodes.has(node));
    }
    case "sameLegalEntity": {
      if (!subjectPersonId || !context.viewerPersonId) return false;
      const viewerEntity = context.legalEntityByPerson.get(
        context.viewerPersonId,
      );
      const subjectEntity = context.legalEntityByPerson.get(subjectPersonId);
      return Boolean(
        viewerEntity && subjectEntity && viewerEntity === subjectEntity,
      );
    }
    default:
      return false;
  }
}

/**
 * Which server-derived predicates the effective matrix actually uses. The
 * context loader fetches only these sources instead of every tenant snapshot.
 */
export function requiredMatchPredicates(
  policies: Record<string, FieldAccessPolicy>,
): string[] {
  const predicates = new Set<string>();
  for (const value of Object.values(policies)) {
    const policy = normalizeFieldPolicy(value);
    if (!policy?.match) continue;
    for (const predicate of Object.keys(policy.match)) {
      predicates.add(predicate);
    }
  }
  return [...predicates].sort();
}

/**
 * Predicates only narrow access: a policy that matches roles still redacts
 * when a configured predicate is false. Without the server-derived context we
 * fail closed rather than returning the field.
 */
export function fieldPolicyMatches(
  policy: NormalizedFieldPolicy,
  context: FieldAccessMatchContext | undefined,
  subjectPersonId?: string,
  resourceName?: string,
): boolean {
  if (!policy.match) return true;
  if (!context) return false;
  for (const [predicate, expected] of Object.entries(policy.match)) {
    const actual = evaluateFieldPredicate(
      predicate as keyof FieldAccessMatch,
      context,
      subjectPersonId,
      resourceName,
    );
    if (actual !== expected) return false;
  }
  return true;
}

export function deniedFieldValue(
  field: string,
  current: unknown,
  onDeny?: DenialMode,
): unknown {
  if (onDeny === "OMIT") return undefined;
  if (onDeny === "ZERO") return "0";
  if (onDeny === "REDACT") return "[REDACTED]";
  // Legacy inference keeps existing array policies behaving as before.
  if (/Ref$/.test(field)) return undefined;
  if (typeof current === "string" && DECIMAL_STRING_PATTERN.test(current)) {
    return "0";
  }
  return "[REDACTED]";
}

/**
 * Apply the tenant field-access matrix to a single flat resource. This is the
 * generic path used by resources added after payroll and calculation lines;
 * identifier fields are removed, decimal strings are zeroed and other values
 * are replaced with a marker so no sensitive content leaks through.
 */
export function redactResourceFields<T extends object>(
  resource: T,
  resourceName: string,
  viewer: {
    personId?: string;
    recordPersonId?: string;
    roles: string[];
    policies?: Record<string, FieldAccessPolicy>;
    matchContext?: FieldAccessMatchContext;
    subjectPersonId?: string;
  },
): T & { redactedFields?: string[] } {
  const isSelf = Boolean(
    viewer.personId && viewer.personId === viewer.recordPersonId,
  );
  const policies = {
    ...DEFAULT_FIELD_ACCESS_POLICIES,
    ...(viewer.policies ?? {}),
  };
  const redacted: string[] = [];
  const next: Record<string, unknown> = {
    ...(resource as Record<string, unknown>),
  };
  for (const [key, rawPolicy] of Object.entries(policies)) {
    const policy = normalizeFieldPolicy(rawPolicy);
    if (!policy) continue;
    const [resourceKey, field] = key.split(".");
    if (resourceKey !== resourceName || !field || !(field in next)) continue;
    const subjectPersonId = viewer.subjectPersonId ?? viewer.recordPersonId;
    if (
      fieldPolicyAllowsWithMatch(
        policy,
        viewer.roles,
        isSelf,
        viewer.matchContext,
        subjectPersonId,
        resourceName,
      )
    ) {
      continue;
    }
    redacted.push(field);
    next[field] = deniedFieldValue(field, next[field], policy.onDeny);
  }
  return redacted.length === 0
    ? resource
    : ({ ...next, redactedFields: redacted } as unknown as T);
}

/**
 * Amendment history stores before/after term snapshots, including sensitive
 * contract fields. Apply the contract field policies to both snapshots so the
 * history cannot bypass the contract list rules.
 */

/** Apply settlement-line field policies while leaving batch totals intact. */
export function redactSettlementBatchFields(
  batch: SettlementBatch,
  viewer: {
    personId?: string;
    roles: string[];
    policies?: Record<string, FieldAccessPolicy>;
    matchContext?: FieldAccessMatchContext;
  },
): SettlementBatch {
  if (!batch.lines?.length) return batch;
  return {
    ...batch,
    lines: batch.lines.map((line) =>
      redactResourceFields(line, "SETTLEMENT_LINE", {
        personId: viewer.personId,
        recordPersonId: line.personId,
        roles: viewer.roles,
        policies: viewer.policies,
      }),
    ),
  };
}

/**
 * Apply role-based field policies to a calculation run. This is deliberately
 * generic so the same matrix can protect other resources as they are added.
 */
export function redactCalculationRunFields(
  run: CalculationRun,
  viewer: {
    roles: string[];
    policies?: Record<string, FieldAccessPolicy>;
    matchContext?: FieldAccessMatchContext;
  },
): CalculationRun {
  const policies = {
    ...DEFAULT_FIELD_ACCESS_POLICIES,
    ...(viewer.policies ?? {}),
  };
  return {
    ...run,
    lines: run.lines.map((line) => {
      const redacted: string[] = [];
      const next: Record<string, unknown> = { ...line };
      for (const [key, rawPolicy] of Object.entries(policies)) {
        const policy = normalizeFieldPolicy(rawPolicy);
        if (!policy) continue;
        const [resource, field] = key.split(".");
        if (resource !== "CALCULATION_LINE" || !field) continue;
        if (
          fieldPolicyAllowsWithMatch(
            policy,
            viewer.roles,
            false,
            viewer.matchContext,
            line.personId,
            "CALCULATION_LINE",
          )
        ) {
          continue;
        }
        redacted.push(field);
        if (field === "trace" && !policy.onDeny) {
          next.trace = {};
        } else if (field in next) {
          next[field] = deniedFieldValue(field, next[field], policy.onDeny);
        }
      }
      return redacted.length === 0
        ? line
        : ({
            ...next,
            redactedFields: redacted,
          } as unknown as CalculationRun["lines"][number]);
    }),
  };
}

/** Apply tenant-configurable field access policies to payroll lines. */
export function redactPayrollFields(
  run: PayrollRun,
  viewer: {
    personId?: string;
    roles: string[];
    policies?: Record<string, FieldAccessPolicy>;
    breakGlass: boolean;
    matchContext?: FieldAccessMatchContext;
  },
): PayrollRun {
  const policies = {
    ...DEFAULT_PAYROLL_FIELD_POLICIES,
    ...(viewer.policies ?? {}),
  };
  return {
    ...run,
    lines: run.lines?.map((line) => {
      if (line.personId === viewer.personId) return line;
      const redacted: string[] = [];
      const next: PayrollLine = { ...line };
      for (const [key, rawPolicy] of Object.entries(policies)) {
        const policy = normalizeFieldPolicy(rawPolicy);
        if (!policy) continue;
        const [resource, field] = key.split(".");
        if (resource !== "PAYROLL_LINE" || !field) continue;
        if (field === "bankAccountRef" && viewer.breakGlass) continue;
        if (
          fieldPolicyAllowsWithMatch(
            policy,
            viewer.roles,
            false,
            viewer.matchContext,
            line.personId,
            "PAYROLL_LINE",
          )
        ) {
          continue;
        }
        redacted.push(field);
        if (field in next) {
          const current = (next as unknown as Record<string, unknown>)[field];
          (next as unknown as Record<string, unknown>)[field] =
            deniedFieldValue(field, current, policy.onDeny);
        }
      }
      return redacted.length === 0
        ? line
        : { ...next, redactedFields: redacted };
    }),
  };
}

/** Remove sensitive payroll fields for viewers without a finance/admin role. */
export function redactPayrollBankAccounts(
  run: PayrollRun,
  viewer: {
    personId?: string;
    canViewAll: boolean;
    breakGlass: boolean;
  },
): PayrollRun {
  if (viewer.canViewAll || viewer.breakGlass) return run;
  return {
    ...run,
    lines: run.lines?.map((line) =>
      line.personId === viewer.personId
        ? line
        : { ...line, bankAccountRef: undefined },
    ),
  };
}

