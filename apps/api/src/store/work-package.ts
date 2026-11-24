import { randomUUID } from "node:crypto";
import {
  assertTransition,
  workPackageTransitions,
  type CommitmentSnapshot,
  type EvidenceLink,
  type EvidenceNode,
  type IngestionBatch,
  type IngestionResult,
  type WorkPackage,
} from "@anari/domain";
import type {
  CreateEvidenceInput,
  CreateEvidenceLinkInput,
  CreateWorkPackageInput,
} from "@anari/contracts";
import {
  sha256,
} from "@anari/policy-dsl";
import {
  ConflictError,
  now,
  notFound,
} from "../store-support.js";
import type { IncentiveStore } from "../store-interface.js";
import { StoreBase, type StoreCtor } from "./base.js";

export type WorkPackageApi = Pick<
  IncentiveStore,
  | "createWorkPackage"
  | "getWorkPackage"
  | "listWorkPackages"
  | "commitWorkPackage"
  | "listWorkPackageVersions"
  | "startWorkPackage"
  | "submitWorkPackage"
  | "acceptWorkPackage"
  | "acceptWorkPackagesBatch"
  | "rejectWorkPackage"
  | "createEvidence"
  | "ingestEvents"
  | "listEvidence"
  | "linkEvidence"
  | "listEvidenceLinks"
>;

/**
 * Mixes the work-package domain into the store chain. Methods keep the exact
 * behaviour of the former monolithic Store implementation.
 */
