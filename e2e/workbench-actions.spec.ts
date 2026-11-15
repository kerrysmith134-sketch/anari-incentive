/**
 * AUD-016：工作台行内动作黄金路径（员工）。
 * 三条路径全部 UI→API→持久化→UI 回写：
 *  1. 补交证据（待办 → 证据模态 → 证据落库）
 *  2. 确认计算结果（待办 → 员工确认）
 *  3. 申诉绩效决定（决定行 → 申诉模态 → 申诉落库）
 */
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

const ME = "00000000-0000-4000-8000-000000000001";
const REVIEWER = "00000000-0000-4000-8000-000000000002";

function devHeaders(personId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-tenant-id": "tenant-demo",
    "x-user-id": `dev-${personId.slice(-3)}`,
    "x-person-id": personId,
  };
}

/**
 * 种一个真实 FORMAL 计算运行（AUD-016 黄金路径 2 的确认对象）：
 * 政策 → 法务门禁 → 工作包/申报/归属 → 周期+草案+决定 → 运行 → 员工确认 → 批准。
 */
async function seedFormalRun(
  request: APIRequestContext,
  stamp: string,
): Promise<{ runId: string; cycleId: string }> {
  const published = await request.post("/api/v1/policy-versions", {
    headers: devHeaders(ME),
    data: {
      policy: {
        code: `WB_POLICY_${stamp}`,
        version: 1,
        currency: "CNY",
        poolRate: "0.05",
        poolCap: "100000",
        rounding: "HALF_UP",
        calculator: "SIMPLE_POOL",
        evaluation: { dimensionWeights: { QUALITY: "1" }, floor: "0.5", ceiling: "1.5" },
      },
      effectiveFrom: "2026-10-01T00:00:00.000Z",
      approvedBy: ME,
      applicability: {
        legalEntity: "WB Entity",
        jurisdictions: ["CN"],
        workLocations: ["Shanghai"],
        employeeCategories: ["FULL_TIME"],
        workTimeTypes: ["FULL_TIME"],
      },
    },
  });
  expect(published.status(), await published.text()).toBe(201);
  const policyVersionId = ((await published.json()) as { data: { policyVersionId: string } }).data.policyVersionId;

  const gate = await request.post(`/api/v1/policy-versions/${policyVersionId}/legal-gate`, {
    headers: devHeaders(ME),
    data: {
      democraticProcedureRef: `dp-${stamp}`,
      employeeNoticeRef: `notice-${stamp}`,
      dataProtectionAssessmentRef: `dpia-${stamp}`,
      minimumWageChecked: true,
      policyApproved: true,
      recordedBy: ME,
    },
  });
  expect(gate.status(), await gate.text()).toBeLessThan(300);

  const cycle = await request.post("/api/v1/evaluation-cycles", {
    headers: devHeaders(ME),
    data: {
      name: `wb-run-cycle-${stamp}`,
      cycleType: "MONTHLY",
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-10-31T23:59:59.999Z",
      timezone: "Asia/Shanghai",
    },
  });
  expect(cycle.status()).toBe(201);
  const cycleId = ((await cycle.json()) as { data: { id: string } }).data.id;

  const rubric = await request.post("/api/v1/rubrics", {
    headers: devHeaders(ME),
    data: {
      code: `WB_RUN_RUBRIC_${stamp}`,
      name: "wb run rubric",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-10-01T00:00:00.000Z",
    },
  });
  const rubricId = ((await rubric.json()) as { data: { id: string } }).data.rubricVersionId ?? ((await rubric.json()) as { data: { id: string } }).data.id;

  const wp = await request.post("/api/v1/work-packages", {
    headers: devHeaders(ME),
    data: {
      title: `wb-run-wp-${stamp}`,
      objective: "formal run seeding objective",
      ownerPersonId: ME,
      members: [
        { personId: ME, responsibilityCode: "OWNER", expectedOutput: "delivery" },
        { personId: REVIEWER, responsibilityCode: "CONTRIBUTOR", expectedOutput: "review" },
      ],
      acceptanceCriteria: ["done"],
    },
  });
  const wpId = ((await wp.json()) as { data: { id: string } }).data.id;
  await request.post(`/api/v1/work-packages/${wpId}/commit`, { headers: devHeaders(ME), data: { expectedVersion: 1 } });
  await request.post(`/api/v1/work-packages/${wpId}/start`, { headers: devHeaders(ME) });
  await request.post(`/api/v1/work-packages/${wpId}/submit`, { headers: devHeaders(ME) });
  await request.post(`/api/v1/work-packages/${wpId}/accept`, { headers: devHeaders(REVIEWER), data: { reviewerPersonId: REVIEWER } });

  // 归属决定：裁决人 ≠ 申报人（ADJUDICATOR_IS_CLAIMANT 不变量）。
  const other = (person: string) => (person === ME ? REVIEWER : ME);
  for (const person of [ME, REVIEWER]) {
    const claim = await request.post("/api/v1/contribution-claims", {
      headers: devHeaders(person),
      data: {
        workPackageId: wpId,
        claimantPersonId: person,
        claimType: "DELIVERABLE_CONTRIBUTION",
        claimedContribution: { dimensions: ["QUALITY"], summary: "wb run claim" },
        evidenceRefs: [],
        rationale: "wb run seeding claim",
      },
    });
    const claimId = ((await claim.json()) as { data: { id: string } }).data.id;
    await request.post(`/api/v1/contribution-claims/${claimId}/submit`, { headers: devHeaders(person) });
    const decision = await request.post("/api/v1/attribution-decisions", {
      headers: devHeaders(other(person)),
      data: {
        claimId,
        adjudicatorPersonId: other(person),
        status: "CONFIRMED",
        acceptedFacts: ["delivered"],
        rejectedFacts: [],
        contributionDimensions: { QUALITY: 1 },
        rationale: "wb run attribution",
      },
    });
    expect(decision.status(), await decision.text()).toBeLessThan(300);
  }

  // 评价草案：每人一份，独立评审人 ≠ 本人（SELF_REVIEW_FORBIDDEN 不变量）。
  for (const person of [ME, REVIEWER]) {
    const draft = await request.post("/api/v1/evaluation-drafts", {
      headers: devHeaders(ME),
      data: {
        cycleId,
        personId: person,
        generatedByType: "SYSTEM",
        evidenceSnapshotHash: `wb-run-${person}-${stamp}`,
        draftPayload: {},
      },
    });
    const draftId = ((await draft.json()) as { data: { id: string } }).data.id;
    await request.post(`/api/v1/evaluation-drafts/${draftId}/submit`, { headers: devHeaders(ME) });
    const decided = await request.post(`/api/v1/evaluation-drafts/${draftId}/decision`, {
      headers: devHeaders(other(person)),
      data: {
        reviewerPersonId: other(person),
        rubricVersionId: rubricId,
        decision: "APPROVE",
        scores: { QUALITY: 4 },
        independentScores: { QUALITY: 4 },
        independentRationale: "wb run",
        evidenceOpened: 1,
        rationale: "wb run decision",
      },
    });
    expect(decided.status(), await decided.text()).toBeLessThan(300);
  }

  const decisions: Record<string, string> = {};
  const draftList = await request.get(`/api/v1/evaluation-decisions?cycleId=${cycleId}`, { headers: devHeaders(ME) });
  for (const row of ((await draftList.json()) as { data: Array<{ id: string; personId: string; status: string }> }).data) {
    if (row.status === "APPROVED") decisions[row.personId] = row.id;
  }

  const run = await request.post("/api/v1/calculation-runs", {
    headers: devHeaders(ME),
    data: {
      cycleId,
      policyVersionId,
      mode: "FORMAL",
      order: { id: `wb-run-order-${stamp}`, grossProfit: "500000", currency: "CNY" },
      participants: [
        { personId: ME, workPackageId: wpId, attributionWeight: "0.6", role: "OWNER", evaluationDecisionId: decisions[ME]! },
        { personId: REVIEWER, workPackageId: wpId, attributionWeight: "0.4", role: "CONTRIBUTOR", evaluationDecisionId: decisions[REVIEWER]! },
      ],
    },
  });
  expect(run.status(), await run.text()).toBeLessThan(300);
  const runId = ((await run.json()) as { data: { id: string } }).data.id;
  for (const person of [ME, REVIEWER]) {
    await request.post("/api/v1/employee-confirmations", {
      headers: devHeaders(person),
      data: { personId: person, targetType: "CALCULATION", targetId: runId, decision: "CONFIRMED" },
    });
  }
  const approved = await request.post(`/api/v1/calculation-runs/${runId}/approve`, {
    headers: devHeaders(ME),
    data: {},
  });
  expect(approved.status(), await approved.text()).toBeLessThan(300);
  return { runId, cycleId };
}

