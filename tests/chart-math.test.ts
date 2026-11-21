import { describe, expect, it } from "vitest";
import {
  buildLinearScale,
  buildLinePath,
  buildWaterfall,
  safeValue,
  seriesMax,
} from "../apps/web/src/lib/chart-math.js";

describe("NP-030: chart-math", () => {
  it("safeValue 钳制 NaN/Infinity", () => {
    expect(safeValue(Number.NaN)).toBe(0);
    expect(safeValue(Number.POSITIVE_INFINITY)).toBe(0);
    expect(safeValue(12.5)).toBe(12.5);
  });

  it("seriesMax：空/全零系列返回 1（防除零）", () => {
    expect(seriesMax([])).toBe(1);
    expect(seriesMax([0, 0])).toBe(1);
    expect(seriesMax([3, 7, 2])).toBe(7);
  });

  it("线性缩放：0 与 max 分别落到绘制区底/顶；单点居中", () => {
    const scale = buildLinearScale({ width: 200, height: 100, maxValue: 100 });
    // plotHeight = 100 - 24(底) - 8(顶) = 68 → y(0)=8+68=76（底部留白在下）
    expect(scale.y(0)).toBeCloseTo(76);
    expect(scale.y(100)).toBeCloseTo(8);
    expect(scale.x(0, 1)).toBeCloseTo(44 + (200 - 44 - 8) / 2);
  });

  it("折线 path：首点 M、后续 L、数值两位小数", () => {
    const scale = buildLinearScale({ width: 100, height: 60, maxValue: 10 });
    const path = buildLinePath(
      [
        { label: "a", value: 0 },
        { label: "b", value: 10 },
      ],
      scale,
    );
    expect(path).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
    expect(path).not.toContain("NaN");
  });

  it("瀑布：start 定起点、increase/decrease 累积", () => {
    const steps = buildWaterfall([
      { label: "声明", delta: 100, kind: "start" },
      { label: "收入", delta: 30, kind: "increase" },
      { label: "退款", delta: -20, kind: "decrease" },
      { label: "运行", delta: 110, kind: "total" },
    ]);
    expect(steps[0]).toMatchObject({ startValue: 0, endValue: 100 });
    expect(steps[1]).toMatchObject({ startValue: 100, endValue: 130 });
    expect(steps[2]).toMatchObject({ startValue: 130, endValue: 110 });
    expect(steps[3]).toMatchObject({ startValue: 0, endValue: 110 });
  });
});
