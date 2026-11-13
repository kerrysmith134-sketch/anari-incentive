/**
 * 入站 Webhook 域路由（外部身份/收件箱/来源 Webhook）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { parseCsv, verifyFeishuSignature, verifyHubSpotSignature, verifyWebhookSignature } from "@anari/connectors";
import { sha256 } from "@anari/policy-dsl";
import type { PlatformStore } from "../../platform-store.js";
import { ConflictError, NotFoundError } from "../../store.js";
import {
  processWebhookSchema,
  receiveWebhookSchema,
  upsertExternalIdentitySchema,
} from "@anari/contracts";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  paramOf,
} from "../../http-helpers.js";

export function registerWebhookRoutes(deps: {
  platformStore: PlatformStore;
  countEvent: (event: string) => void;
  webhookSecrets?: Record<string, string>;
  webhookSchemes?: Record<string, "hmac" | "hubspot" | "feishu">;
}): FastifyPluginAsync {
  const { platformStore, countEvent, webhookSecrets, webhookSchemes } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/external-identities", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(upsertExternalIdentitySchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.upsertExternalIdentity({
          tenantId: tenantOf(request),
          sourceSystem: body.sourceSystem,
          externalId: body.externalId,
          personId: body.personId,
          objectType: body.objectType,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/external-identities", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      sourceSystem?: string;
      objectType?: string;
    };
    return data(
      await platformStore.listExternalIdentities(tenantOf(request), {
        sourceSystem: query.sourceSystem,
        objectType: query.objectType,
      }),
      request,
    );
  });

  app.post("/api/v1/webhook-inbox", async (request, reply) => {
    requireRoles(request, "integration");
    const body = parse(receiveWebhookSchema, request.body);
    const webhook = await platformStore.receiveWebhook({
      tenantId: tenantOf(request),
      sourceSystem: body.sourceSystem,
      messageId: body.messageId,
      payloadHash: body.payloadHash,
    });
    countEvent("webhook_received");
    return reply.status(201).send(data(webhook, request));
  });

  app.get("/api/v1/webhook-inbox", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as {
      status?: string;
      sourceSystem?: string;
    };
    return data(
      await platformStore.listWebhooks(tenantOf(request), {
        status: query.status,
        sourceSystem: query.sourceSystem,
      }),
      request,
    );
  });

  app.post("/api/v1/webhook-inbox/:id/process", async (request) => {
    requireRoles(request, "integration");
    const body = parse(processWebhookSchema, request.body);
    const processed = await platformStore.processWebhook({
      tenantId: tenantOf(request),
      webhookId: idOf(request),
      status: body.status,
      errorCode: body.errorCode,
    });
    countEvent(
      body.status === "PROCESSED"
        ? "webhook_processed"
        : "webhook_failed",
    );
    return data(processed, request);
  });

  app.post("/api/v1/webhooks/:source", async (request, reply) => {
    requireRoles(request, "integration");
    const source = paramOf(request, "source");
    const secret = webhookSecrets?.[source];
    if (!secret) {
      throw new NotFoundError(`Webhook source ${source} is not configured`);
    }
    const raw =
      (request as FastifyRequest & { rawBody?: Buffer }).rawBody ??
      Buffer.alloc(0);
    const rawText = raw.toString("utf8");
    const scheme = webhookSchemes?.[source] ?? "hmac";
    let valid = false;
    if (scheme === "hubspot") {
      valid = verifyHubSpotSignature({
        clientSecret: secret,
        method: request.method,
        uri: request.url,
        body: rawText,
        signatureV3: request.headers["x-hubspot-signature-v3"] as
          | string
          | undefined,
        signatureV1: request.headers["x-hubspot-signature"] as
          | string
          | undefined,
        timestamp: request.headers["x-hubspot-request-timestamp"] as
          | string
          | undefined,
      });
    } else if (scheme === "feishu") {
      valid = verifyFeishuSignature({
        encryptKey: secret,
        timestamp: request.headers["x-lark-request-timestamp"] as
          | string
          | undefined,
        nonce: request.headers["x-lark-request-nonce"] as
          | string
          | undefined,
        body: rawText,
        signature: request.headers["x-lark-signature"] as
          | string
          | undefined,
      });
    } else {
      const timestamp = request.headers["x-timestamp"] as
        | string
        | undefined;
      valid = verifyWebhookSignature({
        secret,
        payload: raw,
        signature: request.headers["x-signature-256"] as
          | string
          | undefined,
        timestamp,
        toleranceSeconds: timestamp ? 300 : undefined,
      });
    }
    if (!valid) {
      throw new ConflictError("WEBHOOK_SIGNATURE_INVALID");
    }
    const payload = (request.body ?? {}) as { messageId?: string };
    const messageId =
      (request.headers["x-message-id"] as string | undefined) ??
      payload.messageId ??
      sha256(rawText);
    const webhook = await platformStore.receiveWebhook({
      tenantId: tenantOf(request),
      sourceSystem: source,
      messageId,
      payloadHash: sha256(rawText),
    });
    countEvent("webhook_received");
    return reply.status(202).send(data(webhook, request));
  });
  };
}
