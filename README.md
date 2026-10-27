# N-Perform / Anari Incentive

**多人贡献认定与激励结算的 assurance layer。**

This repository is the implementation baseline for PRD V4.1. It does **not** try to be a generic HRIS, payroll system, project-management suite, or “AI gives everyone a score” product. It connects business facts, work packages, deliverables, acceptance, contribution claims, attribution decisions, deterministic calculation, approval, employee confirmation/appeal, and an append-only ledger — so a company can explain **who contributed to what, and why a payment is what it is**.

> **First wedge**: EV charging / PV+BESS+charging project delivery — initially DC fast-charging station EPC. The industry profile, work-package template, evidence map and risk list are in [`docs/wedge-ev-charging.md`](docs/wedge-ev-charging.md).
>
> Status: **Sprint 0/1/2 vertical slice**. The repository contains a runnable API (memory or PostgreSQL), domain state machines, a deterministic policy evaluator with a reference policy pack, an append-only ledger, legal-gate and employee-confirmation workflows, an appeal workflow, an AI evaluation gate scaffold, tests, and PostgreSQL migrations. It is not production-ready.

---

## What is implemented

| Area | Implementation |
|---|---|
| Domain states | Canonical state machines and legal transitions in `packages/domain/src/states.ts` |
| Contribution model | Work package → commitment snapshot → claim → attribution decision; claimant cannot adjudicate their own claim |
| Policy engine | Deterministic decimal arithmetic, order-contribution pool, cap, largest-remainder allocation, trace, result hash |
| Charging policy | `CHARGING_PROJECT_CONTRIBUTION_V1`: project gross profit × 4% (cap 150k), 40% cash-collection weighting, 5% retention holdback, acceptance/safety gates |
| Reference policy pack | generic `order-contribution-v1` + `charging-project-contribution-v1`; 5 generic + 5 charging project fixtures with expected outputs |
| Independent reference | Separate `Number`-based reference calculation; mismatch is visible in tests |
| Evidence graph | EvidenceNode + EvidenceLink with source/provenance, quality status, supersedes, supporting/counter links; API and PostgreSQL-backed |
| Ledger | Append-only, idempotent, lock, reversal, per-tenant hash chain; PostgreSQL trigger prevents locked-row mutation |
| Legal gate | Server-side `legal_gate_records`; `FORMAL` requires policy approval, minimum-wage check, democratic-procedure ref, employee-notice ref, DPIA ref; callers cannot self-assert a gate on the calculation request |
| Employee confirmation | `VIEWED` / `CONFIRMED` / `OBJECTED`; a formal run cannot lock until every participant confirms; an objection blocks locking |
| Appeals | OPEN → TRIAGED → UNDER_REVIEW → DECIDED → RECALCULATION_REQUIRED/CLOSED; appellant cannot triage/resolve their own appeal |
| Persistence | In-memory store (default) and PostgreSQL `PgStore` with tenant-scoped transactions and RLS |
| AI gate | `packages/ai-gate`: evidence summary/gap detection only; numeric scoring refuses until an evaluation gate passes |
| AI evaluation harness | Cohen's kappa, subgroup error gap, counterfactual stability, prompt-injection pass rate; returns a gate with blockers |
| Employee view | Minimal page at `/`: load a calculation, confirm/object, create an appeal |
| Reconciliation | CSV expected amounts vs engine output; `npm run reconcile` exits non-zero on differences |
| API | Fastify + Zod, typed error envelope, explicit commands |
| Database | PostgreSQL 16 migrations: core schema, governance schema, money-path invariants, audit hash chain, RLS for core tables |
| Tests | **56 unit/API tests + 5 PostgreSQL integration tests** covering state transitions, self-adjudication block, deterministic results, reference/reconciliation match, legal gate, confirmations/objections, appeals, evidence links, ledger immutability/idempotency/reversal, AI gate metrics, and RLS |

## What is intentionally not implemented yet

- AI scoring / Evaluation Agent (only evidence summary and gap detection are allowed until the evaluation gate passes);
- Agent Runtime / autonomous execution;
- Multi-tenant self-service, billing, tenant onboarding;
- Equity/option ledger;
- Bounty marketplace, strategic/A-class pool automation;
- Full project management, HRIS, payroll;
- Full employee-facing UI (a minimal page exists at `/`); real Feishu/CRM connector.

