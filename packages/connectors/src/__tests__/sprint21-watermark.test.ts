/**
 * Sprint 2.1 批次 E（INT-206 完整化）：增量 Watermark 拉取。
 *
 * - connector 支持 updatedSinceParam（GET 查询参数）与 updatedSinceBodyKey
 *   （POST body 键）：pull(cursor, updatedSince?) 时注入 watermark 时间戳，
 *   供应商按更新时间过滤，避免全量重扫。
 * - runner 从 checkpoint 读取 watermark 并以 overlapSeconds 回退窗口传入
 *   （重叠防止边界记录丢失）。
 */
import { describe, expect, it, vi } from "vitest";
import { HttpJsonConnector } from "../index.js";

const COLUMNS = {
  sourceRecordId: "id",
  eventType: "event_type",
  subjectType: "subject_type",
  subjectId: "subject_id",
  evidenceType: "=ACTIVITY",
};

function ok(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    headers: new Headers(),
    redirected: false,
    url: "x",
  } as unknown as Response;
}

describe("INT-206: 增量 watermark 拉取", () => {
  it("GET：配置 updatedSinceParam 且传入 updatedSince → 注入查询参数", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
      urls.push(String(input));
      return ok({ records: [] });
    }) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "e1",
      url: "https://provider.example/api",
      updatedSinceParam: "updated_since",
      columns: COLUMNS,
      fetchImpl,
    });
    await connector.pull(null, "2026-11-20T05:00:00Z");
    expect(urls[0]).toContain("updated_since=2026-11-20T05%3A00%3A00Z");
  });

  it("POST：配置 updatedSinceBodyKey → 注入 body 键", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_input: unknown, init?: { body?: string }) => {
      bodies.push(JSON.parse(init!.body!) as Record<string, unknown>);
      return ok({ records: [] });
    }) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "e2",
      url: "https://provider.example/search",
      method: "POST",
      body: { query: "deals" },
      updatedSinceBodyKey: "updated_after",
      columns: COLUMNS,
      fetchImpl,
    });
    await connector.pull(null, "2026-11-20T05:00:00Z");
    expect(bodies[0]!.updated_after).toBe("2026-11-20T05:00:00Z");
    expect(bodies[0]!.query).toBe("deals");
  });

  it("未传 updatedSince 或未配置参数 → 不注入（首次全量）", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
      urls.push(String(input));
      return ok({ records: [] });
    }) as unknown as typeof fetch;
    const connector = new HttpJsonConnector({
      sourceSystem: "e3",
      url: "https://provider.example/api",
      updatedSinceParam: "updated_since",
      columns: COLUMNS,
      fetchImpl,
    });
    await connector.pull(null, undefined);
    expect(urls[0]).not.toContain("updated_since");
  });
});
