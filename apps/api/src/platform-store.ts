import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import type {
  EmployeeNotice,
  NoticeAcknowledgementOverview,
  NoticeType,
  PlatformIdentity,
  PlatformMembership,
  PlatformOrgAssignment,
  PlatformOrgNode,
  PlatformPerson,
  PlatformTenant,
  PlatformUser,
  PolicyAcknowledgement,
} from "@anari/domain";
import { ConflictError, NotFoundError } from "./store.js";

export interface PlatformStore {
  createTenant(input: {
    name: string;
    slug: string;
    defaultTimezone?: string;
    defaultCurrency?: string;
  }): Promise<PlatformTenant>;
  listTenants(): Promise<PlatformTenant[]>;
  createUser(input: {
    authSubject: string;
    displayName: string;
    email?: string;
  }): Promise<PlatformUser>;
  listUsers(): Promise<PlatformUser[]>;
  addMembership(input: {
    tenantId: string;
    userId: string;
    roleCodes: string[];
  }): Promise<PlatformMembership>;
  listMemberships(tenantId: string): Promise<PlatformMembership[]>;
  createPerson(input: {
    tenantId: string;
    employeeCode: string;
    displayName: string;
    employmentStatus?: string;
    userId?: string;
  }): Promise<PlatformPerson>;
  listPersons(tenantId: string): Promise<PlatformPerson[]>;
  linkPersonUser(input: {
    tenantId: string;
    personId: string;
    userId: string;
  }): Promise<PlatformPerson>;
  /** Resolve the person and tenant roles behind a platform user. */
  resolveIdentity(input: {
    tenantId: string;
    userId: string;
  }): Promise<PlatformIdentity>;
  createOrgNode(input: {
    tenantId: string;
    name: string;
    nodeType: string;
    parentId?: string;
  }): Promise<PlatformOrgNode>;
  listOrgNodes(tenantId: string): Promise<PlatformOrgNode[]>;
  assignPersonOrg(input: {
    tenantId: string;
    personId: string;
    orgNodeId: string;
    validFrom: string;
    validTo?: string;
    allocation?: string;
  }): Promise<PlatformOrgAssignment>;
  listOrgAssignments(
    tenantId: string,
    personId?: string,
  ): Promise<PlatformOrgAssignment[]>;
  setPersonManager(input: {
    tenantId: string;
    personId: string;
    managerPersonId: string | null;
  }): Promise<PlatformPerson>;
  createNotice(input: {
    tenantId: string;
    noticeType: NoticeType;
    title: string;
    bodyRef: string;
    policyVersionId?: string;
    publishedAt?: string;
    effectiveFrom: string;
    acknowledgementRequired: boolean;
  }): Promise<EmployeeNotice>;
  listNotices(tenantId: string): Promise<EmployeeNotice[]>;
  getNotice(tenantId: string, noticeId: string): Promise<EmployeeNotice>;
  recordAcknowledgement(input: {
    tenantId: string;
    noticeId: string;
    personId: string;
    decision: "ACKNOWLEDGE" | "DECLINE";
    signatureRef?: string;
    declineReason?: string;
  }): Promise<PolicyAcknowledgement>;
  listAcknowledgements(
    tenantId: string,
    noticeId: string,
  ): Promise<NoticeAcknowledgementOverview>;
}

function now(): string {
  return new Date().toISOString();
}

function notFound(kind: string, id: string): never {
  throw new NotFoundError(`${kind} ${id} not found`);
}

export class MemoryPlatformStore implements PlatformStore {
  private readonly tenants = new Map<string, PlatformTenant>();
  private readonly users = new Map<string, PlatformUser>();
  private readonly memberships = new Map<string, PlatformMembership>();
  private readonly persons = new Map<string, PlatformPerson>();
  private readonly orgNodes = new Map<string, PlatformOrgNode>();
  private readonly orgAssignments = new Map<string, PlatformOrgAssignment>();
  private readonly notices = new Map<string, EmployeeNotice>();
  private readonly acknowledgements = new Map<string, PolicyAcknowledgement>();

