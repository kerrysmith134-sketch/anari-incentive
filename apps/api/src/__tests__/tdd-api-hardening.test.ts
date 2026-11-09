import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";

let app: FastifyInstance;
let appStore: Store;
let platformStore: MemoryPlatformStore;

async function call(
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await app.inject({ method, url, payload } as never);
  return {
    status: response.statusCode,
    text: response.body,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get body(): any {
      return response.json();
    },
  };
}

function employeeApp() {
  return buildApp(
    appStore,
    undefined,
    {
      async authenticate() {
        return {
          tenantId: "tenant-demo",
          userId: "emp",
          roles: ["employee"],
          personId: MEMBER,
        };
      },
    },
    platformStore,
  );
}

beforeEach(() => {
  appStore = new Store();
  platformStore = new MemoryPlatformStore({
    demoTenant: {
      id: "tenant-demo",
      name: "Demo tenant",
      slug: "demo-tenant",
      persons: [
        { id: OWNER, employeeCode: "E001", displayName: "Sales Lead" },
        { id: MEMBER, employeeCode: "E002", displayName: "Contributor" },
        { id: ADMIN, employeeCode: "E003", displayName: "Admin" },
      ],
    },
  });
  app = buildApp(appStore, undefined, undefined, platformStore);
});

function batchPayload(
  batchNo: string,
  source: string,
  amount = "500",
  note?: string,
) {
  return {
    batchNo,
    awardType: "MONTHLY_STAR",
    period: "2026-11",
    currency: "CNY",
    createdBy: ADMIN,
    sourceRecordIds: [source],
    lines: [
      {
        personId: MEMBER,
        amount,
        sourceRecordId: source,
        sourceLineRef: "line-1",
        note,
      },
    ],
  };
}

async function createBatch(batchNo: string, source: string, note?: string) {
  const created = await call(
    "POST",
    "/api/v1/incentive-award-batches",
    batchPayload(batchNo, source, "500", note),
  );
  expect(created.status).toBe(201);
  return created.body.data.id as string;
}

async function advance(id: string, command: string, extra = {}) {
  return call("POST", `/api/v1/incentive-award-batches/${id}/commands`, {
    command,
    ...extra,
  });
}

