/**
 * 薪酬发放域路由（个税/工资单生命周期/银行文件/工资条/法定扣款配置）（NPV2-011）：从 app.ts 拆出的域路由模块。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PayrollRun } from "@anari/domain";
import { calculatePayroll, payrollCsv, payrollBankFileCsv, payrollTaxFilingCsv, payrollPayslipHtml } from "../../payroll.js";
import { calculateCumulativeIit } from "@anari/payroll-tax";
import { formatDecimal, parseDecimal } from "@anari/policy-dsl";
import type { PlatformStore } from "../../platform-store.js";
import type { IncentiveStore } from "../../store-interface.js";
import { ConflictError, NotFoundError } from "../../store.js";
import { ForbiddenError } from "@anari/auth";
import {
  approvePayrollRunSchema,
  calculateCnIitSchema,
  createPayrollRunSchema,
  reversePayrollRunSchema,
} from "@anari/contracts";
import {
  data,
  errorBody,
  parse,
  requireRoles,
  tenantOf,
  idOf,
  paramOf,
  ownPersonId,
  isPlatformAdmin,
  policyBody,
  requireActor,
  requireActorRequired,
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


export function registerPayrollRunRoutes(deps: {
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
  payrollRunForViewer: (request: FastifyRequest, run: PayrollRun) => Promise<PayrollRun>;
  assertPayrollExportable: (run: PayrollRun) => void;
}): FastifyPluginAsync {
  const { platformStore, storeFor, countEvent, ensureApproval, consumeApprovalForAction, assertExportAllowed, assertExportDlp, auditExport, exportHeaders, payrollRunForViewer, assertPayrollExportable } = deps;
  return async (app: FastifyInstance) => {
  app.post("/api/v1/tax/cn-iit/calculate", async (request) => {
    requireRoles(request, "manager", "finance");
    const body = parse(calculateCnIitSchema, request.body);
    return data(calculateCumulativeIit(body), request);
  });

  app.post("/api/v1/payroll-runs", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const body = parse(createPayrollRunSchema, request.body);
    return reply.status(201).send(
      data(
        await platformStore.createPayrollRun({
          tenantId: tenantOf(request),
          cycleId: body.cycleId,
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
          currency: body.currency,
          preparedBy: body.preparedBy,
        }),
        request,
      ),
    );
  });

  app.get("/api/v1/payroll-runs", async (request) => {
    requireRoles(request, "manager", "finance");
    const query = request.query as { cycleId?: string };
    const runs = await platformStore.listPayrollRuns(
      tenantOf(request),
      query.cycleId,
    );
    return data(
      await Promise.all(
        runs.map((run) => payrollRunForViewer(request, run)),
      ),
      request,
    );
  });

  app.get("/api/v1/payroll-runs/:id", async (request) => {
    requireRoles(request, "manager", "finance");
    return data(
      await payrollRunForViewer(
        request,
        await platformStore.getPayrollRun(
          tenantOf(request),
          idOf(request),
        ),
      ),
      request,
    );
  });

  app.get("/api/v1/payroll-runs/:id/export", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    assertExportAllowed(request);
    const query = request.query as {
      approvalRequestId?: string;
      dlpApprovalRequestId?: string;
    };
    await ensureApproval(
      request,
      "PAYROLL_EXPORT",
      query.approvalRequestId,
    );
    if (query.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: query.approvalRequestId,
        actionType: "PAYROLL_EXPORT",
        targetType: "PAYROLL_RUN",
        targetId: idOf(request),
      });
    }
    const run = await payrollRunForViewer(
      request,
      await platformStore.getPayrollRun(
        tenantOf(request),
        idOf(request),
      ),
    );
    assertPayrollExportable(run);
    const csv = payrollCsv(run);
    await assertExportDlp(
      request,
      csv,
      "PAYROLL_RUN",
      run.id,
      query.dlpApprovalRequestId,
    );
    await auditExport(
      request,
      "PAYROLL_RUN_EXPORTED",
      "PAYROLL_RUN",
      run.id,
      `rows=${run.lineCount ?? ""}`,
    );
    return reply
      .type("text/csv; charset=utf-8")
      .headers(exportHeaders(request, csv, "CONFIDENTIAL"))
      .header(
        "content-disposition",
        `attachment; filename="payroll-${run.id}.csv"`,
      )
      .send(csv);
  });

  app.get("/api/v1/payroll-runs/:id/bank-file", async (request, reply) => {
    requireRoles(request, "finance");
    assertExportAllowed(request);
    const query = request.query as {
      approvalRequestId?: string;
      dlpApprovalRequestId?: string;
    };
    await ensureApproval(
      request,
      "PAYROLL_BANK_FILE",
      query.approvalRequestId,
    );
    if (query.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: query.approvalRequestId,
        actionType: "PAYROLL_BANK_FILE",
        targetType: "PAYROLL_RUN",
        targetId: idOf(request),
      });
    }
    const run = await platformStore.getPayrollRun(
      tenantOf(request),
      idOf(request),
    );
    assertPayrollExportable(run);
    const format = (
      (request.query as { format?: string }).format ?? "GENERIC"
    ).toUpperCase();
    if (!["GENERIC", "ICBC", "CMB"].includes(format)) {
      return reply.status(400).send({
        ...errorBody(
          "VALIDATION_ERROR",
          "format must be one of GENERIC, ICBC, CMB",
        ),
        meta: { correlation_id: request.id },
      });
    }
    const csv = payrollBankFileCsv(
      run,
      format as "GENERIC" | "ICBC" | "CMB",
    );
    await assertExportDlp(
      request,
      csv,
      "PAYROLL_RUN",
      run.id,
      query.dlpApprovalRequestId,
    );
    await auditExport(
      request,
      "PAYROLL_BANK_FILE_EXPORTED",
      "PAYROLL_RUN",
      run.id,
      `format=${format}`,
    );
    return reply
      .type("text/csv; charset=utf-8")
      .headers(exportHeaders(request, csv, "RESTRICTED"))
      .header(
        "content-disposition",
        `attachment; filename="payroll-bank-${run.id}-${format.toLowerCase()}.csv"`,
      )
      .send(csv);
  });

  app.get("/api/v1/payroll-runs/:id/tax-filing", async (request, reply) => {
    requireRoles(request, "finance");
    assertExportAllowed(request);
    const query = request.query as {
      approvalRequestId?: string;
      dlpApprovalRequestId?: string;
    };
    await ensureApproval(
      request,
      "PAYROLL_TAX_FILING",
      query.approvalRequestId,
    );
    if (query.approvalRequestId) {
      await consumeApprovalForAction(request, {
        approvalRequestId: query.approvalRequestId,
        actionType: "PAYROLL_TAX_FILING",
        targetType: "PAYROLL_RUN",
        targetId: idOf(request),
      });
    }
    const run = await platformStore.getPayrollRun(
      tenantOf(request),
      idOf(request),
    );
    assertPayrollExportable(run);
    const csv = payrollTaxFilingCsv(run);
    await assertExportDlp(
      request,
      csv,
      "PAYROLL_RUN",
      run.id,
      query.dlpApprovalRequestId,
    );
    countEvent("payroll_tax_filing_exported");
    await auditExport(
      request,
      "PAYROLL_TAX_FILING_EXPORTED",
      "PAYROLL_RUN",
      run.id,
    );
    return reply
      .type("text/csv; charset=utf-8")
      .headers(exportHeaders(request, csv, "RESTRICTED"))
      .header(
        "content-disposition",
        `attachment; filename="payroll-tax-filing-${run.id}.csv"`,
      )
      .send(csv);
  });

  app.get("/api/v1/payroll-runs/:id/payslips/:personId", async (request, reply) => {
    requireRoles(request, "manager", "finance");
    const targetPersonId = paramOf(request, "personId");
    const own = ownPersonId(request);
    const roles = request.authContext?.roles ?? [];
    if (
      !roles.includes("admin") &&
      !roles.includes("finance") &&
      own !== targetPersonId
    ) {
      // Managers may print payslips for their direct reports only.
      const persons = await platformStore.listPersons(tenantOf(request));
      const target = persons.find((person) => person.id === targetPersonId);
      if (!target || !own || target.managerPersonId !== own) {
        throw new ForbiddenError(
          "managers may only view payslips of their direct reports",
        );
      }
    }
    const stored = await platformStore.getPayrollRun(
      tenantOf(request),
      idOf(request),
    );
    // Same field-policy redaction as the JSON payroll routes: a printable
    // payslip must not expose bank details the viewer cannot see elsewhere.
    const run = await payrollRunForViewer(request, stored);
    const line = (run.lines ?? []).find(
      (candidate) => candidate.personId === targetPersonId,
    );
    if (!line) {
      throw new NotFoundError(`PayrollLine ${targetPersonId} not found`);
    }
    return reply.type("text/html; charset=utf-8").send(
      payrollPayslipHtml(run, line),
    );
  });

  app.post("/api/v1/payroll-runs/:id/calculate", async (request) => {
    requireRoles(request, "manager", "finance");
    const tenantId = tenantOf(request);
    const run = await platformStore.getPayrollRun(
      tenantId,
      idOf(request),
    );
    await platformStore.applyDueContractAmendments(tenantId);
    const contracts = await platformStore.listEmploymentContracts(
      tenantId,
    );
    // One person must not be paid twice for the same period. Overlapping
    // ACTIVE contracts would each collect the same ledger entries.
    const periodStart = Date.parse(run.periodStart);
    const periodEnd = Date.parse(run.periodEnd);
    const activeByPerson = new Map<string, string>();
    for (const contract of contracts) {
      if (contract.status !== "ACTIVE") continue;
      if (contract.currency !== run.currency) continue;
      if (Date.parse(contract.startDate) > periodEnd) continue;
      if (contract.endDate && Date.parse(contract.endDate) < periodStart) {
        continue;
      }
      const key = `${contract.personId}:${contract.currency}`;
      const existing = activeByPerson.get(key);
      if (existing) {
        throw new ConflictError(
          `PAYROLL_DUPLICATE_ACTIVE_CONTRACT: person ${contract.personId} has contracts ${existing} and ${contract.id} covering this period`,
        );
      }
      activeByPerson.set(key, contract.id);
    }
    const allRuns = await platformStore.listPayrollRuns(tenantId);
    const priorRuns = allRuns
      .filter(
        (candidate) =>
          candidate.id !== run.id &&
          Date.parse(candidate.periodEnd) < Date.parse(run.periodStart) &&
          ["CALCULATED", "APPROVED", "PAID"].includes(candidate.status),
      )
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
      .slice(0, 12);
    // Oldest first so the last value per contract is the most recent period.
    const priorIncentiveHistory: Record<string, string[]> = {};
    for (const prior of [...priorRuns].reverse()) {
      const detail = await platformStore.getPayrollRun(tenantId, prior.id);
      for (const line of detail.lines ?? []) {
        (priorIncentiveHistory[line.contractId] ??= []).push(
          line.incentiveAmount,
        );
      }
    }
    const priorIncentives: Record<string, string> = {};
    for (const [contractId, values] of Object.entries(priorIncentiveHistory)) {
      const latest = values[values.length - 1];
      if (latest !== undefined) priorIncentives[contractId] = latest;
    }
    const ledger = await storeFor(request).listLedger();
    const unacknowledgedNoticesByPerson: Record<string, string[]> = {};
    let cycle: Awaited<
      ReturnType<ReturnType<typeof storeFor>["getEvaluationCycle"]>
    > | undefined;
    try {
      cycle = await storeFor(request).getEvaluationCycle(run.cycleId);
    } catch {
      cycle = undefined;
    }
    if (cycle?.policyVersionId) {
      const links = await platformStore.listPolicyNotices(
        tenantId,
        cycle.policyVersionId,
      );
      if (links.length > 0) {
        const notices = await platformStore.listNotices(tenantId);
        const noticeById = new Map(
          notices.map((notice) => [notice.id, notice]),
        );
        for (const link of links) {
          const notice = noticeById.get(link.noticeId);
          if (!notice?.acknowledgementRequired) continue;
          const coverage = await platformStore.listAcknowledgements(
            tenantId,
            notice.id,
          );
          const acknowledged = new Set(
            coverage.acknowledgements
              .filter((acknowledgement) =>
                Boolean(acknowledgement.acknowledgedAt),
              )
              .map((acknowledgement) => acknowledgement.personId),
          );
          for (const contract of contracts) {
            if (!acknowledged.has(contract.personId)) {
              const missing =
                unacknowledgedNoticesByPerson[contract.personId] ?? [];
              missing.push(notice.id);
              unacknowledgedNoticesByPerson[contract.personId] = missing;
            }
          }
        }
      }
    }
    const tenantSettings =
      (await platformStore.getTenant(tenantId)).settings ?? {};
    const taxMode =
      tenantSettings.payrollTaxMode === "STATUTORY_CN"
        ? ("STATUTORY_CN" as const)
        : ("DECLARED" as const);
    const priorYtd: Record<
      string,
      { taxableIncome: string; taxWithheld: string }
    > = {};
    if (taxMode === "STATUTORY_CN") {
      // Year-to-date totals from PAID runs in the same calendar year as this
      // run's period start (cumulative withholding method).
      const year = run.periodStart.slice(0, 4);
      const paidRuns = allRuns.filter(
        (candidate) =>
          candidate.id !== run.id &&
          candidate.status === "PAID" &&
          candidate.periodStart.slice(0, 4) === year,
      );
      for (const paidRun of paidRuns) {
        const detail = await platformStore.getPayrollRun(
          tenantId,
          paidRun.id,
        );
        for (const line of detail.lines ?? []) {
          const social = parseDecimal(line.socialInsuranceAmount);
          const gross = parseDecimal(line.grossAmount);
          const taxable = gross - social - 5_000_000n;
          const entry = priorYtd[line.personId] ?? {
            taxableIncome: "0",
            taxWithheld: "0",
          };
          priorYtd[line.personId] = {
            taxableIncome: formatDecimal(
              parseDecimal(entry.taxableIncome) +
                (taxable > 0n ? taxable : 0n),
            ),
            taxWithheld: formatDecimal(
              parseDecimal(entry.taxWithheld) + parseDecimal(line.taxAmount),
            ),
          };
        }
      }
    }
    const statutoryDeductionTypes = Array.isArray(
      tenantSettings.statutoryDeductionTypes,
    )
      ? (tenantSettings.statutoryDeductionTypes as {
          type: string;
          priority: number;
          requiresCourtOrder?: boolean;
          requiresConsent?: boolean;
          capRate?: string;
        }[])
      : undefined;
    const deductionLegalBases =
      tenantSettings.deductionLegalBases &&
      typeof tenantSettings.deductionLegalBases === "object"
        ? (tenantSettings.deductionLegalBases as Record<
            string,
            { courtOrderRef?: string; consentRef?: string }
          >)
        : undefined;
    const calculation = calculatePayroll({
      contracts,
      ledger,
      priorIncentives,
      priorIncentiveHistory,
      unacknowledgedNoticesByPerson,
      taxMode,
      statutoryDeductionTypes,
      deductionLegalBases,
      priorYtd: taxMode === "STATUTORY_CN" ? priorYtd : undefined,
      cycleId: run.cycleId,
      currency: run.currency,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
    });
    const saved = await platformStore.savePayrollCalculation({
      tenantId,
      runId: run.id,
      lines: calculation.lines,
      totalGross: calculation.totalGross,
      totalDeductions: calculation.totalDeductions,
      totalTax: calculation.totalTax,
      totalSocialInsurance: calculation.totalSocialInsurance,
      totalNet: calculation.totalNet,
      blockedCount: calculation.blockedCount,
    });
    countEvent("payroll_run_calculated");
    if (saved.blockedCount > 0) countEvent("payroll_run_blocked");
    return data(saved, request);
  });

  app.post("/api/v1/payroll-runs/:id/approve", async (request) => {
    requireRoles(request, "admin", "finance");
    const body = parse(approvePayrollRunSchema, request.body);
    // NPV2-003：审批人必须是会话主体；body 中的 approvedBy 不再是执行者真相源。
    const own = ownPersonId(request);
    if (own && !isPlatformAdmin(request) && requireActor(request, body.approvedBy, "approve") !== own) {
      throw new ForbiddenError(
        "payroll approval must use the authenticated identity",
      );
    }
    const persons = await platformStore.listPersons(tenantOf(request));
    if (!persons.some((person) => person.id === requireActor(request, body.approvedBy, "approve"))) {
      throw new NotFoundError(`Person ${requireActor(request, body.approvedBy, "approve")} not found`);
    }
    const run = await platformStore.approvePayrollRun({
      tenantId: tenantOf(request),
      runId: idOf(request),
      approvedBy: requireActorRequired(request, body.approvedBy, "approve"),
    });
    countEvent("payroll_run_approved");
    return data(run, request);
  });

  app.post("/api/v1/payroll-runs/:id/pay", async (request) => {
    requireRoles(request, "finance");
    const run = await platformStore.payPayrollRun({
      tenantId: tenantOf(request),
      runId: idOf(request),
    });
    countEvent("payroll_run_paid");
    return data(run, request);
  });

  app.post("/api/v1/payroll-runs/:id/reverse", async (request) => {
    requireRoles(request, "finance", "admin");
    const body = parse(reversePayrollRunSchema, request.body);
    const run = await platformStore.reversePayrollRun({
      tenantId: tenantOf(request),
      runId: idOf(request),
      reason: body.reason,
      reversedBy: body.reversedBy,
    });
    countEvent("payroll_run_reversed");
    return data(run, request);
  });

  app.post("/api/v1/payroll-runs/:id/cancel", async (request) => {
    requireRoles(request, "admin");
    return data(
      await platformStore.cancelPayrollRun({
        tenantId: tenantOf(request),
        runId: idOf(request),
      }),
      request,
    );
  });
  app.get("/api/v1/statutory-deduction-types", async (request) => {
    requireRoles(request, "finance", "admin");
    const tenant = await platformStore.getTenant(tenantOf(request));
    const types = Array.isArray(tenant.settings?.statutoryDeductionTypes)
      ? tenant.settings.statutoryDeductionTypes
      : [];
    return data(types, request);
  });

  app.put("/api/v1/statutory-deduction-types", async (request) => {
    requireRoles(request, "finance", "admin");
    const body = policyBody(request);
    if (!Array.isArray(body.types)) {
      throw new BadRequestError("INVALID_INPUT", "types 必须为数组");
    }
    for (const rule of body.types as Array<Record<string, unknown>>) {
      if (typeof rule.type !== "string" || !rule.type.trim()) {
        throw new BadRequestError("INVALID_INPUT", "扣款类型必须非空");
      }
      if (
        typeof rule.priority !== "number" ||
        !Number.isInteger(rule.priority) ||
        rule.priority < 0
      ) {
        throw new BadRequestError("INVALID_INPUT", "priority 必须为非负整数");
      }
      if (rule.capRate !== undefined) {
        const cap = parseDecimal(String(rule.capRate));
        if (cap < 0n || cap > parseDecimal("1")) {
          throw new BadRequestError("INVALID_INPUT", "capRate 必须在 0-1 之间");
        }
      }
    }
    const tenant = await platformStore.updateTenantSettings({
      tenantId: tenantOf(request),
      settings: { statutoryDeductionTypes: body.types },
    });
    return data(tenant.settings?.statutoryDeductionTypes ?? [], request);
  });

  app.get("/api/v1/deduction-legal-bases", async (request) => {
    requireRoles(request, "finance", "admin");
    const tenant = await platformStore.getTenant(tenantOf(request));
    return data(tenant.settings?.deductionLegalBases ?? {}, request);
  });

  app.put("/api/v1/deduction-legal-bases", async (request) => {
    requireRoles(request, "finance", "admin");
    const body = policyBody(request);
    if (!body.bases || typeof body.bases !== "object") {
      throw new BadRequestError("INVALID_INPUT", "bases 必须为对象");
    }
    const tenant = await platformStore.updateTenantSettings({
      tenantId: tenantOf(request),
      settings: { deductionLegalBases: body.bases },
    });
    return data(tenant.settings?.deductionLegalBases ?? {}, request);
  });
  };
}
