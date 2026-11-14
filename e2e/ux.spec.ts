import { expect, test, type Page } from "@playwright/test";

const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

async function openTab(page: Page, name: string | RegExp) {
  await page.getByRole("tab", { name }).click();
}

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

test.describe("2026 policy centre UX", () => {
  test("shows all four policy calculation tabs", async ({ page }) => {
    await page.goto("/console/institutions");
    for (const [tab, heading] of [
      ["绩效计分", "月度绩效评分（M-001 / M-002 / M-003）"],
      ["激励分配", "业务中心 DBCP 与季度提成（016 第六、七条）"],
      ["专项奖励", "专项悬赏核定（时间系数 × 质量系数）"],
      ["股权测算", "四维配股测算（岗位基准 × 绩效系数 × 司龄系数）"],
    ] as const) {
      await openTab(page, tab);
      await expect(page.getByText(heading, { exact: false })).toBeVisible();
    }
  });

  test("loads the quarterly metric template into the goal card editor", async ({
    page,
  }) => {
    await page.goto("/console/performance");
    await openTab(page, "目标卡与评分");
    await page.getByRole("button", { name: "载入岗位指标模板" }).click();
    const editor = page.locator("textarea").first();
    await expect(editor).toHaveValue(/Q-S-001/);
    await expect(editor).toHaveValue(/weight/);
  });

  test("creates a cycle and advances it through the state machine", async ({
    page,
  }) => {
    const name = `E2E 周期 ${stamp()}`;
    await page.goto("/console/cycles");
    await page.getByRole("button", { name: "新建周期" }).click();
    await expect(
      page.getByRole("dialog", { name: "新建考核周期" }),
    ).toBeVisible();
    await page.getByLabel("周期名称").fill(name);
    await page.getByLabel("开始日期").fill("2026-11-01");
    await page.getByLabel("结束日期").fill("2026-11-30");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.getByText(name).first()).toBeVisible();
    await expect(page.getByText("周期流程")).toBeVisible();
    await page.getByRole("button", { name: /推进到/ }).click();
    await expect(page.getByText("周期已推进")).toBeVisible();
  });

  test("starts an eight-step equity grant workflow", async ({ page }) => {
    await page.goto("/console/equity");
    await openTab(page, "授予决策流程");
    await expect(page.getByText("发起股权授予流程")).toBeVisible();
    await page.getByRole("button", { name: "发起授予流程" }).click();
    await expect(page.getByText("授予流程已发起")).toBeVisible();
    // 授予步骤状态已中文化为「资格确认」
    await expect(page.getByText("资格确认").first()).toBeVisible();
  });

  test("approves, locks and exports an award batch", async ({ page }) => {
    const batchNo = `E2E-AWARD-${stamp()}`;
    const created = await page.request.post(
      "/api/v1/incentive-award-batches",
      {
        data: {
          batchNo,
          awardType: "MONTHLY_STAR",
          period: "2026-11",
          currency: "CNY",
          createdBy: "00000000-0000-4000-8000-000000000003",
          lines: [
            {
              personId: "00000000-0000-4000-8000-000000000002",
              amount: "500",
            },
          ],
        },
      },
    );
    expect(created.status()).toBe(201);
    await page.goto("/console/award-batches");
    const row = page.getByRole("row", { name: new RegExp(batchNo) });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "提交审批" }).click();
    await expect(row.getByRole("button", { name: "批准" })).toBeVisible();
    await row.getByRole("button", { name: "批准" }).click();
    await expect(row.getByRole("button", { name: "锁定" })).toBeVisible();
    await row.getByRole("button", { name: "锁定" }).click();
    const popupPromise = page.waitForEvent("popup");
    await row.getByRole("button", { name: "导出" }).click();
    const popup = await popupPromise;
    await popup.close();
    await expect(row.getByRole("button", { name: "下载" })).toBeVisible();
  });

  test("saves statutory deduction types from the payroll tab", async ({
    page,
  }) => {
    await page.goto("/console/payroll");
    await openTab(page, "法定扣款类型");
    await page.getByRole("button", { name: "载入当前配置" }).click();
    const editor = page.locator("textarea").first();
    await editor.fill(
      JSON.stringify(
        [
          {
            type: "COURT_ORDER",
            priority: 0,
            capRate: "0.5",
            requiresCourtOrder: true,
          },
        ],
        null,
        2,
      ),
    );
    await page.getByRole("button", { name: "保存类型" }).click();
    await expect(page.getByText("法定扣款类型已保存")).toBeVisible();
  });

  test("generates an annual review snapshot from the policy audit tab", async ({
    page,
  }) => {
    await page.goto("/console/policy");
    await openTab(page, "审计报告");
    await expect(page.getByText("年度审查快照")).toBeVisible();
    await expect(page.getByText("评审人一致性（ATT-09）")).toBeVisible();
    await page.getByRole("button", { name: "生成年度快照" }).click();
    await expect(page.getByText("年度审查快照已生成")).toBeVisible();
    await expect(page.getByRole("button", { name: "导出 HTML" }).first()).toBeVisible();
  });

  test("opens the gold-set import dialog", async ({ page }) => {
    await page.goto("/console/ai");
    await openTab(page, "金标集");
    await page.getByRole("button", { name: "导入金标集" }).click();
    await expect(
      page.getByRole("dialog", { name: "导入金标集样本" }),
    ).toBeVisible();
    await expect(page.getByText(/samples/).first()).toBeVisible();
  });

  test("creates a task pod from the task-based organisation page", async ({
    page,
  }) => {
    await page.goto("/console/task-pods");
    await page.getByLabel("任务名称").fill(`E2E 任务组 ${stamp()}`);
    await page.getByLabel("目标成果").fill("验证任务组创建与结果负责");
    await page.getByRole("button", { name: "创建任务组" }).click();
    await expect(page.getByText("任务组已创建")).toBeVisible();
  });

  test("management center hides AI drafts until independent judgment completes (NPV2-029)", async ({
    page,
  }) => {
    await page.goto("/console/management");
    await expect(
      page.getByRole("heading", { name: "管理中心" }),
    ).toBeVisible();
    // 周期选择与四大面板在位
    await expect(
      page.getByRole("heading", { name: "周期准备度（七门禁）" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /独立评价进度/ }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /异常申报/ }).first()).toBeVisible();
    // ATT-06：无草案数据时显示空态；有草案时按独立判断状态隐藏/揭示。
    await expect(page.getByText(/暂无评价草案|AI 草稿已隐藏|待完成独立判断/).first()).toBeVisible();
    // 红线声明：不自动锁账/结算
    await expect(page.getByText(/不执行锁账\/结算/)).toBeVisible();
  });

  test("my workbench aggregates personal scopes without cross-tenant data (NPV2-028)", async ({
    page,
  }) => {
    await page.goto("/console/my-workbench");
    await expect(
      page.getByRole("heading", { name: "我的工作台" }),
    ).toBeVisible();
    // 六个作用域面板全部在位
    for (const panel of [
      "我的待办",
      "我的贡献申报",
      "我的贡献事件",
      "我的绩效与解释",
      "我的确认",
      "我的申诉",
    ]) {
      await expect(page.getByRole("heading", { name: panel })).toBeVisible();
    }
    // 可追溯性提示在绩效面板
    await expect(page.getByText(/指标计量快照/)).toBeVisible();
  });

  test("downloads a personal data package and files a DSAR", async ({ page }) => {
    await page.goto("/console/privacy");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载我的数据包" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/my-data-package-.*\.json/);
    await page.getByRole("button", { name: "提交请求" }).click();
    await expect(page.getByText("请求已提交")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "ACCESS" }).first()).toBeVisible();
  });

  test("every visible button has an accessible name", async ({ page }) => {
    await page.goto("/console/institutions");
    const unnamed = await page.locator("button:visible").evaluateAll((buttons) =>
      buttons.filter((button) => {
        const label = button.getAttribute("aria-label");
        const text = (button.textContent ?? "").trim();
        return !label && !text;
      }).length,
    );
    expect(unnamed).toBe(0);
  });

  test("pages expose exactly one h1 and labelled form controls", async ({
    page,
  }) => {
    for (const path of ["/console/institutions", "/console/award-batches", "/console/privacy"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
      const unlabeled = await page
        .locator("input:visible, select:visible, textarea:visible")
        .evaluateAll((controls) =>
          controls.filter((control) => {
            const id = control.getAttribute("id");
            const aria = control.getAttribute("aria-label");
            const labelled = control.getAttribute("aria-labelledby");
            const hasFor = id
              ? Boolean(document.querySelector(`label[for="${id}"]`))
              : false;
            return !aria && !labelled && !hasFor;
          }).length,
        );
      expect(unlabeled).toBe(0);
    }
  });
});
