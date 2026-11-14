/**
 * 员工数据治理域路由（子群属性/字段访问策略）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { DEFAULT_FIELD_ACCESS_POLICIES } from "../../field-access-defaults.js";
import { sha256 } from "@anari/policy-dsl";
import type { FieldAccessPolicy } from "@anari/contracts";
import type { DatagovPort, TenantPort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import {
  recordWorkforceSubgroupAttributeSchema,
  updateFieldAccessPoliciesSchema,
  withdrawWorkforceSubgroupAttributeSchema,
  workforceSubgroupDimensionSchema,
} from "@anari/contracts";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  requireActor,
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


export function registerWorkforceGovernanceRoutes(deps: {
  platformStore: DatagovPort & TenantPort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
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
}): FastifyPluginAsync {
  const { platformStore, storeFor, fieldPoliciesFor, fieldMatchContextFor, redactResourceFields } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/workforce-subgroup-attributes", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(recordWorkforceSubgroupAttributeSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.recordWorkforceSubgroupAttribute({
          tenantId: tenantOf(request),
          personId: body.personId,
          dimension: body.dimension,
          value: body.value,
          consentRef: body.consentRef,
          consentedAt: body.consentedAt,
          expiresAt: body.expiresAt,
          recordedBy: requireActor(request, body.recordedBy, "record"),
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/field-access-policies", async (request) => {
    requireRoles(request, "admin", "manager", "finance");
    const tenant = await platformStore.getTenant(tenantOf(request));
    const configured = (
      tenant.settings as { fieldAccessPolicies?: unknown }
    ).fieldAccessPolicies;
    const policies: Record<string, FieldAccessPolicy> =
      configured && typeof configured === "object"
        ? (configured as Record<string, FieldAccessPolicy>)
        : {};
    return data(
      {
        defaults: DEFAULT_FIELD_ACCESS_POLICIES,
        configured: policies,
        effective: { ...DEFAULT_FIELD_ACCESS_POLICIES, ...policies },
      },
      request,
    );
  });

  app.put("/api/v1/field-access-policies", async (request) => {
    requireRoles(request, "admin");
    const body = parse(updateFieldAccessPoliciesSchema, request.body);
    const tenantId = tenantOf(request);
    const tenant = await platformStore.getTenant(tenantId);
    const before = (
      tenant.settings as { fieldAccessPolicies?: unknown }
    ).fieldAccessPolicies;
    await platformStore.updateTenantSettings({
      tenantId,
      settings: { fieldAccessPolicies: body.policies },
    });
    await storeFor(request).recordAuditEvent({
      actorType: "USER",
      actorId:
        request.authContext?.userId ?? request.authContext?.personId,
      action: "FIELD_ACCESS_POLICIES_UPDATED",
      objectType: "TENANT_SETTINGS",
      objectId: tenantId,
      beforeHash: sha256(before ?? {}),
      afterHash: sha256(body.policies),
      reason: `overrides=${Object.keys(body.policies).length}`,
    });
    return data(
      {
        defaults: DEFAULT_FIELD_ACCESS_POLICIES,
        configured: body.policies,
        effective: { ...DEFAULT_FIELD_ACCESS_POLICIES, ...body.policies },
      },
      request,
    );
  });

  app.get("/api/v1/workforce-subgroup-attributes", async (request) => {
    requireRoles(request, "admin");
    const query = request.query as {
      personId?: string;
      dimension?: string;
    };
    const dimension = query.dimension
      ? workforceSubgroupDimensionSchema.safeParse(query.dimension)
      : undefined;
    if (dimension && !dimension.success) {
      throw new BadRequestError(
        "INVALID_SUBGROUP_DIMENSION",
        `Unknown subgroup dimension ${query.dimension}`,
      );
    }
    return data(
      await platformStore.listWorkforceSubgroupAttributes(
        tenantOf(request),
        {
          personId: query.personId,
          dimension: dimension?.data,
        },
      ),
      request,
    );
  });

  app.post("/api/v1/workforce-subgroup-attributes/withdraw", async (request) => {
    requireRoles(request, "admin");
    const body = parse(withdrawWorkforceSubgroupAttributeSchema, request.body);
    return data(
      await platformStore.withdrawWorkforceSubgroupAttribute({
        tenantId: tenantOf(request),
        personId: body.personId,
        dimension: body.dimension,
      }),
      request,
    );
  });
  };
}
