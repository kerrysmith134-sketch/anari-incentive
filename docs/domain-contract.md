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

---

## 3. API command surface (first slice)

| Command | Preconditions | Effects |
|---|---|---|
| `POST /work-packages` | — | Creates DRAFT |
| `POST /work-packages/:id/commit` | DRAFT, expectedVersion | Freezes snapshot, COMMITTED |
| `POST /work-packages/:id/start` | COMMITTED | IN_PROGRESS |
| `POST /work-packages/:id/submit` | IN_PROGRESS | SUBMITTED |
| `POST /work-packages/:id/accept` | SUBMITTED, reviewer ≠ owner | ACCEPTED |
| `POST /work-packages/:id/reject` | SUBMITTED, reviewer ≠ owner | REJECTED |
| `POST /contribution-claims` | WorkPackage ACCEPTED + snapshot | DRAFT claim |
| `POST /contribution-claims/:id/submit` | DRAFT | SUBMITTED |
| `POST /attribution-decisions` | Claim SUBMITTED/UNDER_REVIEW, adjudicator ≠ claimant | Decision + claim status |
| `POST /calculation-runs` | Policy exists; FORMAL requires legal gate + confirmed attribution | CALCULATED; FORMAL writes ledger |
| `POST /calculation-runs/:id/approve` | CALCULATED | APPROVED |
| `POST /calculation-runs/:id/lock` | APPROVED, confirmation, all FORMAL participants confirmed | LOCKED; locks ledger |
| `POST /policy-versions/:id/legal-gate` | server-side gate record | Records policy approval/minimum-wage/democratic-procedure/notice/DPIA refs |
| `POST /evidence` | — | Creates an evidence node with provenance and quality status |
| `GET /evidence?subjectType=&subjectId=` | — | Lists evidence for a subject |
| `POST /evidence/:id/links` | both evidence nodes exist | SUPPORTS / CONTRADICTS / DEPENDS_ON / CORRECTS / CONTEXT |
| `POST /employee-confirmations` | target exists | VIEWED / CONFIRMED / OBJECTED |
| `POST /appeals` | — | OPEN |
| `POST /appeals/:id/triage` | OPEN, reviewer ≠ appellant | TRIAGED |
| `POST /appeals/:id/review` | TRIAGED | UNDER_REVIEW |
| `POST /appeals/:id/resolve` | UNDER_REVIEW, reviewer ≠ appellant | CLOSED or RECALCULATION_REQUIRED |

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

### Employee confirmation

Before a `FORMAL` run can be locked, every participant must have a `CONFIRMED` record for `target_type='CALCULATION'` and `target_id=<run id>`. A `VIEWED` record is not a confirmation. An `OBJECTED` record blocks locking and must be routed to appeal / recalculation. The original calculation and ledger history are preserved.

### AI gate

Numeric AI scoring is not available in the first slice. `packages/ai-gate` exposes evidence summary and gap detection only; `assertScoringAllowed` throws until a gate with a passed evaluation protocol is supplied.


---

## 6. Evidence graph

An `EvidenceNode` records `evidenceType`, `subjectType/subjectId`, `sourceSystem`, `sourceUri`, `observedAt`, `qualityStatus`, `normalizedPayload` and a payload hash. `EvidenceLink` records `SUPPORTS`, `CONTRADICTS`, `DEPENDS_ON`, `CORRECTS` or `CONTEXT` between two nodes. A contribution claim may cite evidence IDs, but a citation is not a substitute for verification. Evidence corrections should create a new node with `supersedesId` rather than mutating history.

## 7. AI evaluation harness

`packages/ai-gate/evaluate.ts` computes:

- human-human Cohen's kappa;
- human-AI agreement;
- subgroup maximum error gap;
- counterfactual stability;
- prompt-injection pass rate.

The resulting `EvaluationGate` blocks numeric AI scoring when any threshold fails. The gate is deliberately separate from the evidence assistant: summarisation/gap detection can run; scoring cannot.

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

Gates: credit approval required; quality hold blocks; a positive channel share requires a channel partner. The channel pool is recorded separately and is not allocated to internal employees. The policy is routed by `policy_version.rule_ast.code`; the generic `ORDER_CONTRIBUTION_V1` remains for non-project orders. Both use the same allocation and deterministic hash helpers.

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
- `POST /agent-tasks/scan` performs a scheduled/on-demand sweep of evidence gaps, contribution anomalies and settlement readiness.

The core has no industry-specific agent. A policy pack can add evidence requirements and policy data, but it cannot bypass the approval gate or write formal money.
