/**
 * Contribution：贡献申报（claim）
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { randomUUID } from "node:crypto";
import {
  assertTransition,
  contributionClaimTransitions,
  type ContributionClaim,
} from "@anari/domain";
import { type CreateContributionClaimInput } from "@anari/contracts";
import { ConflictError } from "../store.js";
import { PgStoreEvidence } from "./evidence.js";

export class PgStoreClaims extends PgStoreEvidence {
  async createClaim(
    input: CreateContributionClaimInput,
  ): Promise<ContributionClaim> {
    return this.tx(async (client) => {
      const wp = await this.loadWorkPackage(client, input.workPackageId);
      if (wp.status !== "ACCEPTED") {
        throw new ConflictError(
          "a contribution claim requires an accepted work package",
        );
      }
      if (!wp.commitmentSnapshot) {
        throw new ConflictError(
          "a contribution claim requires a frozen commitment snapshot",
        );
      }
      const claimMode = input.claimMode ?? "STANDARD";
      if (claimMode !== "STANDARD" && !input.exceptionReason?.trim()) {
        throw new ConflictError(
          "CLAIM_EXCEPTION_REASON_REQUIRED: exception and backfill claims need a reason",
        );
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO contribution_claims
          (id, tenant_id, work_package_id, claimant_person_id, claim_type,
           claim_mode, exception_reason, claimed_contribution, rationale,
           status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT')`,
        [
          id,
          this.tenantId,
          input.workPackageId,
          input.claimantPersonId,
          input.claimType,
          claimMode,
          claimMode === "STANDARD"
            ? null
            : input.exceptionReason?.trim() ?? null,
          JSON.stringify(input.claimedContribution),
          input.rationale,
        ],
      );
      for (const evidenceRef of input.evidenceRefs ?? []) {
        await client.query(
          `INSERT INTO claim_evidence_links
            (tenant_id, claim_id, evidence_ref, link_role)
           VALUES ($1,$2,$3,'SUPPORTING')`,
          [this.tenantId, id, evidenceRef],
        );
      }
      return this.loadClaim(client, id);
    });
  }

  async getClaim(id: string): Promise<ContributionClaim> {
    return this.tx((client) => this.loadClaim(client, id));
  }

  async listClaims(): Promise<ContributionClaim[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT id FROM contribution_claims WHERE tenant_id=$1 ORDER BY created_at DESC",
        [this.tenantId],
      );
      const claims = [];
      for (const row of rows) {
        claims.push(await this.loadClaim(client, row.id));
      }
      return claims;
    });
  }

  async submitClaim(id: string): Promise<ContributionClaim> {
    return this.tx(async (client) => {
      const claim = await this.loadClaim(client, id);
      assertTransition(
        contributionClaimTransitions,
        "ContributionClaim",
        claim.status,
        "SUBMITTED",
      );
      await client.query(
        `UPDATE contribution_claims
            SET status = 'SUBMITTED', submitted_at = now(), version = version + 1
          WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, id],
      );
      return this.loadClaim(client, id);
    });
  }
}