describe("API hardening rounds 25-44", () => {
  it("25: rejects a zero-amount award line", async () => {
    const response = await call(
      "POST",
      "/api/v1/incentive-award-batches",
      batchPayload("R25", "s25", "0"),
    );
    expect(response.status).toBe(409);
  });

  it("26: rejects duplicate person + source line inside one batch", async () => {
    const payload = batchPayload("R26", "s26");
    payload.lines = [...payload.lines, ...payload.lines];
    const response = await call(
      "POST",
      "/api/v1/incentive-award-batches",
      payload,
    );
    expect(response.status).toBe(409);
  });

  it("27: cancelling a batch releases its source record", async () => {
    const first = await createBatch("R27-A", "shared-source");
    const cancelled = await advance(first, "CANCEL");
    expect(cancelled.status).toBe(200);
    const second = await call(
      "POST",
      "/api/v1/incentive-award-batches",
      batchPayload("R27-B", "shared-source"),
    );
    expect(second.status).toBe(201);
  });

  it("28: cannot export before the batch is locked", async () => {
    const id = await createBatch("R28", "s28");
    await advance(id, "SUBMIT");
    await advance(id, "APPROVE");
    const response = await call(
      "GET",
      `/api/v1/incentive-award-batches/${id}/export`,
    );
    expect(response.status).toBe(409);
  });

  it("29: acknowledge requires a payment reference", async () => {
    const id = await createBatch("R29", "s29");
    for (const command of ["SUBMIT", "APPROVE", "LOCK", "EXPORT"]) {
      expect((await advance(id, command)).status).toBe(200);
    }
    const response = await advance(id, "ACKNOWLEDGE");
    expect(response.status).toBe(409);
  });

  it("30: CSV export neutralizes spreadsheet formulas in notes", async () => {
    const id = await createBatch(
      "R30",
      "s30",
      '=HYPERLINK("http://evil","click")',
    );
    for (const command of ["SUBMIT", "APPROVE", "LOCK", "EXPORT"]) {
      expect((await advance(id, command)).status).toBe(200);
    }
    const response = await call(
      "GET",
      `/api/v1/incentive-award-batches/${id}/export`,
    );
    expect(response.status).toBe(200);
    expect(response.text).toContain("'=HYPERLINK");
  });

  it("31: a locked batch cannot be cancelled", async () => {
    const id = await createBatch("R31", "s31");
    for (const command of ["SUBMIT", "APPROVE", "LOCK"]) {
      expect((await advance(id, command)).status).toBe(200);
    }
    const response = await advance(id, "CANCEL");
    expect(response.status).toBe(409);
  });

  it("32: an employee cannot read statutory deduction types", async () => {
    const response = await employeeApp().inject({
      method: "GET",
      url: "/api/v1/statutory-deduction-types",
    } as never);
    expect(response.statusCode).toBe(403);
  });

  it("33: statutory capRate outside 0-1 is rejected", async () => {
    const response = await call("PUT", "/api/v1/statutory-deduction-types", {
      types: [{ type: "COURT_ORDER", priority: 0, capRate: "1.5" }],
    });
    expect(response.status).toBe(400);
  });

  it("34: custom DLP rule blocks an export containing the pattern", async () => {
    const rules = await call("PUT", "/api/v1/export-dlp-rules", {
      rules: [{ code: "SECRET", pattern: "SECRET-[0-9]+" }],
    });
    expect(rules.status).toBe(200);
    const id = await createBatch("R34", "s34", "contains SECRET-123");
    for (const command of ["SUBMIT", "APPROVE", "LOCK", "EXPORT"]) {
      expect((await advance(id, command)).status).toBe(200);
    }
    const response = await call(
      "GET",
      `/api/v1/incentive-award-batches/${id}/export`,
    );
    expect(response.status).toBe(409);
  });

  it("35: annual finalize rejects a missing report body", async () => {
    const response = await call(
      "POST",
      "/api/v1/reports/policy-review:finalize",
      { from: "2025-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" },
    );
    expect(response.status).toBe(400);
  });

  it("36: annual snapshot export includes hash and signer", async () => {
    const finalized = await call(
      "POST",
      "/api/v1/reports/policy-review:finalize",
      {
        from: "2025-01-01T00:00:00Z",
        to: "2026-01-01T00:00:00Z",
        report: { ok: true },
        signedOffBy: ADMIN,
      },
    );
    expect(finalized.status).toBe(201);
    const response = await call(
      "GET",
      `/api/v1/reports/policy-review/snapshots/${finalized.body.data.id}/export`,
    );
    expect(response.status).toBe(200);
    expect(response.text).toContain("sha256:");
    expect(response.text).toContain(ADMIN);
  });

  it("37: reviewer agreement is explicitly insufficient with no pairs", async () => {
    const response = await call("GET", "/api/v1/reports/reviewer-agreement");
    expect(response.status).toBe(200);
    expect(response.body.data.insufficient).toBe(true);
    expect(response.body.data.cohenKappa).toBeNull();
  });

  it("38: perfect paired agreement yields kappa 1", async () => {
    const now = new Date();
    const cycle = await call("POST", "/api/v1/evaluation-cycles", {
      name: "完美一致周期",
      cycleType: "QUARTERLY",
      startsAt: new Date(now.getTime() - 864e5).toISOString(),
      endsAt: new Date(now.getTime() + 864e5).toISOString(),
      timezone: "Asia/Shanghai",
    });
    const cycleId = cycle.body.data.id;
    const rubric = await call("POST", "/api/v1/rubrics", {
      code: `RUB-PERFECT-${Date.now()}`,
      name: "完美一致",
      dimensions: ["QUALITY"],
      scoringAnchors: {},
      effectiveFrom: "2026-01-01",
    });
    for (const reviewer of [OWNER, ADMIN]) {
      const draft = await call("POST", "/api/v1/evaluation-drafts", {
        cycleId,
        personId: MEMBER,
        generatedByType: "USER",
        evidenceSnapshotHash: `perfect-${reviewer}-${Date.now()}`,
        draftPayload: { summary: "一致" },
      });
      await call("POST", `/api/v1/evaluation-drafts/${draft.body.data.id}/submit`);
      const decided = await call(
        "POST",
        `/api/v1/evaluation-drafts/${draft.body.data.id}/decision`,
        {
          reviewerPersonId: reviewer,
          rubricVersionId: rubric.body.data.id,
          decision: "APPROVE",
          scores: { QUALITY: 5 },
          rationale: "复核通过",
          independentScores: { QUALITY: 5 },
          independentRationale: "独立判断一致",
        },
      );
      expect(decided.status).toBeLessThan(300);
    }
    const response = await call("GET", "/api/v1/reports/reviewer-agreement");
    expect(response.body.data.pairCount).toBe(1);
    expect(response.body.data.exactAgreementRate).toBe(1);
    expect(response.body.data.cohenKappa).toBe(1);
  });

  it("39: datasetRef-only evaluation fails when the dataset has no samples", async () => {
    const response = await call(
      "POST",
      "/api/v1/model-evaluation-runs:evaluate",
      {
        evaluationType: "DRAFT_QUALITY",
        modelProvider: "builtin",
        modelName: "m",
        promptVersion: "v1",
        datasetRef: "missing-dataset",
      },
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("GOLD_SET_SAMPLES_REQUIRED");
  });

  it("40: holdout size must be smaller than the sample size", async () => {
    const response = await call(
      "POST",
      "/api/v1/model-evaluation-datasets:import",
      {
        code: "HOLDOUT-BAD",
        name: "留出集过大",
        labelSource: "专家",
        ownerPersonId: ADMIN,
        refreshedAt: new Date().toISOString(),
        nextRefreshDueAt: new Date(Date.now() + 864e5).toISOString(),
        samples: [
          {
            sampleId: "a",
            subgroup: "A",
            humanScoreA: 4,
            humanScoreB: 4,
            aiScore: 4,
            counterfactualScores: [4],
            promptInjectionPassed: true,
            holdout: true,
          },
          {
            sampleId: "b",
            subgroup: "A",
            humanScoreA: 4,
            humanScoreB: 4,
            aiScore: 4,
            counterfactualScores: [4],
            promptInjectionPassed: true,
            holdout: true,
          },
        ],
      },
    );
    expect(response.status).toBe(409);
  });

  it("41: an employee cannot create an award batch", async () => {
    const response = await employeeApp().inject({
      method: "POST",
      url: "/api/v1/incentive-award-batches",
      payload: batchPayload("R41", "s41"),
    } as never);
    expect(response.statusCode).toBe(403);
  });

  it("42: notification read-all only marks the caller's notifications", async () => {
    await appStore.createNotification({
      recipientPersonId: MEMBER,
      audience: "PERSON",
      title: "给员工的提醒",
      body: "own",
    });
    await appStore.createNotification({
      recipientPersonId: OWNER,
      audience: "PERSON",
      title: "给主管的提醒",
      body: "other",
    });
    const employee = employeeApp();
    const marked = await employee.inject({
      method: "POST",
      url: "/api/v1/notifications/read-all",
    } as never);
    expect(marked.statusCode).toBe(200);
    expect(marked.json().data.marked).toBe(1);
    const adminList = await call("GET", "/api/v1/notifications");
    const other = adminList.body.data.find(
      (item: { title: string }) => item.title === "给主管的提醒",
    );
    expect(other.status).toBe("UNREAD");
  });

  it("43: invalid custom DLP regex is rejected at write time", async () => {
    const response = await call("PUT", "/api/v1/export-dlp-rules", {
      rules: [{ code: "BAD", pattern: "([" }],
    });
    expect(response.status).toBe(400);
  });

  it("44: award batch total keeps two-decimal precision for large amounts", async () => {
    const response = await call(
      "POST",
      "/api/v1/incentive-award-batches",
      batchPayload("R44", "s44", "999999999.99"),
    );
    expect(response.status).toBe(201);
    expect(response.body.data.totalAmount).toBe("999999999.99");
  });
});
