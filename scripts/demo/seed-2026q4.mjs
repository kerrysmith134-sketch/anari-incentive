/**
 * Demo data seeder for Anari N-Perform (test server).
 * Runs INSIDE the api container: node /tmp/demo_seed.mjs
 * Idempotent-ish: looks up existing rows before creating.
 */
const BASE = process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
const TENANT = process.env.TENANT_ID ?? "00000000-0000-4000-8000-000000000001";
const EMAIL = process.env.LOGIN_EMAIL ?? "admin@anari.com";
const PASSWORD = process.env.LOGIN_PASSWORD ?? "Anari@2026";
const CYCLE_HINT = "2026 Q4";
const POLICY_VERSION_ID = "00000000-0000-4000-8000-000000000100";

let TOKEN = "";
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "x-session-token": TOKEN,
      "x-tenant-id": TENANT,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(payload.error ?? payload).slice(0, 300)}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload.data;
}

const ok = [];
const bad = [];
async function step(name, fn) {
  try {
    const out = await fn();
    ok.push(name);
    console.log(`  ok   ${name}`);
    return out;
  } catch (e) {
    bad.push(`${name}: ${e.message}`);
    console.log(`  FAIL ${name}: ${e.message}`);
    return undefined;
  }
}

// ---------------------------------------------------------------- login
const login = await api("POST", "/api/v1/auth/password/login", { email: EMAIL, password: PASSWORD });
TOKEN = login.token;
console.log(`logged in as ${login.user?.displayName ?? EMAIL}, tenant ${login.tenantId}`);

// ---------------------------------------------------------------- people
const PEOPLE = [
  ["A-001", "陈立", "总经理"],
  ["A-002", "林颖", "销售经理"],
  ["A-003", "周凯", "产品经理"],
  ["A-004", "苏婷", "销售代表"],
  ["A-005", "何川", "运营经理"],
  ["A-006", "许诺", "交付工程师"],
  ["A-007", "赵楠", "客户成功"],
  ["A-008", "郑昊", "销售代表"],
  ["A-009", "唐蕾", "采购主管"],
  ["A-010", "冯毅", "财务经理"],
];

const existing = (await api("GET", `/api/v1/platform/tenants/${TENANT}/persons`)) ?? [];
const byCode = new Map(existing.map((p) => [p.employeeCode, p]));
const people = {};
for (const [code, name, title] of PEOPLE) {
  if (byCode.has(code)) { people[code] = byCode.get(code).id; continue; }
  const p = await step(`person ${code} ${name}`, () =>
    api("POST", `/api/v1/platform/tenants/${TENANT}/persons`, {
      employeeCode: code,
      displayName: name,
      employmentStatus: "ACTIVE",
    }),
  );
  if (p) people[code] = p.id;
}
// fall back to the 4 pre-existing demo people when a create failed
const ids = Object.values(people).filter(Boolean);
const fallback = existing.map((p) => p.id);
const pick = (i) => ids[i % Math.max(ids.length, 1)] ?? fallback[i % Math.max(fallback.length, 1)];
const P = people;
const personId = (code) => P[code] ?? fallback[0];

// ---------------------------------------------------------------- org nodes
const nodes = (await api("GET", `/api/v1/platform/tenants/${TENANT}/org-nodes`)) ?? [];
if (nodes.length === 0) {
  const root = await step("org root", () =>
    api("POST", `/api/v1/platform/tenants/${TENANT}/org-nodes`, { code: "HQ", name: "总经办" }),
  );
  for (const [code, name] of [["SALES", "销售中心"], ["PRODUCT", "产品中心"], ["OPS", "交付与运营"], ["FIN", "财务部"]]) {
    await step(`org ${name}`, () =>
      api("POST", `/api/v1/platform/tenants/${TENANT}/org-nodes`, {
        code, name, parentId: root?.id,
      }),
    );
  }
} else {
  console.log(`  skip org nodes (${nodes.length} existing)`);
}

