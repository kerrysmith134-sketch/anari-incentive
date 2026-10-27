# N-Perform / Anari Incentive

**多人贡献认定与激励结算的 assurance layer。**

This repository is the implementation baseline for PRD V4.1. It does **not** try to be a generic HRIS, payroll system, project-management suite, or “AI gives everyone a score” product. It connects business facts, work packages, deliverables, acceptance, contribution claims, attribution decisions, deterministic calculation, approval, employee confirmation/appeal, and an append-only ledger — so a company can explain **who contributed to what, and why a payment is what it is**.

> Status: **Sprint 0 / first vertical slice**. The repository contains a runnable API, domain state machines, a deterministic policy evaluator, an append-only ledger, tests, and PostgreSQL migrations. It is not production-ready.

---

## What is implemented

| Area | Implementation |
|---|---|
| Domain states | Canonical state machines and legal transitions in `packages/domain/src/states.ts` |
| Contribution model | Work package → commitment snapshot → claim → attribution decision; claimant cannot adjudicate their own claim |
| Policy engine | Deterministic decimal arithmetic, order-contribution pool, cap, largest-remainder allocation, trace, result hash |
| Independent reference | Separate `Number`-based reference calculation for the first slice; mismatch is visible in tests |
| Ledger | Append-only, idempotent, lock, reversal, per-tenant hash chain |
| Legal gate | `FORMAL` calculation requires policy approval, minimum-wage check, democratic-procedure ref, employee-notice ref, DPIA ref; `SHADOW` can run without payment effect |
| API | Fastify + Zod, typed error envelope, explicit commands |
| Database | PostgreSQL 16 migrations: core schema, governance schema, money-path invariants, audit hash chain, RLS for core tables |
| Tests | 21 tests covering state transitions, self-adjudication block, deterministic results, reference match, legal gate, ledger immutability/idempotency/reversal |

## What is intentionally not implemented yet

- AI scoring / Evaluation Agent (only evidence assistance is allowed until the evaluation gate passes);
- Agent Runtime / autonomous execution;
- Multi-tenant self-service, billing, tenant onboarding;
- Equity/option ledger;
- Bounty marketplace, strategic/A-class pool automation;
- Full project management, HRIS, payroll;
- Employee-facing UI (the API is the current surface).

These are deliberately deferred per `docs/PRD_V4.1_评审修订版.md`.

---

## Quick start

### Option A: local Node.js 20+

```bash
npm install
npm test
npm run typecheck
npm run dev
# API at http://localhost:3000
```

### Option B: Docker-only (no local Node required)

```bash
docker run --rm -v "$PWD":/app -w /app node:22-alpine \
  sh -c "npm install && npm test && npm run dev"
```

### Database

```bash
docker compose up -d postgres
export DATABASE_URL="postgres://anari:anari@localhost:5432/anari_incentive"
npm run db:migrate
```

The migrations are:

1. `db/migrations/001_core_schema.sql` — core objects, canonical state enums, money fields, ledger, audit, outbox/inbox;
2. `db/migrations/002_governance_schema.sql` — employee representation/notices/confirmations, policy change governance, budgets, financial facts, model evaluation, settlement evidence, privacy/retention;
3. `db/migrations/003_money_path_invariants.sql` — non-overlap constraints, locked-ledger immutability, audit hash chain, settlement/ledger matching, approval consumption guard, RLS for core tables.

> **RLS note**: the app role must be `NOBYPASSRLS` and must `SET LOCAL app.tenant_id = '<uuid>'` at the start of each transaction. The in-memory API currently uses a demo tenant; production auth/tenant context is not wired yet.

---

## API surface (first slice)

