# ADR-003: Money-path invariants are database invariants

- **Status**: Accepted
- **Date**: 2026-10-27
- **Context**: The review found that the engineering pack described approval, settlement and ledger controls but did not enforce them at the database level: approvals could be reused, the same ledger entry could enter multiple settlement batches, calculation lines could be duplicated, and locked ledger/audit rows had no immutability trigger.
- **Decision**:
  - Approval consumption is explicit: `approval_requests.consumed_at/consumed_by`, a target action reference, and `approval_request_id` on the action.
  - Settlement lines must reference a `LOCKED` ledger entry and match person/amount/currency; an active ledger entry can appear in only one settlement batch.
  - `calculation_lines` is unique by `(tenant_id, calculation_run_id, person_id, incentive_type, line_key)`.
  - `amount_ledger` is unique by `(tenant_id, calculation_line_id, entry_type)` and `(tenant_id, idempotency_key)`.
  - Locked ledger rows reject UPDATE/DELETE via trigger; corrections append adjustment/reversal rows.
  - Audit events are append-only and hash-chained per tenant.
  - `calculation_runs` stores the full input snapshot, not only a hash.
  - RLS is enabled for core tenant tables; the application role must be `NOBYPASSRLS`.
- **Consequences**:
  - Some operations require an explicit approval/consumption step even in the demo.
  - Reconciliation and reporting must read `amount_ledger`/`settlement_lines` under RLS context.
  - These invariants are tested at the API/ledger level now and must be tested against PostgreSQL (Testcontainers) before formal settlement.
