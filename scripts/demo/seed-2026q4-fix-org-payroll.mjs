const BASE = process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
const TENANT = process.env.TENANT_ID ?? "00000000-0000-4000-8000-000000000001";
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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(payload.error ?? payload).slice(0, 240)}`);
  return payload.data;
}
const okc = []; const bad = [];
async function step(name, fn) {
  try { const r = await fn(); okc.push(name); console.log("  ok   " + name); return r; }
  catch (e) { bad.push(`${name}: ${e.message}`); console.log("  FAIL " + name + ": " + e.message); }
}

TOKEN = (await api("POST", "/api/v1/auth/password/login", {
  email: process.env.LOGIN_EMAIL ?? "admin@anari.com",
  password: process.env.LOGIN_PASSWORD ?? "Anari@2026",
})).token;

const persons = (await api("GET", `/api/v1/platform/tenants/${TENANT}/persons`)) ?? [];
const byCode = new Map(persons.map((p) => [p.employeeCode, p.id]));
const all = persons.map((p) => p.id);
const id = (code) => byCode.get(code) ?? all[0];

// ---- org nodes
let nodes = (await api("GET", `/api/v1/platform/tenants/${TENANT}/org-nodes`)) ?? [];
if (nodes.length === 0) {
  const root = await step("org root", () =>
    api("POST", `/api/v1/platform/tenants/${TENANT}/org-nodes`, { name: "总经办", nodeType: "COMPANY" }));
  for (const name of ["销售中心", "产品中心", "交付与运营", "财务部"]) {
    await step(`org ${name}`, () =>
      api("POST", `/api/v1/platform/tenants/${TENANT}/org-nodes`, {
        name, nodeType: "DEPARTMENT", ...(root?.id ? { parentId: root.id } : {}),
      }));
  }
  nodes = (await api("GET", `/api/v1/platform/tenants/${TENANT}/org-nodes`)) ?? [];
}
const salesNode = nodes.find((n) => n.name === "销售中心");

// ---- org assignments
for (const [code, node] of [["A-002", "销售中心"], ["A-004", "销售中心"], ["A-008", "销售中心"],
  ["A-003", "产品中心"], ["A-006", "交付与运营"], ["A-009", "交付与运营"], ["A-010", "财务部"]]) {
  const target = nodes.find((n) => n.name === node);
  if (!target) continue;
  await step(`assign ${code} -> ${node}`, () =>
    api("POST", `/api/v1/platform/tenants/${TENANT}/persons/${id(code)}/org-assignments`, {
      orgNodeId: target.id, isPrimary: true, title: null,
    }));
}

// ---- budget pool approve + allocation
const pools = (await api("GET", "/api/v1/budget-pools")) ?? [];
for (const pool of pools.filter((p) => p.status !== "APPROVED")) {
  await step(`pool approve ${pool.code}`, () => api("POST", `/api/v1/budget-pools/${pool.id}/approve`, { approvedBy: id("A-001") }));
}
const approvedPools = (await api("GET", "/api/v1/budget-pools")) ?? [];
for (const pool of approvedPools) {
  const allocations = await api("GET", `/api/v1/budget-pools/${pool.id}/allocations`).catch(() => []);
  if ((allocations ?? []).length > 0) continue;
  if (!salesNode) continue;
  await step(`allocation ${pool.code}`, () =>
    api("POST", `/api/v1/budget-pools/${pool.id}/allocations`, {
      targetType: "ORG_NODE", targetId: salesNode.id, amount: "220000",
    }));
}

// ---- employment contracts
const contracts = (await api("GET", "/api/v1/employment-contracts")) ?? [];
const contracted = new Set(contracts.map((c) => c.personId));
const CODES = ["A-001","A-002","A-003","A-004","A-005","A-006","A-007","A-008","A-009","A-010"];
for (const code of CODES) {
  if (contracted.has(id(code))) continue;
  await step(`contract ${code}`, () =>
    api("POST", "/api/v1/employment-contracts", {
      personId: id(code),
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
      consentSignatureRef: `ESIGN-2026-${code}`,
    }));
}

// ---- payroll finish
const runs = (await api("GET", "/api/v1/payroll-runs")) ?? [];
for (const run of runs) {
  if (!run.periodStart?.startsWith("2026-10")) continue;
  if (run.status === "DRAFT") {
    await step("payroll recalculate", () => api("POST", `/api/v1/payroll-runs/${run.id}/calculate`, {}));
  }
  const fresh = (await api("GET", `/api/v1/payroll-runs/${run.id}`));
  const status = fresh?.status ?? run.status;
  console.log(`  payroll ${run.id} status=${status} lines=${(fresh?.lines ?? []).length}`);
  if (status !== "APPROVED" && status !== "PAID" && status !== "PAYING") {
    await step("payroll approve", () => api("POST", `/api/v1/payroll-runs/${run.id}/approve`, { approvedBy: id("A-001") }));
  }
  const after = await api("GET", `/api/v1/payroll-runs/${run.id}`);
  if (after?.status === "APPROVED") {
    await step("payroll pay", () => api("POST", `/api/v1/payroll-runs/${run.id}/pay`, { paidBy: id("A-010") }));
  }
  console.log(`  payroll final status=${(await api("GET", `/api/v1/payroll-runs/${run.id}`))?.status}`);
}

console.log(`\nDONE ok=${okc.length} failed=${bad.length}`);
if (bad.length) console.log(bad.map((b) => " - " + b).join("\n"));
