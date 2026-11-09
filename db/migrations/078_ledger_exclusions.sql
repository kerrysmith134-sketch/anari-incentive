-- 078: keep reversed clawback pairs out of future settlement sweeps.
-- A waived clawback leaves a locked deduction plus its reversal (net zero).
-- Without an exclusion they are re-swept into every later RECOVERY batch and
-- other employees end up seeing deductions that no longer apply.
BEGIN;

CREATE TABLE IF NOT EXISTS ledger_exclusions (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ledger_id uuid NOT NULL REFERENCES amount_ledger(id),
  reason text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, ledger_id)
);

COMMIT;
