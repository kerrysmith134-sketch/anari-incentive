import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import type {
  PlatformMembership,
  PlatformTenant,
  PlatformUser,
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
}

function iso(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
}
