/**
 * NPV2-009 / AUD-022：试点影子周期工具链（业务数据到位后即可机械验收）。
 *
 * 用法（需 DATABASE_URL，PG 模式）：
 *   npx tsx scripts/pilot-shadow-cycle.ts import --orders <csv> [--tenant <uuid>]
 *   npx tsx scripts/pilot-shadow-cycle.ts report --cycle <cycleId> [--json]
 *
 * import：把匿名订单 CSV 导入为试点工作包（成员/角色），供人工在 UI 中
 *         走「申报 → 补证 → 归属 → 评价 → 影子计算 → 员工确认」。
 *         CSV 列：order_id,title,objective,owner_employee_code,
 *                 participants,gross_profit,currency,period_start,period_end
 *         participants 格式：E001:OWNER|E002:CONTRIBUTOR
 *         幂等：同订单号（标题「试点订单 <order_id>」）已存在则跳过。
 *
 * report：从持久化事实机械核算五项审计验收，输出 PASS/FAIL/N-A；
 *         任一 FAIL → exit 1。
 */
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { parseCsv } from "@anari/connectors";
import { PgStore } from "../apps/api/src/pg-store.js";
import { PgPlatformStore } from "../apps/api/src/platform-store.js";
import { createPlatformPool } from "../apps/api/src/platform-pool.js";
import { computePilotMetrics, type PilotMetricInputs } from "./pilot-metrics.js";

const args = process.argv.slice(2);
const command = args[0];
function arg(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}
const json = args.includes("--json");
const tenantId =
  arg("tenant") ?? process.env.TENANT_ID ?? "00000000-0000-4000-8000-000000000001";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required (pilot tooling runs against PostgreSQL).");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const platformPool = createPlatformPool(databaseUrl);
const store = new PgStore(pool, tenantId);
const platformStore = new PgPlatformStore(platformPool);

function columnIndex(header: string[], name: string): number {
  const index = header.findIndex(
    (column) => column.trim().toLowerCase() === name,
  );
  if (index < 0) {
    throw new Error(`orders CSV missing column "${name}"; got ${header.join(",")}`);
  }
  return index;
}

async function runImport(): Promise<void> {
  const ordersPath = arg("orders");
  if (!ordersPath) {
    console.error("import requires --orders <csv>");
    process.exitCode = 1;
    return;
  }
  const rows = parseCsv(readFileSync(ordersPath, "utf8").trim());
  const header = rows[0] ?? [];
  const idx = {
    orderId: columnIndex(header, "order_id"),
    title: columnIndex(header, "title"),
    objective: columnIndex(header, "objective"),
    owner: columnIndex(header, "owner_employee_code"),
    participants: columnIndex(header, "participants"),
    grossProfit: columnIndex(header, "gross_profit"),
    currency: columnIndex(header, "currency"),
  };

  const persons = await platformStore.listPersons(tenantId);
  const personByCode = new Map(persons.map((person) => [person.employeeCode, person.id]));
  const existing = new Set(
    (await store.listWorkPackages()).map((wp) => wp.title),
  );

  let created = 0;
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const orderId = (row[idx.orderId] ?? "").trim();
    if (!orderId) continue;
    const title = `试点订单 ${orderId}`;
    if (existing.has(title)) {
      skipped += 1;
      continue;
    }
    const participants = (row[idx.participants] ?? "")
      .split("|")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [code, role] = entry.split(":");
        const personId = personByCode.get((code ?? "").trim());
        if (!personId) {
          throw new Error(
            `unknown employee code "${code}" for order ${orderId}; sync the directory first`,
          );
        }
        return {
          personId,
          responsibilityCode: (role ?? "CONTRIBUTOR").trim().toUpperCase(),
          expectedOutput: "交付验收单",
        };
      });
    const ownerCode = (row[idx.owner] ?? "").trim();
    const ownerPersonId = personByCode.get(ownerCode);
    if (!ownerPersonId) {
      throw new Error(
        `unknown owner employee code "${ownerCode}" for order ${orderId}`,
      );
    }
    if (!participants.some((member) => member.personId === ownerPersonId)) {
      participants.unshift({
        personId: ownerPersonId,
        responsibilityCode: "OWNER",
        expectedOutput: "交付验收单",
      });
    }
    const grossProfit = (row[idx.grossProfit] ?? "").trim();
    const currency = (row[idx.currency] ?? "CNY").trim().toUpperCase();
    await store.createWorkPackage({
      title,
      objective:
        `${(row[idx.objective] ?? "试点订单交付").trim()} ` +
        `（订单毛利 ${grossProfit} ${currency}；试点导入，勿改标题）`,
      ownerPersonId,
      members: participants,
      acceptanceCriteria: ["客户验收单", "交付事实可核对"],
    });
    created += 1;
  }
  console.log(
    `pilot import done: created=${created} skipped=${skipped} (tenant ${tenantId})`,
  );
}