async function seedTodo(
  request: APIRequestContext,
  input: Record<string, unknown>,
): Promise<string> {
  const res = await request.post("/api/v1/agent-todos:upsert", {
    headers: devHeaders(ME),
    data: input,
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { data: { id: string } }).data.id;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "anari.session",
      JSON.stringify({
        tenantId: "tenant-demo",
        userId: "dev-user",
        // 注意：init script 在浏览器作用域执行，不能引用 Node 侧常量（ME）。
        personId: "00000000-0000-4000-8000-000000000001",
        token: "",
      }),
    );
  });
});

test("黄金路径 1：待办补证——证据模态提交后证据落库并标记完成", async ({ page }) => {
  page.on("pageerror", (err) => console.log("PAGE-ERR", String(err).slice(0, 260)));
  page.on("console", (msg) => { if (msg.type() === "error") console.log("CONSOLE-ERR", msg.text().slice(0, 200)); });
  page.on("response", (res) => { if (res.status() >= 400) console.log("HTTP-ERR", res.status(), res.url().slice(0, 130)); });
  const stamp = `${Date.now()}`;
  // 种子：工作包（真实实体）+ 补证待办
  const wp = await page.request.post("/api/v1/work-packages", {
    headers: devHeaders(ME),
    data: {
      title: `wb-evidence-${stamp}`,
      objective: "workbench golden path objective",
      ownerPersonId: ME,
      members: [{ personId: ME, responsibilityCode: "OWNER", expectedOutput: "delivery" }],
      acceptanceCriteria: ["done"],
    },
  });
  expect(wp.status()).toBe(201);
  const wpId = ((await wp.json()) as { data: { id: string } }).data.id;

  await seedTodo(page.request, {
    title: `补交证据 wp-${stamp}`,
    assigneePersonId: ME,
    targetType: "WORK_PACKAGE",
    targetId: wpId,
    sourceType: "AGENT_FINDING",
    sourceId: "E2E",
    idempotencyKey: `e2e-evidence-${stamp}`,
  });

  await page.goto("/console/my-workbench");
  const todoRow = page.locator("li", { hasText: `补交证据 wp-${stamp}` });
  await expect(todoRow).toBeVisible();
  await todoRow.getByRole("button", { name: "补交证据" }).click();
  await page.getByLabel("证据说明").fill("已上传客户签收单（golden path e2e）");
  await page.getByRole("button", { name: "提交证据" }).click();
  await expect(page.getByText("证据已提交，等待复核")).toBeVisible();

  // 证据确实落库
  const evidence = await page.request.get(
    `/api/v1/evidence?subjectType=WORK_PACKAGE&subjectId=${wpId}`,
    { headers: devHeaders(ME) },
  );
  const items = ((await evidence.json()) as { data: Array<{ normalizedPayload: { note?: string } }> }).data;
  expect(items.some((item) => item.normalizedPayload?.note?.includes("golden path e2e"))).toBe(true);

  // 标记完成 → 待办从 OPEN 列表消失
  await todoRow.getByRole("button", { name: "标记完成" }).click();
  await expect(page.getByText("待办已完成")).toBeVisible();
  await expect(todoRow).toBeHidden();
});

