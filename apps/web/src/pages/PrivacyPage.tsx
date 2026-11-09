import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  InfoNotice,
  PageHeader,
  Panel,
  Select,
} from "../components/ui.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api, downloadJson } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { formatDate } from "../lib/format.js";

interface DsarView {
  id: string;
  requestType: string;
  status: string;
  dueAt?: string;
  createdAt: string;
}

/** 员工隐私中心：本人数据包、字段用途/保留期与数据主体请求。 */
export function PrivacyPage() {
  useDocumentTitle("隐私与数据");
  const toast = useToast();
  const dsars = useApiQuery<DsarView[]>("/api/v1/dsar-requests");
  const [requestType, setRequestType] = useState("ACCESS");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadPackage() {
    setBusy(true);
    setError(null);
    try {
      const payload = await api<Record<string, unknown>>(
        "/api/v1/me/data-package",
      );
      downloadJson(payload, `my-data-package-${new Date().toISOString().slice(0, 10)}.json`);
      toast.success("数据包已下载", "包含本人已知的绩效、证据、确认与通知记录");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "下载失败");
    } finally {
      setBusy(false);
    }
  }

  async function createRequest(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api("/api/v1/dsar-requests", {
        method: "POST",
        body: { requestType },
      });
      toast.success("请求已提交", "HR/法务将在时限内处理");
      dsars.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "提交失败");
    }
  }

  const list = dsars.data ?? [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="员工自助"
        title="隐私与数据"
        description="查看本人被采集的字段与用途、下载个人数据包，并提交查询/更正/删除/说明/异议请求。"
      />
      <div className="stack">
        <Panel
          title="我的数据包"
          subtitle="只包含本人可见的绩效、证据、计算、确认、通知与授权记录"
        >
          <Button onClick={downloadPackage} loading={busy}>
            下载我的数据包
          </Button>
          {error ? <InfoNotice tone="warning">{error}</InfoNotice> : null}
          <InfoNotice tone="info">
            数据包会记录导出水印与哈希；如包含敏感字段，导出会触发 DLP 审计。字段用途与保留期以租户数据地图登记为准。
          </InfoNotice>
        </Panel>

        <Panel title="提交数据主体请求">
          <form onSubmit={createRequest}>
            <div className="form-grid">
              <FormField label="请求类型">
                <Select
                  value={requestType}
                  onChange={(event) => setRequestType(event.target.value)}
                >
                  <option value="ACCESS">查询本人数据</option>
                  <option value="CORRECTION">更正数据</option>
                  <option value="DELETION">删除数据</option>
                  <option value="EXPLANATION">要求说明自动化决策</option>
                  <option value="OBJECTION">提出异议</option>
                </Select>
              </FormField>
            </div>
            <div className="form-actions">
              <Button type="submit">提交请求</Button>
            </div>
          </form>
        </Panel>

        <Panel title="我的请求" flush>
          {list.length === 0 ? (
            <EmptyState
              icon="lock"
              title="暂无数据请求"
              description="提交后会显示处理状态与截止日期。"
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>类型</th>
                  <th>状态</th>
                  <th>提交时间</th>
                  <th>截止</th>
                </tr>
              </thead>
              <tbody>
                {list.map((request) => (
                  <tr key={request.id}>
                    <td>{request.requestType}</td>
                    <td><Badge status={request.status} /></td>
                    <td>{formatDate(request.createdAt)}</td>
                    <td>{request.dueAt ? formatDate(request.dueAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
