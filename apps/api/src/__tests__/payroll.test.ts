import { describe, expect, it } from "vitest";
import type {
  AmountLedgerEntry,
  EmploymentContract,
} from "@anari/domain";
import { calculatePayroll } from "../payroll.js";

const contract: EmploymentContract = {
  id: "00000000-0000-4000-8000-0000000000c1",
  tenantId: "tenant-demo",
  personId: "00000000-0000-4000-8000-000000000001",
  contractCode: "CT-CAP-1",
  employmentType: "FULL_TIME",
  startDate: "2026-01-01T00:00:00.000Z",
  workLocation: "Shanghai",
  currency: "CNY",
  fixedMonthlySalary: "8000",
  minimumMonthlyWage: "2690",
  taxRate: "0.1",
  socialInsuranceRate: "0.05",
  deductionCapRate: "0.2",
  variableShareCapRate: "1",
  deductionOrder: ["RECOVERY", "REVERSAL", "ADJUSTMENT", "OTHER"],
  deductionTypeCaps: {},
  smoothingThresholdRate: "1",
  bankAccountRef: "BANK-1",
  payPlanVersion: 1,
  consentSignatureRef: "ESIGN-CAP-1",
  consentSignedAt: "2026-01-01T00:00:00.000Z",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 1,
};

function ledger(amount: string): AmountLedgerEntry {
  return {
    id: `ledger-${amount}`,
    tenantId: contract.tenantId,
    personId: contract.personId,
    cycleId: "00000000-0000-4000-8000-000000000020",
    calculationRunId: "00000000-0000-4000-8000-0000000000c2",
    entryType: "INCENTIVE",
    amount,
    currency: "CNY",
    status: "LOCKED",
    idempotencyKey: `key-${amount}`,
    entryHash: "hash",
    prevHash: "prev",
    createdAt: "2026-10-01T00:00:00.000Z",
    lockedAt: "2026-10-01T00:00:00.000Z",
  };
}

function calculate(negativeAmount: string) {
  return calculatePayroll({
    contracts: [contract],
    ledger: [ledger(negativeAmount)],
    cycleId: "00000000-0000-4000-8000-000000000020",
    currency: "CNY",
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-10-31T23:59:59.000Z",
  });
}

describe("payroll incentive smoothing", () => {
  it("blocks a period-over-period change above the contract threshold", () => {
    const result = calculatePayroll({
      contracts: [{ ...contract, smoothingThresholdRate: "0.5" }],
      ledger: [ledger("300")],
      priorIncentives: { [contract.id]: "100" },
      cycleId: "00000000-0000-4000-8000-000000000020",
      currency: "CNY",
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-10-31T23:59:59.000Z",
    });
    expect(result.lines[0]?.incentiveChangeRate).toBe("2");
    expect(result.lines[0]?.smoothingPassed).toBe(false);
    expect(result.blockedCount).toBe(1);
  });

  it("allows a change within the smoothing threshold", () => {
    const result = calculatePayroll({
      contracts: [{ ...contract, smoothingThresholdRate: "0.5" }],
      ledger: [ledger("120")],
      priorIncentives: { [contract.id]: "100" },
      cycleId: "00000000-0000-4000-8000-000000000020",
      currency: "CNY",
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-10-31T23:59:59.000Z",
    });
    expect(result.lines[0]?.smoothingPassed).toBe(true);
    expect(result.blockedCount).toBe(0);
  });
});

describe("payroll deduction type caps", () => {
  it("blocks a line when one deduction type exceeds its cap", () => {
    const result = calculatePayroll({
      contracts: [
        {
          ...contract,
          deductionTypeCaps: { RECOVERY: "0.02" },
        },
      ],
      ledger: [
        { ...ledger("-300"), id: "recovery-cap", entryType: "RECOVERY" },
      ],
      cycleId: "00000000-0000-4000-8000-000000000020",
      currency: "CNY",
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-10-31T23:59:59.000Z",
    });
    expect(result.lines[0]?.deductionTypeCapPassed).toBe(false);
    expect(result.lines[0]?.deductionTypeCapBreaches).toEqual(["RECOVERY"]);
    expect(result.blockedCount).toBe(1);
  });
});

