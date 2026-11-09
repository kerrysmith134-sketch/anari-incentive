import type {
  AmountLedgerEntry,
  EmploymentContract,
  PayrollLine,
  PayrollRun,
} from "@anari/domain";
import { divRound, formatDecimal, parseDecimal } from "@anari/policy-dsl";
import {
  CHINA_IIT_MONTHLY_BASIC_DEDUCTION,
  calculateCumulativeIit,
} from "@anari/payroll-tax";

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
export type PayrollTaxMode = "DECLARED" | "STATUTORY_CN";

/** Tenant-configurable statutory deduction classification (LG-06). */
export interface StatutoryDeductionTypeRule {
  type: string;
  priority: number;
  requiresCourtOrder?: boolean;
  requiresConsent?: boolean;
  capRate?: string;
}

interface DeductionBreakdownAccumulator {
  amount: bigint;
  priority: number;
  statutory?: boolean;
  requiresCourtOrder?: boolean;
  requiresConsent?: boolean;
}

export function calculatePayroll(input: {
  contracts: EmploymentContract[];
  ledger: AmountLedgerEntry[];
  priorIncentives?: Record<string, string>;
  /** Required notices the person has not acknowledged, by person id. */
  unacknowledgedNoticesByPerson?: Record<string, string[]>;
  /**
   * DECLARED keeps the contract rate; STATUTORY_CN switches withholding to
   * the China resident cumulative method using prior year-to-date amounts.
   */
  taxMode?: PayrollTaxMode;
  /** Year-to-date amounts per person from PAID runs in the same calendar year. */
  priorYtd?: Record<
    string,
    { taxableIncome: string; taxWithheld: string }
  >;
  /** Statutory deduction type registry from tenant settings (LG-06). */
  statutoryDeductionTypes?: StatutoryDeductionTypeRule[];
  cycleId: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
}): PayrollCalculation {
  const taxMode: PayrollTaxMode = input.taxMode ?? "DECLARED";
  const basicDeduction = parseDecimal(CHINA_IIT_MONTHLY_BASIC_DEDUCTION);
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
    const classify = (entryType: string): string => {
      if (
        entryType === "RECOVERY" ||
        entryType === "REVERSAL" ||
        entryType === "ADJUSTMENT"
      ) {
        return entryType;
      }
      // LG-06：注册过的法定扣款类型必须保留原类型，不能一律折叠为 OTHER，
      // 否则逐类型上限/执行令/同意门禁永远不会命中。
      return input.statutoryDeductionTypes?.some(
        (rule) => rule.type === entryType,
      )
        ? entryType
        : "OTHER";
    };
    const priorityOf = (entryType: string): number => {
      const index = deductionOrder.indexOf(classify(entryType));
      return index === -1 ? deductionOrder.length : index;
    };
    const negativeEntries = entries
      .filter((entry) => parseDecimal(entry.amount) < 0n)
      .sort((a, b) => priorityOf(a.entryType) - priorityOf(b.entryType));
    const breakdown = new Map<string, DeductionBreakdownAccumulator>();
    for (const entry of entries) {
      const amount = parseDecimal(entry.amount);
      if (amount >= 0n) {
        incentive += amount;
        continue;
      }
      deductions += -amount;
    }
    for (const entry of negativeEntries) {
      const mapped = classify(entry.entryType);
      const current = breakdown.get(mapped);
      const sum = (current?.amount ?? 0n) + -parseDecimal(entry.amount);
      breakdown.set(mapped, {
        amount: sum,
        priority: priorityOf(entry.entryType),
      });
    }
    const fixed = parseDecimal(contract.fixedMonthlySalary);
    const gross = fixed + incentive;
    const socialInsurance =
      (gross * parseDecimal(contract.socialInsuranceRate || "0")) /
      1_000_000n;
    let tax: bigint;
    let taxCalculationMode: PayrollTaxMode = taxMode;
    let ytdTaxableIncome: bigint | undefined;
    let ytdTaxWithheld: bigint | undefined;
    let iitRatePercent: number | undefined;
    let iitQuickDeduction: string | undefined;
    if (taxMode === "STATUTORY_CN") {
      // Cumulative withholding method for resident comprehensive income:
      // cumulative taxable = prior YTD + (gross - social insurance - basic).
      const prior = input.priorYtd?.[contract.personId];
      const monthlyTaxable = gross - socialInsurance - basicDeduction;
      const cumulative =
        parseDecimal(prior?.taxableIncome ?? "0") + monthlyTaxable;
      const statutory = calculateCumulativeIit({
        cumulativeTaxableIncome: formatDecimal(cumulative),
        taxAlreadyWithheld: prior?.taxWithheld,
      });
      tax = parseDecimal(statutory.taxForPeriod);
      ytdTaxableIncome = cumulative;
      ytdTaxWithheld =
        parseDecimal(statutory.taxAlreadyWithheld) + tax;
      iitRatePercent = statutory.ratePercent;
      iitQuickDeduction = statutory.quickDeduction;
    } else {
      taxCalculationMode = "DECLARED";
      tax =
        (gross * parseDecimal(contract.taxRate || "0")) / 1_000_000n;
    }
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
      const rule = input.statutoryDeductionTypes?.find(
        (candidate) => candidate.type === type,
      );
      if (rule) {
        value.statutory = true;
        value.requiresCourtOrder = rule.requiresCourtOrder ?? false;
        value.requiresConsent = rule.requiresConsent ?? false;
        value.priority = rule.priority;
      }
      const rate = contract.deductionTypeCaps[type] ?? rule?.capRate;
      if (!rate) continue;
      const capRate = parseDecimal(rate);
      const capAmount = (gross * capRate) / 1_000_000n;
      if (value.amount > capAmount) {
        deductionTypeCapBreaches.push(type);
      }
    }
    const deductionTypeCapPassed =
      deductionTypeCapBreaches.length === 0;
    const priorIncentive = parseDecimal(
      input.priorIncentives?.[contract.id] ?? "0",
    );
    const incentiveChangeRate =
      priorIncentive === 0n
        ? incentive > 0n
          ? 1_000_000n
          : 0n
        : ((incentive >= priorIncentive
            ? incentive - priorIncentive
            : priorIncentive - incentive) *
            1_000_000n) /
          priorIncentive;
    const smoothingThresholdRate = parseDecimal(
      contract.smoothingThresholdRate || "1",
    );
    const smoothingPassed =
      priorIncentive === 0n ||
      incentiveChangeRate <= smoothingThresholdRate;
    const minimumWagePassed = net >= minimum;
    const noticeAcknowledgementMissing =
      input.unacknowledgedNoticesByPerson?.[contract.personId] ?? [];
    const noticeAcknowledgementPassed =
      noticeAcknowledgementMissing.length === 0;
    const passed =
      minimumWagePassed &&
      deductionCapPassed &&
      variableSharePassed &&
      deductionTypeCapPassed &&
      smoothingPassed &&
      noticeAcknowledgementPassed;
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
      priorIncentiveAmount: formatDecimal(priorIncentive),
      incentiveChangeRate: formatDecimal(incentiveChangeRate),
      smoothingThresholdRate: formatDecimal(smoothingThresholdRate),
      smoothingPassed,
      noticeAcknowledgementPassed,
      noticeAcknowledgementMissing,
      deductionBreakdown: [...breakdown.entries()]
        .sort((a, b) => a[1].priority - b[1].priority)
        .map(([type, value]) => ({
          type,
          amount: formatDecimal(value.amount),
          priority: value.priority,
          statutory: value.statutory,
          requiresCourtOrder: value.requiresCourtOrder,
          requiresConsent: value.requiresConsent,
        })),
      bankAccountRef: contract.bankAccountRef,
      taxCalculationMode,
      ytdTaxableIncome:
        ytdTaxableIncome === undefined
          ? undefined
          : formatDecimal(ytdTaxableIncome),
      ytdTaxWithheld:
        ytdTaxWithheld === undefined
          ? undefined
          : formatDecimal(ytdTaxWithheld),
      iitRatePercent,
      iitQuickDeduction,
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

