/**
 * Minimal dependency-free Prometheus metrics.
 *
 * Route labels use the registered route pattern (e.g. `/api/v1/work-packages/:id`)
 * rather than the raw URL, so cardinality stays bounded.
 */
interface Series {
  method: string;
  route: string;
  status: string;
  count: number;
  durationMsSum: number;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export class ApiMetrics {
  private readonly series = new Map<string, Series>();
  private readonly events = new Map<string, number>();
  /** NPV2-033：实时 gauge（agent task / outbox / db pool），每次 scrape 覆盖。 */
  private readonly gauges = new Map<string, number>();
  private readonly startedAt = Date.now();

  increment(event: string, amount = 1): void {
    this.events.set(event, (this.events.get(event) ?? 0) + amount);
  }

  /** NPV2-033：设置 gauge 值（覆盖语义）。 */
  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  observeRequest(
    method: string,
    route: string,
    status: number | string,
    durationMs: number,
  ): void {
    const key = `${method}|${route}|${status}`;
    const existing = this.series.get(key);
    if (existing) {
      existing.count += 1;
      existing.durationMsSum += durationMs;
      return;
    }
    this.series.set(key, {
      method,
      route,
      status: String(status),
      count: 1,
      durationMsSum: durationMs,
    });
  }

  render(): string {
    const lines: string[] = [
      "# HELP n_perform_http_requests_total HTTP requests by route and status.",
      "# TYPE n_perform_http_requests_total counter",
    ];
    for (const series of this.series.values()) {
      lines.push(
        `n_perform_http_requests_total{method="${escapeLabel(
          series.method,
        )}",route="${escapeLabel(series.route)}",status="${escapeLabel(
          series.status,
        )}"} ${series.count}`,
      );
    }
    lines.push(
      "# HELP n_perform_http_request_duration_ms_sum Cumulative request duration in milliseconds.",
      "# TYPE n_perform_http_request_duration_ms_sum counter",
    );
    for (const series of this.series.values()) {
      lines.push(
        `n_perform_http_request_duration_ms_sum{method="${escapeLabel(
          series.method,
        )}",route="${escapeLabel(series.route)}",status="${escapeLabel(
          series.status,
        )}"} ${series.durationMsSum.toFixed(3)}`,
      );
    }
    lines.push(
      "# HELP n_perform_http_request_duration_ms_count Number of timed requests.",
      "# TYPE n_perform_http_request_duration_ms_count counter",
    );
    for (const series of this.series.values()) {
      lines.push(
        `n_perform_http_request_duration_ms_count{method="${escapeLabel(
          series.method,
        )}",route="${escapeLabel(series.route)}",status="${escapeLabel(
          series.status,
        )}"} ${series.count}`,
      );
    }
    lines.push(
      "# HELP n_perform_business_events_total Business events by name.",
      "# TYPE n_perform_business_events_total counter",
    );
    for (const [event, count] of this.events) {
      lines.push(
        `n_perform_business_events_total{event="${escapeLabel(event)}"} ${count}`,
      );
    }
    // NPV2-033：实时 gauge（agent task 状态 / outbox 积压 / db pool）。
    const gaugeHelp: Record<string, string> = {
      n_perform_agent_tasks: "Agent tasks by status.",
      n_perform_outbox_backlog: "Unpublished outbox events.",
      n_perform_outbox_oldest_age_ms: "Age of the oldest unpublished outbox event in ms.",
      n_perform_db_pool_total: "DB pool total connections.",
      n_perform_db_pool_idle: "DB pool idle connections.",
      n_perform_db_pool_waiting: "DB pool waiting requests.",
    };
    for (const [name, value] of this.gauges) {
      lines.push(
        `# HELP ${name} ${gaugeHelp[name] ?? name}`,
        `# TYPE ${name} gauge`,
        `${name} ${value}`,
      );
    }
    lines.push(
      "# HELP n_perform_process_uptime_seconds Process uptime.",
      "# TYPE n_perform_process_uptime_seconds gauge",
      `n_perform_process_uptime_seconds ${(
        (Date.now() - this.startedAt) /
        1000
      ).toFixed(3)}`,
      "# HELP n_perform_process_heap_used_bytes Heap used.",
      "# TYPE n_perform_process_heap_used_bytes gauge",
      `n_perform_process_heap_used_bytes ${process.memoryUsage().heapUsed}`,
    );
    return lines.join("\n") + "\n";
  }
}
