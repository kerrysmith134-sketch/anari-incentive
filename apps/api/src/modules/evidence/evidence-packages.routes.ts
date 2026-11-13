/**
 * 证据包域路由（周期证据包导出）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { sha256 } from "@anari/policy-dsl";
import type { AuditEvent } from "@anari/domain";
import type { PlatformStore } from "../../platform-store.js";
import type { IncentiveStore } from "../../store-interface.js";
import { ConflictError } from "../../store.js";
import {
  data,
  requireRoles,
  tenantOf,
  paramOf,
  ownPersonId,
} from "../../http-helpers.js";

export function registerEvidencePackageRoutes(deps: {
  platformStore: PlatformStore;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  assertExportAllowed: (request: FastifyRequest) => void;
  assertExportDlp: (
    request: FastifyRequest,
    text: string,
    targetType: string,
    targetId: string,
    approvalRequestId?: string,
  ) => Promise<void>;
  auditExport: (
    request: FastifyRequest,
    action: string,
    objectType: string,
    objectId: string,
    detail?: string,
  ) => Promise<void>;
  auditEventsForViewer: (
    request: FastifyRequest,
    events: AuditEvent[],
  ) => Promise<AuditEvent[]>;
  fieldPoliciesFor: (
    request: FastifyRequest,
  ) => Promise<Record<string, unknown> | undefined>;
  fieldMatchContextFor: (
    request: FastifyRequest,
    policies: Record<string, unknown> | undefined,
  ) => Promise<unknown>;
  redactResourceFields: (
    record: unknown,
    resourceType: string,
    viewer: {
      personId?: string;
      recordPersonId?: string;
      roles: string[];
      policies?: Record<string, unknown>;
      matchContext?: unknown;
    },
  ) => unknown;
  redactCalculationRunFields: (
    run: unknown,
    viewer: {
      roles: string[];
      policies?: Record<string, unknown>;
      matchContext?: unknown;
    },
  ) => unknown;
  redactSettlementBatchFields: (batch: unknown, viewer: unknown) => unknown;
}): FastifyPluginAsync {
  const { platformStore, storeFor, assertExportAllowed, assertExportDlp, auditExport, auditEventsForViewer, fieldPoliciesFor, fieldMatchContextFor, redactResourceFields, redactCalculationRunFields, redactSettlementBatchFields } = deps;
  return async (app: FastifyInstance) => {
  app.get("/api/v1/evidence-packages/:cycleId", async (request) => {
    assertExportAllowed(request);
    requireRoles(request, "manager", "finance");
    const tenantId = tenantOf(request);
    const cycleId = paramOf(request, "cycleId");
    const exportQuery = request.query as {
      legalEntity?: string;
      jurisdiction?: string;
      dlpApprovalRequestId?: string;
    };
    const legalEntity = exportQuery.legalEntity?.trim();
    const jurisdiction = exportQuery.jurisdiction?.trim();
    const scoped = Boolean(legalEntity || jurisdiction);
    const store = storeFor(request);
    const cycle = await store.getEvaluationCycle(cycleId);
    const [
      allWorkPackages,
      allClaims,
      allAttributionDecisions,
      drafts,
      evaluationDecisions,
      allRuns,
      allConfirmations,
      allEvidence,
      allAuditEvents,
      allSettlements,
      allLedger,
      allAppeals,
      allApprovals,
      allNotices,
      allDpias,
      allDsars,
      allDataQualityIssues,
      retentionPolicies,
      representations,
      policyVersions,
    ] = await Promise.all([
      store.listWorkPackages(),
      store.listClaims(),
      store.listDecisions(),
      store.listEvaluationDrafts({ cycleId }),
      store.listEvaluationDecisions({ cycleId }),
      store.listRuns(),
      store.listConfirmations(),
      store.listEvidence(),
      store.listAuditEvents(1000),
      store.listSettlementBatches(),
      store.listLedger(),
      store.listAppeals(),
      platformStore.listApprovalRequests(tenantId),
      platformStore.listNotices(tenantId),
      platformStore.listDpias(tenantId),
      platformStore.listDsars(tenantId),
      store.listDataQualityIssues(),
      platformStore.listRetentionPolicies(tenantId),
      platformStore.listRepresentations(tenantId),
      store.listPolicyVersions(),
    ]);

    const scopedPolicies = policyVersions.filter((policy) => {
      if (!scoped) return true;
      if (legalEntity && policy.applicability?.legalEntity !== legalEntity) {
        return false;
      }
      if (
        jurisdiction &&
        !policy.applicability?.jurisdictions?.includes(jurisdiction)
      ) {
        return false;
      }
      return true;
    });
    const scopedPolicyIds = new Set(
      scopedPolicies.map((policy) => policy.policyVersionId),
    );
    const runs = allRuns.filter(
      (run) =>
        run.cycleId === cycleId &&
        (!scoped || scopedPolicyIds.has(run.policyVersionId)),
    );
    if (scoped && runs.length === 0) {
      throw new ConflictError(
        "EVIDENCE_PACKAGE_SCOPE_EMPTY: no calculation run matches the requested legal entity/jurisdiction",
      );
    }
    const runIds = new Set(runs.map((run) => run.id));
    const workPackageIds = new Set(
      runs.flatMap((run) =>
        run.inputSnapshot.participants.map(
          (participant) => participant.workPackageId,
        ),
      ),
    );
    const workPackages = allWorkPackages.filter((workPackage) =>
      workPackageIds.has(workPackage.id),
    );
    const claims = allClaims.filter((claim) =>
      workPackageIds.has(claim.workPackageId),
    );
    const claimIds = new Set(claims.map((claim) => claim.id));
    const attributionDecisions = allAttributionDecisions.filter((decision) =>
      claimIds.has(decision.claimId),
    );
    const settlementBatches = allSettlements.filter(
      (batch) => batch.cycleId === cycleId,
    );
    const settlementDetails = await Promise.all(
      settlementBatches.map((batch) => store.getSettlementBatch(batch.id)),
    );
    const settlementIds = new Set(
      settlementBatches.map((batch) => batch.id),
    );
    const settlementExports = (
      await Promise.all(
        [...settlementIds].map((batchId) =>
          platformStore.listSettlementExports(tenantId, batchId),
        ),
      )
    ).flat();
    const ledgerEntries = allLedger.filter(
      (entry) => entry.cycleId === cycleId,
    );
    const ledgerIds = new Set(ledgerEntries.map((entry) => entry.id));
    const evidenceSubjects = new Set([
      ...workPackageIds,
      ...claimIds,
      ...runIds,
    ]);
    const evidenceNodes = allEvidence.filter((node) =>
      evidenceSubjects.has(node.subjectId),
    );
    const evidenceLinks = (
      await Promise.all(
        evidenceNodes.map((node) => store.listEvidenceLinks(node.id)),
      )
    ).flat();
    const confirmationTargets = new Set([
      ...runIds,
      ...settlementIds,
      ...ledgerIds,
      ...claimIds,
    ]);
    const confirmations = allConfirmations.filter((confirmation) =>
      confirmationTargets.has(confirmation.targetId),
    );
    const appeals = allAppeals.filter((appeal) =>
      confirmationTargets.has(appeal.targetId),
    );
    const policyVersionIds = new Set(
      [
        cycle.policyVersionId,
        ...runs.map((run) => run.policyVersionId),
      ].filter((value): value is string => Boolean(value)),
    );
    const policies = policyVersions.filter((policy) =>
      policyVersionIds.has(policy.policyVersionId),
    );
    const policyDetails = await Promise.all(
      policies.map(async (policy) => {
        const [legalGate, testCases, testRuns, policyNotices, consultations] =
          await Promise.all([
            store.getLegalGate(policy.policyVersionId),
            platformStore.listPolicyTestCases(tenantId, policy.policyVersionId),
            platformStore.listPolicyTestRuns(
              tenantId,
              policy.policyVersionId,
              100,
            ),
            platformStore.listPolicyNotices(tenantId, policy.policyVersionId),
            platformStore.listConsultations(tenantId, policy.policyVersionId),
          ]);
        return {
          ...policy,
          legalGate,
          testCases,
          testRuns,
          policyNotices,
          consultations,
        };
      }),
    );
    const notices = allNotices.filter(
      (notice) =>
        notice.policyVersionId &&
        policyVersionIds.has(notice.policyVersionId),
    );
    const noticesWithAcknowledgements = await Promise.all(
      notices.map(async (notice) => ({
        notice,
        acknowledgements: await platformStore.listAcknowledgements(
          tenantId,
          notice.id,
        ),
      })),
    );
    const knownTargetIds = new Set<string>([
      cycle.id,
      ...policyVersionIds,
      ...workPackageIds,
      ...claimIds,
      ...attributionDecisions.map((decision) => decision.id),
      ...drafts.map((draft) => draft.id),
      ...evaluationDecisions.map((decision) => decision.id),
      ...runIds,
      ...confirmationTargets,
      ...settlementIds,
      ...ledgerIds,
      ...appeals.map((appeal) => appeal.id),
      ...notices.map((notice) => notice.id),
    ]);
    const approvals = allApprovals.filter((approval) =>
      knownTargetIds.has(approval.targetId),
    );
    const knownIds = new Set<string>([
      ...knownTargetIds,
      ...approvals.map((approval) => approval.id),
    ]);
    const dataQualityIssues = allDataQualityIssues.filter((issue) =>
      knownTargetIds.has(issue.objectId),
    );
    const auditEvents = await auditEventsForViewer(
      request,
      allAuditEvents.filter(
        (event) => event.objectId && knownIds.has(event.objectId),
      ),
    );
    const [auditChainValid, ledgerValid] = await Promise.all([
      store.verifyAuditChain(),
      store.verifyLedger(),
    ]);
    const packageBody = {
      schemaVersion: "n-perform.evidence-package/v1",
      generatedAt: new Date().toISOString(),
      tenantId,
      scope: {
        legalEntity: legalEntity ?? null,
        jurisdiction: jurisdiction ?? null,
      },
      cycle,
      policies: policyDetails,
      workPackages,
      evidence: {
        nodes: evidenceNodes,
        links: evidenceLinks,
      },
      contributionClaims: claims,
      attributionDecisions,
      evaluation: {
        drafts,
        decisions: evaluationDecisions,
      },
      calculations: runs,
      employeeConfirmations: confirmations,
      appeals,
      settlements: {
        batches: settlementDetails,
        exports: settlementExports,
      },
      ledgerEntries,
      approvals,
      dataQualityIssues,
      notices: noticesWithAcknowledgements,
      representations,
      dataProtection: {
        dpias: allDpias,
        dsars: allDsars,
        retentionPolicies,
      },
      auditEvents,
      verification: {
        auditChainValid,
        ledgerValid,
      },
    };
    const packageHash = sha256(packageBody);
    const viewerRoles = request.authContext?.roles ?? [];
    const fieldPolicies = await fieldPoliciesFor(request);
    const matchContext = await fieldMatchContextFor(request, fieldPolicies);
    const viewerPersonId = ownPersonId(request);
    // The hash identifies the canonical package; the response body is filtered
    // through the field matrix so an export cannot bypass read redaction.
    const viewerBody = {
      ...packageBody,
      evidence: {
        ...packageBody.evidence,
        nodes: packageBody.evidence.nodes.map((node) =>
          redactResourceFields(node, "EVIDENCE", {
            personId: viewerPersonId,
            recordPersonId: node.submittedBy,
            roles: viewerRoles,
            policies: fieldPolicies,
            matchContext,
          }),
        ),
      },
      calculations: packageBody.calculations.map((run) =>
        redactCalculationRunFields(run, {
          roles: viewerRoles,
          policies: fieldPolicies,
          matchContext,
        }),
      ),
      settlements: {
        ...packageBody.settlements,
        batches: packageBody.settlements.batches.map((batch) =>
          redactSettlementBatchFields(batch, {
            personId: viewerPersonId,
            roles: viewerRoles,
            policies: fieldPolicies,
            matchContext,
          }),
        ),
      },
    };
    await assertExportDlp(
      request,
      JSON.stringify(viewerBody),
      "EVIDENCE_PACKAGE",
      packageBody.cycle.id,
      exportQuery.dlpApprovalRequestId,
    );
    return data({ ...viewerBody, packageHash }, request);
  });
  };
}
