import type {
  AmountLedgerEntry,
  EmploymentContract,
  PayrollLine,
  PayrollRun,
} from "@anari/domain";
import { formatDecimal, parseDecimal } from "@anari/policy-dsl";

export type PayrollCalculatedLine = Omit<
  PayrollLine,
  "id" | "tenantId" | "runId" | "createdAt"
>;

export interface PayrollCalculation {
  lines: PayrollCalculatedLine[];
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  blockedCount: number;
}

/**
 * Compute a payroll run from declared employment contracts and locked ledger
 * entries. This is a declaration-based minimum-wage guard, not a payroll
 * integration: fixed salary and the legal minimum come from the contract.
 */
export function calculatePayroll(input: {
  contracts: EmploymentContract[];
  ledger: AmountLedgerEntry[];
  cycleId: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
}): PayrollCalculation {
  const periodStart = Date.parse(input.periodStart);
  const periodEnd = Date.parse(input.periodEnd);
  const lines: PayrollCalculatedLine[] = [];
  let totalGross = 0n;
  let totalDeductions = 0n;
  let totalNet = 0n;
  let blockedCount = 0;

  for (const contract of input.contracts) {
    if (contract.status !== "ACTIVE") continue;
    if (contract.currency !== input.currency) continue;
    if (Date.parse(contract.startDate) > periodEnd) continue;
    if (contract.endDate && Date.parse(contract.endDate) < periodStart) {
      continue;
    }
    const entries = input.ledger.filter(
      (entry) =>
        entry.personId === contract.personId &&
        entry.cycleId === input.cycleId &&
        entry.currency === input.currency &&
        entry.status === "LOCKED",
    );
    let incentive = 0n;
    let deductions = 0n;
    for (const entry of entries) {
      const amount = parseDecimal(entry.amount);
      if (amount >= 0n) incentive += amount;
      else deductions += -amount;
    }
    const fixed = parseDecimal(contract.fixedMonthlySalary);
    const gross = fixed + incentive;
    const net = gross - deductions;
    const minimum = parseDecimal(contract.minimumMonthlyWage);
    const passed = net >= minimum;
    if (!passed) blockedCount += 1;
    totalGross += gross;
    totalDeductions += deductions;
    totalNet += net;
    lines.push({
      personId: contract.personId,
      contractId: contract.id,
      currency: contract.currency,
      fixedAmount: formatDecimal(fixed),
      incentiveAmount: formatDecimal(incentive),
      grossAmount: formatDecimal(gross),
      deductionAmount: formatDecimal(deductions),
      netAmount: formatDecimal(net),
      minimumMonthlyWage: contract.minimumMonthlyWage,
      minimumWagePassed: passed,
    });
  }

  return {
    lines,
    totalGross: formatDecimal(totalGross),
    totalDeductions: formatDecimal(totalDeductions),
    totalNet: formatDecimal(totalNet),
    blockedCount,
  };
}

function csvField(value: unknown): string {
  let text = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function payrollCsv(run: PayrollRun): string {
  const header =
    "run_id,person_id,currency,fixed_amount,incentive_amount,gross_amount,deductions,net_amount,minimum_wage,minimum_wage_passed";
  const rows = (run.lines ?? []).map((line) =>
    [
      run.id,
      line.personId,
      line.currency,
      line.fixedAmount,
      line.incentiveAmount,
      line.grossAmount,
      line.deductionAmount,
      line.netAmount,
      line.minimumMonthlyWage,
      line.minimumWagePassed,
    ]
      .map(csvField)
      .join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}
