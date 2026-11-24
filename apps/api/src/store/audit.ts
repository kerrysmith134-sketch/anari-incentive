import { randomUUID } from "node:crypto";
import {
  type AuditEvent,
} from "@anari/domain";
import {
  sha256,
} from "@anari/policy-dsl";
import {
  now,
} from "../store-support.js";
import type { IncentiveStore } from "../store-interface.js";
import { StoreBase, type StoreCtor } from "./base.js";

export type AuditApi = Pick<
  IncentiveStore,
  | "listAuditEvents"
  | "verifyAuditChain"
  | "recordAuditEvent"
>;

/**
 * Mixes the audit domain into the store chain. Methods keep the exact
 * behaviour of the former monolithic Store implementation.
 */
export function withAudit<TBase extends StoreCtor<StoreBase>>(Base: TBase) {
  const Mixin = class AuditMixin extends Base implements AuditApi {

  async listAuditEvents(limit = 100): Promise<AuditEvent[]> {
    return [...this.auditLog]
      .reverse()
      .slice(0, Math.max(1, Math.min(limit, 500)))
      .map((event) => ({ ...event }));
  }

  async verifyAuditChain(): Promise<boolean> {
    let prevHash = "GENESIS";
    for (const event of this.auditLog) {
      if (event.prevHash !== prevHash) return false;
      const recomputed = sha256({
        sequence: event.sequence,
        action: event.action,
        objectType: event.objectType,
        objectId: event.objectId,
        actorType: event.actorType,
        actorId: event.actorId,
        beforeHash: event.beforeHash,
        afterHash: event.afterHash,
        reason: event.reason,
        prevHash: event.prevHash,
        occurredAt: event.occurredAt,
      });
      if (event.eventHash !== recomputed) return false;
      prevHash = event.eventHash;
    }
    return true;
  }

  async recordAuditEvent(input: {
    actorType: "USER" | "AGENT" | "SYSTEM" | "INTEGRATION";
    actorId?: string;
    action: string;
    objectType: string;
    objectId?: string;
    beforeHash?: string;
    afterHash?: string;
    reason?: string;
  }): Promise<void> {
    const sequence = this.auditLog.length + 1;
    const occurredAt = now();
    const prevHash = this.auditLog.at(-1)?.eventHash ?? "GENESIS";
    const eventHash = sha256({
      sequence,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      actorType: input.actorType,
      actorId: input.actorId,
      beforeHash: input.beforeHash,
      afterHash: input.afterHash,
      reason: input.reason,
      prevHash,
      occurredAt,
    });
    this.auditLog.push({
      id: randomUUID(),
      tenantId: this.tenantId,
      sequence,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      beforeHash: input.beforeHash,
      afterHash: input.afterHash,
      reason: input.reason,
      correlationId: input.actorId ?? randomUUID(),
      occurredAt,
      prevHash,
      eventHash,
    });
  }
  };
  return Mixin as unknown as TBase & StoreCtor<AuditApi>;
}
