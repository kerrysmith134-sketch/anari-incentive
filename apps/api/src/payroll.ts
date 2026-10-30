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
  totalTax: string;
  totalSocialInsurance: string;
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
  let totalTax = 0n;
  let totalSocialInsurance = 0n;
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
    const deductionOrder =
      contract.deductionOrder.length > 0
        ? contract.deductionOrder
        : ["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"];
    const priorityOf = (entryType: string): number => {
      const mapped =
        entryType === "RECOVERY" ||
        entryType === "REVERSAL" ||
        entryType === "ADJUSTMENT"
          ? entryType
          : "OTHER";
      const index = deductionOrder.indexOf(mapped);
      return index === -1 ? deductionOrder.length : index;
    };
    const negativeEntries = entries
      .filter((entry) => parseDecimal(entry.amount) < 0n)
      .sort((a, b) => priorityOf(a.entryType) - priorityOf(b.entryType));
    const breakdown = new Map<string, { amount: bigint; priority: number }>();
    for (const entry of entries) {
      const amount = parseDecimal(entry.amount);
      if (amount >= 0n) {
        incentive += amount;
        continue;
      }
      deductions += -amount;
    }
    for (const entry of negativeEntries) {
      const mapped =
        entry.entryType === "RECOVERY" ||
        entry.entryType === "REVERSAL" ||
        entry.entryType === "ADJUSTMENT"
          ? entry.entryType
          : "OTHER";
      const current = breakdown.get(mapped);
      const sum = (current?.amount ?? 0n) + -parseDecimal(entry.amount);
      breakdown.set(mapped, {
        amount: sum,
        priority: priorityOf(entry.entryType),
      });
    }
    const fixed = parseDecimal(contract.fixedMonthlySalary);
    const gross = fixed + incentive;
    const tax =
      (gross * parseDecimal(contract.taxRate || "0")) / 1_000_000n;
    const socialInsurance =
      (gross * parseDecimal(contract.socialInsuranceRate || "0")) /
      1_000_000n;
    const net = gross - deductions - tax - socialInsurance;
    const minimum = parseDecimal(contract.minimumMonthlyWage);
    const deductionCapRate = parseDecimal(
      contract.deductionCapRate || "0.2",
    );
    const deductionCapAmount = (gross * deductionCapRate) / 1_000_000n;
    const deductionCapPassed = deductions <= deductionCapAmount;
    const variableShareRate = gross > 0n ? (incentive * 1_000_000n) / gross : 0n;
    const variableShareCapRate = parseDecimal(
      contract.variableShareCapRate || "1",
    );
    const variableShareCapAmount =
      (gross * variableShareCapRate) / 1_000_000n;
    const variableSharePassed = incentive <= variableShareCapAmount;
    const deductionTypeCapBreaches: string[] = [];
    for (const [type, value] of breakdown.entries()) {
      const rate = contract.deductionTypeCaps[type];
      if (!rate) continue;
      const capRate = parseDecimal(rate);
      const capAmount = (gross * capRate) / 1_000_000n;
      if (value.amount > capAmount) {
        deductionTypeCapBreaches.push(type);
      }
    }
    const deductionTypeCapPassed =
      deductionTypeCapBreaches.length === 0;
    const minimumWagePassed = net >= minimum;
    const passed =
      minimumWagePassed &&
      deductionCapPassed &&
      variableSharePassed &&
      deductionTypeCapPassed;
    if (!passed) blockedCount += 1;
    totalGross += gross;
    totalDeductions += deductions + tax + socialInsurance;
    totalTax += tax;
    totalSocialInsurance += socialInsurance;
    totalNet += net;
    lines.push({
      personId: contract.personId,
      contractId: contract.id,
      currency: contract.currency,
      fixedAmount: formatDecimal(fixed),
      incentiveAmount: formatDecimal(incentive),
      grossAmount: formatDecimal(gross),
      deductionAmount: formatDecimal(deductions),
      taxAmount: formatDecimal(tax),
      socialInsuranceAmount: formatDecimal(socialInsurance),
      netAmount: formatDecimal(net),
      minimumMonthlyWage: contract.minimumMonthlyWage,
      minimumWagePassed,
      deductionCapRate: formatDecimal(deductionCapRate),
      deductionCapAmount: formatDecimal(deductionCapAmount),
      deductionCapPassed,
      variableShareRate: formatDecimal(variableShareRate),
      variableShareCapRate: formatDecimal(variableShareCapRate),
      variableShareCapAmount: formatDecimal(variableShareCapAmount),
      variableSharePassed,
      deductionTypeCapPassed,
      deductionTypeCapBreaches,
      deductionBreakdown: [...breakdown.entries()]
        .sort((a, b) => a[1].priority - b[1].priority)
        .map(([type, value]) => ({
          type,
          amount: formatDecimal(value.amount),
          priority: value.priority,
        })),
      bankAccountRef: contract.bankAccountRef,
    });
  }

  return {
    lines,
    totalGross: formatDecimal(totalGross),
    totalDeductions: formatDecimal(totalDeductions),
    totalTax: formatDecimal(totalTax),
    totalSocialInsurance: formatDecimal(totalSocialInsurance),
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
    "run_id,person_id,currency,fixed_amount,incentive_amount,gross_amount,deductions,tax,social_insurance,net_amount,minimum_wage,minimum_wage_passed,deduction_cap_rate,deduction_cap_amount,deduction_cap_passed,variable_share_rate,variable_share_cap_rate,variable_share_cap_amount,variable_share_passed,deduction_breakdown,deduction_type_cap_passed,deduction_type_cap_breaches,bank_account_ref";
  const rows = (run.lines ?? []).map((line) =>
    [
      run.id,
      line.personId,
      line.currency,
      line.fixedAmount,
      line.incentiveAmount,
      line.grossAmount,
      line.deductionAmount,
      line.taxAmount,
      line.socialInsuranceAmount,
      line.netAmount,
      line.minimumMonthlyWage,
      line.minimumWagePassed,
      line.deductionCapRate,
      line.deductionCapAmount,
      line.deductionCapPassed,
      line.variableShareRate,
      line.variableShareCapRate,
      line.variableShareCapAmount,
      line.variableSharePassed,
      line.deductionBreakdown
        .map((item) => `${item.type}:${item.amount}`)
        .join("|"),
      line.deductionTypeCapPassed,
      line.deductionTypeCapBreaches.join("|"),
      line.bankAccountRef,
    ]
      .map(csvField)
      .join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

export function payrollBankFileCsv(run: PayrollRun): string {
  const header = "run_id,person_id,currency,net_amount,bank_account_ref";
  const rows = (run.lines ?? []).map((line) =>
    [run.id, line.personId, line.currency, line.netAmount, line.bankAccountRef]
      .map(csvField)
      .join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

export function payrollPayslipHtml(
  run: PayrollRun,
  line: PayrollLine,
): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Payslip ${escapeHtml(line.personId)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:32px auto;color:#111}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}</style>
</head><body>
<h1>Payslip</h1>
<p>Run ${escapeHtml(run.id)} · Cycle ${escapeHtml(run.cycleId)} · ${escapeHtml(run.periodStart)} – ${escapeHtml(run.periodEnd)}</p>
<table>
<tr><th>Person</th><td>${escapeHtml(line.personId)}</td></tr>
<tr><th>Currency</th><td>${escapeHtml(line.currency)}</td></tr>
<tr><th>Fixed</th><td>${escapeHtml(line.fixedAmount)}</td></tr>
<tr><th>Incentive</th><td>${escapeHtml(line.incentiveAmount)}</td></tr>
<tr><th>Gross</th><td>${escapeHtml(line.grossAmount)}</td></tr>
<tr><th>Ledger deductions</th><td>${escapeHtml(line.deductionAmount)}</td></tr>
<tr><th>Tax</th><td>${escapeHtml(line.taxAmount)}</td></tr>
<tr><th>Social insurance</th><td>${escapeHtml(line.socialInsuranceAmount)}</td></tr>
<tr><th>Net</th><td><strong>${escapeHtml(line.netAmount)}</strong></td></tr>
<tr><th>Minimum wage</th><td>${escapeHtml(line.minimumMonthlyWage)} (${line.minimumWagePassed ? "passed" : "FAILED"})</td></tr>
<tr><th>Deduction cap</th><td>${escapeHtml(line.deductionCapAmount)} at ${escapeHtml(line.deductionCapRate)} (${line.deductionCapPassed ? "passed" : "FAILED"})</td></tr>
<tr><th>Variable share</th><td>${escapeHtml(line.variableShareRate)} at cap ${escapeHtml(line.variableShareCapRate)} (${line.variableSharePassed ? "passed" : "FAILED"})</td></tr>
</table>
</body></html>`;
}
