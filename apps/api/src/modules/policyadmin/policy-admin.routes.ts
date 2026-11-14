/**
 * 制度治理域路由（版本/回滚/法务门禁/测试用例/咨询/仿真/通知/规则变更单）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { runPolicyTestCase } from "../../policy-test-runner.js";
import { assertPolicyApplicability, type PolicyRollbackResult } from "@anari/domain";
import { diffPolicyDefinitions, simulateMarginalChange, simulatePolicyChange } from "@anari/policy-dsl";
import type { PlatformStore } from "../../platform-store.js";
import type { IncentiveStore } from "../../store-interface.js";
import { ConflictError } from "../../store.js";
import {
  concludeConsultationSchema,
  createConsultationSchema,
  createPolicyNoticeSchema,
  createPolicyTestCaseSchema,
  createRuleChangeOrderSchema,
  marginalSimulationSchema,
  policySimulationSchema,
  publishPolicySchema,
  recordLegalGateSchema,
  reviewRuleChangeOrderSchema,
  rollbackPolicySchema,
} from "@anari/contracts";
import {
  data,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  requireActor,
  requireActorRequired,
} from "../../http-helpers.js";

export function registerPolicyAdminRoutes(deps: {
  platformStore: PlatformStore;
  storeFor: (request: FastifyRequest) => IncentiveStore;
  countEvent: (event: string) => void;
  ensureApproval: (
    request: FastifyRequest,
    actionType: string,
    approvalRequestId?: string,
  ) => Promise<void>;
  consumeApprovalForAction: (
    request: FastifyRequest,
    input: {
      approvalRequestId: string;
      actionType: string;
      targetType: string;
      targetId: string;
    },
  ) => Promise<void>;
  runPolicyTestSuiteFor: (
    request: FastifyRequest,
    policyVersionId: string,
  ) => Promise<unknown>;
  requirePolicyTestsBeforeApproval: (
    request: FastifyRequest,
    policyVersionId: string,
  ) => Promise<void>;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent, ensureApproval, consumeApprovalForAction, runPolicyTestSuiteFor, requirePolicyTestsBeforeApproval } = deps;
  return async (app: FastifyInstance) => {
  app.get("/api/v1/policy-versions", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(await storeFor(request).listPolicyVersions(), request);
  });

  app.get("/api/v1/policy-versions/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(await storeFor(request).getPolicy(idOf(request)), request);
  });

  app.get("/api/v1/policy-versions/:id/diff", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { against?: string };
    if (!query.against) {
      throw new ConflictError("DIFF_TARGET_REQUIRED: against query is required");
    }
    const store = storeFor(request);
    const base = await store.getPolicy(idOf(request));
    const target = await store.getPolicy(query.against);
    return data(
      {
        base: {
          policyVersionId: idOf(request),
          code: base.code,
          version: base.version,
        },
        target: {
          policyVersionId: query.against,
          code: target.code,
          version: target.version,
        },
        changes: diffPolicyDefinitions(base, target),
      },
      request,
    );
  });

  app.post("/api/v1/policy-versions", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(publishPolicySchema, request.body);
    await ensureApproval(request, "POLICY_PUBLISH", body.approvalRequestId);
    if (body.approvalRequestId) {
      if (!body.policyVersionId) {
        throw new ConflictError(
          "POLICY_VERSION_ID_REQUIRED: an approval needs a planned policy version id",
        );
      }
      await consumeApprovalForAction(request, {
        approvalRequestId: body.approvalRequestId,
        actionType: "POLICY_PUBLISH",
        targetType: "POLICY_VERSION",
        targetId: body.policyVersionId,
      });
    }
    const published = await storeFor(request).publishPolicy(body);
    countEvent("policy_published");
    return reply.status(201).send(data(published, request));
  });

  app.post("/api/v1/policy-versions/:id/rollback", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(rollbackPolicySchema, request.body);
    await ensureApproval(request, "POLICY_PUBLISH", body.approvalRequestId);
    const store = storeFor(request);
    const source = await store.getPolicyVersion(idOf(request));
    if (body.approvalRequestId) {
      if (!body.newPolicyVersionId) {
        throw new ConflictError(
          "POLICY_VERSION_ID_REQUIRED: an approval needs a planned policy version id",
        );
      }
      await consumeApprovalForAction(request, {
        approvalRequestId: body.approvalRequestId,
        actionType: "POLICY_PUBLISH",
        targetType: "POLICY_VERSION",
        targetId: body.newPolicyVersionId,
      });
    }
    const versions = await store.listPolicyVersions();
    const nextVersion =
      Math.max(
        0,
        ...versions
          .filter((version) => version.code === source.code)
          .map((version) => version.version),
      ) + 1;
    const applicability = source.applicability;
    assertPolicyApplicability(applicability);
    const published = await store.publishPolicy({
      policy: { ...source.policy, version: nextVersion },
      policyVersionId: body.newPolicyVersionId,
      effectiveFrom: body.effectiveFrom,
      approvedBy: requireActorRequired(request, body.approvedBy, "approve"),
      scope: source.scope,
      applicability,
    });
    countEvent("policy_published");
    const result: PolicyRollbackResult = {
      ...published,
      sourcePolicyVersionId: source.policyVersionId,
    };
    return reply.status(201).send(data(result, request));
  });

  app.post("/api/v1/policy-simulations", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(policySimulationSchema, request.body);
    const currentPolicy = await storeFor(request).getPolicy(body.currentPolicyVersionId);
    const tenantId =
      request.authContext?.tenantId ??
      (request.headers["x-tenant-id"] as string | undefined) ??
      "tenant-demo";
    const samples = body.samples.map((sample) => ({
      personId: sample.personId,
      input: { ...sample.input, tenantId },
    }));
    return data(
      simulatePolicyChange(currentPolicy, body.proposedPolicy, samples),
      request,
    );
  });

  app.post("/api/v1/policy-simulations:marginal", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(marginalSimulationSchema, request.body);
    const policy = await storeFor(request).getPolicy(body.policyVersionId);
    const tenantId =
      request.authContext?.tenantId ??
      (request.headers["x-tenant-id"] as string | undefined) ??
      "tenant-demo";
    return data(
      simulateMarginalChange(policy, { ...body.sample, tenantId }, {
        participantIndex: body.participantIndex,
        field: body.field,
        from: body.from,
        to: body.to,
        step: body.step,
      }),
      request,
    );
  });
  app.post("/api/v1/policy-versions/:id/legal-gate", async (request) => {
    requireRoles(request, "admin");
    const body = parse(recordLegalGateSchema, request.body);
    const policyVersionId = idOf(request);
    const tenantId = tenantOf(request);
    await ensureApproval(request, "LEGAL_GATE", body.approvalRequestId);
    if (body.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: body.approvalRequestId,
        actionType: "LEGAL_GATE",
        targetType: "POLICY_VERSION",
        targetId: policyVersionId,
      });
    }
    let democraticProcedureRef = body.democraticProcedureRef;
    if (body.democraticProcedureId) {
      const consultation = await platformStore.getConsultation(
        tenantId,
        body.democraticProcedureId,
      );
      if (consultation.policyVersionId !== policyVersionId) {
        throw new ConflictError(
          `CONSULTATION_POLICY_MISMATCH: consultation ${consultation.id} belongs to policy ${consultation.policyVersionId}`,
        );
      }
      if (!consultation.endedAt || consultation.outcome === "PENDING") {
        throw new ConflictError(
          `CONSULTATION_NOT_CONCLUDED: consultation ${consultation.id} has no concluded outcome`,
        );
      }
      democraticProcedureRef = democraticProcedureRef ?? consultation.id;
    }
    let employeeNoticeRef = body.employeeNoticeRef;
    if (body.employeeNoticeId) {
      const notice = await platformStore.getNotice(
        tenantId,
        body.employeeNoticeId,
      );
      if (notice.policyVersionId && notice.policyVersionId !== policyVersionId) {
        throw new ConflictError(
          `NOTICE_POLICY_MISMATCH: notice ${notice.id} belongs to policy ${notice.policyVersionId}`,
        );
      }
      const coverage = await platformStore.listAcknowledgements(
        tenantId,
        notice.id,
      );
      if (notice.acknowledgementRequired && !coverage.summary.complete) {
        throw new ConflictError(
          `NOTICE_ACKNOWLEDGEMENTS_INCOMPLETE: ${coverage.summary.acknowledgedCount}/${coverage.summary.personCount} acknowledged, ${coverage.summary.declinedCount} declined`,
        );
      }
      employeeNoticeRef = employeeNoticeRef ?? notice.id;
    }
    let dataProtectionAssessmentRef = body.dataProtectionAssessmentRef;
    if (body.dataProtectionAssessmentId) {
      const dpia = await platformStore.getDpia(
        tenantId,
        body.dataProtectionAssessmentId,
      );
      if (dpia.status !== "APPROVED") {
        throw new ConflictError(
          `DPIA_NOT_APPROVED: DPIA ${dpia.id} is ${dpia.status}`,
        );
      }
      dataProtectionAssessmentRef =
        dataProtectionAssessmentRef ?? dpia.id;
    }
    const gate = await storeFor(request).recordLegalGate({
      policyVersionId,
      democraticProcedureRef,
      employeeNoticeRef,
      dataProtectionAssessmentRef,
      minimumWageChecked: body.minimumWageChecked,
      policyApproved: body.policyApproved,
      recordedBy: requireActorRequired(request, body.recordedBy, "record"),
    });
    countEvent("legal_gate_recorded");
    return data(gate, request);
  });
  app.post("/api/v1/policy-consultations", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createConsultationSchema, request.body);
    await storeFor(request).getPolicy(body.policyVersionId);
    return reply.status(201).send(
      data(
        await platformStore.createConsultation({
          tenantId: tenantOf(request),
          policyVersionId: body.policyVersionId,
          representationId: body.representationId,
          consultationType: body.consultationType,
          startedAt: body.startedAt,
          endedAt: body.endedAt,
          minutesRef: body.minutesRef,
          feedbackSummary: body.feedbackSummary,
          outcome: body.outcome ?? "PENDING",
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/policy-consultations", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { policyVersionId?: string };
    return data(
      await platformStore.listConsultations(
        tenantOf(request),
        query.policyVersionId,
      ),
      request,
    );
  });

  app.get("/api/v1/policy-consultations/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getConsultation(tenantOf(request), idOf(request)),
      request,
    );
  });

  app.post("/api/v1/policy-consultations/:id/conclude", async (request) => {
    requireRoles(request, "admin");
    const body = parse(concludeConsultationSchema, request.body);
    return data(
      await platformStore.concludeConsultation({
        tenantId: tenantOf(request),
        consultationId: idOf(request),
        endedAt: body.endedAt,
        outcome: body.outcome,
        minutesRef: body.minutesRef,
        feedbackSummary: body.feedbackSummary,
      }),
      request,
    );
  });
  app.post("/api/v1/rule-change-orders", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createRuleChangeOrderSchema, request.body);
    const store = storeFor(request);
    await store.getPolicy(body.toPolicyVersionId);
    if (body.fromPolicyVersionId) {
      await store.getPolicy(body.fromPolicyVersionId);
    }
    return reply.status(201).send(
      data(
        await platformStore.createRuleChangeOrder({
          tenantId: tenantOf(request),
          policyCode: body.policyCode,
          fromPolicyVersionId: body.fromPolicyVersionId,
          toPolicyVersionId: body.toPolicyVersionId,
          changeType: body.changeType,
          reason: body.reason,
          impactSimulation: body.impactSimulation ?? {},
          effectiveFrom: body.effectiveFrom,
          requestedBy: requireActorRequired(request, body.requestedBy, "request"),
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/rule-change-orders", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { policyCode?: string; status?: string };
    return data(
      await platformStore.listRuleChangeOrders(tenantOf(request), {
        policyCode: query.policyCode,
        status: query.status as
          | "DRAFT"
          | "APPROVED"
          | "PUBLICIZED"
          | "REJECTED"
          | undefined,
      }),
      request,
    );
  });

  app.get("/api/v1/rule-change-orders/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await platformStore.getRuleChangeOrder(
        tenantOf(request),
        idOf(request),
      ),
      request,
    );
  });

  app.post("/api/v1/rule-change-orders/:id/approve", async (request) => {
    requireRoles(request, "admin");
    const body = parse(reviewRuleChangeOrderSchema, request.body);
    const order = await platformStore.getRuleChangeOrder(
      tenantOf(request),
      idOf(request),
    );
    if (order.status === "DRAFT") {
      await requirePolicyTestsBeforeApproval(
        request,
        order.toPolicyVersionId,
      );
    }
    return data(
      await platformStore.approveRuleChangeOrder({
        tenantId: tenantOf(request),
        orderId: idOf(request),
        approvedBy: requireActorRequired(request, body.approvedBy, "approve"),
      }),
      request,
    );
  });

  app.post("/api/v1/rule-change-orders/:id/reject", async (request) => {
    requireRoles(request, "admin");
    const body = parse(reviewRuleChangeOrderSchema, request.body);
    return data(
      await platformStore.rejectRuleChangeOrder({
        tenantId: tenantOf(request),
        orderId: idOf(request),
        approvedBy: requireActorRequired(request, body.approvedBy, "approve"),
      }),
      request,
    );
  });

  app.post("/api/v1/rule-change-orders/:id/publicize", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.publicizeRuleChangeOrder({
        tenantId: tenantOf(request),
        orderId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/policy-test-cases", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createPolicyTestCaseSchema, request.body);
    await storeFor(request).getPolicy(body.policyVersionId);
    return reply.status(201).send(
      data(
        await platformStore.createPolicyTestCase({
          tenantId: tenantOf(request),
          policyVersionId: body.policyVersionId,
          caseCode: body.caseCode,
          input: body.input,
          expectedOutput: body.expectedOutput,
          category: body.category,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/policy-test-cases", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { policyVersionId?: string };
    return data(
      await platformStore.listPolicyTestCases(
        tenantOf(request),
        query.policyVersionId,
      ),
      request,
    );
  });

  app.post("/api/v1/policy-test-cases/:id/retire", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.retirePolicyTestCase({
        tenantId: tenantOf(request),
        testCaseId: idOf(request),
      }),
      request,
    );
  });

  app.post("/api/v1/policy-test-cases/:id/run", async (request) => {
    requireRoles(request, "manager", "finance");
    const testCase = await platformStore.getPolicyTestCase(
      tenantOf(request),
      idOf(request),
    );
    const policy = await storeFor(request).getPolicy(
      testCase.policyVersionId,
    );
    const result = runPolicyTestCase(testCase, policy);
    await platformStore.recordPolicyTestCaseRun({
      tenantId: tenantOf(request),
      testCaseId: testCase.id,
      passed: result.passed,
      resultHash: result.resultHash,
    });
    countEvent("policy_test_case_run");
    if (!result.passed) countEvent("policy_test_case_failed");
    return data(result, request);
  });

  app.post("/api/v1/policy-versions/:id/test-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await runPolicyTestSuiteFor(request, idOf(request)),
      request,
    );
  });

  app.get("/api/v1/policy-versions/:id/test-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    const policyVersionId = idOf(request);
    await storeFor(request).getPolicyVersion(policyVersionId);
    return data(
      await platformStore.listPolicyTestRuns(
        tenantOf(request),
        policyVersionId,
      ),
      request,
    );
  });

  app.post("/api/v1/policy-notices", async (request, reply) => {
    requireRoles(request, "admin");
    const body = parse(createPolicyNoticeSchema, request.body);
    await storeFor(request).getPolicy(body.policyVersionId);
    await platformStore.getNotice(tenantOf(request), body.noticeId);
    return reply.status(201).send(
      data(
        await platformStore.createPolicyNotice({
          tenantId: tenantOf(request),
          policyVersionId: body.policyVersionId,
          noticeId: body.noticeId,
          audience: body.audience ?? {},
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/policy-notices", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { policyVersionId?: string };
    return data(
      await platformStore.listPolicyNotices(
        tenantOf(request),
        query.policyVersionId,
      ),
      request,
    );
  });
  app.get("/api/v1/policy-versions/:id/legal-gate", async (request) => {
    requireRoles(request, "manager", "finance");
    const gate = await storeFor(request).getLegalGate(idOf(request));
    if (!gate) {
      return data({ status: "MISSING", policyVersionId: idOf(request) }, request);
    }
    return data({ status: "RECORDED", gate }, request);
  });
  };
}