describe("payroll deduction order", () => {
  it("groups and sorts deductions by the contract priority", () => {
    const result = calculatePayroll({
      contracts: [
        {
          ...contract,
          deductionOrder: ["REVERSAL", "RECOVERY", "ADJUSTMENT", "OTHER"],
        },
      ],
      ledger: [
        { ...ledger("-300"), id: "recovery", entryType: "RECOVERY" },
        { ...ledger("-200"), id: "adjustment", entryType: "ADJUSTMENT" },
        { ...ledger("-100"), id: "reversal", entryType: "REVERSAL" },
      ],
      cycleId: "00000000-0000-4000-8000-000000000020",
      currency: "CNY",
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-10-31T23:59:59.000Z",
    });
    expect(result.lines[0]?.deductionBreakdown).toEqual([
      { type: "REVERSAL", amount: "100", priority: 0 },
      { type: "RECOVERY", amount: "300", priority: 1 },
      { type: "ADJUSTMENT", amount: "200", priority: 2 },
    ]);
    expect(result.lines[0]?.deductionAmount).toBe("600");
  });
});

describe("payroll variable-share cap", () => {
  it("blocks a line when incentive exceeds the configured variable-share cap", () => {
    const result = calculatePayroll({
      contracts: [{ ...contract, variableShareCapRate: "0.2" }],
      ledger: [ledger("5000")],
      cycleId: "00000000-0000-4000-8000-000000000020",
      currency: "CNY",
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-10-31T23:59:59.000Z",
    });
    expect(result.lines[0]?.grossAmount).toBe("13000");
    expect(result.lines[0]?.variableShareCapAmount).toBe("2600");
    expect(result.lines[0]?.variableSharePassed).toBe(false);
    expect(result.blockedCount).toBe(1);
  });

  it("allows variable pay within the cap", () => {
    const result = calculatePayroll({
      contracts: [{ ...contract, variableShareCapRate: "0.5" }],
      ledger: [ledger("5000")],
      cycleId: "00000000-0000-4000-8000-000000000020",
      currency: "CNY",
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-10-31T23:59:59.000Z",
    });
    expect(result.lines[0]?.variableShareCapAmount).toBe("6500");
    expect(result.lines[0]?.variableSharePassed).toBe(true);
    expect(result.blockedCount).toBe(0);
  });
});

describe("payroll deduction cap", () => {
  it("blocks a line when ledger deductions exceed the contract cap", () => {
    const result = calculate("-2000");
    expect(result.lines[0]?.grossAmount).toBe("8000");
    expect(result.lines[0]?.deductionCapAmount).toBe("1600");
    expect(result.lines[0]?.deductionCapPassed).toBe(false);
    expect(result.lines[0]?.deductionBreakdown).toEqual([
      { type: "OTHER", amount: "2000", priority: 3 },
    ]);
    expect(result.lines[0]?.minimumWagePassed).toBe(true);
    expect(result.blockedCount).toBe(1);
  });

  it("allows deductions within the cap while keeping the minimum wage", () => {
    const result = calculate("-1000");
    expect(result.lines[0]?.deductionCapPassed).toBe(true);
    expect(result.lines[0]?.minimumWagePassed).toBe(true);
    expect(result.blockedCount).toBe(0);
    expect(result.lines[0]?.netAmount).toBe("5800");
  });
});

