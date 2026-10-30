# Threat model (SEC-01)

**Status:** living document, reviewed with each major release  
**Scope:** the API, PostgreSQL stores, console SPA, integration connectors and AI proposal path in this repository. Deployment infrastructure (identity provider, WAF, secrets manager, object storage) is referenced but configured outside the repository.

## Assets

1. **Money-path integrity** — calculation inputs, attribution decisions, locked ledger entries, settlement batches and payroll lines.
2. **Personal data** — employee identity, evidence, evaluation drafts/decisions, payroll bank references, DSAR/DPIAs and survey responses.
3. **Governance evidence** — policy versions, legal gates, notices/acknowledgements, consultations, approvals, audit hash chain.
4. **Model assets** — prompts, evaluation harness records, model providers and AI score proposals.
5. **Credentials** — OIDC tokens, connector secrets, database roles.

## Trust boundaries and data flows

```
Employee / manager / finance browser
        │ HTTPS + OIDC bearer (or dev headers, development only)
        ▼
Fastify API ── authentication + roles + person scoping
   │        ├── PostgreSQL as anari_app (RLS, app.tenant_id)
   │        ├── PostgreSQL platform pool (app.platform_admin=on, governance data)
   │        ├── connector egress (HubSpot/Feishu/HTTP JSON, signed webhooks)
   │        └── model provider (AI proposal generation, not autonomous decisions)
        ▼
Audit hash chain (append-only) ──► WORM copies + external anchor (deployment)
```

## STRIDE summary

| Threat | Example | Current controls | Residual / owner |
|---|---|---|---|
| **Spoofing** | Forged tenant/person headers | OIDC mode ignores dev headers; token-derived identity; memberships resolved server-side | IdP configuration is deployment-owned |
| **Tampering** | Editing locked ledger, calculation lines or audit rows | PostgreSQL triggers/constraints, append-only semantics, hash chain verification, RLS | WORM storage and external anchoring are deployment controls; see [audit durability](../operations/audit-durability.md) |
| **Repudiation** | Denying a decision or acknowledgement | Immutable audit events with actor/object/reason, approvals consumed once, evidence packages | Log retention and legal hold must be configured |
| **Information disclosure** | Manager reading another team's amounts or payroll bank refs | Role gates, employee `personFilter`, field-scoped payroll routes, team aggregate suppression, RLS | Field-level ABAC/break-glass and export DLP are not yet complete (SEC-03/04) |
| **Denial of service** | Large payloads or sync floods | Body limit, fixed-window rate limit, sync cursors/idempotency | Edge WAF/quotas are deployment-owned |
| **Elevation of privilege** | Self-adjudication, self-approval, self-review | Requester ≠ approver, claimant ≠ adjudicator, requester ≠ AI reviewer, conflict registry, approval consumption | Break-glass grants require explicit design (SEC-03) |
| **Prompt injection / model abuse** | Evidence text instructing the model to inflate scores | Gate harness requires prompt-injection pass rate; numeric scores remain proposals; human independent-first review and audit sampling | Provider egress allowlist/zero-retention configuration (SEC-05) |

## Key abuse cases and tests

- **Self-dealing in attribution** — blocked by `assertAdjudicatorIsNotClaimant` and active conflict declarations; covered by API tests.
- **AI score silently becoming a decision** — numeric scoring requires a passed harness; decision/ledger paths never consume an AI proposal directly; override reasons and second-review audit are recorded.
- **Formal run without legal basis** — `FORMAL` calculation requires a complete legal gate, policy tests and confirmation coverage; blocked by API and store tests.
- **Cross-tenant access** — RLS negative tests run as a non-superuser `anari_app` role; governance tables use tenant/platform policies.
- **Double settlement** — partial unique active settlement line and ledger lock triggers; covered by PostgreSQL integration tests.

## Explicit non-goals / open items

- Automated retention deletion is intentionally not wired. Disposal is a reviewed manual operation.
- Field-level ABAC, break-glass access, export DLP/watermarking and model-provider contract controls remain open (SEC-03/04/05).
- Threat-model review must be repeated when adding a connector, model provider or new employee-data field.
