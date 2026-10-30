# Domain Contract V0.1

**Source of truth**: `packages/domain/src/states.ts` (state names/transitions) and `packages/domain/src/types.ts` (objects).  
**Database**: `db/migrations/001_core_schema.sql` enums mirror these names.  
**API**: explicit commands only; no generic `PATCH { status }`.

---

## 1. State machines

### WorkPackage

```
DRAFT -> COMMITTED -> IN_PROGRESS -> SUBMITTED -> ACCEPTED
                         |              |
                         v              v
                       BLOCKED        REJECTED -> REOPENED -> IN_PROGRESS
DRAFT/COMMITTED/IN_PROGRESS/BLOCKED -> CANCELLED
```

Rules:
- `COMMITTED` freezes a `CommitmentSnapshot`; later edits require a new version.
- The owner cannot accept or reject their own delivery.
- `ACCEPTED` is terminal for the package; `REOPENED` is a new cycle.

### ContributionClaim

```
DRAFT -> SUBMITTED -> UNDER_REVIEW -> ACCEPTED / PARTIALLY_ACCEPTED / REJECTED
  |         |  \-> NEEDS_EVIDENCE -> SUBMITTED
  v         v
WITHDRAWN  WITHDRAWN
ACCEPTED/PARTIALLY_ACCEPTED/REJECTED -> APPEALED -> UNDER_REVIEW
```

Rules:
- A claim is not an attribution decision.
- A claim cannot be created before the work package is ACCEPTED.
- The claimant cannot be the adjudicator.

### AttributionDecision

```
DRAFT -> UNDER_REVIEW -> CONFIRMED / PARTIALLY_CONFIRMED / REJECTED
                                   |               |
                                   +-> APPEALED <--+
                                   +-> SUPERSEDED
```

Rules:
- Decisions are versioned per claim; a new decision supersedes the prior one.
- Formal decisions require a human adjudicator distinct from the claimant.

### EvaluationDraft

```
DRAFT -> SUBMITTED -> APPROVED / REJECTED
```

Rules:
- A draft is evidence-bound input, never a decision.
- Only a human reviewer can approve or reject; the reviewer must not be the evaluated person.
- Approval creates an `EvaluationDecision` versioned per cycle/person and supersedes the prior approved decision.
- An approval requires a rubric version and a score for every rubric dimension.

### CalculationRun

```
CREATED -> RUNNING -> CALCULATED -> RECONCILIATION_REQUIRED -> CALCULATED
                    |            \-> APPROVED -> LOCKED -> REVERSED
                    v
                 BLOCKED / NEEDS_REVIEW -> RUNNING
```

Rules:
- `FORMAL` requires a complete legal gate and confirmed attribution for every participant.
- `SHADOW` produces no ledger entries and has no payment effect.
- Locking locks the run's ledger entries; a locked run cannot be edited.

### SettlementBatch

```
DRAFT -> RECONCILING -> PENDING_APPROVAL -> APPROVED -> LOCKED -> EXPORTED -> ACKNOWLEDGED
             |                |
             v                v
       ADJUSTMENT_REQUIRED  CANCELLED
```

Rules:
- A batch contains only `LOCKED` ledger entries.
- An active ledger entry can appear in at most one settlement batch.
- Totals are recomputed from active lines; exports carry a hash and acknowledgement.

### AppealCase

```
OPEN -> TRIAGED -> UNDER_REVIEW -> DECIDED -> RECALCULATION_REQUIRED -> CLOSED
                                      \-> CLOSED
```

Rules:
- The reviewer cannot be the original decision-maker.
- The original decision and ledger history are preserved.
- A changed outcome creates a new decision/calculation; it does not overwrite history.
- A `CHANGE` resolution leaves the appeal at `RECALCULATION_REQUIRED`; a recalculation request records the approved target and the resulting calculation run (`OPEN → APPROVED/REJECTED → COMPLETED`).

### DataQualityIssue

```
OPEN -> ASSIGNED -> IN_PROGRESS -> RESOLVED -> REOPENED -> ASSIGNED
  |         |              \-> WAIVED_WITH_APPROVAL -> REOPENED
  +-> RESOLVED / WAIVED_WITH_APPROVAL
```

Rules:
- `BLOCKING` issues prevent formal calculation.
- Waivers require an approver and a reason.
- Resolution/reopening is audited.

---

## 2. Money-path invariants

| ID | Invariant | Where enforced |
|---|---|---|
| MON-01 | Approval is consumed once; payload hash changes invalidate approval | `approval_requests` + `approval_decisions`; `trg_approval_consumption` |
| MON-02 | Settlement line references a `LOCKED` ledger entry and matches person/amount/currency | `trg_settlement_line_ledger` |
| MON-03 | One active settlement per ledger entry | `uq_settlement_active_ledger` |
| MON-04 | Calculation line is unique per run/person/incentive/line key | `uq_calculation_lines` |
| MON-05 | Ledger entry is unique per calculation line/entry type | `uq_ledger_calculation_line` |
| MON-06 | Locked ledger entries cannot be updated/deleted | `trg_amount_ledger_immutable` |
| MON-07 | Audit is append-only and hash-chained | `trg_audit_immutable`, `trg_audit_chain` |
| MON-08 | Calculation input is stored and replayable | `calculation_runs.input_snapshot` + hash |