async function runReport(): Promise<void> {
  const cycleId = arg("cycle");
  if (!cycleId) {
    console.error("report requires --cycle <cycleId>");
    process.exitCode = 1;
    return;
  }
  const cycle = await store.getEvaluationCycle(cycleId);

  const runs = (await store.listRuns()).filter(
    (run) => run.cycleId === cycleId && run.status !== "REVERSED",
  );
  const benchmarkRun = [...runs]
    .filter(
      (run) =>
        run.mode === "FORMAL" &&
        (run.status === "APPROVED" || run.status === "LOCKED"),
    )
    .sort((a, b) =>
      (b.lockedAt ?? b.calculatedAt ?? b.createdAt).localeCompare(
        a.lockedAt ?? a.calculatedAt ?? a.createdAt,
      ),
    )[0];

  const inputs: PilotMetricInputs = {
    cycle: { id: cycle.id, startsAt: cycle.startsAt, endsAt: cycle.endsAt },
    facts: (await platformStore.listFinancialFacts(tenantId)).map((fact) => ({
      id: fact.id,
      amount: fact.amount,
      qualityStatus: fact.qualityStatus,
      payload: fact.payload,
      periodStart: fact.periodStart,
      periodEnd: fact.periodEnd,
    })),
    benchmarkRun: benchmarkRun
      ? {
          id: benchmarkRun.id,
          mode: benchmarkRun.mode,
          status: benchmarkRun.status,
          orderGrossProfit: benchmarkRun.inputSnapshot?.order?.grossProfit,
        }
      : undefined,
    claims: (await store.listClaims()).map((claim) => ({
      id: claim.id,
      workPackageId: claim.workPackageId,
      claimantPersonId: claim.claimantPersonId,
      status: claim.status,
      createdAt: claim.createdAt,
      submittedAt: claim.submittedAt,
      evidenceRefs: claim.evidenceRefs,
    })),
    workPackages: (await store.listWorkPackages()).map((wp) => ({
      id: wp.id,
      members: wp.members.map((member) => ({
        personId: member.personId,
        responsibilityCode: member.responsibilityCode,
      })),
    })),
    evidence: (await store.listEvidence()).map((node) => ({
      id: node.id,
      subjectType: node.subjectType,
      subjectId: node.subjectId,
      createdAt: node.createdAt,
    })),
    drafts: (await store.listEvaluationDrafts({ cycleId })).map((draft) => ({
      id: draft.id,
      personId: draft.personId,
      cycleId: draft.cycleId,
      createdAt: draft.createdAt,
    })),
    decisions: (await store.listEvaluationDecisions({ cycleId })).map(
      (decision) => ({
        id: decision.id,
        personId: decision.personId,
        cycleId: decision.cycleId,
        createdAt: decision.createdAt,
      }),
    ),
  };

  const report = computePilotMetrics(inputs);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const line = (
      index: number,
      label: string,
      verdict: string,
      detail: string,
    ) =>
      `${index}. ${label.padEnd(14, "　")} ${verdict.padEnd(4)}  ${detail}`;
    const pct = (value: number | null) =>
      value === null ? "N/A" : `${Math.round(value * 10_000) / 100}%`;
    console.log(`=== 试点影子周期验收（cycle ${cycleId}）===`);
    console.log(
      line(
        1,
        "财务差异",
        report.financial.verdict,
        `delta=${report.financial.deltaMicros} 微单位（${report.financial.detail}）`,
      ),
    );
    const roleDetail = Object.entries(report.evidenceCoverage.byRole)
      .map(([role, stats]) => `${role} ${stats.covered}/${stats.total}`)
      .join("；");
    console.log(
      line(
        2,
        "证据覆盖",
        report.evidenceCoverage.verdict,
        `${pct(report.evidenceCoverage.overall.rate)}（${roleDetail || "无申报"}）`,
      ),
    );
    console.log(
      line(
        3,
        "员工补证",
        report.supplement.verdict,
        report.supplement.medianMinutes === null
          ? "无样本"
          : `中位 ${report.supplement.medianMinutes} 分钟（样本 ${report.supplement.samples}，阈值 ≤30）`,
      ),
    );
    console.log(
      line(
        4,
        "经理复核",
        report.review.verdict,
        report.review.medianMinutes === null
          ? "无样本"
          : `中位 ${report.review.medianMinutes} 分钟（样本 ${report.review.samples}，阈值 ≤120）`,
      ),
    );
    console.log(
      line(
        5,
        "争议率",
        report.dispute.verdict,
        `${report.dispute.disputed}/${report.dispute.total}（${pct(report.dispute.rate)}，阈值 <10%）`,
      ),
    );
    console.log(`结论：${report.pass ? "PASS" : "FAIL"}`);
  }
  if (!report.pass) process.exitCode = 1;
}

try {
  if (command === "import") await runImport();
  else if (command === "report") await runReport();
  else {
    console.error("usage: pilot-shadow-cycle.ts <import|report> [options]");
    process.exitCode = 1;
  }
} finally {
  await pool.end();
  await platformPool.end();
}