These are deliberately deferred per `docs/PRD_V4.1_评审修订版.md`.

---

## Quick start

### Option A: local Node.js 20+ (memory store)

```bash
npm install
npm test
npm run typecheck
npm run dev
# API at http://localhost:3000
```

### Option B: Docker-only

```bash
docker run --rm -v "$PWD":/app -w /app node:22-alpine \
  sh -c "npm install && npm test && npm run dev"
```

### PostgreSQL-backed API

```bash
docker compose up -d postgres
export DATABASE_URL="postgres://anari:anari@localhost:5432/anari_incentive"
npm run db:migrate
npm run db:seed
STORE=postgres DATABASE_URL="$DATABASE_URL" npm run dev
```

The seed creates:
- tenant `00000000-0000-4000-8000-000000000001`;
- people `...0001` (owner), `...0002` (contributor), `...0003` (adjudicator);
- cycle `...0020`;
- reference policy `...0100`;
- a non-superuser `anari_app` role (password `anari_app`) with `NOBYPASSRLS` for RLS testing.

### PostgreSQL integration tests

```bash
npm run test:pg
```

This starts a disposable `postgres:16-alpine` container on port `55432`, applies the migrations and seed, then runs `PgStore` tests as `anari_app` so RLS is actually enforced.

---

## API surface (first slice)

All responses use `{ data, meta: { correlation_id } }`; errors use `{ error: { code, message, details }, meta }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Minimal employee confirmation page |
| GET | `/health` | Liveness |
| POST | `/api/v1/evidence` | Create evidence node |
| GET | `/api/v1/evidence?subjectType=&subjectId=` | List evidence for a subject |
| POST | `/api/v1/evidence/:id/links` | Link supporting/counter/dependency evidence |
| GET | `/api/v1/evidence/:id/links` | List evidence links |
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
| POST | `/api/v1/policy-versions/:id/legal-gate` | Record server-side legal gate |
| GET | `/api/v1/policy-versions/:id/legal-gate` | Read legal gate |
| POST | `/api/v1/calculation-runs` | SHADOW/FORMAL calculation |
| GET | `/api/v1/calculation-runs` / `/:id` | List/get |
| POST | `/api/v1/calculation-runs/:id/approve` | CALCULATED → APPROVED |
| POST | `/api/v1/calculation-runs/:id/lock` | APPROVED → LOCKED; locks ledger entries; formal runs require confirmations |
| POST | `/api/v1/employee-confirmations` | VIEWED / CONFIRMED / OBJECTED |
| GET | `/api/v1/employee-confirmations?personId=` | List confirmations |
| GET | `/api/v1/ledger` | List ledger |
| GET | `/api/v1/ledger/verify` | Verify hash chain |
| POST | `/api/v1/appeals` | Open appeal |
| GET | `/api/v1/appeals` / `/:id` | List/get |
| POST | `/api/v1/appeals/:id/triage` | OPEN → TRIAGED; assign reviewer |
| POST | `/api/v1/appeals/:id/review` | TRIAGED → UNDER_REVIEW |
| POST | `/api/v1/appeals/:id/resolve` | UNDER_REVIEW → DECIDED → CLOSED/RECALCULATION_REQUIRED |

### Example: shadow calculation

```bash
curl -s http://localhost:3000/api/v1/calculation-runs \
  -H 'content-type: application/json' \
  -d '{
    "cycleId": "00000000-0000-4000-8000-000000000020",
    "policyVersionId": "00000000-0000-4000-8000-000000000101",
    "mode": "SHADOW",
    "order": {"id": "charging-order-1", "grossProfit": "1000000", "currency": "CNY", "contractAmount": "2000000", "cashCollected": "1500000", "projectType": "DC_FAST_CHARGING_STATION", "siteId": "site-001", "safetyIncidents": 0, "acceptanceStatus": "ACCEPTED"},
    "participants": [
      {"personId": "00000000-0000-4000-8000-000000000001", "workPackageId": "00000000-0000-4000-8000-000000000010", "attributionWeight": "0.6", "role": "SALES_LEAD"},
      {"personId": "00000000-0000-4000-8000-000000000002", "workPackageId": "00000000-0000-4000-8000-000000000010", "attributionWeight": "0.4", "role": "DELIVERY_MANAGER"}
    ]
  }' | jq
