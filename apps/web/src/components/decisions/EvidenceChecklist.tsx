/**
 * 证据清单：复核人真实打开过的证据才计入 `evidenceOpened`。
 *
 * 组件只负责展示与触发打开；计数由父组件按「打开过的唯一 evidence id」
 * 维护，避免把「列表渲染数」当成「已打开数」。
 */
import { Badge, Button } from "../ui.js";
import type { EvidenceView } from "../../lib/ops-types.js";

export function EvidenceChecklist({
  evidence,
  openedIds,
  onOpen,
  loading,
}: {
  evidence: EvidenceView[];
  openedIds: string[];
  onOpen: (evidence: EvidenceView) => void;
  loading?: boolean;
}) {
  const opened = new Set(openedIds);
  if (loading) {
    return <p className="muted">加载证据…</p>;
  }
  if (evidence.length === 0) {
    return (
      <p className="muted">
        该人员暂无证据节点。证据数为 0 时 evidenceOpened 保持 0，不会虚报。
      </p>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chip-row" aria-live="polite">
        <span className="chip">证据 {evidence.length} 条</span>
        <span className="chip">已打开 {opened.size} 条</span>
        <span className="muted" style={{ fontSize: 12 }}>
          只有真实打开的证据会写入决定的 evidenceOpened。
        </span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">来源</th>
              <th scope="col">主体</th>
              <th scope="col">质量</th>
              <th scope="col">观测时间</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {evidence.map((node) => {
              const isOpen = opened.has(node.id);
              return (
                <tr key={node.id}>
                  <td>
                    <span className="cell-primary">{node.sourceSystem}</span>
                    <span className="cell-sub">{node.evidenceType}</span>
                  </td>
                  <td className="mono">{node.subjectType}</td>
                  <td>
                    <Badge status={node.qualityStatus} />
                  </td>
                  <td className="nowrap">{node.observedAt}</td>
                  <td className="cell-actions">
                    <Button
                      size="sm"
                      variant={isOpen ? "ghost" : "secondary"}
                      onClick={() => onOpen(node)}
                      aria-label={`${isOpen ? "再次查看" : "打开"}证据 ${node.id}`}
                    >
                      {isOpen ? "已打开" : "打开证据"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
