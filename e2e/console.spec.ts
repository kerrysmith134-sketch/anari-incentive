import { expect, test, type Page } from "@playwright/test";

const PAGES: Array<{ path: string; heading: string }> = [
  { path: "/console/", heading: "运营总览" },
  { path: "/console/approvals", heading: "审批" },
  { path: "/console/cycles", heading: "考核周期" },
  { path: "/console/contribution", heading: "贡献认定" },
  { path: "/console/performance", heading: "绩效管理" },
  { path: "/console/institutions", heading: "2026 制度中心" },
  { path: "/console/task-pods", heading: "任务制组织" },
  { path: "/console/award-batches", heading: "奖励发放" },
  { path: "/console/privacy", heading: "隐私与数据" },
  { path: "/console/my-rewards", heading: "我的激励" },
  { path: "/console/notifications", heading: "通知中心" },
  { path: "/console/commission", heading: "奖金提成" },
  { path: "/console/equity", heading: "期权股权" },
  { path: "/console/bounty", heading: "悬赏任务" },
  { path: "/console/payroll", heading: "薪酬发放" },
  { path: "/console/rewards", heading: "激励" },
  { path: "/console/registries", heading: "登记簿" },
  { path: "/console/field-access", heading: "字段权限" },
  { path: "/console/platform", heading: "平台管理" },
  { path: "/console/governance", heading: "治理中心" },
  { path: "/console/settlements", heading: "结算" },
  { path: "/console/adverse-actions", heading: "不利决定" },
  { path: "/console/ai", heading: "AI 保障" },
  { path: "/console/agent-ops", heading: "Agent 运维" },
  { path: "/console/policy", heading: "政策" },
  { path: "/console/exceptions", heading: "申诉与例外" },
  { path: "/console/audit", heading: "审计" },
  { path: "/console/integrations", heading: "集成" },
  { path: "/console/people", heading: "人员" },
  { path: "/console/my-ai", heading: "我的 AI 记录" },
  { path: "/console/settings", heading: "设置" },
];

async function expectPage(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(
    page.getByRole("heading", { level: 1, name: heading }),
  ).toBeVisible();
  await expect(page.getByText("Something broke in the console")).toHaveCount(0);
}

test.describe("console shell", () => {
  test("renders the overview with brand logo and navigation", async ({ page }) => {
    await page.goto("/console/");
    await expect(
      page.getByRole("heading", { level: 1, name: "运营总览" }),
    ).toBeVisible();
    const logo = page.locator('img[src="/brand/logo-icon.png"]');
    await expect(logo).toBeVisible();
    const naturalWidth = await logo.evaluate(
      (image) => (image as HTMLImageElement).naturalWidth,
    );
    expect(naturalWidth).toBeGreaterThan(0);
    const navigation = page.getByRole("complementary", { name: "主导航" });
    await expect(navigation).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: "2026 制度中心" }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: "任务制组织" }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: "奖励发放" }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: "隐私与数据" }),
    ).toBeVisible();
  });

  test("navigates from the sidebar to the new policy centre", async ({ page }) => {
    await page.goto("/console/");
    await page
      .getByRole("complementary", { name: "主导航" })
      .getByRole("link", { name: "2026 制度中心" })
      .click();
    await expect(page).toHaveURL(/\/console\/institutions$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "2026 制度中心" }),
    ).toBeVisible();
  });
});

test.describe("all console routes", () => {
  for (const item of PAGES) {
    test(`renders ${item.heading}`, async ({ page }) => {
      await expectPage(page, item.path, item.heading);
    });
  }
});

test.describe("responsive navigation", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens the sidebar on mobile and navigates", async ({ page }) => {
    await page.goto("/console/");
    await expect(page.getByRole("button", { name: "打开导航" })).toBeVisible();
    await page.getByRole("button", { name: "打开导航" }).click();
    const navigation = page.getByRole("complementary", { name: "主导航" });
    await expect(navigation).toBeVisible();
    await navigation.getByRole("link", { name: "奖励发放" }).click();
    await expect(page).toHaveURL(/\/console\/award-batches$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "奖励发放" }),
    ).toBeVisible();
  });

  test("mobile page has no horizontal overflow", async ({ page }) => {
    await page.goto("/console/institutions");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
});

test.describe("authentication surface", () => {
  test("unified login: Feishu primary + password fallback", async ({ page }) => {
    await page.goto("/console/login");
    await expect(
      page.getByRole("heading", { level: 1, name: "登录 Anari N-Perform" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "使用飞书企业账号登录" }),
    ).toBeVisible();
    await expect(page.getByLabel("企业邮箱")).toHaveCount(0);
    await page.getByRole("button", { name: "使用账号密码登录" }).click();
    await expect(page.getByLabel("企业邮箱")).toBeVisible();
    await expect(page.getByLabel("密码")).toBeVisible();
    await expect(page.getByRole("link", { name: "创建企业工作区" })).toBeVisible();
  });
});

test("legacy admin entry points redirect into the console", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/console\/platform$/);
  await page.goto("/admin/governance");
  await expect(page).toHaveURL(/\/console\/governance$/);
});
