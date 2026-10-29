export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Record<string, string | number | boolean>;
  /** OTLP status: 0 UNSET, 1 OK, 2 ERROR. */
  statusCode: number;
}

export interface SpanRecorder {
  record(span: TraceSpan): void;
}

export interface OtlpHttpExporterConfig {
  /** Base collector URL or a full `/v1/traces` endpoint. */
  endpoint: string;
  headers?: Record<string, string>;
  serviceName?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  maxBuffer?: number;
  fetchImpl?: typeof fetch;
}

function attributeValue(
  value: string | number | boolean,
): Record<string, unknown> {
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { intValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === "boolean") return { boolValue: value };
  return { stringValue: value };
}

/** Build the OTLP/HTTP JSON payload for a batch of spans. */
export function toOtlpPayload(
  spans: TraceSpan[],
  serviceName: string,
): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: serviceName },
            },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "anari-incentive", version: "0.1.0" },
            spans: spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              parentSpanId: span.parentSpanId,
              name: span.name,
              kind: 2,
              startTimeUnixNano: span.startTimeUnixNano,
              endTimeUnixNano: span.endTimeUnixNano,
              attributes: Object.entries(span.attributes).map(
                ([key, value]) => ({
                  key,
                  value: attributeValue(value),
                }),
              ),
              status: { code: span.statusCode },
            })),
          },
        ],
      },
    ],
  };
}

/**
 * Dependency-free OTLP/HTTP JSON trace exporter. Spans are buffered and
 * flushed on a timer, by batch size, or explicitly on shutdown. Failed
 * exports are re-queued (bounded by `maxBuffer`).
 */
export class OtlpHttpTraceExporter implements SpanRecorder {
  private buffer: TraceSpan[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private flushing?: Promise<void>;

  constructor(private readonly config: OtlpHttpExporterConfig) {}

  record(span: TraceSpan): void {
    this.buffer.push(span);
    const maxBuffer = this.config.maxBuffer ?? 2000;
    if (this.buffer.length > maxBuffer) {
      this.buffer.splice(0, this.buffer.length - maxBuffer);
    }
    this.ensureTimer();
    if (this.buffer.length >= (this.config.batchSize ?? 100)) {
      void this.flush().catch(() => undefined);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    this.flushing = this.send(batch)
      .catch((error) => {
        this.buffer = [...batch, ...this.buffer].slice(
          -1 * (this.config.maxBuffer ?? 2000),
        );
        throw error;
      })
      .finally(() => {
        this.flushing = undefined;
      });
    return this.flushing;
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.flush();
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush().catch(() => undefined);
    }, this.config.flushIntervalMs ?? 5000);
    this.timer.unref?.();
  }

  private async send(spans: TraceSpan[]): Promise<void> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const base = this.config.endpoint.replace(/\/$/, "");
    const url = base.endsWith("/v1/traces")
      ? base
      : `${base}/v1/traces`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.config.headers,
      },
      body: JSON.stringify(
        toOtlpPayload(spans, this.config.serviceName ?? "anari-incentive"),
      ),
    });
    if (!response.ok) {
      throw new Error(`OTLP export failed with ${response.status}`);
    }
  }
}
