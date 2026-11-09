import { useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  LoadingRows,
  PageHeader,
  Panel,
  Select,
} from "../components/ui.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { api } from "../lib/api.js";
import { formatDateTime } from "../lib/format.js";

interface NotificationView {
  id: string;
  title: string;
  body: string;
  audience?: string;
  sourceType?: string;
  sourceId?: string;
  readAt?: string;
  createdAt: string;
}

/** 员工通知中心：列表 / 筛选 / 已读。仅本人通知。 */
export function NotificationsPage() {
  useDocumentTitle("通知中心");
  const notifications = useApiQuery<NotificationView[]>(
    "/api/v1/notifications",
  );
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const list = notifications.data ?? [];
  const filtered =
    filter === "unread" ? list.filter((item) => !item.readAt) : list;

  async function markRead(id: string) {
    try {
      await api(`/api/v1/notifications/${id}/read`, { method: "POST" });
      notifications.reload();
    } catch {
      notifications.reload();
    }
  }

  async function markAllRead() {
    try {
      await api("/api/v1/notifications/read-all", { method: "POST" });
    } catch {
      // 失败时仍刷新以展示真实状态
    }
    notifications.reload();
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="自助服务"
        title="通知中心"
        description="只显示发给本人的通知：提醒、审批结果与结算事件。"
        actions={
          <Button variant="secondary" onClick={() => notifications.reload()}>
            刷新
          </Button>
        }
      />
      <Panel
        title="通知列表"
        subtitle={(() => {
          const unread = filtered.filter((item) => !item.readAt).length;
          return unread > 0 ? `${unread} 条未读` : "全部已读";
        })()}
        action={
          <div className="row-actions">
            <Select
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as "all" | "unread")
              }
              aria-label="筛选通知"
            >
              <option value="all">全部</option>
              <option value="unread">仅未读</option>
            </Select>
            <Button variant="secondary" onClick={() => void markAllRead()}>
              全部已读
            </Button>
          </div>
        }
        flush
      >
        {notifications.loading && notifications.data === undefined ? (
          <LoadingRows rows={4} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="approvals"
            title="暂无通知"
            description="发给你的提醒、审批结果与结算事件会出现在这里。"
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>标题</th>
                <th>时间</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.title}</strong>
                    <div className="hint">{item.body}</div>
                  </td>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>
                    <Badge tone={item.readAt ? "neutral" : "info"}>
                      {item.readAt ? "已读" : "未读"}
                    </Badge>
                  </td>
                  <td className="cell-actions">
                    {item.readAt ? null : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void markRead(item.id)}
                      >
                        标记已读
                      </Button>
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
