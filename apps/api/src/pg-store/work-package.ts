/**
 * WorkPackage：工作包、成员、版本与状态机
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * `assertWorkPackageVersion` / `transitionWorkPackage` 仅本领域使用，保持 private。
 *
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { randomUUID } from "node:crypto";
import { type PoolClient } from "pg";
import {
  assertTransition,
  workPackageTransitions,
  type CommitmentSnapshot,
  type WorkPackage,
} from "@anari/domain";
import { type CreateWorkPackageInput } from "@anari/contracts";
import { sha256 } from "@anari/policy-dsl";
import { ConflictError } from "../store.js";
import { PgStorePolicy } from "./policy.js";
import { notFound } from "../pg-store-support.js";

export class PgStoreWorkPackage extends PgStorePolicy {
  async createWorkPackage(
    input: CreateWorkPackageInput,
  ): Promise<WorkPackage> {
    return this.tx(async (client) => {
      const id = randomUUID();
      await client.query(
        `INSERT INTO work_packages
          (id, tenant_id, source_object_type, source_object_id, title, objective,
           package_type, owner_person_id, status, acceptance_criteria, due_at)
         VALUES ($1,$2,'ORDER',$3,$4,$5,$6,$7,'DRAFT',$8,$9)`,
        [
          id,
          this.tenantId,
          randomUUID(),
          input.title,
          input.objective,
          input.packageType ?? "ORDER_DELIVERY",
          input.ownerPersonId,
          JSON.stringify(input.acceptanceCriteria),
          input.dueAt ?? null,
        ],
      );
      for (const member of input.members) {
        await client.query(
          `INSERT INTO work_package_members
            (tenant_id, work_package_id, person_id, responsibility_code,
             expected_output, active_from)
           VALUES ($1,$2,$3,$4,$5,now())`,
          [
            this.tenantId,
            id,
            member.personId,
            member.responsibilityCode,
            member.expectedOutput,
          ],
        );
      }
      return this.loadWorkPackage(client, id);
    });
  }

  async getWorkPackage(id: string): Promise<WorkPackage> {
    return this.tx((client) => this.loadWorkPackage(client, id));
  }

  async listWorkPackages(): Promise<WorkPackage[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT id FROM work_packages WHERE tenant_id = $1 ORDER BY created_at DESC",
        [this.tenantId],
      );
      const packages: WorkPackage[] = [];
      for (const row of rows) {
        packages.push(await this.loadWorkPackage(client, row.id));
      }
      return packages;
    });
  }

  async listWorkPackageVersions(
    id: string,
  ): Promise<CommitmentSnapshot[]> {
    return this.tx(async (client) => {
      const { rows: exists } = await client.query(
        `SELECT 1 FROM work_packages WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, id],
      );
      if (!exists[0]) notFound("WorkPackage", id);
      const { rows } = await client.query(
        `SELECT snapshot FROM work_package_versions
          WHERE tenant_id=$1 AND work_package_id=$2
          ORDER BY version`,
        [this.tenantId, id],
      );
      return rows.map((row) => row.snapshot as CommitmentSnapshot);
    });
  }

  async commitWorkPackage(
    id: string,
    expectedVersion: number,
  ): Promise<WorkPackage> {
    return this.tx(async (client) => {
      const current = await this.loadWorkPackage(client, id);
      if (current.version !== expectedVersion) {
        throw new ConflictError(
          `expected version ${expectedVersion}, actual ${current.version}`,
        );
      }
      assertTransition(
        workPackageTransitions,
        "WorkPackage",
        current.status,
        "COMMITTED",
      );
      const snapshot: CommitmentSnapshot = {
        snapshotId: randomUUID(),
        workPackageId: current.id,
        capturedAt: new Date().toISOString(),
        title: current.title,
        objective: current.objective,
        ownerPersonId: current.ownerPersonId,
        members: structuredClone(current.members),
        acceptanceCriteria: [...current.acceptanceCriteria],
        dueAt: current.dueAt,
        contentHash: sha256({
          title: current.title,
          objective: current.objective,
          ownerPersonId: current.ownerPersonId,
          members: current.members,
          acceptanceCriteria: current.acceptanceCriteria,
          dueAt: current.dueAt,
        }),
      };
      const nextVersion = current.version + 1;
      await client.query(
        `INSERT INTO work_package_versions
          (id, tenant_id, work_package_id, version, snapshot, content_hash,
           captured_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          snapshot.snapshotId,
          this.tenantId,
          current.id,
          nextVersion,
          JSON.stringify(snapshot),
          snapshot.contentHash,
          current.ownerPersonId,
        ],
      );
      await client.query(
        `UPDATE work_packages
            SET status = 'COMMITTED', current_snapshot_id = $3, version = $4
          WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, id, snapshot.snapshotId, nextVersion],
      );
      return this.loadWorkPackage(client, id);
    });
  }

  async startWorkPackage(
    id: string,
    expectedVersion?: number,
  ): Promise<WorkPackage> {
    return this.transitionWorkPackage(id, "IN_PROGRESS", expectedVersion);
  }

  async submitWorkPackage(
    id: string,
    expectedVersion?: number,
  ): Promise<WorkPackage> {
    return this.transitionWorkPackage(id, "SUBMITTED", expectedVersion);
  }

  async acceptWorkPackage(
    id: string,
    reviewerPersonId: string,
    expectedVersion?: number,
  ): Promise<WorkPackage> {
    return this.tx((client) =>
      this.acceptWorkPackageInTx(
        client,
        id,
        reviewerPersonId,
        expectedVersion,
      ),
    );
  }

  async acceptWorkPackagesBatch(
    items: Array<{ id: string; reviewerPersonId: string }>,
  ): Promise<WorkPackage[]> {
    return this.tx(async (client) => {
      const accepted: WorkPackage[] = [];
      for (const item of items) {
        accepted.push(
          await this.acceptWorkPackageInTx(
            client,
            item.id,
            item.reviewerPersonId,
          ),
        );
      }
      return accepted;
    });
  }

  private async acceptWorkPackageInTx(
    client: PoolClient,
    id: string,
    reviewerPersonId: string,
    expectedVersion?: number,
  ): Promise<WorkPackage> {
    const current = await this.loadWorkPackage(client, id);
    this.assertWorkPackageVersion(current, expectedVersion);
    if (reviewerPersonId === current.ownerPersonId) {
      throw new ConflictError(
        "the work-package owner cannot accept their own delivery",
      );
    }
    assertTransition(
      workPackageTransitions,
      "WorkPackage",
      current.status,
      "ACCEPTED",
    );
    await client.query(
      `UPDATE work_packages
          SET status = 'ACCEPTED', version = version + 1
        WHERE tenant_id = $1 AND id = $2`,
      [this.tenantId, id],
    );
    return this.loadWorkPackage(client, id);
  }

  async rejectWorkPackage(
    id: string,
    reviewerPersonId: string,
    reason: string,
    expectedVersion?: number,
  ): Promise<WorkPackage> {
    return this.tx(async (client) => {
      const current = await this.loadWorkPackage(client, id);
      this.assertWorkPackageVersion(current, expectedVersion);
      if (reviewerPersonId === current.ownerPersonId) {
        throw new ConflictError(
          "the work-package owner cannot reject their own delivery",
        );
      }
      assertTransition(
        workPackageTransitions,
        "WorkPackage",
        current.status,
        "REJECTED",
      );
      await client.query(
        `UPDATE work_packages
            SET status = 'REJECTED', version = version + 1
          WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, id],
      );
      void reason;
      return this.loadWorkPackage(client, id);
    });
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

  private async transitionWorkPackage(
    id: string,
    target: "IN_PROGRESS" | "SUBMITTED",
    expectedVersion?: number,
  ): Promise<WorkPackage> {
    return this.tx(async (client) => {
      const current = await this.loadWorkPackage(client, id);
      this.assertWorkPackageVersion(current, expectedVersion);
      assertTransition(
        workPackageTransitions,
        "WorkPackage",
        current.status,
        target,
      );
      await client.query(
        `UPDATE work_packages SET status=$3, version=version+1
          WHERE tenant_id=$1 AND id=$2`,
        [this.tenantId, id, target],
      );
      return this.loadWorkPackage(client, id);
    });
  }
}
