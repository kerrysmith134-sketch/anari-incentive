import { randomUUID } from "node:crypto";
import {
  assertPolicyApplicability,
  type LegalGateRecord,
  type PolicyDefinition,
  type PolicyVersionDetail,
  type PolicyVersionSummary,
  type PublishPolicyInput,
  type PublishedPolicy,
} from "@anari/domain";
import {
  sha256,
} from "@anari/policy-dsl";
import type {
  RecordLegalGateInput,
} from "../store-interface.js";
import {
  ConflictError,
  now,
  notFound,
} from "../store-support.js";
import { policies } from "../policy-registry.js";
import type { IncentiveStore } from "../store-interface.js";
import { StoreBase, type StoreCtor } from "./base.js";

export type PolicyApi = Pick<
  IncentiveStore,
  | "getPolicy"
  | "getPolicyVersion"
  | "listPolicyVersions"
  | "publishPolicy"
  | "recordLegalGate"
  | "getLegalGate"
>;

/**
 * Mixes the policy domain into the store chain. Methods keep the exact
 * behaviour of the former monolithic Store implementation.
 */
export function withPolicy<TBase extends StoreCtor<StoreBase>>(Base: TBase) {
  const Mixin = class PolicyMixin extends Base implements PolicyApi {

  private fixturePolicySummary(
    id: string,
    policy: PolicyDefinition,
  ): PolicyVersionSummary {
    const window = this.policyWindows.get(id);
    return {
      policyVersionId: id,
      code: policy.code,
      version: policy.version,
      status: "PUBLISHED",
      effectiveFrom: window?.effectiveFrom,
      effectiveTo: window?.effectiveTo,
    };
  }

  private openPolicyVersion(code: string): PolicyVersionSummary | undefined {
    const candidates = [
      ...[...this.publishedPolicySummaries.values()].filter(
        (summary) => summary.code === code && !summary.effectiveTo,
      ),
      ...[...policies.entries()]
        .filter(
          ([id, policy]) =>
            policy.code === code &&
            !this.publishedPolicySummaries.has(id) &&
            !this.policyWindows.get(id)?.effectiveTo,
        )
        .map(([id, policy]) => this.fixturePolicySummary(id, policy)),
    ];
    return candidates.sort((a, b) =>
      (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? ""),
    )[0];
  }

  async getPolicy(policyVersionId: string): Promise<PolicyDefinition> {
    const policy =
      this.publishedPolicies.get(policyVersionId) ??
      policies.get(policyVersionId);
    if (!policy) notFound("Policy", policyVersionId);
    return policy;
  }

  async getPolicyVersion(
    policyVersionId: string,
  ): Promise<PolicyVersionDetail> {
    const policy =
      this.publishedPolicies.get(policyVersionId) ??
      policies.get(policyVersionId);
    if (!policy) notFound("Policy", policyVersionId);
    const summary =
      this.publishedPolicySummaries.get(policyVersionId) ??
      this.fixturePolicySummary(policyVersionId, policy);
    return {
      ...summary,
      policy,
      scope: structuredClone(
        this.publishedPolicyScopes.get(policyVersionId) ?? {},
      ),
    };
  }

  async listPolicyVersions(): Promise<PolicyVersionSummary[]> {
    const summaries = new Map<string, PolicyVersionSummary>();
    for (const [id, policy] of policies) {
      summaries.set(id, this.fixturePolicySummary(id, policy));
    }
    for (const [id, summary] of this.publishedPolicySummaries) {
      summaries.set(id, summary);
    }
    return [...summaries.values()].sort(
      (a, b) => a.code.localeCompare(b.code) || b.version - a.version,
    );
  }

  async publishPolicy(input: PublishPolicyInput): Promise<PublishedPolicy> {
    assertPolicyApplicability(input.applicability);
    const policyVersionId = input.policyVersionId ?? randomUUID();
    if (
      this.publishedPolicies.has(policyVersionId) ||
      policies.has(policyVersionId)
    ) {
      throw new ConflictError(`Policy ${policyVersionId} already exists`);
    }
    const policyKey = `${input.policy.code}:${input.policy.version}`;
    if (
      this.publishedPolicyKeys.has(policyKey) ||
      [...policies.values()].some(
        (policy) =>
          `${policy.code}:${policy.version}` === policyKey,
      )
    ) {
      throw new ConflictError(`Policy ${policyKey} already exists`);
    }

    const open = this.openPolicyVersion(input.policy.code);
    if (
      open?.effectiveFrom &&
      new Date(input.effectiveFrom).getTime() <=
        new Date(open.effectiveFrom).getTime()
    ) {
      throw new ConflictError(
        `effectiveFrom must be after the open version (${open.effectiveFrom})`,
      );
    }
    if (open) {
      const published = this.publishedPolicySummaries.get(
        open.policyVersionId,
      );
      if (published) {
        published.effectiveTo = input.effectiveFrom;
      } else {
        this.policyWindows.set(open.policyVersionId, {
          effectiveFrom: open.effectiveFrom,
          effectiveTo: input.effectiveFrom,
        });
      }
    }

    const publishedAt = now();
    const contentHash = sha256(input.policy);
    this.publishedPolicies.set(policyVersionId, input.policy);
    this.publishedPolicyKeys.add(policyKey);
    this.publishedPolicyScopes.set(
      policyVersionId,
      structuredClone(input.scope ?? {}),
    );
    const applicability = structuredClone(input.applicability);
    this.publishedPolicySummaries.set(policyVersionId, {
      policyVersionId,
      code: input.policy.code,
      version: input.policy.version,
      status: "PUBLISHED",
      effectiveFrom: input.effectiveFrom,
      contentHash,
      publishedAt,
      applicability,
    });
    return {
      policyVersionId,
      policy: input.policy,
      contentHash,
      effectiveFrom: input.effectiveFrom,
      publishedAt,
      approvedBy: input.approvedBy,
      applicability,
    };
  }

  async recordLegalGate(
    input: RecordLegalGateInput,
  ): Promise<LegalGateRecord> {
    const existing = this.legalGates.get(input.policyVersionId);
    const record: LegalGateRecord = {
      id: existing?.id ?? randomUUID(),
      tenantId: this.tenantId,
      policyVersionId: input.policyVersionId,
      democraticProcedureRef: input.democraticProcedureRef,
      employeeNoticeRef: input.employeeNoticeRef,
      dataProtectionAssessmentRef: input.dataProtectionAssessmentRef,
      minimumWageChecked: input.minimumWageChecked,
      policyApproved: input.policyApproved,
      recordedBy: input.recordedBy,
      recordedAt: now(),
    };
    this.legalGates.set(input.policyVersionId, record);
    return record;
  }

  async getLegalGate(
    policyVersionId: string,
  ): Promise<LegalGateRecord | undefined> {
    return this.legalGates.get(policyVersionId);
  }
  };
  return Mixin as unknown as TBase & StoreCtor<PolicyApi>;
}