// ---------------------------------------------------------------- cycle + rubric
const cycles = (await api("GET", "/api/v1/evaluation-cycles")) ?? [];
let cycle = cycles.find((c) => (c.name ?? "").includes(CYCLE_HINT)) ?? cycles[0];
if (!cycle) {
  cycle = await api("POST", "/api/v1/evaluation-cycles", {
    name: "2026年10月考核周期（Q4 冲击）",
    cycleType: "MONTHLY",
    startsAt: "2026-10-01T00:00:00.000Z",
    endsAt: "2026-10-31T23:59:59.000Z",
    timezone: "Asia/Shanghai",
    policyVersionId: POLICY_VERSION_ID,
  });
}
const CYCLE = cycle.id;
console.log(`cycle ${CYCLE} (${cycle.name}, status ${cycle.status})`);

const rubrics = (await api("GET", "/api/v1/rubrics")) ?? [];
const RUBRIC = rubrics.find((r) => r.status === "ACTIVE")?.id ?? rubrics[0]?.id;

// ---------------------------------------------------------------- metrics
const METRICS = [
  ["SALES_REVENUE", "销售额", "CURRENCY", "CNY"],
  ["GROSS_MARGIN", "毛利率", "PERCENT", "%"],
  ["DELIVERY_ONTIME", "交付准时率", "PERCENT", "%"],
  ["CUSTOMER_CSAT", "客户满意度", "SCORE", "分"],
  ["RFQ_RESPONSE_DAYS", "询价响应时效", "NUMBER", "天"],
];
const metricExisting = new Set(((await api("GET", "/api/v1/metric-definitions")) ?? []).map((m) => m.code));
for (const [code, name, dataType, unit] of METRICS) {
  if (metricExisting.has(code)) continue;
  await step(`metric ${code}`, () =>
    api("POST", "/api/v1/metric-definitions", {
      code, version: 1, name, dataType, unit,
      description: `${name}（2026 制度口径）`,
      aggregationMethod: "SUM",
      effectiveFrom: "2026-10-01",
    }),
  );
}

// ---------------------------------------------------------------- work packages
const WP = [
  {
    title: "哈萨克斯坦 40 台直流桩订单交付",
    objective: "完成 Qazaq 项目 40 台 120kW 直流桩的生产、认证与现场调试，回款 62 万美元",
    owner: "A-002",
    members: [["A-002", "OWNER", "订单整体交付"], ["A-006", "CONTRIBUTOR", "现场调试与验收"], ["A-009", "CONTRIBUTOR", "供应链与物流"]],
    criteria: ["客户签收 40 台", "回款到账", "现场验收报告通过"],
    gp: "620000",
  },
  {
    title: "保加利亚 OEM 客户首单落地",
    objective: "拿下保加利亚客户 30 台 22kW 交流桩 OEM 首单并完成样机认证",
    owner: "A-004",
    members: [["A-004", "OWNER", "客户谈判与签约"], ["A-003", "CONTRIBUTOR", "产品规格与认证"], ["A-007", "CONTRIBUTOR", "售后方案"]],
    criteria: ["样机通过 CE 认证", "首单合同签署"],
    gp: "180000",
  },
  {
    title: "中亚渠道招商与代理商体系搭建",
    objective: "在乌兹别克斯坦、哈萨克斯坦签约 3 家区域代理商，建立备件仓",
    owner: "A-008",
    members: [["A-008", "OWNER", "渠道拓展"], ["A-005", "CONTRIBUTOR", "渠道政策设计"]],
    criteria: ["签约 3 家代理商", "首批备件入仓"],
    gp: "90000",
  },
];