test("黄金路径 2：待办确认计算结果——员工确认落库", async ({ page }) => {
  const stamp = `${Date.now()}`;
  const stamp2 = `${stamp}-run`;
  const { runId } = await seedFormalRun(page.request, stamp2);
  await seedTodo(page.request, {
    title: `确认计算结果 ${stamp}`,
    assigneePersonId: ME,
    targetType: "CALCULATION",
    targetId: runId,
    sourceType: "AGENT_FINDING",
    sourceId: "E2E",
    idempotencyKey: `e2e-confirm-${stamp}`,
  });

  await page.goto("/console/my-workbench");
  const todoRow = page.locator("li", { hasText: `确认计算结果 ${stamp}` });
  await expect(todoRow).toBeVisible();
  await todoRow.getByRole("button", { name: "确认结果" }).click();
  await expect(page.getByText("已确认计算结果")).toBeVisible();

  const confirmations = await page.request.get("/api/v1/employee-confirmations", {
    headers: devHeaders(ME),
  });
  const rows = (await confirmations.json()) as {
    data: Array<{ targetType: string; targetId: string; decision: string }>;
  };
  expect(
    rows.data.some(
      (row) => row.targetType === "CALCULATION" && row.targetId === runId && row.decision === "CONFIRMED",
    ),
  ).toBe(true);
});

