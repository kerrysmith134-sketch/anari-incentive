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
| Contribution model | Work package → commitment snapshot → claim → attribution decision; claimant cannot adjudicate their own claim; commitment snapshots are versioned and queryable; commit/start/submit/accept/reject accept an optional `expectedVersion` for optimistic concurrency |
| Evaluation | Evaluation cycles; versioned rubrics; evidence-bound drafts (USER/AGENT/SYSTEM) with strengths, counter-evidence and uncertainty; submit → human decision; self-review blocked; approvals are versioned and supersede the prior decision; a policy can require approved decisions and derive participant weight multipliers from declared dimension weights and floor/ceiling |
| Policy engine | Deterministic decimal arithmetic, order-contribution pool, cap, largest-remainder allocation, trace, result hash; optional evaluation weighting from approved decisions |
| Policy packs | Core has no industry code. `examples/verticals/charging-equipment-sales/` is the first design-partner pack; `examples/verticals/professional-services/` is a conformance pack proving a materially different policy runs without core changes; `examples/verticals/charging-epc/` is a later extension. Each pack = policy data + fixtures + README. `npm run seed:packs` imports packs into PostgreSQL for a tenant (DRAFT by default, PUBLISHED with `APPROVED_BY`). |
| Agent runtime | `packages/agent-runtime`: proactive observe → find → plan → act → verify → escalate; T0/T1 auto-execute, T2/T3 require human approval; scheduler (schedule/event/threshold); policy proposal + impact simulation; evidence-bound evaluation drafts (no scores); persisted in-app notifications for evidence requests/owner/finance/escalations; idempotency, audit log, AI-off fallback; `POST /agent-tasks/scan` for sweeps |
| Durable agent state | `packages/agent-persistence` stores tasks, findings/actions/results, approvals and audit in PostgreSQL; API and worker rehydrate on first use and deduplicate on the original idempotency key |
| Agent retry | Worker retries failed tasks that executed no action; after 3 attempts they are marked dead-lettered. Tasks with an executed action are never retried automatically |
| Agent worker | `apps/worker`: polls the transactional outbox, dispatches domain events to agents, runs scheduled scans, and exposes graceful shutdown. |
| Policy simulation | `simulatePolicyChange` replays representative inputs through current vs proposed policy; returns per-person/total deltas and blockers. It never publishes or writes money. |
| Policy publication | `POST /policy-versions` writes a `PUBLISHED`, content-hashed, approver-attributed version; a successor closes the prior effective window and published content stays immutable. `POST /policy-versions/:id/rollback` republishes an earlier version as the next version of the same code, closing the current window while keeping prior versions immutable. Formal calculations still require the separate legal gate. |
| Independent reference | Separate `Number`-based reference calculation; mismatch is visible in tests |
| Evidence graph | EvidenceNode + EvidenceLink with source/provenance, quality status, supersedes, supporting/counter links; employee-submitted evidence records `submittedBy`, is readable only by that person (manager/finance see the tenant) and can only target their own person or work packages; API and PostgreSQL-backed |
| Data quality | Persistent issues with OPEN → ASSIGNED → IN_PROGRESS → RESOLVED/WAIVED_WITH_APPROVAL → REOPENED, optional remediation deadlines and an explicit ESCALATE command with reason/timestamp; waiver requires approver and reason; unresolved BLOCKING issues on a participant's work package block FORMAL calculations; the DATA_QUALITY agent persists findings as issues and escalates blocking ones |
| Ingestion + connectors | Generic event ingestion (`raw_events` → evidence nodes) with deduplication; CSV connector + CLI importer (`npm run import:csv`); generic paginated HTTP/JSON connector for CRM/ERP REST APIs |
| Platform onboarding | Platform-admin endpoints for tenants, users, tenant memberships, tenant persons (employees), org nodes, org assignments and reporting lines, plus caller identity resolution (user → person + roles); memory and PostgreSQL implementations |
| Auth | OIDC/JWT bearer authentication (`AUTH_MODE=oidc`) or development header authenticator (`AUTH_MODE=dev`); all `/api/v1` routes reject unauthenticated calls; sensitive commands require `admin`, `manager`, `finance` or `integration` roles; employees only see their own work packages, claims, runs, ledger entries, confirmations and appeals; the worker supports a static token or OAuth client-credentials token |
| Ledger | Append-only, idempotent, lock, linked reversal (`POST /ledger/:id/reverse`), linked locked adjustments (`POST /ledger/:id/adjustments`) with reason/approver evidence, per-tenant hash chain; PostgreSQL trigger prevents locked-row mutation |
| Batch operations | Work-package acceptance, attribution decisions and calculation runs accept up to 50 items with all-or-nothing rollback (memory and PostgreSQL) |
| Batch calculation | `POST /calculation-runs:batch` validates and creates up to 50 runs in one transaction; any blocked item rolls back all runs and ledger entries |
| Observability | Prometheus HTTP route/status and business-event metrics; per-request spans exported as OTLP/HTTP JSON to `OTEL_EXPORTER_OTLP_ENDPOINT`; `x-request-id` correlation header |
| Integrations | Connection registry (provider, credential reference, config, status), versioned CSV/HTTP field-mapping profiles with a single ACTIVE version per name, sync-run records with cursors/counts/error summary, external identity mapping by source/object, an idempotent webhook inbox with processed/failed states, a consumer inbox for worker-side idempotency, signed provider webhook intake (generic HMAC, HubSpot v1/v3, Feishu/Lark), client-credentials and refresh-token OAuth sources, and a Feishu tenant-token source (`packages/connectors`) |
| AI governance | AI suggestion logs (prompt/model/input hash, optional link to an ACTIVE registered prompt, validation status, one-time acceptance), model evaluation runs (metrics, subgroup metrics, pass/fail and blockers), a versioned prompt registry (DRAFT/ACTIVE/RETIRED) whose activation requires a passed evaluation for the same provider/model and at most one active version per prompt code, gated numeric score proposals with evidence citations and one-time human acceptance/rejection, and workflow-run records with finish lifecycle |
| Deliverables | Work-package deliverables (DRAFT → SUBMITTED → ACCEPTED/REJECTED) with artifact reference and version; acceptance records criteria results and comments; the owner cannot accept their own deliverable; rejected deliverables can be resubmitted as a new version |
| Policy governance | Rule change orders (DRAFT → APPROVED/REJECTED → PUBLICIZED, requester ≠ approver; a tenant can require a passing active test suite before approval), versioned policy test cases (ACTIVE/RETIRED) with an executable golden-case runner against the bound policy and persisted last-run evidence, a per-version suite runner with append-only run history, policy-notice links with audience, and versioned metric definitions with effective dates and retirement |
| Budgets | Draft → approved budget pools per cycle with decimal amounts; reserved allocations cannot exceed the approved pool; releasing an allocation restores the committed amount; cash-gate inputs record the reserve, forecast reference and pass/fail per cycle date; financial facts upsert by source key with quality status; `ENFORCE_BUDGET_POOLS=true` requires a pool and reserves the formal run total |
| Approvals | Approval requests with payload hash, risk tier, required approval count, idempotency key, expiry, separation of duties, per-approver decisions and one-time consumption; calculation approve/lock, settlement approve/lock, policy publication, legal-gate recording and ledger reversal/adjustment can consume a matching approved request; `REQUIRE_APPROVAL_FOR` or tenant settings make selected actions mandatory |
| Recalculation | Targeted recalculation requests (`EVIDENCE`/`ATTRIBUTION`/`EVALUATION`/`LEDGER`) with open → approved/rejected → completed lifecycle; completion records the new calculation run; targets are validated before recording |
| Settlement | Batch locked ledger entries by cycle; explicit RECONCILE/SUBMIT/APPROVE/LOCK/EXPORT/ACKNOWLEDGE/REQUIRE_ADJUSTMENT/CANCEL commands; verified line-to-ledger match; CSV export with employee code/name and spreadsheet-formula neutralisation; RECOVERY batches may be negative and require every affected person's SETTLEMENT confirmation before locking |
| Settlement evidence | Export evidence records the CSV hash and exporter; acknowledgement evidence records the external receipt and the same payload hash; one acknowledgement per export |
| Reporting | `GET /reports/cycle-readiness?cycleId=` aggregates calculation status, legal-gate and employee-confirmation blockers, settlement-batch progress and budget-pool approval for a cycle; `readyForSettlement` is true only when a non-reversed formal run exists and no blocker remains. `GET /reports/policy-readiness?policyVersionId=` aggregates the legal gate, active golden-case results, linked notice acknowledgement coverage, consultations and DPIA status; `ready` requires no legal-gate blocker, a passing run for every active test case, complete linked acknowledgement-required notices and no unapproved referenced DPIA. `GET /reports/operations-coverage` reports evidence coverage on accepted work packages, claim confirmation, deliverable, approval, data-quality and DSAR queues |
| Legal gate | Server-side `legal_gate_records`; `FORMAL` requires policy approval, minimum-wage check, democratic-procedure ref, employee-notice ref, DPIA ref; callers cannot self-assert a gate on the calculation request; referencing a notice id requires complete acknowledgement coverage, referencing a consultation id requires a concluded consultation for that policy version, and referencing a DPIA id requires an approved assessment |
| Employee notices | Published notices (policy/pay plan/AI use/data processing) with per-person acknowledgement or decline, coverage summary, and a legal-gate link that blocks formal work until required acknowledgements are complete |
| Policy consultation | Employee representation bodies (works council/union/representative/all employees) and policy-version consultations with type, minutes, feedback and outcome; a legal gate can reference a concluded consultation |
| Data protection | DPIA/PIPIA records with scope, risk/mitigation summaries and approval; a legal gate can reference an approved assessment; DSAR requests (access/correction/deletion/explanation/objection) are employee-scoped and resolved by admin; retention policies define months and legal hold per data category, with a report exposing cutoff dates and disposal eligibility |
| Employee confirmation | `VIEWED` / `CONFIRMED` / `OBJECTED`; a formal run cannot lock until every participant confirms; an objection blocks locking |
| Appeals | OPEN → TRIAGED → UNDER_REVIEW → DECIDED → RECALCULATION_REQUIRED/CLOSED; appellant cannot triage/resolve their own appeal |
| Persistence | In-memory store (default) and PostgreSQL `PgStore` with tenant-scoped transactions and RLS; the API resolves a store and agent runtime per authenticated tenant |
| AI gate | `packages/ai-gate`: evidence summary/gap detection and a transparent coverage-based numeric scorer; both refuse numeric scoring until a passed evaluation gate, and score proposals remain advisory until a human other than the requester accepts or rejects them |
| AI evaluation harness | Cohen's kappa, subgroup error gap, counterfactual stability, prompt-injection pass rate; returns a gate with blockers |
| Employee view | Minimal page at `/`: load a calculation, confirm/object, create an appeal, create/submit own contribution claims, submit/list own evidence, view/read own notifications, confirm/object to RECOVERY batches, view own approved evaluation decisions, acknowledge/decline employee notices, create/list own DSAR requests |
| Admin view | Minimal pages at `/admin` and `/admin/governance`: platform tenant/user/membership/person/org onboarding and tenant settings, work-package lifecycle, claims/attribution, policy simulation/publication/version list/diff/rollback, legal-gate recording and DPIA approval, employee notices with acknowledgement coverage, employee representation and policy consultation records, approval requests, budgets/cash gates with financial facts, policy change orders/test cases/metrics/notice links, deliverables, DSAR resolution, retention report, integrations/sync/identities/webhook and consumer inboxes, settlement export evidence, ledger adjustments, AI/model/workflow records, batch calculation/acceptance/attribution, agent scan/approval, settlement commands with CSV export, ledger reversal, audit list/verification, notification center, evaluation rubrics/drafts/decisions, data-quality workflow, appeal triage/review/resolution |
| Reconciliation | CSV expected amounts vs engine output; `npm run reconcile` exits non-zero on differences |
| API | Fastify + Zod, typed error envelope, explicit commands, security headers (nosniff, frame denial, CSP, no-store, referrer/permissions policy); OpenAPI 3.1 contract at [`docs/openapi.yaml`](docs/openapi.yaml) |
| Database | PostgreSQL 16 migrations: core schema, governance schema, money-path invariants, audit hash chain, RLS for core and governance tables; tenant queries set `app.tenant_id`, the platform pool uses `app.platform_admin` |
| Audit trail | Policy publication, legal gates, calculation locks, settlement commands and data-quality lifecycle append hash-chained `audit_events`; `GET /audit-events` and `/audit-events/verify` are role-gated |
| Observability | `/ready` checks the store; `/metrics` exposes dependency-free Prometheus counters, route-labelled latency and process gauges |
| CI | `scripts/ci.sh` runs install → typecheck → tests → compose validation → PostgreSQL integration tests |
| Tests | **194 unit/API tests + 37 PostgreSQL integration tests** covering platform onboarding, state transitions, work-package optimistic concurrency, commitment snapshots, atomic calculation/acceptance/attribution batches, self-adjudication block, deterministic results, reference/reconciliation match, legal gate, employee notices/acknowledgements, policy consultations/representation, DPIA approval, DSAR lifecycle, recalculation requests, retention policies/legal hold, approval requests/configurable enforcement (env and tenant settings), settlement export/acknowledgement evidence and CSV formula neutralisation, budget pools/allocations/cash gates and formal-run enforcement, policy governance, policy succession/rollback, policy test-case and suite execution, test-gated change approval, cycle/policy readiness and operations-coverage reporting, metric definitions, deliverable acceptance, AI suggestions/model evaluations/prompt registry/gated AI score proposals/workflow runs, integration connections/sync runs/versioned field mappings/identity maps/webhook and consumer inboxes, signed webhooks/HubSpot/Feishu schemes/OAuth and Feishu token sources, OTLP tracing with correlation attributes, API rate limiting, request body limits, ledger adjustments, tenant isolation and governance-table RLS, confirmations/objections, appeals, evidence links, ledger immutability/idempotency/reversal, settlement reconciliation/export/adjustment/recovery-confirmation, employee evidence scoping, in-app notifications, evaluation decisions/versioning and policy multipliers, agent evaluation drafts, data-quality lifecycle/SLA/escalation and formal-run blocking, policy publication/succession/diff, durable agent rehydration/retry, role authorization, readiness/metrics, AI gate metrics, auth, ingestion/connectors, governance UI, OpenAPI route coverage, and RLS |

