import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  PageHeader,
  Panel,
  Select,
  Tabs,
  Textarea,
  TextInput,
} from "../components/ui.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { clickableRowProps } from "../lib/a11y.js";
import { formatDateTime, shortId, titleCase } from "../lib/format.js";
import type {
  PlatformMembership,
  PlatformOrgNode,
  PlatformTenant,
  PlatformUser,
} from "../lib/types.js";
import type {
  SubscriptionPlanView,
  TenantInvoiceView,
  TenantSubscriptionView,
} from "../lib/ops-types.js";

export function PlatformAdminPage() {
  useDocumentTitle("平台管理");
  const toast = useToast();
  const tenants = useApiQuery<PlatformTenant[]>("/api/v1/platform/tenants");
  const users = useApiQuery<PlatformUser[]>("/api/v1/platform/users");
  const [tab, setTab] = useState("tenants");
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const tenantList = tenants.data ?? [];
  const selectedTenant = tenantList.find(
    (tenant) => tenant.id === selectedTenantId,
  );
  const memberships = useApiQuery<PlatformMembership[]>(
    selectedTenantId
      ? `/api/v1/platform/tenants/${selectedTenantId}/memberships`
      : null,
    selectedTenantId,
  );
  const orgNodes = useApiQuery<PlatformOrgNode[]>(
    selectedTenantId
      ? `/api/v1/platform/tenants/${selectedTenantId}/org-nodes`
      : null,
    selectedTenantId,
  );
  const [tenantOpen, setTenantOpen] = useState(false);
  const [tenantName, setTenantName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantTimezone, setTenantTimezone] = useState("Asia/Shanghai");
  const [tenantCurrency, setTenantCurrency] = useState("CNY");
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [userOpen, setUserOpen] = useState(false);
  const [authSubject, setAuthSubject] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userError, setUserError] = useState<string | null>(null);
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [membershipUserId, setMembershipUserId] = useState("");
  const [membershipRoles, setMembershipRoles] = useState("admin");
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [orgOpen, setOrgOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState("DEPARTMENT");
  const [orgParentId, setOrgParentId] = useState("");
  const [orgError, setOrgError] = useState<string | null>(null);
  const [settingsText, setSettingsText] = useState("{}");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const plans = useApiQuery<SubscriptionPlanView[]>("/api/v1/platform/plans");
  const subscription = useApiQuery<TenantSubscriptionView | null>(
    selectedTenantId
      ? `/api/v1/platform/tenants/${selectedTenantId}/subscription`
      : null,
    selectedTenantId,
  );
  const invoices = useApiQuery<TenantInvoiceView[]>(
    selectedTenantId
      ? `/api/v1/platform/tenants/${selectedTenantId}/invoices`
      : null,
    selectedTenantId,
  );
  const [planOpen, setPlanOpen] = useState(false);
  const [planCode, setPlanCode] = useState("");
  const [planName, setPlanName] = useState("");
  const [planPrice, setPlanPrice] = useState("1999.00");
  const [planSeats, setPlanSeats] = useState("25");
  const [planTrial, setPlanTrial] = useState("14");
  const [planError, setPlanError] = useState<string | null>(null);
  const [subPlanCode, setSubPlanCode] = useState("");
  const [subStatus, setSubStatus] = useState("ACTIVE");
  const [subError, setSubError] = useState<string | null>(null);
  const [subSaving, setSubSaving] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceAmount, setInvoiceAmount] = useState("1999.00");
  const [invoiceDescription, setInvoiceDescription] = useState("");
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTenantId && tenantList[0]?.id) {
      setSelectedTenantId(tenantList[0].id);
    }
  }, [tenantList, selectedTenantId]);

  useEffect(() => {
    setSettingsText(JSON.stringify(selectedTenant?.settings ?? {}, null, 2));
    setSettingsError(null);
  }, [selectedTenant?.id, selectedTenant?.settings]);

  async function createTenant() {
    setTenantError(null);
    try {
      await api("/api/v1/platform/tenants", {
        method: "POST",
        body: {
          name: tenantName.trim(),
          slug: tenantSlug.trim(),
          defaultTimezone: tenantTimezone.trim() || undefined,
          defaultCurrency: tenantCurrency.trim().toUpperCase() || undefined,
        },
      });
      toast.success("租户已创建", tenantSlug);
      setTenantOpen(false);
      tenants.reload();
    } catch (caught) {
      setTenantError(
        caught instanceof ApiError ? caught.message : "创建租户失败",
      );
    }
  }

  async function createPlan() {
    setPlanError(null);
    try {
      await api("/api/v1/platform/plans", {
        method: "POST",
        body: {
          code: planCode.trim(),
          name: planName.trim(),
          monthlyPrice: planPrice.trim(),
          currency: "CNY",
          seatLimit: Number.parseInt(planSeats, 10) || 25,
          trialDays: Number.parseInt(planTrial, 10) || 0,
          features: [],
        },
      });
      toast.success("套餐已保存", planCode);
      setPlanOpen(false);
      plans.reload();
    } catch (caught) {
      setPlanError(
        caught instanceof ApiError ? caught.message : "保存套餐失败",
      );
    }
  }

  async function saveSubscription() {
    if (!selectedTenantId) return;
    setSubError(null);
    setSubSaving(true);
    try {
      const now = new Date();
      const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await api(`/api/v1/platform/tenants/${selectedTenantId}/subscription`, {
        method: "PUT",
        body: {
          planCode: subPlanCode,
          status: subStatus,
          seats: Number.parseInt(planSeats, 10) || 25,
          currentPeriodStart: now.toISOString(),
          currentPeriodEnd: end.toISOString(),
        },
      });
      toast.success("订阅已保存", subPlanCode);
      subscription.reload();
    } catch (caught) {
      setSubError(
        caught instanceof ApiError
          ? caught.message
          : "保存订阅失败",
      );
    } finally {
      setSubSaving(false);
    }
  }

  async function createInvoice() {
    if (!selectedTenantId) return;
    setInvoiceError(null);
    try {
      await api(`/api/v1/platform/tenants/${selectedTenantId}/invoices`, {
        method: "POST",
        body: {
          lineItems: [
            {
              description: invoiceDescription.trim() || "订阅",
              quantity: 1,
              unitAmount: invoiceAmount.trim(),
              amount: invoiceAmount.trim(),
            },
          ],
        },
      });
      toast.success("发票已创建");
      setInvoiceOpen(false);
      invoices.reload();
    } catch (caught) {
      setInvoiceError(
        caught instanceof ApiError
          ? caught.message
          : "创建发票失败",
      );
    }
  }

  async function advanceInvoice(invoiceId: string, status: string) {
    try {
      await api(`/api/v1/platform/invoices/${invoiceId}/status`, {
        method: "POST",
        body: { status },
      });
      toast.success("发票已更新", status);
      invoices.reload();
    } catch (caught) {
      toast.error(
        caught instanceof ApiError ? caught.message : "更新发票失败",
      );
    }
  }

  async function createUser() {
    setUserError(null);
    try {
      await api("/api/v1/platform/users", {
        method: "POST",
        body: {
          authSubject: authSubject.trim(),
          displayName: displayName.trim(),
          email: userEmail.trim() || undefined,
        },
      });
      toast.success("用户已创建", displayName);
      setUserOpen(false);
      users.reload();
    } catch (caught) {
      setUserError(
        caught instanceof ApiError ? caught.message : "创建用户失败",
      );
    }
  }

  async function addMembership() {
    if (!selectedTenantId) return;
    setMembershipError(null);
    try {
      await api(
        `/api/v1/platform/tenants/${selectedTenantId}/memberships`,
        {
          method: "POST",
          body: {
            userId: membershipUserId,
            roleCodes: membershipRoles
              .split(",")
              .map((role) => role.trim())
              .filter(Boolean),
          },
        },
      );
      toast.success("成员关系已添加", membershipUserId);
      setMembershipOpen(false);
      memberships.reload();
    } catch (caught) {
      setMembershipError(
        caught instanceof ApiError ? caught.message : "添加成员关系失败",
      );
    }
  }

  async function createOrgNode() {
    if (!selectedTenantId) return;
    setOrgError(null);
    try {
      await api(`/api/v1/platform/tenants/${selectedTenantId}/org-nodes`, {
        method: "POST",
        body: {
          name: orgName.trim(),
          nodeType: orgType.trim(),
          parentId: orgParentId.trim() || undefined,
        },
      });
      toast.success("组织节点已创建", orgName);
      setOrgOpen(false);
      orgNodes.reload();
    } catch (caught) {
      setOrgError(
        caught instanceof ApiError ? caught.message : "创建组织节点失败",
      );
    }
  }

  async function saveSettings() {
    if (!selectedTenantId) return;
    setSettingsError(null);
    setSaving(true);
    try {
      const parsed = JSON.parse(settingsText) as Record<string, unknown>;
      await api(`/api/v1/platform/tenants/${selectedTenantId}/settings`, {
        method: "POST",
        body: parsed,
      });
      toast.success("租户设置已保存", selectedTenant?.name);
      tenants.reload();
    } catch (caught) {
      setSettingsError(
        caught instanceof Error ? caught.message : "保存设置失败",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="平台"
        title="平台管理"
        description="租户、用户、成员关系、组织架构与租户设置；字段访问等安全敏感设置也可在各自专属页面审计。"
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => {
              tenants.reload();
              users.reload();
            }}
            loading={tenants.loading || users.loading}
          >
            刷新
          </Button>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">租户</span>
          </div>
          <div className="stat-tile__value">{tenantList.length}</div>
          <div className="stat-tile__detail">当前平台范围</div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">用户</span>
          </div>
          <div className="stat-tile__value">{users.data?.length ?? 0}</div>
          <div className="stat-tile__detail">平台身份</div>
        </div>
        <div className="stat-tile stat-tile--warning">
          <div className="stat-tile__top">
            <span className="stat-tile__label">所选租户</span>
          </div>
          <div className="stat-tile__value" style={{ fontSize: 20 }}>
            {selectedTenant?.slug ?? "—"}
          </div>
          <div className="stat-tile__detail">
            {selectedTenant
              ? `${selectedTenant.defaultTimezone} · ${selectedTenant.defaultCurrency}`
              : "选择租户…"}
          </div>
        </div>
      </div>

      <Tabs
        items={[
          { id: "tenants", label: "租户", count: tenantList.length },
          { id: "users", label: "用户", count: users.data?.length ?? 0 },
          {
            id: "memberships",
            label: "成员关系",
            count: memberships.data?.length ?? 0,
          },
          {
            id: "org",
            label: "组织架构",
            count: orgNodes.data?.length ?? 0,
          },
          { id: "settings", label: "设置" },
          { id: "billing", label: "订阅计费", count: invoices.data?.length ?? 0 },
        ]}
        active={tab}
        onChange={setTab}
        label="平台视图"
      />

      <div className="tab-panel">
        {tab === "tenants" ? (
          <Panel
            title="租户"
            subtitle="人员、政策与资金路径的隔离边界"
            flush
            action={
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                onClick={() => {
                  setTenantName("");
                  setTenantSlug("");
                  setTenantTimezone("Asia/Shanghai");
                  setTenantCurrency("CNY");
                  setTenantError(null);
                  setTenantOpen(true);
                }}
              >
                新建租户
              </Button>
            }
          >
            {tenants.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={tenants.error} onRetry={tenants.reload} />
              </div>
            ) : tenants.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={3} />
              </div>
            ) : tenantList.length === 0 ? (
              <EmptyState icon="layers" title="暂无租户" />
            ) : (
              <div className="table-wrap">
                <table className="data-table table-clickable">
                  <thead>
                    <tr>
                      <th>租户</th>
                      <th>状态</th>
                      <th>时区</th>
                      <th>币种</th>
                      <th>创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenantList.map((tenant) => (
                      <tr
                        key={tenant.id}
                        className={
                          tenant.id === selectedTenantId ? "is-selected" : ""
                        }
                        {...clickableRowProps(() =>
                          setSelectedTenantId(tenant.id),
                        )}
                      >
                        <td>
                          <span className="cell-primary">{tenant.name}</span>
                          <span className="cell-sub mono">
                            {tenant.slug} · {shortId(tenant.id, 8)}
                          </span>
                        </td>
                        <td>
                          <Badge status={tenant.status} />
                        </td>
                        <td>{tenant.defaultTimezone}</td>
                        <td>{tenant.defaultCurrency}</td>
                        <td className="nowrap">
                          {formatDateTime(tenant.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : null}

        {tab === "users" ? (
          <Panel
            title="平台用户"
            subtitle="可持有成员关系的认证主体"
            flush
            action={
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                onClick={() => {
                  setAuthSubject("");
                  setDisplayName("");
                  setUserEmail("");
                  setUserError(null);
                  setUserOpen(true);
                }}
              >
                新建用户
              </Button>
            }
          >
            {users.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={users.error} onRetry={users.reload} />
              </div>
            ) : users.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={3} />
              </div>
            ) : (users.data?.length ?? 0) === 0 ? (
              <EmptyState icon="people" title="暂无平台用户" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>用户</th>
                      <th>认证主体</th>
                      <th>状态</th>
                      <th>创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(users.data ?? []).map((user) => (
                      <tr key={user.id}>
                        <td>
                          <span className="cell-primary">
                            {user.displayName}
                          </span>
                          <span className="cell-sub">
                            {user.email ?? "no email"}
                          </span>
                        </td>
                        <td className="mono">{user.authSubject}</td>
                        <td>
                          <Badge status={user.status} />
                        </td>
                        <td className="nowrap">
                          {formatDateTime(user.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : null}

        {tab === "memberships" ? (
          <Panel
            title="成员关系"
            subtitle={
              selectedTenant
                ? `Roles for ${selectedTenant.name}`
                : "请先选择租户"
            }
            flush
            action={
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                disabled={!selectedTenantId}
                onClick={() => {
                  setMembershipUserId((users.data ?? [])[0]?.id ?? "");
                  setMembershipRoles("admin");
                  setMembershipError(null);
                  setMembershipOpen(true);
                }}
              >
                添加成员关系
              </Button>
            }
          >
            {!selectedTenantId ? (
              <EmptyState
                icon="people"
                title="选择租户…"
                description="成员关系按租户隔离。"
              />
            ) : memberships.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice
                  error={memberships.error}
                  onRetry={memberships.reload}
                />
              </div>
            ) : memberships.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={3} />
              </div>
            ) : (memberships.data?.length ?? 0) === 0 ? (
              <EmptyState icon="people" title="暂无成员关系" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>用户</th>
                      <th>角色</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(memberships.data ?? []).map((membership) => (
                      <tr key={membership.id}>
                        <td>
                          <span className="cell-primary">
                            {membership.userDisplayName ??
                              shortId(membership.userId, 10)}
                          </span>
                          <span className="cell-sub">
                            {membership.userEmail ?? membership.userId}
                          </span>
                        </td>
                        <td>
                          <div className="chip-row">
                            {membership.roleCodes.map((role) => (
                              <span className="chip" key={role}>
                                {role}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <Badge status={membership.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : null}

        {tab === "org" ? (
          <Panel
            title="组织架构"
            subtitle={
              selectedTenant
                ? `Nodes for ${selectedTenant.name}`
                : "请先选择租户"
            }
            flush
            action={
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                disabled={!selectedTenantId}
                onClick={() => {
                  setOrgName("");
                  setOrgType("DEPARTMENT");
                  setOrgParentId("");
                  setOrgError(null);
                  setOrgOpen(true);
                }}
              >
                新建节点
              </Button>
            }
          >
            {!selectedTenantId ? (
              <EmptyState
                icon="layers"
                title="选择租户…"
                description="组织节点按租户隔离。"
              />
            ) : orgNodes.error ? (
              <div style={{ padding: 16 }}>
                <ErrorNotice error={orgNodes.error} onRetry={orgNodes.reload} />
              </div>
            ) : orgNodes.loading ? (
              <div style={{ padding: 16 }}>
                <LoadingRows rows={3} />
              </div>
            ) : (orgNodes.data?.length ?? 0) === 0 ? (
              <EmptyState icon="layers" title="暂无组织节点" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>节点</th>
                      <th>类型</th>
                      <th>路径</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(orgNodes.data ?? []).map((node) => (
                      <tr key={node.id}>
                        <td>
                          <span className="cell-primary">{node.name}</span>
                          <span className="cell-sub mono">
                            {shortId(node.id, 10)}
                          </span>
                        </td>
                        <td>{titleCase(node.nodeType)}</td>
                        <td className="mono">{node.path ?? "—"}</td>
                        <td>
                          <Badge
                            tone={node.active ? "success" : "neutral"}
                          >
                            {node.active ? "生效中" : "未启用"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : null}

        {tab === "settings" ? (
          <Panel
            title="租户设置"
            subtitle={
              selectedTenant
                ? `Settings for ${selectedTenant.name}`
                : "请先选择租户"
            }
            action={
              <Button
                size="sm"
                variant="primary"
                loading={saving}
                disabled={!selectedTenantId}
                onClick={saveSettings}
              >
                保存设置
              </Button>
            }
          >
            {!selectedTenantId ? (
              <EmptyState icon="settings" title="选择租户…" />
            ) : (
              <>
                {settingsError ? (
                  <InfoNotice tone="warning">{settingsError}</InfoNotice>
                ) : null}
                <InfoNotice>
                  Settings are merged, not replaced. Field access policies are
                  managed and audited on the Field access page.
                </InfoNotice>
                <Textarea
                  value={settingsText}
                  onChange={(event) => setSettingsText(event.target.value)}
                  rows={16}
                  spellCheck={false}
                />
              </>
            )}
          </Panel>
        ) : null}
        {tab === "billing" ? (
          <>
            <Panel
              title="订阅套餐"
              action={
                <Button onClick={() => setPlanOpen(true)}>新建套餐</Button>
              }
            >
              {plans.loading && plans.data === undefined ? (
                <LoadingRows rows={4} />
              ) : (plans.data ?? []).length === 0 ? (
                <EmptyState
                  icon="layers"
                  title="暂无套餐"
                  description="创建第一个订阅套餐后即可启用自助注册与席位限制。"
                />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>编码</th>
                      <th>名称</th>
                      <th>月度</th>
                      <th>席位</th>
                      <th>试用</th>
                      <th>生效中</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(plans.data ?? []).map((plan) => (
                      <tr key={plan.id}>
                        <td>
                          <code>{plan.code}</code>
                        </td>
                        <td>{plan.name}</td>
                        <td>
                          {plan.monthlyPrice} {plan.currency}
                        </td>
                        <td>
                          {plan.seatLimit < 0 ? "Unlimited" : plan.seatLimit}
                        </td>
                        <td>{plan.trialDays}d</td>
                        <td>
                          <Badge
                            tone={plan.active ? "success" : "neutral"}
                          >
                            {plan.active ? "生效中" : "未启用"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
            <Panel
              title={
                selectedTenant
                  ? `Subscription · ${selectedTenant.name}`
                  : "订阅"
              }
            >
              {subscription.error ? (
                <InfoNotice>
                  This tenant has no subscription yet. Assign a plan below to
                  start billing.
                </InfoNotice>
              ) : subscription.data ? (
                <div className="stat-grid">
                  <div>
                    <div className="stat-label">套餐</div>
                    <div className="stat-value">
                      {subscription.data.planName} (
                      {subscription.data.planCode})
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">状态</div>
                    <div className="stat-value">
                      {subscription.data.status}
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">席位</div>
                    <div className="stat-value">
                      {subscription.data.seats}
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">周期结束</div>
                    <div className="stat-value">
                      {formatDateTime(subscription.data.currentPeriodEnd)}
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon="layers"
                  title="暂无订阅"
                  description="在下方分配套餐以开始计费。"
                />
              )}
              <div className="form-grid">
                {subError ? (
                  <div className="field--full">
                    <InfoNotice tone="warning">{subError}</InfoNotice>
                  </div>
                ) : null}
                <FormField label="套餐" htmlFor="sub-plan">
                  <Select
                    id="sub-plan"
                    value={subPlanCode}
                    onChange={(event) => setSubPlanCode(event.target.value)}
                  >
                    <option value="">Select plan…</option>
                    {(plans.data ?? [])
                      .filter((plan) => plan.active)
                      .map((plan) => (
                        <option key={plan.id} value={plan.code}>
                          {plan.code}
                        </option>
                      ))}
                  </Select>
                </FormField>
                <FormField label="状态" htmlFor="sub-status">
                  <Select
                    id="sub-status"
                    value={subStatus}
                    onChange={(event) => setSubStatus(event.target.value)}
                  >
                    {["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"].map(
                      (status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ),
                    )}
                  </Select>
                </FormField>
                <div className="field--full">
                  <Button
                    variant="primary"
                    disabled={!subPlanCode || subSaving}
                    onClick={saveSubscription}
                  >
                    保存订阅
                  </Button>
                </div>
              </div>
            </Panel>
            <Panel
              title="发票"
              action={
                <Button onClick={() => setInvoiceOpen(true)}>
                  新建发票
                </Button>
              }
            >
              {(invoices.data ?? []).length === 0 ? (
                <EmptyState
                  icon="layers"
                  title="暂无发票"
                  description="发票按计费周期从订阅生成。"
                />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>编号</th>
                      <th>状态</th>
                      <th>合计</th>
                      <th>截止</th>
                      <th>已开具</th>
                      <th>已支付</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(invoices.data ?? []).map((invoice) => (
                      <tr key={invoice.id}>
                        <td>
                          <code>{invoice.number}</code>
                        </td>
                        <td>
                          <Badge
                            tone={
                              invoice.status === "PAID"
                                ? "success"
                                : invoice.status === "VOID"
                                  ? "neutral"
                                  : "info"
                            }
                          >
                            {invoice.status}
                          </Badge>
                        </td>
                        <td>
                          {invoice.totalAmount} {invoice.currency}
                        </td>
                        <td>{invoice.dueDate ?? "—"}</td>
                        <td>
                          {invoice.issuedAt
                            ? formatDateTime(invoice.issuedAt)
                            : "—"}
                        </td>
                        <td>
                          {invoice.paidAt
                            ? formatDateTime(invoice.paidAt)
                            : "—"}
                        </td>
                        <td>
                          {invoice.status === "DRAFT" ? (
                            <Button
                              variant="ghost"
                              onClick={() =>
                                advanceInvoice(invoice.id, "ISSUED")
                              }
                            >
                              问题
                            </Button>
                          ) : invoice.status === "ISSUED" ? (
                            <Button
                              variant="ghost"
                              onClick={() => advanceInvoice(invoice.id, "PAID")}
                            >
                              标记已支付
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </>
        ) : null}
      </div>

      <Modal
        open={planOpen}
        title="新建订阅套餐"
        onClose={() => setPlanOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPlanOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={createPlan}>
              保存套餐
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {planError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{planError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="编码" htmlFor="plan-code">
            <TextInput
              id="plan-code"
              value={planCode}
              onChange={(event) => setPlanCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="名称" htmlFor="plan-name">
            <TextInput
              id="plan-name"
              value={planName}
              onChange={(event) => setPlanName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="月价" htmlFor="plan-price">
            <TextInput
              id="plan-price"
              value={planPrice}
              onChange={(event) => setPlanPrice(event.target.value)}
              required
            />
          </FormField>
          <FormField label="席位上限（-1 = 不限）" htmlFor="plan-seats">
            <TextInput
              id="plan-seats"
              value={planSeats}
              onChange={(event) => setPlanSeats(event.target.value)}
              required
            />
          </FormField>
          <FormField label="试用天数" htmlFor="plan-trial">
            <TextInput
              id="plan-trial"
              value={planTrial}
              onChange={(event) => setPlanTrial(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={invoiceOpen}
        title="新建发票"
        onClose={() => setInvoiceOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setInvoiceOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={createInvoice}>
              创建发票
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {invoiceError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{invoiceError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="说明" htmlFor="invoice-description">
            <TextInput
              id="invoice-description"
              value={invoiceDescription}
              onChange={(event) =>
                setInvoiceDescription(event.target.value)
              }
            />
          </FormField>
          <FormField label="金额" htmlFor="invoice-amount">
            <TextInput
              id="invoice-amount"
              value={invoiceAmount}
              onChange={(event) => setInvoiceAmount(event.target.value)}
              required
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={tenantOpen}
        title="新建租户"
        onClose={() => setTenantOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTenantOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={createTenant}>
              创建租户
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {tenantError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{tenantError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="名称" htmlFor="tenant-name">
            <TextInput
              id="tenant-name"
              value={tenantName}
              onChange={(event) => setTenantName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Slug" htmlFor="tenant-slug">
            <TextInput
              id="tenant-slug"
              value={tenantSlug}
              onChange={(event) => setTenantSlug(event.target.value)}
              required
            />
          </FormField>
          <FormField label="时区" htmlFor="tenant-timezone">
            <TextInput
              id="tenant-timezone"
              value={tenantTimezone}
              onChange={(event) => setTenantTimezone(event.target.value)}
            />
          </FormField>
          <FormField label="币种" htmlFor="tenant-currency">
            <TextInput
              id="tenant-currency"
              value={tenantCurrency}
              maxLength={3}
              onChange={(event) =>
                setTenantCurrency(event.target.value.toUpperCase())
              }
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={userOpen}
        title="新建平台用户"
        onClose={() => setUserOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setUserOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={createUser}>
              创建用户
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {userError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{userError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="认证主体" htmlFor="user-subject">
            <TextInput
              id="user-subject"
              value={authSubject}
              onChange={(event) => setAuthSubject(event.target.value)}
              required
            />
          </FormField>
          <FormField label="姓名" htmlFor="user-name">
            <TextInput
              id="user-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="邮箱（可选）" htmlFor="user-email">
            <TextInput
              id="user-email"
              type="email"
              value={userEmail}
              onChange={(event) => setUserEmail(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={membershipOpen}
        title="添加成员关系"
        onClose={() => setMembershipOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMembershipOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={addMembership}>
              添加成员关系
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {membershipError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{membershipError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="用户" htmlFor="membership-user">
            <Select
              id="membership-user"
              value={membershipUserId}
              onChange={(event) => setMembershipUserId(event.target.value)}
              required
            >
              <option value="">选择用户…</option>
              {(users.data ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName} · {user.authSubject}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="角色（逗号分隔）" htmlFor="membership-roles">
            <TextInput
              id="membership-roles"
              value={membershipRoles}
              onChange={(event) => setMembershipRoles(event.target.value)}
              required
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={orgOpen}
        title="新建组织节点"
        onClose={() => setOrgOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOrgOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={createOrgNode}>
              创建节点
            </Button>
          </>
        }
      >
        <div className="form-grid">
          {orgError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{orgError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="名称" htmlFor="org-name">
            <TextInput
              id="org-name"
              value={orgName}
              onChange={(event) => setOrgName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="节点类型" htmlFor="org-type">
            <TextInput
              id="org-type"
              value={orgType}
              onChange={(event) => setOrgType(event.target.value)}
              required
            />
          </FormField>
          <FormField label="父节点 ID（可选）" htmlFor="org-parent">
            <TextInput
              id="org-parent"
              value={orgParentId}
              onChange={(event) => setOrgParentId(event.target.value)}
              placeholder="UUID"
            />
          </FormField>
        </div>
      </Modal>
    </>
  );
}
