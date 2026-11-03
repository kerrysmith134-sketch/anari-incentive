/**
 * Declarative read/write scope for core entities. Route guards remain the
 * enforcement point; this registry is the single place that states the
 * intended scope, and the generated manifest is checked for freshness.
 *
 * `self` means the viewer may access records whose person id matches their
 * own. Roles are platform roles from `@anari/auth` (employee is implicit when
 * `self` is true).
 */
export interface EntityAccessContract {
  entity: string;
  read: { self: boolean; roles: string[] };
  write: { self: boolean; roles: string[] };
  note?: string;
}

export const CORE_ENTITY_ACCESS: readonly EntityAccessContract[] = [
  {
    entity: "employment_contracts",
    read: { self: true, roles: ["manager", "finance", "admin"] },
    write: { self: false, roles: ["admin"] },
    note: "Managers see contracts with bank references redacted by the field matrix.",
  },
  {
    entity: "payroll_runs",
    read: { self: true, roles: ["manager", "finance", "admin"] },
    write: { self: false, roles: ["manager", "finance", "admin"] },
    note: "Employees only see their own payroll line; the run totals are role-scoped.",
  },
  {
    entity: "payroll_lines",
    read: { self: true, roles: ["manager", "finance", "admin"] },
    write: { self: false, roles: ["manager", "finance", "admin"] },
  },
  {
    entity: "calculation_runs",
    read: { self: true, roles: ["manager", "finance", "admin"] },
    write: { self: false, roles: ["manager", "finance"] },
    note: "Formal creation is finance-only; employees see their own lines with amounts/trace redacted.",
  },
  {
    entity: "calculation_lines",
    read: { self: true, roles: ["manager", "finance", "admin"] },
    write: { self: false, roles: ["manager", "finance"] },
  },
  {
    entity: "amount_ledger",
    read: { self: true, roles: ["manager", "finance", "admin"] },
    write: { self: false, roles: ["finance", "admin"] },
    note: "Corrections append adjustment/reversal entries; locked rows are immutable.",
  },
  {
    entity: "settlement_batches",
    read: { self: false, roles: ["manager", "finance", "admin"] },
    write: { self: false, roles: ["finance", "admin"] },
  },
  {
    entity: "settlement_lines",
    read: { self: true, roles: ["manager", "finance", "admin"] },
    write: { self: false, roles: ["finance", "admin"] },
  },
  {
    entity: "audit_events",
    read: { self: false, roles: ["admin", "finance"] },
    write: { self: false, roles: ["system"] },
    note: "Append-only; application writes through the runtime, redactions are two-person.",
  },
];
