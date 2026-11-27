/**
 * 匿名影子 E2E on real PostgreSQL (2026-11-27).
 *
 * Runs the same 14-step chain as `scripts/shadow-e2e.ts` but against
 * `PgStore` + `PgPlatformStore` + `buildApp` (no HTTP mocks), then verifies
 * the PostgreSQL-only guarantees the in-memory stores cannot prove:
 *
 * - database unique constraints (people / policy version);
 * - transaction rollback (a multi-payment request whose second receipt is
 *   invalid must persist neither payment nor a GL journal);
 * - FORCE RLS cross-tenant isolation (no context → 0 rows, foreign context →
 *   0 rows, cross-tenant INSERT → 42501);
 * - GL balance and amount conservation read directly from the tables;
 * - ACK is terminal: a post-ACK payment returns 409 and writes nothing.
 *
 * `DATABASE_URL` gating mirrors `pg-store.test.ts` (`describePg`): with no
 * database the whole suite is skipped and Docker is never started. Every run
 * creates a fresh random tenant (`bootstrapShadowPgTenant`) and fresh person /
 * rubric / policy ids, so the demo seed is never touched and repeated runs do
 * not collide.
 *
 * Run:
 *   DATABASE_URL=postgres://anari_app:anari_app@localhost:PORT/anari_incentive \
 *     npx vitest run apps/api/src/__tests__/shadow-e2e-pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type QueryResultRow } from "pg";
import { DevHeaderAuthenticator } from "@anari/auth";
import { buildApp } from "../app.js";
import { PgPlatformStore } from "../platform-store.js";
import { PgStore } from "../pg-store.js";
import {
  bootstrapShadowPgTenant,
  runShadowE2E,
  type ShadowE2EResult,
  type ShadowPgTenantBootstrap,
} from "../../../../scripts/shadow-e2e.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const databaseUrl = process.env.DATABASE_URL;
const describePg = databaseUrl ? describe : describe.skip;

/** Seed tenant from db/seed/001_demo.sql; must never be touched by this suite. */
const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";

const EXPECTED_STEP_IDS = [
  "01.fixtures",
  "02.setup",
  "03.contracts",
  "04.commercial-order",
  "05.work-items",
  "06.attribution",
  "07.policy",
  "08.performance",
  "09.jev",
  "10.calculation",
  "11.award-batches",
  "12.payments-gl",
  "13.ack",
  "14.invariants",
];

/**
 * RLS negative checks must run as a NOBYPASSRLS role. `test-pg.sh` already
 * points DATABASE_URL at `anari_app`; ad-hoc runs against the owner URL are
 * rewritten to the same application role used by the rest of the PG suite.
 */
function appRoleUrl(url: string): string {
  if (url.includes("anari_app")) return url;
  return url.replace("//anari:anari@", "//anari_app:anari_app@");
}

