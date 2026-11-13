/**
 * 审计与隐私域路由（审计事件/红队豁免/DPIA/DSAR/断路授权/DLP）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { AuditEvent } from "@anari/domain";
import { scanExportDlp } from "../../dlp.js";
import { sha256 } from "@anari/policy-dsl";
import type { PlatformStore } from "../../platform-store.js";
import type { IncentiveStore } from "../../store-interface.js";
import { NotFoundError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  approveDpiaSchema,
  createAuditRedactionSchema,
  createBreakGlassGrantSchema,
  createDpiaSchema,
  createDsarSchema,
  resolveDsarSchema,
} from "@anari/contracts";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  isPrivileged,
  ownPersonId,
  policyBody,
} from "../../http-helpers.js";

/** 与 app.ts 中的 BadRequestError 同语义（协议层 400）。 */
class BadRequestError extends Error {
  readonly statusCode = 400;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}


export function registerAuditPrivacyRoutes(deps: {
  platformStore: PlatformStore;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
  auditEventsForViewer: (request: FastifyRequest, events: AuditEvent[]) => Promise<AuditEvent[]>;
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
  exportHeaders: (
    request: FastifyRequest,
    csv: string,
    classification: string,
  ) => Record<string, string>;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent, auditEventsForViewer, assertExportAllowed, assertExportDlp, auditExport, exportHeaders } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/break-glass-grants", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createBreakGlassGrantSchema, request.body);
    const grant = await platformStore.createBreakGlassGrant({
      tenantId: tenantOf(request),
      scope: body.scope,
      granteePersonId: body.granteePersonId,
      reason: body.reason,
      grantedBy: body.grantedBy,
      expiresAt: body.expiresAt,
    });
    countEvent("break_glass_grant_created");
    return reply.status(201).send(data(grant, request));
  });

  app.get("/api/v1/break-glass-grants", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.listBreakGlassGrants(tenantOf(request)),
      request,
    );
  });

  app.post("/api/v1/break-glass-grants/:id/revoke", async (request) => {
    requireRoles(request, "admin");
    const grant = await platformStore.revokeBreakGlassGrant({
      tenantId: tenantOf(request),
      grantId: idOf(request),
    });
    countEvent("break_glass_grant_revoked");
    return data(grant, request);
  });
  app.post("/api/v1/dpia-records", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createDpiaSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createDpia({
          tenantId: tenantOf(request),
          assessmentType: body.assessmentType,
          scope: body.scope,
          riskSummary: body.riskSummary,
          mitigationSummary: body.mitigationSummary,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/dpia-records", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(await platformStore.listDpias(tenantOf(request)), request);
  });

  app.get("/api/v1/dpia-records/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getDpia(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.post("/api/v1/dpia-records/:id/approve", async (request) => {
    requireRoles(request, "admin");
    const body = parse(approveDpiaSchema, request.body);
    return data(
      await platformStore.approveDpia({
        tenantId: tenantOf(request),
        dpiaId: idOf(request),
        approvedBy: body.approvedBy,
      }),
      request,
    );
  });

  async function buildPersonDataPackage(
    request: FastifyRequest,
    personId: string,
  ): Promise<Record<string, unknown>> {
    const tenantId = tenantOf(request);
    const store = storeFor(request);
    const [people, contracts, workPackages, claims, evidence, confirmations, appeals, notifications, drafts, decisions, proposals, dsars, attributes, notices] =
      await Promise.all([
        platformStore.listPersons(tenantId),
        platformStore.listEmploymentContracts(tenantId, personId),
        store.listWorkPackages(),
        store.listClaims(),
        store.listEvidence(),
        store.listConfirmations(personId),
        store.listAppeals(),
        store.listNotifications({ recipientPersonId: personId }),
        store.listEvaluationDrafts({ personId }),
        store.listEvaluationDecisions({ personId }),
        platformStore.listAiScoreProposals(tenantId, { personId }),
        platformStore.listDsars(tenantId, personId),
        platformStore.listWorkforceSubgroupAttributes(tenantId, { personId }),
        platformStore.listNotices(tenantId),
      ]);
    const person = people.find((candidate) => candidate.id === personId);
    if (!person) throw new NotFoundError(`Person ${personId} not found`);
    const acknowledgements = (
      await Promise.all(
        notices.map(async (notice) => {
          const overview = await platformStore.listAcknowledgements(
            tenantId,
            notice.id,
          );
          return overview.acknowledgements
            .filter((row) => row.personId === personId)
            .map((row) => ({
              noticeId: notice.id,
              noticeType: notice.noticeType,
              title: notice.title,
              decision: row.acknowledgedAt
                ? "ACKNOWLEDGED"
                : row.declinedAt
                  ? "DECLINED"
                  : "PENDING",
              acknowledgedAt: row.acknowledgedAt,
              declinedAt: row.declinedAt,
            }));
        }),
      )
    ).flat();
    const ownWorkPackages = workPackages
      .filter(
        (workPackage) =>
          workPackage.ownerPersonId === personId ||
          workPackage.members.some((member) => member.personId === personId),
      )
      .map((workPackage) => {
        const membership = workPackage.members.find(
          (member) => member.personId === personId,
        );
        return {
          id: workPackage.id,
          title: workPackage.title,
          status: workPackage.status,
          packageType: workPackage.packageType,
          dueAt: workPackage.dueAt,
          myRole: membership?.responsibilityCode ??
            (workPackage.ownerPersonId === personId ? "OWNER" : "MEMBER"),
          myExpectedOutput: membership?.expectedOutput,
        };
      });
    const payload = {
      packageVersion: "v1",
      generatedAt: new Date().toISOString(),
      personId,
      profile: {
        id: person.id,
        employeeCode: person.employeeCode,
        displayName: person.displayName,
        employmentStatus: person.employmentStatus,
        managerPersonId: person.managerPersonId,
      },
      contracts,
      workPackages: ownWorkPackages,
      claims: claims.filter((claim) => claim.claimantPersonId === personId),
      evidence: evidence.filter((node) => node.submittedBy === personId),
      confirmations,
      appeals: appeals
        .filter((appeal) => appeal.appellantPersonId === personId)
        .map((appeal) => ({
          id: appeal.id,
          targetType: appeal.targetType,
          targetId: appeal.targetId,
          reasonCode: appeal.reasonCode,
          statement: appeal.statement,
          status: appeal.status,
          resolution: appeal.resolution,
          dueAt: appeal.dueAt,
          createdAt: appeal.createdAt,
          resolvedAt: appeal.resolvedAt,
        })),
      notifications,
      evaluationDrafts: drafts,
      evaluationDecisions: decisions,
      aiProposals: proposals,
      dsars,
      subgroupAttributes: attributes,
      acknowledgements,
    };
    return { ...payload, packageHash: sha256(payload) };
  }

  app.get("/api/v1/me/data-package", async (request, reply) => {
    assertExportAllowed(request);
    const personId = ownPersonId(request);
    if (!personId) {
      throw new ForbiddenError("employee identity is required");
    }
    const payload = await buildPersonDataPackage(request, personId);
    const text = JSON.stringify(payload);
    const findings = scanExportDlp(text);
    return reply
      .headers(exportHeaders(request, text, "PERSONAL_DATA"))
      .header("x-export-dlp-findings", findings.join(","))
      .send(data(payload, request));
  });

  app.get("/api/v1/dsar-requests/:id/package", async (request, reply) => {
    requireRoles(request, "admin", "finance");
    assertExportAllowed(request);
    const dsar = await platformStore.getDsar(
      tenantOf(request),
      idOf(request),
    );
    const payload = await buildPersonDataPackage(request, dsar.personId);
    const text = JSON.stringify(payload);
    const query = request.query as { approvalRequestId?: string };
    await assertExportDlp(
      request,
      text,
      "DSAR_PACKAGE",
      idOf(request),
      query.approvalRequestId,
    );
    await auditExport(
      request,
      "DSAR_PACKAGE_EXPORTED",
      "DSAR_REQUEST",
      idOf(request),
    );
    return reply
      .headers(exportHeaders(request, text, "PERSONAL_DATA"))
      .send(data(payload, request));
  });

  app.post("/api/v1/dsar-requests", async (request, reply) => {
    const body = parse(createDsarSchema, request.body);
    const own = ownPersonId(request);
    if (!isPrivileged(request)) {
      if (!own) {
        throw new ForbiddenError(
          "employee identity is required (person_id claim or X-Person-Id)",
        );
      }
      if (body.personId && body.personId !== own) {
        throw new ForbiddenError(
          "an employee cannot create a DSAR for another person",
        );
      }
    }
    const personId = body.personId ?? own;
    if (!personId) {
      throw new ForbiddenError(
        "person identity is required (person_id claim, X-Person-Id or personId)",
      );
    }
    const dsar = await platformStore.createDsar({
      tenantId: tenantOf(request),
      personId,
      requestType: body.requestType,
      dueAt: body.dueAt,
    });
    countEvent("dsar_created");
    return reply.status(201).send(data(dsar, request));
  });

  app.get("/api/v1/dsar-requests", async (request) => {
    const query = request.query as { personId?: string };
    let personId = query.personId;
    if (!isPrivileged(request)) {
      const own = ownPersonId(request);
      if (!own) {
        throw new ForbiddenError(
          "employee identity is required (person_id claim or X-Person-Id)",
        );
      }
      if (personId && personId !== own) {
        throw new ForbiddenError("an employee cannot list another person's DSARs");
      }
      personId = own;
    }
    return data(
      await platformStore.listDsars(tenantOf(request), personId),
      request,
    );
  });

  app.get("/api/v1/dsar-requests/:id", async (request) => {
    const dsar = await platformStore.getDsar(
      tenantOf(request),
      idOf(request),
    );
    if (!isPrivileged(request)) {
      const own = ownPersonId(request);
      if (!own || dsar.personId !== own) {
        throw new ForbiddenError("an employee can only read their own DSARs");
      }
    }
    return data(dsar, request);
  });

  app.post("/api/v1/dsar-requests/:id/resolve", async (request) => {
    requireRoles(request, "admin");
    const body = parse(resolveDsarSchema, request.body);
    const resolved = await platformStore.resolveDsar({
      tenantId: tenantOf(request),
      dsarId: idOf(request),
      resolution: body.resolution,
      resolutionRef: body.resolutionRef,
    });
    countEvent(
      body.resolution === "RESOLVED"
        ? "dsar_resolved"
        : "dsar_rejected",
    );
    return data(resolved, request);
  });
  app.post("/api/v1/audit-events/:id/redactions", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createAuditRedactionSchema, request.body);
    const redaction = await platformStore.createAuditRedaction({
      tenantId: tenantOf(request),
      auditEventId: idOf(request),
      replacement: body.replacement ?? "[REDACTED]",
      reason: body.reason,
      requestedBy: body.requestedBy,
      approvedBy: body.approvedBy,
    });
    countEvent("audit_redaction_created");
    return reply.status(201).send(data(redaction, request));
  });

  app.get("/api/v1/audit-redactions", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.listAuditRedactions(tenantOf(request)),
      request,
    );
  });

  app.get("/api/v1/audit-events", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { limit?: string };
    const parsed = Number(query.limit ?? 100);
    const limit = Number.isFinite(parsed) ? parsed : 100;
    return data(
      await auditEventsForViewer(
        request,
        await storeFor(request).listAuditEvents(limit),
      ),
      request,
    );
  });

  app.get("/api/v1/audit-events/durability", async (request) => {
    requireRoles(request, "admin", "finance");
    const wormConfigured = Boolean(process.env.AUDIT_WORM_URI);
    const mirrorConfigured = Boolean(process.env.AUDIT_MIRROR_URI);
    const tsaConfigured = Boolean(process.env.AUDIT_TSA_URL);
    const drillAt = process.env.AUDIT_RESTORE_DRILL_AT;
    const drillTime = drillAt ? Date.parse(drillAt) : Number.NaN;
    const restoreDrillRecent =
      Number.isFinite(drillTime) &&
      Date.now() - drillTime <= 90 * 24 * 60 * 60 * 1000;
    const ready =
      wormConfigured &&
      mirrorConfigured &&
      tsaConfigured &&
      restoreDrillRecent;
    return data(
      {
        generatedAt: new Date().toISOString(),
        ready,
        checks: {
          wormConfigured,
          mirrorConfigured,
          tsaConfigured,
          restoreDrillRecent,
          restoreDrillAt: Number.isFinite(drillTime)
            ? new Date(drillTime).toISOString()
            : null,
        },
        note: ready
          ? "Deployment reports WORM, dual-copy, TSA and a recent restore drill. Keep bucket policies and TSA receipts in the evidence pack."
          : "Durability is not fully configured. This reports configuration presence only; it does not prove the controls work. Complete the MON-07 runbook and attach evidence.",
      },
      request,
    );
  });

  app.get("/api/v1/audit-events/anchor", async (request) => {
    requireRoles(request, "admin");
    const query = request.query as {
      fromSequence?: string;
      toSequence?: string;
    };
    const fromSequence = query.fromSequence
      ? Number(query.fromSequence)
      : undefined;
    const toSequence = query.toSequence
      ? Number(query.toSequence)
      : undefined;
    const events = (await storeFor(request).listAuditEvents(500))
      .filter(
        (event) =>
          (fromSequence === undefined ||
            event.sequence >= fromSequence) &&
          (toSequence === undefined || event.sequence <= toSequence),
      )
      .sort((a, b) => a.sequence - b.sequence);
    const eventHashes = events.map((event) => event.eventHash);
    return data(
      {
        tenantId: tenantOf(request),
        generatedAt: new Date().toISOString(),
        window: {
          fromSequence: events[0]?.sequence ?? null,
          toSequence: events.at(-1)?.sequence ?? null,
          eventCount: events.length,
        },
        rootHash: sha256(eventHashes.join("|")),
        firstEventHash: events[0]?.eventHash ?? null,
        lastEventHash: events.at(-1)?.eventHash ?? null,
        note: "Timestamp rootHash with an external TSA and store it with the WORM copies.",
      },
      request,
    );
  });

  app.get("/api/v1/audit-events/verify", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      { valid: await storeFor(request).verifyAuditChain() },
      request,
    );
  });
  app.get("/api/v1/export-dlp-rules", async (request) => {
    requireRoles(request, "finance", "admin");
    const tenant = await platformStore.getTenant(tenantOf(request));
    return data(tenant.settings?.exportDlpRules ?? [], request);
  });

  app.put("/api/v1/export-dlp-rules", async (request) => {
    requireRoles(request, "finance", "admin");
    const body = policyBody(request);
    if (!Array.isArray(body.rules)) {
      throw new BadRequestError("INVALID_INPUT", "rules 必须为数组");
    }
    for (const rule of body.rules as Array<Record<string, unknown>>) {
      if (typeof rule.code !== "string" || !rule.code.trim()) {
        throw new BadRequestError("INVALID_INPUT", "规则 code 必须非空");
      }
      if (typeof rule.pattern !== "string" || !rule.pattern) {
        throw new BadRequestError("INVALID_INPUT", "规则 pattern 必须非空");
      }
      try {
        new RegExp(rule.pattern, typeof rule.flags === "string" ? rule.flags : "g");
      } catch {
        throw new BadRequestError(
          "INVALID_INPUT",
          `规则 ${rule.code} 的正则无效`,
        );
      }
    }
    const tenant = await platformStore.updateTenantSettings({
      tenantId: tenantOf(request),
      settings: { exportDlpRules: body.rules },
    });
    return data(tenant.settings?.exportDlpRules ?? [], request);
  });
  };
}
