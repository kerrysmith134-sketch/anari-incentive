/**
 * Commercial 工作台黄金路径（Sprint 3）：
 * 登录会话 → 客户账户 → 销售机会 → 报价 → 接受 → 合同 → 签署 → 订单 → 确认。
 *
 * 全部通过真实控制台 UI 驱动；API 只用于断言持久化后的状态（同一 dev server
 * 的内存存储），从而证明页面状态不是纯前端假象。
 */
import { expect, test, type Page } from "@playwright/test";

const ME = "00000000-0000-4000-8000-000000000001";

function devHeaders(personId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-tenant-id": "tenant-demo",
    "x-user-id": `dev-${personId.slice(-3)}`,
    "x-person-id": personId,
  };
}

async function jsonRows<T>(page: Page, path: string): Promise<T[]> {
  const response = await page.request.get(path, { headers: devHeaders(ME) });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: T[] }).data;
}

test.beforeEach(async ({ page }) => {
  // 与现有 E2E 一致：dev 形态下用显式会话代替真实密码登录。
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

test("Commercial 黄金路径：账户→机会→报价→接受→合同→签署→订单→确认", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const accountName = `E2E 客户 ${stamp}`;
  const opportunityName = `E2E 机会 ${stamp}`;
  const contractRef = `E2E-CTR-${stamp}`;
  const orderNumber = `E2E-SO-${stamp}`;
  const quoteAmount = "12345.67";

  await page.goto("/console/commercial");
  await expect(
    page.getByRole("heading", { level: 1, name: "商业对象" }),
  ).toBeVisible();

  // 页面骨架：五个生命周期视图与主 CTA 均存在。
  const tabs = page.getByRole("tablist", { name: "Commercial 视图" });
  for (const label of ["客户", "机会", "报价", "合同", "订单"]) {
    await expect(tabs.getByRole("tab", { name: new RegExp(label) })).toBeVisible();
  }

  // 1. 客户账户
  await page.getByRole("button", { name: "新建客户账户" }).click();
  const accountDialog = page.getByRole("dialog", { name: "新建客户账户" });
  await expect(accountDialog).toBeVisible();
  await accountDialog.getByLabel("名称").fill(accountName);
  await accountDialog.getByRole("button", { name: "创建" }).click();
  await expect(accountDialog).toBeHidden();
  const accountRow = page.locator("tbody tr", { hasText: accountName });
  await expect(accountRow).toBeVisible();
  await expect(accountRow.getByText("生效中")).toBeVisible();

  // 2. 销售机会（Deal 只能进入机会）
  await tabs.getByRole("tab", { name: /机会/ }).click();
  await page.getByRole("button", { name: "新建销售机会" }).click();
  const opportunityDialog = page.getByRole("dialog", { name: "新建销售机会" });
  await opportunityDialog.getByLabel("名称").fill(opportunityName);
  await opportunityDialog
    .getByLabel("客户账户")
    .selectOption({ label: accountName });
  await opportunityDialog.getByRole("button", { name: "创建" }).click();
  await expect(opportunityDialog).toBeHidden();
  const opportunityRow = page.locator("tbody tr", { hasText: opportunityName });
  await expect(opportunityRow).toBeVisible();
  await expect(opportunityRow.getByText(accountName)).toBeVisible();

  // 3. 报价
  await tabs.getByRole("tab", { name: /报价/ }).click();
  await page.getByRole("button", { name: "新建报价" }).click();
  const quoteDialog = page.getByRole("dialog", { name: "新建报价" });
  await quoteDialog.getByLabel("机会").selectOption({ label: opportunityName });
  await quoteDialog.getByLabel("金额").fill(quoteAmount);
  await quoteDialog.getByRole("button", { name: "创建" }).click();
  await expect(quoteDialog).toBeHidden();
  const quoteRow = page.locator("tbody tr", { hasText: opportunityName });
  await expect(quoteRow).toBeVisible();
  await expect(quoteRow.getByText("v1")).toBeVisible();
  await expect(quoteRow.getByText("草稿")).toBeVisible();

  // 4. 接受报价（DRAFT → ACCEPTED）
  await quoteRow.getByRole("button", { name: "接受" }).click();
  await expect(quoteRow.getByText("已验收")).toBeVisible();
  // 合同下拉的选项文案来自同一行：`v1 · <金额> <币种>`，此处取渲染值保证精确选中。
  const quoteAmountLabel = (
    await quoteRow.locator("td").nth(2).innerText()
  ).trim();
  expect(quoteAmountLabel).toContain(quoteAmount);

  // 5. 合同（必须来自已接受报价）
  await tabs.getByRole("tab", { name: /合同/ }).click();
  await page.getByRole("button", { name: "新建合同" }).click();
  const contractDialog = page.getByRole("dialog", { name: "新建合同" });
  await contractDialog
    .getByLabel("客户账户")
    .selectOption({ label: accountName });
  await contractDialog.getByLabel("机会").selectOption({ label: opportunityName });
  await expect(
    contractDialog.getByLabel("已接受报价"),
  ).toContainText("v1");
  await contractDialog
    .getByLabel("已接受报价")
    .selectOption({ label: `v1 · ${quoteAmountLabel}` });
  await contractDialog.getByLabel("合同号").fill(contractRef);
  await contractDialog.getByLabel("金额").fill(quoteAmount);
  await contractDialog.getByRole("button", { name: "创建" }).click();
  await expect(contractDialog).toBeHidden();
  const contractRow = page.locator("tbody tr", { hasText: contractRef });
  await expect(contractRow).toBeVisible();
  await expect(contractRow.getByText("草稿")).toBeVisible();

  // 6. 签署合同（DRAFT → SIGNED）
  await contractRow.getByRole("button", { name: "签署" }).click();
  await expect(contractRow.getByText("已签署")).toBeVisible();

  // 7. 订单（必须来自已签合同）
  await tabs.getByRole("tab", { name: /订单/ }).click();
  await page.getByRole("button", { name: "新建订单" }).click();
  const orderDialog = page.getByRole("dialog", { name: "新建订单" });
  await orderDialog.getByLabel("客户账户").selectOption({ label: accountName });
  await orderDialog
    .getByLabel("已签合同")
    .selectOption({ label: contractRef });
  await orderDialog.getByLabel("订单号").fill(orderNumber);
  await orderDialog.getByLabel("行项目描述").fill("E2E 充电桩整机");
  await orderDialog.getByLabel("数量").fill("2");
  await orderDialog.getByLabel("单价").fill("6000");
  await orderDialog.getByRole("button", { name: "创建" }).click();
  await expect(orderDialog).toBeHidden();
  const orderRow = page.locator("tbody tr", { hasText: orderNumber });
  await expect(orderRow).toBeVisible();
  await expect(orderRow.getByText("草稿")).toBeVisible();

  // 8. 确认订单（DRAFT → CONFIRMED）
  await orderRow.getByRole("button", { name: "确认" }).click();
  await expect(orderRow.getByText("已确认")).toBeVisible();

  // 顶部统计同步（共享 dev server 上计数可能 >1，只断言单调事实）。
  const signedStat = page
    .locator(".stat-tile", { hasText: "已签合同" })
    .locator(".stat-tile__value");
  const confirmedStat = page
    .locator(".stat-tile", { hasText: "已确认订单" })
    .locator(".stat-tile__value");
  await expect(signedStat).toHaveText(/^[1-9]\d*$/);
  await expect(confirmedStat).toHaveText(/^[1-9]\d*$/);

  // 持久化断言：同一条生命周期链在 API 侧状态一致。
  const accounts = await jsonRows<{ id: string; name: string; status: string }>(
    page,
    "/api/v1/commercial/accounts",
  );
  const account = accounts.find((row) => row.name === accountName);
  expect(account, "account persisted").toBeTruthy();

  const opportunities = await jsonRows<{
    id: string;
    name: string;
    accountId: string;
    stage: string;
  }>(page, "/api/v1/commercial/opportunities");
  const opportunity = opportunities.find((row) => row.name === opportunityName);
  expect(opportunity, "opportunity persisted").toBeTruthy();
  expect(opportunity!.accountId).toBe(account!.id);

  const quotes = await jsonRows<{
    opportunityId: string;
    status: string;
    amount: string;
    version: number;
  }>(page, "/api/v1/commercial/quotes");
  const quote = quotes.find((row) => row.opportunityId === opportunity!.id);
  expect(quote, "quote persisted").toBeTruthy();
  expect(quote!.status).toBe("ACCEPTED");
  expect(quote!.version).toBe(1);

  const contracts = await jsonRows<{
    contractRef: string;
    status: string;
    quoteId: string;
  }>(page, "/api/v1/commercial/contracts");
  const contract = contracts.find((row) => row.contractRef === contractRef);
  expect(contract, "contract persisted").toBeTruthy();
  expect(contract!.status).toBe("SIGNED");

  const orders = await jsonRows<{
    orderNumber: string;
    status: string;
    contractId: string;
  }>(page, "/api/v1/commercial/orders");
  const order = orders.find((row) => row.orderNumber === orderNumber);
  expect(order, "order persisted").toBeTruthy();
  expect(order!.status).toBe("CONFIRMED");
  expect(order!.contractId).toBe(contract!.id);
});
