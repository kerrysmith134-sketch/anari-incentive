/**
 * Commercial 域路由（Sprint 3）：Account→Opportunity→Quote→Contract→Order。
 *
 * 只做业务对象生命周期；CRM/ERP 连接器仍走 integration 资源流。Deal 不作为
 * Order 导入，必须先经 Opportunity→Quote→Contract。
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { CommercialPort } from "../../store-ports.js";
import {
  createCommercialAccountSchema,
  createCommercialContractSchema,
  createCommercialOpportunitySchema,
  createCommercialOrderSchema,
  createCommercialQuoteSchema,
  importCommercialAccountSchema,
  importCommercialOpportunitySchema,
  importCommercialQuoteSchema,
  importCommercialContractSchema,
  importCommercialOrderSchema,
} from "@anari/contracts";
import { data, idOf, parse, requireRoles, tenantOf } from "../../http-helpers.js";

export function registerCommercialRoutes(deps: {
  platformStore: CommercialPort;
}): FastifyPluginAsync {
  const { platformStore } = deps;
  return async (app: FastifyInstance) => {
    app.get("/api/v1/commercial/accounts", async (request) => {
      requireRoles(request, "manager", "finance", "integration");
      return data(await platformStore.listAccounts(tenantOf(request)), request);
    });

    app.post("/api/v1/commercial/accounts", async (request, reply) => {
      requireRoles(request, "admin", "manager");
      const body = parse(createCommercialAccountSchema, request.body);
      return reply.status(201).send(
        data(
          await platformStore.createAccount({
            tenantId: tenantOf(request),
            externalAccountId: body.externalAccountId,
            name: body.name,
            ownerPersonId: body.ownerPersonId,
          }),
          request,
        ),
      );
    });

    app.post("/api/v1/commercial/import/accounts", async (request, reply) => {
      requireRoles(request, "admin", "integration");
      const body = parse(importCommercialAccountSchema, request.body);
      const result = await platformStore.upsertCommercialAccount({
        tenantId: tenantOf(request),
        ...body,
      });
      return reply.status(result.created ? 201 : 200).send(data(result, request));
    });

    app.post("/api/v1/commercial/import/opportunities", async (request, reply) => {
      requireRoles(request, "admin", "integration");
      const body = parse(importCommercialOpportunitySchema, request.body);
      const result = await platformStore.upsertCommercialOpportunity({
        tenantId: tenantOf(request),
        ...body,
      });
      return reply.status(result.created ? 201 : 200).send(data(result, request));
    });

    app.get("/api/v1/commercial/opportunities", async (request) => {
      requireRoles(request, "manager", "finance", "integration");
      const query = request.query as { accountId?: string };
      return data(
        await platformStore.listOpportunities(
          tenantOf(request),
          query.accountId,
        ),
        request,
      );
    });

    app.post("/api/v1/commercial/opportunities", async (request, reply) => {
      requireRoles(request, "admin", "manager");
      const body = parse(createCommercialOpportunitySchema, request.body);
      return reply.status(201).send(
        data(
          await platformStore.createOpportunity({
            tenantId: tenantOf(request),
            accountId: body.accountId,
            externalOpportunityId: body.externalOpportunityId,
            name: body.name,
            stage: body.stage,
            estimatedAmount: body.estimatedAmount,
            currency: body.currency,
            ownerPersonId: body.ownerPersonId,
          }),
          request,
        ),
      );
    });

    app.post("/api/v1/commercial/import/quotes", async (request, reply) => {
      requireRoles(request, "admin", "integration");
      const body = parse(importCommercialQuoteSchema, request.body);
      const result = await platformStore.upsertCommercialQuote({
        tenantId: tenantOf(request),
        ...body,
      });
      return reply.status(result.created ? 201 : 200).send(data(result, request));
    });

    app.get("/api/v1/commercial/quotes", async (request) => {
      requireRoles(request, "manager", "finance", "integration");
      const query = request.query as { opportunityId?: string };
      return data(
        await platformStore.listQuotes(
          tenantOf(request),
          query.opportunityId,
        ),
        request,
      );
    });

    app.post("/api/v1/commercial/quotes", async (request, reply) => {
      requireRoles(request, "admin", "manager");
      const body = parse(createCommercialQuoteSchema, request.body);
      return reply.status(201).send(
        data(
          await platformStore.createQuote({
            tenantId: tenantOf(request),
            opportunityId: body.opportunityId,
            currency: body.currency,
            amount: body.amount,
            issuedAt: body.issuedAt,
            supersedesQuoteId: body.supersedesQuoteId,
          }),
          request,
        ),
      );
    });

    app.post("/api/v1/commercial/quotes/:id/accept", async (request) => {
      requireRoles(request, "admin", "manager", "finance");
      return data(
        await platformStore.acceptQuote(tenantOf(request), idOf(request)),
        request,
      );
    });

    app.post("/api/v1/commercial/quotes/:id/void", async (request) => {
      requireRoles(request, "admin", "manager");
      return data(
        await platformStore.voidQuote(tenantOf(request), idOf(request)),
        request,
      );
    });

    app.post("/api/v1/commercial/import/contracts", async (request, reply) => {
      requireRoles(request, "admin", "integration");
      const body = parse(importCommercialContractSchema, request.body);
      const result = await platformStore.upsertCommercialContract({
        tenantId: tenantOf(request),
        ...body,
      });
      return reply.status(result.created ? 201 : 200).send(data(result, request));
    });

    app.get("/api/v1/commercial/contracts", async (request) => {
      requireRoles(request, "manager", "finance", "integration");
      const query = request.query as { accountId?: string };
      return data(
        await platformStore.listContracts(
          tenantOf(request),
          query.accountId,
        ),
        request,
      );
    });

    app.post("/api/v1/commercial/contracts", async (request, reply) => {
      requireRoles(request, "admin", "manager");
      const body = parse(createCommercialContractSchema, request.body);
      return reply.status(201).send(
        data(
          await platformStore.createContract({
            tenantId: tenantOf(request),
            accountId: body.accountId,
            opportunityId: body.opportunityId,
            quoteId: body.quoteId,
            contractRef: body.contractRef,
            currency: body.currency,
            amount: body.amount,
          }),
          request,
        ),
      );
    });

    app.post("/api/v1/commercial/contracts/:id/sign", async (request) => {
      requireRoles(request, "admin", "finance");
      return data(
        await platformStore.signContract(tenantOf(request), idOf(request)),
        request,
      );
    });

    app.post("/api/v1/commercial/contracts/:id/terminate", async (request) => {
      requireRoles(request, "admin", "finance");
      return data(
        await platformStore.terminateContract(tenantOf(request), idOf(request)),
        request,
      );
    });

    app.post("/api/v1/commercial/import/orders", async (request, reply) => {
      requireRoles(request, "admin", "integration");
      const body = parse(importCommercialOrderSchema, request.body);
      const result = await platformStore.upsertCommercialOrder({
        tenantId: tenantOf(request),
        ...body,
      });
      return reply.status(result.created ? 201 : 200).send(data(result, request));
    });

    app.get("/api/v1/commercial/orders", async (request) => {
      requireRoles(request, "manager", "finance", "integration");
      const query = request.query as { accountId?: string };
      return data(
        await platformStore.listOrders(tenantOf(request), query.accountId),
        request,
      );
    });

    app.post("/api/v1/commercial/orders", async (request, reply) => {
      requireRoles(request, "admin", "manager");
      const body = parse(createCommercialOrderSchema, request.body);
      return reply.status(201).send(
        data(
          await platformStore.createOrder({
            tenantId: tenantOf(request),
            accountId: body.accountId,
            contractId: body.contractId,
            orderNumber: body.orderNumber,
            currency: body.currency,
            lines: body.lines,
          }),
          request,
        ),
      );
    });

    app.post("/api/v1/commercial/orders/:id/cancel", async (request) => {
      requireRoles(request, "admin", "manager");
      return data(
        await platformStore.cancelOrder(tenantOf(request), idOf(request)),
        request,
      );
    });

    app.post("/api/v1/commercial/orders/:id/confirm", async (request) => {
      requireRoles(request, "admin", "manager", "finance");
      return data(
        await platformStore.confirmOrder(tenantOf(request), idOf(request)),
        request,
      );
    });
  };
}
