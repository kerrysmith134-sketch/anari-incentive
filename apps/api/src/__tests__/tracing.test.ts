import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { Store } from "../store.js";
import {
  OtlpHttpTraceExporter,
  type SpanRecorder,
  type TraceSpan,
} from "../tracing.js";

const span: TraceSpan = {
  traceId: "a".repeat(32),
  spanId: "b".repeat(16),
  name: "POST /api/v1/test",
  startTimeUnixNano: "1767225600000000000",
  endTimeUnixNano: "1767225601000000000",
  attributes: { "http.status_code": 200, safe: true },
  statusCode: 1,
};

describe("OTLP tracing", () => {
  it("posts OTLP JSON to the collector", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const exporter = new OtlpHttpTraceExporter({
      endpoint: "http://collector:4318",
      headers: { authorization: "Bearer collector-token" },
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    exporter.record(span);
    await exporter.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://collector:4318/v1/traces");
    const body = JSON.parse(String(calls[0]!.init?.body)) as {
      resourceSpans: Array<{
        scopeSpans: Array<{ spans: Array<{ traceId: string }> }>;
      }>;
    };
    expect(
      body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.traceId,
    ).toBe(span.traceId);
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer collector-token");
    await exporter.close();
  });

  it("requeues spans when an export fails", async () => {
    let calls = 0;
    const exporter = new OtlpHttpTraceExporter({
      endpoint: "http://collector:4318/v1/traces",
      fetchImpl: (async () => {
        calls += 1;
        return new Response("", { status: calls === 1 ? 500 : 200 });
      }) as typeof fetch,
    });
    exporter.record(span);
    await expect(exporter.flush()).rejects.toThrow(
      "OTLP export failed with 500",
    );
    await exporter.flush();
    expect(calls).toBe(2);
    await exporter.close();
  });

  it("records a span for each request", async () => {
    const spans: TraceSpan[] = [];
    const recorder: SpanRecorder = {
      record: (recorded) => spans.push(recorded),
    };
    const app = buildApp(
      new Store(),
      undefined,
      undefined,
      undefined,
      { tracer: recorder },
    );
    const response = await app.inject({
      method: "GET",
      url: "/health",
    } as never);
    expect(response.statusCode).toBe(200);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("GET /health");
    expect(spans[0]!.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(spans[0]!.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(spans[0]!.statusCode).toBe(1);
    expect(spans[0]!.attributes["http.status_code"]).toBe(200);
  });

  it("correlates spans with tenant, person, cycle and policy", async () => {
    const OWNER = "00000000-0000-4000-8000-000000000001";
    const CYCLE = "00000000-0000-4000-8000-000000000020";
    const POLICY = "00000000-0000-4000-8000-000000000100";
    const spans: TraceSpan[] = [];
    const recorder: SpanRecorder = {
      record: (recorded) => spans.push(recorded),
    };
    const app = buildApp(
      new Store(),
      undefined,
      {
        async authenticate() {
          return {
            tenantId: "tenant-demo",
            userId: "trace-user",
            personId: OWNER,
            roles: ["admin"],
          };
        },
      },
      undefined,
      { tracer: recorder },
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/work-packages",
      payload: {
        title: "Trace target",
        objective: "Check span correlation",
        ownerPersonId: OWNER,
        members: [
          {
            personId: OWNER,
            responsibilityCode: "OWNER",
            expectedOutput: "Delivery",
          },
        ],
        acceptanceCriteria: ["Accepted"],
        cycleId: CYCLE,
        policyVersionId: POLICY,
      },
    } as never);
    expect(response.statusCode).toBe(201);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes["tenant.id"]).toBe("tenant-demo");
    expect(spans[0]!.attributes["person.id"]).toBe(OWNER);
    expect(spans[0]!.attributes["cycle.id"]).toBe(CYCLE);
    expect(spans[0]!.attributes["policy.version_id"]).toBe(POLICY);
  });
});
