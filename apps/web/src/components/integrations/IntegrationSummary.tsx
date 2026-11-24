import type { IntegrationConnection, SyncRun } from "../../lib/types.js";

/**
 * 集成工作台摘要（2026-11-21 审计 UI）：先把“连了多少、多少在跑、
 * 最近失败多少”讲清楚，再进入映射/计划/运行详情。
 */
export function IntegrationSummary({
  connections,
  mappings,
  runs,
}: {
  connections: IntegrationConnection[];
  mappings: number;
  runs: SyncRun[];
}) {
  const active = connections.filter(
    (connection) => connection.status.toUpperCase() === "ACTIVE",
  ).length;
  const failedRuns = runs.filter(
    (run) => run.status.toUpperCase() === "FAILED",
  ).length;
  const connectedProviders = new Set(
    connections.map((connection) => connection.provider),
  ).size;

  return (
    <div className="stat-grid" style={{ marginBottom: 16 }}>
      <div className="stat-tile stat-tile--accent">
        <div className="stat-tile__top">
          <span className="stat-tile__label">已连接来源</span>
        </div>
        <div className="stat-tile__value">{connections.length}</div>
        <div className="stat-tile__detail">
          {connectedProviders} 个 provider / {active} 个启用
        </div>
      </div>
      <div className="stat-tile">
        <div className="stat-tile__top">
          <span className="stat-tile__label">当前连接映射</span>
        </div>
        <div className="stat-tile__value">{mappings}</div>
        <div className="stat-tile__detail">版本化字段映射</div>
      </div>
      <div className="stat-tile stat-tile--warning">
        <div className="stat-tile__top">
          <span className="stat-tile__label">最近同步运行</span>
        </div>
        <div className="stat-tile__value">{runs.length}</div>
        <div className="stat-tile__detail">当前连接最近运行记录</div>
      </div>
      <div className={failedRuns > 0 ? "stat-tile stat-tile--warning" : "stat-tile stat-tile--good"}>
        <div className="stat-tile__top">
          <span className="stat-tile__label">失败运行</span>
        </div>
        <div className="stat-tile__value">{failedRuns}</div>
        <div className="stat-tile__detail">
          {failedRuns > 0 ? "需查看错误摘要与隔离区" : "最近运行无失败"}
        </div>
      </div>
    </div>
  );
}