describe("payroll statutory CN tax mode", () => {
  const statutoryInput = (priorYtd?: {
    taxableIncome: string;
    taxWithheld: string;
  }) =>
    calculatePayroll({
      contracts: [{ ...contract, taxRate: "0" }],
      ledger: [],
      taxMode: "STATUTORY_CN",
      priorYtd: priorYtd
        ? { [contract.personId]: priorYtd }
        : undefined,
      cycleId: "00000000-0000-4000-8000-000000000020",
      currency: "CNY",
      periodStart: "2026-11-01T00:00:00.000Z",
      periodEnd: "2026-11-30T23:59:59.000Z",
    });

  it("withholds from the first bracket with cumulative bookkeeping", () => {
    // gross 8000, social 5% = 400, basic deduction 5000 -> taxable 2600.
    const result = statutoryInput();
    const line = result.lines[0]!;
    expect(line.taxCalculationMode).toBe("STATUTORY_CN");
    expect(line.ytdTaxableIncome).toBe("2600");
    expect(line.iitRatePercent).toBe(3);
    // 2600 * 3% = 78
    expect(line.taxAmount).toBe("78");
    expect(line.ytdTaxWithheld).toBe("78");
  });

  it("crosses into a higher bracket using prior year-to-date amounts", () => {
    // Prior YTD taxable 360000 -> +2600 = 362600 -> 25% bracket,
    // quick deduction 31920: cumulative due = 362600*25% - 31920 = 58730.
    // Prior withheld = 360000*25% - 31920 = 58080. Period tax = 650.
    const result = statutoryInput({
      taxableIncome: "360000",
      taxWithheld: "58080",
    });
    const line = result.lines[0]!;
    expect(line.iitRatePercent).toBe(25);
    expect(line.ytdTaxableIncome).toBe("362600");
    expect(line.taxAmount).toBe("650");
    expect(line.ytdTaxWithheld).toBe("58730");
  });

  it("never withholds negative tax after a large prior withholding", () => {
    const result = statutoryInput({
      taxableIncome: "360000",
      taxWithheld: "60000",
    });
    expect(result.lines[0]!.taxAmount).toBe("0");
  });

  it("keeps DECLARED as the default mode", () => {
    const result = calculatePayroll({
      contracts: [contract],
      ledger: [],
      cycleId: "00000000-0000-4000-8000-000000000020",
      currency: "CNY",
      periodStart: "2026-11-01T00:00:00.000Z",
      periodEnd: "2026-11-30T23:59:59.000Z",
    });
    expect(result.lines[0]!.taxCalculationMode).toBe("DECLARED");
    expect(result.lines[0]!.ytdTaxableIncome).toBeUndefined();
    // 8000 * 10% declared rate
    expect(result.lines[0]!.taxAmount).toBe("800");
  });
});

describe("INC-03 incentive smoothing modes", () => {
  function smooth(
    mode: "NONE" | "BLOCK" | "MOVING_AVERAGE" | "RAMP",
    extra: Partial<EmploymentContract> = {},
  ) {
    return calculatePayroll({
      contracts: [
        {
          ...contract,
          smoothingMode: mode,
          smoothingWindowPeriods: 3,
          smoothingMaxStepRate: "0.5",
          ...extra,
        },
      ],
      ledger: [ledger("5000")],
      priorIncentives: { [contract.id]: "1000" },
      priorIncentiveHistory: { [contract.id]: ["800", "900", "1000"] },
      cycleId: "00000000-0000-4000-8000-000000000020",
      currency: "CNY",
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-10-31T23:59:59.000Z",
    });
  }

  it("NONE passes the raw incentive through", () => {
    const line = smooth("NONE").lines[0]!;
    expect(line.rawIncentiveAmount).toBe("5000");
    expect(line.smoothedIncentiveAmount).toBe("5000");
    expect(line.incentiveAmount).toBe("5000");
    expect(line.smoothingDelta).toBe("0");
  });

  it("MOVING_AVERAGE averages the configured history window", () => {
    const line = smooth("MOVING_AVERAGE").lines[0]!;
    // window 3: last 2 history (900,1000) + raw 5000 = 6900/3 = 2300
    expect(line.smoothedIncentiveAmount).toBe("2300");
    expect(line.rawIncentiveAmount).toBe("5000");
    expect(line.smoothingDelta).toBe("-2700");
  });

  it("RAMP caps the step change per period", () => {
    const line = smooth("RAMP").lines[0]!;
    // prior 1000, max step 50% → upper 1500
    expect(line.smoothedIncentiveAmount).toBe("1500");
    expect(line.grossAmount).toBe("9500");
    expect(line.smoothingDelta).toBe("-3500");
  });

  it("BLOCK keeps raw amount but marks the line blocked", () => {
    const result = smooth("BLOCK", { smoothingThresholdRate: "0.2" });
    const line = result.lines[0]!;
    expect(line.smoothedIncentiveAmount).toBe("5000");
    expect(line.smoothingPassed).toBe(false);
    expect(result.blockedCount).toBe(1);
  });
});