export function withWorkPackage<TBase extends StoreCtor<StoreBase>>(Base: TBase) {
  const Mixin = class WorkPackageMixin extends Base implements WorkPackageApi {

  async createWorkPackage(
    input: CreateWorkPackageInput,
  ): Promise<WorkPackage> {
    const timestamp = now();
    const workPackage: WorkPackage = {
      id: randomUUID(),
      tenantId: this.tenantId,
      title: input.title,
      objective: input.objective,
      packageType: input.packageType ?? "ORDER_DELIVERY",
      ownerPersonId: input.ownerPersonId,
      status: "DRAFT",
      acceptanceCriteria: input.acceptanceCriteria,
      members: input.members,
      dueAt: input.dueAt,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.workPackages.set(workPackage.id, workPackage);
    return workPackage;
  }

  async getWorkPackage(id: string): Promise<WorkPackage> {
    return this.workPackages.get(id) ?? notFound("WorkPackage", id);
  }

  async listWorkPackages(): Promise<WorkPackage[]> {
    return [...this.workPackages.values()];
  }

  async commitWorkPackage(
    id: string,
    expectedVersion: number,
  ): Promise<WorkPackage> {
    const workPackage = await this.getWorkPackage(id);
    if (workPackage.version !== expectedVersion) {
      throw new ConflictError(
        `expected version ${expectedVersion}, actual ${workPackage.version}`,
      );
    }
    assertTransition(
      workPackageTransitions,
      "WorkPackage",
      workPackage.status,
      "COMMITTED",
    );
    const snapshot: CommitmentSnapshot = {
      snapshotId: randomUUID(),
      workPackageId: workPackage.id,
      capturedAt: now(),
      title: workPackage.title,
      objective: workPackage.objective,
      ownerPersonId: workPackage.ownerPersonId,
      members: structuredClone(workPackage.members),
      acceptanceCriteria: [...workPackage.acceptanceCriteria],
      dueAt: workPackage.dueAt,
      contentHash: sha256({
        title: workPackage.title,
        objective: workPackage.objective,
        ownerPersonId: workPackage.ownerPersonId,
        members: workPackage.members,
        acceptanceCriteria: workPackage.acceptanceCriteria,
        dueAt: workPackage.dueAt,
      }),
    };
    workPackage.commitmentSnapshot = snapshot;
    workPackage.status = "COMMITTED";
    workPackage.version += 1;
    workPackage.updatedAt = now();
    const snapshots = this.workPackageSnapshots.get(id) ?? [];
    snapshots.push(structuredClone(snapshot));
    this.workPackageSnapshots.set(id, snapshots);
    return workPackage;
  }

  async listWorkPackageVersions(id: string): Promise<CommitmentSnapshot[]> {
    await this.getWorkPackage(id);
    return (this.workPackageSnapshots.get(id) ?? []).map((snapshot) =>
      structuredClone(snapshot),
    );
  }

  private assertWorkPackageVersion(
    workPackage: WorkPackage,
    expectedVersion?: number,
  ): void {
    if (
      expectedVersion !== undefined &&
      workPackage.version !== expectedVersion
    ) {
      throw new ConflictError(
        `expected version ${expectedVersion}, actual ${workPackage.version}`,
      );
    }
  }

  async startWorkPackage(
    id: string,
    expectedVersion?: number,
  ): Promise<WorkPackage> {
    const workPackage = await this.getWorkPackage(id);
    this.assertWorkPackageVersion(workPackage, expectedVersion);
    assertTransition(
      workPackageTransitions,
      "WorkPackage",
      workPackage.status,
      "IN_PROGRESS",
    );
    workPackage.status = "IN_PROGRESS";
    workPackage.version += 1;
    workPackage.updatedAt = now();
    return workPackage;
  }

  async submitWorkPackage(
    id: string,
    expectedVersion?: number,
  ): Promise<WorkPackage> {
    const workPackage = await this.getWorkPackage(id);
    this.assertWorkPackageVersion(workPackage, expectedVersion);
    assertTransition(
      workPackageTransitions,
      "WorkPackage",
      workPackage.status,
      "SUBMITTED",
    );
    workPackage.status = "SUBMITTED";
    workPackage.version += 1;
    workPackage.updatedAt = now();
    return workPackage;
  }

  async acceptWorkPackage(
    id: string,
    reviewerPersonId: string,
    expectedVersion?: number,
  ): Promise<WorkPackage> {
    const workPackage = await this.getWorkPackage(id);
    this.assertWorkPackageVersion(workPackage, expectedVersion);
    if (reviewerPersonId === workPackage.ownerPersonId) {
      throw new ConflictError(
        "the work-package owner cannot accept their own delivery",
      );
    }
    assertTransition(
      workPackageTransitions,
      "WorkPackage",
      workPackage.status,
      "ACCEPTED",
    );
    workPackage.status = "ACCEPTED";
    workPackage.version += 1;
    workPackage.updatedAt = now();
    return workPackage;
  }

  async acceptWorkPackagesBatch(
    items: Array<{ id: string; reviewerPersonId: string }>,
  ): Promise<WorkPackage[]> {
    const snapshot = new Map(
      [...this.workPackages].map(([id, workPackage]) => [
        id,
        structuredClone(workPackage),
      ]),
    );
    try {
      const accepted: WorkPackage[] = [];
      for (const item of items) {
        accepted.push(
          await this.acceptWorkPackage(item.id, item.reviewerPersonId),
        );
      }
      return accepted;
    } catch (error) {
      this.workPackages.clear();
      for (const [id, workPackage] of snapshot) {
        this.workPackages.set(id, workPackage);
      }
      throw error;
    }
  }

  async rejectWorkPackage(
    id: string,
    reviewerPersonId: string,
    reason: string,
    expectedVersion?: number,
  ): Promise<WorkPackage> {
    const workPackage = await this.getWorkPackage(id);
    this.assertWorkPackageVersion(workPackage, expectedVersion);
    if (reviewerPersonId === workPackage.ownerPersonId) {
      throw new ConflictError(
        "the work-package owner cannot reject their own delivery",
      );
    }
    assertTransition(
      workPackageTransitions,
      "WorkPackage",
      workPackage.status,
      "REJECTED",
    );
    workPackage.status = "REJECTED";
    workPackage.version += 1;
    workPackage.updatedAt = now();
    void reason;
    return workPackage;
  }

  async createEvidence(input: CreateEvidenceInput): Promise<EvidenceNode> {
    if (input.supersedesId && !this.evidence.has(input.supersedesId)) {
      notFound("EvidenceNode", input.supersedesId);
    }
    const node: EvidenceNode = {
      id: randomUUID(),
      tenantId: this.tenantId,
      evidenceType: input.evidenceType,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      sourceSystem: input.sourceSystem,
      sourceUri: input.sourceUri,
      observedAt: input.observedAt ?? now(),
      qualityStatus: input.qualityStatus ?? "UNVERIFIED",
      normalizedPayload: input.normalizedPayload,
      payloadHash: sha256(input.normalizedPayload),
      supersedesId: input.supersedesId,
      submittedBy: input.submittedBy,
      createdAt: now(),
    };
    this.evidence.set(node.id, node);
    return node;
  }

  async ingestEvents(batch: IngestionBatch): Promise<IngestionResult> {
    let accepted = 0;
    let duplicates = 0;
    const evidenceIds: string[] = [];
    for (const event of batch.events) {
      const version = event.sourceEventVersion ?? "1";
      const key = `${batch.sourceSystem}:${event.sourceRecordId}:${version}`;
      if (this.ingestedKeys.has(key)) {
        duplicates += 1;
        continue;
      }
      this.ingestedKeys.add(key);
      const node = await this.createEvidence({
        evidenceType: event.evidenceType,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        sourceSystem: batch.sourceSystem,
        sourceUri: event.sourceUri,
        observedAt: event.occurredAt ?? now(),
        qualityStatus: event.qualityStatus,
        normalizedPayload: event.payload,
      });
      accepted += 1;
      evidenceIds.push(node.id);
    }
    return { accepted, duplicates, evidenceIds };
  }

  async listEvidence(
    subjectType?: string,
    subjectId?: string,
  ): Promise<EvidenceNode[]> {
    return [...this.evidence.values()].filter(
      (node) =>
        (!subjectType || node.subjectType === subjectType) &&
        (!subjectId || node.subjectId === subjectId),
    );
  }

  async linkEvidence(
    fromEvidenceId: string,
    input: CreateEvidenceLinkInput,
  ): Promise<EvidenceLink> {
    if (!this.evidence.has(fromEvidenceId)) {
      notFound("EvidenceNode", fromEvidenceId);
    }
    if (!this.evidence.has(input.toEvidenceId)) {
      notFound("EvidenceNode", input.toEvidenceId);
    }
    const existing = [...this.evidenceLinks.values()].find(
      (link) =>
        link.fromEvidenceId === fromEvidenceId &&
        link.toEvidenceId === input.toEvidenceId &&
        link.relationType === input.relationType,
    );
    if (existing) return existing;
    const link: EvidenceLink = {
      id: randomUUID(),
      tenantId: this.tenantId,
      fromEvidenceId,
      toEvidenceId: input.toEvidenceId,
      relationType: input.relationType,
      rationale: input.rationale,
      createdAt: now(),
    };
    this.evidenceLinks.set(link.id, link);
    return link;
  }

  async listEvidenceLinks(evidenceId: string): Promise<EvidenceLink[]> {
    return [...this.evidenceLinks.values()].filter(
      (link) =>
        link.fromEvidenceId === evidenceId ||
        link.toEvidenceId === evidenceId,
    );
  }
  };
  return Mixin as unknown as TBase & StoreCtor<WorkPackageApi>;
}
