/**
 * NP-032（2026-11-21 审计）：SettingsPage 特征组件化拆分——
 * 个人状态区（外观/身份解析/系统健康）自持查询，页面容器不再拥有无关工作流。
 * 拆分阶段 1：个人状态区 + 订阅区（阶段 2：治理面板分组，见页面头注）。
 */
import { useApiQuery } from "../../lib/hooks.js";
import { useTheme, type ThemePreference } from "../../contexts/ThemeContext.js";
import {
  Badge,
  Button,
  CopyButton,
  DefinitionList,
  ErrorNotice,
  LoadingRows,
  Panel,
} from "../ui.js";
import { formatDateTime, titleCase } from "../../lib/format.js";

/** 外观 + 身份解析 + 系统健康：三个自包含面板（主题/身份/健康探测）。 */
export function PersonalStatusSection({
  session,
  auditChainPath,
}: {
  session: { tenantId: string; personId: string };
  /** 审计链校验是治理端点——非治理角色传 null（显示"需治理角色"而非误报）。 */
  auditChainPath: string | null;
}) {
  const { preference, setPreference } = useTheme();
  const identity = useApiQuery<{ userId: string; personId?: string; roles: string[] }>(
    "/api/v1/platform/identity",
    "settings-identity-personal",
  );
  const health = useApiQuery<{ status: string }>("/health", "settings-health");
  const auditChain = useApiQuery<{ valid: boolean }>(
    auditChainPath,
    `settings-audit-chain-${auditChainPath ?? "none"}`,
  );

  return (
    <div className="stack">
      <Panel title="外观" subtitle="主题按浏览器记忆">
        <div className="toolbar__group">
          {(
            [
              { id: "light", label: "Light", icon: "sun" },
              { id: "dark", label: "Dark", icon: "moon" },
              { id: "system", label: "System", icon: "settings" },
            ] as Array<{ id: ThemePreference; label: string; icon: "sun" | "moon" | "settings" }>
          ).map((option) => (
            <Button
              key={option.id}
              variant={preference === option.id ? "primary" : "secondary"}
              icon={option.icon}
              onClick={() => setPreference(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
          Dark mode is a selected palette, not an inverted filter. Charts and
          status colours keep their validated contrast on both surfaces.
        </p>
      </Panel>

      <Panel title="身份解析" subtitle="服务端所见">
        {identity.error ? (
          <ErrorNotice error={identity.error} onRetry={identity.reload} />
        ) : identity.loading ? (
          <LoadingRows rows={3} />
        ) : identity.data ? (
          <DefinitionList
            items={[
              { label: "用户", value: <span className="mono">{identity.data.userId}</span> },
              {
                label: "Linked person",
                value: identity.data.personId ? (
                  <span className="mono">{identity.data.personId}</span>
                ) : (
                  "未绑定"
                ),
              },
              {
                label: "成员角色",
                value:
                  identity.data.roles.length > 0
                    ? identity.data.roles.join(", ")
                    : "None recorded",
              },
            ]}
          />
        ) : null}
        <div className="row-actions section-gap" style={{ justifyContent: "flex-start" }}>
          <CopyButton value={session.tenantId} label="复制租户" />
          <CopyButton value={session.personId} label="复制人员" />
        </div>
      </Panel>

      <Panel title="系统健康" subtitle="来自本浏览器的实时探测">
        <DefinitionList
          items={[
            {
              label: "API health",
              value: health.loading ? (
                "检查中…"
              ) : health.error ? (
                <Badge tone="danger">不可达</Badge>
              ) : (
                <Badge tone="success">{titleCase(health.data?.status ?? "ok")}</Badge>
              ),
            },
            {
              label: "审计链",
              value: !auditChainPath ? (
                <Badge tone="neutral">需治理角色</Badge>
              ) : auditChain.loading ? (
                "检查中…"
              ) : auditChain.data?.valid ? (
                <Badge tone="success">已验证</Badge>
              ) : (
                <Badge tone="danger">需要关注</Badge>
              ),
            },
            {
              label: "控制台来源",
              value: <span className="mono">{window.location.origin}</span>,
            },
            {
              label: "API base",
              value: (
                <span className="mono">
                  {import.meta.env.VITE_API_BASE || "same origin"}
                </span>
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}

/** 订阅区：本租户套餐/席位/发票（只读，自持查询）。 */
export function SubscriptionSection() {
  const subscription = useApiQuery<
    import("../../lib/ops-types.js").TenantSubscriptionView | null
  >("/api/v1/me/subscription", "settings-subscription");
  const myInvoices = useApiQuery<
    import("../../lib/ops-types.js").TenantInvoiceView[]
  >("/api/v1/me/invoices", "settings-invoices");

  return (
    <Panel
      title="订阅"
      subtitle="本租户的套餐、席位与发票（只读；由平台运营方管理）"
      className="section-gap"
    >
      {subscription.error ? (
        <div style={{ padding: 16 }}>
          <p className="hint">
            No subscription is attached to this tenant. Onboarding and seat
            limits are unrestricted until the platform operator assigns a plan.
          </p>
        </div>
      ) : subscription.data ? (
        <div style={{ padding: 16 }} className="stack">
          <DefinitionList
            items={[
              {
                label: "套餐",
                value: `${subscription.data.planName} (${subscription.data.planCode})`,
              },
              { label: "状态", value: subscription.data.status },
              { label: "席位", value: String(subscription.data.seats) },
              {
                label: "周期结束",
                value: formatDateTime(subscription.data.currentPeriodEnd),
              },
            ]}
          />
          {(myInvoices.data ?? []).length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>发票</th>
                  <th>状态</th>
                  <th>合计</th>
                  <th>截止</th>
                </tr>
              </thead>
              <tbody>
                {(myInvoices.data ?? []).map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <code>{invoice.number}</code>
                    </td>
                    <td>{invoice.status}</td>
                    <td>
                      {invoice.totalAmount} {invoice.currency}
                    </td>
                    <td>{invoice.dueDate ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint">暂无发票</p>
          )}
        </div>
      ) : (
        <div style={{ padding: 16 }}>
          <LoadingRows rows={2} />
        </div>
      )}
    </Panel>
  );
}
