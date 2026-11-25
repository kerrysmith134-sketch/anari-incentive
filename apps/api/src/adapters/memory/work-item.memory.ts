/**
 * Ticketing 工作项内存 Adapter（114）：来源感知 upsert + append-only 状态历史 +
 * 多人贡献。语义与 PostgreSQL Adapter 保持一致（幂等键相同）。
 */
import { randomUUID } from "node:crypto";
import {
  assertValidWorkItemImport,
  contributionKey,
  hasStatusTransition,
  normalizeIsoTimestamp,
  planStatusTransition,
  workItemEventKey,
  type WorkItem,
  type WorkItemContribution,
  type WorkItemContributionInput,
  type WorkItemEvent,
  type WorkItemEventInput,
  type WorkItemFilter,
  type WorkItemImportInput,
  type WorkItemImportResult,
} from "@anari/domain";
import { notFound, now } from "../shared.js";
import type { WorkItemPort } from "../../store-ports.js";
import type {
  MemoryPlatformStoreBase,
  MemoryPlatformStoreBaseShape,
} from "./base.memory.js";

export function MemoryWorkItemMixin(
  Base: abstract new (
    ...args: ConstructorParameters<typeof MemoryPlatformStoreBase>
  ) => MemoryPlatformStoreBaseShape,
) {
  return class extends Base implements WorkItemPort {
    private readonly workItems = new Map<string, WorkItem>();
    private readonly workItemEvents = new Map<string, WorkItemEvent[]>();
    private readonly workItemContributions = new Map<
      string,
      WorkItemContribution[]
    >();

    private findWorkItem(tenantId: string, workItemId: string): WorkItem {
      const workItem = this.workItems.get(workItemId);
      if (!workItem || workItem.tenantId !== tenantId) {
        notFound("WorkItem", workItemId);
      }
      return workItem;
    }

    /** 事件去重键集合（append-only：同转换/同时间/同执行人只记一次）。 */
    private eventKeysOf(workItemId: string): Set<string> {
      return new Set(
        (this.workItemEvents.get(workItemId) ?? []).map((event) =>
          workItemEventKey({
            fromStatus: event.fromStatus,
            toStatus: event.toStatus,
            occurredAt: event.occurredAt,
            actorPersonId: event.actorPersonId,
          }),
        ),
      );
    }

    private appendEvent(
      tenantId: string,
      workItemId: string,
      input: WorkItemEventInput,
      createdAt: string,
      keys: Set<string>,
    ): WorkItemEvent | undefined {
      const normalized: WorkItemEventInput = {
        ...input,
        occurredAt: normalizeIsoTimestamp(input.occurredAt),
      };
      const key = workItemEventKey(normalized);
      if (keys.has(key)) return undefined;
      const event: WorkItemEvent = {
        id: randomUUID(),
        tenantId,
        workItemId,
        fromStatus: normalized.fromStatus,
        toStatus: normalized.toStatus,
        occurredAt: normalized.occurredAt ?? createdAt,
        actorPersonId: normalized.actorPersonId,
        createdAt,
      };
      const list = this.workItemEvents.get(workItemId) ?? [];
      list.push(event);
      this.workItemEvents.set(workItemId, list);
      keys.add(key);
      return event;
    }

    private upsertContribution(
      tenantId: string,
      workItemId: string,
      input: WorkItemContributionInput,
      timestamp: string,
    ): WorkItemContribution {
      const list = this.workItemContributions.get(workItemId) ?? [];
      const existing = list.find(
        (entry) =>
          contributionKey(entry.personId, entry.role) ===
          contributionKey(input.personId, input.role),
      );
      if (existing) {
        if (input.weight !== undefined) existing.weight = input.weight;
        if (input.ratio !== undefined) existing.ratio = input.ratio;
        existing.updatedAt = timestamp;
        return existing;
      }
      const contribution: WorkItemContribution = {
        id: randomUUID(),
        tenantId,
        workItemId,
        personId: input.personId,
        role: input.role,
        weight: input.weight,
        ratio: input.ratio,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      list.push(contribution);
      this.workItemContributions.set(workItemId, list);
      return contribution;
    }

    async importWorkItem(
      input: WorkItemImportInput,
    ): Promise<WorkItemImportResult> {
      assertValidWorkItemImport(input);
      if (!this.tenants.has(input.tenantId)) {
        notFound("Tenant", input.tenantId);
      }
      const timestamp = now();
      const stored = [...this.workItems.values()].find(
        (item) =>
          item.tenantId === input.tenantId &&
          item.sourceSystem === input.sourceSystem &&
          item.externalId === input.externalId,
      );
      const appended: WorkItemEvent[] = [];
      const upserted: WorkItemContribution[] = [];
      const keys = stored
        ? this.eventKeysOf(stored.id)
        : new Set<string>();
      let workItem: WorkItem;
      let created: boolean;

      if (stored) {
        created = false;
        const transition = hasStatusTransition(
          input.events,
          stored.status,
          input.status,
        )
          ? null
          : planStatusTransition(stored.status, input.status, timestamp);
        stored.projectId = input.projectId;
        stored.title = input.title;
        stored.type = input.type;
        if (input.priority !== undefined) stored.priority = input.priority;
        stored.status = input.status;
        // 缺省可选字段视为“本次来源未提供”，保留既有值（部分快照兼容）。
        if (input.assigneePersonId !== undefined) {
          stored.assigneePersonId = input.assigneePersonId;
        }
        if (input.reporterPersonId !== undefined) {
          stored.reporterPersonId = input.reporterPersonId;
        }
        if (input.startedAt !== undefined) {
          stored.startedAt = normalizeIsoTimestamp(input.startedAt);
        }
        if (input.dueAt !== undefined) {
          stored.dueAt = normalizeIsoTimestamp(input.dueAt);
        }
        if (input.completedAt !== undefined) {
          stored.completedAt = normalizeIsoTimestamp(input.completedAt);
        }
        if (input.weight !== undefined) stored.weight = input.weight;
        if (input.currency !== undefined) {
          stored.currency = input.currency.toUpperCase();
        }
        if (input.amount !== undefined) stored.amount = input.amount;
        if (input.payload !== undefined) stored.payload = input.payload;
        stored.updatedAt = timestamp;
        workItem = stored;
        for (const event of input.events ?? []) {
          const appendedEvent = this.appendEvent(
            input.tenantId,
            stored.id,
            event,
            timestamp,
            keys,
          );
          if (appendedEvent) appended.push(appendedEvent);
        }
        if (transition) {
          const appendedEvent = this.appendEvent(
            input.tenantId,
            stored.id,
            transition,
            timestamp,
            keys,
          );
          if (appendedEvent) appended.push(appendedEvent);
        }
      } else {
        created = true;
        workItem = {
          id: randomUUID(),
          tenantId: input.tenantId,
          sourceSystem: input.sourceSystem,
          externalId: input.externalId,
          projectId: input.projectId,
          title: input.title,
          type: input.type,
          priority: input.priority,
          status: input.status,
          assigneePersonId: input.assigneePersonId,
          reporterPersonId: input.reporterPersonId,
          startedAt: normalizeIsoTimestamp(input.startedAt),
          dueAt: normalizeIsoTimestamp(input.dueAt),
          completedAt: normalizeIsoTimestamp(input.completedAt),
          weight: input.weight,
          currency: input.currency?.toUpperCase(),
          amount: input.amount,
          payload: input.payload ?? {},
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        this.workItems.set(workItem.id, workItem);
        for (const event of input.events ?? []) {
          const appendedEvent = this.appendEvent(
            input.tenantId,
            workItem.id,
            event,
            timestamp,
            keys,
          );
          if (appendedEvent) appended.push(appendedEvent);
        }
      }

      for (const contribution of input.contributions ?? []) {
        upserted.push(
          this.upsertContribution(
            input.tenantId,
            workItem.id,
            contribution,
            timestamp,
          ),
        );
      }
      return { workItem, created, events: appended, contributions: upserted };
    }

    async listWorkItems(
      tenantId: string,
      filter?: WorkItemFilter,
    ): Promise<WorkItem[]> {
      const contributionIndex = new Map<string, Set<string>>();
      for (const [workItemId, contributions] of this.workItemContributions) {
        contributionIndex.set(
          workItemId,
          new Set(contributions.map((entry) => entry.personId)),
        );
      }
      return [...this.workItems.values()]
        .filter((workItem) => {
          if (workItem.tenantId !== tenantId) return false;
          if (filter?.projectId && workItem.projectId !== filter.projectId) {
            return false;
          }
          if (filter?.personId) {
            const personId = filter.personId;
            const contributes =
              contributionIndex.get(workItem.id)?.has(personId) ?? false;
            if (workItem.assigneePersonId !== personId && !contributes) {
              return false;
            }
          }
          return true;
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    async getWorkItem(
      tenantId: string,
      workItemId: string,
    ): Promise<{
      workItem: WorkItem;
      events: WorkItemEvent[];
      contributions: WorkItemContribution[];
    }> {
      const workItem = this.findWorkItem(tenantId, workItemId);
      return {
        workItem,
        events: [...(this.workItemEvents.get(workItemId) ?? [])].sort(
          (left, right) =>
            left.occurredAt.localeCompare(right.occurredAt) ||
            left.createdAt.localeCompare(right.createdAt),
        ),
        contributions: [...(this.workItemContributions.get(workItemId) ?? [])],
      };
    }
  };
}
