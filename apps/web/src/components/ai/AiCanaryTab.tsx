/**
 * AI 保障 · 金丝雀对比 tab：候选 vs 基线评测指标表。
 * 无本地状态；查询由页面容器持有（props 传入）。
 */
import {
  Badge,
  EmptyState,
  ErrorNotice,
  LoadingRows,
  Panel,
} from "../ui.js";
import type { QueryState } from "../../lib/hooks.js";
import { shortId } from "../../lib/format.js";
import type { ModelCanaryRun } from "../../lib/types.js";

export function AiCanaryTab({
  canaries,
}: {
  canaries: QueryState<ModelCanaryRun[]>;
}) {
  return (
    <Panel
      title="金丝雀对比"
      subtitle="供应商/模型切换前的候选 vs 基线评测指标"
      flush
    >
      {canaries.error ? (
        <div style={{ padding: 16 }}>
          <ErrorNotice error={canaries.error} onRetry={canaries.reload} />
        </div>
      ) : canaries.loading ? (
        <div style={{ padding: 16 }}>
          <LoadingRows rows={3} />
        </div>
      ) : (canaries.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="chart"
          title="暂无金丝雀对比"
          description="升级模型或更换供应商前，在同一金标集上对比基线与候选评测。"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>数据集</th>
                <th>基线</th>
                <th>候选</th>
                <th className="cell-num">流量</th>
                <th>结果</th>
                <th>阻断项</th>
              </tr>
            </thead>
            <tbody>
              {canaries.data?.map((canary) => (
                <tr key={canary.id}>
                  <td className="mono">{canary.datasetRef}</td>
                  <td className="mono">
                    {shortId(canary.baselineEvaluationRunId, 10)}
                  </td>
                  <td className="mono">
                    {shortId(canary.candidateEvaluationRunId, 10)}
                  </td>
                  <td className="cell-num">
                    {canary.trafficPercent}%
                  </td>
                  <td>
                    <Badge
                      tone={canary.passed ? "success" : "danger"}
                    >
                      {canary.passed ? "通过" : "已阻断"}
                    </Badge>
                  </td>
                  <td>
                    {canary.blockers.length === 0
                      ? "—"
                      : canary.blockers.join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