describePg("anonymized shadow E2E on real PostgreSQL", () => {
  let pool: Pool;
  let rlsPool: Pool;
  let tenant: ShadowPgTenantBootstrap;
  let result: ShadowE2EResult;
  let demoAwardBatchesBefore: number;
  let demoPeopleBefore: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    rlsPool = new Pool({ connectionString: appRoleUrl(databaseUrl!) });
    demoAwardBatchesBefore = await countForTenant(
      DEMO_TENANT_ID,
      "incentive_award_batches",
    );
    demoPeopleBefore = await countForTenant(DEMO_TENANT_ID, "people");
    tenant = await bootstrapShadowPgTenant(pool);
    result = await runShadowE2E({
      pg: {
        pool,
        tenantId: tenant.tenantId,
        personIdMap: tenant.personIdMap,
        rubricVersionId: tenant.rubricVersionId,
        policyVersionId: tenant.policyVersionId,
      },
    });
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await rlsPool?.end();
  });

  /** Read one tenant's rows through a transaction-local RLS context. */
  async function rowsForTenant<T extends QueryResultRow = QueryResultRow>(
    tenantId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        tenantId,
      ]);
      const { rows } = await client.query<T>(sql, params);
      await client.query("COMMIT");
      return rows;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  function countForTenant(tenantId: string, table: string): Promise<number> {
    return rowsForTenant<{ n: number }>(
      tenantId,
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [tenantId],
    ).then((rows) => rows[0]?.n ?? 0);
  }

  function stepEvidence(id: string): Record<string, any> {
    const step = result.steps.find((entry) => entry.id === id);
    expect(step, `missing step ${id}`).toBeTruthy();
    expect(step!.status, `step ${id}: ${step!.error ?? ""}`).toBe("PASS");
    return step!.evidence as Record<string, any>;
  }

  function person(code: string): string {
    const personId = tenant.personIds[code];
    if (!personId) throw new Error(`missing person ${code}`);
    return personId;
  }

  it("runs all 14 steps on PgStore + PgPlatformStore with no failing check", () => {
    expect(result.verdict).toBe("PASS");
    expect(result.tenantId).toBe(tenant.tenantId);
    expect(tenant.slug).toMatch(/^shadow-e2e-[0-9a-f]{8}$/);

    expect(result.steps.map((step) => step.id)).toEqual(EXPECTED_STEP_IDS);
    for (const step of result.steps) {
      expect(
        step.status,
        `step ${step.id} failed: ${step.error ?? ""}`,
      ).toBe("PASS");
    }
    for (const check of result.checks) {
      expect(
        check.ok,
        `${check.id} expected=${JSON.stringify(check.expected)} ` +
          `actual=${JSON.stringify(check.actual)}` +
          (check.source ? ` source=${check.source}` : ""),
      ).toBe(true);
    }
    expect(result.checks.length).toBeGreaterThanOrEqual(350);
    expect(new Set(result.checks.map((check) => check.id)).size).toBe(
      result.checks.length,
    );

    const setup = stepEvidence("02.setup");
    expect(setup.backend).toBe("postgres");
    expect(setup.platformStore).toBe("PgPlatformStore");
    expect(setup.store).toContain("PgStore");
    expect([...(setup.personIds as string[])].sort()).toEqual(
      Object.values(tenant.personIds).sort(),
    );

    // Contract / calculation / award evidence is the same as the memory run.
    expect(stepEvidence("03.contracts").created).toBe(3);
    expect(stepEvidence("04.commercial-order").replayCreated).toBe(false);
    expect(stepEvidence("05.work-items").imported).toBe(2);
    expect(stepEvidence("10.calculation").lineSum).toBe("5000");
    expect(stepEvidence("10.calculation").ledgerChainValid).toBe(true);
    expect(stepEvidence("13.ack").rePay.status).toBe(409);
    expect(stepEvidence("13.ack").replayPaid.status).toBe(409);
    expect(stepEvidence("13.ack").reAck.status).toBe(409);
    expect(stepEvidence("14.invariants").glBalanced).toBe(true);
  });

  it("does not touch the demo seed tenant", async () => {
    expect(await countForTenant(DEMO_TENANT_ID, "incentive_award_batches")).toBe(
      demoAwardBatchesBefore,
    );
    expect(await countForTenant(DEMO_TENANT_ID, "people")).toBe(
      demoPeopleBefore,
    );
    const shadowPolicies = await rowsForTenant<{ n: number }>(
      DEMO_TENANT_ID,
      `SELECT count(*)::int AS n FROM policy_versions
        WHERE tenant_id = $1 AND policy_code = 'ANON-SHADOW-INCENTIVE-2026'`,
      [DEMO_TENANT_ID],
    );
    expect(shadowPolicies[0]?.n).toBe(0);
  });

  it("persists the 14-step amount chain with conserved totals and a balanced GL", async () => {
    const invariants = stepEvidence("14.invariants");
    expect(invariants.amountConservation).toEqual({
      calculationUsd: "5000",
      ledgerUsd: "5000",
      cnyPaid: "28400",
      usdPaid: "1000",
      usdEquivalent: "5000",
    });

    // PG's Commercial order mapper does not echo sourceSystem/externalOrderId
    // (see docs/audit/2026-11-27-shadow-e2e-pg.md); verify them in the table.
    const orders = await rowsForTenant<{
      order_number: string;
      source_system: string | null;
      external_order_id: string | null;
    }>(
      tenant.tenantId,
      `SELECT order_number, source_system, external_order_id
         FROM commercial_orders
        WHERE tenant_id = $1
        ORDER BY order_number`,
      [tenant.tenantId],
    );
    expect(orders).toEqual([
      {
        order_number: "AN-O-2026-0101",
        source_system: "ANON_CRM",
        external_order_id: "AN-O-2026-0101",
      },
    ]);

    const ledger = await rowsForTenant<{
      n: number;
      keys: number;
      total: string;
    }>(
      tenant.tenantId,
      `SELECT count(*)::int AS n,
              count(DISTINCT idempotency_key)::int AS keys,
              sum(amount)::text AS total
         FROM amount_ledger
        WHERE tenant_id = $1`,
      [tenant.tenantId],
    );
    expect(ledger[0]).toEqual({ n: 3, keys: 3, total: "5000.000000" });

    const batches = await rowsForTenant<{
      batch_no: string;
      currency: string;
      total_amount: string;
      line_count: number;
      status: string;
    }>(
      tenant.tenantId,
      `SELECT batch_no, currency, total_amount::text AS total_amount,
              line_count, status
         FROM incentive_award_batches
        WHERE tenant_id = $1
        ORDER BY currency`,
      [tenant.tenantId],
    );
    expect(batches).toEqual([
      {
        batch_no: "ANON-SHADOW-2026-11-CNY",
        currency: "CNY",
        total_amount: "28400.000000",
        line_count: 2,
        status: "ACKNOWLEDGED",
      },
      {
        batch_no: "ANON-SHADOW-2026-11-USD",
        currency: "USD",
        total_amount: "1000.000000",
        line_count: 1,
        status: "ACKNOWLEDGED",
      },
    ]);

    // Regression: header reads and RLS-protected line reads must share the
    // same tenant-scoped transaction; otherwise list/get return empty lines.
    const platformStore = new PgPlatformStore(pool);
    const loadedBatches = await platformStore.listIncentiveAwardBatches(
      tenant.tenantId,
    );
    expect(
      loadedBatches.map((batch) => ({
        currency: batch.currency,
        lineCount: batch.lines.length,
        amount: batch.lines.reduce(
          (sum, line) => sum + Number(line.amount),
          0,
        ),
      })).sort((left, right) => left.currency.localeCompare(right.currency)),
    ).toEqual([
      { currency: "CNY", lineCount: 2, amount: 28400 },
      { currency: "USD", lineCount: 1, amount: 1000 },
    ]);
    const loadedCny = loadedBatches.find((batch) => batch.currency === "CNY");
    expect(loadedCny).toBeDefined();
    const loadedCnyById = await platformStore.getIncentiveAwardBatch(
      tenant.tenantId,
      loadedCny!.id,
    );
    expect(loadedCnyById.lines).toHaveLength(2);
    expect(loadedCnyById.lines.reduce(
      (sum, line) => sum + Number(line.amount),
      0,
    )).toBe(28400);

    const lines = await rowsForTenant<{ currency: string; n: number; total: string }>(
      tenant.tenantId,
      `SELECT currency, count(*)::int AS n, sum(amount)::text AS total
         FROM incentive_award_lines
        WHERE tenant_id = $1
        GROUP BY currency
        ORDER BY currency`,
      [tenant.tenantId],
    );
    expect(lines).toEqual([
      { currency: "CNY", n: 2, total: "28400.000000" },
      { currency: "USD", n: 1, total: "1000.000000" },
    ]);

    const payments = await rowsForTenant<{
      currency: string;
      n: number;
      total: string;
    }>(
      tenant.tenantId,
      `SELECT currency, count(*)::int AS n, sum(amount)::text AS total
         FROM incentive_award_payments
        WHERE tenant_id = $1
        GROUP BY currency
        ORDER BY currency`,
      [tenant.tenantId],
    );
    expect(payments).toEqual([
      { currency: "CNY", n: 2, total: "28400.000000" },
      { currency: "USD", n: 1, total: "1000.000000" },
    ]);

    const journals = await rowsForTenant<{
      currency: string;
      journals: number;
      debit: string;
      credit: string;
      balanced: boolean;
    }>(
      tenant.tenantId,
      `SELECT currency,
              count(*)::int AS journals,
              sum(total_debit)::text AS debit,
              sum(total_credit)::text AS credit,
              bool_and(total_debit = total_credit) AS balanced
         FROM gl_journals
        WHERE tenant_id = $1
        GROUP BY currency
        ORDER BY currency`,
      [tenant.tenantId],
    );
    expect(journals).toEqual([
      {
        currency: "CNY",
        journals: 2,
        debit: "28400.000000",
        credit: "28400.000000",
        balanced: true,
      },
      {
        currency: "USD",
        journals: 1,
        debit: "1000.000000",
        credit: "1000.000000",
        balanced: true,
      },
    ]);

    const journalLines = await rowsForTenant<{
      journal_id: string;
      debit: string;
      credit: string;
    }>(
      tenant.tenantId,
      `SELECT j.id AS journal_id,
              sum(l.debit)::text AS debit,
              sum(l.credit)::text AS credit
         FROM gl_journals j
         JOIN gl_journal_lines l
           ON l.tenant_id = j.tenant_id AND l.journal_id = j.id
        WHERE j.tenant_id = $1
        GROUP BY j.id`,
      [tenant.tenantId],
    );
    expect(journalLines).toHaveLength(3);
    for (const journal of journalLines) {
      expect(journal.debit).toBe(journal.credit);
    }
    expect(stepEvidence("14.invariants").gl).toEqual({
      journalCount: 3,
      cnyDebit: "28400.00",
      usdDebit: "1000.00",
      balanced: true,
    });
  });

  it("enforces database unique constraints", async () => {
    // (tenant_id, employee_code) on people.
    const peopleClient = await pool.connect();
    try {
      await peopleClient.query("BEGIN");
      await peopleClient.query("SELECT set_config('app.tenant_id', $1, true)", [
        tenant.tenantId,
      ]);
      let duplicatePerson: { code?: string } | undefined;
      try {
        await peopleClient.query(
          `INSERT INTO people (id, tenant_id, employee_code, display_name)
           VALUES ($1,$2,'E001','duplicate employee code')`,
          [randomUUID(), tenant.tenantId],
        );
      } catch (error) {
        duplicatePerson = error as { code?: string };
      }
      expect(duplicatePerson?.code).toBe("23505");
    } finally {
      await peopleClient.query("ROLLBACK");
      peopleClient.release();
    }

    // (tenant_id, policy_code, version) on policy_versions.
    const policyClient = await pool.connect();
    try {
      await policyClient.query("BEGIN");
      await policyClient.query("SELECT set_config('app.tenant_id', $1, true)", [
        tenant.tenantId,
      ]);
      let duplicatePolicy: { code?: string } | undefined;
      try {
        await policyClient.query(
          `INSERT INTO policy_versions
             (id, tenant_id, policy_code, version, effective_from, rule_ast,
              rule_schema_version, content_hash)
           VALUES ($1,$2,'ANON-SHADOW-INCENTIVE-2026',1,
                   '2026-01-01','{}'::jsonb,'policy-definition/v1',
                   'sha256:duplicate-policy')`,
          [randomUUID(), tenant.tenantId],
        );
      } catch (error) {
        duplicatePolicy = error as { code?: string };
      }
      expect(duplicatePolicy?.code).toBe("23505");
    } finally {
      await policyClient.query("ROLLBACK");
      policyClient.release();
    }
  });

  it("rolls back a partially applied multi-payment request", async () => {
    const platformStore = new PgPlatformStore(pool);
    const suffix = randomUUID().slice(0, 8);
    const cycleId = String(stepEvidence("07.policy").cycleId);
    const batch = await platformStore.createIncentiveAwardBatch({
      tenantId: tenant.tenantId,
      batchNo: `PG-ROLLBACK-${suffix}`,
      awardType: "MONTHLY_STAR",
      period: "2026-11",
      cycleId,
      currency: "USD",
      createdBy: person("E003"),
      sourceRecordIds: [`PG-ROLLBACK:${suffix}`],
      lines: [
        {
          personId: person("E003"),
          amount: "100.00",
          sourceRecordId: `PG-ROLLBACK:${suffix}:1`,
          sourceLineRef: `PG-ROLLBACK:${suffix}`,
        },
      ],
    });
    expect(batch.lines).toHaveLength(1);

    const commands: Array<{
      command: "SUBMIT" | "APPROVE" | "LOCK" | "EXPORT";
      actorPersonId: string;
    }> = [
      { command: "SUBMIT", actorPersonId: person("E003") },
      { command: "APPROVE", actorPersonId: person("E001") },
      { command: "LOCK", actorPersonId: person("E001") },
      { command: "EXPORT", actorPersonId: person("E001") },
    ];
    for (const entry of commands) {
      const updated = await platformStore.commandIncentiveAwardBatch({
        tenantId: tenant.tenantId,
        batchId: batch.id,
        command: entry.command,
        actorPersonId: entry.actorPersonId,
      });
      expect(updated.status).toBe(
        entry.command === "SUBMIT"
          ? "PENDING_APPROVAL"
          : entry.command === "APPROVE"
            ? "APPROVED"
            : entry.command === "LOCK"
              ? "LOCKED"
              : "EXPORTED",
      );
    }

    const lineId = batch.lines[0]!.id;
    const paymentBase = {
      lineId,
      status: "PAID" as const,
      currency: "USD",
      paidAt: "2026-11-27T12:00:00.000Z",
      legalEntityId: "ENTITY-US-01",
      accountingPeriod: "2026-11",
    };

    const paymentJournalsBefore = await rowsForTenant<{ n: number }>(
      tenant.tenantId,
      `SELECT count(*)::int AS n
         FROM gl_journals
        WHERE tenant_id = $1 AND document_type = 'PAYMENT'`,
      [tenant.tenantId],
    );

    // First receipt is valid, the second is a deliberate amount mismatch. The
    // store validates the whole batch before writing, so the invalid second
    // receipt must roll the request back: neither payment row may exist.
    await expect(
      platformStore.recordIncentiveAwardPayments({
        tenantId: tenant.tenantId,
        batchId: batch.id,
        actorPersonId: person("E002"),
        payments: [
          {
            ...paymentBase,
            paymentRef: `PG-ROLLBACK-PAY-${suffix}`,
            amount: "100.00",
          },
          {
            ...paymentBase,
            paymentRef: `PG-ROLLBACK-BAD-${suffix}`,
            amount: "1.00",
          },
        ],
      }),
    ).rejects.toThrow(/AWARD_PAYMENT_AMOUNT_MISMATCH/);

    const persisted = await rowsForTenant<{ n: number }>(
      tenant.tenantId,
      `SELECT count(*)::int AS n
         FROM incentive_award_payments
        WHERE tenant_id = $1 AND batch_id = $2`,
      [tenant.tenantId, batch.id],
    );
    expect(persisted[0]?.n).toBe(0);

    const paymentJournalsAfter = await rowsForTenant<{ n: number }>(
      tenant.tenantId,
      `SELECT count(*)::int AS n
         FROM gl_journals
        WHERE tenant_id = $1 AND document_type = 'PAYMENT'`,
      [tenant.tenantId],
    );
    expect(paymentJournalsAfter[0]?.n).toBe(paymentJournalsBefore[0]?.n);

    // Also prove a real mid-transaction failure rolls back the first write:
    // insert one payment, violate the (batch, line, payment_ref) unique key,
    // roll back, and confirm the first row is gone.
    const tx = await pool.connect();
    const manualRef = `PG-ROLLBACK-MANUAL-${suffix}`;
    try {
      await tx.query("BEGIN");
      await tx.query("SELECT set_config('app.tenant_id', $1, true)", [
        tenant.tenantId,
      ]);
      await tx.query(
        `INSERT INTO incentive_award_payments
           (id, tenant_id, batch_id, line_id, person_id, amount, currency,
            payment_ref, status, paid_at, legal_entity_id, accounting_period,
            credit_account)
         VALUES ($1,$2,$3,$4,$5,'100.00','USD',$6,'PAID',now(),
                 'ENTITY-US-01','2026-11','CASH')`,
        [
          randomUUID(),
          tenant.tenantId,
          batch.id,
          lineId,
          person("E003"),
          manualRef,
        ],
      );
      let duplicatePayment: { code?: string } | undefined;
      try {
        await tx.query(
          `INSERT INTO incentive_award_payments
             (id, tenant_id, batch_id, line_id, person_id, amount, currency,
              payment_ref, status, paid_at, legal_entity_id, accounting_period,
              credit_account)
           VALUES ($1,$2,$3,$4,$5,'100.00','USD',$6,'PAID',now(),
                   'ENTITY-US-01','2026-11','CASH')`,
          [
            randomUUID(),
            tenant.tenantId,
            batch.id,
            lineId,
            person("E003"),
            manualRef,
          ],
        );
      } catch (error) {
        duplicatePayment = error as { code?: string };
      }
      expect(duplicatePayment?.code).toBe("23505");
    } finally {
      await tx.query("ROLLBACK").catch(() => {});
      tx.release();
    }
    const manual = await rowsForTenant<{ n: number }>(
      tenant.tenantId,
      `SELECT count(*)::int AS n
         FROM incentive_award_payments
        WHERE tenant_id = $1 AND payment_ref = $2`,
      [tenant.tenantId, manualRef],
    );
    expect(manual[0]?.n).toBe(0);

    const reloaded = await platformStore.getIncentiveAwardBatch(
      tenant.tenantId,
      batch.id,
    );
    expect(reloaded.status).toBe("EXPORTED");
  }, 60_000);

  it("isolates tenants with FORCE RLS", async () => {
    const platformStore = new PgPlatformStore(pool);
    const otherTenant = await platformStore.createTenant({
      name: `RLS peer ${randomUUID().slice(0, 8)}`,
      slug: `shadow-e2e-rls-peer-${randomUUID().slice(0, 8)}`,
      defaultCurrency: "CNY",
    });

    const client = await rlsPool.connect();
    try {
      const role = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolsuper, rolbypassrls
           FROM pg_roles
          WHERE rolname = current_user`,
      );
      expect(
        role.rows[0]?.rolsuper || role.rows[0]?.rolbypassrls,
        "RLS assertions require a NOBYPASSRLS role; use the anari_app DATABASE_URL " +
          "(test-pg.sh already does)",
      ).toBe(false);

      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        otherTenant.id,
      ]);
      await client.query(
        `INSERT INTO people (id, tenant_id, employee_code, display_name)
         VALUES ($1,$2,'RLS-PEER-1','RLS peer')`,
        [randomUUID(), otherTenant.id],
      );
      const own = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM people",
      );
      expect(own.rows[0]?.n).toBe(1);
      const crossRead = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM people WHERE tenant_id = $1",
        [tenant.tenantId],
      );
      expect(crossRead.rows[0]?.n).toBe(0);

      // WITH CHECK: writing into another tenant under this context is denied.
      let crossWrite: { code?: string } | undefined;
      try {
        await client.query(
          `INSERT INTO people (id, tenant_id, employee_code, display_name)
           VALUES ($1,$2,'RLS-CROSS-1','cross tenant')`,
          [randomUUID(), tenant.tenantId],
        );
      } catch (error) {
        crossWrite = error as { code?: string };
      }
      expect(crossWrite?.code).toBe("42501");
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }

    // No tenant context: RLS yields no rows (not an error, not a leak).
    const noContext = await rlsPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM people",
    );
    expect(noContext.rows[0]?.n).toBe(0);

    // Shadow tenant context sees exactly the three fixture persons.
    const shadowClient = await rlsPool.connect();
    try {
      await shadowClient.query("BEGIN");
      await shadowClient.query("SELECT set_config('app.tenant_id', $1, true)", [
        tenant.tenantId,
      ]);
      const shadowPeople = await shadowClient.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM people",
      );
      expect(shadowPeople.rows[0]?.n).toBe(3);
      const crossPeers = await shadowClient.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM people WHERE tenant_id = $1",
        [otherTenant.id],
      );
      expect(crossPeers.rows[0]?.n).toBe(0);
    } finally {
      await shadowClient.query("ROLLBACK").catch(() => {});
      shadowClient.release();
    }
  }, 60_000);

  it("returns 409 when paying an ACKNOWLEDGED batch and writes nothing", async () => {
    const cnyBatch = await rowsForTenant<{ id: string }>(
      tenant.tenantId,
      `SELECT id FROM incentive_award_batches
        WHERE tenant_id = $1 AND currency = 'CNY'`,
      [tenant.tenantId],
    );
    const batchId = cnyBatch[0]!.id;
    const line = await rowsForTenant<{
      id: string;
      amount: string;
      person_id: string;
    }>(
      tenant.tenantId,
      `SELECT id, amount::text AS amount, person_id
         FROM incentive_award_lines
        WHERE tenant_id = $1 AND batch_id = $2 AND person_id = $3`,
      [tenant.tenantId, batchId, person("E001")],
    );
    expect(line).toHaveLength(1);

    const app = buildApp(
      new PgStore(pool, tenant.tenantId),
      undefined,
      new DevHeaderAuthenticator({
        tenantId: tenant.tenantId,
        userId: "shadow-e2e-pg-test",
        personId: person("E001"),
        roles: ["admin", "platform_admin"],
      }),
      new PgPlatformStore(pool),
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/incentive-award-batches/${batchId}/payments`,
        headers: {
          "content-type": "application/json",
          "x-person-id": person("E002"),
        },
        payload: {
          payments: [
            {
              lineId: line[0]!.id,
              paymentRef: "BANK-CN-REPAY-AFTER-ACK-TEST",
              status: "PAID",
              amount: line[0]!.amount,
              currency: "CNY",
              paidAt: "2026-11-27T13:00:00.000Z",
              legalEntityId: "ENTITY-CN-01",
              accountingPeriod: "2026-11",
            },
          ],
        },
      } as never);
      expect(response.statusCode).toBe(409);
      expect(response.body).toContain("AWARD_BATCH_ALREADY_ACKNOWLEDGED");
    } finally {
      await app.close();
    }

    const extra = await rowsForTenant<{ n: number }>(
      tenant.tenantId,
      `SELECT count(*)::int AS n
         FROM incentive_award_payments
        WHERE tenant_id = $1 AND payment_ref = 'BANK-CN-REPAY-AFTER-ACK-TEST'`,
      [tenant.tenantId],
    );
    expect(extra[0]?.n).toBe(0);

    const ack = await rowsForTenant<{
      status: string;
      acknowledged_at: Date | null;
      payment_ref: string | null;
    }>(
      tenant.tenantId,
      `SELECT status, acknowledged_at, payment_ref
         FROM incentive_award_batches
        WHERE tenant_id = $1 AND id = $2`,
      [tenant.tenantId, batchId],
    );
    expect(ack[0]?.status).toBe("ACKNOWLEDGED");
    expect(ack[0]?.acknowledged_at).not.toBeNull();
    expect(ack[0]?.payment_ref).toBe("BANK-ACK-CN-2026-11");
  }, 60_000);
});