```

`FORMAL` does **not** accept a `legalGate` in the request body. The gate must be recorded first:

```bash
curl -s -X POST http://localhost:3000/api/v1/policy-versions/00000000-0000-4000-8000-000000000100/legal-gate \
  -H 'content-type: application/json' \
  -d '{
    "policyApproved": true,
    "minimumWageChecked": true,
    "democraticProcedureRef": "dp-2026-10",
    "employeeNoticeRef": "notice-2026-10",
    "dataProtectionAssessmentRef": "dpia-2026-10",
    "recordedBy": "00000000-0000-4000-8000-000000000003"
  }'
```

Then a `FORMAL` run also requires confirmed attribution for every participant and employee confirmations before `lock`. Missing gates return `422 CALCULATION_BLOCKED`.

---

## Repository layout

```
apps/api/                 Fastify API, in-memory store, PostgreSQL store, public employee page
packages/domain/          Canonical states, types, invariants
packages/contracts/       Zod request schemas
packages/policy-dsl/      Deterministic decimal, order-contribution policy, reference
packages/ledger/          Append-only ledger, idempotency, hash chain
packages/ai-gate/         Evaluation gate + non-scoring evidence assistant
fixtures/                 Reference policy, anonymized order fixtures, reconciliation CSV
db/migrations/            PostgreSQL schema and money-path invariants
db/seed/                  Demo tenant/people/cycle/policy + RLS app role
scripts/test-pg.sh        Disposable PostgreSQL integration test runner
scripts/reconcile.ts     CSV vs engine reconciliation
docs/
  PRD_V4.1_评审修订版.md   Revised product requirements
  wedge-ev-charging.md    EV charging / PV+BESS+charging wedge profile
  REVIEW_2026-10-27.md    Full review that drove the revision
  domain-contract.md      State machines, money-path invariants, commands
  adr/                    Architecture decision records
  source/                 V4.0 baseline documents (reference only)
tests/                    Cross-package fixture/E2E tests
```

## Design decisions that must not be weakened

1. **LLM never writes money.** Formal amounts come from a versioned deterministic engine.
2. **Contribution claim ≠ attribution decision.** Self-claims never auto-approve.
3. **One canonical state machine.** API, DB, and tests derive from `packages/domain/src/states.ts`.
4. **Locked ledger is immutable.** Corrections append adjustments/reversals.
5. **Formal calculation requires a server-side legal gate.** A request cannot self-assert legal approval.
6. **Formal locking requires employee confirmation.** An objection blocks locking and routes to appeal/recalculation.
7. **Same input + policy + engine version → same result hash.**
8. **Evidence has provenance.** Evidence nodes link to subjects and to each other; a claim reference is not proof by itself.
9. **AI is optional and gated.** Evidence summary/gap detection are allowed; numeric scoring requires a passed evaluation gate with IRR, subgroup, counterfactual and prompt-injection evidence.

## Next steps (12-week sprint)

- W1–2: pick 5–10 real cross-team orders, map work packages/evidence, baseline coverage/time/disputes.
- W3–4: legal review, employee consultation plan, DPIA, minimum-wage/deduction check.
- W5–6: minimal evidence workbench + one real connector; employee confirmation/appeal — **evidence API, employee page, confirmation/appeal done; real connector pending**.
- W7–8: reference policy pack, independent spreadsheet/script reconciliation, shadow settlement — **reference pack, fixtures and CSV reconciliation done; shadow settlement with real data pending**.
- W9–10: 20–50 person cycle; measure coverage, time, disputes, trust.
- W11–12: finance reconciliation, appeal drill, Go/No-Go.

See `docs/PRD_V4.1_评审修订版.md` §11 for Go/No-Go and kill criteria.

## References

- Full review: [`docs/REVIEW_2026-10-27.md`](docs/REVIEW_2026-10-27.md)
- Revised PRD: [`docs/PRD_V4.1_评审修订版.md`](docs/PRD_V4.1_评审修订版.md)
- EV charging wedge: [`docs/wedge-ev-charging.md`](docs/wedge-ev-charging.md)
- Domain contract: [`docs/domain-contract.md`](docs/domain-contract.md)
- ADRs: [`docs/adr/`](docs/adr/)
