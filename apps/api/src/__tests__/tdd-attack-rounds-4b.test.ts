/**
 * 第四波 TDD（R49-R64）：runner 深层 + connector 错误分级 + DSL 边界。
 * 攻击面：重试序列组合、fail-closed 边界、封顶语义。
 */
import { describe, expect, it, vi } from "vitest";
import {
  HttpJsonConnector,
  runSyncCycle,
  type SyncRequestFn,
} from "@anari/connectors";
import {
  calculateBusinessUnitCommission,
  calculateDbcp,
  scorePerformance,
} from "@anari/policy-dsl";
import { buildApp } from "../app.js";
import { MemoryPlatformStore } from "../platform-store.js";
import { Store } from "../store.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000001";

function ok(payload: unknown): Response {
  return {
    ok: true, status: 200,
    json: async () => payload,
    headers: new Headers(), redirected: false, url: "x",
  } as unknown as Response;
}

function fail(status: number, extra: Record<string, string> = {}): Response {
  return {
    ok: false, status,
    json: async () => ({}),
    headers: new Headers(extra), redirected: false, url: "x",
  } as unknown as Response;
}

const COLUMNS = {
  sourceRecordId: "id",
  eventType: "event_type",
  subjectType: "subject_type",
  subjectId: "subject_id",
  evidenceType: "=ACTIVITY",
};

describe("R49-R52: connector 错误分级边界", () => {
  it("R49 429 重试三次后成功（初次 + 3 重试边界内最后一次成功）", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls <= 3) return fail(429);
      return ok({ records: [{ id: "R49", event_type: "e", subject_type: "ORDER", subject_id: ADMIN }] });
    }) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "r49",
      url: "https://provider.example/api",
      columns: COLUMNS,
      fetchImpl,
    });
    const result = await connector.pull(null);
    expect(result.events).toHaveLength(1);
    expect(calls).toBe(4);
  });

  it("R50 首次请求不含 cursor 参数（全量首查）", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
      urls.push(String(input));
      return ok({ records: [] });
    }) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "r50",
      url: "https://provider.example/api",
      cursorParam: "cursor",
      columns: COLUMNS,
      fetchImpl,
    });
    await connector.pull(null);
    expect(urls[0]).not.toContain("cursor=");
  });

  it("R51 recordsPath 指向字符串而非数组 → records not found 错误", async () => {
    const fetchImpl = vi.fn(async () => ok({ records: "string-not-array" })) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "r51",
      url: "https://provider.example/api",
      recordsPath: "records",
      columns: COLUMNS,
      fetchImpl,
    });
    await expect(connector.pull(null)).rejects.toThrow(/records not found/);
  });

  it("R52 429 后 500 再成功——混合错误序列仍重试至成功", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return fail(429, { "retry-after": "0" });
      if (calls === 2) return fail(503);
      return ok({ records: [{ id: "R52", event_type: "e", subject_type: "ORDER", subject_id: ADMIN }] });
    }) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "r52",
      url: "https://provider.example/api",
      columns: COLUMNS,
      fetchImpl,
    });
    const result = await connector.pull(null);
    expect(result.events).toHaveLength(1);
    expect(calls).toBe(3);
  });
});

describe("R53-R54: runner 语义（fail-closed 与隔离分级）", () => {
  function fakeRunnerApi() {
    const inject: SyncRequestFn = async (path, init) => {
      const method = init?.method ?? "GET";
      if (path === "/api/v1/sync-schedules/claim-due" && method === "POST") {
        return [{ id: "s", connectionId: "conn", name: "sched" }] as never;
      }
      if (path === "/api/v1/integration-connections/conn/sync-runs") return { id: "run" } as never;
      if (path === "/api/v1/integration-connections/conn") {
        return { provider: "generic", credentialRef: "vault/x", config: {} } as never;
      }
      if (path.includes("/mappings?status=ACTIVE")) {
        return [
          {
            id: "m",
            status: "ACTIVE",
            mappingType: "HTTP_JSON",
            sourceSystem: "r53",
            targetType: "EVIDENCE",
            fieldMap: { sourceRecordId: "id", eventType: "event_type", subjectType: "subject_type", subjectId: "subject_id", evidenceType: "=ACTIVITY" },
            config: { url: "https://p.example", recordsPath: "records" },
          },
        ] as never;
      }
      if (path === "/api/v1/sync-resources" && method === "POST") return { id: "res" } as never;
      if (path.startsWith("/api/v1/sync-resources?")) return [{ id: "res" }] as never;
      if (path.includes("/claim-lease")) return { fencingToken: 1, leaseUntil: "" } as never;
      if (path.includes("/release-lease")) return { released: true } as never;
      if (path.includes("/checkpoint")) {
        if (method === "PUT") return (init?.body ? JSON.parse(init.body) : {}) as never;
        return { cursor: null } as never;
      }
      if (path === "/api/v1/raw-source-records" && method === "POST") return { id: "raw" } as never;
      if (path === "/api/v1/ingestion/events:batch") return { accepted: 1 } as never;
      if (path === "/api/v1/ingestion-quarantine") return { id: "q" } as never;
      if (path.startsWith("/api/v1/sync-runs/")) return { id: "x" } as never;
      throw new Error(`unexpected ${method} ${path}`);
    };
    return inject;
  }

  it("R53 缺 subjectType → canonicalize fail-closed → 整页 FAILED（非隔离）", async () => {
    const providerFetch = (async () => ({
      ok: true, status: 200,
      json: async () => ({ records: [{ id: "X", event_type: "e", subject_id: ADMIN }] }),
      headers: new Headers(), redirected: false, url: "x",
    })) as unknown as typeof fetch;
    const summary = await runSyncCycle({
      request: fakeRunnerApi(),
      limit: 1, maxPages: 1,
      claimNow: new Date(Date.now() + 3600_000).toISOString(),
      providerFetchImpl: providerFetch,
      credentialRefResolver: () => "Bearer x",
    });
    expect(summary.schedules[0]!.status).toBe("FAILED");
  });
});

