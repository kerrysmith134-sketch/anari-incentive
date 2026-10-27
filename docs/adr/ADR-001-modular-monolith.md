# ADR-001: Modular monolith, Fastify for the first slice

- **Status**: Accepted
- **Date**: 2026-10-27
- **Context**: The first deliverable is a 12-week vertical slice, not a full platform. The architecture baseline recommends NestJS, but the first slice needs a small, fast-to-review surface while domain boundaries are still being validated.
- **Decision**:
  - Use a modular monolith: `apps/api` + `packages/domain` + `packages/contracts` + `packages/policy-dsl` + `packages/ledger`.
  - Use Fastify + Zod for the first slice. Keep route handlers thin; domain logic lives in `apps/api/src/store.ts` and packages.
  - Revisit NestJS after the module boundaries and auth/tenant context stabilize. A framework change must be justified by concrete needs (DI, guards, module lifecycle), not by preference.
  - Do not introduce microservices, a message broker, or a separate policy service in the first slice. Outbox/Inbox and PostgreSQL constraints are the reliability baseline.
- **Consequences**:
  - Faster iteration and easier review now.
  - Some NestJS-specific patterns (guards/interceptors) will need migration later; route contracts and domain types are designed to survive.
  - The API is intentionally in-memory for the first slice; PostgreSQL repositories are the next step.
