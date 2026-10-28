# N-Perform / Anari Incentive

**制度无关的、AI-native 的多人贡献认定与激励结算 assurance layer。**

This repository is the implementation baseline for PRD V4.1. The core is **institution-agnostic**: it does not know what a “charging pile”, “EPC project” or “sales commission” is. Industries and policies are configuration packs under [`examples/verticals/`](examples/verticals/); the first design partner (Anari) uses the EV charging equipment-sales pack, but that pack is a tenant configuration, not the product boundary.

> **Product principles**: policy-as-data; evidence-first; deterministic money; human-approved high-impact actions; proactive agents that observe, detect, plan, act, verify and escalate.
>
> Status: **Sprint 0/1/2 vertical slice + agent-runtime scaffold**. The repository contains a runnable API (memory or PostgreSQL), domain state machines, a deterministic policy evaluator with policy packs, an append-only ledger, legal-gate and employee-confirmation workflows, an appeal workflow, a proactive agent runtime, an AI evaluation gate, tests, and PostgreSQL migrations. It is not production-ready.

---

## What is implemented

| Area | Implementation |
|---|---|
| Domain states | Canonical state machines and legal transitions in `packages/domain/src/states.ts` |
| Contribution model | Work package → commitment snapshot → claim → attribution decision; claimant cannot adjudicate their own claim |
| Policy engine | Deterministic decimal arithmetic, order-contribution pool, cap, largest-remainder allocation, trace, result hash |
| Policy packs | Core has no industry code. `examples/verticals/charging-equipment-sales/` is the first design-partner pack; `examples/verticals/professional-services/` is a conformance pack proving a materially different policy runs without core changes; `examples/verticals/charging-epc/` is a later extension. Each pack = policy data + fixtures + README. |
| Agent runtime | `packages/agent-runtime`: proactive observe → find → plan → act → verify → escalate; T0/T1 auto-execute, T2/T3 require human approval; scheduler (schedule/event/threshold); policy proposal + impact simulation; idempotency, audit log, AI-off fallback; `POST /agent-tasks/scan` for sweeps |
| Agent worker | `apps/worker`: polls the transactional outbox, dispatches domain events to agents, runs scheduled scans, and exposes graceful shutdown. |
| Policy simulation | `simulatePolicyChange` replays representative inputs through current vs proposed policy; returns per-person/total deltas and blockers. It never publishes or writes money. |
| Policy publication | `POST /policy-versions` writes a `PUBLISHED`, content-hashed, approver-attributed version; a successor closes the prior effective window and published content stays immutable. Formal calculations still require the separate legal gate. |
| Independent reference | Separate `Number`-based reference calculation; mismatch is visible in tests |
| Evidence graph | EvidenceNode + EvidenceLink with source/provenance, quality status, supersedes, supporting/counter links; API and PostgreSQL-backed |
| Ingestion + connectors | Generic event ingestion (`raw_events` → evidence nodes) with deduplication; CSV connector and CLI importer (`npm run import:csv`) |
| Auth | OIDC/JWT bearer authentication (`AUTH_MODE=oidc`) or development header authenticator (`AUTH_MODE=dev`); all `/api/v1` routes reject unauthenticated calls |
| Ledger | Append-only, idempotent, lock, reversal, per-tenant hash chain; PostgreSQL trigger prevents locked-row mutation |
| Legal gate | Server-side `legal_gate_records`; `FORMAL` requires policy approval, minimum-wage check, democratic-procedure ref, employee-notice ref, DPIA ref; callers cannot self-assert a gate on the calculation request |
| Employee confirmation | `VIEWED` / `CONFIRMED` / `OBJECTED`; a formal run cannot lock until every participant confirms; an objection blocks locking |
| Appeals | OPEN → TRIAGED → UNDER_REVIEW → DECIDED → RECALCULATION_REQUIRED/CLOSED; appellant cannot triage/resolve their own appeal |
| Persistence | In-memory store (default) and PostgreSQL `PgStore` with tenant-scoped transactions and RLS |
| AI gate | `packages/ai-gate`: evidence summary/gap detection only; numeric scoring refuses until an evaluation gate passes |
| AI evaluation harness | Cohen's kappa, subgroup error gap, counterfactual stability, prompt-injection pass rate; returns a gate with blockers |
| Employee view | Minimal page at `/`: load a calculation, confirm/object, create an appeal |
| Admin view | Minimal page at `/admin`: policy impact simulation, proactive agent scan, pending-action approval |
| Reconciliation | CSV expected amounts vs engine output; `npm run reconcile` exits non-zero on differences |
| API | Fastify + Zod, typed error envelope, explicit commands; OpenAPI 3.1 contract at [`docs/openapi.yaml`](docs/openapi.yaml) |
| Database | PostgreSQL 16 migrations: core schema, governance schema, money-path invariants, audit hash chain, RLS for core tables |
| CI | `scripts/ci.sh` runs install → typecheck → tests → compose validation → PostgreSQL integration tests |
| Tests | **103 unit/API tests + 8 PostgreSQL integration tests** covering state transitions, self-adjudication block, deterministic results, reference/reconciliation match, legal gate, confirmations/objections, appeals, evidence links, ledger immutability/idempotency/reversal, policy publication/succession, AI gate metrics, auth, ingestion, OpenAPI route coverage, and RLS |

