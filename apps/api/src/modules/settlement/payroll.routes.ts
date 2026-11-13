/**
 * 薪酬发放域路由（NPV2-011 第七片）：
 * 薪酬模板/合同/薪酬批次计算/审批/支付/导出/银行盘/税务申报/工资单。
 * 字段脱敏与门禁依赖由 app 注入；行为与拆分前等价。
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PlatformStore } from "../../platform-store.js";
import type { IncentiveStore } from "../../store-interface.js";
import type { PayrollRun, EmploymentContract } from "@anari/domain";
import {
  amendEmploymentContractSchema,
  cancelContractAmendmentSchema,
  createCompensationTemplateSchema,
  createEmploymentContractSchema,
  importEmploymentContractsSchema,
} from "@anari/contracts";
import {
  calculatePayroll,
  payrollCsv,
  payrollBankFileCsv,
  payrollTaxFilingCsv,
  payrollPayslipHtml,
} from "../../payroll.js";
import { calculateCumulativeIit } from "@anari/payroll-tax";
import { parseDecimal, formatDecimal } from "@anari/policy-dsl";
import { ForbiddenError } from "@anari/auth";
import { ConflictError, NotFoundError } from "../../store.js";

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
import { parseCsv } from "@anari/connectors";
import {
  columnIndexFor,
  data,
  idOf,
  isPlatformAdmin,
  ownPersonId,
  paramOf,
  parse,
  requireRoles,
  tenantOf,
} from "../../http-helpers.js";

export interface PayrollDeps {
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
  exportHeaders: (
    request: FastifyRequest,
    csv: string,
    classification: string,
  ) => Record<string, string>;
  auditExport: (
    request: FastifyRequest,
    action: string,
    objectType: string,
    objectId: string,
    detail?: string,
  ) => Promise<void>;
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
    viewer: unknown,
  ) => unknown;
  payrollRunForViewer: (request: FastifyRequest, run: PayrollRun) => Promise<PayrollRun>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pass-through
  redactContractAmendmentTerms: (...args: any[]) => any;
}

export function registerPayrollRoutes(deps: PayrollDeps): FastifyPluginAsync {
  const {
    platformStore,
    storeFor,
    countEvent,
    ensureApproval,
    consumeApprovalForAction,
    assertExportAllowed,
    assertExportDlp,
    exportHeaders,
    auditExport,
    fieldPoliciesFor,
    fieldMatchContextFor,
    redactResourceFields,
    payrollRunForViewer,
    redactContractAmendmentTerms,
  } = deps;

  /** Reversed or cancelled runs must never produce a payable file. */
  const assertPayrollExportable = (run: PayrollRun): void => {
    if (run.status === "REVERSED" || run.status === "CANCELLED") {
      throw new ConflictError(
        `PAYROLL_RUN_${run.status}: a closed payroll run cannot be exported`,
      );
    }
  };

  return async (app: FastifyInstance) => {
    app.post("/api/v1/compensation-templates", async (request, reply) => {
      requireRoles(request, "admin");
      const body = parse(createCompensationTemplateSchema, request.body);
      return reply.status(201).send(
        data(
          await platformStore.createCompensationTemplate({
            tenantId: tenantOf(request),
            code: body.code,
            name: body.name,
            roleCode: body.roleCode,
            employmentType: body.employmentType,
            currency: body.currency,
            fixedSalaryMin: body.fixedSalaryMin,
            fixedSalaryMax: body.fixedSalaryMax,
            deductionCapRate: body.deductionCapRate ?? "0.2",
            variableShareCapRate: body.variableShareCapRate ?? "1",
            smoothingThresholdRate: body.smoothingThresholdRate ?? "1",
            deductionOrder: body.deductionOrder ?? [
              "RECOVERY",
              "REVERSAL",
              "ADJUSTMENT",
              "OTHER",
            ],
            deductionTypeCaps: body.deductionTypeCaps ?? {},
          }),
          request,
        ),
      );
    });

    app.get("/api/v1/compensation-templates", async (request) => {
      requireRoles(request, "manager", "finance");
      return data(
        await platformStore.listCompensationTemplates(tenantOf(request)),
        request,
      );
    });

    app.post("/api/v1/compensation-templates/:id/retire", async (request) => {
      requireRoles(request, "admin");
      return data(
        await platformStore.retireCompensationTemplate({
          tenantId: tenantOf(request),
          templateId: idOf(request),
        }),
        request,
      );
    });

    app.post("/api/v1/employment-contracts/apply-due", async (request) => {
      requireRoles(request, "manager");
      return data(
        await platformStore.applyDueContractAmendments(tenantOf(request)),
        request,
      );
    });

    app.post("/api/v1/employment-contracts", async (request, reply) => {
      requireRoles(request, "admin");
      const body = parse(createEmploymentContractSchema, request.body);
      if (body.compensationTemplateCode) {
        const template = await platformStore.getActiveCompensationTemplate(
          tenantOf(request),
          body.compensationTemplateCode,
        );
        if (!template) {
          throw new NotFoundError(
            `CompensationTemplate ${body.compensationTemplateCode} not found`,
          );
        }
        if (
          template.employmentType !== body.employmentType ||
          template.currency !== body.currency
        ) {
          throw new ConflictError(
            "COMPENSATION_TEMPLATE_TYPE_OR_CURRENCY_MISMATCH",
          );
        }
        const salary = parseDecimal(body.fixedMonthlySalary);
        if (
          salary < parseDecimal(template.fixedSalaryMin) ||
          salary > parseDecimal(template.fixedSalaryMax)
        ) {
          throw new ConflictError(
            "COMPENSATION_TEMPLATE_SALARY_OUT_OF_RANGE",
          );
        }
      }
      const existingContracts = await platformStore.listEmploymentContracts(
        tenantOf(request),
        body.personId,
      );
      const newStart = Date.parse(body.startDate);
      const newEnd = body.endDate ? Date.parse(body.endDate) : Infinity;
      const overlapping = existingContracts.find(
        (contract) =>
          contract.status === "ACTIVE" &&
          contract.currency === body.currency &&
          Date.parse(contract.startDate) <= newEnd &&
          (!contract.endDate || Date.parse(contract.endDate) >= newStart),
      );
      if (overlapping) {
        throw new ConflictError(
          `EMPLOYMENT_CONTRACT_OVERLAP: ${overlapping.contractCode} already covers this person and period`,
        );
      }
      return reply.status(201).send(
        data(
          await platformStore.createEmploymentContract({
            tenantId: tenantOf(request),
            personId: body.personId,
            contractCode: body.contractCode,
            employmentType: body.employmentType,
            startDate: body.startDate,
            endDate: body.endDate,
            workLocation: body.workLocation,
            legalEntity: body.legalEntity,
            currency: body.currency,
            fixedMonthlySalary: body.fixedMonthlySalary,
            minimumMonthlyWage: body.minimumMonthlyWage,
            taxRate: body.taxRate ?? "0",
            socialInsuranceRate: body.socialInsuranceRate ?? "0",
            deductionCapRate: body.deductionCapRate ?? "0.2",
            variableShareCapRate: body.variableShareCapRate ?? "1",
            deductionOrder: body.deductionOrder ?? [
              "RECOVERY",
              "REVERSAL",
              "ADJUSTMENT",
              "OTHER",
            ],
            deductionTypeCaps: body.deductionTypeCaps ?? {},
            smoothingThresholdRate: body.smoothingThresholdRate ?? "1",
            smoothingMode: body.smoothingMode,
            smoothingWindowPeriods: body.smoothingWindowPeriods,
            smoothingMaxStepRate: body.smoothingMaxStepRate,
            compensationTemplateCode: body.compensationTemplateCode,
            bankAccountRef: body.bankAccountRef,
            consentSignatureRef: body.consentSignatureRef,
            consentSignedAt: body.consentSignedAt,
          }),
          request,
        ),
      );
    });

    app.post("/api/v1/employment-contracts/:id/amendments", async (request) => {
      requireRoles(request, "admin");
      const body = parse(amendEmploymentContractSchema, request.body);
      return data(
        await platformStore.amendEmploymentContract({
          tenantId: tenantOf(request),
          contractId: idOf(request),
          fixedMonthlySalary: body.fixedMonthlySalary,
          minimumMonthlyWage: body.minimumMonthlyWage,
          taxRate: body.taxRate,
          socialInsuranceRate: body.socialInsuranceRate,
          deductionCapRate: body.deductionCapRate,
          variableShareCapRate: body.variableShareCapRate,
          deductionOrder: body.deductionOrder ?? [],
          deductionTypeCaps: body.deductionTypeCaps ?? {},
          smoothingThresholdRate: body.smoothingThresholdRate ?? "1",
          compensationTemplateCode: body.compensationTemplateCode,
          bankAccountRef: body.bankAccountRef,
          effectiveFrom: body.effectiveFrom,
          consentSignatureRef: body.consentSignatureRef,
          approvedBy: body.approvedBy,
        }),
        request,
      );
    });

    app.post("/api/v1/employment-contracts/:id/amendments/:amendmentId/cancel", async (request) => {
      requireRoles(request, "manager");
      const body = parse(cancelContractAmendmentSchema, request.body);
      return data(
        await platformStore.cancelContractAmendment({
          tenantId: tenantOf(request),
          contractId: idOf(request),
          amendmentId: paramOf(request, "amendmentId"),
          reason: body.reason,
        }),
        request,
      );
    });

    app.get("/api/v1/employment-contracts/:id/amendments", async (request) => {
      requireRoles(request, "manager", "finance");
      const tenantId = tenantOf(request);
      const contractId = idOf(request);
      const amendments = await platformStore.listEmploymentContractAmendments(
        tenantId,
        contractId,
      );
      const roles = request.authContext?.roles ?? [];
      if (roles.includes("admin")) return data(amendments, request);
      const policies = await fieldPoliciesFor(request);
      const matchContext = await fieldMatchContextFor(request, policies);
      let contractPersonId: string | undefined;
      try {
        contractPersonId = (
          await platformStore.getEmploymentContract(tenantId, contractId)
        ).personId;
      } catch {
        contractPersonId = undefined;
      }
      const personId = ownPersonId(request);
      return data(
        amendments.map((amendment) =>
          (redactContractAmendmentTerms as (amendment: unknown, viewer: unknown) => unknown)(amendment, {
            personId,
            recordPersonId: contractPersonId,
            roles,
            policies,
            matchContext,
          }),
        ),
        request,
      );
    });

    // 批量导入：CSV 一次登记多名员工的劳动合同。
    app.post("/api/v1/employment-contracts:import", async (request) => {
      requireRoles(request, "admin");
      const body = parse(importEmploymentContractsSchema, request.body);
      const rows = parseCsv(body.csv);
      if (rows.length < 2) {
        throw new BadRequestError(
          "CSV_NO_DATA_ROWS",
          "CSV 需要表头和至少一行数据",
        );
      }
      const header = rows[0]!;
      const col = {
        personId: columnIndexFor(header, ["person_id", "人员id"]),
        employeeCode: columnIndexFor(header, [
          "employee_code",
          "employeecode",
          "工号",
          "员工编号",
          "empno",
        ]),
        contractCode: columnIndexFor(header, ["contract_code", "合同编号"]),
        employmentType: columnIndexFor(header, ["employment_type", "用工类型"]),
        startDate: columnIndexFor(header, ["start_date", "开始日期", "入职日期"]),
        endDate: columnIndexFor(header, ["end_date", "结束日期"]),
        workLocation: columnIndexFor(header, ["work_location", "工作地点"]),
        legalEntity: columnIndexFor(header, ["legal_entity", "法人主体"]),
        currency: columnIndexFor(header, ["currency", "币种"]),
        fixedMonthlySalary: columnIndexFor(header, [
          "fixed_monthly_salary",
          "固定月薪",
          "月薪",
        ]),
        minimumMonthlyWage: columnIndexFor(header, [
          "minimum_monthly_wage",
          "最低工资",
        ]),
        taxRate: columnIndexFor(header, ["tax_rate", "个税率"]),
        socialInsuranceRate: columnIndexFor(header, [
          "social_insurance_rate",
          "社保率",
        ]),
        deductionCapRate: columnIndexFor(header, [
          "deduction_cap_rate",
          "扣款上限率",
        ]),
        variableShareCapRate: columnIndexFor(header, [
          "variable_share_cap_rate",
          "浮动占比上限率",
        ]),
        consentSignatureRef: columnIndexFor(header, [
          "consent_signature_ref",
          "同意签名",
          "签署引用",
        ]),
      };
      if (
        (col.personId === -1 && col.employeeCode === -1) ||
        col.contractCode === -1 ||
        col.startDate === -1 ||
        col.fixedMonthlySalary === -1
      ) {
        throw new BadRequestError(
          "CSV_COLUMNS_REQUIRED",
          "CSV 必须包含：工号/人员ID、合同编号、开始日期、固定月薪",
        );
      }
      const persons = await platformStore.listPersons(tenantOf(request));
      const byCode = new Map(
        persons.map((person) => [person.employeeCode.toLowerCase(), person.id]),
      );
      const existing = await platformStore.listEmploymentContracts(
        tenantOf(request),
      );
      const contractsByPerson = new Map<string, typeof existing>();
      for (const contract of existing) {
        const list = contractsByPerson.get(contract.personId) ?? [];
        list.push(contract);
        contractsByPerson.set(contract.personId, list);
      }
      const typeMap: Record<string, "FULL_TIME" | "PART_TIME" | "CONTRACTOR"> = {
        "全职": "FULL_TIME",
        full_time: "FULL_TIME",
        "兼职": "PART_TIME",
        part_time: "PART_TIME",
        "外包": "CONTRACTOR",
        contractor: "CONTRACTOR",
        "劳务": "CONTRACTOR",
      };
      const defaultConsent = `CSV-CONSENT-${new Date().toISOString().slice(0, 10)}`;
      const created: Array<{ row: number; contractId: string }> = [];
      const failed: Array<{ row: number; error: string }> = [];
      for (const [rowIndex, cells] of rows.slice(1).entries()) {
        const row = rowIndex + 2;
        if (cells.every((cell) => !cell.trim())) continue;
        const fail = (error: string) => failed.push({ row, error });
        try {
          let personId: string | undefined;
          if (col.personId >= 0 && cells[col.personId]?.trim()) {
            personId = cells[col.personId]!.trim();
            if (!persons.some((person) => person.id === personId)) {
              fail(`人员 ${personId} 不存在`);
              continue;
            }
          } else {
            const code = cells[col.employeeCode]?.trim().toLowerCase() ?? "";
            personId = byCode.get(code);
            if (!personId) {
              fail(`工号「${code}」没有匹配的员工`);
              continue;
            }
          }
          const contractCode = cells[col.contractCode]?.trim() ?? "";
          if (!contractCode) {
            fail("合同编号不能为空");
            continue;
          }
          const rawStart = cells[col.startDate]?.trim() ?? "";
          if (!/^\d{4}-\d{2}-\d{2}$/.test(rawStart)) {
            fail(`开始日期「${rawStart}」需要 YYYY-MM-DD`);
            continue;
          }
          const rawEnd = cells[col.endDate]?.trim() ?? "";
          if (rawEnd && !/^\d{4}-\d{2}-\d{2}$/.test(rawEnd)) {
            fail(`结束日期「${rawEnd}」需要 YYYY-MM-DD`);
            continue;
          }
          const rawFixed = cells[col.fixedMonthlySalary]?.trim() ?? "";
          if (!/^\d+(\.\d{1,2})?$/.test(rawFixed) || Number(rawFixed) <= 0) {
            fail(`固定月薪「${rawFixed}」无效`);
            continue;
          }
          const employmentTypeRaw =
            (col.employmentType >= 0
              ? cells[col.employmentType]?.trim().toLowerCase()
              : "") || "full_time";
          const employmentType = typeMap[employmentTypeRaw];
          if (!employmentType) {
            fail(`用工类型「${employmentTypeRaw}」无效（全职/兼职/外包）`);
            continue;
          }
          const currency =
            (col.currency >= 0 ? cells[col.currency]?.trim() : "") || "CNY";
          const startDate = `${rawStart}T00:00:00.000Z`;
          const endDate = rawEnd ? `${rawEnd}T23:59:59.999Z` : undefined;
          // 与单笔创建一致：同一员工同币种的 ACTIVE 合同不允许期间重叠。
          const overlap = (contractsByPerson.get(personId) ?? []).find(
            (contract) =>
              contract.status === "ACTIVE" &&
              contract.currency === currency &&
              Date.parse(contract.startDate) <=
                Date.parse(endDate ?? "9999-12-31T23:59:59.999Z") &&
              (!contract.endDate ||
                Date.parse(contract.endDate) >= Date.parse(startDate)),
          );
          if (overlap) {
            fail(`与已有合同 ${overlap.contractCode} 期间重叠`);
            continue;
          }
          const contract = await platformStore.createEmploymentContract({
            tenantId: tenantOf(request),
            personId,
            contractCode,
            employmentType,
            startDate,
            endDate,
            workLocation:
              (col.workLocation >= 0
                ? cells[col.workLocation]?.trim()
                : "") || "深圳",
            legalEntity:
              col.legalEntity >= 0
                ? cells[col.legalEntity]?.trim() || undefined
                : undefined,
            currency,
            fixedMonthlySalary: rawFixed,
            minimumMonthlyWage:
              (col.minimumMonthlyWage >= 0
                ? cells[col.minimumMonthlyWage]?.trim()
                : "") || "2360",
            taxRate:
              (col.taxRate >= 0 ? cells[col.taxRate]?.trim() : "") || "0",
            socialInsuranceRate:
              (col.socialInsuranceRate >= 0
                ? cells[col.socialInsuranceRate]?.trim()
                : "") || "0",
            deductionCapRate:
              (col.deductionCapRate >= 0
                ? cells[col.deductionCapRate]?.trim()
                : "") || "0.2",
            variableShareCapRate:
              (col.variableShareCapRate >= 0
                ? cells[col.variableShareCapRate]?.trim()
                : "") || "1",
            consentSignatureRef:
              (col.consentSignatureRef >= 0
                ? cells[col.consentSignatureRef]?.trim()
                : "") || defaultConsent,
            deductionOrder: [
              "RECOVERY",
              "REVERSAL",
              "ADJUSTMENT",
              "OTHER",
            ],
            deductionTypeCaps: {},
            smoothingThresholdRate: "1",
            smoothingMode: "BLOCK",
            smoothingWindowPeriods: 3,
            smoothingMaxStepRate: "0.5",
          });
          const list = contractsByPerson.get(personId) ?? [];
          list.push(contract);
          contractsByPerson.set(personId, list);
          created.push({ row, contractId: contract.id });
        } catch (error) {
          fail(error instanceof Error ? error.message : "创建失败");
        }
      }
      countEvent("employment_contracts_csv_imported");
      return data(
        {
          created: created.length,
          failed: failed.length,
          createdContractIds: created.map((entry) => entry.contractId),
          errors: failed,
          defaultConsentRef: defaultConsent,
        },
        request,
      );
    });

    app.get("/api/v1/employment-contracts", async (request) => {
      requireRoles(request, "manager", "finance");
      const query = request.query as { personId?: string };
      const contracts = await platformStore.listEmploymentContracts(
        tenantOf(request),
        query.personId,
      );
      const roles = request.authContext?.roles ?? [];
      if (roles.includes("admin")) return data(contracts, request);
      const policies = await fieldPoliciesFor(request);
      const matchContext = await fieldMatchContextFor(request, policies);
      const personId = ownPersonId(request);
      return data(
        contracts.map((contract) =>
          redactResourceFields(contract, "EMPLOYMENT_CONTRACT", {
            personId,
            recordPersonId: contract.personId,
            roles,
            policies,
            matchContext,
          }),
        ),
        request,
      );
    });

  };
}
