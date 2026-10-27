import type { CalculationInput, PolicyDefinition } from "@anari/domain";

/**
 * Independent reference calculation for the first vertical slice.
 *
 * This implementation deliberately uses a different arithmetic path
 * (JavaScript Number + cents) from the production evaluator (bigint + 1e6
 * scale). It is a first-line check, not a substitute for business-owned
 * golden cases or a separately implemented reference service. Any mismatch
 * must block formal settlement.
 */
export interface ReferenceLine {
  personId: string;
  amountCents: number;
}

export function referenceOrderContribution(
  policy: PolicyDefinition,
  input: CalculationInput,
): ReferenceLine[] {
  const grossProfit = Number(input.order.grossProfit);
  const pool = Math.min(
    grossProfit * Number(policy.poolRate),
    Number(policy.poolCap),
  );
  const poolCents = Math.round(pool * 100);
  const weights = input.participants.map((participant) =>
    Number(participant.attributionWeight),
  );
  const total = weights.reduce((acc, weight) => acc + weight, 0);
  if (!(total > 0)) throw new Error("Reference: total weight must be positive");

  const ideals = weights.map((weight) => (poolCents * weight) / total);
  const cents = ideals.map((ideal) => Math.floor(ideal));
  let remainder = poolCents - cents.reduce((acc, value) => acc + value, 0);

  const order = ideals
    .map((ideal, index) => ({
      index,
      fraction: ideal - Math.floor(ideal),
      personId: input.participants[index]!.personId,
    }))
    .sort(
      (a, b) =>
        b.fraction - a.fraction || a.personId.localeCompare(b.personId),
    );

  for (let i = 0; i < remainder; i += 1) {
    const index = order[i % order.length]!.index;
    cents[index] = (cents[index] ?? 0) + 1;
  }

  return input.participants.map((participant, index) => ({
    personId: participant.personId,
    amountCents: cents[index]!,
  }));
}

export function compareWithReference(
  policy: PolicyDefinition,
  input: CalculationInput,
  actual: Array<{ personId: string; roundedAmount: string }>,
): Array<{ personId: string; expectedCents: number; actualCents: number }> {
  const reference = referenceOrderContribution(policy, input);
  const actualByPerson = new Map(
    actual.map((line) => [line.personId, Math.round(Number(line.roundedAmount) * 100)]),
  );
  const differences: Array<{
    personId: string;
    expectedCents: number;
    actualCents: number;
  }> = [];
  for (const line of reference) {
    const actualCents = actualByPerson.get(line.personId);
    if (actualCents !== line.amountCents) {
      differences.push({
        personId: line.personId,
        expectedCents: line.amountCents,
        actualCents: actualCents ?? Number.NaN,
      });
    }
  }
  return differences;
}
