/**
 * 数据治理域路由（NPV2-011 第一个拆分域）：
 * 留存策略、法务保全、处置请求、数据源/数据地图、 workforce 子组属性。
 * 协议适配只做鉴权/校验/调用 store；行为与拆分前逐字节等价。
 */
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from "fastify";
import type { PlatformStore } from "../../platform-store.js";
import type { IncentiveStore } from "../../store-interface.js";
import {
  cancelRetentionDisposalRequestSchema,
  completeRetentionDisposalRequestSchema,
  approveRetentionDisposalRequestSchema,
  createDataSourceSchema,
  createFlatRetentionDisposalRequestSchema,
  createRetentionDisposalRequestSchema,
  createRetentionPolicySchema,
  processRetentionDisposalsSchema,
  recordWorkforceSubgroupAttributeSchema,
  setRetentionLegalHoldSchema,
} from "@anari/contracts";
import { dataGovernanceCoverage } from "@anari/domain";
import { ConflictError } from "../../store.js";
import {
  data,
  idOf,
  parse,
  requireRoles,
  tenantOf,
} from "../../http-helpers.js";
import { RETENTION_RECOMMENDATIONS } from "./retention-defaults.js";
import {
  findActivityMetricKeys,
  findActivityMonitoringText,
} from "./activity-monitoring.js";


