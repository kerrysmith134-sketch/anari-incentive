import { expect, test, type Page } from "@playwright/test";

const OWNER = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000003";
const MEMBER = "00000000-0000-4000-8000-000000000002";

const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

async function auth(page: Page) {
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
}

test.beforeEach(async ({ page }) => {
  await auth(page);
});

async function tab(page: Page, name: string) {
  await page.getByRole("tab", { name }).click();
}

test.describe("UI hardening rounds 01-08: calculators", () => {
  test("01 monthly performance score renders 95.3 / 0.953", async ({ page }) => {
    await page.goto("/console/institutions");
    await page.getByLabel("M-001 任务按期有效闭环率").fill("95");
    await page.getByLabel("M-002 岗位胜任能力考试").fill("88");
    await page.getByLabel("M-003 价值观事件调整").fill("4");
    await page.getByRole("button", { name: "计算月度绩效" }).click();
    await expect(page.getByText("95.3", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("0.953", { exact: true }).first()).toBeVisible();
  });

  test("02 DBCP and commission render 750000 / 30000", async ({ page }) => {
    await page.goto("/console/institutions");
    await tab(page, "激励分配");
    await page.getByRole("button", { name: "核算 DBCP 与提成" }).click();
    await expect(page.getByText("750000", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("30000", { exact: true }).first()).toBeVisible();
  });

  test("03 annual scorecard renders 104.5", async ({ page }) => {
    await page.goto("/console/institutions");
    await page.getByRole("button", { name: "计算年度得分" }).click();
    await expect(page.getByText("104.5", { exact: true }).first()).toBeVisible();
  });

  test("04 option strike price renders 27.5", async ({ page }) => {
    await page.goto("/console/institutions");
    await tab(page, "股权测算");
    await page.getByRole("button", { name: "计算行权价" }).click();
    await expect(page.getByText("27.5", { exact: true }).first()).toBeVisible();
  });

  test("05 Cap Table renders 4% and 96%", async ({ page }) => {
    await page.goto("/console/institutions");
    await tab(page, "股权测算");
    await page.getByRole("button", { name: "生成 Cap Table 快照" }).click();
    await expect(page.getByText("4%", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("96%", { exact: true }).first()).toBeVisible();
  });

  test("06 equity tax renders 800", async ({ page }) => {
    await page.goto("/console/institutions");
    await tab(page, "股权测算");
    await page.getByRole("button", { name: "测算税负" }).click();
    await expect(page.getByText("800", { exact: true }).first()).toBeVisible();
  });

  test("07 invalid goal-card JSON is reported without crashing", async ({
    page,
  }) => {
    await page.goto("/console/performance");
    await tab(page, "目标卡与评分");
    await page.locator("textarea").first().fill("{bad json");
    await page.getByRole("button", { name: "创建目标卡" }).click();
    await expect(page.locator(".notice--warning")).toBeVisible();
    await expect(page.getByText("Something broke in the console")).toHaveCount(0);
  });

  test("08 duplicate award batch number shows a form error", async ({ page }) => {
    const batchNo = `DUP-${stamp()}`;
    const created = await page.request.post("/api/v1/incentive-award-batches", {
      data: {
        batchNo,
        awardType: "MONTHLY_STAR",
        period: "2026-11",
        currency: "CNY",
        createdBy: ADMIN,
        lines: [{ personId: MEMBER, amount: "500" }],
      },
    });
    expect(created.status()).toBe(201);
    await page.goto("/console/award-batches");
    await page.getByLabel("批次号").fill(batchNo);
    await page.getByLabel("金额").fill("500");
    await page.getByRole("button", { name: "创建批次" }).click();
    await expect(page.locator(".notice--warning")).toBeVisible();
  });
});

test.describe("UI hardening rounds 09-16: validation and modals", () => {
  test("09 negative award amount is rejected in the form", async ({ page }) => {
    await page.goto("/console/award-batches");
    await page.getByLabel("批次号").fill(`NEG-${stamp()}`);
    await page.getByLabel("金额").fill("-5");
    await page.getByRole("button", { name: "创建批次" }).click();
    await expect(page.locator(".notice--warning")).toBeVisible();
  });

  test("10 invalid statutory JSON is reported", async ({ page }) => {
    await page.goto("/console/payroll");
    await tab(page, "法定扣款类型");
    await page.locator("textarea").first().fill("not-json");
    await page.getByRole("button", { name: "保存类型" }).click();
    await expect(page.locator(".notice--warning")).toBeVisible();
  });

  test("11 policy test-case modal opens with JSON fields", async ({ page }) => {
    await page.goto("/console/policy");
    await page.getByRole("button", { name: "新建用例" }).click();
    await expect(
      page.getByRole("dialog", { name: "新建回归用例" }),
    ).toBeVisible();
    await expect(page.getByLabel("用例编码")).toBeVisible();
    await expect(page.getByLabel("输入 JSON")).toBeVisible();
    await expect(page.getByLabel("期望输出 JSON")).toBeVisible();
  });

  test("12 registers a new prompt from the AI page", async ({ page }) => {
    const code = `PROMPT-E2E-${stamp()}`;
    await page.goto("/console/ai");
    await tab(page, "提示词登记簿");
    await page.getByRole("button", { name: "登记提示词" }).click();
    await expect(
      page.getByRole("dialog", { name: "登记提示词版本" }),
    ).toBeVisible();
    await page.getByLabel("提示词编码").fill(code);
    await page.getByLabel("版本号").fill("1");
    await page.getByLabel("用途").fill("证据摘要");
    await page.getByLabel("模型供应商").fill("openai");
    await page.getByLabel("模型名称").fill("gpt-test");
    await page.getByLabel("提示词模板").fill("请总结证据：{{evidence}}");
    await page.getByRole("button", { name: "登记", exact: true }).click();
    await expect(page.getByText("提示词已登记")).toBeVisible();
    await expect(page.getByText(code).first()).toBeVisible();
  });

  test("13 registers an AI member on the task-pod page", async ({ page }) => {
    const name = `E2E助理-${stamp()}`;
    await page.goto("/console/task-pods");
    await tab(page, "AI 成员");
    await page.getByLabel("名称").fill(name);
    await page.getByLabel("版本").fill("1.0.0");
    await page.getByRole("button", { name: "登记 AI 成员" }).click();
    await expect(page.getByText("AI 成员已登记")).toBeVisible();
    await expect(page.getByText(name).first()).toBeVisible();
  });

  test("14 inventory rejects HYBRID tasks without AI workflow", async ({ page }) => {
    await page.goto("/console/task-pods");
    await tab(page, "个人任务清单");
    await page.getByLabel("任务 1 名称").fill("E2E 周报");
    await page.getByLabel("可交付成果").fill("周报文档");
    await page.getByLabel("可衡量口径").fill("每周五前提交");
    await page.getByLabel("执行方式").selectOption("HYBRID");
    await page.getByRole("button", { name: "保存并校验" }).click();
    await expect(page.locator(".notice--warning")).toContainText("AI 工作流");
  });

  test("15 DSAR submission appears in the request table", async ({ page }) => {
    await page.goto("/console/privacy");
    await page.getByRole("button", { name: "提交请求" }).click();
    await expect(page.getByText("请求已提交")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "ACCESS" }).first()).toBeVisible();
  });

  test("16 budget-pool creation modal opens", async ({ page }) => {
    await page.goto("/console/settlements");
    await tab(page, "预算");
    await page.getByRole("button", { name: "新建资金池" }).first().click();
    await expect(page.getByRole("dialog", { name: "新建资金池" })).toBeVisible();
  });
});

test.describe("UI hardening rounds 17-24: accessibility", () => {
  test("17 Escape closes a modal", async ({ page }) => {
    await page.goto("/console/cycles");
    await page.getByRole("button", { name: "新建周期" }).click();
    await expect(page.getByRole("dialog", { name: "新建考核周期" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "新建考核周期" })).toHaveCount(0);
  });

  test("18 focus moves inside an opened modal", async ({ page }) => {
    await page.goto("/console/cycles");
    await page.getByRole("button", { name: "新建周期" }).click();
    const inside = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog ? dialog.contains(document.activeElement) : false;
    });
    expect(inside).toBe(true);
  });

  test("19 Chinese skip link is the first focus target", async ({ page }) => {
    await page.goto("/console/");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(
      () => document.activeElement?.textContent?.trim() ?? "",
    );
    expect(focused).toBe("跳到主要内容");
  });

  test("20 active navigation link exposes aria-current", async ({ page }) => {
    await page.goto("/console/performance");
    const link = page
      .getByRole("complementary", { name: "主导航" })
      .getByRole("link", { name: "绩效管理" });
    await expect(link).toHaveAttribute("aria-current", "page");
  });

  test("21 404 page is fully Chinese", async ({ page }) => {
    await page.goto("/console/does-not-exist");
    await expect(page.getByText("页面不存在")).toBeVisible();
    await expect(page.getByText("返回总览")).toBeVisible();
    await expect(page.getByText("That view does not exist")).toHaveCount(0);
  });

  test("22 login brand image loads", async ({ page }) => {
    await page.goto("/console/login");
    const logo = page.locator('img[src="/brand/logo-vertical.png"]');
    await expect(logo).toBeVisible();
    const width = await logo.evaluate((image) => (image as HTMLImageElement).naturalWidth);
    expect(width).toBeGreaterThan(0);
  });

  test("23 notification bulk-read really marks notifications read", async ({ page }) => {
    const created = await page.request.post("/api/v1/notifications", {
      data: {
        recipientPersonId: OWNER,
        audience: "PERSON",
        title: `E2E 通知 ${stamp()}`,
        body: "请阅读",
      },
    });
    expect(created.status()).toBe(201);
    await page.goto("/console/notifications");
    await page.getByRole("button", { name: "全部已读" }).click();
    await expect(page.getByText("全部已读").first()).toBeVisible();
    const list = await page.request.get("/api/v1/notifications");
    const rows = (await list.json()).data as Array<{ readAt?: string }>;
    expect(rows.every((row) => Boolean(row.readAt))).toBe(true);
  });

  test("24 all visible form controls are labelled on award batches", async ({
    page,
  }) => {
    await page.goto("/console/award-batches");
    const unlabeled = await page
      .locator("input:visible, select:visible, textarea:visible")
      .evaluateAll((controls) =>
        controls.filter((control) => {
          const id = control.getAttribute("id");
          const aria = control.getAttribute("aria-label");
          const labelled = control.getAttribute("aria-labelledby");
          return !aria && !labelled && !(id && document.querySelector(`label[for="${id}"]`));
        }).length,
      );
    expect(unlabeled).toBe(0);
  });
});

