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
export function selectCycleReadinessTargets(
  cycles: readonly CycleReadinessCandidate[],
): CycleReadinessCandidate[] {
  return cycles
    .filter((cycle) => cycle.status !== "SETTLED")
    .slice()
    .sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) ||
        left.id.localeCompare(right.id),
    );
}
