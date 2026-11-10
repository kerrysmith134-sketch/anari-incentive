import { expect, test, type Page } from "@playwright/test";

const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

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

test.describe("navigation v2", () => {
  test("group collapse toggle persists and hides items", async ({ page }) => {
    await page.goto("/console/");
    const group = page.getByRole("button", { name: /激励/ }).first();
    await group.click();
    await expect(page.getByRole("link", { name: "期权股权" })).toBeHidden();
    await group.click();
    await expect(page.getByRole("link", { name: "期权股权" })).toBeVisible();
  });

  test("sidebar collapses to icon mode and restores", async ({ page }) => {
    await page.goto("/console/");
    await page
      .getByRole("button", { name: "收起为图标" })
      .click();
    await expect(page.locator(".app-shell")).toContainClass("nav-collapsed");
    await page
      .getByRole("button", { name: "展开侧边栏" })
      .click();
    await expect(page.locator(".app-shell")).not.toContainClass("nav-collapsed");
  });

  test("breadcrumb reflects group and page", async ({ page }) => {
    await page.goto("/console/institutions");
    const crumb = page.getByRole("navigation", { name: "面包屑" });
    await expect(crumb).toContainText("制度与组织");
    await expect(crumb).toContainText("2026 制度中心");
  });

  test("sidebar shows a single identity card with logout", async ({ page }) => {
    await page.goto("/console/");
    await expect(page.locator(".user-card")).toHaveCount(1);
    await expect(page.locator(".env-card")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "退出登录" }),
    ).toBeVisible();
    await expect(page.getByText("登录 / 切换账号")).toHaveCount(0);
  });

  test("topbar theme button cycles back to system", async ({ page }) => {
    await page.goto("/console/");
    const button = page.getByRole("button", { name: /^主题：/ });
    await expect(button).toHaveAttribute("aria-label", /跟随系统/);
    await button.click();
    await expect(
      page.getByRole("button", { name: /^主题：/ }),
    ).toHaveAttribute("aria-label", /浅色/);
    await page.getByRole("button", { name: /^主题：/ }).click();
    await expect(
      page.getByRole("button", { name: /^主题：/ }),
    ).toHaveAttribute("aria-label", /深色/);
    await page.getByRole("button", { name: /^主题：/ }).click();
    await expect(
      page.getByRole("button", { name: /^主题：/ }),
    ).toHaveAttribute("aria-label", /跟随系统/);
  });
});

test.describe("agent assistant", () => {
  test("FAB opens the assistant drawer with command chips", async ({ page }) => {
    await page.goto("/console/institutions");
    await page.getByRole("button", { name: "打开 AI 助手" }).click();
    const drawer = page.getByRole("dialog", { name: "AI 助手" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("本地意图 · 规则计算");
    await expect(
      drawer.getByRole("button", { name: "证据缺口扫描" }),
    ).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: "周期 AI 预审" }),
    ).toBeVisible();
  });

  test("run command produces a task card with findings", async ({ page }) => {
    await page.goto("/console/");
    await page.getByRole("button", { name: "打开 AI 助手" }).click();
    const drawer = page.getByRole("dialog", { name: "AI 助手" });
    await drawer.getByRole("button", { name: "证据缺口扫描" }).click();
    await expect(
      drawer.getByText(/完成扫描：\d+ 项发现/).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(drawer.locator(".task-card").first()).toBeVisible();
    await expect(drawer.locator(".task-card__engine").first()).toContainText(
      "规则引擎",
    );
  });

  test("inbox badge and unified inbox on approvals page", async ({ page }) => {
    await page.request.post("/api/v1/approval-requests", {
      data: {
        actionType: "LEDGER_ADJUSTMENT",
        targetType: "LEDGER_ENTRY",
        targetId: "00000000-0000-4000-8000-0000000000b2",
        requestedByType: "USER",
        requestedById: "00000000-0000-4000-8000-000000000003",
        riskTier: "T2",
        idempotencyKey: `e2e-inbox-${stamp()}`,
      },
    });
    await page.goto("/console/");
    await page.getByRole("button", { name: "打开 AI 助手" }).click();
    const drawer = page.getByRole("dialog", { name: "AI 助手" });
    await expect(drawer).toContainText("待办收件箱");
    await page.goto("/console/approvals");
    await expect(page.getByText(/统一审批收件箱 · \d+/)).toBeVisible();
  });

  test("assistant closes on route change", async ({ page }) => {
    await page.goto("/console/");
    await page.getByRole("button", { name: "打开 AI 助手" }).click();
    await expect(page.getByRole("dialog", { name: "AI 助手" })).toBeVisible();
    await page.goto("/console/equity");
    await expect(page.getByRole("dialog", { name: "AI 助手" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "打开 AI 助手" }),
    ).toBeVisible();
  });
});

test.describe("agent chat (LLM phase 2)", () => {
  test("chat input and send button are visible with hint when LLM not configured", async ({
    page,
  }) => {
    await page.goto("/console/");
    await page.getByRole("button", { name: "打开 AI 助手" }).click();
    const drawer = page.getByRole("dialog", { name: "AI 助手" });
    await expect(drawer).toContainText("本地意图 · 规则计算");
    const input = drawer.getByLabel("对 AI 助手说点什么");
    await expect(input).toBeVisible();
    // LLM 未配置时本地意图匹配仍然可用：常见问法直接触发指令。
    await input.fill("帮我查一下证据缺口");
    await drawer.getByRole("button", { name: "发送" }).click();
    await expect(drawer.getByText(/本地意图匹配/).first()).toBeVisible();
    await expect(drawer.locator(".task-card").first()).toBeVisible();
  });

  test("unmatched free text explains capabilities instead of erroring", async ({
    page,
  }) => {
    await page.goto("/console/");
    await page.getByRole("button", { name: "打开 AI 助手" }).click();
    const drawer = page.getByRole("dialog", { name: "AI 助手" });
    const input = drawer.getByLabel("对 AI 助手说点什么");
    await input.fill("今天天气怎么样");
    await drawer.getByRole("button", { name: "发送" }).click();
    await expect(
      drawer.getByText(/没能本地匹配到指令/).first(),
    ).toBeVisible();
  });

  test("engine badge reflects configured provider", async ({ page }) => {
    // 未配置环境下角标显示“规则引擎 · 无 LLM”；配置后显示 provider 名。
    await page.goto("/console/");
    await page.getByRole("button", { name: "打开 AI 助手" }).click();
    const drawer = page.getByRole("dialog", { name: "AI 助手" });
    const badge = drawer.locator(".agent-drawer__engine");
    const text = await badge.innerText();
    expect(
      text.includes("本地意图 · 规则计算") || text.includes("意图解析 ·"),
    ).toBe(true);
  });
});
