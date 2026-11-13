/**
 * 电子签署域路由（签署信封/供应商回调）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { verifyWebhookSignature } from "@anari/connectors";
import { sha256 } from "@anari/policy-dsl";
import type { IntegrationPort } from "../../store-ports.js";
import { ConflictError, NotFoundError } from "../../store.js";
import {
  createESignEnvelopeSchema,
  esignCallbackSchema,
} from "@anari/contracts";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  paramOf,
} from "../../http-helpers.js";

export function registerEsignRoutes(deps: {
  platformStore: IntegrationPort;
  countEvent: (event: string) => void;
  esignWebhookSecrets?: Record<string, string>;
}): FastifyPluginAsync {
  const { platformStore, countEvent, esignWebhookSecrets } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/esign-envelopes", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createESignEnvelopeSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createESignEnvelope({
          tenantId: tenantOf(request),
          contractId: body.contractId,
          provider: body.provider,
          envelopeRef: body.envelopeRef,
          documentHash: body.documentHash,
          signerPersonId: body.signerPersonId,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/esign-envelopes", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { contractId?: string };
    return data(
      await platformStore.listESignEnvelopes(
        tenantOf(request),
        query.contractId,
      ),
      request,
    );
  });

  app.post("/api/v1/esign/webhooks/:provider", async (request) => {
    requireRoles(request, "integration");
    const provider = paramOf(request, "provider");
    const secret = esignWebhookSecrets?.[provider];
    if (!secret) {
      throw new NotFoundError(
        `E-sign provider ${provider} is not configured`,
      );
    }
    const raw =
      (request as FastifyRequest & { rawBody?: Buffer }).rawBody ??
      Buffer.alloc(0);
    const timestamp = request.headers["x-timestamp"] as string | undefined;
    const valid = verifyWebhookSignature({
      secret,
      payload: raw,
      signature: request.headers["x-signature-256"] as
        | string
        | undefined,
      timestamp,
      toleranceSeconds: timestamp ? 300 : undefined,
    });
    if (!valid) {
      throw new ConflictError("ESIGN_WEBHOOK_SIGNATURE_INVALID");
    }
    const body = parse(esignCallbackSchema, request.body);
    const envelope = await platformStore.completeESignEnvelope({
      tenantId: tenantOf(request),
      provider,
      envelopeRef: body.envelopeRef,
      status: body.status,
      signatureRef: body.signatureRef,
      reason: body.reason,
    });
    countEvent(
      body.status === "SIGNED"
        ? "esign_envelope_signed"
        : "esign_envelope_closed",
    );
    return data(envelope, request);
  });
  };
}
