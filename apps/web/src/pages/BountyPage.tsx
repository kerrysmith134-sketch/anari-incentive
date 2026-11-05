import {
  Badge,
  EmptyState,
  LoadingRows,
  PageHeader,
  Panel,
} from "../components/ui.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";

interface BountyView {
  id: string;
  title: string;
  description: string;
  rewardAmount: string;
  currency: string;
  status: string;
  claimedBy?: string;
  createdBy: string;
}

/** 悬赏任务：认领 → 提交 → 同侪验收 → 发奖，验收人≠领受人。 */
export function BountyPage() {
  useDocumentTitle("悬赏任务");
  const bounties = useApiQuery<BountyView[]>("/api/v1/bounties");
  const bountyList = bounties.data ?? [];

  const statusLabel: Record<string, string> = {
    OPEN: "待认领",
    CLAIMED: "已认领",
    SUBMITTED: "已提交",
    ACCEPTED: "已验收",
    CANCELLED: "已取消",
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="核心业务"
        title="悬赏任务"
        description="发布带奖金的任务，员工认领并提交成果；验收人不能是领受人本人，奖金发放全程留痕。"
      />
      <Panel title="悬赏列表" flush>
        {bounties.loading && bounties.data === undefined ? (
          <LoadingRows rows={4} />
        ) : bountyList.length === 0 ? (
          <EmptyState
            icon="rewards"
            title="暂无悬赏任务"
            description="发布一个悬赏：设定奖金与说明，团队成员即可认领并提交成果。"
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>任务</th>
                <th>奖金</th>
                <th>状态</th>
                <th>领受人</th>
              </tr>
            </thead>
            <tbody>
              {bountyList.map((bounty) => (
                <tr key={bounty.id}>
                  <td>
                    <strong>{bounty.title}</strong>
                    <div className="hint">{bounty.description}</div>
                  </td>
                  <td className="mono">
                    {bounty.rewardAmount} {bounty.currency}
                  </td>
                  <td>
                    <Badge
                      tone={
                        bounty.status === "ACCEPTED"
                          ? "success"
                          : bounty.status === "OPEN"
                            ? "info"
                            : "neutral"
                      }
                    >
                      {statusLabel[bounty.status] ?? bounty.status}
                    </Badge>
                  </td>
                  <td>
                    {bounty.claimedBy ? (
                      <code>{bounty.claimedBy.slice(0, 8)}</code>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
