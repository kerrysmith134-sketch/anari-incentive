import type { CalculationLine } from "@anari/domain";
import { formatDecimal, parseDecimal, sub } from "./decimal.js";

export interface ExpectedLine {
  personId: string;
  amount: string;
}

export interface ReconciliationDifference {
  personId: string;
  expected: string;
  actual: string | null;
  delta: string;
}

/**
 * Compare an independent expected ledger (e.g. a spreadsheet export) with the
 * engine output. Any difference must be explained before formal settlement;
 * the script exits non-zero if this array is non-empty.
 */
export function reconcileLines(
  expected: ExpectedLine[],
  actual: CalculationLine[],
): ReconciliationDifference[] {
  const actualByPerson = new Map(
    actual.map((line) => [line.personId, line.roundedAmount]),
  );
  const differences: ReconciliationDifference[] = [];

  for (const expectedLine of expected) {
    const actualAmount = actualByPerson.get(expectedLine.personId) ?? null;
    if (actualAmount === null) {
      differences.push({
        personId: expectedLine.personId,
        expected: expectedLine.amount,
        actual: null,
        delta: expectedLine.amount,
      });
      continue;
    }
    const delta = sub(
      parseDecimal(actualAmount),
      parseDecimal(expectedLine.amount),
    );
    if (delta !== 0n) {
      differences.push({
        personId: expectedLine.personId,
        expected: expectedLine.amount,
        actual: actualAmount,
        delta: formatDecimal(delta),
      });
    }
  }

  const expectedIds = new Set(expected.map((line) => line.personId));
  for (const line of actual) {
    if (!expectedIds.has(line.personId)) {
      differences.push({
        personId: line.personId,
        expected: "0",
        actual: line.roundedAmount,
        delta: line.roundedAmount,
      });
    }
  }

  return differences;
}
