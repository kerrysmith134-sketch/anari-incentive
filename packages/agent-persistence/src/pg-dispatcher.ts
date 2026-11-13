import type { Pool } from "pg";
import type { AgentRuntime } from "@anari/agent-runtime";

/**
 * NPV2-022：多租户 Worker Dispatcher。
 *
 * 用数据库队列按 tenant 公平领取任务：
 * - 先用平台事务（NPV2-002 的事务本地提升）发现有待领任务的租户；
 * - 再按轮转（round-robin）顺序逐租户用该租户自己的 runtime 领取执行，
 *   每租户每轮最多 perTenantBatch 个——单租户刷屏不会饿死其他租户；
 * - 任务执行绑定租户上下文（runtime/repository 均按租户惰性创建），
 *   不会串租户。
 */
export interface MultiTenantDispatcherOptions {
  pool: Pool;
  /** 按租户构造（或返回缓存的）runtime；执行绑定该租户上下文。 */
  runtimeFactory: (tenantId: string) => AgentRuntime;
  workerId: string;
  /** 租约时长毫秒（透传 claim）。 */
  leaseMs?: number;
  /** 每租户每轮最多领取任务数（限流公平）。 */
  perTenantBatch?: number;
}

export interface DispatchRoundResult {
  /** 本轮实际执行的任务数（按租户）。 */
  perTenant: Record<string, number>;
  total: number;
}

export class MultiTenantAgentDispatcher {
  private readonly pool: Pool;
  private readonly runtimeFactory: (tenantId: string) => AgentRuntime;
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly perTenantBatch: number;
  private readonly runtimes = new Map<string, AgentRuntime>();
  private cursor = 0;
  private running = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(options: MultiTenantDispatcherOptions) {
    this.pool = options.pool;
    this.runtimeFactory = options.runtimeFactory;
    this.workerId = options.workerId;
    this.leaseMs = options.leaseMs ?? 300_000;
    this.perTenantBatch = options.perTenantBatch ?? 1;
  }

  /**
   * 枚举租户（tenants 表无 RLS，普通连接可读）。就绪过滤交给逐租户
   * claim——agent_tasks 的 RLS 策略不含 platform_admin 旁路（007），
   * 跨租户直查行不通，逐租户设置上下文才是合规路径。
   */
  async listTenantIds(): Promise<string[]> {
    const { rows } = await this.pool.query("SELECT id FROM tenants ORDER BY id");
    return rows.map((row: { id: string }) => row.id);
  }

  /** 按租户惰性创建 runtime（执行绑定该租户上下文，不串租户）。 */
  runtimeFor(tenantId: string): AgentRuntime {
    let runtime = this.runtimes.get(tenantId);
    if (!runtime) {
      runtime = this.runtimeFactory(tenantId);
      this.runtimes.set(tenantId, runtime);
    }
    return runtime;
  }

  /**
   * 一轮公平分发：轮转起点自上次游标继续，每租户最多 perTenantBatch 个。
   * 返回本轮各租户实际执行的任务数。
   */
  async dispatchOnce(): Promise<DispatchRoundResult> {
    // 每轮用全新 runtime 实例：claim 在 DB 已递增版本，缓存的旧副本会让
    // 后续 persist 触发 CAS 冲突；重建后 ensureLoaded 拉到最新状态。
    this.runtimes.clear();
    const tenants = await this.listTenantIds();
    const perTenant: Record<string, number> = {};
    let total = 0;
    if (tenants.length === 0) return { perTenant, total };

    // 限流公平：从游标处轮转，而不是每次都从第一个租户开始。
    const ordered = [
      ...tenants.slice(this.cursor % tenants.length),
      ...tenants.slice(0, this.cursor % tenants.length),
    ];
    for (const tenantId of ordered) {
      const runtime = this.runtimeFor(tenantId);
      let claimed = 0;
      for (let k = 0; k < this.perTenantBatch; k += 1) {
        const task = await runtime.claimNextReadyTask({
          workerId: this.workerId,
          leaseMs: this.leaseMs,
        });
        if (!task) break;
        await runtime.run(task.id);
        await runtime.releaseTaskLease({
          taskId: task.id,
          workerId: this.workerId,
        });
        claimed += 1;
        total += 1;
      }
      if (claimed > 0) perTenant[tenantId] = claimed;
    }
    this.cursor = (this.cursor + tenants.length) % Math.max(tenants.length, 1);
    return { perTenant, total };
  }

  /** 周期轮询；返回 stop 句柄语义（clearInterval）。 */
  start(intervalMs: number): void {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      try {
        await this.dispatchOnce();
      } catch (error) {
        console.error("[multi-tenant-dispatcher] round failed", error);
      }
    };
    void tick();
    this.timer = setInterval(tick, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.running = false;
  }
}
