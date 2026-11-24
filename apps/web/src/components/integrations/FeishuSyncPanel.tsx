import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  DefinitionList,
  EmptyState,
  ErrorNotice,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  Panel,
  Select,
  Tabs,
  TextInput,
  Textarea,
} from "../ui.js";
import { Icon } from "../Icon.js";
import { useToast } from "../../contexts/ToastContext.js";
import { api, ApiError } from "../../lib/api.js";
import { useApiQuery } from "../../lib/hooks.js";
import { formatDateTime, formatRelative, shortId } from "../../lib/format.js";
import type {
  IntegrationConnection,
  IntegrationMapping,
  MappingPreset,
  SyncRun,
  SyncSchedule,
} from "../../lib/types.js";
import type { ExternalIdentityView } from "../../lib/ops-types.js";

interface FeishuSyncResultView {
  dryRun: boolean;
  departments: Array<{
    externalId: string;
    name: string;
    action: string;
  }>;
  users: Array<{
    openId: string;
    name: string;
    email?: string;
    jobTitle?: string;
    action: string;
  }>;
  managersLinked: number;
  orgAssignmentsCreated: number;
  warnings: string[];
}

export function FeishuSyncPanel() {
  const toast = useToast();
  const [result, setResult] = useState<FeishuSyncResultView | null>(null);
  const [allowCreate, setAllowCreate] = useState(false);
  const [busy, setBusy] = useState(false);

  async function runSync(dryRun: boolean) {
    setBusy(true);
    try {
      const response = await api<FeishuSyncResultView>(
        "/api/v1/platform/feishu/sync-directory",
        { method: "POST", body: { dryRun, allowCreate } },
      );
      setResult(response);
      toast.success(
        dryRun ? "Preview ready" : "通讯录已同步",
        `${response.departments.length} departments · ${response.users.length} people · ${response.managersLinked} reporting lines`,
      );
    } catch (caught) {
      toast.error(
        caught instanceof ApiError ? caught.message : "通讯录同步失败",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <InfoNotice>
        Preview first: dry-run lists what would be created without writing.
        Provisioning only grants the basic employee role; elevated roles stay
        with an administrator. Requires FEISHU_APP_ID/FEISHU_APP_SECRET on the
        server (501 otherwise).
      </InfoNotice>
      <div className="row-actions">
        <Button
          variant="secondary"
          loading={busy}
          onClick={() => void runSync(true)}
        >
          预览（试运行）
        </Button>
        <Button
          variant="primary"
          loading={busy}
          onClick={() => void runSync(false)}
        >
          执行同步
        </Button>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={allowCreate}
            onChange={(event) => setAllowCreate(event.target.checked)}
          />{" "}
          自动补建缺失人员（仅基础角色）
        </label>
      </div>
      {result ? (
        <div className="stack">
          <div className="stat-grid stat-grid--three">
            <div>
              <div className="stat-label">部门</div>
              <div className="stat-value">
                {result.departments.filter((d) => d.action === "CREATE").length}{" "}
                new / {result.departments.length}
              </div>
            </div>
            <div>
              <div className="stat-label">人员</div>
              <div className="stat-value">
                {
                  result.users.filter((u) => u.action === "PROVISION" || u.action === "LINK_PERSON")
                    .length
                }{" "}
                new / {result.users.length}
              </div>
            </div>
            <div>
              <div className="stat-label">汇报线</div>
              <div className="stat-value">{result.managersLinked}</div>
            </div>
          </div>
          {result.warnings.length > 0 ? (
            <InfoNotice tone="warning">
              {result.warnings.slice(0, 3).join(" · ")}
              {result.warnings.length > 3 ? ` (+${result.warnings.length - 3} more)` : ""}
            </InfoNotice>
          ) : null}
          <table className="table">
            <thead>
              <tr>
                <th>人员</th>
                <th>标题</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {result.users.slice(0, 12).map((user) => (
                <tr key={user.openId}>
                  <td>
                    {user.name}
                    {user.email ? (
                      <span className="hint"> · {user.email}</span>
                    ) : null}
                  </td>
                  <td>{user.jobTitle ?? "—"}</td>
                  <td>
                    <Badge
                      tone={
                        user.action === "PROVISION" || user.action === "LINK_PERSON"
                          ? "info"
                          : user.action === "SKIPPED_NO_PROVISIONING"
                            ? "neutral"
                            : "success"
                      }
                    >
                      {user.action}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
