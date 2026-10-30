import { divRound, formatDecimal, parseDecimal } from "@anari/policy-dsl";

/**
 * China resident comprehensive-income withholding brackets (annualized).
 * Source: public Individual Income Tax Law / withholding rate table.
 * The engine is parameterised so a tenant can replace the table if its
 * jurisdiction or policy differs; this is not tax advice.
 */
export interface ProgressiveTaxBracket {
  /** Upper bound of cumulative taxable income in CNY; null = unbounded. */
  upTo: string | null;
  /** Percentage rate, e.g. 3 for 3%. */
  ratePercent: number;
  /** Quick deduction in CNY. */
  quickDeduction: string;
}

export const CHINA_IIT_ANNUAL_BRACKETS: ProgressiveTaxBracket[] = [
  { upTo: "36000", ratePercent: 3, quickDeduction: "0" },
  { upTo: "144000", ratePercent: 10, quickDeduction: "2520" },
  { upTo: "300000", ratePercent: 20, quickDeduction: "16920" },
  { upTo: "420000", ratePercent: 25, quickDeduction: "31920" },
  { upTo: "660000", ratePercent: 30, quickDeduction: "52920" },
  { upTo: "960000", ratePercent: 35, quickDeduction: "85920" },
  { upTo: null, ratePercent: 45, quickDeduction: "181920" },
];

export const CHINA_IIT_MONTHLY_BASIC_DEDUCTION = "5000";

export interface CumulativeIitInput {
  cumulativeTaxableIncome: string;
  taxAlreadyWithheld?: string;
  brackets?: ProgressiveTaxBracket[];
}

export interface CumulativeIitResult {
  cumulativeTaxableIncome: string;
  annualTaxDue: string;
  taxAlreadyWithheld: string;
  taxForPeriod: string;
  ratePercent: number;
  quickDeduction: string;
}

export function calculateCumulativeIit(
  input: CumulativeIitInput,
): CumulativeIitResult {
  const brackets = input.brackets ?? CHINA_IIT_ANNUAL_BRACKETS;
  const income = parseDecimal(input.cumulativeTaxableIncome);
  const already = parseDecimal(input.taxAlreadyWithheld ?? "0");
  if (income <= 0n) {
    return {
      cumulativeTaxableIncome: "0",
      annualTaxDue: "0",
      taxAlreadyWithheld: formatDecimal(already > 0n ? already : 0n),
      taxForPeriod: "0",
      ratePercent: 0,
      quickDeduction: "0",
    };
  }

  const bracket =
    brackets.find(
      (candidate) =>
        candidate.upTo === null ||
        income <= parseDecimal(candidate.upTo),
    ) ?? brackets[brackets.length - 1]!;
  const computedTax =
    (income * BigInt(bracket.ratePercent)) / 100n -
    parseDecimal(bracket.quickDeduction);
  const positiveTax = computedTax > 0n ? computedTax : 0n;
  // Statutory withholding is payable in fen (0.01 CNY).
  const annualTaxDue = divRound(positiveTax, 10_000n, "HALF_UP") * 10_000n;
  const taxForPeriod =
    annualTaxDue > already ? annualTaxDue - already : 0n;

  return {
    cumulativeTaxableIncome: formatDecimal(income),
    annualTaxDue: formatDecimal(annualTaxDue),
    taxAlreadyWithheld: formatDecimal(already > 0n ? already : 0n),
    taxForPeriod: formatDecimal(taxForPeriod),
    ratePercent: bracket.ratePercent,
    quickDeduction: bracket.quickDeduction,
  };
}

export interface MonthlyTaxableIncomeInput {
  grossIncome: string;
  socialInsurance?: string;
  specialAdditionalDeductions?: string;
  basicDeduction?: string;
}

/** Taxable income = gross - social insurance - special deductions - basic deduction. */
export function monthlyTaxableIncome(
  input: MonthlyTaxableIncomeInput,
): string {
  const gross = parseDecimal(input.grossIncome);
  const social = parseDecimal(input.socialInsurance ?? "0");
  const special = parseDecimal(input.specialAdditionalDeductions ?? "0");
  const basic = parseDecimal(
    input.basicDeduction ?? CHINA_IIT_MONTHLY_BASIC_DEDUCTION,
  );
  const taxable = gross - social - special - basic;
  return formatDecimal(taxable > 0n ? taxable : 0n);
}