Additional application-level invariants:
- `calculateOrderContribution` is deterministic and checks that rounded lines sum to the rounded pool.
- Same input + policy + engine version produces the same `resultHash`.
- The independent reference calculation must agree with the main calculation.
- The ledger hash chain is verified after every mutation in tests.
- PostgreSQL ledger verification orders by the monotonic `ledger_seq`, not `created_at`, because entries created in one transaction share a timestamp.
- `policy_versions` publication, `legal_gate_records`, calculation locking, settlement commands and data-quality issue creation/commands insert `audit_events`; the `trg_audit_chain` trigger assigns the per-tenant sequence and hash so callers cannot forge the chain. `GET /audit-events` exposes the newest events to manager/finance/admin; `GET /audit-events/verify` recomputes each hash and checks sequence/prev-hash continuity.

---

## 3. API command surface (first slice)

| Command | Preconditions | Effects |
|---|---|---|
| `POST /platform/tenants` | platform_admin | Creates an ACTIVE tenant |
| `POST /platform/tenants/:id/settings` | platform_admin | Replaces tenant settings; `requiredApprovals` makes listed action types mandatory |
| `POST /platform/users` | platform_admin | Creates a platform user |
| `POST /platform/tenants/:id/memberships` | platform_admin, tenant/user exist | Upserts ACTIVE membership with role codes |
| `POST /platform/tenants/:id/persons` | platform_admin, tenant exists | Creates a person; employee code unique per tenant, optional `userId` link |
| `POST /platform/tenants/:id/persons/:personId/link-user` | platform_admin, person/user exist | Links a person to a user; one user maps to at most one person per tenant |
| `POST /platform/tenants/:id/org-nodes` | platform_admin, tenant and parent exist | Creates an org node; `path` is derived from the parent chain |
| `POST /platform/tenants/:id/persons/:personId/org-assignments` | platform_admin, person/node exist | Appends a dated org assignment; allocation is 0–1, `validTo` ≥ `validFrom` |
| `POST /platform/tenants/:id/persons/:personId/manager` | platform_admin, person/manager exist | Sets or clears the manager; self and cycles are rejected |
| `GET /platform/identity` | authenticated | Resolves the caller's `userId`, linked `personId` and membership role codes |
| `POST /work-packages` | — | Creates DRAFT |
| `POST /work-packages/:id/commit` | DRAFT, expectedVersion | Freezes snapshot, COMMITTED |
| `GET /work-packages/:id/versions` | owner/member or manager/finance | Lists immutable commitment snapshots |
| `POST /work-packages/:id/start` | COMMITTED, optional expectedVersion | IN_PROGRESS |
| `POST /work-packages/:id/submit` | IN_PROGRESS, optional expectedVersion | SUBMITTED |
| `POST /work-packages/:id/accept` | SUBMITTED, reviewer ≠ owner, optional expectedVersion | ACCEPTED |
| `POST /work-packages:accept-batch` | 1–50 submitted packages, each reviewer ≠ owner | All-or-nothing ACCEPTED |
| `POST /work-packages/:id/reject` | SUBMITTED, reviewer ≠ owner, optional expectedVersion | REJECTED |
| `POST /contribution-claims` | WorkPackage ACCEPTED + snapshot | DRAFT claim |
| `POST /contribution-claims/:id/submit` | DRAFT | SUBMITTED |
| `POST /attribution-decisions` | Claim SUBMITTED/UNDER_REVIEW, adjudicator ≠ claimant | Decision + claim status |
| `POST /attribution-decisions:batch` | 1–50 claims, same per-item rules | All-or-nothing decisions and claim status updates |
| `POST /evaluation-cycles` | admin, end > start | Creates a DRAFT cycle |
| `POST /rubrics` | admin | Creates a versioned rubric |
| `POST /evaluation-drafts` | cycle/person exist; manager | Evidence-bound DRAFT |
| `POST /evaluation-drafts/:id/submit` | DRAFT | SUBMITTED |
| `POST /evaluation-drafts/:id/decision` | SUBMITTED, reviewer ≠ person, rubric scores complete | APPROVED + versioned decision, or REJECTED |
| `POST /calculation-runs` | Policy exists; FORMAL requires legal gate + confirmed attribution; a policy with `evaluation` requires approved, matching decisions; with `ENFORCE_BUDGET_POOLS`, FORMAL also requires an approved pool with headroom | CALCULATED; FORMAL writes ledger and reserves the run total against the pool |
| `POST /calculation-runs:batch` | 1–50 runs, same per-run rules; formal batches rejected while `ENFORCE_BUDGET_POOLS` is on | All-or-nothing in one transaction; any blocked item rolls back runs and ledger |
| `POST /calculation-runs/:id/approve` | CALCULATED; optional approval | APPROVED; a matching approved `CALCULATION_APPROVE` request is consumed |
| `POST /calculation-runs/:id/lock` | APPROVED, confirmation, all FORMAL participants confirmed; optional approval | LOCKED; locks ledger; a matching approved `CALCULATION_LOCK` request is consumed |
| `POST /policy-versions/:id/legal-gate` | server-side gate record; optional approval | Records policy approval/minimum-wage/democratic-procedure/notice/DPIA refs; a matching approved `LEGAL_GATE` request is consumed |
| `POST /notices` | admin, policy version exists if supplied | Publishes an employee notice |
| `POST /notices/:id/acknowledgements` | notice/person exist; employees only for themselves | Upserts ACKNOWLEDGE or DECLINE (decline reason required) |
| `GET /notices/:id/acknowledgements` | manager/finance/admin | Returns the coverage summary and acknowledgement rows |
| `POST /employee-representations` | admin | Creates an ACTIVE representation body |
| `POST /policy-consultations` | admin, policy version exists | Records a consultation; outcome defaults to `PENDING` |
| `POST /policy-consultations/:id/conclude` | admin, consultation is `PENDING` | Sets `endedAt`, outcome, minutes and feedback; re-conclusion is rejected |
| `POST /dpia-records` | admin | Creates a DRAFT DPIA/PIPIA with scope and risk/mitigation summaries |
| `POST /dpia-records/:id/approve` | admin, approver exists, not already approved | Marks the assessment APPROVED with approver and timestamp |
| `POST /dsar-requests` | authenticated; employees only for themselves | Creates an OPEN DSAR with type and optional due date |
| `POST /dsar-requests/:id/resolve` | admin, DSAR is OPEN | Sets RESOLVED/REJECTED with a resolution reference and timestamp; re-resolution is rejected |
| `POST /retention-policies` | admin, category unique per tenant | Creates a retention rule with months, legal basis and legal hold |
| `POST /retention-policies/:id/legal-hold` | admin, policy exists | Sets or clears the legal hold |
| `GET /retention-policies/report` | manager/finance | Returns cutoff dates and disposal eligibility; legal holds are never eligible |
| `POST /approval-requests` | manager/finance; idempotency key | Creates PENDING with payload hash, risk tier and required approvals; replay with a different payload conflicts |
| `POST /approval-requests/:id/decide` | PENDING, hash matches, approver ≠ requester | Records one decision per approver; APPROVE increments, REJECT finalizes; expiry blocks decisions |
| `POST /approval-requests/:id/consume` | APPROVED, not consumed | Marks consumed once with the consuming person |