## Operations

- **Migrations**: `npm run db:migrate` tracks each file in `schema_migrations` with a SHA-256 checksum. Applied files are skipped; a modified applied file fails. A database created before the runner existed needs a one-time manual baseline stamp; do not point the runner at an unstamped non-empty schema.
- **Seed**: `npm run db:seed` is idempotent and runs the SQL files under `db/seed/`.
- **Shutdown**: API and worker handle `SIGINT`/`SIGTERM`, close HTTP/DB resources and exit.
- **Health**: API `/health` + `/ready` on `3000`; worker `/health` + `/ready` on `3100`.
- **Logging**: set `LOG_LEVEL` (for example `info`) to enable Fastify request logs; unset keeps tests quiet. Every response carries `x-request-id` and the same value as `meta.correlation_id` in success bodies.
- **Approvals**: set `REQUIRE_APPROVAL_FOR` to a comma-separated list of action types (`POLICY_PUBLISH`, `LEGAL_GATE`, `CALCULATION_APPROVE`, `CALCULATION_LOCK`, `SETTLEMENT_APPROVE`, `SETTLEMENT_LOCK`, `LEDGER_REVERSAL`, `LEDGER_ADJUSTMENT`) to reject guarded commands that omit a matching approval. A tenant can set the same list in `POST /api/v1/platform/tenants/:id/settings` (`{"requiredApprovals":["..."]}`); env and tenant settings are both enforced. Set `requirePolicyTestsBeforeApproval: true` in tenant settings to run the target policy's ACTIVE test suite before a rule change order can be approved; an empty or failing suite blocks approval and is recorded in suite history.
- **Webhooks**: set `WEBHOOK_SECRET_<SOURCE>` (for example `WEBHOOK_SECRET_CRM`) to enable `POST /api/v1/webhooks/<source>`; the default scheme is generic HMAC over the raw body with `x-signature-256` and an optional `x-timestamp` enforced within 300 seconds. Set `WEBHOOK_SCHEME_<SOURCE>` to `hubspot` (v1/v3 headers) or `feishu` (Lark signature headers) for provider-specific verification.
- **Budgets**: set `ENFORCE_BUDGET_POOLS=true` to require an approved `budgetPoolId` on FORMAL calculation runs and reserve the run total against that pool; batch creation of formal runs is rejected while enforcement is on.
- **Rate limiting**: set `RATE_LIMIT_PER_MINUTE` to a positive integer to limit `/api/v1` requests per authenticated tenant/person (or user) with a fixed one-minute window; limited responses carry `Retry-After` and `x-ratelimit-*` headers. `/health`, `/ready` and `/metrics` are exempt. Multi-replica deployments should also enforce a shared limit at the gateway.
- **Request size**: set `BODY_LIMIT_BYTES` to cap request bodies (default 1 MiB); oversized requests return `413 PAYLOAD_TOO_LARGE` with the standard error envelope.
- **Metrics**: `/metrics` exposes HTTP route/status counters and `n_perform_business_events_total` for approvals, calculations, settlements, notices, DSARs, webhooks, inboxes, budgets, deliverables, recalculations, policy test runs/suites, model prompts, rate limits and ledger adjustments.
- **Tracing**: set `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) and optional `OTEL_EXPORTER_OTLP_HEADERS` (`key=value,...`) to export request spans as OTLP/HTTP JSON; spans carry tenant/person and, when present, cycle/policy correlation attributes, and are batched and flushed on shutdown.
- **Auth**: `AUTH_MODE=dev` trusts headers and is for local use only; set `AUTH_MODE=oidc` before exposing the API.

## What is intentionally not implemented yet

- AI scoring / Evaluation Agent (only evidence summary and gap detection are allowed until the evaluation gate passes);
- Autonomous T2/T3 actions (the runtime supports them, but high-impact actions always wait for a human);
- Production CRM/ERP/Feishu field mappings and sync schedules (generic CSV/HTTP connectors, ingestion, connection/sync registry, webhook inbox, HubSpot/Feishu signature verification and OAuth/Feishu token sources exist);
- Field-level policy for future sensitive fields (calculation lines/traces and order economics are redacted for employees; evidence reads are role-gated);
- Self-service tenant onboarding, billing and subscription management (platform-admin onboarding exists);
- Automated retention deletion (retention rules and a cutoff/eligibility report exist; disposal remains a controlled external operation);
- Equity/option ledger;
- Bounty marketplace, strategic/A-class pool automation;
- Full project management, HRIS, payroll;
- Full employee/admin UI (minimal pages exist at `/`, `/admin` and `/admin/governance`).

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
# In another terminal: full demo cycle through the API
npm run demo:cycle
```

