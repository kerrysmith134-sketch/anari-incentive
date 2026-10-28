import type { CalculationInput, PolicyDefinition } from "@anari/domain";
import { calculateByPolicy } from "./calculate.js";
import { formatDecimal, parseDecimal, sub, sum } from "./decimal.js";

export interface PolicySimulationSample {
  personId: string;
  input: CalculationInput;
}

export interface PolicySimulationLine {
  personId: string;
  currentAmount: string;
  proposedAmount: string;
  delta: string;
}

export interface PolicySimulationResult {
  currentTotal: string;
  proposedTotal: string;
  deltaTotal: string;
  affectedPeople: number;
  lines: PolicySimulationLine[];
  blockers: string[];
}

function totalOf(result: ReturnType<typeof calculateByPolicy>): bigint {
  return sum(result.lines.map((line) => parseDecimal(line.roundedAmount)));
}

/**
 * Replay historical/representative inputs through the current and proposed
 * policies. This is a decision-support tool only: it never publishes a policy
 * and never writes a ledger. A human must approve any resulting change.
 */
export function simulatePolicyChange(
  currentPolicy: PolicyDefinition,
  proposedPolicy: PolicyDefinition,
  samples: PolicySimulationSample[],
): PolicySimulationResult {
  const byPerson = new Map<
    string,
    { current: bigint; proposed: bigint }
  >();
  const blockers: string[] = [];
  if (currentPolicy.evaluation || proposedPolicy.evaluation) {
    // Simulation cannot resolve per-policy evaluation decisions yet; do not
    // present its numbers as decision-grade for an evaluation-weighted policy.
    blockers.push("EVALUATION_WEIGHTS_NOT_RESOLVED_IN_SIMULATION");
  }

  for (const sample of samples) {
    try {
      const current = calculateByPolicy(currentPolicy, sample.input);
      const proposed = calculateByPolicy(proposedPolicy, sample.input);
      const existing = byPerson.get(sample.personId) ?? {
        current: 0n,
        proposed: 0n,
      };
      existing.current += totalOf(current);
      existing.proposed += totalOf(proposed);
      byPerson.set(sample.personId, existing);
    } catch (error) {
      blockers.push(`${sample.personId}: ${String(error)}`);
    }
  }

  const lines: PolicySimulationLine[] = [...byPerson.entries()]
    .map(([personId, totals]) => ({
      personId,
      currentAmount: formatDecimal(totals.current),
      proposedAmount: formatDecimal(totals.proposed),
      delta: formatDecimal(sub(totals.proposed, totals.current)),
    }))
    .sort((a, b) => a.personId.localeCompare(b.personId));

  const currentTotal = sum(lines.map((line) => parseDecimal(line.currentAmount)));
  const proposedTotal = sum(lines.map((line) => parseDecimal(line.proposedAmount)));

  return {
    currentTotal: formatDecimal(currentTotal),
    proposedTotal: formatDecimal(proposedTotal),
    deltaTotal: formatDecimal(sub(proposedTotal, currentTotal)),
    affectedPeople: lines.filter((line) => line.delta !== "0").length,
    lines,
    blockers,
  };
}