test.describe("UI hardening rounds 25-32: responsive and state", () => {
  test("25 mobile award-batches has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/console/award-batches");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test("26 cycle list displays Chinese cycle type", async ({ page }) => {
    const created = await page.request.post("/api/v1/evaluation-cycles", {
      data: {
        name: `E2E 月度 ${stamp()}`,
        cycleType: "MONTHLY",
        startsAt: new Date(Date.now() - 864e5).toISOString(),
        endsAt: new Date(Date.now() + 864e5).toISOString(),
        timezone: "Asia/Shanghai",
      },
    });
    expect(created.status()).toBe(201);
    await page.goto("/console/performance");
    await expect(page.getByText("月度").first()).toBeVisible();
    await expect(page.getByText("MONTHLY")).toHaveCount(0);
  });

  test("27 settlements tabs use Chinese labels", async ({ page }) => {
    await page.goto("/console/settlements");
    for (const label of ["批次", "账本", "预算"]) {
      await expect(page.getByRole("tab", { name: new RegExp(label) })).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Batches" })).toHaveCount(0);
  });

  test("28 equity workflow advance modal opens for a new case", async ({ page }) => {
    const created = await page.request.post("/api/v1/policy/equity/grant-cases", {
      data: {
        personId: MEMBER,
        instrument: "OPTION",
        positionLevel: "L2",
        financingStage: "A",
        performanceGrade: "B",
        tenureStage: "A",
        grantPercent: "1.0",
        totalUnits: "10000",
        strikePrice: "20",
      },
    });
    expect(created.status()).toBe(201);
    await page.goto("/console/equity");
    await tab(page, "授予决策流程");
    await page.getByRole("button", { name: /推进到/ }).first().click();
    await expect(page.getByRole("dialog", { name: /推进授予流程/ })).toBeVisible();
    await page.getByRole("button", { name: "确认推进" }).click();
    await expect(page.getByText("授予流程已推进")).toBeVisible();
  });

  test("29 switching policy tabs keeps the page usable", async ({ page }) => {
    await page.goto("/console/institutions");
    await tab(page, "激励分配");
    await tab(page, "绩效计分");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Something broke in the console")).toHaveCount(0);
  });

  test("30 no console errors on core page loads", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    for (const path of [
      "/console/institutions",
      "/console/award-batches",
      "/console/privacy",
      "/console/policy",
      "/console/ai",
    ]) {
      await page.goto(path);
      await page.waitForTimeout(200);
    }
    expect(errors).toEqual([]);
  });

  test("31 privacy page remains usable after download", async ({ page }) => {
    await page.goto("/console/privacy");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载我的数据包" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("my-data-package");
    await page.getByRole("button", { name: "提交请求" }).click();
    await expect(page.getByText("请求已提交")).toBeVisible();
  });

  test("32 tablet layout keeps the sidebar visible", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/console/");
    await expect(page.getByRole("complementary", { name: "主导航" })).toBeVisible();
  });
});
