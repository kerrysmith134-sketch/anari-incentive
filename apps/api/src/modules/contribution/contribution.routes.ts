/**
 * 贡献申报与佐证域路由（NPV2-011 第三片）：
 * 贡献申报生命周期、佐证（attestation）登记/撤回。
 * 行为与拆分前等价。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { DirectoryPort } from "../../store-ports.js";
import type { IncentiveStore } from "../../store-interface.js";
import {
  createContributionAttestationSchema,
  createContributionClaimSchema,
  withdrawContributionAttestationSchema,
} from "@anari/contracts";
import { ConflictError, NotFoundError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  data,
  idOf,
  isPrivileged,
  ownPersonId,
  parse,
  personFilter,
  requireRoles,
  tenantOf,
} from "../../http-helpers.js";

export function registerContributionRoutes(deps: {
  platformStore: DirectoryPort;
  storeFor: (request: FastifyRequest) => IncentiveStore;
}): FastifyPluginAsync {
  const { platformStore, storeFor } = deps;
  return async (app: FastifyInstance) => {
    app.post("/api/v1/contribution-claims", async (request, reply) => {
      const body = parse(createContributionClaimSchema, request.body);
      const person = personFilter(request);
      if (person && body.claimantPersonId !== person) {
        throw new ForbiddenError("cannot file a claim for another person");
      }
      return reply.status(201).send(data(await storeFor(request).createClaim(body), request));
    });

    app.get("/api/v1/contribution-claims", async (request) => {
      const claims = await storeFor(request).listClaims();
      const person = personFilter(request);
      return data(
        person
          ? claims.filter((claim) => claim.claimantPersonId === person)
          : claims,
        request,
      );
    });

    app.get("/api/v1/contribution-claims/:id", async (request) => {
      const claim = await storeFor(request).getClaim(idOf(request));
      const person = personFilter(request);
      if (person && claim.claimantPersonId !== person) {
        throw new ForbiddenError("contribution claim is not visible to this person");
      }
      return data(claim, request);
    });

    app.post("/api/v1/contribution-claims/:id/submit", async (request) => {
      const store = storeFor(request);
      const claim = await store.getClaim(idOf(request));
      const person = personFilter(request);
      if (person && claim.claimantPersonId !== person) {
        throw new ForbiddenError("cannot submit another person's claim");
      }
      return data(await store.submitClaim(idOf(request)), request);
    });

    app.post("/api/v1/contribution-attestations", async (request, reply) => {
      const body = parse(createContributionAttestationSchema, request.body);
      const persons = await platformStore.listPersons(tenantOf(request));
      const subject = persons.find(
        (person) => person.id === body.subjectPersonId,
      );
      const attester = persons.find(
        (person) => person.id === body.attesterPersonId,
      );
      if (!subject) throw new NotFoundError(
        `Person ${body.subjectPersonId} not found`,
      );
      if (!attester) throw new NotFoundError(
        `Person ${body.attesterPersonId} not found`,
      );
      if (body.attestationType === "MANAGER") {
        if (subject.managerPersonId !== body.attesterPersonId) {
          throw new ConflictError(
            "ATTESTATION_MANAGER_RELATIONSHIP_REQUIRED: attester is not the subject's manager",
          );
        }
      }
      const own = ownPersonId(request);
      if (
        own &&
        body.attesterPersonId !== own &&
        !isPrivileged(request)
      ) {
        throw new ForbiddenError("cannot attest on behalf of another person");
      }
      return reply.status(201).send(
        data(
          await storeFor(request).createContributionAttestation({
            ...body,
            evidenceRefs: body.evidenceRefs ?? [],
          }),
          request,
        ),
      );
    });

    app.get("/api/v1/contribution-attestations", async (request) => {
      const query = request.query as {
        workPackageId?: string;
        subjectPersonId?: string;
      };
      const person = personFilter(request);
      const attestations = await storeFor(
        request,
      ).listContributionAttestations({
        workPackageId: query.workPackageId,
        subjectPersonId: query.subjectPersonId,
      });
      return data(
        person
          ? attestations.filter(
              (attestation) =>
                attestation.subjectPersonId === person ||
                attestation.attesterPersonId === person,
            )
          : attestations,
        request,
      );
    });

    app.post("/api/v1/contribution-attestations/:id/withdraw", async (request) => {
        const body = parse(withdrawContributionAttestationSchema, request.body);
        const own = ownPersonId(request);
        // 显式指定操作人优先；员工冒名由上方守卫阻断。
        const requester = body.personId ?? own;
        if (!requester) {
          throw new ForbiddenError(
            "attester identity is required to withdraw an attestation",
          );
        }
        if (own && body.personId && body.personId !== own && !isPrivileged(request)) {
          throw new ForbiddenError("cannot withdraw for another person");
        }
        return data(
          await storeFor(request).withdrawContributionAttestation(
            idOf(request),
            requester,
          ),
          request,
        );
    });

  };
}
