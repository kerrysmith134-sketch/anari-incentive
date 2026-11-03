export interface AgentTaskMetricInput {
  status: string;
  createdAt: string;
  updatedAt: string;
  findings: Array<{ severity: string }>;
  actions: Array<{ requiresApproval: boolean }>;
  results: Array<{ status: string }>;
  attempts: number;
}

export interface AgentMetricsReport {
  generatedAt: string;
  totalTasks: number;
  closedTasks: number;
  medianCloseHours: number | null;
  autoResolvedRate: number | null;
  escalationRate: number | null;
  humanOverrideRate: number | null;
  falsePositiveRate: number | null;
  averageAttempts: number | null;
  costPerClosedLoop: null;
  aiOffFloor: null;
  note: string;
}

const CLOSED = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
      : (sorted[middle] as number);
  return Math.round(value * 10) / 10;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

/**
 * Operational acceptance metrics from task records. Cost per loop and the
 * AI-off completion floor need external accounting/experiment data, so they
 * are reported as unavailable instead of guessed.
 */
export function summarizeAgentMetrics(
  tasks: readonly AgentTaskMetricInput[],
  generatedAt = new Date().toISOString(),
): AgentMetricsReport {
  const closed = tasks.filter((task) => CLOSED.has(task.status));
  const closeHours = closed
    .map(
      (task) =>
        (Date.parse(task.updatedAt) - Date.parse(task.createdAt)) /
        (60 * 60 * 1000),
    )
    .filter((value) => Number.isFinite(value) && value >= 0);
  const autoResolved = closed.filter(
    (task) =>
      task.status === "SUCCEEDED" &&
      !task.actions.some((action) => action.requiresApproval),
  ).length;
  const escalated = tasks.filter(
    (task) => task.status === "ESCALATED",
  ).length;
  const executed = tasks
    .flatMap((task) => task.results)
    .filter((result) => result.status === "EXECUTED").length;
  const rejected = tasks
    .flatMap((task) => task.results)
    .filter((result) => result.status === "REJECTED").length;
  const attempts = tasks.map((task) => task.attempts);

  return {
    generatedAt,
    totalTasks: tasks.length,
    closedTasks: closed.length,
    medianCloseHours: median(closeHours),
    autoResolvedRate: ratio(autoResolved, closed.length),
    escalationRate: ratio(escalated, tasks.length),
    humanOverrideRate: ratio(rejected, executed + rejected),
    falsePositiveRate: null,
    averageAttempts:
      attempts.length === 0
        ? null
        : Math.round(
            (attempts.reduce((sum, value) => sum + value, 0) /
              attempts.length) *
              10,
          ) / 10,
    costPerClosedLoop: null,
    aiOffFloor: null,
    note: "False-positive labels, cost per closed loop and the AI-off completion floor require external review/accounting data.",
  };
}
