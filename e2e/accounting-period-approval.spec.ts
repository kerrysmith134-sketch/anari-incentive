/**
 * Finance Center 会计期间双人审批（NPV2-030）：
 * 请求人发起关闭 → 待审批列表出现 → 另一名财务用户批准 → 期间关闭。
 *
 * 跨用户通过在浏览器内切换 `anari.session`（请求人 → 财务复核人）并重载实现；
 * dev 认证按 X-Person-Id 识别身份，服务端 APPROVAL_SEPARATION_REQUIRED 会拒绝
 * 同一人自批，因此这条路径同时验证了职责分离在 UI 上可完成。
 */
import { expect, test, type Page } from "@playwright/test";

const REQUESTER = "00000000-0000-4000-8000-000000000001";
const FINANCE_REVIEWER = "00000000-0000-4000-8000-000000000003";

function sessionPayload(personId: string): string {
  return JSON.stringify({
    tenantId: "tenant-demo",
    userId: `dev-${personId.slice(-3)}`,
    personId,
    token: "",
  });
}

function devHeaders(personId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-tenant-id": "tenant-demo",
    "x-user-id": `dev-${personId.slice(-3)}`,
    "x-person-id": personId,
  };
}

async function switchUser(page: Page, personId: string): Promise<void> {
  await page.evaluate(
    ({ key, payload }) => localStorage.setItem(key, payload),
    { key: "anari.session", payload: sessionPayload(personId) },
  );
  await page.reload();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((payload) => {
    if (localStorage.getItem("anari.session") === null) {
      localStorage.setItem("anari.session", payload as string);
    }
  }, sessionPayload(REQUESTER));
});

test("会计期间关闭：请求人发起 → 另一财务用户批准 → 期间关闭", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const legalEntityId = `E2E-LE-${stamp}`;
  const period = "2026-10";
  const reason = "E2E 双人审批：月末关账";

  await page.goto("/console/finance-center");
  await expect(
    page.getByRole("heading", { level: 1, name: "财务中心" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "会计期间" }),
  ).toBeVisible();

  // 期间表与待审批表都渲染在同一 Panel 内，用标题/区块文案分别定位，避免
  // 批准后「期间行」与「待审批行」互相串扰。
  const periodPanel = page.locator("section.panel", {
    has: page.getByRole("heading", { level: 2, name: "会计期间" }),
  });
  const periodTable = periodPanel.locator("table").first();
  const pendingTable = periodPanel
    .locator(".detail-section", { hasText: "待审批请求" })
    .locator("table");

  // 1. 请求人发起关闭请求（PENDING，不直接关账）。
  await page.getByRole("button", { name: "发起变更" }).click();
  const dialog = page.getByRole("dialog", { name: "发起会计期间变更" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("动作")).toHaveValue("CLOSE");
  await dialog.getByLabel("法人主体").fill(legalEntityId);
  await dialog.getByLabel("会计期间").fill(period);
  await dialog.getByLabel("原因").fill(reason);
  await dialog.getByRole("button", { name: "提交审批" }).click();
  await expect(page.getByText("变更请求已提交")).toBeVisible();
  await expect(dialog).toBeHidden();

  // 2. 待审批列表出现该请求，且带批准/驳回动作。
  const pendingRow = pendingTable.locator("tbody tr", {
    hasText: legalEntityId,
  });
  await expect(pendingRow).toBeVisible();
  await expect(pendingRow.getByText(/^close$/i)).toBeVisible();
  await expect(pendingRow.getByText(period)).toBeVisible();
  await expect(pendingRow.getByText(reason)).toBeVisible();
  await expect(
    pendingRow.getByRole("button", { name: "批准" }),
  ).toBeVisible();
  await expect(
    pendingRow.getByRole("button", { name: "驳回" }),
  ).toBeVisible();

  // 3. 换成另一名财务用户（请求人 ≠ 审批人）后重载页面。
  await switchUser(page, FINANCE_REVIEWER);
  await expect(
    page.getByRole("heading", { level: 1, name: "财务中心" }),
  ).toBeVisible();
  const approverRow = pendingTable.locator("tbody tr", {
    hasText: legalEntityId,
  });
  await expect(approverRow).toBeVisible();
  const approveButton = approverRow.getByRole("button", { name: "批准" });
  await expect(approveButton).toBeVisible();

  // 4. 批准 → 请求执行、期间关闭、该请求离开待审批列表。
  await approveButton.click();
  await expect(page.getByText("已批准并执行")).toBeVisible();
  await expect(pendingTable.locator("tbody tr", { hasText: legalEntityId })).toHaveCount(0);
  await expect(
    periodTable
      .locator("tbody tr", { hasText: legalEntityId })
      .getByText("已关闭"),
  ).toBeVisible();

  // 5. 持久化断言：请求由请求人发出、由另一人批准，期间为 CLOSED。
  const periods = await page.request.get(
    `/api/v1/accounting-periods?legalEntityId=${encodeURIComponent(legalEntityId)}&period=${period}`,
    { headers: devHeaders(FINANCE_REVIEWER) },
  );
  expect(periods.status(), await periods.text()).toBe(200);
  const periodRows = (
    (await periods.json()) as {
      data: Array<{ status: string; closedBy?: string }>;
    }
  ).data;
  expect(periodRows).toHaveLength(1);
  expect(periodRows[0]!.status).toBe("CLOSED");
  expect(periodRows[0]!.closedBy).toBe(FINANCE_REVIEWER);

  const requests = await page.request.get(
    `/api/v1/accounting-periods/change-requests?legalEntityId=${encodeURIComponent(legalEntityId)}&status=APPROVED`,
    { headers: devHeaders(FINANCE_REVIEWER) },
  );
  expect(requests.status(), await requests.text()).toBe(200);
  const decided = (
    (await requests.json()) as {
      data: Array<{
        action: string;
        status: string;
        requestedBy: string;
        decidedBy: string;
        period: string;
      }>;
    }
  ).data;
  expect(decided).toHaveLength(1);
  expect(decided[0]).toMatchObject({
    action: "CLOSE",
    status: "APPROVED",
    period,
    requestedBy: REQUESTER,
    decidedBy: FINANCE_REVIEWER,
  });
});
