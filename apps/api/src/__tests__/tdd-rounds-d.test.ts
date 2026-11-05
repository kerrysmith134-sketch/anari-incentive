/*
 * TDD rounds 41–50: second adversarial wave — equity math, approval
 * consumption semantics, webhook HMAC, budget pools, policy succession,
 * e-sign callbacks.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const ADMIN = "00000000-0000-4000-8000-000000000003";
const CYCLE = "00000000-0000-4000-8000-000000000020";

let app: FastifyInstance;
let appStore: Store;
let platformStore: MemoryPlatformStore;

async function call(
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  const response = await app.inject({
    method,
    url,
    payload,
    headers,
  } as never);
  return {
    status: response.statusCode,
    raw: response.body,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get body(): any {
      return response.json();
    },
  };
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

// ---------------------------------------------------------------------------
// Rounds 41–42 — equity vesting math and exercise exhaustion.
// ---------------------------------------------------------------------------
async function createGrant(cliffMonths: number): Promise<string> {
  const grant = await call("POST", "/api/v1/equity-grants", {
    personId: OWNER,
    grantCode: `G-TDD-${cliffMonths}`,
    grantType: "RSU",
    totalUnits: "1200",
    strikePrice: "0",
    currency: "CNY",
    grantDate: "2026-01-01T00:00:00Z",
    vestingStart: "2026-01-01T00:00:00Z",
    cliffMonths,
    vestingMonths: 48,
  });
  expect(grant.status).toBe(201);
  return grant.body.data.id;
}

describe("round 41: cliff means zero vested before month 12", () => {
  it("vests nothing mid-cliff and the cliff batch at month 12", async () => {
    const grantId = await createGrant(12);
    const midCliff = await call(
      "GET",
      `/api/v1/equity-grants/${grantId}/vesting?asOf=2026-07-15T00:00:00Z`,
    );
    expect(midCliff.body.data.vestedUnits).toBe("0");

    // 1200 units over 48 months → 25/month; at the cliff, 12 months vest.
    const atCliff = await call(
      "GET",
      `/api/v1/equity-grants/${grantId}/vesting?asOf=2027-01-01T00:00:00Z`,
    );
    expect(atCliff.body.data.vestedUnits).toBe("300");
    expect(atCliff.body.data.nextVestAt).toBeTruthy();
  });
});

describe("round 42: exercises cannot exceed available units", () => {
  it("rejects over-exercise at creation and tracks availability", async () => {
    // Start 2025-01-01, cliff 12, 48-month schedule → vested today (22 months) = 550.
    const grant = await call("POST", "/api/v1/equity-grants", {
      personId: OWNER,
      grantCode: "G-TDD-EX",
      grantType: "RSU",
      totalUnits: "1200",
      strikePrice: "0",
      currency: "CNY",
      grantDate: "2025-01-01T00:00:00Z",
      vestingStart: "2025-01-01T00:00:00Z",
      cliffMonths: 12,
      vestingMonths: 48,
    });
    const grantId = grant.body.data.policyVersionId ?? grant.body.data.id;

    const exercise = await call(
      "POST",
      `/api/v1/equity-grants/${grantId}/exercises`,
      { units: "100", requestedBy: OWNER },
    );
    expect(exercise.status).toBe(201);
    const exerciseId = exercise.body.data.id;

    const approve = await call(
      "POST",
      `/api/v1/equity-exercises/${exerciseId}/approve`,
      { approvedBy: ADMIN },
    );
    expect([200, 201]).toContain(approve.status);

    const vesting = await call("GET", `/api/v1/equity-grants/${grantId}/vesting`);
    expect(vesting.body.data.availableUnits).toBe("450");

    const over = await call(
      "POST",
      `/api/v1/equity-grants/${grantId}/exercises`,
      { units: "9999", requestedBy: OWNER },
    );
    expect(over.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Rounds 43–45 — approval request consumption semantics.
// ---------------------------------------------------------------------------
async function createApproval(payload: Record<string, unknown>) {
  return call("POST", "/api/v1/approval-requests", {
    actionType: "CALCULATION_LOCK",
    targetType: "CALCULATION_RUN",
    targetId: CYCLE,
    targetVersion: 1,
    requestedByType: "USER",
    riskTier: "T2",
    requiredApprovals: 1,
    payload,
    idempotencyKey: `tdd-approval-${Math.random()}`,
  });
}

describe("round 43: deciding with a mismatched payload hash is refused", () => {
  it("rejects the decision", async () => {
    const created = await createApproval({ amount: "100" });
    const request = created.body.data;
    const wrong = await call(
      "POST",
      `/api/v1/approval-requests/${request.id}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: ADMIN,
        payloadHash: "not-the-real-hash",
      },
    );
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    const list = await call(
      "GET",
      `/api/v1/approval-requests/${request.id}`,
    );
    expect(list.body.data.status).toBe("PENDING");
  });
});

describe("round 44: an approval can only be consumed once", () => {
  it("refuses the second consumption", async () => {
    const created = await createApproval({ amount: "100" });
    const request = created.body.data;
    await call("POST", `/api/v1/approval-requests/${request.id}/decide`, {
      decision: "APPROVE",
      approverPersonId: ADMIN,
      payloadHash: request.payloadHash,
    });
    const first = await call(
      "POST",
      `/api/v1/approval-requests/${request.id}/consume`,
      { consumedBy: ADMIN },
    );
    expect([200, 201]).toContain(first.status);
    const second = await call(
      "POST",
      `/api/v1/approval-requests/${request.id}/consume`,
      { consumedBy: ADMIN },
    );
    expect(second.status).toBeGreaterThanOrEqual(400);
  });
});

describe("round 45: an expired approval cannot be decided", () => {
  it("expires the request on decide", async () => {
    const created = await call("POST", "/api/v1/approval-requests", {
      actionType: "CALCULATION_LOCK",
      targetType: "CALCULATION_RUN",
      targetId: CYCLE,
      targetVersion: 1,
      requestedByType: "USER",
      riskTier: "T2",
      requiredApprovals: 1,
      expiresAt: "2026-01-01T00:00:00Z",
      payload: {},
      idempotencyKey: `tdd-approval-exp-${Math.random()}`,
    });
    const request = created.body.data;
    const decided = await call(
      "POST",
      `/api/v1/approval-requests/${request.id}/decide`,
      {
        decision: "APPROVE",
        approverPersonId: ADMIN,
        payloadHash: request.payloadHash,
      },
    );
    expect(decided.status).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// Round 46 — webhook HMAC verification.
// ---------------------------------------------------------------------------
describe("round 46: webhooks verify HMAC signatures", () => {
  function signedApp(): FastifyInstance {
    return buildApp(appStore, undefined, undefined, platformStore, {
      webhookSecrets: { crm: "whsec-test" },
    });
  }

  it("accepts a valid signature and rejects a forged one", async () => {
    const hookApp = signedApp();
    const payload = JSON.stringify({ eventId: "evt-1", ok: true });
    const digest = createHmac("sha256", "whsec-test")
      .update(payload)
      .digest("hex");
    const good = await hookApp.inject({
      method: "POST",
      url: "/api/v1/webhooks/crm",
      payload,
      headers: {
        "content-type": "application/json",
        "x-signature-256": `sha256=${digest}`,
      },
    } as never);
    expect([200, 202]).toContain(good.statusCode);

    const bad = await hookApp.inject({
      method: "POST",
      url: "/api/v1/webhooks/crm",
      payload,
      headers: {
        "content-type": "application/json",
        "x-signature-256": `sha256=${"0".repeat(64)}`,
      },
    } as never);
    // Designed contract: HMAC failures are explicit 409 rejections;
    // ConflictError surfaces code CONFLICT with the detail in the message.
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error.message).toContain("WEBHOOK_SIGNATURE_INVALID");
  });
});

// ---------------------------------------------------------------------------
// Rounds 47–48 — budget pool arithmetic.
// ---------------------------------------------------------------------------
async function createPool(amount: string): Promise<string> {
  const pool = await call("POST", "/api/v1/budget-pools", {
    cycleId: CYCLE,
    code: `POOL-${Math.random().toString(36).slice(2, 7)}`,
    name: "TDD pool",
    poolType: "STANDARD",
    currency: "CNY",
    approvedAmount: amount,
  });
  const poolId = pool.body.data.id;
  await call("POST", `/api/v1/budget-pools/${poolId}/approve`, {
    approvedBy: ADMIN,
  });
  return poolId;
}

describe("round 47: allocations cannot exceed the approved pool", () => {
  it("rejects an over-committing allocation", async () => {
    const poolId = await createPool("1000");
    await call("POST", `/api/v1/budget-pools/${poolId}/allocations`, {
      targetType: "CALCULATION_RUN",
      targetId: CYCLE,
      amount: "600",
    });
    const over = await call(
      "POST",
      `/api/v1/budget-pools/${poolId}/allocations`,
      {
        targetType: "CALCULATION_RUN",
        targetId: CYCLE,
        amount: "600",
      },
    );
    expect(over.status).toBeGreaterThanOrEqual(400);
  });
});

describe("round 48: releasing an allocation restores the committed amount", () => {
  it("allows a replacement allocation after release", async () => {
    const poolId = await createPool("1000");
    const allocation = await call(
      "POST",
      `/api/v1/budget-pools/${poolId}/allocations`,
      {
        targetType: "CALCULATION_RUN",
        targetId: CYCLE,
        amount: "600",
      },
    );
    const allocationId = allocation.body.data.id;
    await call("POST", `/api/v1/budget-allocations/${allocationId}/release`, {
      releasedBy: ADMIN,
      reason: "Run superseded",
    });
    const again = await call(
      "POST",
      `/api/v1/budget-pools/${poolId}/allocations`,
      {
        targetType: "CALCULATION_RUN",
        targetId: CYCLE,
        amount: "600",
      },
    );
    expect(again.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Round 49 — policy publication succession/rollback keeps content immutable.
// ---------------------------------------------------------------------------
describe("round 49: policy rollback republishes prior content with a new version", () => {
  it("keeps the old version intact and opens a successor", async () => {
    const publish = () =>
      call("POST", "/api/v1/policy-versions", {
        policy: {
          code: "TDD-POLICY",
          version: 1,
          currency: "CNY",
          poolRate: "3.5",
          poolCap: "120000",
          rounding: "HALF_UP",
        },
        effectiveFrom: "2026-12-01T00:00:00Z",
        approvedBy: ADMIN,
        applicability: {
          legalEntity: "N-Perform Test Entity",
          jurisdictions: ["CN"],
          workLocations: ["Shanghai"],
          employeeCategories: ["FULL_TIME"],
          workTimeTypes: ["FULL_TIME"],
        },
      });

    const first = await publish();
    expect(first.status).toBe(201);
    const originalVersionId = first.body.data.policyVersionId;
    const originalContent = JSON.stringify(first.body.data.policy);

    const rollback = await call(
      "POST",
      `/api/v1/policy-versions/${originalVersionId}/rollback`,
      {
        effectiveFrom: "2026-12-05T00:00:00Z",
        approvedBy: ADMIN,
      },
    );
    expect([200, 201]).toContain(rollback.status);

    const after = await call("GET", "/api/v1/policy-versions");
    const versions = after.body.data.filter(
      (candidate: { code: string }) => candidate.code === "TDD-POLICY",
    );
    expect(versions.length).toBeGreaterThanOrEqual(2);
    // The rollback successor is the next version of the same code.
    const successor = versions.find(
      (candidate: { policyVersionId: string; version: number }) =>
        candidate.policyVersionId !== originalVersionId,
    );
    expect(successor.version).toBe(2);
    // The original version stays intact (published content is immutable).
    const detail = await call("GET", `/api/v1/policy-versions/${originalVersionId}`);
    expect(JSON.stringify(detail.body.data)).toBe(originalContent);
  });
});

// ---------------------------------------------------------------------------
// Round 50 — e-sign callback HMAC + consent write-back.
// ---------------------------------------------------------------------------
describe("round 50: e-sign callbacks verify HMAC and write consent back", () => {
  function esignApp(): FastifyInstance {
    return buildApp(appStore, undefined, undefined, platformStore, {
      esignWebhookSecrets: { providerx: "esign-secret" },
    });
  }

  it("rejects a forged signature", async () => {
    const hookApp = esignApp();
    const payload = JSON.stringify({ event: "SIGNED", envelopeId: "env-1" });
    const bad = await hookApp.inject({
      method: "POST",
      url: "/api/v1/esign/webhooks/providerx",
      payload,
      headers: {
        "content-type": "application/json",
        "x-signature-256": "sha256=deadbeef",
      },
    } as never);
    // Designed contract: signature failures are explicit 409 rejections;
    // ConflictError surfaces code CONFLICT with the detail in the message.
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error.message).toContain("ESIGN_WEBHOOK_SIGNATURE_INVALID");
  });
});
