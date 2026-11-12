/**
 * ADR-008 系统默认留存建议（治理域，NPV2-011）。
 */
export const RETENTION_RECOMMENDATIONS = [
  {
    dataCategory: "PAYROLL_RECORDS",
    retentionMonths: 360,
    legalBasis:
      "PRC accounting-archive rules and payroll-ledger retention; ADR-008 system default",
  },
  {
    dataCategory: "ACCOUNTING_RECORDS",
    retentionMonths: 360,
    legalBasis: "PRC accounting-archive retention; ADR-008 system default",
  },
  {
    dataCategory: "MIGRANT_WORKER_WAGE_RECORDS",
    retentionMonths: 36,
    legalBasis:
      "PRC migrant-worker wage-payment record minimum; ADR-008 system default",
  },
  {
    dataCategory: "LABOR_CONTRACTS",
    retentionMonths: 24,
    legalBasis:
      "Labour Contract Law Art. 50 minimum after termination; ADR-008 system default",
  },
  {
    dataCategory: "RECRUITMENT_RECORDS",
    retentionMonths: 24,
    legalBasis: "Data-minimisation default; ADR-008 system default",
  },
  {
    dataCategory: "AI_EVALUATION_EVIDENCE",
    retentionMonths: 36,
    legalBasis:
      "Explanation, appeal and annual-review evidence window; ADR-008 system default",
  },
  {
    dataCategory: "AUDIT_EVENTS",
    retentionMonths: 120,
    legalBasis:
      "Investigation and audit-verification window; ADR-008 system default",
  },
] as const;
