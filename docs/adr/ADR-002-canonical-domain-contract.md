# ADR-002: One canonical domain contract

- **Status**: Accepted
- **Date**: 2026-10-27
- **Context**: V4.0 had four descriptions of the same domain (PRD, architecture, DB/API contract, engineering pack). State names and transitions drifted: ContributionClaim used `NEEDS_EVIDENCE` vs `NEEDS_INFO`; CalculationRun used `CALCULATED` vs `SUCCEEDED`; SettlementBatch used `EXPORTED/ACKNOWLEDGED` vs `SETTLED`. This is a production-risk, not a documentation nit.
- **Decision**:
  - `packages/domain/src/states.ts` is the single source of truth for state names and legal transitions.
  - API schemas, DB enums/CHECKs and tests must be derived from or checked against it.
  - All state changes use explicit commands (`/commit`, `/submit`, `/accept`, `/approve`, `/lock`). Generic `PATCH { status }` is forbidden.
  - Any new state or transition requires: a domain change, a DB migration, a contract test, and an ADR update if the semantics are non-obvious.
- **Consequences**:
  - Some V4.0 names are intentionally changed. Mapping is documented in `docs/PRD_V4.1_评审修订版.md` §8.2.
  - SQL enums and API responses must be regenerated/checked when the domain contract changes.