export function registerDataGovernanceRoutes(deps: {
  platformStore: PlatformStore;
  storeFor: (request: import("fastify").FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
  auditExport: (
    request: import("fastify").FastifyRequest,
    action: string,
    objectType: string,
    objectId: string,
    detail?: string,
  ) => Promise<void>;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent, auditExport } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/retention-policies", async (request, reply) => {
      requireRoles(request, "admin");
      const body = parse(createRetentionPolicySchema, request.body);
      return reply.status(201).send(
        data(
          await platformStore.createRetentionPolicy({
            tenantId: tenantOf(request),
            dataCategory: body.dataCategory,
            retentionMonths: body.retentionMonths,
            legalBasis: body.legalBasis,
            legalHold: body.legalHold ?? false,
          }),
          request,
        ),
      );
    });

      app.get("/api/v1/retention-policies", async (request) => {
      requireRoles(request, "manager", "finance");
      return data(
        await platformStore.listRetentionPolicies(tenantOf(request)),
        request,
      );
    });

      app.get("/api/v1/retention-policies/recommended", async (request) => {
      requireRoles(request, "manager", "finance");
      const configured = await platformStore.listRetentionPolicies(
        tenantOf(request),
      );
      const configuredCategories = new Set(
        configured.map((policy) => policy.dataCategory),
      );
      return data(
        {
          note: "Conservative system defaults from ADR-008. Legal hold always wins; a tenant must confirm local law before adopting a value.",
          recommendations: RETENTION_RECOMMENDATIONS.map((recommendation) => ({
            ...recommendation,
            configured: configuredCategories.has(recommendation.dataCategory),
          })),
        },
        request,
      );
    });

      app.get("/api/v1/retention-policies/report", async (request) => {
      requireRoles(request, "manager", "finance");
      const policies = await platformStore.listRetentionPolicies(
        tenantOf(request),
      );
      const today = new Date();
      return data(
        {
          generatedAt: today.toISOString(),
          policies: policies.map((policy) => {
            const cutoff = new Date(today);
            cutoff.setUTCMonth(cutoff.getUTCMonth() - policy.retentionMonths);
            return {
              ...policy,
              cutoffDate: cutoff.toISOString().slice(0, 10),
              eligibleForDisposal: !policy.legalHold,
            };
          }),
        },
        request,
      );
    });

      app.post("/api/v1/retention-policies/:id/legal-hold", async (request) => {
      requireRoles(request, "admin");
      const body = parse(setRetentionLegalHoldSchema, request.body);
      const updated = await platformStore.setRetentionLegalHold({
        tenantId: tenantOf(request),
        retentionPolicyId: idOf(request),
        legalHold: body.legalHold,
      });
      await auditExport(
        request,
        body.legalHold ? "LEGAL_HOLD_SET" : "LEGAL_HOLD_RELEASED",
        "RETENTION_POLICY",
        idOf(request),
      );
      return data(updated, request);
    });

      app.post("/api/v1/data-sources", async (request, reply) => {
      requireRoles(request, "manager");
      const body = parse(createDataSourceSchema, request.body);
      const activityFields = findActivityMetricKeys(
        Object.fromEntries(
          body.fields.map((field) => [field.fieldName, true]),
        ),
      );
      if (activityFields.length > 0) {
        throw new ConflictError(
          `DATA_MINIMIZATION_ACTIVITY_BLOCKED:${activityFields.join(",")}`,
        );
      }
      const activityText = findActivityMonitoringText({
        name: body.name,
        fields: body.fields,
      });
      if (activityText.length > 0) {
        throw new ConflictError(
          `DATA_MINIMIZATION_ACTIVITY_TEXT_BLOCKED:${activityText.join(",")}`,
        );
      }
      return reply.status(201).send(
        data(
          await platformStore.createDataSource({
            tenantId: tenantOf(request),
            code: body.code,
            name: body.name,
            category: body.category,
            ownerPersonId: body.ownerPersonId,
            backupOwnerPersonId: body.backupOwnerPersonId,
            slaHours: body.slaHours,
            criticality: body.criticality,
            containsPersonalData: body.containsPersonalData ?? true,
            storageRegion: body.storageRegion,
            crossBorderTransfers: body.crossBorderTransfers ?? false,
            processorRefs: body.processorRefs ?? [],
            fields: body.fields,
            lastReviewedAt: body.lastReviewedAt,
          }),
          request,
        ),
      );
    });

      app.get("/api/v1/data-sources", async (request) => {
      requireRoles(request, "manager", "finance");
      return data(
        await platformStore.listDataSources(tenantOf(request)),
        request,
      );
    });

      app.get("/api/v1/data-sources/:id", async (request) => {
      requireRoles(request, "manager", "finance");
      return data(
        await platformStore.getDataSource(tenantOf(request), idOf(request)),
        request,
      );
    });

      app.post("/api/v1/data-sources/:id/retire", async (request) => {
      requireRoles(request, "manager");
      return data(
        await platformStore.retireDataSource({
          tenantId: tenantOf(request),
          dataSourceId: idOf(request),
        }),
        request,
      );
    });

      app.get("/api/v1/data-map", async (request) => {
      requireRoles(request, "manager", "finance");
      const tenantId = tenantOf(request);
      const [sources, retention, dpias, dsars] = await Promise.all([
        platformStore.listDataSources(tenantId),
        platformStore.listRetentionPolicies(tenantId),
        platformStore.listDpias(tenantId),
        platformStore.listDsars(tenantId),
      ]);
      const reviewCutoff = 90 * 24 * 60 * 60 * 1000;
      const mapped = sources.map((source) => {
        const reviewedAt = Date.parse(
          source.lastReviewedAt ?? source.createdAt,
        );
        const reviewDueAt = new Date(reviewedAt + reviewCutoff).toISOString();
        return {
          ...source,
          reviewDueAt,
          reviewOverdue:
            source.status === "ACTIVE" && Date.parse(reviewDueAt) < Date.now(),
        };
      });
      const active = mapped.filter((source) => source.status === "ACTIVE");
      const classifications: Record<string, number> = {};
      for (const source of mapped) {
        for (const field of source.fields) {
          classifications[field.classification] =
            (classifications[field.classification] ?? 0) + 1;
        }
      }
      const categories: Record<string, number> = {};
      for (const source of active) {
        categories[source.category] = (categories[source.category] ?? 0) + 1;
      }
      const allFields = mapped.flatMap((source) => source.fields);
      const personalFields = allFields.filter(
        (field) =>
          field.classification === "PERSONAL" ||
          field.classification === "SENSITIVE",
      );
      const personalFieldsWithRetention = personalFields.filter(
        (field) => typeof field.retentionMonths === "number",
      ).length;
      return data(
        {
          generatedAt: new Date().toISOString(),
          summary: {
            sources: sources.length,
            activeSources: active.length,
            personalSources: active.filter(
              (source) => source.containsPersonalData,
            ).length,
            crossBorderSources: active.filter(
              (source) => source.crossBorderTransfers,
            ).length,
            processors: [
              ...new Set(active.flatMap((source) => source.processorRefs)),
            ],
            fields: allFields.length,
            classifications,
            categories,
            minimization: {
              fieldsWithPurpose: allFields.filter((field) => field.purpose).length,
              personalFields: personalFields.length,
              personalFieldsWithRetention,
              personalFieldsWithoutRetention:
                personalFields.length - personalFieldsWithRetention,
            },
            overdueReviews: active.filter((source) => source.reviewOverdue)
              .length,
            retentionPolicies: retention.length,
            approvedDpias: dpias.filter((dpia) => dpia.status === "APPROVED")
              .length,
            openDataRequests: dsars.filter((dsar) => dsar.status === "OPEN")
              .length,
            entityPiiCoverage: dataGovernanceCoverage(),
          },
          sources: mapped,
          retentionPolicies: retention,
        },
        request,
      );
    });

      app.post("/api/v1/retention-policies/:id/disposal-requests", async (request, reply) => {
      requireRoles(request, "manager");
      const body = parse(createRetentionDisposalRequestSchema, request.body);
      return reply.status(201).send(
        data(
          await platformStore.createRetentionDisposalRequest({
            tenantId: tenantOf(request),
            retentionPolicyId: idOf(request),
            requestedBy: body.requestedBy,
            reason: body.reason,
            scheduledFor: body.scheduledFor,
          }),
          request,
        ),
      );
    });

      app.post("/api/v1/retention-disposal-requests", async (request, reply) => {
      requireRoles(request, "admin");
      const body = parse(createFlatRetentionDisposalRequestSchema, request.body);
      return reply.status(201).send(
        data(
          await platformStore.createRetentionDisposalRequest({
            tenantId: tenantOf(request),
            retentionPolicyId: body.retentionPolicyId,
            requestedBy: body.requestedBy,
            reason: body.reason,
            scheduledFor: body.scheduledFor,
          }),
          request,
        ),
      );
    });

      app.get("/api/v1/retention-disposal-requests", async (request) => {
      requireRoles(request, "manager", "finance");
      return data(
        await platformStore.listRetentionDisposalRequests(tenantOf(request)),
        request,
      );
    });

      app.post("/api/v1/retention-disposal-requests:process", async (request) => {
      requireRoles(request, "admin", "integration");
      const body = parse(processRetentionDisposalsSchema, request.body);
      const tenantId = tenantOf(request);
      const pending = (await platformStore.listRetentionDisposalRequests(tenantId))
        .filter(
          (candidate) =>
            candidate.status === "APPROVED" &&
            Date.now() >= Date.parse(candidate.scheduledFor),
        );
      const completed: string[] = [];
      const skipped: Array<{ requestId: string; reason: string }> = [];
      const policies = await platformStore.listRetentionPolicies(tenantId);
      const policyById = new Map(policies.map((policy) => [policy.id, policy]));
      for (const candidate of pending) {
        const policy = policyById.get(candidate.retentionPolicyId);
        if (policy?.legalHold) {
          skipped.push({
            requestId: candidate.id,
            reason: "RETENTION_LEGAL_HOLD",
          });
          continue;
        }
        try {
          const processed = await platformStore.completeRetentionDisposalRequest({
            tenantId,
            requestId: candidate.id,
            actorPersonId: body.actorPersonId,
          });
          completed.push(processed.id);
        } catch (caught) {
          skipped.push({
            requestId: candidate.id,
            reason: caught instanceof Error ? caught.message : "unknown",
          });
        }
      }
      countEvent("retention_disposals_processed");
      return data(
        {
          processedCount: completed.length,
          completed,
          skipped,
          checkedAt: new Date().toISOString(),
        },
        request,
      );
    });

      app.post("/api/v1/retention-disposal-requests/:id/approve", async (request) => {
      requireRoles(request, "admin");
      const body = parse(approveRetentionDisposalRequestSchema, request.body);
      return data(
        await platformStore.approveRetentionDisposalRequest({
          tenantId: tenantOf(request),
          requestId: idOf(request),
          approvedBy: body.approvedBy,
        }),
        request,
      );
    });

      app.post("/api/v1/retention-disposal-requests/:id/complete", async (request) => {
      requireRoles(request, "admin");
      const body = parse(completeRetentionDisposalRequestSchema, request.body);
      return data(
        await platformStore.completeRetentionDisposalRequest({
          tenantId: tenantOf(request),
          requestId: idOf(request),
          actorPersonId: body.actorPersonId,
        }),
        request,
      );
    });

      app.post("/api/v1/retention-disposal-requests/:id/cancel", async (request) => {
      requireRoles(request, "admin");
      const body = parse(cancelRetentionDisposalRequestSchema, request.body);
      return data(
        await platformStore.cancelRetentionDisposalRequest({
          tenantId: tenantOf(request),
          requestId: idOf(request),
          actorPersonId: body.actorPersonId,
          reason: body.reason,
        }),
        request,
      );
    });


  };
}
