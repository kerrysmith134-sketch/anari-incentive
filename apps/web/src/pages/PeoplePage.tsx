import { useMemo, useState, type FormEvent } from "react";
import {
  Avatar,
  Badge,
  Button,
  CopyButton,
  EmptyState,
  ErrorNotice,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  TextInput,
} from "../components/ui.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { api } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  displayName,
  formatDate,
  shortId,
} from "../lib/format.js";
import type { PlatformPerson } from "../lib/types.js";

export function PeoplePage() {
  useDocumentTitle("People");
  const { session } = useAuth();
  const toast = useToast();
  const people = useApiQuery<PlatformPerson[]>(
    `/api/v1/platform/tenants/${session.tenantId}/persons`,
  );
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [employeeCode, setEmployeeCode] = useState("");
  const [displayNameValue, setDisplayNameValue] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("ACTIVE");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [linkTarget, setLinkTarget] = useState<PlatformPerson | null>(null);
  const [userId, setUserId] = useState("");
  const [managerTarget, setManagerTarget] = useState<PlatformPerson | null>(null);
  const [managerId, setManagerId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const list = people.data ?? [];
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return list;
    return list.filter((person) =>
      [person.employeeCode, person.displayName, person.id, person.userId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [list, search]);

  const linked = list.filter((person) => Boolean(person.userId)).length;
  const withManager = list.filter((person) => Boolean(person.managerPersonId)).length;

  function openCreate() {
    setEmployeeCode("");
    setDisplayNameValue("");
    setEmploymentStatus("ACTIVE");
    setFormError(null);
    setCreateOpen(true);
  }

  async function createPerson(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api(`/api/v1/platform/tenants/${session.tenantId}/persons`, {
        method: "POST",
        body: {
          employeeCode: employeeCode.trim(),
          displayName: displayNameValue.trim(),
          employmentStatus,
        },
      });
      toast.success("Person created", displayNameValue);
      setCreateOpen(false);
      people.reload();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Could not create the person.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function openLink(person: PlatformPerson) {
    setLinkTarget(person);
    setUserId(person.userId ?? "");
    setActionError(null);
  }

  async function linkUser() {
    if (!linkTarget) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await api(
        `/api/v1/platform/tenants/${session.tenantId}/persons/${linkTarget.id}/link-user`,
        { method: "POST", body: { userId } },
      );
      toast.success("User linked", linkTarget.displayName);
      setLinkTarget(null);
      people.reload();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "Could not link the user.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function openManager(person: PlatformPerson) {
    setManagerTarget(person);
    setManagerId(person.managerPersonId ?? "");
    setActionError(null);
  }

  async function saveManager() {
    if (!managerTarget) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await api(
        `/api/v1/platform/tenants/${session.tenantId}/persons/${managerTarget.id}/manager`,
        {
          method: "POST",
          body: { managerPersonId: managerId || null },
        },
      );
      toast.success("Manager updated", managerTarget.displayName);
      setManagerTarget(null);
      people.reload();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "Could not update the manager.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Identity directory"
        title="People"
        description="The person record anchors payroll, equity, evidence attribution and approval decisions. Link a platform user and reporting line here."
        actions={
          <>
            <Button
              variant="secondary"
              icon="refresh"
              onClick={people.reload}
              loading={people.loading}
            >
              Refresh
            </Button>
            <Button variant="primary" icon="plus" onClick={openCreate}>
              Person
            </Button>
          </>
        }
      />

      <div className="stat-grid stat-grid--three">
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Headcount</span>
          </div>
          <div className="stat-tile__value">{list.length}</div>
          <div className="stat-tile__detail">Person records in this tenant</div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Linked users</span>
          </div>
          <div className="stat-tile__value">{linked}</div>
          <div className="stat-tile__detail">Can authenticate to the console</div>
        </div>
        <div className="stat-tile stat-tile--neutral">
          <div className="stat-tile__top">
            <span className="stat-tile__label">Reporting lines</span>
          </div>
          <div className="stat-tile__value">{withManager}</div>
          <div className="stat-tile__detail">People with an assigned manager</div>
        </div>
      </div>

      <Panel
        title="Directory"
        subtitle="Use the employee code as the stable external identifier"
        action={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search code, name or id"
          />
        }
        flush
      >
        <div className="toolbar" style={{ padding: "14px 20px 0" }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Tenant <span className="mono">{session.tenantId}</span>
          </span>
          <CopyButton value={session.tenantId} label="Copy tenant id" />
        </div>

        {people.error ? (
          <div style={{ padding: 16 }}>
            <ErrorNotice error={people.error} onRetry={people.reload} />
          </div>
        ) : people.loading ? (
          <div style={{ padding: 16 }}>
            <LoadingRows rows={5} />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon="people"
            title={list.length === 0 ? "No person record" : "No match"}
            description={
              list.length === 0
                ? "Create a person before assigning a contract, grant or bounty."
                : "Clear the search to see the full directory."
            }
            action={
              list.length === 0 ? (
                <Button variant="primary" size="sm" icon="plus" onClick={openCreate}>
                  Create person
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap section-gap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Employee code</th>
                  <th>Status</th>
                  <th>User</th>
                  <th>Manager</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <span className="inline">
                        <Avatar name={person.displayName} size={30} />
                        <span>
                          <span className="cell-primary">
                            {person.displayName}
                          </span>
                          <span className="cell-sub mono">
                            {shortId(person.id, 12)}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="chip">{person.employeeCode}</span>
                    </td>
                    <td>
                      <Badge status={person.employmentStatus} />
                    </td>
                    <td>
                      {person.userId ? (
                        <span className="mono">{shortId(person.userId, 12)}</span>
                      ) : (
                        <span className="subtle">Not linked</span>
                      )}
                    </td>
                    <td>
                      {person.managerPersonId
                        ? displayName(person.managerPersonId, list)
                        : "—"}
                    </td>
                    <td className="nowrap">{formatDate(person.createdAt)}</td>
                    <td className="cell-actions">
                      <div className="row-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openLink(person)}
                        >
                          User
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openManager(person)}
                        >
                          Manager
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={createOpen}
        title="New person"
        description="The person id is generated by the platform and is used across every module."
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="create-person-form"
              loading={submitting}
            >
              Create person
            </Button>
          </>
        }
      >
        <form id="create-person-form" onSubmit={createPerson} className="form-grid">
          {formError ? (
            <div className="field--full">
              <InfoNotice tone="warning">{formError}</InfoNotice>
            </div>
          ) : null}
          <FormField label="Employee code" htmlFor="person-code">
            <TextInput
              id="person-code"
              value={employeeCode}
              onChange={(event) => setEmployeeCode(event.target.value)}
              placeholder="E004"
              required
            />
          </FormField>
          <FormField label="Display name" htmlFor="person-name">
            <TextInput
              id="person-name"
              value={displayNameValue}
              onChange={(event) => setDisplayNameValue(event.target.value)}
              placeholder="Li Wei"
              required
            />
          </FormField>
          <FormField label="Employment status" htmlFor="person-status">
            <Select
              id="person-status"
              value={employmentStatus}
              onChange={(event) => setEmploymentStatus(event.target.value)}
            >
              <option value="ACTIVE">Active</option>
              <option value="ON_LEAVE">On leave</option>
              <option value="ENDED">Ended</option>
            </Select>
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(linkTarget)}
        title="Link platform user"
        description="A linked user lets this person authenticate and receive person-scoped views."
        onClose={() => setLinkTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLinkTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={linkUser} loading={submitting}>
              Link user
            </Button>
          </>
        }
      >
        {linkTarget ? (
          <div className="stack">
            {actionError ? (
              <InfoNotice tone="warning">{actionError}</InfoNotice>
            ) : null}
            <InfoNotice>
              Linking <strong>{linkTarget.displayName}</strong> (
              {linkTarget.employeeCode}) to a platform user id.
            </InfoNotice>
            <FormField label="Platform user id" htmlFor="link-user-id">
              <TextInput
                id="link-user-id"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder="00000000-0000-4000-8000-000000000000"
                required
              />
            </FormField>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(managerTarget)}
        title="Set reporting manager"
        description="The manager relationship feeds escalation and approval routing."
        onClose={() => setManagerTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setManagerTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveManager} loading={submitting}>
              Save manager
            </Button>
          </>
        }
      >
        {managerTarget ? (
          <div className="stack">
            {actionError ? (
              <InfoNotice tone="warning">{actionError}</InfoNotice>
            ) : null}
            <FormField label="Person" htmlFor="manager-person">
              <Select
                id="manager-person"
                value={managerId}
                onChange={(event) => setManagerId(event.target.value)}
              >
                <option value="">No manager</option>
                {list
                  .filter((person) => person.id !== managerTarget.id)
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.employeeCode} · {person.displayName}
                    </option>
                  ))}
              </Select>
            </FormField>
            <p className="muted" style={{ fontSize: 12 }}>
              Updating manager for{" "}
              <strong>{managerTarget.displayName}</strong>.
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