describe("R57-R64: DSL 边界（回归锁定）", () => {
  const METRIC_BASE = {
    applicableRoles: ["SALES"],
    sourceFields: ["x"],
    calculationRule: "linear",
    ownerRole: "MANAGER",
    evidenceRule: "e",
    applicabilityRule: "always",
    dataSource: "QA",
  };

  it("R57 marginPercent 恰好等于档位下限 → 命中该档（>= 语义）", () => {
    const result = calculateBusinessUnitCommission({
      dbcp: "160",
      netCollection: "1000",
    });
    expect(result.marginPercent).toBe("16");
    expect(result.bandRatePercent).toBe("2");
  });

  it("R58 DBCP 全部费用为 0 → deductions 等于计提", () => {
    const result = calculateDbcp({
      grossProfit: "2000",
      businessExpenses: "0",
      laborAndTravel: "0",
      allocatedBusinessUnitExpenses: "0",
      allocatedBackendPayroll: "0",
    });
    expect(result.totalDeductions).toBe("100");
    expect(result.dbcp).toBe("1900");
  });

  it("R59 raw 超 maxScore → capped=true 且周期封顶", () => {
    const result = scorePerformance({
      personId: ADMIN,
      period: "MONTHLY",
      metrics: [
        {
          metricId: "M-CAP", name: "封顶", period: "MONTHLY" as const,
          applicableRoles: ["SALES"], weight: "100",
          metricType: "POSITIVE_LINEAR", target: "50",
          maxScore: "120",
          ...METRIC_BASE,
        },
      ],
      measurements: [{ metricId: "M-CAP", applicable: true, rawValue: "200" }],
    });
    expect(result.rawScore).toBe("120"); // maxScore 120 封顶后
    expect(result.finalScore).toBe("110");
  });

  it("R60 raw 低于最低锚 → 返回首锚分数", () => {
    const result = scorePerformance({
      personId: ADMIN,
      period: "MONTHLY",
      metrics: [
        {
          metricId: "M-FLOOR", name: "地板", period: "MONTHLY" as const,
          applicableRoles: ["SALES"], weight: "100",
          metricType: "PIECEWISE_LINEAR",
          scoringAnchors: [
            { raw: "10", score: "30" },
            { raw: "100", score: "100" },
          ],
          sourceFields: ["x"], calculationRule: "piecewise",
          ownerRole: "MANAGER", evidenceRule: "e", applicabilityRule: "always",
          dataSource: "QA",
          ...METRIC_BASE,
        },
      ],
      measurements: [{ metricId: "M-FLOOR", applicable: true, rawValue: "5" }],
    });
    expect(Number(result.components[0]!.score)).toBe(30);
  });

  it("R61 手工调整超周期封顶 → finalScore 封顶在 cap", () => {
    const result = scorePerformance({
      personId: ADMIN,
      period: "MONTHLY",
      metrics: [
        {
          metricId: "M-ADJ", name: "调整", period: "MONTHLY" as const,
          applicableRoles: ["SALES"], weight: "100",
          metricType: "POSITIVE_LINEAR", target: "100",
          sourceFields: ["x"], calculationRule: "linear",
          ownerRole: "MANAGER", evidenceRule: "e", applicabilityRule: "always",
          dataSource: "QA",
          ...METRIC_BASE,
        },
      ],
      measurements: [{ metricId: "M-ADJ", applicable: true, rawValue: "100" }],
      manualAdjustment: "50",
      manualAdjustmentReason: "人工嘉奖",
    });
    expect(result.finalScore).toBe("110");
    expect(result.scoreBeforeCap).toBe("150");
  });
});