## What is intentionally not implemented yet

- AI scoring / Evaluation Agent (only evidence summary and gap detection are allowed until the evaluation gate passes);
- Autonomous T2/T3 actions (the runtime supports them, but high-impact actions always wait for a human);
- Production CRM/ERP/Feishu connectors (a generic CSV connector and ingestion API exist; provider-specific OAuth/field mapping is pending);
- Per-request tenant-scoped store factory (authentication establishes identity, but the store is currently bound to one tenant per process);
- Worker OIDC bearer support (the worker currently calls the API with dev headers);
- Multi-tenant self-service, billing, tenant onboarding;
- Equity/option ledger;
- Bounty marketplace, strategic/A-class pool automation;
- Full project management, HRIS, payroll;
- Full employee/admin UI (minimal pages exist at `/` and `/admin`).

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
# Employee page: http://localhost:3000/
# Admin page:    http://localhost:3000/admin
```

`AUTH_MODE` defaults to `dev`, which accepts `X-Tenant-Id` / `X-User-Id`
headers. Set `AUTH_MODE=oidc` plus `OIDC_ISSUER` / `OIDC_AUDIENCE` /
`OIDC_JWKS_URI` to require a bearer JWT.

### CI

```bash
./scripts/ci.sh            # full: typecheck, tests, compose config, PostgreSQL
CI_SKIP_PG=1 ./scripts/ci.sh
```

### Option B: Docker-only

```bash
docker run --rm -v "$PWD":/app -w /app node:22-alpine \
  sh -c "npm install && npm test && npm run dev"
