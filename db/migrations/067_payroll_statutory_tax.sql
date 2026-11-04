-- Statutory China IIT cumulative withholding fields on payroll lines.
BEGIN;

ALTER TABLE payroll_lines
  ADD COLUMN tax_calculation_mode text
    CHECK (tax_calculation_mode IN ('DECLARED', 'STATUTORY_CN')),
  ADD COLUMN ytd_taxable_income numeric(20,6),
  ADD COLUMN ytd_tax_withheld numeric(20,6),
  ADD COLUMN iit_rate_percent int,
  ADD COLUMN iit_quick_deduction numeric(14,6);

COMMIT;
