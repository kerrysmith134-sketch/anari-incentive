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
  useDocumentTitle("Platform admin");
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
      toast.success("Tenant created", tenantSlug);
      setTenantOpen(false);
      tenants.reload();
    } catch (caught) {
      setTenantError(
        caught instanceof ApiError ? caught.message : "Could not create tenant",
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
      toast.success("Plan saved", planCode);
      setPlanOpen(false);
      plans.reload();
    } catch (caught) {
      setPlanError(
        caught instanceof ApiError ? caught.message : "Could not save plan",
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
      toast.success("Subscription saved", subPlanCode);
      subscription.reload();
    } catch (caught) {
      setSubError(
        caught instanceof ApiError
          ? caught.message
          : "Could not save subscription",
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
              description: invoiceDescription.trim() || "Subscription",
              quantity: 1,
              unitAmount: invoiceAmount.trim(),
              amount: invoiceAmount.trim(),
            },
          ],
        },
      });
      toast.success("Invoice created");
      setInvoiceOpen(false);
      invoices.reload();
    } catch (caught) {
      setInvoiceError(
        caught instanceof ApiError
          ? caught.message
          : "Could not create invoice",
      );
    }
  }

  async function advanceInvoice(invoiceId: string, status: string) {
    try {
      await api(`/api/v1/platform/invoices/${invoiceId}/status`, {
        method: "POST",
        body: { status },
      });
      toast.success("Invoice updated", status);
      invoices.reload();
    } catch (caught) {
      toast.error(
        caught instanceof ApiError ? caught.message : "Could not update invoice",
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
      toast.success("User created", displayName);
      setUserOpen(false);
      users.reload();
    } catch (caught) {
      setUserError(
        caught instanceof ApiError ? caught.message : "Could not create user",
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
      toast.success("Membership added", membershipUserId);
      setMembershipOpen(false);
      memberships.reload();
    } catch (caught) {
      setMembershipError(
        caught instanceof ApiError ? caught.message : "Could not add membership",
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
      toast.success("Org node created", orgName);
      setOrgOpen(false);
      orgNodes.reload();
    } catch (caught) {
      setOrgError(
        caught instanceof ApiError ? caught.message : "Could not create org node",
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
      toast.success("Tenant settings saved", selectedTenant?.name);
      tenants.reload();
    } catch (caught) {
      setSettingsError(
        caught instanceof Error ? caught.message : "Could not save settings",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Platform admin"
        description="Tenants, users, memberships, org structure and tenant settings. Security-sensitive settings such as field access are also auditable from their dedicated pages."
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
            Refresh
          </Button>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Tenants</span>
          </div>
          <div className="stat-tile__value">{tenantList.length}</div>
          <div className="stat-tile__detail">Active platform scope</div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Users</span>
          </div>
          <div className="stat-tile__value">{users.data?.length ?? 0}</div>
          <div className="stat-tile__detail">Platform identities</div>
        </div>
        <div className="stat-tile stat-tile--warning">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Selected tenant</span>
          </div>
          <div className="stat-tile__value" style={{ fontSize: 20 }}>
            {selectedTenant?.slug ?? "—"}
          </div>
          <div className="stat-tile__detail">
            {selectedTenant
              ? `${selectedTenant.defaultTimezone} · ${selectedTenant.defaultCurrency}`
              : "Select a tenant"}
          </div>
        </div>
      </div>

      <Tabs
        items={[
          { id: "tenants", label: "Tenants", count: tenantList.length },
          { id: "users", label: "Users", count: users.data?.length ?? 0 },
          {
            id: "memberships",
            label: "Memberships",
            count: memberships.data?.length ?? 0,
          },
          {
            id: "org",
            label: "Org structure",
            count: orgNodes.data?.length ?? 0,
          },
          { id: "settings", label: "Settings" },
          { id: "billing", label: "Billing", count: invoices.data?.length ?? 0 },
        ]}
        active={tab}
        onChange={setTab}
        label="Platform views"
      />

      <div className="tab-panel">
        {tab === "tenants" ? (
          <Panel
            title="Tenants"
            subtitle="Isolation boundary for people, policies and money paths"
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
                New tenant
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
              <EmptyState icon="layers" title="No tenant" />
            ) : (
              <div className="table-wrap">
                <table className="data-table table-clickable">
                  <thead>
                    <tr>
                      <th>Tenant</th>
                      <th>Status</th>
                      <th>Timezone</th>
                      <th>Currency</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenantList.map((tenant) => (
                      <tr
                        key={tenant.id}
                        className={
                          tenant.id === selectedTenantId ? "is-selected" : ""
                        }
                        onClick={() => setSelectedTenantId(tenant.id)}
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
            title="Platform users"
            subtitle="Authentication subjects that can hold memberships"
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
                New user
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
              <EmptyState icon="people" title="No platform user" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Auth subject</th>
                      <th>Status</th>
                      <th>Created</th>
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
            title="Memberships"
            subtitle={
              selectedTenant
                ? `Roles for ${selectedTenant.name}`
                : "Select a tenant first"
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
                Add membership
              </Button>
            }
          >
            {!selectedTenantId ? (
              <EmptyState
                icon="people"
                title="Select a tenant"
                description="Memberships are tenant-scoped."
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
              <EmptyState icon="people" title="No membership" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Roles</th>
                      <th>Status</th>
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
            title="Org structure"
            subtitle={
              selectedTenant
                ? `Nodes for ${selectedTenant.name}`
                : "Select a tenant first"
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
                New node
              </Button>
            }
          >
            {!selectedTenantId ? (
              <EmptyState
                icon="layers"
                title="Select a tenant"
                description="Org nodes are tenant-scoped."
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
              <EmptyState icon="layers" title="No org node" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Node</th>
                      <th>Type</th>
                      <th>Path</th>
                      <th>Status</th>
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
                            {node.active ? "Active" : "Inactive"}
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
            title="Tenant settings"
            subtitle={
              selectedTenant
                ? `Settings for ${selectedTenant.name}`
                : "Select a tenant first"
            }
            action={
              <Button
                size="sm"
                variant="primary"
                loading={saving}
                disabled={!selectedTenantId}
                onClick={saveSettings}
              >
                Save settings
              </Button>
            }
          >
            {!selectedTenantId ? (
              <EmptyState icon="settings" title="Select a tenant" />
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
              title="Subscription plans"
              action={
                <Button onClick={() => setPlanOpen(true)}>New plan</Button>
              }
            >
              {plans.loading && plans.data === undefined ? (
                <LoadingRows rows={4} />
              ) : (plans.data ?? []).length === 0 ? (
                <EmptyState
                  icon="layers"
                  title="No plans yet"
                  description="Create the first subscription plan to enable self-service signup and seat limits."
                />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Monthly</th>
                      <th>Seats</th>
                      <th>Trial</th>
                      <th>Active</th>
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
                            {plan.active ? "Active" : "Inactive"}
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
                  : "Subscription"
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
                    <div className="stat-label">Plan</div>
                    <div className="stat-value">
                      {subscription.data.planName} (
                      {subscription.data.planCode})
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">Status</div>
                    <div className="stat-value">
                      {subscription.data.status}
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">Seats</div>
                    <div className="stat-value">
                      {subscription.data.seats}
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">Period ends</div>
                    <div className="stat-value">
                      {formatDateTime(subscription.data.currentPeriodEnd)}
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon="layers"
                  title="No subscription"
                  description="Assign a plan below to start billing this tenant."
                />
              )}
              <div className="form-grid">
                {subError ? (
                  <div className="field--full">
                    <InfoNotice tone="warning">{subError}</InfoNotice>
                  </div>
                ) : null}
                <FormField label="Plan" htmlFor="sub-plan">
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
                <FormField label="Status" htmlFor="sub-status">
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
                    Save subscription
                  </Button>
                </div>
              </div>
            </Panel>
            <Panel
              title="Invoices"
              action={
                <Button onClick={() => setInvoiceOpen(true)}>
                  New invoice
                </Button>
              }
            >
              {(invoices.data ?? []).length === 0 ? (
                <EmptyState
                  icon="layers"
                  title="No invoices"
                  description="Invoices are created per billing period from the subscription."
                />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Number</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Due</th>
                      <th>Issued</th>
                      <th>Paid</th>
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
                              Issue
                            </Button>
                          ) : invoice.status === "ISSUED" ? (
                            <Button
                              variant="ghost"
                              onClick={() => advanceInvoice(invoice.id, "PAID")}
                            >
                              Mark paid
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
        title="New subscription plan"
        onClose={() => setPlanOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPlanOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createPlan}>
              Save plan
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
          <FormField label="Code" htmlFor="plan-code">
            <TextInput
              id="plan-code"
              value={planCode}
              onChange={(event) => setPlanCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Name" htmlFor="plan-name">
            <TextInput
              id="plan-name"
              value={planName}
              onChange={(event) => setPlanName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Monthly price" htmlFor="plan-price">
            <TextInput
              id="plan-price"
              value={planPrice}
              onChange={(event) => setPlanPrice(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Seat limit (-1 = unlimited)" htmlFor="plan-seats">
            <TextInput
              id="plan-seats"
              value={planSeats}
              onChange={(event) => setPlanSeats(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Trial days" htmlFor="plan-trial">
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
        title="New invoice"
        onClose={() => setInvoiceOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setInvoiceOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createInvoice}>
              Create invoice
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
          <FormField label="Description" htmlFor="invoice-description">
            <TextInput
              id="invoice-description"
              value={invoiceDescription}
              onChange={(event) =>
                setInvoiceDescription(event.target.value)
              }
            />
          </FormField>
          <FormField label="Amount" htmlFor="invoice-amount">
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
        title="New tenant"
        onClose={() => setTenantOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTenantOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createTenant}>
              Create tenant
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
          <FormField label="Name" htmlFor="tenant-name">
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
          <FormField label="Timezone" htmlFor="tenant-timezone">
            <TextInput
              id="tenant-timezone"
              value={tenantTimezone}
              onChange={(event) => setTenantTimezone(event.target.value)}
            />
          </FormField>
          <FormField label="Currency" htmlFor="tenant-currency">
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
        title="New platform user"
        onClose={() => setUserOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setUserOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createUser}>
              Create user
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
          <FormField label="Auth subject" htmlFor="user-subject">
            <TextInput
              id="user-subject"
              value={authSubject}
              onChange={(event) => setAuthSubject(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Display name" htmlFor="user-name">
            <TextInput
              id="user-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Email (optional)" htmlFor="user-email">
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
        title="Add membership"
        onClose={() => setMembershipOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMembershipOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={addMembership}>
              Add membership
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
          <FormField label="User" htmlFor="membership-user">
            <Select
              id="membership-user"
              value={membershipUserId}
              onChange={(event) => setMembershipUserId(event.target.value)}
              required
            >
              <option value="">Select a user</option>
              {(users.data ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName} · {user.authSubject}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Roles (comma separated)" htmlFor="membership-roles">
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
        title="New org node"
        onClose={() => setOrgOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOrgOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createOrgNode}>
              Create node
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
          <FormField label="Name" htmlFor="org-name">
            <TextInput
              id="org-name"
              value={orgName}
              onChange={(event) => setOrgName(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Node type" htmlFor="org-type">
            <TextInput
              id="org-type"
              value={orgType}
              onChange={(event) => setOrgType(event.target.value)}
              required
            />
          </FormField>
          <FormField label="Parent id (optional)" htmlFor="org-parent">
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
