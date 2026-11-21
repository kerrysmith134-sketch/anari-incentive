/**
 * NP-030（2026-11-21 审计）：无依赖 SVG 图表组件。
 *
 * 设计约束（design-system.md）：
 * - 颜色语义走 tokens（--chart-1..4 分类色，仅图表场景使用）；
 * - 颜色永不单独承载含义——每张图自带可访问数据表（<details> 内表格）；
 * - 图表有 role="img" + 面向屏幕阅读器的文字摘要；空/NA 有显式空态；
 * - 响应式：SVG viewBox 缩放，宽度 100%。
 */
import { useMemo } from "react";
import {
  buildLinearScale,
  buildLinePath,
  buildWaterfall,
  seriesMax,
  type ChartPoint,
  type WaterfallStep,
} from "../lib/chart-math.js";

export interface ChartSeries {
  label: string;
  /** CSS 颜色值；缺省按 --chart-N 轮转。 */
  color?: string;
  points: ChartPoint[];
}

function cssVar(name: string): string {
  return `var(${name})`;
}

const SERIES_COLORS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
];

export function ChartFrame({
  title,
  summary,
  empty,
  children,
  table,
}: {
  title: string;
  /** 屏幕阅读器摘要（一句话说明图表含义与分母/时间窗）。 */
  summary: string;
  /** 数据为空/不可测时的显式空态文案。 */
  empty?: string;
  children?: React.ReactNode;
  /** 可访问数据表：行 = (列头, 行头, 值)。 */
  table?: { caption: string; headers: string[]; rows: Array<Array<string | number>> };
}) {
  if (empty) {
    return (
      <figure className="chart-frame">
        <figcaption className="chart-frame__title">{title}</figcaption>
        <p className="chart-frame__empty muted">{empty}</p>
      </figure>
    );
  }
  return (
    <figure className="chart-frame">
      <figcaption className="chart-frame__title">{title}</figcaption>
      {children}
      {table ? (
        <details className="chart-frame__table">
          <summary>数据表</summary>
          <table>
            <caption className="muted">{table.caption}</caption>
            <thead>
              <tr>
                {table.headers.map((header) => (
                  <th key={header} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={`row-${index}`}>
                  {row.map((cell, cellIndex) =>
                    cellIndex === 0 ? (
                      <th key={`cell-${cellIndex}`} scope="row">
                        {cell}
                      </th>
                    ) : (
                      <td key={`cell-${cellIndex}`}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
      <span className="visually-hidden" role="note">
        {summary}
      </span>
    </figure>
  );
}

/** 时间序列折线图（多系列）。 */
export function LineChart({
  title,
  summary,
  series,
  empty,
  table,
  height = 160,
  unit = "",
}: {
  title: string;
  summary: string;
  series: ChartSeries[];
  empty?: string;
  table?: { caption: string; headers: string[]; rows: Array<Array<string | number>> };
  height?: number;
  unit?: string;
}) {
  const width = 480;
  const scale = useMemo(
    () =>
      buildLinearScale({
        width,
        height,
        maxValue: seriesMax(series.flatMap((entry) => entry.points.map((p) => p.value))),
      }),
    [series, height],
  );
  const labelCount = Math.max(...series.map((entry) => entry.points.length), 1);
  const labels = series[0]?.points.map((point) => point.label) ?? [];
  return (
    <ChartFrame title={title} summary={summary} empty={empty} table={table}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={summary}
        focusable="false"
      >
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <line
            key={fraction}
            x1={44}
            x2={width - 8}
            y1={scale.y(scale.maxValue * fraction)}
            y2={scale.y(scale.maxValue * fraction)}
            stroke={cssVar("--chart-grid")}
            strokeWidth={1}
          />
        ))}
        {series.map((entry, seriesIndex) => (
          <g key={entry.label}>
            <path
              d={buildLinePath(entry.points, scale)}
              fill="none"
              stroke={entry.color ?? cssVar(SERIES_COLORS[seriesIndex % SERIES_COLORS.length]!)}
              strokeWidth={2}
              strokeLinecap="round"
            />
            {entry.points.map((point, index) => (
              <circle
                key={`${entry.label}-${index}`}
                cx={scale.x(index, labelCount)}
                cy={scale.y(point.value)}
                r={2.5}
                fill={entry.color ?? cssVar(SERIES_COLORS[seriesIndex % SERIES_COLORS.length]!)}
              />
            ))}
          </g>
        ))}
        {labels.map((label, index) =>
          index % Math.ceil(labels.length / 6) === 0 ? (
            <text
              key={`label-${index}`}
              x={scale.x(index, labelCount)}
              y={height - 6}
              textAnchor="middle"
              fontSize={12}
              fill={cssVar("--ink-3")}
            >
              {label}
            </text>
          ) : null,
        )}
        <text x={2} y={12} fontSize={12} fill={cssVar("--ink-3")}>
          {seriesMax(series.flatMap((entry) => entry.points.map((p) => p.value)))}
          {unit}
        </text>
      </svg>
    </ChartFrame>
  );
}

/** 分类条形图（横向预算的纵向条）。 */
export function BarChart({
  title,
  summary,
  bars,
  empty,
  table,
  height = 160,
  unit = "",
}: {
  title: string;
  summary: string;
  bars: ChartPoint[];
  empty?: string;
  table?: { caption: string; headers: string[]; rows: Array<Array<string | number>> };
  height?: number;
  unit?: string;
}) {
  const width = 480;
  const max = seriesMax(bars.map((bar) => bar.value));
  const scale = useMemo(
    () => buildLinearScale({ width, height, maxValue: max }),
    [max, height],
  );
  return (
    <ChartFrame title={title} summary={summary} empty={empty} table={table}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={summary}
        focusable="false"
      >
        {bars.map((bar, index) => {
          const count = Math.max(1, bars.length);
          const plotWidth = width - 44 - 8;
          const band = plotWidth / count;
          const barWidth = Math.min(48, band * 0.7);
          const x = 44 + index * band + (band - barWidth) / 2;
          const yTop = scale.y(bar.value);
          const yBottom = scale.y(0);
          return (
            <g key={bar.label}>
              <rect
                x={x}
                y={yTop}
                width={barWidth}
                height={Math.max(2, yBottom - yTop)}
                rx={4}
                fill={cssVar(SERIES_COLORS[index % SERIES_COLORS.length]!)}
              />
              <text
                x={x + barWidth / 2}
                y={yTop - 4}
                textAnchor="middle"
                fontSize={12}
                fill={cssVar("--ink-2")}
              >
                {bar.value}
                {unit}
              </text>
              <text
                x={x + barWidth / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize={12}
                fill={cssVar("--ink-3")}
              >
                {bar.label}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

/** 瀑布图（对账差异桥接）。 */
export function WaterfallChart({
  title,
  summary,
  steps,
  empty,
  table,
  height = 180,
  unit = "",
}: {
  title: string;
  summary: string;
  steps: WaterfallStep[];
  empty?: string;
  table?: { caption: string; headers: string[]; rows: Array<Array<string | number>> };
  height?: number;
  unit?: string;
}) {
  const width = 480;
  const computed = useMemo(() => buildWaterfall(steps), [steps]);
  const max = seriesMax(computed.map((step) => Math.max(step.startValue, step.endValue)));
  const scale = useMemo(
    () => buildLinearScale({ width, height, maxValue: max }),
    [max, height],
  );
  const fillColor = (kind: WaterfallStep["kind"]): string => {
    if (kind === "start" || kind === "total") return cssVar("--chart-1");
    if (kind === "increase") return cssVar("--chart-3");
    return cssVar("--chart-4");
  };
  return (
    <ChartFrame title={title} summary={summary} empty={empty} table={table}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={summary}
        focusable="false"
      >
        {computed.map((step, index) => {
          const count = Math.max(1, computed.length);
          const plotWidth = width - 44 - 8;
          const band = plotWidth / count;
          const barWidth = Math.min(56, band * 0.7);
          const x = 44 + index * band + (band - barWidth) / 2;
          const yHigh = scale.y(Math.max(step.startValue, step.endValue));
          const yLow = scale.y(Math.min(step.startValue, step.endValue));
          return (
            <g key={`${step.label}-${index}`}>
              <rect
                x={x}
                y={yHigh}
                width={barWidth}
                height={Math.max(2, yLow - yHigh)}
                rx={4}
                fill={fillColor(step.kind)}
              />
              <text
                x={x + barWidth / 2}
                y={yHigh - 4}
                textAnchor="middle"
                fontSize={12}
                fill={cssVar("--ink-2")}
              >
                {step.kind === "start" || step.kind === "total"
                  ? `${step.delta}${unit}`
                  : `${step.delta > 0 ? "+" : ""}${step.delta}${unit}`}
              </text>
              <text
                x={x + barWidth / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize={12}
                fill={cssVar("--ink-3")}
              >
                {step.label}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}
