import type { Dispatch, SetStateAction } from "react";
import { Button, EmptyState, ErrorNotice, LoadingRows, Panel } from "../ui.js";
import { formatDateTime, shortId } from "../../lib/format.js";
import type { EmployeeNoticeView, PolicyNoticeLinkView } from "../../lib/ops-types.js";
import type { QueryState } from "../../lib/hooks.js";

export interface PolicyNoticeLinkPanelProps {
  notices: QueryState<EmployeeNoticeView[]>;
  policyNotices: QueryState<PolicyNoticeLinkView[]>;
  selectedId: string | null;
  setLinkError: Dispatch<SetStateAction<string | null>>;
  setLinkNoticeId: Dispatch<SetStateAction<string>>;
  setLinkOpen: Dispatch<SetStateAction<boolean>>;
  setLinkPolicyVersionId: Dispatch<SetStateAction<string>>;
}

export function PolicyNoticeLinkPanel({
  notices,
  policyNotices,
  selectedId,
  setLinkError,
  setLinkNoticeId,
  setLinkOpen,
  setLinkPolicyVersionId,
}: PolicyNoticeLinkPanelProps) {
  return (
    <Panel
      title="政策-告知关联"
      subtitle="将告知绑定到政策版本以纳入就绪度覆盖"
      flush
      action={
        <Button
          size="sm"
          variant="secondary"
          icon="plus"
          onClick={() => {
            setLinkPolicyVersionId(selectedId ?? "");
            setLinkNoticeId((notices.data ?? [])[0]?.id ?? "");
            setLinkError(null);
            setLinkOpen(true);
          }}
        >
          关联告知
        </Button>
      }
    >
      {policyNotices.error ? (
        <div style={{ padding: 16 }}>
          <ErrorNotice
            error={policyNotices.error}
            onRetry={policyNotices.reload}
          />
        </div>
      ) : policyNotices.loading ? (
        <div style={{ padding: 16 }}>
          <LoadingRows rows={2} />
        </div>
      ) : (policyNotices.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="policy"
          title="暂无关联告知"
          description="政策就绪度会校验关联通知的签收覆盖。"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>政策版本</th>
                <th>通知</th>
                <th>已关联</th>
              </tr>
            </thead>
            <tbody>
              {(policyNotices.data ?? []).map((link) => (
                <tr key={link.id}>
                  <td className="mono">
                    {shortId(link.policyVersionId, 10)}
                  </td>
                  <td>
                    {notices.data?.find(
                      (notice) => notice.id === link.noticeId,
                    )?.title ?? shortId(link.noticeId, 10)}
                  </td>
                  <td className="nowrap">
                    {formatDateTime(link.createdAt)}
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