Approval consumption is checked before the guarded action: the action type (`CALCULATION_APPROVE`, `CALCULATION_LOCK`, `SETTLEMENT_APPROVE`, `SETTLEMENT_LOCK`, `POLICY_PUBLISH`, `LEGAL_GATE`, `LEDGER_REVERSAL`, `LEDGER_ADJUSTMENT`), target type/id and APPROVED status must match, and the approval is consumed with the last approver. A failed action therefore burns the approval and requires a new request. `REQUIRE_APPROVAL_FOR` and tenant settings `requiredApprovals` make selected action types mandatory; an unapproved guarded command then fails with `APPROVAL_REQUIRED`.
| `POST /settlement-batches/:id/exports` | finance, batch EXPORTED/ACKNOWLEDGED/ADJUSTMENT_REQUIRED | Records the export reference and SHA-256 of the CSV |
| `POST /settlement-exports/:id/acknowledge` | finance, export not acknowledged | Records the external receipt with the export payload hash; repeat acknowledgement conflicts |
| `POST /budget-pools` | finance, cycle exists | Creates a DRAFT pool with a decimal approved amount |
| `POST /budget-pools/:id/approve` | finance, DRAFT | APPROVED; allocations become allowed |
| `POST /budget-pools/:id/allocations` | finance, pool APPROVED, committed + amount ≤ approved | Reserves an allocation and increments committed |
| `POST /budget-allocations/:id/release` | finance, allocation RESERVED | RELEASED and the committed amount is restored |
| `POST /cash-gate-inputs` | finance, cycle exists, unique cycle/date | Records reserve months, forecast reference and pass/fail |
| `POST /financial-facts` | finance, tenant exists | Upserts by `(sourceSystem, sourceRecordId, factType)` with a quality status |
| `POST /rule-change-orders` | admin, target policy version exists | Creates a DRAFT order with impact simulation |
| `POST /rule-change-orders/:id/approve\|reject` | admin, DRAFT, requester ≠ approver; when tenant `requirePolicyTestsBeforeApproval` is true, approval runs the target policy's ACTIVE suite and rejects an empty or failing suite | Sets APPROVED or REJECTED with approver and timestamp |
| `POST /rule-change-orders/:id/publicize` | admin, APPROVED | Sets PUBLICIZED and `publicizedAt` |
| `POST /policy-test-cases` | admin, policy exists, case code unique per version | Creates an ACTIVE test case |
| `POST /policy-test-cases/:id/retire` | admin, ACTIVE | Sets RETIRED |
| `POST /policy-test-cases/:id/run` | manager/finance, case and policy exist | Runs the stored calculation request against the case's policy; compares any `pool`, `poolRounded`, `resultHash` or `lines` expectations, reports differences, unsupported keys and policy-gate blockers, and records the last run |
| `POST /policy-versions/:id/test-runs` | manager/finance, policy exists | Runs every ACTIVE test case bound to the version and records each last run plus an append-only suite run; an empty or failing suite is not passed, retired cases are counted but not executed |
| `GET /policy-versions/:id/test-runs` | manager/finance, policy exists | Returns suite run history newest first |
| `POST /policy-notices` | admin, policy and notice exist, unique link | Links a notice to a policy version with an audience |
| `POST /metric-definitions` | admin, code+version unique | Creates an ACTIVE versioned metric with effective dates |
| `POST /metric-definitions/:id/retire` | admin, ACTIVE | Sets the metric inactive |
| `POST /work-packages/:id/deliverables` | manager/finance, package and owner exist | Creates a DRAFT deliverable (version 1) |
| `POST /deliverables/:id/submit` | manager/finance, DRAFT or REJECTED | SUBMITTED with artifact reference; a rejected deliverable becomes a new version |
| `POST /deliverables/:id/acceptance` | manager/finance, SUBMITTED, reviewer ≠ owner | Records acceptance evidence and sets ACCEPTED or REJECTED |
| `POST /ai-suggestion-logs` | manager/finance, agent task exists | Records prompt/model/input hash, output and validation status; an optional `modelPromptId` must be ACTIVE and its provider/model must match |
| `POST /ai-suggestion-logs/:id/accept` | not already accepted, person exists | Records one-time human acceptance |
| `POST /model-evaluation-runs` | manager/finance | Records metrics, subgroup metrics, pass/fail and blockers |
| `POST /model-prompts` | admin | Creates a DRAFT versioned prompt with a template hash |
| `POST /model-prompts/:id/activate` | admin, DRAFT, passed evaluation for the same provider/model, no other ACTIVE version of the code | Sets ACTIVE, links the evaluation and records `activatedAt` |
| `POST /model-prompts/:id/retire` | admin, ACTIVE | Sets RETIRED and records `retiredAt` |
| `POST /ai-score-proposals` | manager/finance, person exists, passed model evaluation, optional ACTIVE matching prompt | Computes transparent evidence-coverage scores and records a PENDING proposal with citations, snapshot hash and gate metrics |
| `POST /ai-score-proposals/:id/decide` | manager/finance, PENDING, decidedBy ≠ requestedBy | Accepts or rejects the proposal once; records decider, note and timestamp |
| `POST /workflow-runs` | manager/finance, agent task exists | Records a workflow run with state |
| `POST /workflow-runs/:id/finish` | manager/finance, not finished | Sets status, current step and `finishedAt` |
| `POST /integration-connections` | admin | Creates an ACTIVE connection with a credential reference |
| `POST /integration-connections/:id/mappings` | admin, connection exists, no ACTIVE mapping with the same name | Creates an ACTIVE versioned CSV/HTTP field mapping |
| `POST /integration-mappings/:id/retire` | admin, ACTIVE | Sets RETIRED and records `retiredAt` |
| `POST /integration-connections/:id/schedules` | admin, connection exists, unique name per connection | Creates an enabled interval schedule |
| `GET /sync-schedules` | admin/integration | Lists schedules by next run time |
| `POST /sync-schedules/claim-due` | integration | Atomically claims due enabled schedules, sets `lastRunAt` and advances `nextRunAt`; the runner creates the sync run |
| `POST /sync-schedules/:id/status` | admin | Enables or disables a schedule |
| `POST /equity-grants` | admin, person exists, unique grant code, positive units, cliff ≤ vesting | Creates an ACTIVE grant with a versioned vesting schedule |
| `GET /equity-grants/:id/vesting` | manager/finance, optional `asOf` | Computes vested/unvested/reserved/available units and the next vest date |
| `POST /equity-grants/:id/exercises` | manager/finance, ACTIVE grant, units ≤ available | Creates a PENDING exercise and computes cost from the strike price |
| `POST /equity-exercises/:id/approve` | admin, PENDING, requester ≠ approver | Sets APPROVED with approver and timestamp |
| `POST /equity-exercises/:id/settle` | finance, APPROVED | Sets SETTLED and marks the grant EXHAUSTED when all units are exercised |
| `POST /bounties` | manager/finance, creator exists, positive reward | Creates an OPEN bounty |
| `POST /bounties/:id/claim` | manager/finance, OPEN, person exists | Sets CLAIMED and records the assignee |
| `POST /bounties/:id/submit` | manager/finance, CLAIMED, caller is assignee | Sets SUBMITTED with a submission reference |
| `POST /bounties/:id/accept` | manager/finance, SUBMITTED, reviewer ≠ assignee | Sets ACCEPTED with reviewer, timestamp and optional payment reference |
| `POST /bounties/:id/cancel` | admin, not ACCEPTED/CANCELLED | Sets CANCELLED |
| `POST /integration-connections/:id/sync-runs` | manager/finance, connection exists | Creates a sync run (QUEUED or RUNNING) |
| `POST /sync-runs/:id/finish` | manager/finance, not finished | Records counts, cursors, error and connection `lastSyncAt` |
| `POST /external-identities` | manager/finance, person exists if supplied | Upserts by source/external id/object type |
| `POST /webhook-inbox` | integration | Idempotent receive by source and message id |
| `POST /webhook-inbox/:id/process` | integration, unprocessed | Marks PROCESSED/FAILED once with an optional error code |
| `POST /webhooks/:source` | integration, source secret configured | Verifies the source scheme (generic HMAC, HubSpot v1/v3, Feishu) over the raw body and records the inbox message idempotently |
| `POST /ingestion/events:batch` | connector event has source record id + event version | Deduplicates per source, stores `raw_events`, projects evidence nodes |
| `POST /evidence` | — | Creates an evidence node with provenance and quality status |
| `GET /evidence?subjectType=&subjectId=` | — | Lists evidence for a subject |
| `POST /evidence/:id/links` | both evidence nodes exist | SUPPORTS / CONTRADICTS / DEPENDS_ON / CORRECTS / CONTEXT |
| `POST /data-quality-issues` | manager | Creates an OPEN/ASSIGNED issue with optional `dueAt` |
| `POST /data-quality-issues/:id/commands` | canonical issue state | ASSIGN (assignee), START, RESOLVE, WAIVE (approver + reason), REOPEN, ESCALATE (reason; records escalation without changing status; closed issues reject escalation) |
| `POST /employee-confirmations` | target exists | VIEWED / CONFIRMED / OBJECTED |
| `POST /appeals` | — | OPEN |
| `POST /appeals/:id/triage` | OPEN, reviewer ≠ appellant | TRIAGED |
| `POST /appeals/:id/review` | TRIAGED | UNDER_REVIEW |
| `POST /appeals/:id/resolve` | UNDER_REVIEW, reviewer ≠ appellant | CLOSED or RECALCULATION_REQUIRED |
| `POST /recalculation-requests` | manager/finance; target exists | Creates an OPEN request for EVIDENCE/ATTRIBUTION/EVALUATION/LEDGER |
| `POST /recalculation-requests/:id/approve` | finance, request is OPEN | APPROVED with approver and timestamp |
| `POST /recalculation-requests/:id/reject` | finance, request is OPEN | REJECTED with reviewer and timestamp |
| `POST /recalculation-requests/:id/complete` | finance, request is APPROVED, run exists | COMPLETED and linked to the new calculation run |
| `POST /agent-tasks` | idempotency key | Queues an agent task |
| `POST /agent-tasks/:id/run` | task QUEUED | Observe → plan → low-risk actions; T2/T3 wait for approval |
| `POST /agent-tasks/:id/approve` | action PENDING_APPROVAL, different approver | Executes the action, writes audit |
| `POST /agent-tasks/:id/reject` | action PENDING_APPROVAL | Marks rejected, writes audit |
| `POST /agent-tasks/scan` | — | Enqueues and runs evidence-gap, anomaly and settlement-readiness sweeps |
| `POST /policy-simulations` | current policy exists | Recomputes samples; returns deltas and blockers; writes no money |
| `GET /policy-versions` | manager/finance | Lists policy versions, status and effective windows |
| `GET /policy-versions/:id/diff?against=` | manager/finance | Structural diff of two policy definitions |
| `POST /policy-versions` | approved policy definition, effectiveFrom, approvedBy; optional approval | Creates a PUBLISHED version with content hash; closes the prior open effective window; legal gate still required for FORMAL; a matching approved `POLICY_PUBLISH` request (with planned `policyVersionId`) is consumed |
| `POST /settlement-batches` | LOCKED ledger entries not in an active batch | DRAFT batch with one line per ledger entry |
| `POST /settlement-batches/:id/commands` | canonical settlement state | RECONCILE validates lines; SUBMIT/APPROVE/LOCK/EXPORT/ACKNOWLEDGE advance state; REQUIRE_ADJUSTMENT marks an exported/acknowledged batch; CANCEL deactivates lines; EXPORT returns CSV; APPROVE/LOCK optionally consume `SETTLEMENT_APPROVE`/`SETTLEMENT_LOCK` approval requests |
| `POST /ledger/:id/reverse` | original LOCKED, finance; optional approval | Appends a LOCKED negative REVERSAL linked to the original; idempotent by key; a matching approved `LEDGER_REVERSAL` request is consumed |
| `POST /ledger/:id/adjustments` | original LOCKED, finance; optional approval | Appends a LOCKED ADJUSTMENT linked to the original and an adjustment record; idempotent by key; a matching approved `LEDGER_ADJUSTMENT` request is consumed |
| `POST /inbox-messages` | integration | Idempotent receive by consumer name and message id |
| `POST /inbox-messages/:id/process` | integration, unprocessed | Marks PROCESSED/FAILED/IGNORED once with an optional error code |

