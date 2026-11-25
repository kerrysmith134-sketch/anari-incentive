/**
 * 平台管理域路由（租户/计划/订阅/发票/成员/人员/组织架构/飞书通讯录）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PlatformStore } from "../../platform-store.js";
import type { IncentiveStore } from "../../store-interface.js";
import { NotFoundError } from "../../store.js";
import {
  addMembershipSchema,
  assignPersonOrgSchema,
  createOrgNodeSchema,
  createPlatformPersonSchema,
  importPersonSchema,
  createPlatformTenantSchema,
  createPlatformUserSchema,
  createSubscriptionPlanSchema,
  createTenantInvoiceSchema,
  feishuSyncSchema,
  linkPersonUserSchema,
  setPersonManagerSchema,
  setTenantInvoiceStatusSchema,
  setTenantSubscriptionSchema,
  updateTenantSettingsSchema,
} from "@anari/contracts";
import { syncFeishuDirectory } from "../../feishu-sync.js";
import { sha256 } from "@anari/policy-dsl";
import { requireTenantMember } from "../../http-helpers.js";
import {
  data,
  errorBody,
  parse,
  tenantOf,
  idOf,
  paramOf,
  isPlatformAdmin,
  requirePlatformAdmin,
  requireTenantAdmin,
} from "../../http-helpers.js";

export function registerPlatformAdminRoutes(deps: {
  platformStore: PlatformStore;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
  storeForTenant: (tenantId: string) => IncentiveStore | undefined;
  feishu?: {
    appId: string;
    appSecret: string;
    sessionSecret: string;
    tenantId: string;
    consoleBaseUrl?: string;
    fetchImpl?: typeof fetch;
  };
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent, storeForTenant, feishu } = deps;
  return async (app: FastifyInstance) => {
  app.get("/api/v1/public/plans", async (request) => {
    return data(await platformStore.listSubscriptionPlans(true), request);
  });

  app.post("/api/v1/platform/tenants", async (request, reply) => {
    requirePlatformAdmin(request);
    const body = parse(createPlatformTenantSchema, request.body);
    return reply
      .status(201)
      .send(data(await platformStore.createTenant(body), request));
  });

  app.get("/api/v1/platform/tenants", async (request) => {
    if (!isPlatformAdmin(request)) {
      // Tenant admins may see their own workspace only, never the portfolio.
      requireTenantAdmin(request, tenantOf(request));
      const own = await platformStore.getTenant(tenantOf(request));
      return data([own], request);
    }
    return data(await platformStore.listTenants(), request);
  });

  app.post("/api/v1/platform/tenants/:id/settings", async (request) => {
    const tenantId = idOf(request);
    requireTenantAdmin(request, tenantId);
    const body = parse(updateTenantSettingsSchema, request.body);
    const tenant = await platformStore.getTenant(tenantId);
    const before = (
      tenant.settings as { fieldAccessPolicies?: unknown }
    ).fieldAccessPolicies;
    const updated = await platformStore.updateTenantSettings({
      tenantId,
      settings: body,
    });
    if (body.fieldAccessPolicies) {
      const auditStore =
        tenantId === tenantOf(request)
          ? storeFor(request)
          : typeof storeForTenant === "function"
            ? storeForTenant(tenantId)
            : undefined;
      await auditStore?.recordAuditEvent({
        actorType: "USER",
        actorId:
          request.authContext?.userId ?? request.authContext?.personId,
        action: "FIELD_ACCESS_POLICIES_UPDATED",
        objectType: "TENANT_SETTINGS",
        objectId: tenantId,
        beforeHash: sha256(before ?? {}),
        afterHash: sha256(body.fieldAccessPolicies),
        reason: `overrides=${Object.keys(body.fieldAccessPolicies).length}`,
      });
    }
    return data(updated, request);
  });

  app.post("/api/v1/platform/users", async (request, reply) => {
    requirePlatformAdmin(request);
    const body = parse(createPlatformUserSchema, request.body);
    return reply
      .status(201)
      .send(data(await platformStore.createUser(body), request));
  });

  app.get("/api/v1/platform/users", async (request) => {
    requirePlatformAdmin(request);
    return data(await platformStore.listUsers(), request);
  });

  app.post("/api/v1/platform/tenants/:id/memberships", async (request, reply) => {
      requireTenantAdmin(request, idOf(request));
      const body = parse(addMembershipSchema, request.body);
      return reply.status(201).send(
        data(
          await platformStore.addMembership({
            tenantId: idOf(request),
            userId: body.userId,
            roleCodes: body.roleCodes,
          }),
          request,
        ),
      );
  });

  app.get("/api/v1/platform/tenants/:id/memberships", async (request) => {
    requireTenantAdmin(request, idOf(request));
    return data(
      await platformStore.listMemberships(idOf(request)),
      request,
    );
  });

  app.post("/api/v1/platform/tenants/:id/persons", async (request, reply) => {
    requireTenantAdmin(request, idOf(request));
    const body = parse(createPlatformPersonSchema, request.body);
    const tenantId = idOf(request);
    const subscription =
      await platformStore.getTenantSubscription(tenantId);
    if (subscription && subscription.status !== "CANCELED") {
      const plans = await platformStore.listSubscriptionPlans();
      const plan = plans.find(
        (candidate) => candidate.code === subscription.planCode,
      );
      const consumesSeat = (body.employmentStatus ?? "ACTIVE") === "ACTIVE";
      if (plan && plan.seatLimit >= 0 && consumesSeat) {
        const activePeople = (await platformStore.listPersons(tenantId)).filter(
          (candidate) => candidate.employmentStatus === "ACTIVE",
        ).length;
        if (activePeople >= plan.seatLimit) {
          return reply.status(402).send({
            ...errorBody(
              "SEAT_LIMIT_REACHED",
              `plan ${plan.code} allows ${plan.seatLimit} active people; upgrade the subscription to onboard more`,
            ),
            meta: { correlation_id: request.id },
          });
        }
      }
    }
    return reply.status(201).send(
      data(
        await platformStore.createPerson({
          tenantId,
          employeeCode: body.employeeCode,
          displayName: body.displayName,
          employmentStatus: body.employmentStatus,
          userId: body.userId,
        }),
        request,
      ),
    );
  });

  app.post("/api/v1/people/import", async (request, reply) => {
    const tenantId = tenantOf(request);
    requireTenantAdmin(request, tenantId);
    const body = parse(importPersonSchema, request.body);
    const people = await platformStore.listPersons(tenantId);
    const identities = await platformStore.listExternalIdentities(tenantId, {
      sourceSystem: body.sourceSystem,
      objectType: "PERSON",
    });
    const linked = identities.find((item) => item.externalId === body.externalId);
    let person = linked
      ? people.find((candidate) => candidate.id === linked.personId)
      : undefined;
    let created = false;
    if (!person) {
      const employeeCode = body.employeeCode ?? `EXT-${body.externalId}`;
      person = people.find((candidate) => candidate.employeeCode === employeeCode);
      if (!person) {
        person = await platformStore.createPerson({
          tenantId,
          employeeCode,
          displayName: body.displayName,
          employmentStatus: body.employmentStatus,
        });
        created = true;
      }
      await platformStore.upsertExternalIdentity({
        tenantId,
        sourceSystem: body.sourceSystem,
        externalId: body.externalId,
        personId: person.id,
        objectType: "PERSON",
      });
    }
    return reply.status(created ? 201 : 200).send(data({ person, created }, request));
  });

  app.get("/api/v1/platform/tenants/:id/persons", async (request) => {
    requireTenantMember(request, idOf(request));
    return data(await platformStore.listPersons(idOf(request)), request);
  });

  app.post("/api/v1/platform/feishu/sync-directory", async (request, reply) => {
    requirePlatformAdmin(request);
    if (!feishu) {
      return reply.status(501).send({
        ...errorBody(
          "FEISHU_NOT_CONFIGURED",
          "Feishu integration is not configured (FEISHU_APP_ID/FEISHU_APP_SECRET); directory sync is unavailable",
        ),
        meta: { correlation_id: request.id },
      });
    }
    const body = parse(feishuSyncSchema, request.body);
    try {
      const result = await syncFeishuDirectory(platformStore, {
        tenantId: feishu.tenantId,
        appId: feishu.appId,
        appSecret: feishu.appSecret,
        dryRun: body.dryRun ?? true,
        allowCreate: body.allowCreate ?? false,
        fetchImpl: feishu.fetchImpl,
      });
      countEvent("feishu_directory_synced");
      return data(result, request);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "directory sync failed";
      return reply.status(502).send({
        ...errorBody("FEISHU_SYNC_FAILED", message),
        meta: { correlation_id: request.id },
      });
    }
  });

  app.post("/api/v1/platform/plans", async (request, reply) => {
    requirePlatformAdmin(request);
    const body = parse(createSubscriptionPlanSchema, request.body);
    return reply
      .status(201)
      .send(
        data(
          await platformStore.createSubscriptionPlan({
            ...body,
            features: body.features ?? [],
          }),
          request,
        ),
      );
  });

  app.get("/api/v1/platform/plans", async (request) => {
    requirePlatformAdmin(request);
    return data(await platformStore.listSubscriptionPlans(false), request);
  });

  app.get("/api/v1/platform/tenants/:id/subscription", async (request) => {
    requireTenantAdmin(request, idOf(request));
    const subscription = await platformStore.getTenantSubscription(
      idOf(request),
    );
    if (!subscription) throw new NotFoundError(`TenantSubscription ${idOf(request)} not found`);
    return data(subscription, request);
  });

  app.put("/api/v1/platform/tenants/:id/subscription", async (request) => {
    requireTenantAdmin(request, idOf(request));
    const body = parse(setTenantSubscriptionSchema, request.body);
    return data(
      await platformStore.setTenantSubscription({
        tenantId: idOf(request),
        ...body,
      }),
      request,
    );
  });

  app.post("/api/v1/platform/tenants/:id/invoices", async (request, reply) => {
    requireTenantAdmin(request, idOf(request));
    const body = parse(createTenantInvoiceSchema, request.body);
    return reply
      .status(201)
      .send(
        data(
          await platformStore.createInvoice({
            tenantId: idOf(request),
            ...body,
          }),
          request,
        ),
      );
  });

  app.get("/api/v1/platform/tenants/:id/invoices", async (request) => {
    requireTenantAdmin(request, idOf(request));
    return data(await platformStore.listInvoices(idOf(request)), request);
  });

  app.post("/api/v1/platform/invoices/:id/status", async (request) => {
    requirePlatformAdmin(request);
    const body = parse(setTenantInvoiceStatusSchema, request.body);
    return data(
      await platformStore.setInvoiceStatus({
        invoiceId: idOf(request),
        status: body.status,
      }),
      request,
    );
  });
  app.post("/api/v1/platform/tenants/:id/org-nodes", async (request, reply) => {
    requireTenantAdmin(request, idOf(request));
    const body = parse(createOrgNodeSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createOrgNode({
          tenantId: idOf(request),
          name: body.name,
          nodeType: body.nodeType,
          parentId: body.parentId,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/platform/tenants/:id/org-nodes", async (request) => {
    requireTenantMember(request, idOf(request));
    return data(await platformStore.listOrgNodes(idOf(request)), request);
  });

  app.post("/api/v1/platform/tenants/:id/persons/:personId/org-assignments", async (request, reply) => {
    requireTenantAdmin(request, idOf(request));
    const body = parse(assignPersonOrgSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.assignPersonOrg({
          tenantId: idOf(request),
          personId: paramOf(request, "personId"),
          orgNodeId: body.orgNodeId,
          validFrom: body.validFrom,
          validTo: body.validTo,
          allocation: body.allocation,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/platform/tenants/:id/persons/:personId/org-assignments", async (request) => {
    requireTenantAdmin(request, idOf(request));
    return data(
      await platformStore.listOrgAssignments(
        idOf(request),
        paramOf(request, "personId"),
      ),
      request,
    );
  });

  app.post("/api/v1/platform/tenants/:id/persons/:personId/manager", async (request) => {
    requireTenantAdmin(request, idOf(request));
    const body = parse(setPersonManagerSchema, request.body);
    return data(
      await platformStore.setPersonManager({
        tenantId: idOf(request),
        personId: paramOf(request, "personId"),
        managerPersonId: body.managerPersonId,
      }),
      request,
    );
  });

  app.post("/api/v1/platform/tenants/:id/persons/:personId/link-user", async (request) => {
    requireTenantAdmin(request, idOf(request));
    const body = parse(linkPersonUserSchema, request.body);
    return data(
      await platformStore.linkPersonUser({
        tenantId: idOf(request),
        personId: paramOf(request, "personId"),
        userId: body.userId,
      }),
      request,
    );
  });
  };
}