test("黄金路径 3：绩效决定行内申诉——申诉落库并出现在我的申诉", async ({ page }) => {
  const stamp = `${Date.now()}`;
  // 种子：周期 → 草案（本人）→ 提交 → 独立评审人批准（评审人 ≠ 本人）
  const cycle = await page.request.post("/api/v1/evaluation-cycles", {
    headers: devHeaders(ME),
    data: {
      name: `wb-cycle-${stamp}`,
      cycleType: "MONTHLY",
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-10-31T23:59:59.999Z",
      timezone: "Asia/Shanghai",
    },
  });
  expect(cycle.status()).toBe(201);
  const cycleId = ((await cycle.json()) as { data: { id: string } }).data.id;

  const draft = await page.request.post("/api/v1/evaluation-drafts", {
    headers: devHeaders(ME),
    data: {
      cycleId,
      personId: ME,
      generatedByType: "SYSTEM",
      evidenceSnapshotHash: `wb-${stamp}`,
      draftPayload: {},
    },
  });
  expect(draft.status()).toBe(201);
  const draftId = ((await draft.json()) as { data: { id: string } }).data.id;
  await page.request.post(`/api/v1/evaluation-drafts/${draftId}/submit`, {
    headers: devHeaders(ME),
  });

  const rubric = await page.request.post("/api/v1/rubrics", {
    headers: devHeaders(ME),
    data: {
      code: `WB_RUBRIC_${stamp}`,
      name: "workbench rubric",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-10-01",
    },
  });
  const rubricId = ((await rubric.json()) as { data: { id: string } }).data.id;

  const decided = await page.request.post(`/api/v1/evaluation-drafts/${draftId}/decision`, {
    headers: devHeaders(REVIEWER),
    data: {
      reviewerPersonId: REVIEWER,
      rubricVersionId: rubricId,
      decision: "APPROVE",
      scores: { QUALITY: 4 },
      independentScores: { QUALITY: 4 },
      independentRationale: "wb e2e",
      evidenceOpened: 1,
      rationale: "wb e2e decision",
    },
  });
  expect(decided.status(), await decided.text()).toBeLessThan(300);

  await page.goto("/console/my-workbench");
  const decisionRow = page
    .locator("li", { hasText: `周期 ${cycleId.slice(0, 8)}` })
    .filter({ hasText: "QUALITY" })
    .first();
  await expect(decisionRow).toBeVisible();
  await decisionRow.getByRole("button", { name: "发起申诉" }).click();
  await page.getByLabel("申诉陈述").fill("对评分维度权重有异议，申请复核（golden path e2e）");
  await page.getByRole("button", { name: "提交申诉" }).click();
  await expect(page.getByText("申诉已提交，进入复核流程")).toBeVisible();

  const appeals = await page.request.get("/api/v1/appeals", { headers: devHeaders(ME) });
  const rows = (await appeals.json()) as { data: Array<{ statement: string }> };
  expect(rows.data.some((row) => row.statement.includes("golden path e2e"))).toBe(true);
});
