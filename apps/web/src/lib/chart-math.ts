/**
 * NP-030（2026-11-21 审计）：图表数学——纯函数，无 DOM 依赖，可单测。
 * 所有坐标计算走线性缩放；NaN/Infinity 一律钳制为 0（fail-safe 渲染）。
 */

export interface ChartPoint {
  /** 分类轴标签（时间点/类别名）。 */
  label: string;
  value: number;
}

/** 数值安全化：非有限值 → 0（图上不可出现 NaN 路径）。 */
export function safeValue(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** 系列最大值；空/全零系列返回基准 1（避免除零缩放）。 */
export function seriesMax(values: number[]): number {
  const finite = values.map(safeValue);
  const max = finite.length > 0 ? Math.max(...finite) : 0;
  return max > 0 ? max : 1;
}

export interface ScaleOptions {
  width: number;
  height: number;
  /** 左侧留白（容纳 y 轴标签）。 */
  paddingLeft?: number;
  /** 底部留白（容纳 x 轴标签）。 */
  paddingBottom?: number;
  /** 值域上限（缺省用数据最大值）。 */
  maxValue?: number;
}

export interface LinearScale {
  maxValue: number;
  x: (index: number, count: number) => number;
  y: (value: number) => number;
}

/** 线性坐标缩放：index∈[0,count) 均匀布点；value∈[0,max] 映射到绘制区高度。 */
export function buildLinearScale(options: ScaleOptions): LinearScale {
  const paddingLeft = options.paddingLeft ?? 44;
  const paddingBottom = options.paddingBottom ?? 24;
  const maxValue = options.maxValue ?? seriesMax([]);
  const plotWidth = Math.max(1, options.width - paddingLeft - 8);
  const plotHeight = Math.max(1, options.height - paddingBottom - 8);
  return {
    maxValue,
    x: (index: number, count: number) =>
      paddingLeft + (count <= 1 ? plotWidth / 2 : (index * plotWidth) / (count - 1)),
    y: (value: number) =>
      8 + plotHeight - (safeValue(value) / maxValue) * plotHeight,
  };
}

/** 折线 SVG path（越界点钳制到绘制区）。 */
export function buildLinePath(
  points: ChartPoint[],
  scale: LinearScale,
): string {
  if (points.length === 0) return "";
  return points
    .map((point, index) => {
      const x = scale.x(index, points.length);
      const y = scale.y(point.value);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/** 瀑布图：累积步骤——每步 delta 相对当前 running total 的起止坐标。 */
export interface WaterfallStep {
  label: string;
  /** 正负增量（首步若 positive=true 视为起点总量）。 */
  delta: number;
  kind: "start" | "increase" | "decrease" | "total";
}

export function buildWaterfall(
  steps: WaterfallStep[],
): Array<{
  label: string;
  kind: WaterfallStep["kind"];
  startValue: number;
  endValue: number;
  delta: number;
}> {
  let running = 0;
  return steps.map((step) => {
    const delta = safeValue(step.delta);
    if (step.kind === "start" || step.kind === "total") {
      running = delta;
      return { label: step.label, kind: step.kind, startValue: 0, endValue: delta, delta };
    }
    const startValue = running;
    running += delta;
    return {
      label: step.label,
      kind: step.kind,
      startValue,
      endValue: running,
      delta,
    };
  });
}
