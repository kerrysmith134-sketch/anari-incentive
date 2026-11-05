import { expect, test, type Page } from "@playwright/test";

const PAGES: Array<{ path: string; heading: string }> = [
  { path: "/console/cycles", heading: "考核周期" },
  { path: "/console/exceptions", heading: "申诉与例外" },
  { path: "/console/policy", heading: "政策" },
  { path: "/console/contribution", heading: "贡献认定" },
  { path: "/console/settlements", heading: "结算" },
  { path: "/console/payroll", heading: "薪酬发放" },
  { path: "/console/rewards", heading: "激励" },
  { path: "/console/agent-ops", heading: "Agent 运维" },
  { path: "/console/registries", heading: "登记簿" },
  { path: "/console/field-access", heading: "字段权限" },
  { path: "/console/integrations", heading: "集成" },
  { path: "/console/platform", heading: "平台管理" },
  { path: "/console/governance", heading: "治理中心" },
];

async function expectPage(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(
    page.getByRole("heading", { level: 1, name: heading }),
  ).toBeVisible();
  await expect(page.getByText("Something broke in the console")).toHaveCount(0);
}

test("loads the overview shell without a render error", async ({ page }) => {
  await page.goto("/console/");
  await expect(page.getByRole("link", { name: "总览" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Something broke in the console")).toHaveCount(0);
});

test.describe("module pages", () => {
  for (const item of PAGES) {
    test(`renders ${item.heading}`, async ({ page }) => {
      await expectPage(page, item.path, item.heading);
    });
  }
});

test("opens a calculation-run dialog", async ({ page }) => {
  await expectPage(page, "/console/cycles", "考核周期");
  await page.getByRole("button", { name: "New run" }).click();
  await expect(
    page.getByRole("dialog", { name: "New calculation run" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add participant" }).click();
  await expect(page.getByText("Person 2")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("dialog", { name: "New calculation run" }),
  ).toHaveCount(0);
});

test("saves a field-access override with an audit trail", async ({ page }) => {
  await expectPage(page, "/console/field-access", "Field access");
  const firstRowToggle = page
    .locator("table tbody tr")
    .first()
    .locator('input[type="checkbox"]')
    .first();
  await firstRowToggle.check();
  await page.getByRole("button", { name: "Save overrides" }).click();
  await expect(page.getByText("Field matrix saved")).toBeVisible();
});

test("serves the legacy admin entry points as SPA redirects", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/console\/platform$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "平台管理" }),
  ).toBeVisible();

  await page.goto("/admin/governance");
  await expect(page).toHaveURL(/\/console\/governance$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "治理中心" }),
  ).toBeVisible();
});

test("exposes the remaining governance surfaces", async ({ page }) => {
  await expectPage(page, "/console/audit", "审计");
  await expect(
    page.getByRole("heading", { name: "External anchor manifest" }),
  ).toBeVisible();

  await expectPage(page, "/console/settlements", "Settlements");
  await page.getByRole("tab", { name: /Exports & adjustments/ }).click();
  await expect(
    page.getByRole("heading", { name: "Settlement exports" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ledger adjustments" }),
  ).toBeVisible();

  await expectPage(page, "/console/policy", "政策");
  await page.getByRole("tab", { name: /Governance/ }).click();
  await expect(
    page.getByRole("heading", { name: "Policy simulation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Policy notice links" }),
  ).toBeVisible();

  await expectPage(page, "/console/payroll", "Payroll");
  await page.getByRole("tab", { name: /Contracts/ }).click();
  await expect(page.getByRole("button", { name: "Apply due" })).toBeVisible();

  await expectPage(page, "/console/agent-ops", "Agent operations");
  await page.getByRole("tab", { name: /Acceptance metrics/ }).click();
  await expect(
    page.getByRole("heading", { name: "Acceptance metrics" }),
  ).toBeVisible();

  await expectPage(page, "/console/ai", "AI assurance");
  await page.getByRole("tab", { name: /Evaluation runs/ }).click();
  await expect(page.getByRole("button", { name: "Run harness" })).toBeVisible();
  await page.getByRole("button", { name: "Run harness" }).click();
  await expect(
    page.getByRole("dialog", { name: "Run evaluation harness" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
});