---

## 4. Change control

Any change to a state, transition, object, or money-path invariant requires:

1. update `packages/domain` or the relevant package;
2. a DB migration if persisted;
3. a contract/state-machine test;
4. an ADR update if semantics are non-obvious;
5. a note in the PRD change log.


---

## 5. Legal gate and employee confirmation

### Legal gate

A `FORMAL` calculation does not accept a gate from the request body. The gate must be recorded through `POST /policy-versions/:id/legal-gate` and is read from `legal_gate_records`. Required for formal settlement:

- `policyApproved`
- `minimumWageChecked`
- `democraticProcedureRef`
- `employeeNoticeRef`
- `dataProtectionAssessmentRef`

Missing any of these blocks the run with `CALCULATION_BLOCKED`. A `SHADOW` run may proceed without the gate and produces no ledger entries.

`employeeNoticeRef` can be supplied directly or derived by passing `employeeNoticeId`. A referenced notice must exist in the tenant, must not belong to a different policy version, and — when `acknowledgement_required` is true — every ACTIVE person in the tenant must have acknowledged it; otherwise the gate is rejected with `NOTICE_ACKNOWLEDGEMENTS_INCOMPLETE`. A `DECLINE` is recorded but does not satisfy the requirement. Coverage counts only `employment_status='ACTIVE'` people.

