export interface AgentTaskMetricInput {
  status: string;
  createdAt: string;
  updatedAt: string;
  findings: Array<{ severity: string }>;
  actions: Array<{ requiresApproval: boolean }>;
  /** NPV2-021：verified=true 表示后置条件校验通过的结果。 */
  results: Array<{ status: string; verified?: boolean }>;
  attempts: number;
}

/** NPV2-027：外部接入数据——有则计算，无则指标显式 unavailable 并注明原因。 */
export interface AgentMetricExternalInputs {
  /**
   * 人工标注：reviewed = 人工复核的已闭环任务数，falsePositives = 其中被
   * 判为误报（不应触发）的数量。缺省 → falsePositiveRate 保持 unavailable。
   */
  humanLabels?: { reviewed: number; falsePositives: number };
  /**
   * 成本核算：模型调用成本与工具执行成本（任意币种单位）。缺省 →
   * costPerClosedLoop / costBreakdown 保持 unavailable。
   */
  costs?: { modelCost: number; toolCost: number };
  /** AI-off 对照组完成率（0-1）。缺省 → aiOffFloor 保持 unavailable。 */
  aiOffBaseline?: { completionRate: number; sampleSize?: number };
}

export interface AgentMetricAvailability {
  metric: string;
  available: boolean;
  /** 不可测时的明确原因（有数据时为空）。 */
  reason?: string;
  /** 数据来源说明。 */
  source: string;
  /** 统计时间窗（任务 createdAt 范围）。 */
  window: { from: string | null; to: string | null };
  /** 分母定义。 */
  denominator: string;
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
  /** NPV2-021：经后置条件校验通过的执行占全部 EXECUTED 的比例。 */
  verifiedClosureRate: number | null;
  averageAttempts: number | null;
  /** NPV2-027：每闭环任务成本 =（模型成本 + 工具成本）/ closedTasks。 */
  costPerClosedLoop: number | null;
  costBreakdown: { modelCost: number | null; toolCost: number | null };
  /** NPV2-027：AI-off 对照完成率与当前自动完成率之差。 */
  aiOffFloor: {
    baselineCompletionRate: number | null;
    autoCompletionRate: number | null;
    delta: number | null;
    sampleSize?: number;
  };
  /** NPV2-027：逐指标可用性与来源/时间窗/分母定义。 */
  availability: AgentMetricAvailability[];
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
  external?: AgentMetricExternalInputs,
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

  const executedEntries = tasks.flatMap((task) => task.results);
  const executedCount = executedEntries.filter(
    (result) => result.status === "EXECUTED",
  ).length;
  const verifiedExecuted = executedEntries.filter(
    (result) => result.status === "EXECUTED" && result.verified === true,
  ).length;

  const windowFrom =
    tasks.length > 0
      ? tasks
          .map((task) => task.createdAt)
          .sort()
          .at(0) ?? null
      : null;
  const windowTo =
    tasks.length > 0
      ? tasks
          .map((task) => task.updatedAt)
          .sort()
          .at(-1) ?? null
      : null;

  // NPV2-027：逐指标可用性（有来源、时间窗、分母定义；不可测给原因）。
  const availability: AgentMetricAvailability[] = [
    {
      metric: "falsePositiveRate",
      available: Boolean(external?.humanLabels && external.humanLabels.reviewed > 0),
      reason: external?.humanLabels
        ? undefined
        : "requires human false-positive labels (reviewed/falsePositives)",
      source: "human review labels",
      window: { from: windowFrom, to: windowTo },
      denominator: "reviewed closed tasks",
    },
    {
      metric: "verifiedClosureRate",
      available: executedCount > 0,
      reason: executedCount > 0 ? undefined : "no EXECUTED results in window",
      source: "tool invocation postcondition verifiers (NPV2-021)",
      window: { from: windowFrom, to: windowTo },
      denominator: "EXECUTED action results",
    },
    {
      metric: "costPerClosedLoop",
      available: Boolean(
        external?.costs && external.costs.modelCost + external.costs.toolCost > 0 && closed.length > 0,
      ),
      reason:
        external?.costs === undefined
          ? "requires cost accounting input (costs.modelCost/toolCost)"
          : closed.length === 0
            ? "no closed tasks in window"
            : undefined,
      source: "external cost accounting",
      window: { from: windowFrom, to: windowTo },
      denominator: "closed tasks",
    },
    {
      metric: "aiOffFloor",
      available: Boolean(external?.aiOffBaseline),
      reason: external?.aiOffBaseline
        ? undefined
        : "requires an AI-off control-group completion rate",
      source: "AI-off experiment baseline",
      window: { from: windowFrom, to: windowTo },
      denominator: "closed tasks (auto completion rate vs baseline)",
    },
  ];

  const labels = external?.humanLabels;
  const costs = external?.costs;
  const autoCompletionRate = ratio(autoResolved, closed.length);
  const aiOff = external?.aiOffBaseline;

  return {
    generatedAt,
    totalTasks: tasks.length,
    closedTasks: closed.length,
    medianCloseHours: median(closeHours),
    autoResolvedRate: autoCompletionRate,
    escalationRate: ratio(escalated, tasks.length),
    humanOverrideRate: ratio(rejected, executed + rejected),
    falsePositiveRate:
      labels && labels.reviewed > 0
        ? ratio(labels.falsePositives, labels.reviewed)
        : null,
    verifiedClosureRate: ratio(verifiedExecuted, executedCount),
    averageAttempts:
      attempts.length === 0
        ? null
        : Math.round(
            (attempts.reduce((sum, value) => sum + value, 0) /
              attempts.length) *
              10,
          ) / 10,
    costPerClosedLoop:
      costs && closed.length > 0
        ? Math.round(
            ((costs.modelCost + costs.toolCost) / closed.length) * 100,
          ) / 100
        : null,
    costBreakdown: {
      modelCost: costs?.modelCost ?? null,
      toolCost: costs?.toolCost ?? null,
    },
    aiOffFloor: {
      baselineCompletionRate: aiOff?.completionRate ?? null,
      autoCompletionRate,
      delta:
        aiOff && autoCompletionRate !== null
          ? Math.round((autoCompletionRate - aiOff.completionRate) * 10000) / 10000
          : null,
      sampleSize: aiOff?.sampleSize,
    },
    availability,
    note: external
      ? "Metrics computed with provided external inputs; see availability[] per metric."
      : "False-positive labels, cost accounting and the AI-off baseline were not provided; those metrics are explicitly unavailable (see availability[]).",
  };
}
