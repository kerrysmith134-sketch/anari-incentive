import { expect, test, type Page } from "@playwright/test";

const PAGES: Array<{ path: string; heading: string }> = [
  { path: "/console/cycles", heading: "Cycles" },
  { path: "/console/exceptions", heading: "Exceptions" },
  { path: "/console/policy", heading: "Policy" },
  { path: "/console/contribution", heading: "Contribution" },
  { path: "/console/settlements", heading: "Settlements" },
  { path: "/console/payroll", heading: "Payroll" },
  { path: "/console/rewards", heading: "Rewards" },
  { path: "/console/agent-ops", heading: "Agent operations" },
  { path: "/console/registries", heading: "Registries" },
  { path: "/console/field-access", heading: "Field access" },
  { path: "/console/integrations", heading: "Integrations" },
  { path: "/console/platform", heading: "Platform admin" },
  { path: "/console/governance", heading: "Governance console" },
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
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
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
  await expectPage(page, "/console/cycles", "Cycles");
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
    page.getByRole("heading", { level: 1, name: "Platform admin" }),
  ).toBeVisible();

  await page.goto("/admin/governance");
  await expect(page).toHaveURL(/\/console\/governance$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Governance console" }),
  ).toBeVisible();
});