`democraticProcedureRef` can likewise be supplied directly or derived by passing `democraticProcedureId`. A referenced consultation must belong to the same policy version and must be concluded (`ended_at` set and outcome not `PENDING`); otherwise the gate is rejected with `CONSULTATION_POLICY_MISMATCH` or `CONSULTATION_NOT_CONCLUDED`. The outcome itself is recorded evidence; `NO_AGREEMENT` is a valid concluded outcome.

`dataProtectionAssessmentRef` can be supplied directly or derived by passing `dataProtectionAssessmentId`. A referenced DPIA/PIPIA must exist and be `APPROVED`; otherwise the gate is rejected with `DPIA_NOT_APPROVED`.

### Employee confirmation

Before a `FORMAL` run can be locked, every participant must have a `CONFIRMED` record for `target_type='CALCULATION'` and `target_id=<run id>`. A `VIEWED` record is not a confirmation. An `OBJECTED` record blocks locking and must be routed to appeal / recalculation. The original calculation and ledger history are preserved.

A `RECOVERY` settlement batch uses `target_type='SETTLEMENT'` and `target_id=<batch id>` for the same rule; see §10.1.

### AI gate

Numeric AI scoring is not available in the first slice. `packages/ai-gate` exposes evidence summary and gap detection only; `assertScoringAllowed` throws until a gate with a passed evaluation protocol is supplied.