All responses use `{ data, meta: { correlation_id } }`; errors use `{ error: { code, message, details }, meta }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| POST | `/api/v1/work-packages` | Create work package (DRAFT) |
| GET | `/api/v1/work-packages` | List |
| GET | `/api/v1/work-packages/:id` | Get |
| POST | `/api/v1/work-packages/:id/commit` | Freeze commitment snapshot (expectedVersion) |
| POST | `/api/v1/work-packages/:id/start` | COMMITTED → IN_PROGRESS |
| POST | `/api/v1/work-packages/:id/submit` | IN_PROGRESS → SUBMITTED |
| POST | `/api/v1/work-packages/:id/accept` | SUBMITTED → ACCEPTED (reviewer ≠ owner) |
| POST | `/api/v1/work-packages/:id/reject` | SUBMITTED → REJECTED (reviewer ≠ owner) |
| POST | `/api/v1/contribution-claims` | Create claim (requires ACCEPTED work package) |
| POST | `/api/v1/contribution-claims/:id/submit` | DRAFT → SUBMITTED |
| POST | `/api/v1/attribution-decisions` | Formal decision; claimant cannot be adjudicator |
| GET | `/api/v1/attribution-decisions?claimId=` | List decisions |
| POST | `/api/v1/calculation-runs` | SHADOW/FORMAL calculation |
| GET | `/api/v1/calculation-runs` / `/:id` | List/get |
| POST | `/api/v1/calculation-runs/:id/approve` | CALCULATED → APPROVED |
| POST | `/api/v1/calculation-runs/:id/lock` | APPROVED → LOCKED; locks ledger entries |
| GET | `/api/v1/ledger` | List ledger |
| GET | `/api/v1/ledger/verify` | Verify hash chain |
| POST | `/api/v1/appeals` | Open appeal |
| GET | `/api/v1/appeals` | List appeals |

### Example: shadow calculation

```bash
curl -s http://localhost:3000/api/v1/calculation-runs \
  -H 'content-type: application/json' \
  -d '{
    "cycleId": "00000000-0000-4000-8000-000000000020",
    "policyVersionId": "policy-v1",
    "mode": "SHADOW",
    "order": {"id": "order-1", "grossProfit": "100000", "currency": "CNY"},
    "participants": [
      {"personId": "00000000-0000-4000-8000-000000000001", "workPackageId": "00000000-0000-4000-8000-000000000010", "attributionWeight": "0.6", "role": "OWNER"},
      {"personId": "00000000-0000-4000-8000-000000000002", "workPackageId": "00000000-0000-4000-8000-000000000010", "attributionWeight": "0.4", "role": "CONTRIBUTOR"}
    ]
  }' | jq
```

`FORMAL` additionally requires `legalGate` with `policyApproved`, `minimumWageChecked`, `democraticProcedureRef`, `employeeNoticeRef`, `dataProtectionAssessmentRef`, and confirmed attribution for every participant. A missing gate returns `422 CALCULATION_BLOCKED`.

---

## Repository layout

```
apps/api/                 Fastify API and in-memory vertical slice
packages/domain/          Canonical states, types, invariants
packages/contracts/       Zod request schemas
packages/policy-dsl/      Deterministic decimal, order-contribution policy, reference
packages/ledger/          Append-only ledger, idempotency, hash chain
db/migrations/            PostgreSQL schema and money-path invariants
docs/
  PRD_V4.1_评审修订版.md   Revised product requirements
  REVIEW_2026-10-27.md    Full review that drove the revision
  adr/                    Architecture decision records
  source/                 V4.0 baseline documents (reference only)
tests/                    Reserved for cross-package E2E tests
```

## Design decisions that must not be weakened

1. **LLM never writes money.** Formal amounts come from a versioned deterministic engine.
2. **Contribution claim ≠ attribution decision.** Self-claims never auto-approve.
3. **One canonical state machine.** API, DB, and tests derive from `packages/domain/src/states.ts`.
4. **Locked ledger is immutable.** Corrections append adjustments/reversals.
5. **Formal calculation requires a legal gate.** Shadow calculation is explicitly non-payment.
6. **Same input + policy + engine version → same result hash.**
7. **AI is optional.** Core flows continue with AI disabled.

## Next steps (12-week sprint)

- W1–2: pick 5–10 real cross-team orders, map work packages/evidence, baseline coverage/time/disputes.
- W3–4: legal review, employee consultation plan, DPIA, minimum-wage/deduction check.
- W5–6: minimal evidence workbench + one real connector; employee confirmation/appeal.
- W7–8: reference policy pack, independent spreadsheet/script reconciliation, shadow settlement.
- W9–10: 20–50 person cycle; measure coverage, time, disputes, trust.
- W11–12: finance reconciliation, appeal drill, Go/No-Go.

See `docs/PRD_V4.1_评审修订版.md` §11 for Go/No-Go and kill criteria.

## References

- Full review: [`docs/REVIEW_2026-10-27.md`](docs/REVIEW_2026-10-27.md)
- Revised PRD: [`docs/PRD_V4.1_评审修订版.md`](docs/PRD_V4.1_评审修订版.md)
- ADRs: [`docs/adr/`](docs/adr/)