  constructor(
    options: {
      /** Seed a demo tenant (and optional people) for memory-mode demos. */
      demoTenant?: {
        id: string;
        name: string;
        slug: string;
        persons?: Array<{
          id: string;
          employeeCode: string;
          displayName: string;
        }>;
      };
    } = {},
  ) {
    const demo = options.demoTenant;
    if (!demo) return;
    const createdAt = now();
    this.tenants.set(demo.id, {
      id: demo.id,
      name: demo.name,
      slug: demo.slug,
      status: "ACTIVE",
      defaultTimezone: "UTC",
      defaultCurrency: "CNY",
      createdAt,
    });
    for (const person of demo.persons ?? []) {
      this.persons.set(person.id, {
        id: person.id,
        tenantId: demo.id,
        employeeCode: person.employeeCode,
        displayName: person.displayName,
        employmentStatus: "ACTIVE",
        createdAt,
      });
    }
  }

  async createTenant(input: {
    name: string;
    slug: string;
    defaultTimezone?: string;
    defaultCurrency?: string;
  }): Promise<PlatformTenant> {
    if ([...this.tenants.values()].some((tenant) => tenant.slug === input.slug)) {
      throw new ConflictError(`tenant slug ${input.slug} already exists`);
    }
    const tenant: PlatformTenant = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      status: "ACTIVE",
      defaultTimezone: input.defaultTimezone ?? "UTC",
      defaultCurrency: input.defaultCurrency ?? "CNY",
      createdAt: now(),
    };
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  async listTenants(): Promise<PlatformTenant[]> {
    return [...this.tenants.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async createUser(input: {
    authSubject: string;
    displayName: string;
    email?: string;
  }): Promise<PlatformUser> {
    if (
      [...this.users.values()].some(
        (user) => user.authSubject === input.authSubject,
      )
    ) {
      throw new ConflictError(`auth subject ${input.authSubject} exists`);
    }
    const user: PlatformUser = {
      id: randomUUID(),
      email: input.email,
      displayName: input.displayName,
      authSubject: input.authSubject,
      status: "ACTIVE",
      createdAt: now(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async listUsers(): Promise<PlatformUser[]> {
    return [...this.users.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async addMembership(input: {
    tenantId: string;
    userId: string;
    roleCodes: string[];
  }): Promise<PlatformMembership> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (!this.users.has(input.userId)) notFound("User", input.userId);
    const key = `${input.tenantId}:${input.userId}`;
    const existing = [...this.memberships.values()].find(
      (membership) =>
        membership.tenantId === input.tenantId &&
        membership.userId === input.userId,
    );
    const membership: PlatformMembership = existing ?? {
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId,
      status: "ACTIVE",
      roleCodes: input.roleCodes,
      joinedAt: now(),
      createdAt: now(),
    };
    membership.roleCodes = input.roleCodes;
    membership.status = "ACTIVE";
    membership.joinedAt = membership.joinedAt ?? now();
    this.memberships.set(key, membership);
    return membership;
  }

  async listMemberships(tenantId: string): Promise<PlatformMembership[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.memberships.values()]
      .filter((membership) => membership.tenantId === tenantId)
      .map((membership) => {
        const user = this.users.get(membership.userId);
        return {
          ...membership,
          userDisplayName: user?.displayName,
          userEmail: user?.email,
        };
      });
  }

  async createPerson(input: {
    tenantId: string;
    employeeCode: string;
    displayName: string;
    employmentStatus?: string;
    userId?: string;
  }): Promise<PlatformPerson> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    if (input.userId && !this.users.has(input.userId)) {
      notFound("User", input.userId);
    }
    if (
      [...this.persons.values()].some(
        (person) =>
          person.tenantId === input.tenantId &&
          person.employeeCode === input.employeeCode,
      )
    ) {
      throw new ConflictError(
        `employee code ${input.employeeCode} already exists in tenant`,
      );
    }
    if (input.userId) this.assertUserNotLinked(input.tenantId, input.userId);
    const person: PlatformPerson = {
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId,
      employeeCode: input.employeeCode,
      displayName: input.displayName,
      employmentStatus: input.employmentStatus ?? "ACTIVE",
      createdAt: now(),
    };
    this.persons.set(person.id, person);
    return person;
  }

  async listPersons(tenantId: string): Promise<PlatformPerson[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.persons.values()]
      .filter((person) => person.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async linkPersonUser(input: {
    tenantId: string;
    personId: string;
    userId: string;
  }): Promise<PlatformPerson> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    if (!this.users.has(input.userId)) notFound("User", input.userId);
    this.assertUserNotLinked(input.tenantId, input.userId, person.id);
    person.userId = input.userId;
    return person;
  }

  async resolveIdentity(input: {
    tenantId: string;
    userId: string;
  }): Promise<PlatformIdentity> {
    const person = [...this.persons.values()].find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.userId === input.userId,
    );
    const membership = [...this.memberships.values()].find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.userId === input.userId,
    );
    return {
      userId: input.userId,
      personId: person?.id,
      roles: membership?.roleCodes ?? [],
    };
  }

  async createOrgNode(input: {
    tenantId: string;
    name: string;
    nodeType: string;
    parentId?: string;
  }): Promise<PlatformOrgNode> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const parent = input.parentId
      ? this.orgNodes.get(input.parentId)
      : undefined;
    if (input.parentId && (!parent || parent.tenantId !== input.tenantId)) {
      notFound("OrgNode", input.parentId);
    }
    const node: PlatformOrgNode = {
      id: randomUUID(),
      tenantId: input.tenantId,
      parentId: input.parentId,
      nodeType: input.nodeType,
      name: input.name,
      path: parent?.path ? `${parent.path}/${input.name}` : `/${input.name}`,
      active: true,
      createdAt: now(),
    };
    this.orgNodes.set(node.id, node);
    return node;
  }

  async listOrgNodes(tenantId: string): Promise<PlatformOrgNode[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.orgNodes.values()]
      .filter((node) => node.tenantId === tenantId)
      .sort((a, b) => (a.path ?? a.name).localeCompare(b.path ?? b.name));
  }

