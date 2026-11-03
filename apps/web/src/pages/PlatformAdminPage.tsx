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
      </div>

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
