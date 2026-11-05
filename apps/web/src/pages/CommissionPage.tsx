import { useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  LoadingRows,
  PageHeader,
  Panel,
} from "../components/ui.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";

interface CalculationRunView {
  id: string;
  cycleId: string;
  mode: string;
  status: string;
  resultHash?: string;
  blockers?: string[];
  createdAt: string;
  lines?: Array<{
    personId: string;
    incentiveType: string;
    amount?: string;
  }>;
}

interface SettlementBatchView {
  id: string;
  batchNo: string;
  status: string;
  totalAmount: string;
  currency: string;
  kind: string;
}

/** 奖金提成：确定性计算 → 审批 → 锁定 → 结算，全程留痕。 */
export function CommissionPage() {
  useDocumentTitle("奖金提成");
  const runs = useApiQuery<CalculationRunView[]>("/api/v1/calculation-runs");
  const batches = useApiQuery<SettlementBatchView[]>(
    "/api/v1/settlement-batches",
  );
  const [tab, setTab] = useState("runs");
  const runList = runs.data ?? [];
  const batchList = batches.data ?? [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="核心业务"
        title="奖金提成"
        description="同一输入 + 同一政策 = 同一结果哈希。计算结果须人工审批、全员确认后才能锁定进账本，LLM 永远不写金额。"
      />
      <div className="row-actions section-gap">
        {[
          { id: "runs", label: `计算批次 (${runList.length})` },
          { id: "settlements", label: `结算批次 (${batchList.length})` },
        ].map((entry) => (
          <Button
            key={entry.id}
            variant={tab === entry.id ? "primary" : "secondary"}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      {tab === "runs" ? (
        <Panel title="提成计算批次" flush>
          {runs.loading && runs.data === undefined ? (
            <LoadingRows rows={4} />
          ) : runList.length === 0 ? (
            <EmptyState
              icon="clock"
              title="还没有计算批次"
              description="先在「考核周期」创建周期并录入订单，然后发起影子（SHADOW）或正式（FORMAL）计算。"
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>批次</th>
                  <th>模式</th>
                  <th>状态</th>
                  <th>金额（可见范围）</th>
                  <th>结果哈希</th>
                </tr>
              </thead>
              <tbody>
                {runList.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <code>{run.id.slice(0, 8)}</code>
                    </td>
                    <td>
                      <Badge tone={run.mode === "FORMAL" ? "info" : "neutral"}>
                        {run.mode === "FORMAL" ? "正式" : "影子"}
                      </Badge>
                    </td>
                    <td>
                      <Badge
                        tone={
                          run.status === "LOCKED"
                            ? "success"
                            : run.status === "BLOCKED"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {run.status}
                      </Badge>
                    </td>
                    <td className="mono">
                      {run.lines?.length ?? 0} 行
                    </td>
                    <td>
                      <code>{run.resultHash?.slice(0, 12) ?? "—"}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ) : null}

      {tab === "settlements" ? (
        <Panel title="结算批次" flush>
          {batches.loading && batches.data === undefined ? (
            <LoadingRows rows={4} />
          ) : batchList.length === 0 ? (
            <EmptyState
              icon="wallet"
              title="暂无结算批次"
              description="锁定账本后按周期生成结算批次，导出 CSV 前需财务审批。"
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>批次号</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>总额</th>
                </tr>
              </thead>
              <tbody>
                {batchList.map((batch) => (
                  <tr key={batch.id}>
                    <td>
                      <code>{batch.batchNo}</code>
                    </td>
                    <td>{batch.kind === "RECOVERY" ? "追回" : "标准"}</td>
                    <td>
                      <Badge tone="neutral">{batch.status}</Badge>
                    </td>
                    <td className="mono">
                      {batch.totalAmount} {batch.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
