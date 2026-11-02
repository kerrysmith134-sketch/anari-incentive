/**
 * AUTO-GENERATED from packages/domain/src/entity-contracts.ts.
 * Run `npm run contracts:entities`; do not edit by hand.
 */

import type { CalculationRunStatus, SettlementBatchStatus } from "./states.js";
import type { CalculationInput, CalculationMode, DecimalString, EmploymentContractStatus, EmploymentType, LedgerEntryType, LedgerStatus, PayrollRunStatus, UUID } from "./types.js";

export interface EmploymentContractPersisted {
  bankAccountRef?: string;
  compensationTemplateCode?: string;
  consentSignatureRef: string;
  consentSignedAt: string;
  contractCode: string;
  createdAt: string;
  currency: string;
  deductionCapRate: DecimalString;
  deductionOrder: string[];
  deductionTypeCaps: Record<string, DecimalString>;
  employmentType: EmploymentType;
  endDate?: string;
  fixedMonthlySalary: DecimalString;
  id: UUID;
  legalEntity?: string;
  minimumMonthlyWage: DecimalString;
  payPlanVersion: number;
  personId: UUID;
  smoothingThresholdRate: DecimalString;
  socialInsuranceRate: DecimalString;
  startDate: string;
  status: EmploymentContractStatus;
  taxRate: DecimalString;
  tenantId: UUID;
  updatedAt: string;
  variableShareCapRate: DecimalString;
  version: number;
  workLocation: string;
}

export interface PayrollRunPersisted {
  approvedAt?: string;
  approvedBy?: UUID;
  blockedCount: number;
  createdAt: string;
  currency: string;
  cycleId: UUID;
  id: UUID;
  lineCount: number;
  paidAt?: string;
  periodEnd: string;
  periodStart: string;
  preparedBy: UUID;
  reversalReason?: string;
  reversedAt?: string;
  reversedBy?: UUID;
  status: PayrollRunStatus;
  tenantId: UUID;
  totalDeductions: DecimalString;
  totalGross: DecimalString;
  totalNet: DecimalString;
  totalSocialInsurance: DecimalString;
  totalTax: DecimalString;
  updatedAt: string;
  version: number;
}

export interface PayrollLinePersisted {
  bankAccountRef?: string;
  contractId: UUID;
  createdAt: string;
  currency: string;
  deductionAmount: DecimalString;
  deductionBreakdown: Array<{ type: string; amount: DecimalString; priority: number; }>;
  deductionCapAmount: DecimalString;
  deductionCapPassed: boolean;
  deductionCapRate: DecimalString;
  deductionTypeCapBreaches: string[];
  deductionTypeCapPassed: boolean;
  fixedAmount: DecimalString;
  grossAmount: DecimalString;
  id: UUID;
  incentiveAmount: DecimalString;
  incentiveChangeRate: DecimalString;
  minimumMonthlyWage: DecimalString;
  minimumWagePassed: boolean;
  netAmount: DecimalString;
  personId: UUID;
  priorIncentiveAmount: DecimalString;
  runId: UUID;
  smoothingPassed: boolean;
  smoothingThresholdRate: DecimalString;
  socialInsuranceAmount: DecimalString;
  taxAmount: DecimalString;
  tenantId: UUID;
  variableShareCapAmount: DecimalString;
  variableShareCapRate: DecimalString;
  variableSharePassed: boolean;
  variableShareRate: DecimalString;
}

export interface CalculationRunPersisted {
  blockers: string[];
  createdAt: string;
  cycleId: UUID;
  engineVersion: string;
  calculatedAt?: string;
  id: UUID;
  inputSnapshot: CalculationInput;
  inputSnapshotHash: string;
  lockedAt?: string;
  mode: CalculationMode;
  policyVersionId: UUID;
  resultHash?: string;
  status: CalculationRunStatus;
  tenantId: UUID;
  warnings: string[];
}

export interface CalculationLinePersisted {
  baseAmount: DecimalString;
  currency: string;
  incentiveType: string;
  lineKey: string;
  multiplier: DecimalString;
  personId: UUID;
  rawAmount: DecimalString;
  roundedAmount: DecimalString;
  trace: Record<string, unknown>;
  workPackageId: UUID;
}

export interface AmountLedgerEntryPersisted {
  amount: DecimalString;
  calculationLineId?: UUID;
  calculationRunId: UUID;
  createdAt: string;
  currency: string;
  cycleId: UUID;
  entryHash: string;
  entryType: LedgerEntryType;
  id: UUID;
  idempotencyKey: string;
  lockedAt?: string;
  personId: UUID;
  prevHash: string;
  sourceEntryId?: UUID;
  status: LedgerStatus;
  tenantId: UUID;
}

export interface SettlementBatchPersisted {
  acknowledgedAt?: string;
  approvedAt?: string;
  approvedBy?: UUID;
  batchNo: string;
  createdAt: string;
  currency: string;
  cycleId: UUID;
  exportedAt?: string;
  externalReference?: string;
  id: UUID;
  kind: "STANDARD" | "RECOVERY";
  lineCount: number;
  lockedAt?: string;
  status: SettlementBatchStatus;
  tenantId: UUID;
  totalAmount: DecimalString;
  updatedAt: string;
}

export interface SettlementLinePersisted {
  active: boolean;
  amount: DecimalString;
  batchId: UUID;
  createdAt: string;
  currency: string;
  id: UUID;
  ledgerId: UUID;
  personId: UUID;
  status: string;
  tenantId: UUID;
}

export interface AuditEventPersisted {
  action: string;
  actorId?: UUID;
  actorType: "USER" | "AGENT" | "SYSTEM" | "INTEGRATION";
  afterHash?: string;
  beforeHash?: string;
  correlationId: UUID;
  eventHash: string;
  id: UUID;
  objectId?: UUID;
  objectType: string;
  occurredAt: string;
  prevHash: string;
  reason?: string;
  sequence: number;
  tenantId: UUID;
}
