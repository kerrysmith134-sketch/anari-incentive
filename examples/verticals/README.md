# Vertical policy packs

N-Perform's core is **institution-agnostic**. A vertical pack is a tenant
configuration example — policy data, fixtures and a seed/onboarding note — not
the product boundary.

A pack must not require core code changes. If a pack needs a new primitive, add
the primitive to the restricted policy DSL, version it, and add conformance
tests; do not fork the engine for one customer.

## Packs

| Pack | Status | Purpose |
|---|---|---|
| `charging-equipment-sales/` | Example / first design partner | EV charging pile equipment sales: direct + channel, credit/quality gates, after-sales reserve |
| `professional-services/` | Conformance example | Consulting margin pool: different rate, cash weight, no reserve/channel; proves the core is institution-agnostic |
| `charging-epc/` | Later extension | EV charging station EPC: acceptance/safety gates, retention holdback |

## Pack shape

```json
{
  "id": "example-pack",
  "name": "Example pack",
  "version": "0.1.0",
  "status": "example",
  "description": "What this pack demonstrates",
  "corePolicyCode": "POLICY_CODE",
  "policy": "policy.json",
  "fixtures": "fixtures"
}
```

The policy file is a `PolicyDefinition` consumed by the generic policy engine.
Fixtures are anonymized orders/projects with expected outputs; they are
regression tests for the pack, not the core product.
