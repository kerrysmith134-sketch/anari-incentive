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
