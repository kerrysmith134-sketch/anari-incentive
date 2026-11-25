/*
 * 确定性 Agent 辅助（无外部 LLM）：字段映射建议 / 同步异常诊断 /
 * 对账差异解释。覆盖纯函数规则、Zod 校验、空输入、跨租户无关与只读性。
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { DevHeaderAuthenticator } from "@anari/auth";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";
import {
  CONSECUTIVE_FAILURE_THRESHOLD,
  detectSyncAnomalies,
  explainReconciliation,
  RECONCILIATION_ROUNDING_TOLERANCE,
  suggestFieldMappings,
  type SyncRunSummary,
} from "../agent-assist.js";

const SUCCESS_RUN: SyncRunSummary = {
  status: "SUCCEEDED",
  fetched: 100,
  created: 100,
  updated: 0,
  duplicate: 0,
  quarantined: 0,
  failed: 0,
};

function balanced(overrides: Partial<SyncRunSummary>): SyncRunSummary {
  const base: SyncRunSummary = {
    status: "SUCCEEDED",
    fetched: 0,
    created: 0,
    updated: 0,
    duplicate: 0,
    quarantined: 0,
    failed: 0,
  };
  return { ...base, ...overrides };
}

function suggestionFor(
  result: ReturnType<typeof suggestFieldMappings>,
  targetField: string,
) {
  return result.suggestions.find((entry) => entry.targetField === targetField);
}

describe("suggestFieldMappings", () => {
  it("maps a CRM opportunity sample onto canonical opportunity fields", () => {
    const result = suggestFieldMappings({
      targetType: "COMMERCIAL_OPPORTUNITY",
      sample: {
        deal_id: "D-1",
        account_id: "A-1",
        company_name: "Acme",
        deal_name: "Rooftop expansion",
        deal_stage: "PROPOSAL",
        deal_value: 125000.5,
        currency: "USD",
      },
    });

    expect(result.suggestions).toHaveLength(7);
    expect(suggestionFor(result, "externalOpportunityId")).toMatchObject({
      sourceField: "deal_id",
      required: true,
      confidence: 0.92,
    });
    expect(suggestionFor(result, "externalAccountId")).toMatchObject({
      sourceField: "account_id",
      required: true,
    });
    expect(suggestionFor(result, "accountName")).toMatchObject({
      sourceField: "company_name",
      required: true,
    });
    expect(suggestionFor(result, "name")).toMatchObject({
      sourceField: "deal_name",
      required: true,
    });
    expect(suggestionFor(result, "stage")).toMatchObject({
      sourceField: "deal_stage",
      required: false,
    });
    expect(suggestionFor(result, "estimatedAmount")).toMatchObject({
      sourceField: "deal_value",
      confidence: 0.94,
      required: false,
    });
    expect(suggestionFor(result, "currency")).toMatchObject({
      sourceField: "currency",
      confidence: 0.98,
      required: true,
    });
    expect(result.missingRequiredFields).toEqual([]);
    expect(result.unmatchedSourceFields).toEqual([]);
    for (const suggestion of result.suggestions) {
      expect(suggestion.confidence).toBeGreaterThanOrEqual(0);
      expect(suggestion.confidence).toBeLessThanOrEqual(1);
      expect(suggestion.reason.length).toBeGreaterThan(0);
    }
  });

  it("maps a ticketing sample onto canonical work-item fields", () => {
    const result = suggestFieldMappings({
      targetType: "WORK_ITEM",
      sample: {
        id: "WI-1",
        project_id: "PRJ-1",
        title: "Replace inverter",
        type: "STORY",
        status: "OPEN",
        priority: "HIGH",
        assignee_id: "EMP-9",
        due_date: "2026-12-01",
        story_points: 5,
        amount: 1200,
        currency: "USD",
      },
    });

    expect(result.missingRequiredFields).toEqual([]);
    expect(suggestionFor(result, "externalId")).toMatchObject({
      sourceField: "id",
      required: true,
    });
    expect(suggestionFor(result, "projectId")).toMatchObject({
      sourceField: "project_id",
      required: true,
    });
    expect(suggestionFor(result, "title")).toMatchObject({
      sourceField: "title",
      required: true,
    });
    expect(suggestionFor(result, "type")).toMatchObject({
      sourceField: "type",
      required: true,
    });
    expect(suggestionFor(result, "status")).toMatchObject({
      sourceField: "status",
      required: true,
    });
    expect(suggestionFor(result, "dueAt")?.confidence).toBe(0.94);
    expect(suggestionFor(result, "weight")?.confidence).toBe(0.94);
    expect(suggestionFor(result, "amount")?.confidence).toBe(1);
  });

  it("maps financial fact samples with conditional-field notes", () => {
    const result = suggestFieldMappings({
      targetType: "FINANCIAL_FACT",
      sample: {
        amount: 5000.25,
        currency: "EUR",
        legal_entity_id: "LE-1",
        order_id: "SO-1",
        contract_ref: "C-9",
        instrument_type: "INVOICE",
        recognition_status: "POSTED",
        accounting_period: "2026-11",
        source_version: "v3",
      },
    });

    expect(result.missingRequiredFields).toEqual([]);
    expect(suggestionFor(result, "amount")).toMatchObject({
      sourceField: "amount",
      confidence: 1,
      required: true,
    });
    expect(suggestionFor(result, "currency")).toMatchObject({
      sourceField: "currency",
      required: true,
    });
    expect(suggestionFor(result, "legalEntityId")).toMatchObject({
      sourceField: "legal_entity_id",
      required: false,
    });
    expect(suggestionFor(result, "legalEntityId")?.reason).toContain(
      "recognitionStatus is POSTED",
    );
    expect(suggestionFor(result, "contractRef")?.sourceField).toBe(
      "contract_ref",
    );
  });

  it("strips source-system wrappers when tokenizing keys", () => {
    const result = suggestFieldMappings({
      targetType: "COMMERCIAL_OPPORTUNITY",
      sample: { "properties.dealstage": "WON" },
    });
    expect(suggestionFor(result, "stage")?.sourceField).toBe(
      "properties.dealstage",
    );
  });

  it("returns empty suggestions for an empty sample and lists required fields", () => {
    const result = suggestFieldMappings({
      targetType: "COMMERCIAL_OPPORTUNITY",
      sample: {},
    });
    expect(result.suggestions).toEqual([]);
    expect(result.unmatchedSourceFields).toEqual([]);
    expect(result.missingRequiredFields).toEqual([
      "externalOpportunityId",
      "externalAccountId",
      "accountName",
      "name",
      "currency",
    ]);
  });

  it("skips incompatible value types instead of guessing", () => {
    const result = suggestFieldMappings({
      targetType: "FINANCIAL_FACT",
      sample: { amount: { nested: 1 }, currency: null },
    });
    expect(result.suggestions).toEqual([]);
    expect(result.unmatchedSourceFields).toEqual(["amount", "currency"]);
    expect(result.missingRequiredFields).toEqual(["amount", "currency"]);
  });

  it("assigns each source and target at most once, deterministically", () => {
    const input = {
      targetType: "WORK_ITEM" as const,
      sample: { key: "K-1", ticket_id: "T-2", id: "WI-1" },
    };
    const before = structuredClone(input);
    const first = suggestFieldMappings(input);
    const second = suggestFieldMappings(input);

    expect(first).toEqual(second);
    expect(input).toEqual(before);
    expect(first.suggestions).toHaveLength(1);
    expect(first.suggestions[0]).toMatchObject({
      sourceField: "id",
      targetField: "externalId",
    });
    expect(first.unmatchedSourceFields).toEqual(["key", "ticket_id"]);
  });
});

describe("detectSyncAnomalies", () => {
  it("returns no anomalies for an empty run list", () => {
    expect(detectSyncAnomalies({ runs: [] })).toEqual({
      runsAnalyzed: 0,
      anomalies: [],
    });
  });

  it("returns no anomalies for clean, balanced runs", () => {
    const result = detectSyncAnomalies({
      runs: [SUCCESS_RUN, SUCCESS_RUN, SUCCESS_RUN, SUCCESS_RUN],
    });
    expect(result.runsAnalyzed).toBe(4);
    expect(result.anomalies).toEqual([]);
  });

  it("flags quarantine rate strictly above 5% only", () => {
    const atThreshold = detectSyncAnomalies({
      runs: [balanced({ fetched: 20, created: 19, quarantined: 1 })],
    });
    expect(atThreshold.anomalies).toEqual([]);

    const aboveThreshold = detectSyncAnomalies({
      runs: [balanced({ fetched: 30, created: 28, quarantined: 2 })],
    });
    expect(aboveThreshold.anomalies).toHaveLength(1);
    expect(aboveThreshold.anomalies[0]).toMatchObject({
      code: "HIGH_QUARANTINE_RATE",
      severity: "HIGH",
      runIndex: 0,
      evidence: { fetched: 30, quarantined: 2, rateBps: 666 },
    });
  });

  it("flags duplicate rate strictly above 50% only", () => {
    const atThreshold = detectSyncAnomalies({
      runs: [balanced({ fetched: 20, created: 10, duplicate: 10 })],
    });
    expect(atThreshold.anomalies).toEqual([]);

    const aboveThreshold = detectSyncAnomalies({
      runs: [balanced({ fetched: 20, created: 9, duplicate: 11 })],
    });
    expect(aboveThreshold.anomalies).toHaveLength(1);
    expect(aboveThreshold.anomalies[0]).toMatchObject({
      code: "HIGH_DUPLICATE_RATE",
      severity: "MEDIUM",
      evidence: { duplicate: 11, rateBps: 5500 },
    });
  });

  it("flags three consecutive failures once per streak", () => {
    const twoFailures = detectSyncAnomalies({
      runs: [
        balanced({ status: "FAILED", failed: 0 }),
        balanced({ status: "FAILED", failed: 0 }),
      ],
    });
    expect(twoFailures.anomalies).toEqual([]);

    const result = detectSyncAnomalies({
      runs: [
        balanced({ status: "FAILED" }),
        balanced({ status: "ERROR" }),
        balanced({ status: "FAILED" }),
        balanced({ status: "FAILED" }),
        SUCCESS_RUN,
      ],
    });
    const failures = result.anomalies.filter(
      (anomaly) => anomaly.code === "CONSECUTIVE_FAILURES",
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      severity: "HIGH",
      runIndex: CONSECUTIVE_FAILURE_THRESHOLD - 1,
      evidence: {
        consecutiveFailures: 3,
        startRunIndex: 0,
        endRunIndex: 2,
      },
    });
  });

  it("does not treat a broken streak as consecutive failures", () => {
    const result = detectSyncAnomalies({
      runs: [
        balanced({ status: "FAILED" }),
        balanced({ status: "FAILED" }),
        SUCCESS_RUN,
        balanced({ status: "FAILED" }),
        balanced({ status: "FAILED" }),
      ],
    });
    expect(
      result.anomalies.filter(
        (anomaly) => anomaly.code === "CONSECUTIVE_FAILURES",
      ),
    ).toEqual([]);
  });

  it("flags fetched surge at 2x the trailing successful average", () => {
    const baseline = [SUCCESS_RUN, SUCCESS_RUN, SUCCESS_RUN];
    const atSurge = detectSyncAnomalies({
      runs: [...baseline, balanced({ fetched: 200, created: 200 })],
    });
    expect(atSurge.anomalies).toHaveLength(1);
    expect(atSurge.anomalies[0]).toMatchObject({
      code: "FETCHED_SURGE",
      severity: "MEDIUM",
      runIndex: 3,
      evidence: { fetched: 200, baselineFetched: 100, baselineRuns: 3 },
    });

    // 199 is below the 2x threshold: no surge.
    const belowSurge = detectSyncAnomalies({
      runs: [...baseline, balanced({ fetched: 199, created: 199 })],
    });
    expect(belowSurge.anomalies).toEqual([]);
  });

  it("flags fetched drop at half the trailing successful average", () => {
    const baseline = [SUCCESS_RUN, SUCCESS_RUN, SUCCESS_RUN];
    const atDrop = detectSyncAnomalies({
      runs: [...baseline, balanced({ fetched: 50, created: 50 })],
    });
    expect(atDrop.anomalies).toHaveLength(1);
    expect(atDrop.anomalies[0]).toMatchObject({
      code: "FETCHED_DROP",
      runIndex: 3,
      evidence: { fetched: 50, baselineFetched: 100, changeBps: -5000 },
    });

    // 51 is above the 0.5x threshold: no drop.
    const aboveDrop = detectSyncAnomalies({
      runs: [...baseline, balanced({ fetched: 51, created: 51 })],
    });
    expect(aboveDrop.anomalies).toEqual([]);
  });

  it("ignores surge/drop when there are fewer than three baseline runs", () => {
    const result = detectSyncAnomalies({
      runs: [
        SUCCESS_RUN,
        SUCCESS_RUN,
        balanced({ fetched: 1000, created: 1000 }),
      ],
    });
    expect(
      result.anomalies.filter(
        (anomaly) =>
          anomaly.code === "FETCHED_SURGE" || anomaly.code === "FETCHED_DROP",
      ),
    ).toEqual([]);
  });

  it("flags unbalanced counters with evidence", () => {
    const result = detectSyncAnomalies({
      runs: [
        balanced({ fetched: 10, created: 6, updated: 2, duplicate: 0 }),
      ],
    });
    expect(result.anomalies).toHaveLength(1);
    expect(result.anomalies[0]).toMatchObject({
      code: "COUNT_IMBALANCE",
      severity: "HIGH",
      evidence: { fetched: 10, countedTotal: 8, mismatch: 2 },
    });
  });

  it("is deterministic for the same run history", () => {
    const runs = [
      SUCCESS_RUN,
      balanced({ fetched: 30, created: 20, quarantined: 10 }),
      balanced({ status: "FAILED" }),
      balanced({ status: "FAILED" }),
      balanced({ status: "FAILED" }),
    ];
    const before = structuredClone(runs);
    expect(detectSyncAnomalies({ runs })).toEqual(
      detectSyncAnomalies({ runs }),
    );
    expect(runs).toEqual(before);
  });
});

describe("explainReconciliation", () => {
  it("returns no explanations for an empty row list", () => {
    expect(explainReconciliation({ rows: [] })).toEqual({
      rowsAnalyzed: 0,
      reported: 0,
      ignoredZeroDelta: 0,
      explanations: [],
    });
  });

  it("skips zero delta rows", () => {
    const result = explainReconciliation({
      rows: [
        { key: "order-1", source: "100.00", target: "100.00", delta: "0" },
        { key: "order-2", source: "7", target: "7", delta: "-0.000000" },
      ],
    });
    expect(result.rowsAnalyzed).toBe(2);
    expect(result.ignoredZeroDelta).toBe(2);
    expect(result.reported).toBe(0);
  });

  it("classifies differences within the rounding tolerance", () => {
    const result = explainReconciliation({
      rows: [
        { key: "invoice-1", source: "100.00", target: "100.01", delta: "0.01" },
        { key: "invoice-2", source: "100", target: "99.995", delta: "-0.005" },
      ],
    });
    expect(result.explanations.map((entry) => entry.classification)).toEqual([
      "ROUNDING",
      "ROUNDING",
    ]);
    expect(result.explanations[0]?.nextStep).toContain("rounding mode");
  });

  it("does not absorb differences above the rounding tolerance", () => {
    const result = explainReconciliation({
      rows: [
        {
          key: "invoice-3",
          source: "100",
          target: "100.010001",
          delta: "0.010001",
        },
      ],
    });
    expect(result.explanations[0]?.classification).toBe("AMOUNT_MISMATCH");
    expect(RECONCILIATION_ROUNDING_TOLERANCE).toBe("0.01");
  });

  it("classifies FX, timing and amount differences with next steps", () => {
    const result = explainReconciliation({
      rows: [
        { key: "invoice_fx_adjustment", source: "1000", target: "1000", delta: "12.5" },
        { key: "period_end_accrual", source: "800", target: "725", delta: "-75" },
        { key: "order_123", source: "500", target: "490.01", delta: "-9.99" },
      ],
    });
    expect(result.explanations.map((entry) => entry.classification)).toEqual([
      "FX",
      "TIMING",
      "AMOUNT_MISMATCH",
    ]);
    for (const entry of result.explanations) {
      expect(entry.nextStep.length).toBeGreaterThan(0);
      expect(entry.explanation.length).toBeGreaterThan(0);
    }
  });

  it("classifies missing sides without recomputing the delta", () => {
    const result = explainReconciliation({
      rows: [
        { key: "orphan-target", source: null, target: "100", delta: "100" },
        { key: "orphan-source", source: "80", target: null, delta: "-80" },
      ],
    });
    expect(result.explanations[0]?.classification).toBe("MISSING_SOURCE");
    expect(result.explanations[0]?.nextStep).toContain("source record");
    expect(result.explanations[1]?.classification).toBe("MISSING_TARGET");
    expect(result.explanations[1]?.nextStep).toContain("target projection");
  });

  it("reports relative deltas in basis points with fixed-point rounding", () => {
    const result = explainReconciliation({
      rows: [{ key: "order_9", source: "1000", target: "1100", delta: "100" }],
    });
    const evidence = result.explanations[0]?.evidence;
    expect(evidence).toEqual({
      source: "1000",
      target: "1100",
      absoluteDelta: "100",
      relativeDeltaBps: 909,
    });
    expect(result.explanations[0]?.delta).toBe("100");
  });

  it("canonicalizes amount formatting deterministically", () => {
    const input = {
      rows: [
        { key: "order-7", source: "100.00", target: "100.50", delta: "0.500000" },
      ],
    };
    const before = structuredClone(input);
    const first = explainReconciliation(input);
    expect(first).toEqual(explainReconciliation(input));
    expect(input).toEqual(before);
    expect(first.explanations[0]?.evidence.source).toBe("100");
    expect(first.explanations[0]?.delta).toBe("0.5");
  });
});

describe("agent-assist routes", () => {
  let app: FastifyInstance;

  function call(
    payload: unknown,
    headers?: Record<string, string>,
    url = "/api/v1/agent-assist/mapping-suggestions",
  ) {
    return app.inject({
      method: "POST",
      url,
      payload: payload as never,
      headers,
    });
  }

  beforeAll(async () => {
    app = buildApp(
      new Store(),
      undefined,
      undefined,
      new MemoryPlatformStore({
        demoTenant: {
          id: "tenant-demo",
          name: "Demo tenant",
          slug: "demo-tenant",
          persons: [],
        },
      }),
    );
  });

  it("returns mapping suggestions without writing anything", async () => {
    const response = await call({
      targetType: "FINANCIAL_FACT",
      sample: { amount: 12.5, currency: "USD" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.meta.correlation_id).toEqual(expect.any(String));
    expect(body.data.targetType).toBe("FINANCIAL_FACT");
    expect(body.data.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceField: "amount",
          targetField: "amount",
          confidence: 1,
          required: true,
        }),
        expect.objectContaining({
          sourceField: "currency",
          targetField: "currency",
          required: true,
        }),
      ]),
    );
    expect(body.data.missingRequiredFields).toEqual([]);
  });

  it("returns sync anomalies and accepts an empty run list", async () => {
    const flagged = await call(
      {
        runs: [
          {
            status: "SUCCEEDED",
            fetched: 10,
            created: 6,
            updated: 2,
            duplicate: 0,
            quarantined: 0,
            failed: 0,
          },
        ],
      },
      undefined,
      "/api/v1/agent-assist/sync-anomalies",
    );
    expect(flagged.statusCode).toBe(200);
    expect(flagged.json().data.anomalies[0].code).toBe("COUNT_IMBALANCE");

    const empty = await call(
      { runs: [] },
      undefined,
      "/api/v1/agent-assist/sync-anomalies",
    );
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data).toEqual({ runsAnalyzed: 0, anomalies: [] });
  });

  it("returns reconciliation explanations and skips zero deltas", async () => {
    const response = await call(
      {
        rows: [
          { key: "order_1", source: "100", target: "100.01", delta: "0.01" },
          { key: "order_2", source: "5", target: "5", delta: "0" },
        ],
      },
      undefined,
      "/api/v1/agent-assist/reconciliation-explain",
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().data.reported).toBe(1);
    expect(response.json().data.ignoredZeroDelta).toBe(1);
    expect(response.json().data.explanations[0].classification).toBe(
      "ROUNDING",
    );

    const empty = await call(
      { rows: [] },
      undefined,
      "/api/v1/agent-assist/reconciliation-explain",
    );
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data.reported).toBe(0);
  });

  it("is independent of the tenant header for pure computations", async () => {
    const payload = {
      targetType: "WORK_ITEM",
      sample: { id: "WI-1", project_id: "PRJ-1", title: "T", type: "STORY", status: "OPEN" },
    };
    const tenantA = await call(payload, { "x-tenant-id": "tenant-a" });
    const tenantB = await call(payload, { "x-tenant-id": "tenant-b" });
    expect(tenantA.statusCode).toBe(200);
    expect(tenantB.statusCode).toBe(200);
    expect(tenantA.json().data).toEqual(tenantB.json().data);
  });

  it("rejects invalid bodies through Zod", async () => {
    const cases: Array<{ payload: unknown; url?: string }> = [
      { payload: { targetType: "UNKNOWN", sample: {} } },
      { payload: { targetType: "WORK_ITEM" } },
      {
        payload: {
          targetType: "WORK_ITEM",
          sample: Object.fromEntries(
            Array.from({ length: 201 }, (_, index) => [`field_${index}`, index]),
          ),
        },
      },
      {
        payload: {
          runs: [
            { status: "SUCCEEDED", fetched: 1, created: 1 },
          ],
        },
        url: "/api/v1/agent-assist/sync-anomalies",
      },
      {
        payload: {
          rows: [{ key: "k", source: null, target: null, delta: "1" }],
        },
        url: "/api/v1/agent-assist/reconciliation-explain",
      },
      {
        payload: {
          rows: [{ key: "k", source: "1", target: "1", delta: "0.1234567" }],
        },
        url: "/api/v1/agent-assist/reconciliation-explain",
      },
      {
        payload: {
          rows: [{ key: "k", source: "1", target: "1" }],
        },
        url: "/api/v1/agent-assist/reconciliation-explain",
      },
    ];
    for (const testCase of cases) {
      const response = await call(
        testCase.payload,
        undefined,
        testCase.url ?? "/api/v1/agent-assist/mapping-suggestions",
      );
      expect(response.statusCode, JSON.stringify(testCase.payload)).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("requires an integration/finance role", async () => {
    const limited = buildApp(
      new Store(),
      undefined,
      new DevHeaderAuthenticator({
        tenantId: "tenant-demo",
        userId: "limited-user",
        roles: ["employee"],
      }),
      new MemoryPlatformStore({
        demoTenant: {
          id: "tenant-demo",
          name: "Demo tenant",
          slug: "demo-tenant",
          persons: [],
        },
      }),
    );
    try {
      const response = await limited.inject({
        method: "POST",
        url: "/api/v1/agent-assist/sync-anomalies",
        payload: { runs: [] },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await limited.close();
    }
  });
});