  async assignPersonOrg(input: {
    tenantId: string;
    personId: string;
    orgNodeId: string;
    validFrom: string;
    validTo?: string;
    allocation?: string;
  }): Promise<PlatformOrgAssignment> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    const node = this.orgNodes.get(input.orgNodeId);
    if (!node || node.tenantId !== input.tenantId) {
      notFound("OrgNode", input.orgNodeId);
    }
    if (input.validTo && input.validTo < input.validFrom) {
      throw new ConflictError("validTo must not be before validFrom");
    }
    if (input.allocation !== undefined) {
      const allocation = Number(input.allocation);
      if (!Number.isFinite(allocation) || allocation < 0 || allocation > 1) {
        throw new ConflictError("allocation must be between 0 and 1");
      }
    }
    const assignment: PlatformOrgAssignment = {
      id: randomUUID(),
      tenantId: input.tenantId,
      personId: input.personId,
      orgNodeId: input.orgNodeId,
      validFrom: input.validFrom,
      validTo: input.validTo,
      allocation: input.allocation,
      createdAt: now(),
    };
    this.orgAssignments.set(assignment.id, assignment);
    return assignment;
  }

  async listOrgAssignments(
    tenantId: string,
    personId?: string,
  ): Promise<PlatformOrgAssignment[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.orgAssignments.values()]
      .filter(
        (assignment) =>
          assignment.tenantId === tenantId &&
          (!personId || assignment.personId === personId),
      )
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  }

  async setPersonManager(input: {
    tenantId: string;
    personId: string;
    managerPersonId: string | null;
  }): Promise<PlatformPerson> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    if (input.managerPersonId === null) {
      person.managerPersonId = undefined;
      return person;
    }
    if (input.managerPersonId === input.personId) {
      throw new ConflictError("a person cannot be their own manager");
    }
    const manager = this.persons.get(input.managerPersonId);
    if (!manager || manager.tenantId !== input.tenantId) {
      notFound("Person", input.managerPersonId);
    }
    let current: PlatformPerson | undefined = manager;
    while (current?.managerPersonId) {
      if (current.managerPersonId === input.personId) {
        throw new ConflictError("manager assignment would create a cycle");
      }
      current = this.persons.get(current.managerPersonId);
    }
    person.managerPersonId = input.managerPersonId;
    return person;
  }

  async createNotice(input: {
    tenantId: string;
    noticeType: NoticeType;
    title: string;
    bodyRef: string;
    policyVersionId?: string;
    publishedAt?: string;
    effectiveFrom: string;
    acknowledgementRequired: boolean;
  }): Promise<EmployeeNotice> {
    if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
    const timestamp = now();
    const notice: EmployeeNotice = {
      id: randomUUID(),
      tenantId: input.tenantId,
      policyVersionId: input.policyVersionId,
      noticeType: input.noticeType,
      title: input.title,
      bodyRef: input.bodyRef,
      publishedAt: input.publishedAt ?? timestamp,
      effectiveFrom: input.effectiveFrom,
      acknowledgementRequired: input.acknowledgementRequired,
      createdAt: timestamp,
    };
    this.notices.set(notice.id, notice);
    return notice;
  }

  async listNotices(tenantId: string): Promise<EmployeeNotice[]> {
    if (!this.tenants.has(tenantId)) notFound("Tenant", tenantId);
    return [...this.notices.values()]
      .filter((notice) => notice.tenantId === tenantId)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }

  async getNotice(
    tenantId: string,
    noticeId: string,
  ): Promise<EmployeeNotice> {
    const notice = this.notices.get(noticeId);
    if (!notice || notice.tenantId !== tenantId) {
      notFound("Notice", noticeId);
    }
    return notice;
  }

  async recordAcknowledgement(input: {
    tenantId: string;
    noticeId: string;
    personId: string;
    decision: "ACKNOWLEDGE" | "DECLINE";
    signatureRef?: string;
    declineReason?: string;
  }): Promise<PolicyAcknowledgement> {
    const notice = await this.getNotice(input.tenantId, input.noticeId);
    const person = this.persons.get(input.personId);
    if (!person || person.tenantId !== input.tenantId) {
      notFound("Person", input.personId);
    }
    const key = `${notice.id}:${input.personId}`;
    const existing = this.acknowledgements.get(key);
    const timestamp = now();
    const acknowledgement: PolicyAcknowledgement = existing ?? {
      id: randomUUID(),
      tenantId: input.tenantId,
      noticeId: notice.id,
      personId: input.personId,
      createdAt: timestamp,
    };
    if (input.decision === "ACKNOWLEDGE") {
      acknowledgement.acknowledgedAt = timestamp;
      acknowledgement.signatureRef = input.signatureRef;
      acknowledgement.declinedAt = undefined;
      acknowledgement.declineReason = undefined;
    } else {
      acknowledgement.declinedAt = timestamp;
      acknowledgement.declineReason = input.declineReason;
      acknowledgement.acknowledgedAt = undefined;
      acknowledgement.signatureRef = undefined;
    }
    this.acknowledgements.set(key, acknowledgement);
    return acknowledgement;
  }

  async listAcknowledgements(
    tenantId: string,
    noticeId: string,
  ): Promise<NoticeAcknowledgementOverview> {
    const notice = await this.getNotice(tenantId, noticeId);
    const acknowledgements = [...this.acknowledgements.values()]
      .filter((candidate) => candidate.noticeId === notice.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const activePersonIds = new Set(
      [...this.persons.values()]
        .filter(
          (person) =>
            person.tenantId === tenantId &&
            person.employmentStatus === "ACTIVE",
        )
        .map((person) => person.id),
    );
    const activeAcknowledgements = acknowledgements.filter((candidate) =>
      activePersonIds.has(candidate.personId),
    );
    const acknowledgedCount = activeAcknowledgements.filter(
      (candidate) => candidate.acknowledgedAt,
    ).length;
    const declinedCount = activeAcknowledgements.filter(
      (candidate) => candidate.declinedAt,
    ).length;
    return {
      summary: {
        noticeId: notice.id,
        acknowledgementRequired: notice.acknowledgementRequired,
        personCount: activePersonIds.size,
        acknowledgedCount,
        declinedCount,
        pendingCount: Math.max(
          activePersonIds.size - acknowledgedCount - declinedCount,
          0,
        ),
        complete:
          !notice.acknowledgementRequired ||
          (activePersonIds.size > 0 &&
            acknowledgedCount >= activePersonIds.size),
      },
      acknowledgements,
    };
  }

  private assertUserNotLinked(
    tenantId: string,
    userId: string,
    exceptPersonId?: string,
  ): void {
    const linked = [...this.persons.values()].find(
      (person) =>
        person.tenantId === tenantId &&
        person.userId === userId &&
        person.id !== exceptPersonId,
    );
    if (linked) {
      throw new ConflictError(
        `user ${userId} is already linked to person ${linked.id}`,
      );
    }
  }
}

