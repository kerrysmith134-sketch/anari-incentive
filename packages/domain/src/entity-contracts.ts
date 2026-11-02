/**
 * Declared column contract for core (money-path and audit) tables.
 *
 * This registry is the single source for persisted entity types: hand-written
 * interfaces in `types.ts` extend the generated `*Persisted` types, and
 * `tests/ddl-contract.test.ts` verifies the same columns exist in migrations.
 * Add a column here first, run `npm run contracts:entities`, then add the
 * migration. Migrations stay hand-written (see ADR-009).
 */

export type EntityDataClassification = "PII" | "FINANCIAL" | "AUDIT";

export interface EntityColumnContract {
  /** PostgreSQL column name. */
  column: string;
  /** TypeScript field name on the generated interface. */
  field: string;
  /** TypeScript type text (may reference types from ./types.js). */
  tsType: string;
  optional?: boolean;
  classification?: EntityDataClassification;
  /** False for DDL columns intentionally not exposed on the domain type. */
  exposed?: boolean;
}

export interface EntityContract {
  table: string;
  /** Base name for the generated TypeScript interface. */
  typeName: string;
  columns: readonly EntityColumnContract[];
}

export const CORE_ENTITY_CONTRACTS: readonly EntityContract[] = [
  {
    table: "employment_contracts",
    typeName: "EmploymentContract",
    columns: [
      { column: "bank_account_ref", field: "bankAccountRef", tsType: "string", optional: true, classification: "PII" },
      { column: "compensation_template_code", field: "compensationTemplateCode", tsType: "string", optional: true },
      { column: "consent_signature_ref", field: "consentSignatureRef", tsType: "string", classification: "PII" },
      { column: "consent_signed_at", field: "consentSignedAt", tsType: "string" },
      { column: "contract_code", field: "contractCode", tsType: "string" },
      { column: "created_at", field: "createdAt", tsType: "string" },
      { column: "currency", field: "currency", tsType: "string" },
      { column: "deduction_cap_rate", field: "deductionCapRate", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "deduction_order", field: "deductionOrder", tsType: "string[]" },
      { column: "deduction_type_caps", field: "deductionTypeCaps", tsType: "Record<string, DecimalString>", classification: "FINANCIAL" },
      { column: "employment_type", field: "employmentType", tsType: "EmploymentType" },
      { column: "end_date", field: "endDate", tsType: "string", optional: true },
      { column: "fixed_monthly_salary", field: "fixedMonthlySalary", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "id", field: "id", tsType: "UUID" },
      { column: "legal_entity", field: "legalEntity", tsType: "string", optional: true },
      { column: "minimum_monthly_wage", field: "minimumMonthlyWage", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "pay_plan_version", field: "payPlanVersion", tsType: "number" },
      { column: "person_id", field: "personId", tsType: "UUID" },
      { column: "smoothing_threshold_rate", field: "smoothingThresholdRate", tsType: "DecimalString" },
      { column: "social_insurance_rate", field: "socialInsuranceRate", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "start_date", field: "startDate", tsType: "string" },
      { column: "status", field: "status", tsType: "EmploymentContractStatus" },
      { column: "tax_rate", field: "taxRate", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "tenant_id", field: "tenantId", tsType: "UUID" },
      { column: "updated_at", field: "updatedAt", tsType: "string" },
      { column: "variable_share_cap_rate", field: "variableShareCapRate", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "version", field: "version", tsType: "number" },
      { column: "work_location", field: "workLocation", tsType: "string" },
    ],
  },
  {
    table: "payroll_runs",
    typeName: "PayrollRun",
    columns: [
      { column: "approved_at", field: "approvedAt", tsType: "string", optional: true },
      { column: "approved_by", field: "approvedBy", tsType: "UUID", optional: true },
      { column: "blocked_count", field: "blockedCount", tsType: "number" },
      { column: "created_at", field: "createdAt", tsType: "string" },
      { column: "currency", field: "currency", tsType: "string" },
      { column: "cycle_id", field: "cycleId", tsType: "UUID" },
      { column: "id", field: "id", tsType: "UUID" },
      { column: "line_count", field: "lineCount", tsType: "number" },
      { column: "paid_at", field: "paidAt", tsType: "string", optional: true },
      { column: "period_end", field: "periodEnd", tsType: "string" },
      { column: "period_start", field: "periodStart", tsType: "string" },
      { column: "prepared_by", field: "preparedBy", tsType: "UUID" },
      { column: "reversal_reason", field: "reversalReason", tsType: "string", optional: true },
      { column: "reversed_at", field: "reversedAt", tsType: "string", optional: true },
      { column: "reversed_by", field: "reversedBy", tsType: "UUID", optional: true },
      { column: "status", field: "status", tsType: "PayrollRunStatus" },
      { column: "tenant_id", field: "tenantId", tsType: "UUID" },
      { column: "total_deductions", field: "totalDeductions", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "total_gross", field: "totalGross", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "total_net", field: "totalNet", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "total_social_insurance", field: "totalSocialInsurance", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "total_tax", field: "totalTax", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "updated_at", field: "updatedAt", tsType: "string" },
      { column: "version", field: "version", tsType: "number" },
    ],
  },
  {
    table: "payroll_lines",
    typeName: "PayrollLine",
    columns: [
      { column: "bank_account_ref", field: "bankAccountRef", tsType: "string", optional: true, classification: "PII" },
      { column: "contract_id", field: "contractId", tsType: "UUID" },
      { column: "created_at", field: "createdAt", tsType: "string" },
      { column: "currency", field: "currency", tsType: "string" },
      { column: "deduction_amount", field: "deductionAmount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "deduction_breakdown", field: "deductionBreakdown", tsType: "Array<{ type: string; amount: DecimalString; priority: number; }>", classification: "FINANCIAL" },
      { column: "deduction_cap_amount", field: "deductionCapAmount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "deduction_cap_passed", field: "deductionCapPassed", tsType: "boolean" },
      { column: "deduction_cap_rate", field: "deductionCapRate", tsType: "DecimalString" },
      { column: "deduction_type_cap_breaches", field: "deductionTypeCapBreaches", tsType: "string[]" },
      { column: "deduction_type_cap_passed", field: "deductionTypeCapPassed", tsType: "boolean" },
      { column: "fixed_amount", field: "fixedAmount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "gross_amount", field: "grossAmount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "id", field: "id", tsType: "UUID" },
      { column: "incentive_amount", field: "incentiveAmount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "incentive_change_rate", field: "incentiveChangeRate", tsType: "DecimalString" },
      { column: "minimum_monthly_wage", field: "minimumMonthlyWage", tsType: "DecimalString" },
      { column: "minimum_wage_passed", field: "minimumWagePassed", tsType: "boolean" },
      { column: "net_amount", field: "netAmount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "person_id", field: "personId", tsType: "UUID" },
      { column: "prior_incentive_amount", field: "priorIncentiveAmount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "run_id", field: "runId", tsType: "UUID" },
      { column: "smoothing_passed", field: "smoothingPassed", tsType: "boolean" },
      { column: "smoothing_threshold_rate", field: "smoothingThresholdRate", tsType: "DecimalString" },
      { column: "social_insurance_amount", field: "socialInsuranceAmount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "tax_amount", field: "taxAmount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "tenant_id", field: "tenantId", tsType: "UUID" },
      { column: "variable_share_cap_amount", field: "variableShareCapAmount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "variable_share_cap_rate", field: "variableShareCapRate", tsType: "DecimalString" },
      { column: "variable_share_passed", field: "variableSharePassed", tsType: "boolean" },
      { column: "variable_share_rate", field: "variableShareRate", tsType: "DecimalString" },
    ],
  },
  {
    table: "calculation_runs",
    typeName: "CalculationRun",
    columns: [
      { column: "blockers", field: "blockers", tsType: "string[]" },
      { column: "created_at", field: "createdAt", tsType: "string" },
      { column: "cycle_id", field: "cycleId", tsType: "UUID" },
      { column: "engine_version", field: "engineVersion", tsType: "string" },
      { column: "finished_at", field: "calculatedAt", tsType: "string", optional: true },
      { column: "id", field: "id", tsType: "UUID" },
      { column: "input_snapshot", field: "inputSnapshot", tsType: "CalculationInput", classification: "FINANCIAL" },
      { column: "input_snapshot_hash", field: "inputSnapshotHash", tsType: "string" },
      { column: "locked_at", field: "lockedAt", tsType: "string", optional: true },
      { column: "mode", field: "mode", tsType: "CalculationMode" },
      { column: "policy_version_id", field: "policyVersionId", tsType: "UUID" },
      { column: "requested_by", field: "requestedBy", tsType: "string", exposed: false },
      { column: "result_hash", field: "resultHash", tsType: "string", optional: true },
      { column: "started_at", field: "startedAt", tsType: "string", exposed: false },
      { column: "status", field: "status", tsType: "CalculationRunStatus" },
      { column: "tenant_id", field: "tenantId", tsType: "UUID" },
      { column: "updated_at", field: "updatedAt", tsType: "string", exposed: false },
      { column: "version", field: "version", tsType: "number", exposed: false },
      { column: "warnings", field: "warnings", tsType: "string[]" },
    ],
  },
  {
    table: "calculation_lines",
    typeName: "CalculationLine",
    columns: [
      { column: "base_amount", field: "baseAmount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "calculation_run_id", field: "calculationRunId", tsType: "UUID", exposed: false },
      { column: "created_at", field: "createdAt", tsType: "string", exposed: false },
      { column: "currency", field: "currency", tsType: "string" },
      { column: "id", field: "id", tsType: "UUID", exposed: false },
      { column: "incentive_type", field: "incentiveType", tsType: "string" },
      { column: "line_key", field: "lineKey", tsType: "string" },
      { column: "multiplier", field: "multiplier", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "person_id", field: "personId", tsType: "UUID" },
      { column: "raw_amount", field: "rawAmount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "result_hash", field: "resultHash", tsType: "string", exposed: false },
      { column: "rounded_amount", field: "roundedAmount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "tenant_id", field: "tenantId", tsType: "UUID", exposed: false },
      { column: "trace", field: "trace", tsType: "Record<string, unknown>", classification: "FINANCIAL" },
      { column: "work_package_id", field: "workPackageId", tsType: "UUID" },
    ],
  },
  {
    table: "amount_ledger",
    typeName: "AmountLedgerEntry",
    columns: [
      { column: "amount", field: "amount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "calculation_line_id", field: "calculationLineId", tsType: "UUID", optional: true },
      { column: "calculation_run_id", field: "calculationRunId", tsType: "UUID" },
      { column: "created_at", field: "createdAt", tsType: "string" },
      { column: "currency", field: "currency", tsType: "string" },
      { column: "cycle_id", field: "cycleId", tsType: "UUID" },
      { column: "entry_hash", field: "entryHash", tsType: "string", classification: "AUDIT" },
      { column: "entry_type", field: "entryType", tsType: "LedgerEntryType" },
      { column: "id", field: "id", tsType: "UUID" },
      { column: "idempotency_key", field: "idempotencyKey", tsType: "string" },
      { column: "ledger_seq", field: "ledgerSeq", tsType: "number", exposed: false },
      { column: "locked_at", field: "lockedAt", tsType: "string", optional: true },
      { column: "person_id", field: "personId", tsType: "UUID" },
      { column: "prev_hash", field: "prevHash", tsType: "string", classification: "AUDIT" },
      { column: "source_entry_id", field: "sourceEntryId", tsType: "UUID", optional: true },
      { column: "status", field: "status", tsType: "LedgerStatus" },
      { column: "tenant_id", field: "tenantId", tsType: "UUID" },
    ],
  },
  {
    table: "settlement_batches",
    typeName: "SettlementBatch",
    columns: [
      { column: "acknowledged_at", field: "acknowledgedAt", tsType: "string", optional: true },
      { column: "approved_at", field: "approvedAt", tsType: "string", optional: true },
      { column: "approved_by", field: "approvedBy", tsType: "UUID", optional: true },
      { column: "batch_no", field: "batchNo", tsType: "string" },
      { column: "created_at", field: "createdAt", tsType: "string" },
      { column: "currency", field: "currency", tsType: "string" },
      { column: "cycle_id", field: "cycleId", tsType: "UUID" },
      { column: "exported_at", field: "exportedAt", tsType: "string", optional: true },
      { column: "external_reference", field: "externalReference", tsType: "string", optional: true },
      { column: "id", field: "id", tsType: "UUID" },
      { column: "kind", field: "kind", tsType: "\"STANDARD\" | \"RECOVERY\"" },
      { column: "line_count", field: "lineCount", tsType: "number" },
      { column: "locked_at", field: "lockedAt", tsType: "string", optional: true },
      { column: "status", field: "status", tsType: "SettlementBatchStatus" },
      { column: "tenant_id", field: "tenantId", tsType: "UUID" },
      { column: "total_amount", field: "totalAmount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "updated_at", field: "updatedAt", tsType: "string" },
    ],
  },
  {
    table: "settlement_lines",
    typeName: "SettlementLine",
    columns: [
      { column: "active", field: "active", tsType: "boolean" },
      { column: "amount", field: "amount", tsType: "DecimalString", classification: "FINANCIAL" },
      { column: "batch_id", field: "batchId", tsType: "UUID" },
      { column: "created_at", field: "createdAt", tsType: "string" },
      { column: "currency", field: "currency", tsType: "string" },
      { column: "external_reference", field: "externalReference", tsType: "string", exposed: false },
      { column: "id", field: "id", tsType: "UUID" },
      { column: "ledger_id", field: "ledgerId", tsType: "UUID" },
      { column: "person_id", field: "personId", tsType: "UUID" },
      { column: "status", field: "status", tsType: "string" },
      { column: "tenant_id", field: "tenantId", tsType: "UUID" },
    ],
  },
  {
    table: "audit_events",
    typeName: "AuditEvent",
    columns: [
      { column: "action", field: "action", tsType: "string" },
      { column: "actor_id", field: "actorId", tsType: "UUID", optional: true, classification: "PII" },
      { column: "actor_type", field: "actorType", tsType: "\"USER\" | \"AGENT\" | \"SYSTEM\" | \"INTEGRATION\"" },
      { column: "after_hash", field: "afterHash", tsType: "string", optional: true, classification: "AUDIT" },
      { column: "before_hash", field: "beforeHash", tsType: "string", optional: true, classification: "AUDIT" },
      { column: "correlation_id", field: "correlationId", tsType: "UUID" },
      { column: "event_hash", field: "eventHash", tsType: "string", classification: "AUDIT" },
      { column: "id", field: "id", tsType: "UUID" },
      { column: "object_id", field: "objectId", tsType: "UUID", optional: true },
      { column: "object_type", field: "objectType", tsType: "string" },
      { column: "occurred_at", field: "occurredAt", tsType: "string" },
      { column: "prev_hash", field: "prevHash", tsType: "string", classification: "AUDIT" },
      { column: "reason", field: "reason", tsType: "string", optional: true },
      { column: "sequence", field: "sequence", tsType: "number" },
      { column: "source_ip", field: "sourceIp", tsType: "string", exposed: false, classification: "PII" },
      { column: "tenant_id", field: "tenantId", tsType: "UUID" },
    ],
  },
];