`AUTH_MODE` defaults to `dev`, which accepts `X-Tenant-Id` / `X-User-Id`
headers. Set `AUTH_MODE=oidc` plus `OIDC_ISSUER` / `OIDC_AUDIENCE` /
`OIDC_JWKS_URI` to require a bearer JWT.

When the API uses OIDC, give the worker either `WORKER_TOKEN` (static) or
`OIDC_TOKEN_URL` + `OIDC_CLIENT_ID` + `OIDC_CLIENT_SECRET` (client
credentials, optional `OIDC_SCOPE` / `OIDC_AUDIENCE`). The worker's token
tenant claim must match `TENANT_ID`.

In dev mode with `STORE=postgres`, the default tenant is the seeded UUID
`00000000-0000-4000-8000-000000000001`; override it with
`DEFAULT_TENANT_ID`. The in-memory store defaults to `tenant-demo`.

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
cp .env.example .env   # optional; development defaults work
docker compose up --build
```

The `migrate` service applies checksum-tracked migrations and the demo seed, then exits. The `api` and `worker` services wait for it; both have `/health` and `/ready` checks. The `worker` polls `outbox_events`, dispatches domain events to the agent runtime, and runs scheduled scans.

### PostgreSQL-backed API (manual)

```bash
docker compose up -d postgres
export DATABASE_URL="postgres://anari:anari@localhost:5432/anari_incentive"
npm run db:migrate
npm run db:seed
# Optional: import example policy packs (DRAFT by default)
APPROVED_BY=00000000-0000-4000-8000-000000000003 npm run seed:packs
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
| GET | `/ready` | Readiness; checks the store (`503` on failure) |
| GET | `/metrics` | Prometheus text metrics |
| POST/GET | `/api/v1/platform/tenants` | Create/list tenants (platform admin) |
| POST | `/api/v1/platform/tenants/:id/settings` | Replace tenant settings (for example required approval actions) |
| POST/GET | `/api/v1/platform/users` | Create/list users (platform admin) |
| POST/GET | `/api/v1/platform/tenants/:id/memberships` | Add/list tenant memberships |
| POST/GET | `/api/v1/platform/tenants/:id/persons` | Create/list tenant persons (employees) |
| POST | `/api/v1/platform/tenants/:id/persons/:personId/link-user` | Link a person to a platform user |
| POST/GET | `/api/v1/platform/tenants/:id/org-nodes` | Create/list tenant org nodes |
| POST/GET | `/api/v1/platform/tenants/:id/persons/:personId/org-assignments` | Create/list person org assignments |
| POST | `/api/v1/platform/tenants/:id/persons/:personId/manager` | Set or clear a person's manager |
| GET | `/api/v1/platform/identity` | Resolve the caller's person and tenant roles |
| POST | `/api/v1/ingestion/events:batch` | Ingest connector events; dedup + evidence projection |
| POST | `/api/v1/evidence` | Create evidence node |
| GET | `/api/v1/evidence?subjectType=&subjectId=` | List evidence for a subject |
| POST | `/api/v1/evidence/:id/links` | Link supporting/counter/dependency evidence |
| GET | `/api/v1/evidence/:id/links` | List evidence links |
| POST/GET | `/api/v1/data-quality-issues` | Create/list data-quality issues |
| GET | `/api/v1/data-quality-issues/:id` | Get an issue |
| POST | `/api/v1/data-quality-issues/:id/commands` | ASSIGN / START / RESOLVE / WAIVE / REOPEN |
| POST | `/api/v1/work-packages` | Create work package (DRAFT) |
| GET | `/api/v1/work-packages` | List |
| GET | `/api/v1/work-packages/:id` | Get |
| GET | `/api/v1/work-packages/:id/versions` | List commitment snapshots |
| POST | `/api/v1/work-packages/:id/commit` | Freeze commitment snapshot (expectedVersion) |
| POST | `/api/v1/work-packages/:id/start` | COMMITTED → IN_PROGRESS |
| POST | `/api/v1/work-packages/:id/submit` | IN_PROGRESS → SUBMITTED |
| POST | `/api/v1/work-packages/:id/accept` | SUBMITTED → ACCEPTED (reviewer ≠ owner) |
| POST | `/api/v1/work-packages:accept-batch` | Accept up to 50 submitted packages atomically |
| POST | `/api/v1/work-packages/:id/reject` | SUBMITTED → REJECTED (reviewer ≠ owner) |
| POST | `/api/v1/contribution-claims` | Create claim (requires ACCEPTED work package) |
| GET | `/api/v1/contribution-claims` / `/:id` | List/get claims |
| POST | `/api/v1/contribution-claims/:id/submit` | DRAFT → SUBMITTED |
| POST | `/api/v1/attribution-decisions` | Formal decision; claimant cannot be adjudicator |
| POST | `/api/v1/attribution-decisions:batch` | Up to 50 attribution decisions atomically |
| GET | `/api/v1/attribution-decisions?claimId=` | List decisions |
| POST/GET | `/api/v1/evaluation-cycles` | Create/list evaluation cycles |
| GET | `/api/v1/evaluation-cycles/:id` | Get a cycle |
| POST/GET | `/api/v1/rubrics` | Create/list rubric versions |
| POST/GET | `/api/v1/evaluation-drafts` | Create/list evidence-bound drafts; employees see their own |
| GET | `/api/v1/evaluation-drafts/:id` | Get a draft |
| POST | `/api/v1/evaluation-drafts/:id/submit` | DRAFT → SUBMITTED |
| POST | `/api/v1/evaluation-drafts/:id/decision` | Human APPROVE/REJECT; approval creates a versioned decision |
| GET | `/api/v1/evaluation-decisions` / `/:id` | List/get decisions (employees see their own) |
| POST | `/api/v1/policy-versions/:id/legal-gate` | Record server-side legal gate (optionally with `employeeNoticeId`) |
| GET | `/api/v1/policy-versions/:id/legal-gate` | Read legal gate |
| POST/GET | `/api/v1/notices` | Publish/list employee notices |
| GET | `/api/v1/notices/:id` | Read an employee notice |
| POST/GET | `/api/v1/notices/:id/acknowledgements` | Record an acknowledgement/decline; read coverage summary and rows |
| POST/GET | `/api/v1/employee-representations` | Create/list employee representation bodies |
| POST/GET | `/api/v1/policy-consultations` | Record/list policy consultations; filter by `policyVersionId` |
| GET | `/api/v1/policy-consultations/:id` | Read a consultation |
| POST | `/api/v1/policy-consultations/:id/conclude` | Conclude a consultation with an outcome |
| POST/GET | `/api/v1/dpia-records` | Create/list DPIA/PIPIA assessments |
| GET | `/api/v1/dpia-records/:id` | Read a DPIA/PIPIA assessment |
| POST | `/api/v1/dpia-records/:id/approve` | Approve a DPIA/PIPIA assessment |
| POST/GET | `/api/v1/dsar-requests` | Create/list data-subject requests (employees see their own) |
| GET | `/api/v1/dsar-requests/:id` | Read a data-subject request (employees see their own) |
| POST | `/api/v1/dsar-requests/:id/resolve` | Resolve/reject a data-subject request |
| POST/GET | `/api/v1/recalculation-requests` | Create/list recalculation requests (filter by status/target) |
| GET | `/api/v1/recalculation-requests/:id` | Read a recalculation request |
| POST | `/api/v1/recalculation-requests/:id/approve` | Approve a recalculation request |
| POST | `/api/v1/recalculation-requests/:id/reject` | Reject a recalculation request |
| POST | `/api/v1/recalculation-requests/:id/complete` | Complete with a new calculation run |
| POST/GET | `/api/v1/retention-policies` | Create/list data-retention policies |
| GET | `/api/v1/retention-policies/report` | Retention cutoff and disposal-eligibility report |
| POST | `/api/v1/retention-policies/:id/legal-hold` | Set/clear a legal hold |
| POST/GET | `/api/v1/approval-requests` | Create/list approval requests |
| GET | `/api/v1/approval-requests/:id` | Read an approval request |
| GET | `/api/v1/approval-requests/:id/decisions` | List approval decisions |
| POST | `/api/v1/approval-requests/:id/decide` | Approve or reject with payload hash |
| POST | `/api/v1/approval-requests/:id/consume` | Mark an approved request consumed |
| POST | `/api/v1/settlement-batches/:id/exports` | Record export evidence with the CSV hash |
| GET | `/api/v1/settlement-exports?batchId=` | List export evidence |
| GET | `/api/v1/settlement-exports/:id` | Read export evidence |
| POST | `/api/v1/settlement-exports/:id/acknowledge` | Record the external receipt |
| POST/GET | `/api/v1/budget-pools` | Create/list budget pools |
| GET | `/api/v1/budget-pools/:id` | Read a pool with allocations |
| POST | `/api/v1/budget-pools/:id/approve` | Approve a draft pool |
| POST/GET | `/api/v1/budget-pools/:id/allocations` | Reserve/list pool allocations |
| POST | `/api/v1/budget-allocations/:id/release` | Release a reserved allocation |
| POST/GET | `/api/v1/cash-gate-inputs` | Record/list cash-gate inputs |
| POST/GET | `/api/v1/financial-facts` | Ingest/list financial facts (upsert by source key) |
| POST/GET | `/api/v1/rule-change-orders` | Create/list rule change orders |
| GET | `/api/v1/rule-change-orders/:id` | Read a rule change order |
| POST | `/api/v1/rule-change-orders/:id/approve` / `reject` / `publicize` | Advance the change order |
| POST/GET | `/api/v1/policy-test-cases` | Create/list policy test cases |
| POST | `/api/v1/policy-test-cases/:id/retire` | Retire a test case |
| POST/GET | `/api/v1/policy-notices` | Link/list policy notices |
| POST/GET | `/api/v1/metric-definitions` | Create/list metric definitions |
| POST | `/api/v1/metric-definitions/:id/retire` | Retire a metric definition |
| POST/GET | `/api/v1/work-packages/:id/deliverables` | Create/list deliverables |
| POST | `/api/v1/deliverables/:id/submit` | Submit a deliverable |
| POST | `/api/v1/deliverables/:id/acceptance` | Record acceptance/rejection |
| GET | `/api/v1/deliverables/:id/acceptances` | List acceptance evidence |
| POST/GET | `/api/v1/ai-suggestion-logs` | Record/list AI suggestions |
| POST | `/api/v1/ai-suggestion-logs/:id/accept` | Accept a suggestion once |
| POST/GET | `/api/v1/model-evaluation-runs` | Record/list model evaluations |
| GET | `/api/v1/model-evaluation-runs/:id` | Read a model evaluation |
| POST/GET | `/api/v1/workflow-runs` | Record/list workflow runs |
| POST | `/api/v1/workflow-runs/:id/finish` | Finish a workflow run |
| POST/GET | `/api/v1/integration-connections` | Create/list integration connections |
| GET | `/api/v1/integration-connections/:id` | Read a connection |
| POST | `/api/v1/integration-connections/:id/status` | Set connection status |
| POST/GET | `/api/v1/integration-connections/:id/sync-runs` | Create/list sync runs |
| POST | `/api/v1/sync-runs/:id/finish` | Finish a sync run |
| POST/GET | `/api/v1/external-identities` | Upsert/list external identity mappings |
| POST/GET | `/api/v1/webhook-inbox` | Receive/list webhook inbox messages |
| POST | `/api/v1/webhook-inbox/:id/process` | Mark a webhook processed/failed |
| POST | `/api/v1/webhooks/:source` | Verify an HMAC-signed provider webhook and store it in the inbox |
| POST | `/api/v1/ledger/:id/adjustments` | Append a locked adjustment linked to an entry |
| GET | `/api/v1/adjustment-records` | List adjustment records |
| POST/GET | `/api/v1/inbox-messages` | Receive/list consumer inbox messages |
| POST | `/api/v1/inbox-messages/:id/process` | Mark a consumer message processed |
| POST | `/api/v1/calculation-runs` | SHADOW/FORMAL calculation |
| POST | `/api/v1/calculation-runs:batch` | Up to 50 calculation runs in one atomic transaction |
| GET | `/api/v1/calculation-runs` / `/:id` | List/get |
| POST | `/api/v1/calculation-runs/:id/approve` | CALCULATED → APPROVED |
| POST | `/api/v1/calculation-runs/:id/lock` | APPROVED → LOCKED; locks ledger entries; formal runs require confirmations |
| POST | `/api/v1/employee-confirmations` | VIEWED / CONFIRMED / OBJECTED |
| GET | `/api/v1/employee-confirmations?personId=` | List confirmations |
| GET/POST | `/api/v1/notifications` | List own notifications; create (manager/integration) |
| POST | `/api/v1/notifications/:id/read` | Mark a notification read |
| GET | `/api/v1/ledger` | List ledger |
| GET | `/api/v1/ledger/verify` | Verify hash chain |
| POST | `/api/v1/ledger/:id/reverse` | Append a locked linked reversal (finance) |
| GET | `/api/v1/audit-events?limit=` | Hash-chained audit events (manager/finance) |
| GET | `/api/v1/audit-events/verify` | Recompute the tenant audit chain |
| POST | `/api/v1/settlement-batches` | Batch unbatched locked ledger entries; `kind=RECOVERY` allows a negative net total |
| GET | `/api/v1/settlement-batches` / `/:id` | List/get batches with lines |
| POST | `/api/v1/settlement-batches/:id/commands` | RECONCILE / SUBMIT / APPROVE / LOCK / EXPORT / ACKNOWLEDGE / REQUIRE_ADJUSTMENT / CANCEL; EXPORT returns CSV |
| POST | `/api/v1/appeals` | Open appeal |
| GET | `/api/v1/appeals` / `/:id` | List/get |
| POST | `/api/v1/appeals/:id/triage` | OPEN → TRIAGED; assign reviewer |
| POST | `/api/v1/appeals/:id/review` | TRIAGED → UNDER_REVIEW |
| POST | `/api/v1/appeals/:id/resolve` | UNDER_REVIEW → DECIDED → CLOSED/RECALCULATION_REQUIRED |
| POST | `/api/v1/agent-tasks` | Enqueue a proactive agent task |
| POST | `/api/v1/agent-tasks/scan` | Run a proactive scan: evidence gaps, anomalies, settlement readiness |
| GET | `/api/v1/policy-versions` | List policy versions, status and effective windows |
| GET | `/api/v1/policy-versions/:id/diff?against=` | Structural policy diff |
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
packages/agent-persistence/ PostgreSQL task/audit repository for the runtime
packages/auth/            OIDC/JWT, dev-header and client-credentials auth
packages/connectors/      Connector interface + CSV connector
examples/verticals/       Tenant policy packs (charging equipment sales, professional services, EPC)
fixtures/                 Generic reference policy, order fixtures, reconciliation CSV, connector fixtures
db/migrations/            PostgreSQL schema and money-path invariants
db/seed/                  Demo tenant/people/cycle/policy + RLS app role
scripts/migrate.ts        Checksum-tracked SQL migration runner
scripts/seed.ts           Idempotent SQL seed runner
scripts/test-pg.sh        Disposable PostgreSQL integration test runner
scripts/ci.sh             Install → typecheck → tests → compose → PostgreSQL
scripts/reconcile.ts     CSV vs engine reconciliation
scripts/agent-scan.ts    Cron/on-demand proactive agent scan
scripts/import-csv.ts    CSV connector importer
scripts/seed-policy-packs.ts  Import examples/verticals packs into PostgreSQL
scripts/demo-cycle.ts    End-to-end API demo: package → claim → run → settlement → evaluation → DQ → appeal
Dockerfile                API/worker image
docker-compose.yml        postgres + migrate + api + worker with healthchecks
.env.example              Compose/auth/worker environment template
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
- Governance store and approval consumption: [`docs/adr/ADR-005-platform-governance-store.md`](docs/adr/ADR-005-platform-governance-store.md)
- Policy test governance, readiness reports and model prompts: [`docs/adr/ADR-006-assurance-reports-and-model-prompts.md`](docs/adr/ADR-006-assurance-reports-and-model-prompts.md)
