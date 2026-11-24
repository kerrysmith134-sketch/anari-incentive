import { Badge, Button, EmptyState, ErrorNotice, LoadingRows, Panel } from "../ui.js";
import { formatDate, shortId } from "../../lib/format.js";
import type { RuleChangeOrderView } from "../../lib/ops-types.js";
import type { QueryState } from "../../lib/hooks.js";

export interface RuleChangePanelProps {
  openRuleChange: () => void;
  ruleAction: (order: RuleChangeOrderView, action: "approve" | "reject" | "publicize") => void;
  ruleBusy: string | null;
  ruleChanges: QueryState<RuleChangeOrderView[]>;
}

export function RuleChangePanel({
  openRuleChange,
  ruleAction,
  ruleBusy,
  ruleChanges,
}: RuleChangePanelProps) {
  return (
    <Panel
      title="规则变更单"
      subtitle="草稿 → 批准/驳回 → 公示，带用例门禁"
      flush
      action={
        <Button
          size="sm"
          variant="primary"
          icon="plus"
          onClick={openRuleChange}
        >
          新建变更单
        </Button>
      }
    >
      {ruleChanges.error ? (
        <div style={{ padding: 16 }}>
          <ErrorNotice
            error={ruleChanges.error}
            onRetry={ruleChanges.reload}
          />
        </div>
      ) : ruleChanges.loading ? (
        <div style={{ padding: 16 }}>
          <LoadingRows rows={3} />
        </div>
      ) : (ruleChanges.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="policy"
          title="暂无规则变更单"
          description="规则变更在发布前记录变更前后版本、原因与影响模拟。"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>变更单</th>
                <th>变更</th>
                <th>状态</th>
                <th>生效</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(ruleChanges.data ?? []).map((order) => (
                <tr key={order.id}>
                  <td>
                    <span className="cell-primary">
                      {order.policyCode}
                    </span>
                    <span className="cell-sub mono">
                      {shortId(order.id, 10)}
                    </span>
                  </td>
                  <td>
                    {order.changeType}
                    <span className="cell-sub">
                      {shortId(order.toPolicyVersionId, 10)}
                    </span>
                  </td>
                  <td>
                    <Badge status={order.status} />
                  </td>
                  <td className="nowrap">
                    {formatDate(order.effectiveFrom)}
                  </td>
                  <td className="cell-actions">
                    {order.status === "DRAFT" ? (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          loading={ruleBusy === `approve:${order.id}`}
                          onClick={() =>
                            ruleAction(order, "approve")
                          }
                        >
                          批准
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={ruleBusy === `reject:${order.id}`}
                          onClick={() => ruleAction(order, "reject")}
                        >
                          驳回
                        </Button>
                      </>
                    ) : null}
                    {order.status === "APPROVED" ? (
                      <Button
                        size="sm"
                        variant="primary"
                        loading={ruleBusy === `publicize:${order.id}`}
                        onClick={() =>
                          ruleAction(order, "publicize")
                        }
                      >
                        公示
                      </Button>
                    ) : null}
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
