# ADR-008: System-level policy defaults

- Status: Accepted
- Date: 2026-11-02
- Owners: Product / Compliance Engineering
- Related: ADR-003 (money-path invariants), ADR-004 (AI evaluation gate), PRD V4.1 §4.1, §5.1, §7.2–7.3, §8.4, §10

## Context

Several PRD requirements are expressed as policy outcomes rather than fixed
algorithms: retention periods, small-sample fairness handling, deduction
priority, AI risk escalation, export controls, and evidence retention. Leaving
each tenant or caller to invent these defaults produces inconsistent controls
and lets a caller weaken a safeguard.

The PRD fixes the principles and, where it does not name a number, external
law or recognised practice supplies a conservative baseline. These defaults are
system-owned. A tenant may configure a stricter value or supply a documented
legal basis for a different one; a caller cannot downgrade a system-computed
control.

This ADR is engineering guidance, not legal advice. Deployment-specific legal
review remains required.

## Decisions

### 1. Retention and disposal

| Category | Default retention | Basis |
|---|---|---|
| Payroll and accounting records | 360 months (30 years) | PRC accounting-archive rules; payroll ledgers are accounting records |
| Migrant-worker wage payment records | 36 months minimum, never below the payroll default where the record is also an accounting record | PRC migrant-worker wage payment rules |
| Labour contracts | 24 months after termination, and never shorter than the applicable payroll/accounting period | Labour Contract Law Art. 50 |
| Recruitment / unsuccessful-applicant records | 24 months | Data-minimisation default; shorter tenant periods allowed |
| AI evaluation evidence and proposals | 36 months | Supports explanation, appeal, and annual review; purge after the review window unless a hold applies |
| Security / audit events | 120 months | Supports investigation and audit verification; immutable store may retain longer |

Rules:

- Retention is measured by category policy, not by ad-hoc row deletion.
- Legal hold always wins. A held category is not eligible for disposal.
- Disposal is a reviewed workflow: request → a different person approves →
  a default 30-day grace period → explicit completion. There is no automatic
  hard delete.
- The system never deletes immutable audit or ledger history. Disposal applies
  to the operational copy and is recorded as an auditable event.
- A tenant that selects a shorter period must attach a legal basis and approve
  the policy through the normal governance path.

### 2. Wage deductions

Default deduction order:

1. Statutory tax withheld by the employer
2. Employee social-insurance contribution
3. Employee housing-fund contribution (where applicable)
4. Court order or legally mandated garnishment
5. Employee-authorised deduction (written, specific, revocable)
6. Employer recovery of an overpayment or advance

Rules:

- Non-statutory deductions are capped at 20% of the employee's monthly wage,
  and the remaining wage must not fall below the local minimum wage. This
  follows the PRC Interim Provisions on Wage Payment Art. 16.
- Statutory tax, social insurance, housing fund, and court-ordered amounts are
  tracked separately and are not counted against the 20% cap where the law
  permits priority. They still appear in the deduction breakdown.
- The cap is applied after the ordered deductions, not pro rata, and a breach
  blocks the payroll line rather than silently reducing a statutory amount.
- Every deduction requires a type, amount, legal/contractual basis, and a
  reference. Employee-authorised deductions require a signed consent record.
- A compensation template supplies role, employment type, salary range,
  variable-share cap, smoothing threshold, order, and per-type caps. Template
  changes follow the policy-version approval path; a contract cannot reference
  a template that is retired or inconsistent with its employment type.

### 3. Subgroup fairness

Required dimensions: role, gender, age band, region, tenure band, employment
type, and evidence coverage. Gender and age are sensitive personal information;
they may only be collected with a separate, specific consent and a documented
lawful basis, stored pseudonymously, and used only for aggregate fairness
monitoring. They are never an input to an individual pay or evaluation
decision.

Reporting rules:

- Fewer than 10 people in a group: suppress the cell; report only that
  suppression occurred.
- 10–29 people: qualitative review only; do not publish rates or rankings.
- 30 or more: publish score/error/selection-rate comparisons, still aggregated.
- Selection-rate ratio below 0.8 against the highest group triggers review
  (the “four-fifths” heuristic). It is an investigation trigger, not proof of
  discrimination.
- Report by dimension and period; never expose an individual's attribute or a
  re-identifiable combination.
- Withdrawal of consent removes the person from future aggregates; historical
  aggregate reports remain as governance records without individual rows.

### 4. AI risk and human oversight

Risk is computed from the proposal, not trusted from the caller:

- Any zero-scored dimension → CRITICAL.
- No evidence → HIGH.
- Confidence below 0.5 → HIGH; below 0.7 → MEDIUM.
- Fewer than three evidence items → MEDIUM.
- Requested HIGH/CRITICAL is preserved; a caller can raise but never lower the
  computed tier.
- LOW requires an explicit low request plus adequate evidence and confidence.

HIGH and CRITICAL proposals require a second, independent reviewer who differs
from the requester and the first reviewer. Second-review SLA: 24 hours for HIGH,
8 hours for CRITICAL. A completed review after the due time is recorded as an
SLA breach; a pending review after the due time is surfaced as overdue. The
system records duration, evidence opened, agreement, and the final decision.
No AI proposal becomes a formal decision automatically.

### 5. Exports, DLP, and audit

- Default export policy: role-authorised, purpose-bound, tenant- and
  actor-rate-limited, and watermarked with actor, timestamp, and export id.
- Sensitive fields (bank account, national id, tax id, salary) are redacted by
  default and require an explicit field policy/break-glass with reason and
  expiry; break-glass use is audited.
- DLP defaults flag long digit strings, national-id patterns, bank-account
  patterns, and personal contact data; a flagged export requires approval.
- Audit redaction is an overlay: the append-only chain and hashes are not
  modified. The read path applies an approved replacement and records who
  approved it and why.
- Export limits and retention are configuration, but the system cannot be
  configured to emit sensitive fields to a role with no field policy.

### 6. Signatures, archives, and provider evidence

- A signature is “reliable” only when the provider evidences identity
  authentication, intent, document integrity, and a trusted timestamp, in line
  with PRC E-Signature Law Art. 13. The internal adapter records the provider,
  envelope reference, document hash, signer, and callback signature.
- Production use requires a licensed CA/provider, a signed DPA, and a
  deployment-owned WORM/TSA archive with dual copies. These are deployment
  controls, not application toggles.
- Model providers require zero-retention confirmation, a DPA reference,
  inference region, an egress allowlist, and an approver. A tenant may require
  that policy before any scoring or prompt activation.
- Contracts and signed evidence are retained for at least the applicable
  contract/payroll period and never shorter than two years after termination.

### 7. Gold sets and model change control

- Gold sets cover each role/order type with 100–300 expert-labelled cases,
  stratified by evidence quality, role, tenure, and outcome, with a held-out
  slice. Refresh quarterly; a due refresh is visible and blocks a new
  evaluation when the tenant requires a registered current gold set.
- Model, prompt, retrieval, and harness versions are recorded. A material
  change requires regression evaluation, canary comparison, and rollback
  capability before broad use.
- Evaluation must report kappa/ICC, subgroup error, counterfactual stability,
  prompt-injection pass rate, and holdout size. The gate blocks on the
  thresholds in `packages/ai-gate`; no blocker may be waived without a recorded
  human exception and remediation date.

### 8. Reader/actor and agent defaults

Agent tasks default to READER. A task may perform a write only when it is
explicitly assigned ACTOR, the tool is within the allowed access class, and the
action is not T3/high-impact. T3 actions always require a human approval; an
approval is single-use and bound to the payload hash. Autonomous adverse
actions are out of scope.

## Implementation status (2026-11-02)

- Retention recommendations are exposed by `GET /api/v1/retention-policies/recommended`; Settings can prefill a policy. Recommendations are advisory and require tenant confirmation; legal hold wins and disposal remains reviewed.
- AI risk tiering, risk reasons, second-review due dates and SLA breach recording are implemented in `packages/ai-gate` and proposal persistence.
- Consented subgroup labels, withdrawal, suppression thresholds and the four-fifths report are implemented; harness error gaps exclude groups below 30.
- Clawback installment preview enforces the 20% cap and minimum-wage floor against the active contract.
- The field access matrix is implemented for payroll and calculation lines and can be managed through the API and Settings.
- Export DLP is default-on; an explicit tenant opt-out is required to disable it.
- Audit durability readiness is observable, but WORM, mirror and TSA provisioning remain deployment controls.

## Consequences

- Defaults are implemented in code or in the policy layer, surfaced in the API,
  and covered by tests. A tenant override is data, not a code change, and is
  audited.
- Where a jurisdiction requires a different period or order, the tenant
  records the legal basis; the system does not silently reinterpret law.
- The external items that cannot be completed in code remain explicit:
  provider DPAs, CA/WORM/TSA deployment, jurisdiction-specific legal sign-off,
  and any automated hard-deletion job. Review disposal remains manual and
  two-person controlled.