describe("LG-06 court order / consent gate", () => {
  const courtContract = {
    ...contract,
    deductionOrder: ["COURT_ORDER", "RECOVERY"],
  } as EmploymentContract;
  const courtEntry = {
    ...ledger("-100"),
    id: "court-ledger",
    entryType: "COURT_ORDER",
  } as unknown as AmountLedgerEntry;

  it("blocks when a court order is required but no legal basis is recorded", () => {
    const result = calculatePayroll({
      contracts: [courtContract],
      ledger: [courtEntry],
      statutoryDeductionTypes: [
        { type: "COURT_ORDER", priority: 0, requiresCourtOrder: true },
      ],
      cycleId: "00000000-0000-4000-8000-000000000020",
      currency: "CNY",
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-10-31T23:59:59.000Z",
    });
    const line = result.lines[0]!;
    expect(line.deductionLegalBasisPassed).toBe(false);
    expect(line.deductionLegalBasisMissing).toEqual(["COURT_ORDER:COURT_ORDER"]);
    expect(result.blockedCount).toBe(1);
  });

  it("passes when the court order reference is recorded", () => {
    const result = calculatePayroll({
      contracts: [courtContract],
      ledger: [courtEntry],
      statutoryDeductionTypes: [
        { type: "COURT_ORDER", priority: 0, requiresCourtOrder: true },
      ],
      deductionLegalBases: {
        COURT_ORDER: { courtOrderRef: "(2026)粤0305执123号" },
      },
      cycleId: "00000000-0000-4000-8000-000000000020",
      currency: "CNY",
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-10-31T23:59:59.000Z",
    });
    expect(result.lines[0]!.deductionLegalBasisPassed).toBe(true);
    expect(result.blockedCount).toBe(0);
  });
});

describe("multi-currency payroll", () => {
  it("rounds JPY to whole yen and disables China statutory deductions", () => {
    const result = calculatePayroll({
      contracts: [
        {
          ...contract,
          currency: "JPY",
          fixedMonthlySalary: "8000.6",
          minimumMonthlyWage: "0",
        },
      ],
      ledger: [],
      taxMode: "STATUTORY_CN",
      cycleId: "00000000-0000-4000-8000-000000000020",
      currency: "JPY",
      periodStart: "2026-11-01T00:00:00.000Z",
      periodEnd: "2026-11-30T23:59:59.000Z",
    });
    const line = result.lines[0]!;
    expect(line.currency).toBe("JPY");
    expect(line.grossAmount).toBe("8001");
    expect(line.netAmount).toBe("8001");
    expect(line.taxAmount).toBe("0");
    expect(line.socialInsuranceAmount).toBe("0");
    expect(line.statutoryCurrencyUnsupported).toBe(true);
    expect(line.taxCalculationMode).toBeUndefined();
    expect(result.totalGross).toBe("8001");
    expect(result.totalTax).toBe("0");
    expect(result.totalSocialInsurance).toBe("0");
  });

  it("rounds KWD to 3 decimals and disables China statutory deductions", () => {
    const result = calculatePayroll({
      contracts: [
        {
          ...contract,
          currency: "KWD",
          fixedMonthlySalary: "1000.1236",
          minimumMonthlyWage: "0",
        },
      ],
      ledger: [],
      cycleId: "00000000-0000-4000-8000-000000000020",
      currency: "KWD",
      periodStart: "2026-11-01T00:00:00.000Z",
      periodEnd: "2026-11-30T23:59:59.000Z",
    });
    const line = result.lines[0]!;
    expect(line.currency).toBe("KWD");
    expect(line.grossAmount).toBe("1000.124");
    expect(line.netAmount).toBe("1000.124");
    expect(line.taxAmount).toBe("0");
    expect(line.socialInsuranceAmount).toBe("0");
    expect(line.statutoryCurrencyUnsupported).toBe(true);
    expect(result.totalGross).toBe("1000.124");
  });

  it("keeps CNY on the statutory path without the unsupported marker", () => {
    const line = calculate("-1000").lines[0]!;
    expect(line.currency).toBe("CNY");
    expect(line.statutoryCurrencyUnsupported).toBeUndefined();
    // 8000 gross at 10% declared tax and 5% social insurance.
    expect(line.taxAmount).toBe("800");
    expect(line.socialInsuranceAmount).toBe("400");
  });
});
