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

export type MarginalField = "attributionWeight" | "evaluationMultiplier";

export interface MarginalSimulationPoint {
  value: string;
  total: string;
  targetAmount: string;
  delta: string;
  targetDelta: string;
}

export interface MarginalSimulationResult {
  participantIndex: number;
  field: MarginalField;
  from: string;
  to: string;
  step: string;
  points: MarginalSimulationPoint[];
  maxDelta: string;
  note: string;
}

/**
 * Sweep one participant field in small steps and report the resulting total and
 * that participant's amount. This exposes cliff effects (e.g. a 0.01 change
 * crossing a cap or rounding boundary) without proposing a policy change.
 */
export function simulateMarginalChange(
  policy: PolicyDefinition,
  input: CalculationInput,
  options: {
    participantIndex?: number;
    field?: MarginalField;
    from: string;
    to: string;
    step: string;
    maxPoints?: number;
  },
): MarginalSimulationResult {
  const participantIndex = options.participantIndex ?? 0;
  const field = options.field ?? "attributionWeight";
  const participant = input.participants[participantIndex];
  if (!participant) {
    throw new Error(`participant index ${participantIndex} is out of range`);
  }
  const from = parseDecimal(options.from);
  const to = parseDecimal(options.to);
  const step = parseDecimal(options.step);
  if (step <= 0n) throw new Error("marginal step must be positive");
  if (from > to) throw new Error("marginal from must not exceed to");
  const maxPoints = options.maxPoints ?? 200;

  const points: MarginalSimulationPoint[] = [];
  let previousTotal: bigint | null = null;
  let previousTarget: bigint | null = null;
  let maxDelta = 0n;
  for (let value = from; value <= to; value += step) {
    if (points.length >= maxPoints) {
      throw new Error(`marginal simulation exceeds ${maxPoints} points`);
    }
    const participants = input.participants.map((candidate, index) =>
      index === participantIndex
        ? { ...candidate, [field]: formatDecimal(value) }
        : { ...candidate },
    );
    const result = calculateByPolicy(policy, {
      ...input,
      participants,
    });
    const total = sum(result.lines.map((line) => parseDecimal(line.roundedAmount)));
    const targetLine = result.lines.find(
      (line) => line.personId === participant.personId,
    );
    const targetAmount = parseDecimal(targetLine?.roundedAmount ?? "0");
    const delta = previousTotal === null ? 0n : sub(total, previousTotal);
    const targetDelta =
      previousTarget === null ? 0n : sub(targetAmount, previousTarget);
    if (targetDelta < 0n ? -targetDelta > maxDelta : targetDelta > maxDelta) {
      maxDelta = targetDelta < 0n ? -targetDelta : targetDelta;
    }
    points.push({
      value: formatDecimal(value),
      total: formatDecimal(total),
      targetAmount: formatDecimal(targetAmount),
      delta: formatDecimal(delta),
      targetDelta: formatDecimal(targetDelta),
    });
    previousTotal = total;
    previousTarget = targetAmount;
  }

  return {
    participantIndex,
    field,
    from: formatDecimal(from),
    to: formatDecimal(to),
    step: formatDecimal(step),
    points,
    maxDelta: formatDecimal(maxDelta),
    note: "Decision support only; no policy, ledger or payroll record is written.",
  };
}
