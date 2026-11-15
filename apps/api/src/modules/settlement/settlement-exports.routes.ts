/**
 * 结算导出域路由（银行导出/确认回执）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { settlementCsv } from "../../store.js";
import { sha256 } from "@anari/policy-dsl";
import type { SettlementPort,
  TenantPort,
} from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import { ConflictError } from "../../store.js";
import {
  acknowledgeSettlementExportSchema,
  recordSettlementExportSchema,
} from "@anari/contracts";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  requireActorRequired,
  requireSettlementGo,
} from "../../http-helpers.js";

export function registerSettlementExportRoutes(deps: {
  platformStore: SettlementPort & TenantPort;
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
  exportHeaders: (
    request: FastifyRequest,
    csv: string,
    classification: string,
  ) => Record<string, string>;
}): FastifyPluginAsync {
  const { platformStore, storeFor, assertExportAllowed, assertExportDlp, auditExport, exportHeaders } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/settlement-batches/:id/exports", async (request, reply) => {
    requireRoles(request, "finance");
    // D-07：结算导出属正式结算动作，需租户 GO。
    await requireSettlementGo(request, platformStore);
    const body = parse(recordSettlementExportSchema, request.body);
    const batch = await storeFor(request).getSettlementBatch(idOf(request));
    if (
      !["EXPORTED", "ACKNOWLEDGED", "ADJUSTMENT_REQUIRED"].includes(
        batch.status,
      )
    ) {
      throw new ConflictError(
        `SETTLEMENT_BATCH_NOT_EXPORTED: ${batch.status}`,
      );
    }
    const csv = settlementCsv(batch, batch.lines ?? []);
    const exportedBy = requireActorRequired(
      request,
      body.exportedBy,
      "exporting a settlement batch",
    );
    return reply.status(201).send(
      data(
        await platformStore.createSettlementExport({
          tenantId: tenantOf(request),
          batchId: batch.id,
          exportRef: body.exportRef ?? `EXPORT-${batch.batchNo}-${Date.now()}`,
          exportHash: sha256(csv),
          exportedBy,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/settlement-exports", async (request) => {
    requireRoles(request, "finance");
    const query = request.query as { batchId?: string };
    return data(
      await platformStore.listSettlementExports(
        tenantOf(request),
        query.batchId,
      ),
      request,
    );
  });

  app.get("/api/v1/settlement-exports/:id", async (request) => {
    requireRoles(request, "finance");
    return data(
      await platformStore.getSettlementExport(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.post("/api/v1/settlement-exports/:id/acknowledge", async (request) => {
    requireRoles(request, "finance");
    const body = parse(acknowledgeSettlementExportSchema, request.body);
    return data(
      await platformStore.acknowledgeSettlementExport({
        tenantId: tenantOf(request),
        exportId: idOf(request),
        externalReference: body.externalReference,
        acknowledgedAt: body.acknowledgedAt,
      }),
      request,
    );
  });
  };
}