---

## 6. Evidence graph

An `EvidenceNode` records `evidenceType`, `subjectType/subjectId`, `sourceSystem`, `sourceUri`, `observedAt`, `qualityStatus`, `normalizedPayload`, `submittedBy` and a payload hash. `EvidenceLink` records `SUPPORTS`, `CONTRADICTS`, `DEPENDS_ON`, `CORRECTS` or `CONTEXT` between two nodes. A contribution claim may cite evidence IDs, but a citation is not a substitute for verification. Evidence corrections should create a new node with `supersedesId` rather than mutating history.

Employee-submitted evidence is attributed to the authenticated `personId`; an employee cannot submit as someone else. An employee may attach evidence only to their own person record or to a work package they own or belong to; other subjects are rejected (a missing package is a 404). `GET /evidence` returns only that person's submissions for an employee, while manager/finance see the tenant. Evidence tables have RLS (`010_evidence_submitter_rls.sql`).

## 7. AI evaluation harness

`packages/ai-gate/evaluate.ts` computes:

- human-human Cohen's kappa;
- human-AI agreement;
- subgroup maximum error gap;
- counterfactual stability;
- prompt-injection pass rate.

The resulting `EvaluationGate` blocks numeric AI scoring when any threshold fails. The gate is deliberately separate from the evidence assistant: summarisation/gap detection can run; scoring cannot.

### 7.1 Human evaluation decision

Evaluation drafts are versioned evidence-bound inputs. A draft can be generated by `USER`, `AGENT` or `SYSTEM`, and must carry an `evidenceSnapshotHash`, strengths, counter-evidence, missing information and uncertainty. It cannot be approved by the person being evaluated.

`POST /evaluation-drafts/:id/decision` requires:

- the draft is `SUBMITTED`;
- the reviewer is a different person;
- a rubric version exists and every rubric dimension has a score in `[0,5]`;
- a rationale.

`APPROVE` creates an `EvaluationDecision` with `decisionVersion = prior + 1`, marks the prior approved decision `SUPERSEDED`, and appends an `EVALUATION_DECISION_RECORDED` audit event. `REJECT` closes the draft without creating a decision.

A Policy Pack can opt into evaluation weighting with:

```
evaluation: {
  dimensionWeights: { QUALITY: "0.6", SPEED: "0.4" },
  floor: "0.8",
  ceiling: "1.2",
  maxScore?: "5"
}
```

When present, every calculation participant must supply `evaluationDecisionId`. The store verifies the decision is `APPROVED`, belongs to the participant and the calculation cycle, then computes a weighted score and a multiplier in `[floor, ceiling]`. The multiplier scales the attribution weight before pool allocation; the pool itself is unchanged. Missing decisions/scores or out-of-range scores block the calculation. Callers cannot supply a multiplier directly.

---

## 8. Charging equipment sales policy (`CHARGING_EQUIPMENT_SALES_V1`)

This is an example Policy Pack (`examples/verticals/charging-equipment-sales/`), not a core capability. The core has no industry code; packs are policy data + fixtures. The EPC pack remains as a later extension.

```
basePool = min(orderGrossProfit × 3.5%, 120,000)
cashFactor = min(1, cashCollected / invoiceAmount)
cashAdjustedPool = basePool × (50% + 50% × cashFactor)
afterSalesReserve = cashAdjustedPool × 3%
payablePool = cashAdjustedPool − afterSalesReserve
channelPool = payablePool × channelShare
internalPool = payablePool − channelPool
line = internalPool × confirmed attribution weight
```

Gates: credit approval required; quality hold blocks; a positive channel share requires a channel partner. The channel pool is recorded separately and is not allocated to internal employees. The policy is routed by `PolicyDefinition.calculator` (`CASH_WEIGHTED_RESERVE_CHANNEL_POOL`), not by an industry code; the generic `SIMPLE_POOL` remains for non-project orders. Both use the same allocation and deterministic hash helpers.

### Later extension: `CHARGING_PROJECT_CONTRIBUTION_V1`

EPC projects use projected gross profit, 40% cash weighting, 5% retention holdback and acceptance/safety gates. Do not mix EPC and equipment-sales policies in the same cycle without explicit mutual-exclusion rules.


---

## 9. Proactive agent runtime

`packages/agent-runtime` is deliberately separate from the policy engine:

- skills observe business state and produce findings;
- findings become actions with T0–T3 risk tiers;
- T0/T1 may execute automatically; T2/T3 require a human;
- every task, action, tool call and approval is audited;
- tasks are idempotent and can be re-run safely;
- `PgAgentTaskRepository` persists each task snapshot (findings, actions, results, approval) and audit entries; a restarted API/worker rehydrates on first use and rebuilds the idempotency index;
- `POST /agent-tasks/scan` performs a scheduled/on-demand sweep of evidence gaps, contribution anomalies and settlement readiness;
- `AgentScheduler` supports schedule, domain-event and threshold triggers with idempotent keys;
- `apps/worker` polls `outbox_events`, dispatches events to the scheduler, and runs scheduled scans;
- `PolicyProposalSkill` can simulate a proposed policy and create a T3 `publish_policy` action; it never publishes automatically;
- `DataQualitySkill` persists its findings through the T1 `record_data_quality_issue` tool, so agent findings become trackable issues; a blocking finding also creates a T2 escalation that waits for a human;
- `EvaluationDraftSkill` assembles a person’s claims, decisions and evidence into a T1 `create_evaluation_draft` action. It emits no scores; the draft must still be submitted and approved by a human under §7.1;
- `request_evidence` and `notify_owner` resolve the work-package owner and persist a PERSON notification; `notify_finance` uses FINANCE and `escalate` uses MANAGER. Notifications are in-app rows, not external delivery; external channels remain adapter work;
- human workflow actions also notify: DQ assignment → assignee; confirmation objection → MANAGER; appeal triage/review/resolve → appellant; evaluation submit → MANAGER and decision → evaluated person; settlement `REQUIRE_ADJUSTMENT` → FINANCE. Notification creation is best-effort and does not roll back the primary action;
- agent tools that write domain objects require a caller role allowed to call the corresponding API; the worker's service token must carry `manager` (or `admin`);
- the worker calls `retryFailed` with backoff: only failed tasks that executed no action are retried; after 3 attempts the task is marked `deadLettered` and left `FAILED` for human review. A partially executed task is never retried automatically.

The core has no industry-specific agent. A policy pack can add evidence requirements and policy data, but it cannot bypass the approval gate or write formal money.


## 10. Policy simulation

`simulatePolicyChange(currentPolicy, proposedPolicy, samples)` returns per-person current/proposed/delta amounts, totals, affected people and blockers. It is a decision-support function: it does not publish a policy, write a ledger or approve a payment. `POST /policy-simulations` exposes it for an admin UI; the proposed policy is data, not a code deployment.

Simulation does not resolve per-policy evaluation decisions. If either policy has an `evaluation` block, the result includes `EVALUATION_WEIGHTS_NOT_RESOLVED_IN_SIMULATION` and must not be treated as decision-grade for those amounts.

Publication is a separate governed step. `publish_policy` is a T3 agent tool: it only executes through `AgentRuntime.approve`, receives the approver id from that approval, and calls `publishPolicy`. `POST /policy-versions` is the equivalent operator command and also requires an explicit `approvedBy`. A published policy row stores the content hash, effective window, approver and timestamps. The prior open-ended version is closed at the successor's `effective_from`; published content and a closed `effective_to` are immutable (`004_policy_succession.sql`). `POST /policy-versions/{id}/rollback` publishes the content of an earlier version as the next version of the same code, closes the current window and keeps every prior version immutable; it is admin-only and can consume a `POLICY_PUBLISH` approval for the planned new version id. Publication does not bypass the legal gate: a `FORMAL` calculation still needs the gate and employee confirmations.

File policy packs under `examples/verticals/` can be imported into PostgreSQL with `npm run seed:packs`. Without `APPROVED_BY` they are inserted as `DRAFT`; with `APPROVED_BY` they are `PUBLISHED` and attributed to that person. Existing `(tenant, code, version)` rows are left untouched.

### 10.1 Settlement batches

A settlement batch is the bridge from locked money to finance:

- creation collects only `LOCKED` ledger entries for the cycle that are not already active in another batch;
- every line is a copy of `(ledger_id, person_id, amount, currency)` and PostgreSQL rejects a line that does not match a locked ledger entry (`trg_settlement_line_ledger`);
- `RECONCILE` revalidates each active line against the ledger, uniqueness, line count and total;
- `APPROVE` requires an `actorPersonId`; the batch records `approved_by` and `approved_at`;
- `EXPORT` transitions to `EXPORTED` and returns a CSV of active lines, including employee code/name when available;
- `CANCEL` marks lines inactive so the ledger entries can be batched again; the unique active-line index prevents double settlement;
- settlement lines have RLS (`006_settlement_rls.sql`).

The settlement does not change the ledger and cannot create money. A re-settlement after cancellation is a new batch over the same locked ledger entries.

A post-export correction is a new locked `REVERSAL` ledger entry linked to the original, not an edit. `REQUIRE_ADJUSTMENT` marks the old batch (`EXPORTED`/`ACKNOWLEDGED` → `ADJUSTMENT_REQUIRED`); a new settlement batch then picks up unbatched reversal/positive entries.

A negative net total requires `kind = 'RECOVERY'`. `STANDARD` batches still enforce `total_amount >= 0`. Before a recovery batch can lock, every person with a negative active line must have a `CONFIRMED` employee confirmation with `target_type = 'SETTLEMENT'` and `target_id = batch.id`; an `OBJECTED` confirmation blocks the lock. Recovery creation notifies each affected person in-app.

### 10.2 Cycle readiness report

`GET /reports/cycle-readiness?cycleId=` is a read-only aggregation for managers and finance. It lists calculation runs in the cycle with their status, legal-gate and employee-confirmation blockers; settlement batches with export/acknowledgement timestamps; and budget-pool approval counts. `readyForSettlement` is true only when at least one non-reversed formal run exists and no legal-gate, confirmation or stored calculation blocker remains. The report never mutates money or approvals.

`GET /reports/policy-readiness?policyVersionId=` is the policy-side counterpart. It reports the legal gate and its blockers, active golden-case results (including not-run and failing cases), linked notice acknowledgement coverage, concluded consultations and the referenced DPIA status. `ready` requires no legal-gate blocker, at least one active test case with every active case passing its last run, complete acknowledgement-required notices and no unapproved referenced DPIA.

