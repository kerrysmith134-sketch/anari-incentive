import type { Dispatch, SetStateAction } from "react";
import { Button, EmptyState, ErrorNotice, LoadingRows, Panel } from "../ui.js";
import {
  displayName,
  formatDate,
  formatDateTime,
  shortId,
  titleCase,
} from "../../lib/format.js";
import type { PlatformPerson } from "../../lib/types.js";
import type {
  EmployeeNoticeView,
  NoticeAcknowledgementView,
} from "../../lib/ops-types.js";
import type { QueryState } from "../../lib/hooks.js";

export interface EmployeeNoticePanelProps {
  ackNoticeId: string | null;
  acknowledgements: QueryState<NoticeAcknowledgementView[]>;
  notices: QueryState<EmployeeNoticeView[]>;
  openAck: (notice: EmployeeNoticeView) => void;
  openNotice: () => void;
  people: PlatformPerson[];
  setAckNoticeId: Dispatch<SetStateAction<string | null>>;
}

export function EmployeeNoticePanel({
  ackNoticeId,
  acknowledgements,
  notices,
  openAck,
  openNotice,
  people,
  setAckNoticeId,
}: EmployeeNoticePanelProps) {
  return (
    <>
      <Panel
        title="员工告知"
        subtitle="已发布告知与逐人签收覆盖"
        flush
        action={
          <Button
            size="sm"
            variant="primary"
            icon="plus"
            onClick={openNotice}
          >
            发布告知
          </Button>
        }
      >
        {notices.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={notices.error} onRetry={notices.reload} />
          </div>
        ) : notices.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={3} />
          </div>
        ) : (notices.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="policy"
            title="暂无员工告知"
            description="告知记录了向员工告知的内容、生效时间与签收人。"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>通知</th>
                  <th>类型</th>
                  <th>生效</th>
                  <th>签收</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(notices.data ?? []).map((notice) => (
                  <tr key={notice.id}>
                    <td>
                      <span className="cell-primary">{notice.title}</span>
                      <span className="cell-sub mono">
                        {shortId(notice.id, 10)} · {notice.bodyRef}
                      </span>
                    </td>
                    <td>{titleCase(notice.noticeType)}</td>
                    <td className="nowrap">
                      {formatDate(notice.effectiveFrom)}
                    </td>
                    <td>
                      {notice.acknowledgementRequired
                        ? "必填"
                        : "Not required"}
                    </td>
                    <td className="cell-actions">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openAck(notice)}
                      >
                        记录
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setAckNoticeId(
                            ackNoticeId === notice.id ? null : notice.id,
                          )
                        }
                      >
                        {ackNoticeId === notice.id ? "隐藏" : "Acks"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {ackNoticeId ? (
        <Panel title="告知签收" flush>
          {acknowledgements.error ? (
            <div style={{ padding: 16 }}>
              <ErrorNotice
                error={acknowledgements.error}
                onRetry={acknowledgements.reload}
              />
            </div>
          ) : acknowledgements.loading ? (
            <div style={{ padding: 16 }}>
              <LoadingRows rows={2} />
            </div>
          ) : (acknowledgements.data?.length ?? 0) === 0 ? (
            <p className="muted" style={{ padding: 16 }}>
              本告知尚无签收记录。
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>人员</th>
                    <th>结果</th>
                    <th>已记录</th>
                  </tr>
                </thead>
                <tbody>
                  {(acknowledgements.data ?? []).map((ack) => (
                    <tr key={ack.id}>
                      <td>{displayName(ack.personId, people)}</td>
                      <td>
                        {ack.acknowledgedAt
                          ? "已签收"
                          : ack.declinedAt
                            ? `Declined · ${ack.declineReason ?? ""}`
                            : "待处理"}
                      </td>
                      <td className="nowrap">
                        {formatDateTime(
                          ack.acknowledgedAt ??
                            ack.declinedAt ??
                            ack.createdAt,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}
    </>
  );
}
