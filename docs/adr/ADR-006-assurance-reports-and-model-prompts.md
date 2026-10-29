# ADR-006: Policy test governance, readiness reports and model prompts

- **Status**: Accepted
- **Date**: 2026-10-29
- **Context**: The review required executable policy test cases, a rule-change gate that does not rely on prose, measurable evidence coverage, and a versioned prompt registry with a release gate. These features must work in both the memory demo and PostgreSQL, stay read-only where they report, and must not let an AI model or a test shortcut the legal gate.
- **Decision**:
  - A policy test case stores a calculation request plus a partial expected result. The runner executes the request against the policy version bound to the case in `SHADOW` mode and compares only supplied `pool`, `poolRounded`, `resultHash` and `lines` keys. Differences, unsupported keys and policy-gate blockers are reported instead of silently passing.
  - Single-case runs record `lastRunAt`, `lastRunPassed` and the result hash on the case. Suite runs additionally append a `policy_test_runs` record with counts, hash and full results; history is immutable and newest-first.
  - A tenant can set `requirePolicyTestsBeforeApproval: true`. A DRAFT rule change order then runs the target policy version's ACTIVE suite before approval; an empty or failing suite blocks approval. The suite execution and its result are recorded either way. Tests do not replace the legal gate, notices, consultations or DPIA.
  - `GET /reports/policy-readiness` is a read-only aggregation of the legal gate, active test results, linked notice acknowledgement coverage, consultations and referenced DPIA. `GET /reports/cycle-readiness` aggregates calculation, confirmation, legal-gate, settlement and budget state for a cycle. `GET /reports/operations-coverage` reports evidence coverage, claims, deliverables, approvals, data-quality queues and DSARs. Reports never mutate money, approvals or records.
  - Model prompts are versioned DRAFT/ACTIVE/RETIRED records with a template hash. Activation requires a passed model evaluation for the same provider and model, and at most one ACTIVE version per prompt code (PostgreSQL enforces this with a partial unique index). AI suggestion logs may reference an ACTIVE prompt; the referenced provider/model must match the suggestion.
  - Data-quality issues accept an optional remediation deadline. `ESCALATE` records a reason and timestamp without changing lifecycle status; resolved or waived issues cannot be escalated.
  - API rate limiting is opt-in per process (`RATE_LIMIT_PER_MINUTE`) and keyed by tenant/actor. `BODY_LIMIT_BYTES` caps request bodies and returns a standard 413 envelope. Multi-replica deployments should enforce the shared limit at the gateway.
- **Consequences**:
  - Policy readiness is evidence-based but not a legal opinion. A green report means the recorded controls pass; it does not prove the underlying policy is lawful.
  - The test gate is tenant-configurable and off by default, so enabling it for an existing tenant needs a transition plan for policies without ACTIVE cases.
  - Memory and PostgreSQL must keep behavioural parity; API tests exercise memory and PostgreSQL integration tests exercise constraints and migrations.
  - Governance tables still rely on tenant-scoped queries rather than PostgreSQL RLS; adding RLS requires separating platform-admin and tenant query paths and is tracked as productisation work.
  - Prompt templates and test results are internal governance data; they are role-gated through the existing API roles but are not a substitute for a full data-retention or export-DLP design.
