import type {
  AttributionDecision,
  CalculationLine,
  CalculationMode,
  CalculationRun,
  ContributionClaim,
  EmployeeConfirmation,
  LegalGate,
} from "./types.js";

export class InvariantViolationError extends Error {
  readonly code = "INVARIANT_VIOLATION";

  constructor(
    readonly invariant: string,
    message: string,
  ) {
    super(`${invariant}: ${message}`);
    this.name = "InvariantViolationError";
  }
}

/**
 * Formal calculations require an explicit legal gate. Shadow calculations do
 * not create payment effects and may run before the gate is complete.
 *
 * The product records and enforces these references; it does not claim that
 * their existence makes the underlying policy lawful. That remains a tenant /
 * legal-counsel responsibility.
 */
export function legalGateBlockers(
  mode: CalculationMode,
  gate: LegalGate | undefined,
): string[] {
  if (mode === "SHADOW") return [];
  if (!gate) return ["LEGAL_GATE_MISSING"];

  const blockers: string[] = [];
  if (!gate.policyApproved) blockers.push("POLICY_NOT_APPROVED");
  if (!gate.minimumWageChecked) blockers.push("MINIMUM_WAGE_NOT_CHECKED");
  if (!gate.democraticProcedureRef)
    blockers.push("DEMOCRATIC_PROCEDURE_MISSING");
  if (!gate.employeeNoticeRef) blockers.push("EMPLOYEE_NOTICE_MISSING");
  if (!gate.dataProtectionAssessmentRef)
    blockers.push("DATA_PROTECTION_ASSESSMENT_MISSING");
  return blockers;
}

export function assertAdjudicatorIsNotClaimant(
  claim: ContributionClaim,
  decision: Pick<AttributionDecision, "adjudicatorPersonId">,
): void {
  if (claim.claimantPersonId === decision.adjudicatorPersonId) {
    throw new InvariantViolationError(
      "ADJUDICATOR_IS_CLAIMANT",
      "a claimant cannot issue the formal attribution decision on their own claim",
    );
  }
}

export function assertReviewerIsNotSubject(
  reviewerPersonId: string,
  subjectPersonId: string,
): void {
  if (reviewerPersonId === subjectPersonId) {
    throw new InvariantViolationError(
      "REVIEWER_IS_SUBJECT",
      "a reviewer cannot decide an appeal or evaluation about themselves",
    );
  }
}

export function calculationLineKey(line: CalculationLine): string {
  return [
    line.personId,
    line.workPackageId,
    line.incentiveType,
    line.currency,
  ].join(":");
}

export function assertUniqueCalculationLines(lines: CalculationLine[]): void {
  const seen = new Set<string>();
  for (const line of lines) {
    const key = calculationLineKey(line);
    if (seen.has(key)) {
      throw new InvariantViolationError(
        "DUPLICATE_CALCULATION_LINE",
        `duplicate calculation line for ${key}`,
      );
    }
    seen.add(key);
  }
}

export function assertSameCurrency(
  lines: CalculationLine[],
  currency: string,
): void {
  for (const line of lines) {
    if (line.currency !== currency) {
      throw new InvariantViolationError(
        "CURRENCY_MISMATCH",
        `line currency ${line.currency} does not match ${currency}`,
      );
    }
  }
}

/**
 * A FORMAL run may not be locked until every participant has confirmed the
 * calculation. An objection blocks locking and must go through appeal /
 * recalculation rather than being silently overridden.
 */
export function confirmationBlockers(
  run: Pick<CalculationRun, "id" | "mode" | "lines">,
  confirmations: EmployeeConfirmation[],
): string[] {
  if (run.mode !== "FORMAL") return [];
  const blockers: string[] = [];
  for (const line of run.lines) {
    const confirmation = confirmations.find(
      (candidate) =>
        candidate.personId === line.personId &&
        candidate.targetType === "CALCULATION" &&
        candidate.targetId === run.id,
    );
    if (!confirmation || confirmation.decision === "VIEWED") {
      blockers.push(`MISSING_EMPLOYEE_CONFIRMATION:${line.personId}`);
    } else if (confirmation.decision === "OBJECTED") {
      blockers.push(`EMPLOYEE_OBJECTION:${line.personId}`);
    }
  }
  return blockers;
}
