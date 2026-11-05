import {
  Badge,
  EmptyState,
  LoadingRows,
  PageHeader,
  Panel,
} from "../components/ui.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";

interface EquityGrantView {
  id: string;
  personId: string;
  grantCode: string;
  grantType: string;
  totalUnits: string;
  strikePrice: string;
  cliffMonths: number;
  vestingMonths: number;
  status: string;
}

/** 期权股权：授予、悬崖归属、行权审批全流程。 */
export function EquityPage() {
  useDocumentTitle("期权股权");
  const grants = useApiQuery<EquityGrantView[]>("/api/v1/equity-grants");
  const grantList = grants.data ?? [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="核心业务"
        title="期权股权"
        description="OPTION / RSU / SAR 授予，悬崖 + 按月归属；行权需审批人≠申请人，归属与可用额度实时可查。"
      />
      <Panel title="授予台账" flush>
        {grants.loading && grants.data === undefined ? (
          <LoadingRows rows={4} />
        ) : grantList.length === 0 ? (
          <EmptyState
            icon="rewards"
            title="暂无授予记录"
            description="为员工创建期权/RSU/SAR 授予后，这里会展示台账、归属进度与行权状态。"
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>授予编号</th>
                <th>对象</th>
                <th>类型</th>
                <th>总量</th>
                <th>悬崖/归属</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {grantList.map((grant) => (
                <tr key={grant.id}>
                  <td>
                    <code>{grant.grantCode}</code>
                  </td>
                  <td>
                    <code>{grant.personId.slice(0, 8)}</code>
                  </td>
                  <td>{grant.grantType}</td>
                  <td className="mono">{grant.totalUnits}</td>
                  <td>
                    {grant.cliffMonths} 个月悬崖 · {grant.vestingMonths} 个月归属
                  </td>
                  <td>
                    <Badge tone="info">{grant.status}</Badge>
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