const existingWps = (await api("GET", "/api/v1/work-packages")) ?? [];
const wpIds = {};
for (const spec of WP) {
  const found = existingWps.find((w) => w.title === spec.title);
  if (found) { wpIds[spec.title] = found.id; console.log(`  skip wp ${spec.title}`); continue; }
  const wp = await step(`wp ${spec.title}`, async () => {
    const created = await api("POST", "/api/v1/work-packages", {
      title: spec.title,
      objective: spec.objective,
      ownerPersonId: personId(spec.owner),
      members: spec.members.map(([code, responsibilityCode, expectedOutput]) => ({
        personId: personId(code), responsibilityCode, expectedOutput,
      })),
      acceptanceCriteria: spec.criteria,
    });
    await api("POST", `/api/v1/work-packages/${created.id}/commit`, { expectedVersion: 1 });
    await api("POST", `/api/v1/work-packages/${created.id}/start`);
    await api("POST", `/api/v1/work-packages/${created.id}/submit`);
    await api("POST", `/api/v1/work-packages/${created.id}/accept`, {
      reviewerPersonId: personId("A-001"),
      comments: "验收通过",
    });
    return created;
  });
  if (wp) wpIds[spec.title] = wp.id;
}

// ---------------------------------------------------------------- contribution claims
for (const spec of WP) {
  const wpId = wpIds[spec.title];
  if (!wpId) continue;
  for (const [code, , output] of spec.members) {
    await step(`claim ${spec.title} / ${code}`, async () => {
      const claim = await api("POST", "/api/v1/contribution-claims", {
        workPackageId: wpId,
        claimantPersonId: personId(code),
        claimType: "DELIVERABLE_CONTRIBUTION",
        claimedContribution: { dimensions: ["QUALITY", "SPEED"], summary: output },
        evidenceRefs: [],
        rationale: `${output}（${spec.title}）`,
      });
      await api("POST", `/api/v1/contribution-claims/${claim.id}/submit`);
      await api("POST", "/api/v1/attribution-decisions", {
        claimId: claim.id,
        adjudicatorPersonId: personId("A-001"),
        status: "CONFIRMED",
        acceptedFacts: ["交付物已验收", "证据完整"],
        rejectedFacts: [],
        contributionDimensions: { QUALITY: 1, SPEED: 0.8 },
        rationale: "证据与验收记录一致",
      });
    });
  }
}

// ---------------------------------------------------------------- evaluations
const EVAL = [
  ["A-002", 4.5, "拿下哈萨克斯坦 40 台订单并完成回款，超出季度目标"],
  ["A-004", 4.0, "保加利亚 OEM 首单落地，样机认证按期通过"],
  ["A-008", 3.5, "签约 2 家代理商，第 3 家在谈"],
  ["A-006", 4.0, "现场调试零返工，客户验收一次通过"],
  ["A-003", 3.5, "产品规格与认证支撑及时，但文档迭代偏慢"],
  ["A-009", 3.5, "供应链按期到货，物流成本下降 6%"],
  ["A-007", 4.0, "客户满意度 4.6/5，售后响应快"],
  ["A-005", 3.0, "渠道政策设计完成，落地执行待跟进"],
];
for (const [code, score, rationale] of EVAL) {
  await step(`eval ${code}`, async () => {
    const draft = await api("POST", "/api/v1/evaluation-drafts", {
      cycleId: CYCLE,
      personId: personId(code),
      generatedByType: "SYSTEM",
      evidenceSnapshotHash: `sha256:demo-${code}-202610`,
      draftPayload: {
        scores: { QUALITY: score },
        summary: rationale,
        metrics: { SALES_REVENUE: 1, DELIVERY_ONTIME: 0.96 },
      },
      strengths: ["交付结果可验证", "跨部门协作顺畅"],
      counterEvidence: [],
      missingInformation: [],
      uncertainty: { level: "LOW" },
    });
    await api("POST", `/api/v1/evaluation-drafts/${draft.id}/submit`);
    await api("POST", `/api/v1/evaluation-drafts/${draft.id}/decision`, {
      reviewerPersonId: personId("A-001"),
      rubricVersionId: RUBRIC,
      decision: "APPROVE",
      scores: { QUALITY: score },
      rationale,
      independentScores: { QUALITY: score },
      independentRationale: `依据 ${rationale}`,
      evidenceOpened: 2,
    });
  });
}

