const BASE = process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
const TENANT = process.env.TENANT_ID ?? "00000000-0000-4000-8000-000000000001";
let TOKEN = "";
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "x-session-token": TOKEN, "x-tenant-id": TENANT,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(payload.error ?? payload).slice(0, 200)}`);
  return payload.data;
}
const okc = [], bad = [];
async function step(n, f) { try { const r = await f(); okc.push(n); console.log("  ok   " + n); return r; } catch (e) { bad.push(n + ": " + e.message); console.log("  FAIL " + n + ": " + e.message); } }

TOKEN = (await api("POST", "/api/v1/auth/password/login", { email: "admin@anari.com", password: "Anari@2026" })).token;
const persons = (await api("GET", `/api/v1/platform/tenants/${TENANT}/persons`)) ?? [];
const id = (code) => persons.find((p) => p.employeeCode === code)?.id;
const nodes = (await api("GET", `/api/v1/platform/tenants/${TENANT}/org-nodes`)) ?? [];

for (const [code, node] of [["A-002","销售中心"],["A-004","销售中心"],["A-008","销售中心"],["A-003","产品中心"],["A-006","交付与运营"],["A-009","交付与运营"],["A-010","财务部"]]) {
  const target = nodes.find((n) => n.name === node);
  if (!target) continue;
  await step(`assign ${code}`, () =>
    api("POST", `/api/v1/platform/tenants/${TENANT}/persons/${id(code)}/org-assignments`, {
      orgNodeId: target.id, validFrom: "2026-10-01", isPrimary: true,
    }));
}

const cycles = await api("GET", "/api/v1/evaluation-cycles");
const cycle = cycles.find((c) => c.name.includes("2026 Q4")) ?? cycles[0];
const runs = (await api("GET", "/api/v1/payroll-runs")) ?? [];
const oct = runs.filter((r) => r.periodStart?.startsWith("2026-10"));

// if the only October run has no lines, reverse it and build a fresh one
for (const run of oct) {
  const full = await api("GET", `/api/v1/payroll-runs/${run.id}`);
  if ((full.lines ?? []).length === 0 && full.status === "PAID") {
    await step(`reverse empty run ${run.id}`, () => api("POST", `/api/v1/payroll-runs/${run.id}/reverse`, { reversedBy: id("A-010"), reason: "重建演示数据" }));
  }
}
const fresh = await step("new 2026-10 payroll run", () =>
  api("POST", "/api/v1/payroll-runs", {
    cycleId: cycle.id, periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-10-31T23:59:59.000Z",
    currency: "CNY", preparedBy: id("A-010"),
  }));
if (fresh?.id) {
  await step("calculate", () => api("POST", `/api/v1/payroll-runs/${fresh.id}/calculate`, {}));
  const after = await api("GET", `/api/v1/payroll-runs/${fresh.id}`);
  console.log(`  lines=${(after.lines ?? []).length} total=${after.totalAmount ?? after.total ?? "?"} status=${after.status}`);
  await step("approve", () => api("POST", `/api/v1/payroll-runs/${fresh.id}/approve`, { approvedBy: id("A-001") }));
  await step("pay", () => api("POST", `/api/v1/payroll-runs/${fresh.id}/pay`, { paidBy: id("A-010") }));
  const fin = await api("GET", `/api/v1/payroll-runs/${fresh.id}`);
  console.log(`  final status=${fin.status} lines=${(fin.lines ?? []).length}`);
}

console.log(`\nDONE ok=${okc.length} failed=${bad.length}`);
if (bad.length) console.log(bad.join("\n"));
