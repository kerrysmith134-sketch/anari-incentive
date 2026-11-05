import type { PlatformStore } from "./platform-store.js";
import {
  FeishuDirectoryClient,
  type FeishuDirectoryUser,
} from "@anari/connectors";

/**
 * Feishu directory → platform org sync.
 *
 * Policies (feishu-integration skill):
 * - Job titles never influence roles; provisioning gives the basic
 *   `employee` role only. Elevated roles are always granted by an admin.
 * - `allowCreate=false` (default) only links/updates existing users;
 *   `allowCreate=true` provisions new people with the basic role.
 * - One person may sit in several departments; everything is keyed by
 *   open_id / external department id so re-running is idempotent.
 * - Deactivated Feishu accounts are reported, never auto-deactivated here.
 */

export interface FeishuSyncOptions {
  tenantId: string;
  appId: string;
  appSecret: string;
  dryRun: boolean;
  allowCreate: boolean;
  fetchImpl?: typeof fetch;
}

export interface FeishuSyncResult {
  dryRun: boolean;
  allowCreate: boolean;
  departments: Array<{
    externalId: string;
    name: string;
    action: "CREATE" | "EXISTS";
    nodeId?: string;
  }>;
  users: Array<{
    openId: string;
    name: string;
    email?: string;
    jobTitle?: string;
    action:
      | "PROVISION"
      | "LINK_PERSON"
      | "EXISTS"
      | "SKIPPED_NO_PROVISIONING"
      | "SKIPPED_SEAT_LIMIT"
      | "ERROR";
    userId?: string;
    personId?: string;
  }>;
  managersLinked: number;
  orgAssignmentsCreated: number;
  warnings: string[];
}

function today(): string {
  return new Date().toISOString();
}

