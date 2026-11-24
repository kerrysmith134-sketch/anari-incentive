/**
 * Sprint 5（2026-11-21 审计）：Financial Fact 强类型 + 会计期间关闭/重开。
 */
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000001";

function buildAppFor() {
  const platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: TENANT,
      name: "Sprint 5 tenant",
      slug: "sprint5",
    },
  });
  return buildApp(
    () => new Store(TENANT),
    undefined,
    {
      async authenticate() {
        return {
          tenantId: TENANT,
          userId: "sprint5",
          roles: ["admin", "finance", "integration"],
          personId: ADMIN,
        };
      },
    },
    platformStore,
  );
}

interface InjectResult {
  statusCode: number;
  json(): unknown;
}

async function post(
  app: Awaited<ReturnType<typeof buildApp>>,
  url: string,
  payload: Record<string, unknown>,
): Promise<InjectResult> {
  return (await app.inject({
    method: "POST",
    url,
    payload,
    headers: { "content-type": "application/json" },
  })) as unknown as InjectResult;
}

const LEGAL_ENTITY = "LE-SPRINT5";
const PERIOD = "2026-10";

function postedFact(recordId: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceSystem: "sprint5-erp",
    sourceRecordId: recordId,
    factType: "REVENUE",
    amount: "100.00",
    currency: "USD",
    recognitionStatus: "POSTED",
    legalEntityId: LEGAL_ENTITY,
    accountingPeriod: PERIOD,
    instrumentType: "INVOICE",
    orderId: "SO-SPRINT5-1",
    sourceVersion: "v1",
    payload: {},
    ...overrides,
  };
}

describe("Sprint 5 financial integrity", () => {
  it("rejects POSTED facts without accounting semantics at the API boundary", async () => {
    const app = buildAppFor();
    const res = await post(app, "/api/v1/financial-facts", {
      sourceSystem: "sprint5-erp",
      sourceRecordId: "MISSING",
      factType: "REVENUE",
      amount: "1",
      currency: "USD",
      recognitionStatus: "POSTED",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; details: unknown[] } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(body.error.details)).toContain("legalEntityId");
  });

  it("enforces close -> reopen -> reopeningRef on POSTED facts", async () => {
    const app = buildAppFor();
    const first = await post(app, "/api/v1/financial-facts", postedFact("F-1"));
    expect(first.statusCode).toBe(201);

    const close = await post(app, "/api/v1/accounting-periods/close", {
      legalEntityId: LEGAL_ENTITY,
      period: PERIOD,
      actorPersonId: ADMIN,
      reason: "month-end close",
    });
    expect(close.statusCode).toBe(200);
    expect((close.json() as { data: { status: string } }).data.status).toBe(
      "CLOSED",
    );

    const blocked = await post(
      app,
      "/api/v1/financial-facts",
      postedFact("F-2"),
    );
    expect(blocked.statusCode).toBe(409);
    expect((blocked.json() as { error: { message: string } }).error.message).toMatch(
      /PERIOD_CLOSED/,
    );

    const reopen = await post(app, "/api/v1/accounting-periods/reopen", {
      legalEntityId: LEGAL_ENTITY,
      period: PERIOD,
      actorPersonId: ADMIN,
      reopeningRef: "REOPEN-S5-A",
      reason: "late invoice",
    });
    expect(reopen.statusCode).toBe(200);

    const noRef = await post(
      app,
      "/api/v1/financial-facts",
      postedFact("F-3"),
    );
    expect(noRef.statusCode).toBe(409);
    expect((noRef.json() as { error: { message: string } }).error.message).toMatch(
      /REOPENING_REF_REQUIRED/,
    );

    const withRef = await post(
      app,
      "/api/v1/financial-facts",
      postedFact("F-4", { reopeningRef: "REOPEN-S5-A" }),
    );
    expect(withRef.statusCode).toBe(201);
    const saved = (withRef.json() as { data: Record<string, unknown> }).data;
    expect(saved.reopeningRef).toBe("REOPEN-S5-A");
    expect(saved.instrumentType).toBe("INVOICE");
    expect(saved.recognitionStatus).toBe("POSTED");

    const periods = (await app.inject({
      method: "GET",
      url: `/api/v1/accounting-periods?legalEntityId=${LEGAL_ENTITY}`,
    })) as unknown as InjectResult;
    expect(periods.statusCode).toBe(200);
    const rows = (periods.json() as { data: Array<{ status: string }> }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("OPEN");
  });

  it("can close an empty accounting period without any prior fact", async () => {
    const app = buildAppFor();
    const close = await post(app, "/api/v1/accounting-periods/close", {
      legalEntityId: "LE-EMPTY",
      period: "2026-09",
      actorPersonId: ADMIN,
      reason: "no activity",
    });
    expect(close.statusCode).toBe(200);
    expect((close.json() as { data: { status: string } }).data.status).toBe(
      "CLOSED",
    );
  });

  it("does not allow a DRAFT snapshot to un-post a POSTED fact", async () => {
    const app = buildAppFor();
    const posted = await post(app, "/api/v1/financial-facts", postedFact("F-POSTED"));
    expect(posted.statusCode).toBe(201);
    const regression = await post(app, "/api/v1/financial-facts", {
      sourceSystem: "sprint5-erp",
      sourceRecordId: "F-POSTED",
      factType: "REVENUE",
      amount: "100.00",
      currency: "USD",
      recognitionStatus: "DRAFT",
      payload: {},
    });
    expect(regression.statusCode).toBe(409);
    expect(
      (regression.json() as { error: { message: string } }).error.message,
    ).toMatch(/RECOGNITION_STATUS_REGRESSION/);
  });

  it("keeps DRAFT facts usable for pre-accounting evidence", async () => {
    const app = buildAppFor();
    const draft = await post(app, "/api/v1/financial-facts", {
      sourceSystem: "sprint5-erp",
      sourceRecordId: "DRAFT-1",
      factType: "REVENUE",
      amount: "50.00",
      currency: "USD",
      payload: {},
    });
    expect(draft.statusCode).toBe(201);
    expect(
      (draft.json() as { data: { recognitionStatus: string } }).data
        .recognitionStatus,
    ).toBe("DRAFT");
  });
});
