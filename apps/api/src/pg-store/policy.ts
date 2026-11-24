/**
 * Policy：策略版本读取与发布
 *
 * 行为保持型重构：以下方法体从原 `apps/api/src/pg-store.ts` 逐字搬移，
 * 本层通过继承叠加到 `PgStore` 上；方法名、签名、SQL、事务边界、错误映射与审计顺序均未变。
 */

import { randomUUID } from "node:crypto";
import {
  assertPolicyApplicability,
  type PolicyApplicability,
  type PolicyDefinition,
  type PolicyVersionDetail,
  type PolicyVersionSummary,
  type PublishPolicyInput,
  type PublishedPolicy,
} from "@anari/domain";
import { sha256 } from "@anari/policy-dsl";
import { ConflictError } from "../store.js";
import { PgStoreLedger } from "./ledger.js";
import { iso, notFound, asNumber } from "../pg-store-support.js";

export class PgStorePolicy extends PgStoreLedger {
  async getPolicy(policyVersionId: string): Promise<PolicyDefinition> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT rule_ast FROM policy_versions WHERE tenant_id = $1 AND id = $2",
        [this.tenantId, policyVersionId],
      );
      if (!rows[0]) notFound("Policy", policyVersionId);
      return rows[0].rule_ast as PolicyDefinition;
    });
  }

  async getPolicyVersion(
    policyVersionId: string,
  ): Promise<PolicyVersionDetail> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT id, policy_code, version, status, effective_from, effective_to,
                content_hash, published_at, rule_ast, scope, applicability
           FROM policy_versions
          WHERE tenant_id = $1 AND id = $2`,
        [this.tenantId, policyVersionId],
      );
      if (!rows[0]) notFound("Policy", policyVersionId);
      const row = rows[0];
      return {
        policyVersionId: row.id,
        code: row.policy_code,
        version: asNumber(row.version),
        status: row.status,
        effectiveFrom: iso(row.effective_from),
        effectiveTo: iso(row.effective_to),
        contentHash: row.content_hash,
        publishedAt: iso(row.published_at),
        policy: row.rule_ast as PolicyDefinition,
        scope: (row.scope ?? {}) as Record<string, unknown>,
        applicability: (row.applicability ?? {}) as PolicyApplicability,
      };
    });
  }

  async listPolicyVersions(): Promise<PolicyVersionSummary[]> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT id, policy_code, version, status, effective_from,
                effective_to, content_hash, published_at, applicability
           FROM policy_versions
          WHERE tenant_id = $1
          ORDER BY policy_code, version DESC`,
        [this.tenantId],
      );
      return rows.map((row) => ({
        policyVersionId: row.id,
        code: row.policy_code,
        version: asNumber(row.version),
        status: row.status,
        effectiveFrom: iso(row.effective_from),
        effectiveTo: iso(row.effective_to),
        contentHash: row.content_hash,
        publishedAt: iso(row.published_at),
        applicability: (row.applicability ?? {}) as PolicyApplicability,
      }));
    });
  }

  async publishPolicy(input: PublishPolicyInput): Promise<PublishedPolicy> {
    assertPolicyApplicability(input.applicability);
    return this.tx(async (client) => {
      const policyVersionId = input.policyVersionId ?? randomUUID();
      const contentHash = sha256(input.policy);
      try {
        const { rows: open } = await client.query(
          `SELECT id, effective_from
             FROM policy_versions
            WHERE tenant_id = $1 AND policy_code = $2
              AND effective_to IS NULL AND id <> $3
            ORDER BY effective_from DESC
            LIMIT 1
            FOR UPDATE`,
          [this.tenantId, input.policy.code, policyVersionId],
        );
        if (open[0]) {
          if (
            new Date(input.effectiveFrom).getTime() <=
            new Date(open[0].effective_from).getTime()
          ) {
            throw new ConflictError(
              `effectiveFrom must be after the open version (${iso(open[0].effective_from)})`,
            );
          }
          await client.query(
            `UPDATE policy_versions
                SET effective_to = $1
              WHERE tenant_id = $2 AND id = $3`,
            [input.effectiveFrom, this.tenantId, open[0].id],
          );
        }

        const { rows } = await client.query(
          `INSERT INTO policy_versions
            (id, tenant_id, policy_code, version, scope, status,
             effective_from, rule_ast, rule_schema_version, content_hash,
             approved_by, approved_at, published_at, applicability)
           VALUES ($1,$2,$3,$4,$5,'PUBLISHED',$6,$7,'policy-definition/v1',$8,$9,now(),now(),$10::jsonb)
           RETURNING published_at`,
          [
            policyVersionId,
            this.tenantId,
            input.policy.code,
            input.policy.version,
            JSON.stringify(input.scope ?? {}),
            input.effectiveFrom,
            JSON.stringify(input.policy),
            contentHash,
            input.approvedBy,
            JSON.stringify(input.applicability),
          ],
        );
        await this.appendAudit(client, {
          action: "POLICY_PUBLISHED",
          objectType: "POLICY_VERSION",
          objectId: policyVersionId,
          actorType: "USER",
          actorId: input.approvedBy,
          afterHash: contentHash,
          reason: `${input.policy.code}:${input.policy.version}`,
        });
        return {
          policyVersionId,
          policy: input.policy,
          contentHash,
          effectiveFrom: input.effectiveFrom,
          publishedAt: iso(rows[0]?.published_at) ?? new Date().toISOString(),
          approvedBy: input.approvedBy,
          applicability: structuredClone(input.applicability),
        };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictError(
            `Policy ${input.policy.code}:${input.policy.version} already exists`,
          );
        }
        throw error;
      }
    });
  }
}