`GET /reports/operations-coverage` is a tenant-wide operational snapshot: accepted work packages with work-package evidence and the resulting coverage ratio, claim confirmation, deliverable acceptance queue, approval status, data-quality open/overdue/escalated counts and DSAR status. It is read-only and does not define performance targets.

---

## 11. Ingestion and connectors

Connectors are adapters, not a second domain model. A connector emits `IngestionEvent`s; the core stores them in `raw_events` with a uniqueness constraint on `(tenant_id, source_system, source_record_id, source_event_version)`, then projects an `evidence_nodes` row. Re-ingesting the same record is idempotent.

- `packages/connectors/src/csv.ts` implements a generic CSV connector with explicit field mapping.
- `packages/connectors/src/http-json.ts` implements a paginated HTTP/JSON pull connector: configurable records path, cursor path/parameter, page-size parameter, headers and the same field mapping as CSV.
- `scripts/import-csv.ts` posts a CSV file to `POST /api/v1/ingestion/events:batch`.
- `fixtures/connectors/crm-orders.csv` + `crm-orders.mapping.json` are the reference fixtures.
- Connector payloads are untrusted input: they may create evidence but never write money, approve attribution or bypass the legal gate.

Real CRM/ERP/Feishu connectors must implement the same `Connector` interface and must not add provider-specific concepts to the core. Provider-specific OAuth and webhook signature verification are adapter concerns.

---

## 12. Authentication and tenant context

All `/api/v1` routes pass through a Fastify `preHandler`:

- `AUTH_MODE=oidc`: `OidcJwtAuthenticator` verifies a bearer JWT against the configured issuer/audience/JWKS and derives `tenantId`, `userId` and roles from claims.
- `AUTH_MODE=dev`: `DevHeaderAuthenticator` accepts `X-Tenant-Id` / `X-User-Id` and is only for local development.
- Missing or invalid credentials return `401 UNAUTHENTICATED`.

`buildApp` accepts either a single store or a `StoreResolver`. The server passes a resolver and the app caches one store and one agent runtime per authenticated tenant, so two tokens with different tenant claims cannot see each other's work packages, claims, runs or agent tasks. RLS remains defense in depth: tenant stores set `app.tenant_id` per transaction, the dedicated platform pool starts connections with `app.platform_admin=on` for governance/master-data access, and the worker outbox sets `app.tenant_id` per transaction. `AUTH_MODE=dev` is still a development-only authenticator: it trusts client-supplied headers and must not be exposed in production.

The worker authenticates to the API with either a static `WORKER_TOKEN` or OAuth client credentials (`OIDC_TOKEN_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`); tokens are cached until shortly before expiry. Its token tenant claim must match `TENANT_ID`, because task persistence and API reads both resolve that tenant.

Roles are enforced per command (`admin` always passes):

| Role | Can do |
|---|---|
| `platform_admin` | tenant/user/membership/person/org onboarding only (admin also passes) |
| `admin` | everything, including legal gates, policy publication and publishing an agent-proposed policy |
| `manager` | simulations, agent scans/approval (except policy publication), attribution decisions, package acceptance, appeals |
| `finance` | calculations, approval/locking, settlement commands, settlement-related agent approvals |
| `integration` | event ingestion |
| `employee` | own confirmations, claims, appeals; no money/rule commands |

The employee/admin web pages are served without authentication, but every data-changing call they make goes through the authenticated API.

`AuthContext.personId` comes from the `person_id` JWT claim (`personClaim`) or `X-Person-Id` in dev. `GET /platform/identity` resolves the authenticated `userId` to its tenant `personId` (from `people.user_id`) and membership role codes; it is a read-only lookup and does not change the token-derived authorization context. For roles outside `admin/manager/finance`:

- `GET /work-packages` is limited to packages owned by or containing that person;
- claims, decisions, calculation runs, ledger entries, confirmations and appeals are filtered to that person;
- calculation-run lines are redacted to the person's own lines;
- confirmations, claims and appeals cannot be created for another person;
- DSARs can be created, listed and read only for the employee's own person; resolution is admin-only;
- settlement and agent-task read endpoints are role-gated;
- `GET /ledger/verify` and `GET /policy-versions/:id/legal-gate` are role-gated.

Calculation runs are further redacted for employees: `lines` and `inputSnapshot.participants` are limited to the person, `line.trace` becomes `{}` and `order.grossProfit` becomes `REDACTED`. `GET /evidence` and `GET /evidence/:id/links` are manager/finance only. New sensitive fields must be added to this redaction policy explicitly.

---

## 13. Contract and CI

- `docs/openapi.yaml` is the OpenAPI 3.1 contract. `tests/openapi.test.ts` parses it, checks every route in `apps/api/src/app.ts` is documented, rejects stale documented routes, and verifies local `$ref`s resolve.
- `scripts/ci.sh` is the verification entry point: install → typecheck → unit/API tests → `docker compose config` → PostgreSQL integration tests. `CI_SKIP_PG=1` skips the Docker-backed tests.
- `/health` is liveness; `/ready` checks the store. `/metrics` exposes Prometheus counters and latency using registered route patterns (bounded cardinality), plus process uptime/heap gauges. The endpoint has no auth and should be reachable only from the monitoring network.
- Admin UI at `/admin` is a minimal development surface for policy simulation and agent approvals; it is not a production IAM-controlled console.
