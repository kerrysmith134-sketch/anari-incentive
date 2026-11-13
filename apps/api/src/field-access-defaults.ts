import type { FieldAccessPolicy } from "@anari/contracts";

export const DEFAULT_PAYROLL_FIELD_POLICIES: Record<string, string[]> = {
  "PAYROLL_LINE.bankAccountRef": ["finance", "admin"],
};

export const DEFAULT_FIELD_ACCESS_POLICIES: Record<string, FieldAccessPolicy> = {
  ...DEFAULT_PAYROLL_FIELD_POLICIES,
  "CALCULATION_LINE.baseAmount": ["finance", "admin"],
  "CALCULATION_LINE.rawAmount": ["finance", "admin"],
  "CALCULATION_LINE.roundedAmount": ["finance", "admin"],
  "CALCULATION_LINE.multiplier": ["finance", "admin"],
  "CALCULATION_LINE.trace": ["finance", "admin"],
  "EMPLOYMENT_CONTRACT.bankAccountRef": ["finance", "admin"],
  "EVIDENCE.normalizedPayload": ["manager", "finance", "admin"],
  "EVIDENCE.sourceUri": ["manager", "finance", "admin"],
  "SETTLEMENT_LINE.amount": ["manager", "finance", "admin"],
  "SETTLEMENT_LINE.personName": ["manager", "finance", "admin"],
  "SETTLEMENT_LINE.personCode": ["manager", "finance", "admin"],
  "AI_PROPOSAL.scores": ["manager", "finance", "admin"],
  "AI_PROPOSAL.rationale": ["manager", "finance", "admin"],
  "AI_PROPOSAL.gateMetrics": ["manager", "finance", "admin"],
};
