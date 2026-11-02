# ADR-009: Single-source contracts and conditional field access

- Status: Proposed
- Date: 2026-11-02
- Owners: Platform / Security Engineering
- Related: ADR-002 (canonical domain contract), ADR-003 (money-path invariants), ADR-008 (system-level policy defaults), PRD V4.1 DOM-01, SEC-03, SEC-06

## Context

Three contract surfaces still describe the same data independently:

1. **Request bodies** — Zod input schemas, hand-written OpenAPI components.
2. **Domain entities** — TypeScript interfaces in `packages/domain`.
3. **Persistence** — PostgreSQL DDL spread across `db/migrations/*.sql`.

Only the request surface has been unified so far: `requestSchemaRegistry`
(Zod) is the source, `docs/generated/request-contracts.json` is generated from
it, and tests fail when the manifest or OpenAPI drifts. Entity interfaces and
DDL are still maintained by hand, so a new column can appear in one place and
not the others until an integration test happens to touch it.

Field-level access is also role-only. `fieldAccessPolicies` maps
`RESOURCE.field` to an allow-list of roles; there is no way to express
conditions such as "finance may see salary lines only for their own legal
entity" or "auditors may see redacted evidence outside an active investigation".
Tenants with more nuanced confidentiality requirements currently express them
by narrowing roles, which is either too broad or too restrictive.

## Decision

### 1. Contracts have one machine-readable source per layer

Requests are already solved and remain as-is.

For entities and persistence, adopt a **phased single-source approach** rather
than a big-bang rewrite:

- **Phase 1 (done):** request contracts generated from Zod; DDL columns are
  guarded by `tests/ddl-contract.test.ts`, which parses the migration chain and
  asserts the money-path tables still contain their required columns, that no
  column is defined twice and that no migration alters an unknown table.
- **Phase 2 (next):** introduce `packages/domain/src/entities.ts` as a small
  declarative registry of core entities (field name, logical type, nullability,
  ownership/classification). Generate, from that registry:
  - TypeScript types used by the domain package (or verify existing interfaces
    against it),
  - a DDL column manifest compared with the parsed migrations,
  - the field classification used by the access matrix.
  The registry is the source; generated artifacts are committed and freshness
  checked, following the request-contract pattern.
- **Phase 3:** migrate remaining tables in batches, keeping the migration
  parser as the independent verifier. A registry change that is not reflected
  in DDL (or vice versa) fails the suite.

We deliberately do **not** generate migrations from the registry. DDL carries
constraints, triggers, grants and data migrations that are not expressible as
entity metadata; migrations stay hand-written and are verified, not generated.

### 2. Conditional field access is expressed as a policy object

Extend a policy value from `string[]` to a discriminated union while keeping
today's shape valid:

```jsonc
{
  "EMPLOYMENT_CONTRACT.bankAccountRef": ["finance", "admin"],        // unchanged
  "EMPLOYMENT_CONTRACT.fixedMonthlySalary": {
    "allowRoles": ["finance", "admin"],
    "allowSelf": true,
    "match": { "sameLegalEntity": true },                            // optional
    "onDeny": "OMIT"                                                 // OMIT | ZERO | REDACT
  }
}
```

Rules:

- **Default deny.** Missing `allowRoles`/`allowSelf` means no one except
  `admin` may read the field.
- **Conditions are evaluated server-side** from canonical records, never from
  request-supplied claims. Supported predicates stay small and auditable:
  `sameLegalEntity`, `sameOrgNode`, `employmentActive`, `legalHoldActive`.
  Unsupported predicates reject the policy at write time.
- **No condition may grant access a role would not otherwise have.** Conditions
  can narrow, not widen.
- **Denial behaviour is explicit** (`OMIT`/`ZERO`/`REDACT`) so numeric fields are
  not silently zeroed when omission is safer.
- Every policy write is audited with before/after; redacted responses keep
  returning `redactedFields` so callers know data was withheld.

Admin bypass remains, but reading another tenant's data is still impossible
(RLS and tenant scoping are orthogonal to field policies).

### 3. Automatic retention deletion stays disabled

This decision is unchanged from ADR-008. Disposal remains a reviewed workflow
with a different approver and a grace period. Automatic hard deletion requires
deployment-specific legal review and an external scheduler contract; it is not
implemented by this ADR or by the entity registry.

## Consequences

- The DDL guard already catches accidental column loss and duplicate column
  definitions without requiring a database in unit tests.
- Phase 2 introduces generated artifacts; contributors must run the generator
  after changing a core entity, exactly as they run `contracts:manifest`.
- Conditional policies make the access matrix more expressive, at the cost of
  a per-request evaluation that must stay deterministic and cheap. Conditions
  are restricted to fields already loaded with the record; no extra queries.
- Tenants that use only the array form are unaffected.
- Some PRD items remain deployment or legal evidence (external e-signature,
  WORM/TSA receipts, statutory deduction mapping) and are out of scope here.