function csvField(value: unknown, protectFormula = true): string {
  let text = value === undefined || value === null ? "" : String(value);
  // A plain decimal number can never be a spreadsheet formula, so it must
  // keep its sign (negative RECOVERY nets are legitimate money); anything
  // else starting with a formula trigger still gets the "'" guard.
  const plainNumber = /^-?\d+(\.\d+)?$/;
  if (
    protectFormula &&
    /^[=+\-@\t\r]/.test(text) &&
    !plainNumber.test(text)
  ) {
    text = `'${text}`;
  }
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Numeric columns carry validated decimals; formula protection would mangle
 * legitimate negative amounts (e.g. RECOVERY nets), so they opt out. */
const csvMoney = (value: unknown): string => csvField(value, false);

export function payrollCsv(run: PayrollRun): string {
  const header =
    "run_id,person_id,currency,fixed_amount,incentive_amount,gross_amount,deductions,tax,social_insurance,net_amount,minimum_wage,minimum_wage_passed,deduction_cap_rate,deduction_cap_amount,deduction_cap_passed,variable_share_rate,variable_share_cap_rate,variable_share_cap_amount,variable_share_passed,deduction_breakdown,deduction_type_cap_passed,deduction_type_cap_breaches,prior_incentive,incentive_change_rate,smoothing_threshold,smoothing_passed,bank_account_ref";
  const rows = (run.lines ?? []).map((line) =>
    [
      run.id,
      line.personId,
      line.currency,
      csvMoney(line.fixedAmount),
      csvMoney(line.incentiveAmount),
      csvMoney(line.grossAmount),
      csvMoney(line.deductionAmount),
      csvMoney(line.taxAmount),
      csvMoney(line.socialInsuranceAmount),
      csvMoney(line.netAmount),
      csvMoney(line.minimumMonthlyWage),
      line.minimumWagePassed,
      csvMoney(line.deductionCapRate),
      csvMoney(line.deductionCapAmount),
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
      line.priorIncentiveAmount,
      line.incentiveChangeRate,
      line.smoothingThresholdRate,
      line.smoothingPassed,
      line.bankAccountRef,
    ]
      .map((field) => csvField(field))
      .join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

export type BankFileFormat = "GENERIC" | "ICBC" | "CMB";

export function payrollBankFileCsv(
  run: PayrollRun,
  format: BankFileFormat = "GENERIC",
): string {
  if (format === "ICBC") {
    // ICBC-style batch sheet: amount in fen, one row per person. Bank branch
    // templates vary; treat this as the configurable starting point.
    const header =
      "seq,person_id,currency,net_amount_fen,bank_account_ref,remark";
    const rows = (run.lines ?? []).map((line, index) =>
      [
        index + 1,
        line.personId,
        line.currency,
        csvMoney(
          divRound(parseDecimal(line.netAmount), 10_000n, "HALF_UP").toString(),
        ),
        line.bankAccountRef,
        `payroll ${run.id}`,
      ]
        .map((field) => csvField(field))
        .join(","),
    );
    return [header, ...rows].join("\n") + "\n";
  }
  if (format === "CMB") {
    // CMB-style corporate payroll upload: name column retained for the bank,
    // amount in yuan with two decimals.
    const header = "person_id,currency,net_amount,bank_account_ref,pay_type";
    const rows = (run.lines ?? []).map((line) =>
      [
        line.personId,
        line.currency,
        csvMoney(line.netAmount),
        line.bankAccountRef,
        "SALARY",
      ]
        .map((field) => csvField(field))
        .join(","),
    );
    return [header, ...rows].join("\n") + "\n";
  }
  const header = "run_id,person_id,currency,net_amount,bank_account_ref";
  const rows = (run.lines ?? []).map((line) =>
    [run.id, line.personId, line.currency, csvMoney(line.netAmount), line.bankAccountRef]
      .map((field) => csvField(field))
      .join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

/**
 * China individual income tax filing export (cumulative withholding method).
 * One row per payroll line with the monthly and year-to-date figures the
 * declaration front-end requires; DECLARED-mode rows are included with their
 * mode flagged so finance can reconcile both regimes.
 */
export function payrollTaxFilingCsv(run: PayrollRun): string {
  const header = [
    "person_id",
    "currency",
    "tax_mode",
    "gross_amount",
    "social_insurance",
    "basic_deduction",
    "monthly_taxable_income",
    "ytd_taxable_income",
    "ytd_tax_withheld",
    "iit_rate_percent",
    "iit_quick_deduction",
    "tax_withheld_this_period",
  ].join(",");
  const basicDeduction = CHINA_IIT_MONTHLY_BASIC_DEDUCTION;
  const rows = (run.lines ?? []).map((line) => {
    const mode = line.taxCalculationMode ?? "DECLARED";
    const social = parseDecimal(line.socialInsuranceAmount);
    const gross = parseDecimal(line.grossAmount);
    const monthlyTaxable = gross - social - parseDecimal(basicDeduction);
    return [
      line.personId,
      line.currency,
      mode,
      csvMoney(line.grossAmount),
      csvMoney(line.socialInsuranceAmount),
      csvMoney(basicDeduction),
      mode === "STATUTORY_CN"
        ? formatDecimal(monthlyTaxable > 0n ? monthlyTaxable : 0n)
        : "",
      csvMoney(line.ytdTaxableIncome ?? ""),
      csvMoney(line.ytdTaxWithheld ?? ""),
      line.iitRatePercent ?? "",
      csvMoney(line.iitQuickDeduction ?? ""),
      csvMoney(line.taxAmount),
    ]
      .map((field) => csvField(field))
      .join(",");
  });
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
