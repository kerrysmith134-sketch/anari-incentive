export interface CycleReadinessCandidate {
  id: string;
  status: string;
  startsAt: string;
}

/**
 * Return every unsettled cycle in deterministic chronological order.
 *
 * Worker readiness checks are read-only, so scanning each cycle is safe.
 * Returning a fresh array avoids mutating the persistence adapter's result.
 */
export function selectCycleReadinessTargets<TCycle extends CycleReadinessCandidate>(
  cycles: readonly TCycle[],
): TCycle[] {
  return cycles
    .filter((cycle) => cycle.status !== "SETTLED")
    .slice()
    .sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) ||
        left.id.localeCompare(right.id),
    );
}

export async function runCycleReadinessSweep<TCycle extends CycleReadinessCandidate>(
  cycles: readonly TCycle[],
  run: (cycle: TCycle) => Promise<{ ready: boolean }>,
  onError?: (cycle: TCycle, error: unknown) => void,
): Promise<string[]> {
  const targets = selectCycleReadinessTargets(cycles);
  if (targets.length === 0) return ["readiness:NO_OPEN_CYCLE"];

  const outcomes: string[] = [];
  for (const cycle of targets) {
    try {
      const report = await run(cycle);
      outcomes.push(`readiness:${cycle.id}:${report.ready ? "READY" : "NOT_READY"}`);
    } catch (error) {
      outcomes.push(`readiness:${cycle.id}:FAILED`);
      onError?.(cycle, error);
    }
  }
  return outcomes;
}