```

### Docker compose (postgres + migrate + api + worker)

```bash
docker compose up --build
```

The `worker` polls `outbox_events`, dispatches domain events to the agent runtime, and runs scheduled scans.

### PostgreSQL-backed API (manual)

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
| GET | `/admin` | Minimal admin page: policy simulation + agent approvals |
| GET | `/health` | Liveness |
| POST | `/api/v1/ingestion/events:batch` | Ingest connector events; dedup + evidence projection |
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
| GET | `/api/v1/contribution-claims` / `/:id` | List/get claims |
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
| POST | `/api/v1/agent-tasks` | Enqueue a proactive agent task |
| POST | `/api/v1/agent-tasks/scan` | Run a proactive scan: evidence gaps, anomalies, settlement readiness |
| POST | `/api/v1/policy-versions` | Publish an approved policy version; closes the prior effective window |
| POST | `/api/v1/policy-simulations` | Replay samples through current vs proposed policy; no publication |
| GET | `/api/v1/agent-tasks` / `/:id` | List/get agent tasks |
| POST | `/api/v1/agent-tasks/:id/run` | Observe → plan → execute low-risk actions |
| POST | `/api/v1/agent-tasks/:id/approve` | Human approval for a pending T2/T3 action |
| POST | `/api/v1/agent-tasks/:id/reject` | Reject a pending action |

### Example: shadow calculation

```bash
curl -s http://localhost:3000/api/v1/calculation-runs \
  -H 'content-type: application/json' \
  -d '{
    "cycleId": "00000000-0000-4000-8000-000000000020",
    "policyVersionId": "00000000-0000-4000-8000-000000000102",
    "mode": "SHADOW",
    "order": {"id": "equipment-order-1", "grossProfit": "600000", "currency": "CNY", "invoiceAmount": "3000000", "cashCollected": "2400000", "creditApproved": true, "qualityHold": false, "channelShare": "0", "projectType": "DC_CHARGING_PILE_SALE"},
    "participants": [
      {"personId": "00000000-0000-4000-8000-000000000001", "workPackageId": "00000000-0000-4000-8000-000000000010", "attributionWeight": "0.6", "role": "SALES_LEAD"},
      {"personId": "00000000-0000-4000-8000-000000000002", "workPackageId": "00000000-0000-4000-8000-000000000010", "attributionWeight": "0.4", "role": "PRODUCT_MANAGER"}
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
apps/api/                 Fastify API, in-memory store, PostgreSQL store, public employee/admin pages
apps/worker/              Outbox poller + scheduled proactive agent worker
packages/domain/          Canonical states, types, invariants
packages/contracts/       Zod request schemas
packages/policy-dsl/      Deterministic decimal, order-contribution policy, reference
packages/ledger/          Append-only ledger, idempotency, hash chain
packages/ai-gate/         Evaluation gate + non-scoring evidence assistant
packages/agent-runtime/   Proactive agent runtime, skills, tools, approval gates
packages/auth/            OIDC/JWT and dev-header authenticators
packages/connectors/      Connector interface + CSV connector
examples/verticals/       Tenant policy packs (charging equipment sales, professional services, EPC)
fixtures/                 Generic reference policy, order fixtures, reconciliation CSV, connector fixtures
db/migrations/            PostgreSQL schema and money-path invariants
db/seed/                  Demo tenant/people/cycle/policy + RLS app role
scripts/test-pg.sh        Disposable PostgreSQL integration test runner
scripts/ci.sh             Install → typecheck → tests → compose → PostgreSQL
scripts/reconcile.ts     CSV vs engine reconciliation
scripts/agent-scan.ts    Cron/on-demand proactive agent scan
scripts/import-csv.ts    CSV connector importer
Dockerfile                API/worker image
docker-compose.yml        postgres + migrate + api + worker
docs/
  PRD_V4.1_评审修订版.md   Revised product requirements
  REVIEW_2026-10-27.md    Full review that drove the revision
  domain-contract.md      State machines, money-path invariants, commands
  openapi.yaml            OpenAPI 3.1 contract (route coverage is tested)
  adr/                    Architecture decision records
  source/                 V4.0 baseline documents (reference only)
tests/                    Cross-package fixture/E2E/contract tests
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
10. **The core is institution-agnostic.** A vertical is a policy pack under `examples/verticals/`, not a fork of the engine or a hard-coded industry workflow.
11. **The agent is proactive but bounded.** It can observe, detect, plan, request evidence, remind and escalate; T0/T1 actions may run automatically, T2/T3 actions require a human, and every action is audited.

## Next steps (12-week sprint)

- W1–2: pick 5–10 real multi-party orders/projects from the first design partner, map work packages/evidence, baseline coverage/time/disputes; keep the core generic.
- The **second reference policy pack** (professional services) is in place and covered by `tests/pack-conformance.test.ts`; use it as the regression guard against industry-specific core changes.
- Agent scheduler (schedule/event/threshold), policy proposal and impact simulation are in place; wire them to the production event bus/cron and real connectors next.
- W3–4: legal review, employee consultation plan, DPIA, minimum-wage/deduction check.
- W5–6: minimal evidence workbench + one real connector; employee confirmation/appeal — **evidence API, employee page, confirmation/appeal done; CRM/ERP connector pending**.
- W7–8: first design-partner policy pack, independent spreadsheet/script reconciliation, shadow settlement — **pack, fixtures and CSV reconciliation done; shadow settlement with real orders pending**.
- W9–10: 20–50 person cycle; measure coverage, time, disputes, trust.
- W11–12: finance reconciliation, appeal drill, Go/No-Go.

See `docs/PRD_V4.1_评审修订版.md` §11 for Go/No-Go and kill criteria.

## References

- Full review: [`docs/REVIEW_2026-10-27.md`](docs/REVIEW_2026-10-27.md)
- Revised PRD: [`docs/PRD_V4.1_评审修订版.md`](docs/PRD_V4.1_评审修订版.md)
- Vertical packs: [`examples/verticals/`](examples/verticals/)
- First design-partner pack: [`examples/verticals/charging-equipment-sales/`](examples/verticals/charging-equipment-sales/)
- Domain contract: [`docs/domain-contract.md`](docs/domain-contract.md)
- ADRs: [`docs/adr/`](docs/adr/)