export async function syncFeishuDirectory(
  platformStore: PlatformStore,
  options: FeishuSyncOptions,
): Promise<FeishuSyncResult> {
  const client = new FeishuDirectoryClient({
    appId: options.appId,
    appSecret: options.appSecret,
    fetchImpl: options.fetchImpl,
  });

  const result: FeishuSyncResult = {
    dryRun: options.dryRun,
    allowCreate: options.allowCreate,
    departments: [],
    users: [],
    managersLinked: 0,
    orgAssignmentsCreated: 0,
    warnings: [],
  };

  // ---- departments (parents first) ------------------------------------
  const feishuDepartments = await client.departments();
  const existingNodes = await platformStore.listOrgNodes(options.tenantId);
  const nodeByExternalId = new Map(
    existingNodes
      .filter((node) => node.externalId)
      .map((node) => [node.externalId!, node]),
  );

  const pending = [...feishuDepartments];
  let progress = true;
  while (pending.length > 0 && progress) {
    progress = false;
    for (let index = 0; index < pending.length; index += 1) {
      const department = pending[index]!;
      const parentResolved =
        !department.parentDepartmentId ||
        nodeByExternalId.has(department.parentDepartmentId);
      if (!parentResolved) continue;
      const existing = nodeByExternalId.get(department.openDepartmentId);
      if (existing) {
        result.departments.push({
          externalId: department.openDepartmentId,
          name: department.name,
          action: "EXISTS",
          nodeId: existing.id,
        });
      } else if (options.dryRun) {
        // Track the would-be node so children can resolve their parent.
        nodeByExternalId.set(department.openDepartmentId, {
          id: `preview:${department.openDepartmentId}`,
          tenantId: options.tenantId,
          nodeType: "DEPARTMENT",
          name: department.name,
          path: `/${department.name}`,
          active: true,
          externalId: department.openDepartmentId,
          createdAt: today(),
        });
        result.departments.push({
          externalId: department.openDepartmentId,
          name: department.name,
          action: "CREATE",
        });
      } else {
        const parent = department.parentDepartmentId
          ? nodeByExternalId.get(department.parentDepartmentId)
          : undefined;
        const created = await platformStore.createOrgNode({
          tenantId: options.tenantId,
          name: department.name,
          nodeType: "DEPARTMENT",
          parentId: parent?.id,
          externalId: department.openDepartmentId,
        });
        nodeByExternalId.set(department.openDepartmentId, created);
        result.departments.push({
          externalId: department.openDepartmentId,
          name: department.name,
          action: "CREATE",
          nodeId: created.id,
        });
      }
      pending.splice(index, 1);
      index -= 1;
      progress = true;
    }
  }
  for (const department of pending) {
    result.warnings.push(
      `department ${department.openDepartmentId} (${department.name}) has an unresolved parent ${department.parentDepartmentId}; skipped`,
    );
  }

  // ---- users -----------------------------------------------------------
  const directoryUsers = await client.users(
    feishuDepartments.map((department) => department.openDepartmentId),
  );
  const platformUsers = await platformStore.listUsers();
  const persons = await platformStore.listPersons(options.tenantId);
  const personByOpenId = new Map<string, string>();
  for (const person of persons) {
    const user = platformUsers.find(
      (candidate) => candidate.id === person.userId,
    );
    if (user?.authSubject.startsWith("feishu:")) {
      personByOpenId.set(
        user.authSubject.slice("feishu:".length),
        person.id,
      );
    }
  }

  // Seat-limit gate (billing): only ACTIVE people consume seats; provisioning
  // via directory sync must respect the same cap as the admin API.
  const subscription = await platformStore.getTenantSubscription(
    options.tenantId,
  );
  let seatsRemaining: number | null = null;
  if (subscription && subscription.status !== "CANCELED") {
    const plan = (await platformStore.listSubscriptionPlans()).find(
      (candidate) => candidate.code === subscription.planCode,
    );
    if (plan && plan.seatLimit >= 0) {
      const active = persons.filter(
        (candidate) => candidate.employmentStatus === "ACTIVE",
      ).length;
      seatsRemaining = Math.max(plan.seatLimit - active, 0);
    }
  }

  for (const feishuUser of directoryUsers) {
    const entry: FeishuSyncResult["users"][number] = {
      openId: feishuUser.openId,
      name: feishuUser.name,
      email: feishuUser.email,
      jobTitle: feishuUser.jobTitle,
      action: "EXISTS",
    };
    result.users.push(entry);

    const authSubject = `feishu:${feishuUser.openId}`;
    let user = platformUsers.find(
      (candidate) => candidate.authSubject === authSubject,
    );
    let personId = personByOpenId.get(feishuUser.openId);

    const consumeSeat = (): boolean => {
      if (seatsRemaining === null) return true;
      if (seatsRemaining <= 0) return false;
      seatsRemaining -= 1;
      return true;
    };

    try {
    if (!user && !personId) {
      if (!options.allowCreate) {
        entry.action = "SKIPPED_NO_PROVISIONING";
        continue;
      }
      if (options.dryRun) {
        entry.action = "PROVISION";
        continue;
      }
      if (!consumeSeat()) {
        entry.action = "SKIPPED_SEAT_LIMIT";
        continue;
      }
      user = await platformStore.createUser({
        authSubject,
        displayName: feishuUser.name,
        email: feishuUser.email,
      });
      platformUsers.push(user);
      await platformStore.addMembership({
        tenantId: options.tenantId,
        userId: user.id,
        roleCodes: ["employee"],
      });
      const person = await platformStore.createPerson({
        tenantId: options.tenantId,
        employeeCode:
          feishuUser.employeeNo ??
          `FS-${feishuUser.openId.replace(/-/g, "").slice(-8)}`,
        displayName: feishuUser.name,
        userId: user.id,
      });
      personId = person.id;
      personByOpenId.set(feishuUser.openId, personId);
      entry.action = "PROVISION";
      entry.userId = user.id;
      entry.personId = personId;
    } else if (user && !personId) {
      if (options.dryRun) {
        entry.action = "LINK_PERSON";
        entry.userId = user.id;
        continue;
      }
      if (!consumeSeat()) {
        entry.action = "SKIPPED_SEAT_LIMIT";
        continue;
      }
      const person = await platformStore.createPerson({
        tenantId: options.tenantId,
        employeeCode:
          feishuUser.employeeNo ??
          `FS-${feishuUser.openId.replace(/-/g, "").slice(-8)}`,
        displayName: feishuUser.name,
        userId: user.id,
      });
      personId = person.id;
      personByOpenId.set(feishuUser.openId, personId);
      entry.action = "LINK_PERSON";
      entry.userId = user.id;
      entry.personId = personId;
    } else {
      entry.userId = user?.id;
      entry.personId = personId;
    }

    if (!personId || options.dryRun) continue;

    // Org assignments (one per mapped department; dedupe by node).
    const existingAssignments = await platformStore.listOrgAssignments(
      options.tenantId,
      personId,
    );
    const assignedNodeIds = new Set(
      existingAssignments.map((assignment) => assignment.orgNodeId),
    );
    for (const departmentId of feishuUser.departmentIds) {
      const node = nodeByExternalId.get(departmentId);
      if (!node) continue;
      if (assignedNodeIds.has(node.id)) continue;
      await platformStore.assignPersonOrg({
        tenantId: options.tenantId,
        personId,
        orgNodeId: node.id,
        validFrom: today(),
      });
      assignedNodeIds.add(node.id);
      result.orgAssignmentsCreated += 1;
    }
    } catch (error) {
      entry.action = "ERROR";
      result.warnings.push(
        `${feishuUser.openId} (${feishuUser.name}): ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
      continue;
    }
  }

  // ---- reporting lines (leader open_id → person) ------------------------
  for (const feishuUser of directoryUsers) {
    if (!feishuUser.leaderUserId) continue;
    const personId = personByOpenId.get(feishuUser.openId);
    const leaderPersonId = personByOpenId.get(feishuUser.leaderUserId);
    if (!personId || !leaderPersonId || personId === leaderPersonId) {
      if (personId && !leaderPersonId && !options.dryRun) {
        result.warnings.push(
          `leader ${feishuUser.leaderUserId} for ${feishuUser.name} is not in the synced directory; reporting line skipped`,
        );
      }
      continue;
    }
    if (options.dryRun) {
      result.managersLinked += 1;
      continue;
    }
    try {
      await platformStore.setPersonManager({
        tenantId: options.tenantId,
        personId,
        managerPersonId: leaderPersonId,
      });
      result.managersLinked += 1;
    } catch (error) {
      result.warnings.push(
        `reporting line ${feishuUser.name} → leader skipped: ${
          error instanceof Error ? error.message : "unknown error"
        } (possible cycle)`,
      );
    }
  }

  return result;
}

export type { FeishuDirectoryUser };