function iso(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoDate(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value.slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

function decimalText(value: string | null): string | undefined {
  if (value === null) return undefined;
  const text = String(value).trim();
  return text.includes(".")
    ? text.replace(/0+$/, "").replace(/\.$/, "")
    : text;
}

export class PgPlatformStore implements PlatformStore {
  constructor(private readonly pool: Pool) {}

  async createTenant(input: {
    name: string;
    slug: string;
    defaultTimezone?: string;
    defaultCurrency?: string;
  }): Promise<PlatformTenant> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO tenants
          (id, name, slug, default_timezone, default_currency)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [
          randomUUID(),
          input.name,
          input.slug,
          input.defaultTimezone ?? "UTC",
          input.defaultCurrency ?? "CNY",
        ],
      );
      return this.mapTenant(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(`tenant slug ${input.slug} already exists`);
      }
      throw error;
    }
  }

  async listTenants(): Promise<PlatformTenant[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM tenants ORDER BY created_at DESC",
    );
    return rows.map((row) => this.mapTenant(row));
  }

  async createUser(input: {
    authSubject: string;
    displayName: string;
    email?: string;
  }): Promise<PlatformUser> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO users (id, email, display_name, auth_subject)
         VALUES ($1,$2,$3,$4)
         RETURNING *`,
        [randomUUID(), input.email ?? null, input.displayName, input.authSubject],
      );
      return this.mapUser(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictError(
          `auth subject ${input.authSubject} already exists`,
        );
      }
      throw error;
    }
  }

  async listUsers(): Promise<PlatformUser[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM users ORDER BY created_at DESC",
    );
    return rows.map((row) => this.mapUser(row));
  }

  async addMembership(input: {
    tenantId: string;
    userId: string;
    roleCodes: string[];
  }): Promise<PlatformMembership> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO memberships
          (id, tenant_id, user_id, status, role_codes, joined_at)
         VALUES ($1,$2,$3,'ACTIVE',$4,now())
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET status='ACTIVE', role_codes=EXCLUDED.role_codes,
                       joined_at=COALESCE(memberships.joined_at, now()),
                       updated_at=now()
         RETURNING *`,
        [randomUUID(), input.tenantId, input.userId, input.roleCodes],
      );
      return this.mapMembership(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("tenant or user not found");
      }
      throw error;
    }
  }

  async listMemberships(tenantId: string): Promise<PlatformMembership[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT m.*, u.display_name AS user_display_name,
              u.email AS user_email
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1
        ORDER BY m.created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapMembership(row));
  }

  async createPerson(input: {
    tenantId: string;
    employeeCode: string;
    displayName: string;
    employmentStatus?: string;
    userId?: string;
  }): Promise<PlatformPerson> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO people
          (id, tenant_id, user_id, employee_code, display_name,
           employment_status)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.userId ?? null,
          input.employeeCode,
          input.displayName,
          input.employmentStatus ?? "ACTIVE",
        ],
      );
      return this.mapPerson(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const constraint = (error as { constraint?: string }).constraint;
      if (code === "23505") {
        if (constraint === "uq_people_tenant_user") {
          throw new ConflictError(
            `user ${input.userId} is already linked to a person in this tenant`,
          );
        }
        throw new ConflictError(
          `employee code ${input.employeeCode} already exists in tenant`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError("tenant or user not found");
      }
      throw error;
    }
  }

  async listPersons(tenantId: string): Promise<PlatformPerson[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      "SELECT * FROM people WHERE tenant_id=$1 ORDER BY created_at DESC",
      [tenantId],
    );
    return rows.map((row) => this.mapPerson(row));
  }

  async linkPersonUser(input: {
    tenantId: string;
    personId: string;
    userId: string;
  }): Promise<PlatformPerson> {
    try {
      const { rows } = await this.pool.query(
        `UPDATE people SET user_id=$3, updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.personId, input.userId],
      );
      if (!rows[0]) notFound("Person", input.personId);
      return this.mapPerson(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const constraint = (error as { constraint?: string }).constraint;
      if (code === "23505" && constraint === "uq_people_tenant_user") {
        throw new ConflictError(
          `user ${input.userId} is already linked to a person in this tenant`,
        );
      }
      if (code === "23503") {
        throw new NotFoundError(`User ${input.userId} not found`);
      }
      throw error;
    }
  }

  async resolveIdentity(input: {
    tenantId: string;
    userId: string;
  }): Promise<PlatformIdentity> {
    const [{ rows: personRows }, { rows: membershipRows }] = await Promise.all([
      this.pool.query(
        `SELECT id FROM people
          WHERE tenant_id=$1 AND user_id=$2
          ORDER BY created_at
          LIMIT 1`,
        [input.tenantId, input.userId],
      ),
      this.pool.query(
        `SELECT role_codes FROM memberships
          WHERE tenant_id=$1 AND user_id=$2`,
        [input.tenantId, input.userId],
      ),
    ]);
    return {
      userId: input.userId,
      personId: personRows[0]?.id ?? undefined,
      roles: membershipRows[0]?.role_codes ?? [],
    };
  }

  async createOrgNode(input: {
    tenantId: string;
    name: string;
    nodeType: string;
    parentId?: string;
  }): Promise<PlatformOrgNode> {
    let parentPath: string | undefined;
    if (input.parentId) {
      const { rows } = await this.pool.query(
        "SELECT path FROM org_nodes WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.parentId],
      );
      if (!rows[0]) notFound("OrgNode", input.parentId);
      parentPath = rows[0].path ?? undefined;
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO org_nodes
          (id, tenant_id, parent_id, node_type, name, path)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.parentId ?? null,
          input.nodeType,
          input.name,
          parentPath ? `${parentPath}/${input.name}` : `/${input.name}`,
        ],
      );
      return this.mapOrgNode(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("tenant or parent org node not found");
      }
      throw error;
    }
  }

  async listOrgNodes(tenantId: string): Promise<PlatformOrgNode[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM org_nodes
        WHERE tenant_id=$1
        ORDER BY COALESCE(path, name), name`,
      [tenantId],
    );
    return rows.map((row) => this.mapOrgNode(row));
  }

  async assignPersonOrg(input: {
    tenantId: string;
    personId: string;
    orgNodeId: string;
    validFrom: string;
    validTo?: string;
    allocation?: string;
  }): Promise<PlatformOrgAssignment> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO person_org_assignments
          (id, tenant_id, person_id, org_node_id, valid_from, valid_to,
           allocation)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.personId,
          input.orgNodeId,
          input.validFrom,
          input.validTo ?? null,
          input.allocation ?? null,
        ],
      );
      return this.mapOrgAssignment(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23503") {
        throw new NotFoundError("person or org node not found");
      }
      if (code === "23514") {
        throw new ConflictError(
          "assignment violates date or allocation constraints",
        );
      }
      throw error;
    }
  }

  async listOrgAssignments(
    tenantId: string,
    personId?: string,
  ): Promise<PlatformOrgAssignment[]> {
    await this.assertTenant(tenantId);
    const params: string[] = [tenantId];
    let sql =
      "SELECT * FROM person_org_assignments WHERE tenant_id=$1";
    if (personId) {
      params.push(personId);
      sql += " AND person_id=$2";
    }
    sql += " ORDER BY valid_from DESC, created_at DESC";
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => this.mapOrgAssignment(row));
  }

  async setPersonManager(input: {
    tenantId: string;
    personId: string;
    managerPersonId: string | null;
  }): Promise<PlatformPerson> {
    const { rows: personRows } = await this.pool.query(
      "SELECT id FROM people WHERE tenant_id=$1 AND id=$2",
      [input.tenantId, input.personId],
    );
    if (!personRows[0]) notFound("Person", input.personId);

    if (input.managerPersonId === null) {
      const { rows } = await this.pool.query(
        `UPDATE people SET manager_person_id=NULL, updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING *`,
        [input.tenantId, input.personId],
      );
      return this.mapPerson(rows[0]);
    }

    if (input.managerPersonId === input.personId) {
      throw new ConflictError("a person cannot be their own manager");
    }
    const { rows: managerRows } = await this.pool.query(
      "SELECT id FROM people WHERE tenant_id=$1 AND id=$2",
      [input.tenantId, input.managerPersonId],
    );
    if (!managerRows[0]) notFound("Person", input.managerPersonId);

    const { rows: cycleRows } = await this.pool.query(
      `WITH RECURSIVE chain AS (
         SELECT id, manager_person_id
           FROM people
          WHERE tenant_id=$1 AND id=$2
         UNION ALL
         SELECT p.id, p.manager_person_id
           FROM people p
           JOIN chain c
             ON p.id = c.manager_person_id AND p.tenant_id=$1
       )
       SELECT 1 FROM chain WHERE id=$3 LIMIT 1`,
      [input.tenantId, input.managerPersonId, input.personId],
    );
    if (cycleRows[0]) {
      throw new ConflictError("manager assignment would create a cycle");
    }
    const { rows } = await this.pool.query(
      `UPDATE people SET manager_person_id=$3, updated_at=now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING *`,
      [input.tenantId, input.personId, input.managerPersonId],
    );
    return this.mapPerson(rows[0]);
  }

  async createNotice(input: {
    tenantId: string;
    noticeType: NoticeType;
    title: string;
    bodyRef: string;
    policyVersionId?: string;
    publishedAt?: string;
    effectiveFrom: string;
    acknowledgementRequired: boolean;
  }): Promise<EmployeeNotice> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO employee_notices
          (id, tenant_id, policy_version_id, notice_type, title, body_ref,
           published_at, effective_from, acknowledgement_required)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()),$8,$9)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.policyVersionId ?? null,
          input.noticeType,
          input.title,
          input.bodyRef,
          input.publishedAt ?? null,
          input.effectiveFrom,
          input.acknowledgementRequired,
        ],
      );
      return this.mapNotice(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23503") {
        throw new NotFoundError("tenant or policy version not found");
      }
      throw error;
    }
  }

  async listNotices(tenantId: string): Promise<EmployeeNotice[]> {
    await this.assertTenant(tenantId);
    const { rows } = await this.pool.query(
      `SELECT * FROM employee_notices
        WHERE tenant_id=$1
        ORDER BY published_at DESC, created_at DESC`,
      [tenantId],
    );
    return rows.map((row) => this.mapNotice(row));
  }

  async getNotice(
    tenantId: string,
    noticeId: string,
  ): Promise<EmployeeNotice> {
    const { rows } = await this.pool.query(
      "SELECT * FROM employee_notices WHERE tenant_id=$1 AND id=$2",
      [tenantId, noticeId],
    );
    if (!rows[0]) notFound("Notice", noticeId);
    return this.mapNotice(rows[0]);
  }

  async recordAcknowledgement(input: {
    tenantId: string;
    noticeId: string;
    personId: string;
    decision: "ACKNOWLEDGE" | "DECLINE";
    signatureRef?: string;
    declineReason?: string;
  }): Promise<PolicyAcknowledgement> {
    const notice = await this.getNotice(input.tenantId, input.noticeId);
    const { rows: personRows } = await this.pool.query(
      "SELECT 1 FROM people WHERE tenant_id=$1 AND id=$2",
      [input.tenantId, input.personId],
    );
    if (!personRows[0]) notFound("Person", input.personId);
    const acknowledge = input.decision === "ACKNOWLEDGE";
    const { rows } = await this.pool.query(
      `INSERT INTO policy_acknowledgements
        (id, tenant_id, notice_id, person_id, acknowledged_at, signature_ref,
         declined_at, decline_reason)
       VALUES ($1,$2,$3,$4,
               CASE WHEN $5 THEN now() ELSE NULL END,
               $6,
               CASE WHEN $5 THEN NULL ELSE now() END,
               $7)
       ON CONFLICT (tenant_id, notice_id, person_id)
       DO UPDATE SET acknowledged_at = EXCLUDED.acknowledged_at,
                     signature_ref = EXCLUDED.signature_ref,
                     declined_at = EXCLUDED.declined_at,
                     decline_reason = EXCLUDED.decline_reason
       RETURNING *`,
      [
        randomUUID(),
        input.tenantId,
        notice.id,
        input.personId,
        acknowledge,
        acknowledge ? (input.signatureRef ?? null) : null,
        acknowledge ? null : (input.declineReason ?? null),
      ],
    );
    return this.mapAcknowledgement(rows[0]);
  }

  async listAcknowledgements(
    tenantId: string,
    noticeId: string,
  ): Promise<NoticeAcknowledgementOverview> {
    const notice = await this.getNotice(tenantId, noticeId);
    const [{ rows: acknowledgementRows }, { rows: personRows }] =
      await Promise.all([
        this.pool.query(
          `SELECT pa.*, p.employment_status AS person_employment_status
             FROM policy_acknowledgements pa
             JOIN people p
               ON p.tenant_id = pa.tenant_id AND p.id = pa.person_id
            WHERE pa.tenant_id=$1 AND pa.notice_id=$2
            ORDER BY pa.created_at DESC`,
          [tenantId, noticeId],
        ),
        this.pool.query(
          `SELECT count(*)::int AS count FROM people
            WHERE tenant_id=$1 AND employment_status='ACTIVE'`,
          [tenantId],
        ),
      ]);
    const acknowledgements = acknowledgementRows.map((row) =>
      this.mapAcknowledgement(row),
    );
    const activePersons = Number(personRows[0]?.count ?? 0);
    const activeAcknowledgements = acknowledgementRows.filter(
      (row) => row.person_employment_status === "ACTIVE",
    );
    const acknowledgedCount = activeAcknowledgements.filter(
      (row) => row.acknowledged_at,
    ).length;
    const declinedCount = activeAcknowledgements.filter(
      (row) => row.declined_at,
    ).length;
    return {
      summary: {
        noticeId: notice.id,
        acknowledgementRequired: notice.acknowledgementRequired,
        personCount: activePersons,
        acknowledgedCount,
        declinedCount,
        pendingCount: Math.max(
          activePersons - acknowledgedCount - declinedCount,
          0,
        ),
        complete:
          !notice.acknowledgementRequired ||
          (activePersons > 0 && acknowledgedCount >= activePersons),
      },
      acknowledgements,
    };
  }

  private async assertTenant(tenantId: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      "SELECT 1 FROM tenants WHERE id=$1",
      [tenantId],
    );
    if (!rowCount) notFound("Tenant", tenantId);
  }

  private mapTenant(row: QueryResultRow): PlatformTenant {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      defaultTimezone: row.default_timezone,
      defaultCurrency: String(row.default_currency).trim(),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapUser(row: QueryResultRow): PlatformUser {
    return {
      id: row.id,
      email: row.email ?? undefined,
      displayName: row.display_name,
      authSubject: row.auth_subject,
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapMembership(row: QueryResultRow): PlatformMembership {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      status: row.status,
      roleCodes: row.role_codes ?? [],
      joinedAt: iso(row.joined_at),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
      userDisplayName: row.user_display_name ?? undefined,
      userEmail: row.user_email ?? undefined,
    };
  }

  private mapPerson(row: QueryResultRow): PlatformPerson {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id ?? undefined,
      employeeCode: row.employee_code,
      displayName: row.display_name,
      employmentStatus: row.employment_status,
      managerPersonId: row.manager_person_id ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapOrgNode(row: QueryResultRow): PlatformOrgNode {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      parentId: row.parent_id ?? undefined,
      nodeType: row.node_type,
      name: row.name,
      path: row.path ?? undefined,
      active: row.active,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapOrgAssignment(row: QueryResultRow): PlatformOrgAssignment {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      orgNodeId: row.org_node_id,
      validFrom: isoDate(row.valid_from) ?? "",
      validTo: isoDate(row.valid_to),
      allocation: decimalText(row.allocation),
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapNotice(row: QueryResultRow): EmployeeNotice {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      policyVersionId: row.policy_version_id ?? undefined,
      noticeType: row.notice_type,
      title: row.title,
      bodyRef: row.body_ref,
      publishedAt: iso(row.published_at) ?? new Date().toISOString(),
      effectiveFrom: iso(row.effective_from) ?? new Date().toISOString(),
      acknowledgementRequired: row.acknowledgement_required,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }

  private mapAcknowledgement(row: QueryResultRow): PolicyAcknowledgement {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      noticeId: row.notice_id,
      personId: row.person_id,
      acknowledgedAt: iso(row.acknowledged_at),
      signatureRef: row.signature_ref ?? undefined,
      declinedAt: iso(row.declined_at),
      declineReason: row.decline_reason ?? undefined,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
}
