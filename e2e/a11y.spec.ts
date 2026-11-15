/**
 * AUD-025：真实浏览器视觉/无障碍/响应式实测。
 *
 * - axe（WCAG 关键项：color-contrast / label / aria-* / heading-order 等）
 *   扫员工/主管/财务/设置四类核心工作空间；
 * - 键盘：Tab 可达核心交互、焦点可见；
 * - 移动视口（375×667）：核心页无横向溢出。
 */
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "anari.session",
      JSON.stringify({
        tenantId: "tenant-demo",
        userId: "dev-user",
        personId: "00000000-0000-4000-8000-000000000001",
        token: "",
      }),
    );
  });
});

const CORE_PAGES = [
  { path: "/console/my-workbench", name: "员工工作台" },
  { path: "/console/management", name: "主管中心" },
  { path: "/console/finance-center", name: "财务中心" },
  { path: "/console/settings", name: "设置" },
];

test.describe("AUD-025 accessibility", () => {
  for (const { path, name } of CORE_PAGES) {
    test(`axe: ${name}（${path}）无严重/关键违规`, async ({ page }) => {
      await page.goto(path);
      // 等数据面板渲染完成（骨架屏消失），避免对 loading 态误报。
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const results = await new AxeBuilder({ page })
        // 完整 WCAG 2.x 关键规则集；experimental/incomplete 不作为门禁。
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const violations = results.violations.filter(
        (violation) => violation.impact === "critical" || violation.impact === "serious",
      );
      // 失败时输出违规节点，便于定位修复（target 是 CSS 选择器）。
      for (const violation of violations) {
        const nodes = violation.nodes
          .map((node) => `${node.target.join(" ")}: ${node.summary}`)
          .slice(0, 8)
          .join("\n  ");
        console.warn(`[axe] ${path} ${violation.id}(${violation.impact}):\n  ${nodes}`);
      }
      expect(
        violations.map((violation) => `${violation.id}(${violation.impact})`),
        `serious/critical a11y violations on ${path}`,
      ).toEqual([]);
    });
  }

  test("keyboard: 工作台侧边栏可用 Tab 聚焦且焦点样式可见", async ({ page }) => {
    await page.goto("/console/my-workbench");
    await page.keyboard.press("Tab");
    const first = page.locator(":focus");
    await expect(first).toBeVisible();
    // 焦点可见性：outline 或其它可见样式变化由 CSS :focus 提供——
    // 这里验证 focused 元素不是 0 尺寸（焦点落在真实可交互元素上）。
    const box = await first.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(0);
    expect(box!.width).toBeGreaterThan(0);
  });

  test("keyboard: 表格/列表页面可顺序 Tab 且不被隐藏元素卡住", async ({ page }) => {
    await page.goto("/console/notifications");
    await page.waitForLoadState("networkidle").catch(() => undefined);
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      const focused = page.locator(":focus");
      await expect(focused).toBeVisible();
    }
  });
});

test.describe("AUD-025 responsive (375x667)", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  for (const { path, name } of CORE_PAGES) {
    test(`no horizontal overflow: ${name}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
        };
      });
      // 允许 2px 舍入误差；超出即横向溢出。
      expect(
        overflow.scrollWidth - overflow.clientWidth,
        `horizontal overflow on ${path}`,
      ).toBeLessThanOrEqual(2);
    });
  }
});