// ---------------------------------------------------------------- budget pool
const pools = (await api("GET", "/api/v1/budget-pools")) ?? [];
if (pools.length === 0) {
  const pool = await step("budget pool", () =>
    api("POST", "/api/v1/budget-pools", {
      cycleId: CYCLE,
      code: "SALES_POOL_2026Q4",
      name: "2026 Q4 销售激励池",
      poolType: "BUSINESS_UNIT_COMMISSION",
      currency: "CNY",
      approvedAmount: "300000",
    }),
  );
  if (pool?.id) await step("pool approve", () => api("POST", `/api/v1/budget-pools/${pool.id}/approve`, {}));
  // allocate to the sales unit
  if (pool?.id) {
    await step("pool allocation", () =>
      api("POST", `/api/v1/budget-pools/${pool.id}/allocations`, {
        orgNodeId: nodes.find?.((n) => n.name === "销售中心")?.id,
        amount: "220000",
        currency: "CNY",
      }),
    );
  }
} else {
  console.log(`  skip budget pool (${pools.length} existing)`);
}

// ---------------------------------------------------------------- calculation run
const run = await step("calculation run", () =>
  api("POST", "/api/v1/calculation-runs", {
    cycleId: CYCLE,
    policyVersionId: POLICY_VERSION_ID,
    mode: "FORMAL",
    order: { id: `DEMO-Q4-${Date.now()}`, grossProfit: "620000", currency: "CNY" },
    participants: [
      { personId: personId("A-002"), workPackageId: wpIds[WP[0].title], attributionWeight: "0.40", role: "OWNER" },
      { personId: personId("A-006"), workPackageId: wpIds[WP[0].title], attributionWeight: "0.20", role: "CONTRIBUTOR" },
      { personId: personId("A-009"), workPackageId: wpIds[WP[0].title], attributionWeight: "0.10", role: "CONTRIBUTOR" },
      { personId: personId("A-004"), workPackageId: wpIds[WP[1].title], attributionWeight: "0.15", role: "OWNER" },
      { personId: personId("A-003"), workPackageId: wpIds[WP[1].title], attributionWeight: "0.05", role: "CONTRIBUTOR" },
      { personId: personId("A-008"), workPackageId: wpIds[WP[2].title], attributionWeight: "0.10", role: "OWNER" },
    ],
  }),
);
if (run?.id) {
  for (const code of ["A-002", "A-006", "A-009", "A-004", "A-003", "A-008"]) {
    await step(`confirmation ${code}`, () =>
      api("POST", "/api/v1/employee-confirmations", {
        personId: personId(code),
        targetType: "CALCULATION",
        targetId: run.id,
        decision: "CONFIRMED",
      }),
    );
  }
  await step("run approve", () => api("POST", `/api/v1/calculation-runs/${run.id}/approve`, {}));
  await step("run lock", () => api("POST", `/api/v1/calculation-runs/${run.id}/lock`, { confirmation: "LOCK_CALCULATION" }));
}

// ---------------------------------------------------------------- settlement
const batches = (await api("GET", "/api/v1/settlement-batches")) ?? [];
let batch = batches.find((b) => b.cycleId === CYCLE) ?? batches[0];
if (!batch) {
  batch = await step("settlement batch", () => api("POST", "/api/v1/settlement-batches", { cycleId: CYCLE }));
}
if (batch?.id) {
  for (const [command, extra] of [
    ["RECONCILE", {}],
    ["SUBMIT", {}],
    ["APPROVE", { actorPersonId: personId("A-001") }],
    ["LOCK", {}],
    ["EXPORT", {}],
    ["ACKNOWLEDGE", { externalReference: "FIN-2026-10-BATCH-01" }],
  ]) {
    await step(`settlement ${command}`, () =>
      api("POST", `/api/v1/settlement-batches/${batch.id}/commands`, { command, ...extra }),
    );
  }
}

// ---------------------------------------------------------------- incentive awards
const awards = (await api("GET", "/api/v1/incentive-award-batches")) ?? [];
if (!awards.some((a) => a.batchNo === "IA-2026-10-001")) {
  const award = await step("incentive batch", () =>
    api("POST", "/api/v1/incentive-award-batches", {
      batchNo: "IA-2026-10-001",
      awardType: "BUSINESS_UNIT_COMMISSION",
      period: "2026-10",
      cycleId: CYCLE,
      currency: "CNY",
      createdBy: personId("A-010"),
      lines: [
        { personId: personId("A-002"), amount: "48000", note: "Q4 订单提成" },
        { personId: personId("A-004"), amount: "26000", note: "OEM 首单提成" },
        { personId: personId("A-008"), amount: "15000", note: "渠道招商提成" },
        { personId: personId("A-006"), amount: "9000", note: "交付专项奖" },
        { personId: personId("A-007"), amount: "6000", note: "客户成功奖" },
        { personId: personId("A-009"), amount: "5000", note: "供应链降本奖" },
      ],
    }),
  );
  if (award?.id) {
    for (const command of ["SUBMIT", "APPROVE", "LOCK", "EXPORT"]) {
      await step(`award ${command}`, () =>
        api("POST", `/api/v1/incentive-award-batches/${award.id}/commands`, {
          command, actorPersonId: personId("A-010"),
        }),
      );
    }
  }
} else {
  console.log("  skip incentive batch (exists)");
}

// ---------------------------------------------------------------- bounties
const bounties = (await api("GET", "/api/v1/bounties")) ?? [];
const BOUNTIES = [
  ["东南亚市场渠道调研", "完成泰国、越南两国充电运营商 Top10 调研，输出可触达名单与采购预算", "8000"],
  ["Pales 系列竞品拆解", "拆解 3 家竞品的 BOM 与成本结构，给出降本建议", "5000"],
];
for (const [title, description, rewardAmount] of BOUNTIES) {
  if (bounties.some((b) => b.title === title)) continue;
  await step(`bounty ${title}`, () =>
    api("POST", "/api/v1/bounties", {
      title, description, rewardAmount, currency: "CNY",
      createdBy: personId("A-001"),
      dueAt: "2026-11-30T10:00:00.000Z",
    }),
  );
}

// ---------------------------------------------------------------- payroll
const contracts = (await api("GET", "/api/v1/employment-contracts")) ?? [];
const contracted = new Set(contracts.map((c) => c.personId));
for (const [code, , title] of PEOPLE) {
  if (contracted.has(personId(code))) continue;
  await step(`contract ${code}`, () =>
    api("POST", "/api/v1/employment-contracts", {
      personId: personId(code),
      contractCode: `CT-2026-${code}`,
      employmentType: "FULL_TIME",
      startDate: "2026-01-01T00:00:00.000Z",
      workLocation: "深圳",
      legalEntity: "Anari Energy",
      currency: "CNY",
      fixedMonthlySalary: String(18000 + Number(code.slice(-1)) * 2000),
      minimumMonthlyWage: "5000",
      taxRate: "0.1",
      socialInsuranceRate: "0.105",
    }),
  );
}
const runs = (await api("GET", "/api/v1/payroll-runs")) ?? [];
if (!runs.some((r) => r.periodStart?.startsWith("2026-10"))) {
  const pr = await step("payroll run", () =>
    api("POST", "/api/v1/payroll-runs", {
      cycleId: CYCLE,
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-10-31T23:59:59.000Z",
      currency: "CNY",
      preparedBy: personId("A-010"),
    }),
  );
  if (pr?.id) {
    for (const [label, call] of [
      ["calculate", () => api("POST", `/api/v1/payroll-runs/${pr.id}/calculate`, {})],
      ["approve", () => api("POST", `/api/v1/payroll-runs/${pr.id}/approve`, { approverPersonId: personId("A-001") })],
    ]) {
      await step(`payroll ${label}`, call);
    }
  }
} else {
  console.log("  skip payroll run (2026-10 exists)");
}

console.log(`\nDONE ok=${ok.length} failed=${bad.length}`);
if (bad.length) console.log("FAILURES:\n" + bad.map((b) => " - " + b).join("\n"));
